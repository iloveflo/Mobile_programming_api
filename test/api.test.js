import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-test-secret-only-01234567890123456789';
process.env.RATE_LIMIT_MAX = '10000';
process.env.AUTH_RATE_LIMIT_MAX = '10000';
process.env.OTP_DELIVERY = 'console';
// No test uses the operator's live database, SMTP, R2, OCR or C06 credentials.
for (const key of ['OCR_PROVIDER_URL','EKYC_PROVIDER_URL','R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_PUBLIC','R2_BUCKET_PRIVATE','R2_PUBLIC_DOMAIN']) process.env[key] = '';
const r2Env = { R2_ENDPOINT: 'https://test.r2.cloudflarestorage.com', R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET_PUBLIC: 'test-public', R2_BUCKET_PRIVATE: 'test-private', R2_PUBLIC_DOMAIN: 'https://cdn.example.test' };
Object.assign(process.env,r2Env);
const { default: pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');
for (const key of Object.keys(r2Env)) process.env[key] = '';
const { buildSchedule, addMonths } = await import('../src/services/loan.service.js');
let db, server, base, token, userId, loanId, scheduleId, secondToken, capturedOtp, challenge;
const originalLog = console.log;
console.log = (...args) => { const m = String(args[0]).match(/\[DEV OTP\].*: (\d{6})/); if (m) capturedOtp = m[1]; else originalLog(...args); };
async function request(path, { method = 'GET', body, auth = token } = {}) {
  const response = await fetch(base + path, { method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, ...(await response.json()) };
}
function ok(response, status = 200) { assert.equal(response.status, status, JSON.stringify(response)); assert.equal(response.success, true); return response.data; }
let tail = Promise.resolve();
async function lock() { const previous = tail; let release; tail = new Promise(r => { release = r; }); await previous; return release; }
async function query(sql, params) {
  const r = await db.query(sql, params);
  for (const row of r.rows) for (const field of r.fields) if ([20,1700].includes(field.dataTypeID) && row[field.name] !== null) row[field.name] = Number(row[field.name]);
  return { ...r, rowCount: r.affectedRows ?? r.rows.length };
}
before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('../credit_health_db.sql', import.meta.url),'utf8'));
  pool.query = async (sql,params) => { const release = await lock(); try { return await query(sql,params); } finally { release(); } };
  pool.connect = async () => { const release = await lock(); return { query, release }; };
  await pool.query("UPDATE users SET password_hash=$1 WHERE email='binha10k56@gmail.com'", [await bcrypt.hash('123456',10)]);
  server = app.listen(0,'127.0.0.1'); await new Promise(r => server.once('listening',r)); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { console.log = originalLog; if(server) { server.closeAllConnections(); await new Promise(r => server.close(r)); } if(db) await db.close(); await pool.end(); });

test('schedule math: zero interest, month ends, flat/reducing and rounding', () => {
  assert.equal(addMonths('2024-01-31',1),'2024-02-29');
  const loan = { loan_id: 1, principal_amount: 100, interest_rate: 0, term_months: 3, start_date: '2024-01-31', interest_method: 'REDUCING_BALANCE' };
  const list = buildSchedule(loan); assert.equal(list.reduce((s,x) => s+x.principal_amount,0),100); assert.equal(list.at(-1).remaining_balance,0);
  const reducing = buildSchedule({ ...loan, principal_amount: 12000000, interest_rate: 0.12, term_months: 12 });
  const flat = buildSchedule({ ...loan, principal_amount: 12000000, interest_rate: 0.12, term_months: 12, interest_method: 'FLAT' });
  assert.equal(reducing[0].interest_amount,120000); assert.equal(reducing[11].interest_amount,10000); assert.equal(flat[11].interest_amount,120000);
});
test('health, unknown endpoints and protected routes', async () => {
  ok(await request('/health',{auth:null})); assert.equal((await request('/missing',{auth:null})).status,404);
  assert.equal((await request('/api/v1/user/profile',{auth:null})).status,401);
});
test('registration, challenge OTP binding and one-time verification', async () => {
  const registered = ok(await request('/api/v1/auth/register',{method:'POST',auth:null,body:{full_name:'Test User',email:'test@example.com',password:'Password123!',monthly_income:20000000}}),201);
  userId = registered.user_id; challenge = registered.challenge_token; assert.match(capturedOtp,/^\d{6}$/);
  const stored = (await pool.query('SELECT otp_code FROM otp_verifications WHERE user_id=$1',[userId])).rows[0]; assert.notEqual(stored.otp_code,capturedOtp);
  assert.equal((await request('/api/v1/auth/login',{method:'POST',auth:null,body:{identifier:'test@example.com',password:'Password123!'}})).status,403);
  assert.equal((await request('/api/v1/auth/verify-otp',{method:'POST',auth:null,body:{otp:capturedOtp,flow_type:'RESET_PASSWORD',challenge_token:challenge}})).status,400);
  ok(await request('/api/v1/auth/verify-otp',{method:'POST',auth:null,body:{otp:capturedOtp,flow_type:'REGISTER',challenge_token:challenge}}));
  assert.equal((await request('/api/v1/auth/verify-otp',{method:'POST',auth:null,body:{otp:capturedOtp,flow_type:'REGISTER',challenge_token:challenge}})).status,400);
});
test('login, short session, refresh rotation, revocation and no password leak', async () => {
  const result = ok(await request('/api/auth/login',{method:'POST',auth:null,body:{identifier:'test@example.com',password:'Password123!',remember_me:false}})); token=result.accessToken;
  assert.equal(result.user.password_hash,undefined); assert.equal(result.token,result.accessToken);
  const session = (await pool.query('SELECT * FROM refresh_tokens WHERE user_id=$1 ORDER BY token_id DESC LIMIT 1',[userId])).rows[0]; assert.notEqual(session.token,result.refreshToken); assert.ok(new Date(session.expires_at)-Date.now()<86401000);
  const refreshed = ok(await request('/api/v1/auth/refresh-token',{method:'POST',auth:null,body:{refresh_token:result.refreshToken}})); token=refreshed.access_token;
  assert.equal((await request('/api/v1/auth/refresh-token',{method:'POST',auth:null,body:{refreshToken:result.refreshToken}})).status,401);
  const sessions=ok(await request('/api/v1/auth/sessions')); assert.equal(sessions.length,2); assert.ok(sessions.some(s=>s.is_current));
  const currentSession=sessions.find(s=>s.is_current);
  ok(await request(`/api/v1/auth/sessions/${currentSession.id}`,{method:'DELETE'})); assert.equal((await request('/api/v1/user/profile')).status,401);
  token=ok(await request('/api/v1/auth/login',{method:'POST',auth:null,body:{identifier:'test@example.com',password:'Password123!'}})).accessToken;
  secondToken=ok(await request('/api/v1/auth/login',{method:'POST',auth:null,body:{identifier:'binha10k56@gmail.com',password:'123456'}})).accessToken;
});
test('profile allowlist and security validation', async () => {
  const profile=ok(await request('/api/v1/user/profile',{method:'PUT',body:{full_name:'Changed Name',is_active:false,cic_score:999}})); assert.equal(profile.full_name,'Changed Name'); assert.equal(profile.is_active,true); assert.notEqual(profile.cic_score,999);
  assert.equal((await request('/api/v1/user/security-settings',{method:'PUT',body:{is_biometric_enabled:'false'}})).status,400);
  ok(await request('/api/v1/user/security-settings',{method:'PUT',body:{is_biometric_enabled:true}}));
});
test('loan DTO, generated schedules, collaterals and ownership', async () => {
  const loan=ok(await request('/api/v1/loans',{method:'POST',body:{loan_name:'Test Loan',lender:'Test Bank',loan_type_code:'CONSUMER',principal_amount:12000000,interest_rate:12,term_months:12,start_date:'2026-01-31'}}),201); loanId=loan.loan_id;
  assert.equal(loan.interest_rate,12); assert.equal(loan.remaining_principal,12000000); assert.equal(loan.remaining_term_months,12);
  const schedules=ok(await request(`/api/v1/payment-schedules?loan_id=${loanId}`)); assert.equal(schedules.length,1); assert.equal(schedules[0].principal_due,1000000); assert.equal(schedules[0].interest_due,120000); scheduleId=schedules[0].schedule_id;
  assert.equal((await request(`/api/v1/loans/${loanId}`,{auth:secondToken})).status,404);
  assert.equal((await request(`/api/v1/loans/${loanId}/documents`,{auth:secondToken})).status,404);
  ok(await request('/api/v1/collaterals',{method:'POST',body:{loan_id:loanId,asset_name:'Asset',asset_type:'VEHICLE',estimated_value:20000000,certificate_number:'ABC'}}),201);
  const assets=ok(await request(`/api/v1/collaterals?loan_id=${loanId}`)); assert.equal(assets[0].estimated_value,20000000); assert.equal(assets[0].certificate_number,'ABC');
  const list=ok(await request('/api/loans?keyword=Test')); assert.equal(list.length,1); assert.equal(list[0].collaterals.length,1);
});
test('payment is atomic, duplicate-safe and user-scoped', async () => {
  assert.equal((await request(`/api/v1/payment-schedules/${scheduleId}/pay`,{method:'POST',body:{},auth:secondToken})).status,404);
  const paid=ok(await request(`/api/v1/payment-schedules/${scheduleId}/pay`,{method:'POST',body:{}})); assert.equal(paid.status,'PAID'); assert.ok(paid.paid_at);
  assert.equal((await request(`/api/v1/payment-schedules/${scheduleId}/pay`,{method:'POST',body:{}})).status,409);
  assert.equal(ok(await request(`/api/v1/loans/${loanId}`)).remaining_principal,11000000);
  assert.equal((await pool.query('SELECT * FROM payments WHERE schedule_id=$1',[scheduleId])).rows.length,1);
  assert.equal((await request(`/api/v1/loans/${loanId}`,{method:'PUT',body:{interest_rate:15}})).status,409);
});
test('credit profile, immutable duplicate report and route aliases', async () => {
  assert.equal((await request('/credit-profile')).status,404);
  const profile=ok(await request('/api/v1/credit-profile/recalculate',{method:'POST',body:{}})); assert.ok(profile.dti_ratio>0); assert.equal(profile.user_id,userId);
  const report=ok(await request('/api/v1/credit-reports/generate',{method:'POST',body:{report_period:'2026-Q4'}}),201);
  assert.equal((await request('/api/v1/credit-reports/generate',{method:'POST',body:{report_period:'2026-Q4'}})).status,409);
  assert.equal(ok(await request('/credit-reports')).length,1); assert.equal(ok(await request('/api/credit-reports')).length,1);
  assert.equal((await request(`/api/v1/credit-reports/${report.report_id}`,{auth:secondToken})).status,404);
  assert.equal((await request(`/api/v1/credit-reports/${report.report_id}`,{method:'DELETE',auth:secondToken})).status,404);
  ok(await request(`/api/v1/credit-reports/${report.report_id}`,{method:'DELETE'}));
  assert.equal(ok(await request('/credit-reports')).length,0);
  ok(await request('/api/v1/credit-reports/generate',{method:'POST',body:{report_period:'2026-Q4'}}),201);
});
test('strategies and simulations persist DTO fields and enforce ownership', async () => {
  for (const strategy_type of ['AVALANCHE','SNOWBALL']) ok(await request('/api/v1/debt-strategies/apply',{method:'POST',body:{strategy_type,extra_payment:1000000,user_id:1}}),201);
  const active=ok(await request('/debt-strategies/active')); assert.equal(active.strategy_type,'SNOWBALL'); assert.equal(active.user_id,userId);
  assert.equal(ok(await request('/debt-strategies')).filter(x=>x.is_active).length,1);
  ok(await request(`/debt-strategies/${active.strategy_id}/cancel`,{method:'PATCH',body:{}})); assert.equal(ok(await request('/debt-strategies/active')),null);
  const sim=ok(await request('/simulations',{method:'POST',body:{loan_id:loanId,scenario_name:'Scenario',simulation_type:'EXTRA_MONTHLY',extra_monthly_payment:1000000,lump_sum_payment:2000000,saved_interest:500000,time_saved_months:3}}),201);
  assert.equal(sim.lump_sum_payment,2000000); assert.equal(sim.extra_monthly_payment,1000000);
  assert.equal((await request(`/simulations/${sim.simulation_id}`,{method:'DELETE',auth:secondToken})).status,404);
  ok(await request(`/simulations/${sim.simulation_id}`,{method:'DELETE'}));
  for (const scenario_type of ['EXTRA_PAYMENT','CHANGE_PAYMENT','CHANGE_INTEREST_RATE','EARLY_PAYOFF']) {
    const created=ok(await request('/simulations',{method:'POST',body:{loan_id:loanId,scenario_name:`Test ${scenario_type}`,scenario_type,extra_payment:0,estimated_interest_saved:100000,months_reduced:1}}),201);
    assert.equal(created.scenario_type,scenario_type);
    ok(await request(`/simulations/${created.simulation_id}`,{method:'DELETE'}));
  }
  assert.equal((await request('/simulations',{method:'POST',body:{loan_id:loanId,scenario_name:'Invalid',simulation_type:'UNKNOWN_TYPE'}})).status,400);
});
test('notification router, partial preferences and reminder synchronization', async () => {
  ok(await request('/notifications/preference',{method:'PUT',body:{push_enabled:false}}));
  const p=ok(await request('/notifications/preference',{method:'PUT',body:{reminder_days:5}})); assert.equal(p.push_enabled,false); assert.equal(p.email_enabled,true);
  const sync=ok(await request('/payment-schedules/sync',{method:'POST',body:{}})); assert.equal(sync.created_count,1);
  const notifications=ok(await request('/notifications')); assert.equal(notifications.filter(n=>n.notification_type==='PAYMENT_REMINDER' && n.status==='PENDING').length,1);
  assert.equal(notifications.filter(n=>n.notification_type==='BALANCE_FLUCTUATION' && n.channel==='PUSH' && n.status==='SENT').length,2);
  assert.equal(notifications.filter(n=>n.notification_type==='BALANCE_FLUCTUATION' && n.channel==='EMAIL').length,0);
  ok(await request('/payment-schedules/sync',{method:'POST',body:{}})); assert.equal(ok(await request('/notifications')).filter(n=>n.notification_type==='PAYMENT_REMINDER' && n.status==='PENDING').length,1);
  assert.equal(ok(await request('/payment-schedules?user_id=1')).length,2);
});
test('external services fail explicitly; private files cannot cross accounts', async () => {
  assert.equal((await request('/api/v1/loans/ocr-scan',{method:'POST',body:{image_path:'contracts/file.jpg'}})).status,503);
  assert.equal((await request('/api/v1/user/financial-profile-pdf')).status,503);
  assert.equal((await request('/api/v1/storage/view-url?file_key=contracts/1/private.pdf')).status,404);
  assert.equal((await request('/api/v1/storage/presigned-url',{method:'POST',body:{folder:'avatars',file_name:'photo.jpg',content_type:'image/jpeg'}})).status,503);
});
test('forgot password proof is required, one-time reset revokes all sessions', async () => {
  assert.equal((await request('/api/v1/auth/reset-password',{method:'POST',auth:null,body:{new_password:'NewPassword123!'}})).status,401);
  const issued=ok(await request('/api/v1/auth/resend-otp',{method:'POST',auth:null,body:{identifier:'test@example.com',flow_type:'RESET_PASSWORD'}}));
  const proof=ok(await request('/api/v1/auth/verify-otp',{method:'POST',auth:null,body:{otp:capturedOtp,flow_type:'RESET_PASSWORD',challenge_token:issued.challenge_token}}));
  ok(await request('/api/v1/auth/reset-password',{method:'POST',auth:null,body:{reset_token:proof.reset_token,new_password:'NewPassword123!'}}));
  assert.equal((await request('/api/v1/user/profile')).status,401);
  assert.equal((await request('/api/v1/auth/reset-password',{method:'POST',auth:null,body:{reset_token:proof.reset_token,new_password:'AgainPassword123!'}})).status,401);
});
test('failed login persists counters, temporary lock expires, admin lock persists', async () => {
  for(let i=0;i<5;i++) assert.equal((await request('/api/v1/auth/login',{method:'POST',auth:null,body:{identifier:'test@example.com',password:'wrong'}})).status,i===4?403:401);
  assert.equal((await request('/api/v1/auth/login',{method:'POST',auth:null,body:{identifier:'test@example.com',password:'NewPassword123!'}})).status,403);
  await pool.query("UPDATE users SET lock_until=NOW()-INTERVAL '1 second' WHERE user_id=$1",[userId]);
  ok(await request('/api/v1/auth/login',{method:'POST',auth:null,body:{identifier:'test@example.com',password:'NewPassword123!'}}));
  await pool.query('UPDATE users SET is_locked=TRUE,lock_until=NULL WHERE user_id=$1',[userId]);
  assert.equal((await request('/api/v1/auth/login',{method:'POST',auth:null,body:{identifier:'test@example.com',password:'NewPassword123!'}})).status,403);
});

test('R2 presigning, ownership, confirmation idempotency and private PDF export', async () => {
  Object.assign(process.env,r2Env);
  const { r2Client } = await import('../src/config/r2.js');
  const originalSend = r2Client.send; let pdfBuffer; let headCalls=0;
  r2Client.send = async command => {
    if(command.constructor.name==='HeadObjectCommand') { headCalls++; return { ContentType:'image/jpeg',ContentLength:1024 }; }
    if(command.constructor.name==='PutObjectCommand') { pdfBuffer=command.input.Body; return {}; }
    throw new Error('Unexpected storage operation');
  };
  try {
    assert.equal((await request('/api/v1/storage/presigned-url',{auth:secondToken,method:'POST',body:{folder:'contracts',file_name:'secret.jpg',content_type:'image/jpeg',is_public:true}})).status,400);
    const avatar=ok(await request('/api/v1/storage/presigned-url',{auth:secondToken,method:'POST',body:{folder:'avatars',file_name:'avatar.jpg',content_type:'image/jpeg',is_public:true}}));
    assert.match(avatar.upload_url,/X-Amz-Signature=/); assert.match(avatar.file_key,/^avatars\/1\//); assert.equal(avatar.http_method,'PUT');
    assert.equal(avatar.headers['Cache-Control'],'public, max-age=31536000, immutable');
    assert.equal((await request('/api/v1/storage/confirm-upload',{auth:secondToken,method:'POST',body:{folder:'avatars',file_key:avatar.file_key,metadata:{user_id:999}}})).status,403);
    const confirm=await request('/api/v1/storage/confirm-upload',{auth:secondToken,method:'POST',body:{folder:'avatars',file_key:avatar.file_key,metadata:{user_id:1}}}); assert.equal(confirm.status,200); assert.equal(confirm.download_url,avatar.download_url);
    await request('/api/v1/storage/confirm-upload',{auth:secondToken,method:'POST',body:{folder:'avatars',file_key:avatar.file_key}}); assert.equal(headCalls,1);
    const contract=ok(await request('/api/v1/storage/presigned-url',{auth:secondToken,method:'POST',body:{folder:'contracts',file_name:'contract.jpg',content_type:'image/jpeg',is_public:false}})); assert.equal(contract.download_url,'');
    assert.equal(contract.headers['Cache-Control'],'no-cache, private');
    const confirmed=await request('/api/v1/storage/confirm-upload',{auth:secondToken,method:'POST',body:{folder:'contracts',file_key:contract.file_key,metadata:{loan_id:101}}}); assert.equal(confirmed.status,200);
    const viewed=await request(`/api/v1/storage/view-url?file_key=${encodeURIComponent(contract.file_key)}`,{auth:secondToken}); assert.equal(viewed.status,200); assert.match(viewed.view_url,/X-Amz-Signature=/);
    assert.equal(headCalls,2);
    const pdf=ok(await request('/api/v1/user/financial-profile-pdf',{auth:secondToken})); assert.match(pdf.file_key,/^reports\/1\//); assert.match(pdf.pdf_url,/X-Amz-Signature=/); assert.equal(pdfBuffer.subarray(0,5).toString(),'%PDF-'); assert.ok(pdfBuffer.length>1000);
  } finally { r2Client.send=originalSend; for(const key of Object.keys(r2Env)) process.env[key]=''; }
});
test('OTP failed attempts persist, resend cooldown and expiry are enforced', async () => {
  const registration=ok(await request('/api/v1/auth/register',{auth:null,method:'POST',body:{full_name:'OTP test',email:'otp@example.com',password:'Password123!'}}),201);
  const valid=capturedOtp;
  assert.equal((await request('/api/v1/auth/resend-otp',{auth:null,method:'POST',body:{identifier:'otp@example.com'}})).status,429);
  for(let i=0;i<5;i++) {
    const result=await request('/api/v1/auth/verify-otp',{auth:null,method:'POST',body:{flow_type:'REGISTER',otp:valid==='000000'?'999999':'000000',challenge_token:registration.challenge_token}});
    assert.equal(result.status,i===4?429:400);
  }
  assert.equal((await request('/api/v1/auth/verify-otp',{auth:null,method:'POST',body:{flow_type:'REGISTER',otp:valid,challenge_token:registration.challenge_token}})).status,429);
  await pool.query("UPDATE otp_verifications SET created_at=NOW()-INTERVAL '2 minutes' WHERE user_id=$1",[registration.user_id]);
  const again=ok(await request('/api/v1/auth/resend-otp',{auth:null,method:'POST',body:{identifier:'otp@example.com'}}));
  await pool.query("UPDATE otp_verifications SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",[registration.user_id]);
  assert.equal((await request('/api/v1/auth/verify-otp',{auth:null,method:'POST',body:{flow_type:'REGISTER',otp:capturedOtp,challenge_token:again.challenge_token}})).status,400);
});
test('partial outstanding loan generates only remaining principal; payment rollback', async () => {
  const loan=ok(await request('/api/v1/loans',{auth:secondToken,method:'POST',body:{loan_name:'Imported loan',principal_amount:12000000,remaining_principal:3000000,remaining_term_months:3,interest_rate:12,term_months:12,start_date:'2026-01-01'}}),201);
  const schedules=ok(await request(`/payment-schedules?loan_id=${loan.loan_id}`,{auth:secondToken})); assert.equal(schedules.length,1); assert.equal(schedules[0].principal_due,1000000);
  assert.equal(schedules[0].period_number,10);
  // Force failure after payment insertion to verify the transaction rolls everything back.
  await db.exec("CREATE FUNCTION test_fail_paid() RETURNS TRIGGER AS $$ BEGIN IF NEW.status='PAID' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql; CREATE TRIGGER test_fail_paid BEFORE UPDATE ON payment_schedules FOR EACH ROW EXECUTE FUNCTION test_fail_paid();");
  assert.equal((await request(`/payment-schedules/${schedules[0].schedule_id}/pay`,{auth:secondToken,method:'POST',body:{}})).status,500);
  assert.equal((await pool.query('SELECT * FROM payments WHERE schedule_id=$1',[schedules[0].schedule_id])).rows.length,0);
  assert.equal(ok(await request(`/loans/${loan.loan_id}`,{auth:secondToken})).remaining_principal,3000000);
  await db.exec('DROP TRIGGER test_fail_paid ON payment_schedules; DROP FUNCTION test_fail_paid();');
  const attempts=await Promise.all([1,2].map(()=>request(`/payment-schedules/${schedules[0].schedule_id}/pay`,{auth:secondToken,method:'POST',body:{}})));
  assert.deepEqual(attempts.map(x=>x.status).sort(),[200,409]);
});
test('schema script is re-runnable without deleting business data', async () => {
  const before=(await pool.query('SELECT count(*)::int AS count FROM loans')).rows[0].count;
  await db.exec(await readFile(new URL('../credit_health_db.sql',import.meta.url),'utf8'));
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM loans')).rows[0].count,before);
});

test('OCR/eKYC provider adapters validate results and enforce uploaded document ownership', async () => {
  const { createServer } = await import('node:http');
  let responseBody = { lender:'Provider Bank',principal_amount:10000000,interest_rate:8.5,term_months:12,start_date:'2026-01-01' };
  let received;
  const upstream=createServer(async (req,res) => { const chunks=[]; for await(const c of req) chunks.push(c); received=JSON.parse(Buffer.concat(chunks).toString()); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(responseBody)); });
  upstream.listen(0,'127.0.0.1'); await new Promise(r=>upstream.once('listening',r));
  const url=`http://127.0.0.1:${upstream.address().port}`;
  process.env.OCR_PROVIDER_URL=url; process.env.EKYC_PROVIDER_URL=url;
  try {
    const ocr=ok(await request('/api/v1/loans/ocr-scan',{auth:secondToken,method:'POST',body:{image_path:'contracts/test.jpg'}})); assert.equal(ocr.interest_rate,8.5); assert.equal(received.user_id,1);
    responseBody={ unexpected:true };
    assert.equal((await request('/api/v1/loans/ocr-scan',{auth:secondToken,method:'POST',body:{image_path:'contracts/test.jpg'}})).status,502);
    for(const key of ['ekyc/1/front.jpg','ekyc/1/back.jpg']) await pool.query("INSERT INTO storage_uploads(file_key,user_id,folder,is_public,content_type,confirmed_at) VALUES($1,1,'ekyc',FALSE,'image/jpeg',NOW())",[key]);
    const body={id_card_number:'079201008888',front_card_url:'ekyc/1/front.jpg',back_card_url:'ekyc/1/back.jpg'};
    responseBody={verified:false,tier:'C06'};
    assert.equal((await request('/api/v1/user/ekyc-verify',{auth:secondToken,method:'POST',body})).status,422);
    responseBody={verified:true,tier:'C06'};
    const user=ok(await request('/api/v1/user/ekyc-verify',{auth:secondToken,method:'POST',body})); assert.equal(user.is_ekyc_verified,true); assert.equal(user.ekyc_tier,'C06'); assert.equal(user.front_card_url,body.front_card_url);
    await pool.query('UPDATE users SET is_locked=FALSE,lock_until=NULL WHERE user_id=$1',[userId]);
    const other=ok(await request('/api/v1/auth/login',{auth:null,method:'POST',body:{identifier:'test@example.com',password:'NewPassword123!'}})).accessToken;
    assert.equal((await request('/api/v1/user/ekyc-verify',{auth:other,method:'POST',body})).status,400);
    assert.equal((await request('/api/v1/storage/view-url?file_key=ekyc/1/front.jpg',{auth:other})).status,404);
  } finally { process.env.OCR_PROVIDER_URL=''; process.env.EKYC_PROVIDER_URL=''; upstream.closeAllConnections(); await new Promise(r=>upstream.close(r)); }
});

test('editing imported loans preserves actual debt and the remaining installment count', async () => {
  const loan=ok(await request('/loans',{auth:secondToken,method:'POST',body:{loan_name:'Imported edit regression',principal_amount:12000000,remaining_principal:3000000,remaining_term_months:5,interest_rate:12,term_months:12,start_date:'2030-01-01'}}),201);
  const edited=ok(await request(`/loans/${loan.loan_id}`,{auth:secondToken,method:'PUT',body:{interest_rate:15,loan_type_code:'CAR'}}));
  assert.equal(edited.remaining_principal,3000000); assert.equal(edited.remaining_term_months,5); assert.equal(edited.interest_rate,15);
  const schedules=ok(await request(`/payment-schedules?loan_id=${loan.loan_id}`,{auth:secondToken}));
  assert.equal(schedules.length,1); assert.equal(schedules[0].principal_due,600000);
  assert.equal(schedules[0].interest_due,37500);
  assert.equal((await request(`/loans/${loan.loan_id}`,{auth:secondToken,method:'PUT',body:{principal_amount:15000000}})).status,409);
  assert.equal(ok(await request(`/loans/${loan.loan_id}`,{auth:secondToken})).remaining_principal,3000000);
});
test('maturity date stays consistent with the final installment and invalid changes roll back', async () => {
  const loan=ok(await request('/loans',{auth:secondToken,method:'POST',body:{loan_name:'Maturity regression',principal_amount:1200000,interest_rate:12,term_months:3,start_date:'2030-01-01',due_date:'2030-04-15'}}),201);
  let schedules=ok(await request(`/payment-schedules?loan_id=${loan.loan_id}`,{auth:secondToken}));
  assert.equal(schedules.length,1);
  ok(await request(`/loans/${loan.loan_id}`,{auth:secondToken,method:'PUT',body:{due_date:'2030-04-20'}}));
  assert.equal((await request(`/loans/${loan.loan_id}`,{auth:secondToken,method:'PUT',body:{due_date:'2030-02-15'}})).status,400);
  assert.equal(ok(await request(`/loans/${loan.loan_id}`,{auth:secondToken})).due_date.slice(0,10),'2030-04-20');
  schedules=ok(await request(`/payment-schedules?loan_id=${loan.loan_id}`,{auth:secondToken}));
  ok(await request(`/payment-schedules/${schedules[0].schedule_id}/pay`,{auth:secondToken,method:'POST',body:{}}));
  assert.equal((await request(`/loans/${loan.loan_id}`,{auth:secondToken,method:'PUT',body:{due_date:'2030-04-25'}})).status,409);
  // Pay period 2 -> period 3 (final) inherits loan due_date 2030-04-20
  schedules=ok(await request(`/payment-schedules?loan_id=${loan.loan_id}`,{auth:secondToken}));
  ok(await request(`/payment-schedules/${schedules.at(-1).schedule_id}/pay`,{auth:secondToken,method:'POST',body:{}}));
  schedules=ok(await request(`/payment-schedules?loan_id=${loan.loan_id}`,{auth:secondToken}));
  assert.equal(schedules.at(-1).due_date.slice(0,10),'2030-04-20');
});
test('paying or rescheduling the last overdue installment restores ACTIVE and final payment closes debt', async () => {
  const loan=ok(await request('/loans',{auth:secondToken,method:'POST',body:{loan_name:'Overdue regression',principal_amount:3000000,interest_rate:0,term_months:3,start_date:'2030-01-01'}}),201);
  let schedules=ok(await request(`/payment-schedules?loan_id=${loan.loan_id}`,{auth:secondToken}));
  await pool.query("UPDATE payment_schedules SET due_date=CURRENT_DATE-1,status='OVERDUE' WHERE schedule_id=$1",[schedules[0].schedule_id]);
  await pool.query("UPDATE loans SET status='OVERDUE' WHERE loan_id=$1",[loan.loan_id]);
  ok(await request(`/payment-schedules/${schedules[0].schedule_id}/pay`,{auth:secondToken,method:'POST',body:{}}));
  let current=ok(await request(`/loans/${loan.loan_id}`,{auth:secondToken})); assert.equal(current.status,'ACTIVE'); assert.equal(current.remaining_principal,2000000);
  schedules=ok(await request(`/payment-schedules?loan_id=${loan.loan_id}`,{auth:secondToken}));
  const p2 = schedules.find(s=>s.status!=='PAID');
  await pool.query("UPDATE payment_schedules SET due_date=CURRENT_DATE-1,status='OVERDUE' WHERE schedule_id=$1",[p2.schedule_id]);
  await pool.query("UPDATE loans SET status='OVERDUE' WHERE loan_id=$1",[loan.loan_id]);
  const rescheduled=ok(await request(`/payment-schedules/${p2.schedule_id}`,{auth:secondToken,method:'PUT',body:{due_date:'2030-03-05'}}));
  assert.equal(rescheduled.status,'UNPAID'); assert.equal(ok(await request(`/loans/${loan.loan_id}`,{auth:secondToken})).status,'ACTIVE');
  await pool.query("UPDATE loans SET status='OVERDUE' WHERE loan_id=$1",[loan.loan_id]);
  ok(await request('/payment-schedules/sync',{auth:secondToken,method:'POST',body:{}}));
  assert.equal(ok(await request(`/loans/${loan.loan_id}`,{auth:secondToken})).status,'ACTIVE');
  ok(await request(`/payment-schedules/${p2.schedule_id}/pay`,{auth:secondToken,method:'POST',body:{}}));
  schedules=ok(await request(`/payment-schedules?loan_id=${loan.loan_id}`,{auth:secondToken}));
  const p3 = schedules.find(s=>s.status!=='PAID');
  ok(await request(`/payment-schedules/${p3.schedule_id}/pay`,{auth:secondToken,method:'POST',body:{}}));
  current=ok(await request(`/loans/${loan.loan_id}`,{auth:secondToken})); assert.equal(current.status,'CLOSED'); assert.equal(current.remaining_principal,0);
});

test('remaining-term edits regenerate installments while preserving imported debt and first period', async () => {
  const loan=ok(await request('/loans',{auth:secondToken,method:'POST',body:{loan_name:'Remaining term edit',principal_amount:12000000,remaining_principal:3000000,remaining_term_months:5,interest_rate:12,term_months:12,start_date:'2030-01-01'}}),201);
  const edited=ok(await request(`/loans/${loan.loan_id}`,{auth:secondToken,method:'PUT',body:{remaining_term_months:4}}));
  assert.equal(edited.remaining_principal,3000000); assert.equal(edited.remaining_term_months,4); assert.equal(edited.term_months,11);
  let schedules=ok(await request(`/payment-schedules?loan_id=${loan.loan_id}`,{auth:secondToken}));
  assert.equal(schedules.length,1); assert.equal(schedules[0].period_number,8); assert.equal(schedules[0].due_date.slice(0,10),'2030-09-01');
  assert.equal(schedules[0].principal_due,750000); assert.equal(schedules[0].total_due,780000);
  ok(await request(`/loans/${loan.loan_id}`,{auth:secondToken,method:'PUT',body:{remaining_term_months:4}}));
  for (const remaining_term_months of [0,-1,1.5,601]) assert.equal((await request(`/loans/${loan.loan_id}`,{auth:secondToken,method:'PUT',body:{remaining_term_months}})).status,400);
  schedules=ok(await request(`/payment-schedules?loan_id=${loan.loan_id}`,{auth:secondToken}));
  ok(await request(`/payment-schedules/${schedules[0].schedule_id}/pay`,{auth:secondToken,method:'POST',body:{}}));
  assert.equal((await request(`/loans/${loan.loan_id}`,{auth:secondToken,method:'PUT',body:{remaining_term_months:2}})).status,409);
  assert.equal(ok(await request(`/loans/${loan.loan_id}`,{auth:secondToken})).remaining_term_months,3);
});
test('pending loans cannot be paid or produce repayment reminders until activated', async () => {
  const loan=ok(await request('/loans',{auth:secondToken,method:'POST',body:{loan_name:'Pending gating',principal_amount:1200000,interest_rate:0,term_months:3,start_date:'2030-01-01',status:'PENDING'}}),201);
  const schedules=ok(await request(`/payment-schedules?loan_id=${loan.loan_id}`,{auth:secondToken}));
  assert.equal((await request(`/payment-schedules/${schedules[0].schedule_id}/pay`,{auth:secondToken,method:'POST',body:{}})).status,409);
  assert.equal((await pool.query('SELECT * FROM payments WHERE schedule_id=$1',[schedules[0].schedule_id])).rows.length,0);
  assert.equal(ok(await request(`/loans/${loan.loan_id}`,{auth:secondToken})).remaining_principal,1200000);
  ok(await request('/payment-schedules/sync',{auth:secondToken,method:'POST',body:{}}));
  assert.equal((await pool.query("SELECT * FROM notifications WHERE schedule_id=$1 AND status='PENDING'",[schedules[0].schedule_id])).rows.length,0);
  ok(await request(`/loans/${loan.loan_id}`,{auth:secondToken,method:'PUT',body:{status:'ACTIVE'}}));
  ok(await request(`/payment-schedules/${schedules[0].schedule_id}/pay`,{auth:secondToken,method:'POST',body:{}}));
});
test('DTI follows actual next unpaid installment, excludes pending loans and updates after payment', async () => {
  const registration=ok(await request('/auth/register',{auth:null,method:'POST',body:{full_name:'DTI isolated',email:'dti@example.com',password:'Password123!',monthly_income:20000000}}),201);
  ok(await request('/auth/verify-otp',{auth:null,method:'POST',body:{flow_type:'REGISTER',otp:capturedOtp,challenge_token:registration.challenge_token}}));
  const auth=ok(await request('/auth/login',{auth:null,method:'POST',body:{identifier:'dti@example.com',password:'Password123!'}})).accessToken;
  const loan=ok(await request('/loans',{auth,method:'POST',body:{loan_name:'Actual obligation',principal_amount:12000000,remaining_principal:3000000,remaining_term_months:5,interest_rate:12,term_months:12,start_date:'2030-01-01'}}),201);
  const pending=ok(await request('/loans',{auth,method:'POST',body:{loan_name:'Ignored pending',principal_amount:10000000,interest_rate:0,term_months:10,start_date:'2030-01-01',status:'PENDING'}}),201);
  const recalc=()=>request('/credit-profile/recalculate',{auth,method:'POST',body:{}});
  assert.equal(ok(await recalc()).dti_ratio,3.15);
  let schedules=ok(await request(`/payment-schedules?loan_id=${loan.loan_id}`,{auth}));
  ok(await request(`/payment-schedules/${schedules[0].schedule_id}/pay`,{auth,method:'POST',body:{}}));
  assert.equal(ok(await recalc()).dti_ratio,3.12);
  schedules=ok(await request(`/payment-schedules?loan_id=${loan.loan_id}`,{auth}));
  const nextUnpaid=schedules.find(s=>s.status!=='PAID');
  await pool.query('UPDATE payment_schedules SET fee_amount=20000,total_amount=total_amount+20000 WHERE schedule_id=$1',[nextUnpaid.schedule_id]);
  assert.equal(ok(await recalc()).dti_ratio,3.22);
  // A live debt with no schedule is unknown rather than an understated zero obligation.
  await pool.query('DELETE FROM payment_schedules WHERE loan_id=$1',[loan.loan_id]);
  assert.equal(ok(await recalc()).dti_ratio,null);
});
test('session response validates an optional refresh token and OTP resend accepts a temporary challenge', async () => {
  const first=ok(await request('/auth/login',{auth:null,method:'POST',body:{identifier:'binha10k56@gmail.com',password:'123456'}}));
  const second=ok(await request('/auth/login',{auth:null,method:'POST',body:{identifier:'binha10k56@gmail.com',password:'123456'}}));
  const check=async raw=>{
    const res=await fetch(base+'/auth/session',{headers:{Authorization:`Bearer ${first.accessToken}`,...(raw?{'X-Refresh-Token':raw}:{})}});
    return {status:res.status,...await res.json()};
  };
  assert.equal(ok(await check()).refresh_token,null);
  assert.equal(ok(await check(first.refreshToken)).refresh_token,first.refreshToken);
  assert.equal((await check(second.refreshToken)).status,401);
  const reg=ok(await request('/auth/register',{auth:null,method:'POST',body:{full_name:'Resend proof',email:'resend@example.com',password:'Password123!'}}),201);
  await pool.query("UPDATE otp_verifications SET created_at=NOW()-INTERVAL '2 minutes' WHERE user_id=$1",[reg.user_id]);
  const resent=ok(await request('/auth/resend-otp',{auth:reg.challenge_token,method:'POST',body:{}}));
  assert.equal(resent.user_id,reg.user_id);
  assert.equal((await request('/auth/verify-otp',{auth:null,method:'POST',body:{otp:capturedOtp,flow_type:'REGISTER',challenge_token:reg.challenge_token}})).status,400);
  const verified=ok(await request('/auth/verify-otp',{auth:resent.challenge_token,method:'POST',body:{otp:capturedOtp,flow_type:'REGISTER'}}));
  assert.equal(verified.verified,true);
  assert.ok(verified.accessToken);
  assert.equal(ok(await request('/loans',{auth:verified.accessToken})).length,0);
});

test('Vietnam law: Civil Code Art 296 multi-loan collateral, LTV cap, Art 468 rate cap and isolated secured LTV', async () => {
  const fresh=ok(await request('/auth/register',{auth:null,method:'POST',body:{full_name:'VN Law User',email:'vnlaw@example.com',password:'Password123!'}}),201);
  ok(await request('/auth/verify-otp',{auth:fresh.challenge_token,method:'POST',body:{otp:capturedOtp,flow_type:'REGISTER'}}));
  const login=ok(await request('/auth/login',{auth:null,method:'POST',body:{identifier:'vnlaw@example.com',password:'Password123!'}}));
  const auth=login.accessToken;
  ok(await request('/user/profile',{auth,method:'PUT',body:{monthly_income:50000000}}));

  // Điều 468 BLDS 2015: Vay dân sự ngoài TCTD không quá 20%/năm
  assert.equal((await request('/loans',{auth,method:'POST',body:{loan_name:'Vay dân sự vượt trần',loan_type_code:'OTHER',principal_amount:10000000,interest_rate:25,term_months:12,start_date:'2030-01-01'}})).status,400);
  // Vay TCTD > 20%/năm (ví dụ thẻ tín dụng 28%/năm) vẫn hợp lệ
  const card=ok(await request('/loans',{auth,method:'POST',body:{loan_name:'Thẻ tín dụng',lender:'Techcombank',loan_type_code:'CREDIT_CARD',principal_amount:100000000,interest_rate:28,term_months:12,start_date:'2030-01-01'}}),201);
  assert.equal(card.interest_rate,28);

  // Điều 296 BLDS 2015: 1 BĐS 1 tỷ (LTV tối đa 80% = 800tr) bảo đảm cho nhiều khoản vay
  const asset=ok(await request('/collaterals',{auth,method:'POST',body:{asset_name:'Nhà phố Q1',asset_type:'REAL_ESTATE',estimated_value:1000000000,certificate_number:'SH-999'}}),201);
  assert.equal(asset.max_ltv_ratio,0.8);

  // Khoản vay 1: 400tr -> gắn trực tiếp qua collateral_id lúc tạo vay
  const l1=ok(await request('/loans',{auth,method:'POST',body:{loan_name:'Vay mua sửa nhà 1',lender:'Vietcombank',loan_type_code:'MORTGAGE',principal_amount:400000000,interest_rate:8.5,term_months:12,start_date:'2030-01-01',collateral_id:asset.asset_id}}),201);
  assert.equal(l1.collaterals.length,1);
  assert.equal(l1.ltv_ratio,40);

  // Khoản vay 2: 300tr -> liên kết thêm vào cùng tài sản (tổng 700tr <= 800tr)
  const l2=ok(await request('/loans',{auth,method:'POST',body:{loan_name:'Vay tiêu dùng có TSBĐ 2',lender:'Vietcombank',loan_type_code:'MORTGAGE',principal_amount:300000000,interest_rate:9.5,term_months:12,start_date:'2030-01-01',collateral_id:asset.asset_id}}),201);
  assert.equal(l2.collaterals[0].priority_order,2);

  // Khoản vay 3: 200tr -> tổng 900tr > 800tr (80% LTV) -> bị từ chối 400
  const l3=ok(await request('/loans',{auth,method:'POST',body:{loan_name:'Vay vượt LTV',lender:'Vietcombank',loan_type_code:'MORTGAGE',principal_amount:200000000,interest_rate:9.5,term_months:12,start_date:'2030-01-01'}}),201);
  assert.equal((await request(`/collaterals/${asset.asset_id}/link`,{auth,method:'POST',body:{loan_id:l3.loan_id}})).status,400);

  // Kiểm tra sức khỏe tài sản trả về remaining_collateral_capacity = 100tr (800tr - 700tr)
  const listedAssets=ok(await request('/collaterals',{auth}));
  assert.equal(listedAssets[0].total_secured_debt,700000000);
  assert.equal(listedAssets[0].remaining_collateral_capacity,100000000);
  assert.equal(listedAssets[0].linked_loan_ids.length,2);

  // Không được xóa tài sản khi đang bảo đảm cho khoản vay ACTIVE
  assert.equal((await request(`/collaterals/${asset.asset_id}`,{auth,method:'DELETE'})).status,409);

  // LTV tổng chỉ tính trên các khoản có TSBĐ (700tr / 1000tr = 70%), không gộp thẻ tín dụng 100tr và không nhân đôi TSBĐ
  const profile=ok(await request('/credit-profile/recalculate',{auth,method:'POST',body:{}}));
  assert.equal(profile.ltv_ratio,70);
});

test('Notifications & reminders: balance fluctuation, monthly statement and due dispatcher', async () => {
  const { dispatchDueNotifications, generateMonthlyStatements } = await import('../src/services/notification.service.js');
  const fresh=ok(await request('/auth/register',{auth:null,method:'POST',body:{full_name:'Notif User',email:'notif@example.com',password:'Password123!'}}),201);
  ok(await request('/auth/verify-otp',{auth:fresh.challenge_token,method:'POST',body:{otp:capturedOtp,flow_type:'REGISTER'}}));
  const login=ok(await request('/auth/login',{auth:null,method:'POST',body:{identifier:'notif@example.com',password:'Password123!'}}));
  const auth=login.accessToken;

  // Tạo khoản vay ACTIVE -> tự sinh thông báo biến động dư nợ
  const loan=ok(await request('/loans',{auth,method:'POST',body:{loan_name:'Notif Loan',lender:'ACB',loan_type_code:'CONSUMER',principal_amount:12000000,interest_rate:12,term_months:12,start_date:'2026-01-01'}}),201);
  let notifs=ok(await request('/notifications',{auth}));
  assert.ok(notifs.some(n=>n.notification_type==='BALANCE_FLUCTUATION' && n.channel==='PUSH' && n.status==='SENT'));
  assert.ok(notifs.some(n=>n.notification_type==='BALANCE_FLUCTUATION' && n.channel==='PUSH' && n.status==='SENT'));
  assert.equal(notifs.filter(n=>n.notification_type==='BALANCE_FLUCTUATION' && n.channel==='EMAIL').length,0);

  // Đồng bộ nhắc nợ + thanh toán 1 kỳ -> sinh thêm biến động dư nợ
  ok(await request('/payment-schedules/sync',{auth,method:'POST',body:{}}));
  const schedules=ok(await request(`/payment-schedules?loan_id=${loan.loan_id}`,{auth}));
  ok(await request(`/payment-schedules/${schedules[0].schedule_id}/pay`,{auth,method:'POST',body:{}}));
  notifs=ok(await request('/notifications',{auth}));
  assert.equal(notifs.filter(n=>n.notification_type==='BALANCE_FLUCTUATION' && n.channel==='PUSH').length,2);

  // Tắt balance_fluctuation_enabled -> không sinh thêm biến động dư nợ khi tạo khoản mới
  ok(await request('/notifications/preference',{auth,method:'PUT',body:{balance_fluctuation_enabled:false}}));
  ok(await request('/loans',{auth,method:'POST',body:{loan_name:'Silent Loan',lender:'ACB',loan_type_code:'CONSUMER',principal_amount:5000000,interest_rate:10,term_months:5,start_date:'2026-01-01'}}),201);
  notifs=ok(await request('/notifications',{auth}));
  assert.equal(notifs.filter(n=>n.notification_type==='BALANCE_FLUCTUATION' && n.channel==='PUSH').length,2);

  // Ngày 01 hàng tháng -> tạo sao kê định kỳ (idempotent)
  const firstOfMonth = new Date('2026-11-01T00:05:00Z');
  const stmt1 = await generateMonthlyStatements(firstOfMonth);
  assert.ok(stmt1.created >= 1);
  const stmt2 = await generateMonthlyStatements(firstOfMonth);
  assert.equal(stmt2.created, 0);

  // Worker gửi các thông báo đến hạn qua mailer
  const sentEmails = [];
  const dispatchRes = await dispatchDueNotifications(null, { mailer: async mail => { sentEmails.push(mail); } });
  assert.ok(dispatchRes.sent >= 1);
  assert.ok(sentEmails.some(m => m.to === 'notif@example.com' && m.subject.includes('Sao kê tín dụng định kỳ')));

  // Bật lại balance_fluctuation_enabled -> sửa & xóa khoản vay đều sinh thông báo biến động dư nợ
  ok(await request('/notifications/preference',{auth,method:'PUT',body:{balance_fluctuation_enabled:true}}));
  ok(await request(`/loans/${loan.loan_id}`,{auth,method:'PUT',body:{loan_name:'Notif Loan Edited'}}));
  ok(await request(`/loans/${loan.loan_id}`,{auth,method:'DELETE',body:{soft_delete:false}}));
  notifs=ok(await request('/notifications',{auth}));
  assert.ok(notifs.some(n=>n.notification_type==='BALANCE_FLUCTUATION' && n.title.includes('Cập nhật thông tin khoản vay')));
  assert.ok(notifs.some(n=>n.notification_type==='BALANCE_FLUCTUATION' && n.title.includes('Xóa khoản vay')));
});

test('Realtime Socket.IO: revokeSession emits session_revoked to target session room', async () => {
  const login = ok(await request('/auth/login', { auth: null, method: 'POST', body: { identifier: 'binha10k56@gmail.com', password: '123456' } }));
  const sessions = ok(await request('/auth/sessions', { auth: login.accessToken }));
  const current = sessions.find(s => s.is_current);
  assert.ok(current);

  const emitted = [];
  const disconnectedRooms = [];
  const fakeIo = {
    to(room) { return { emit: (event, payload) => emitted.push({ room, event, payload }) }; },
    in(room) { return { disconnectSockets: () => disconnectedRooms.push(room) }; },
  };
  const previousIo = app.get('io');
  app.set('io', fakeIo);
  try {
    ok(await request(`/auth/sessions/${current.id}`, { auth: login.accessToken, method: 'DELETE' }));
    assert.deepEqual(emitted, [{ room: `session_${current.id}`, event: 'session_revoked', payload: { session_id: String(current.id) } }]);
    assert.deepEqual(disconnectedRooms, [`session_${current.id}`]);
  } finally {
    app.set('io', previousIo);
  }
});

test('POST /loans with contract_file_key attaches loan_documents row', async () => {
  const login = ok(await request('/auth/login', { auth: null, method: 'POST', body: { identifier: 'binha10k56@gmail.com', password: '123456' } }));
  const auth = login.accessToken;

  const created = ok(
    await request('/loans', {
      auth,
      method: 'POST',
      body: {
        loan_name: 'Vay cầm cố sổ tiết kiệm VCB',
        lender_name: 'Vietcombank',
        loan_type_code: 'CONSUMER',
        principal_amount: 200000000,
        interest_rate: 7.5,
        term_months: 12,
        start_date: '2026-11-01',
        contract_file_key: 'ocr-scans/1/hd-vcb-2026-1122.jpg',
      },
    }),
    201,
  );

  const docs = ok(await request(`/loans/${created.loan_id}/documents`, { auth }));
  assert.ok(Array.isArray(docs));
  assert.equal(docs.length, 1);
  assert.equal(docs[0].file_url, 'ocr-scans/1/hd-vcb-2026-1122.jpg');
  assert.equal(docs[0].document_type, 'CONTRACT');
  assert.equal(docs[0].ocr_status, 'COMPLETED');

  // Cleanup
  ok(await request(`/loans/${created.loan_id}`, { auth, method: 'DELETE', body: { soft_delete: false } }));
});

test('credit_score is null and risk_level is UNKNOWN when monthly_income is missing, and high LTV elevates risk', async () => {
  const fresh = ok(await request('/auth/register', { auth: null, method: 'POST', body: { full_name: 'Missing Income User', email: 'noincome@example.com', password: 'Password123!' } }), 201);
  ok(await request('/auth/verify-otp', { auth: fresh.challenge_token, method: 'POST', body: { otp: capturedOtp, flow_type: 'REGISTER' } }));
  const login = ok(await request('/auth/login', { auth: null, method: 'POST', body: { identifier: 'noincome@example.com', password: 'Password123!' } }));
  const auth = login.accessToken;

  const asset = ok(await request('/collaterals', { auth, method: 'POST', body: { asset_name: 'Căn hộ test', asset_type: 'REAL_ESTATE', estimated_value: 250000000 } }), 201);
  ok(await request('/loans', { auth, method: 'POST', body: { loan_name: 'Vay thế chấp test', lender: 'Vietcombank', loan_type_code: 'MORTGAGE', principal_amount: 190000000, interest_rate: 9.2, term_months: 120, start_date: '2030-01-01', collateral_id: asset.asset_id } }), 201);

  const missingProfile = ok(await request('/credit-profile/recalculate', { auth, method: 'POST', body: {} }));
  assert.equal(missingProfile.credit_score, null);
  assert.equal(missingProfile.risk_level, 'UNKNOWN');
  assert.equal(missingProfile.ltv_ratio, 76);

  // Khi cập nhật thu nhập (DTI rất thấp), LTV = 76% (> 70%) vẫn nâng risk_level lên MEDIUM
  ok(await request('/user/profile', { auth, method: 'PUT', body: { monthly_income: 100000000 } }));
  const scoredProfile = ok(await request('/credit-profile/recalculate', { auth, method: 'POST', body: {} }));
  assert.ok(scoredProfile.credit_score >= 300 && scoredProfile.credit_score <= 850);
  assert.equal(scoredProfile.risk_level, 'MEDIUM');
});

test('binha10k56@gmail.com seed data recalculates cleanly with consistent DTI, LTV and shared collateral', async () => {
  const login = ok(await request('/auth/login', { auth: null, method: 'POST', body: { identifier: 'binha10k56@gmail.com', password: '123456' } }));
  const auth = login.accessToken;

  const profile = ok(await request('/credit-profile/recalculate', { auth, method: 'POST', body: {} }));
  assert.ok(profile.credit_score !== null && profile.credit_score >= 650);
  assert.ok(profile.dti_ratio > 35 && profile.dti_ratio < 45);
  assert.ok(profile.ltv_ratio > 40 && profile.ltv_ratio < 45);
  assert.equal(profile.credit_utilization_ratio, 25);
  assert.ok(profile.active_loan_count >= 5);
  assert.equal(profile.risk_tier, 'HIGH'); // Có 1 kỳ OVERDUE ở khoản vay 101

  const assets = ok(await request('/collaterals', { auth }));
  const apt = assets.find(a => a.asset_name.includes('Sunrise City'));
  assert.equal(apt.linked_loan_ids.length, 2);
  assert.equal(apt.total_secured_debt, 1330000000);
});

test('DELETE /notifications/:id and DELETE /notifications enforce ownership and remove notifications', async () => {
  const fresh = ok(await request('/auth/register', { auth: null, method: 'POST', body: { full_name: 'Notif Del User', email: 'notifdel@example.com', password: 'Password123!' } }), 201);
  ok(await request('/auth/verify-otp', { auth: fresh.challenge_token, method: 'POST', body: { otp: capturedOtp, flow_type: 'REGISTER' } }));
  const login = ok(await request('/auth/login', { auth: null, method: 'POST', body: { identifier: 'notifdel@example.com', password: 'Password123!' } }));
  const auth = login.accessToken;

  ok(await request('/loans', { auth, method: 'POST', body: { loan_name: 'Notif Del Loan 1', lender: 'ACB', loan_type_code: 'CONSUMER', principal_amount: 10000000, interest_rate: 10, term_months: 10, start_date: '2030-01-01' } }), 201);
  ok(await request('/loans', { auth, method: 'POST', body: { loan_name: 'Notif Del Loan 2', lender: 'ACB', loan_type_code: 'CONSUMER', principal_amount: 10000000, interest_rate: 10, term_months: 10, start_date: '2030-01-01' } }), 201);

  let notifs = ok(await request('/notifications', { auth }));
  assert.equal(notifs.length, 2);

  // User khác không thể xóa thông báo của user này
  assert.equal((await request(`/notifications/${notifs[0].notification_id}`, { auth: secondToken, method: 'DELETE' })).status, 404);

  // Xóa 1 thông báo
  ok(await request(`/notifications/${notifs[0].notification_id}`, { auth, method: 'DELETE' }));
  notifs = ok(await request('/notifications', { auth }));
  assert.equal(notifs.length, 1);

  // Xóa toàn bộ thông báo còn lại
  const cleared = ok(await request('/notifications', { auth, method: 'DELETE' }));
  assert.equal(cleared.deleted_count, 1);
  assert.equal(ok(await request('/notifications', { auth })).length, 0);

  // Khi kỳ quá hạn đã gửi OVERDUE_ALERT rồi bị người dùng xóa khỏi hộp thư, worker không gửi lại email trùng
  const { generateOverdueAlerts } = await import('../src/services/notification.service.js');
  const overdueLoan = ok(await request('/loans', { auth, method: 'POST', body: { loan_name: 'Overdue Dedup Loan', lender: 'ACB', loan_type_code: 'CONSUMER', principal_amount: 10000000, interest_rate: 10, term_months: 10, start_date: '2025-01-01' } }), 201);
  const firstRun = await generateOverdueAlerts();
  assert.ok(firstRun.created >= 2);
  const allNotifs = ok(await request('/notifications', { auth }));
  const overdueAlerts = allNotifs.filter(n => n.notification_type === 'OVERDUE_ALERT');
  assert.ok(overdueAlerts.length >= 2);
  for (const a of overdueAlerts) {
    ok(await request(`/notifications/${a.notification_id}`, { auth, method: 'DELETE' }));
  }
  const secondRun = await generateOverdueAlerts();
  assert.equal(secondRun.created, 0);
  assert.ok(overdueLoan.loan_id);
});

test('markAsPaid automatically generates only the next 1 PENDING installment when loan still has remaining debt', async () => {
  const login = ok(await request('/auth/login', { auth: null, method: 'POST', body: { identifier: 'binha10k56@gmail.com', password: '123456' } }));
  const auth = login.accessToken;

  // Loan 103 in seed starts with PAID periods 1..2 and only 1 PENDING period 3
  let schedules = ok(await request('/payment-schedules?loan_id=103', { auth }));
  const pendingBefore = schedules.filter(s => s.status !== 'PAID');
  assert.equal(pendingBefore.length, 1);
  assert.equal(pendingBefore[0].installment_number, 3);

  // Pay period 3 -> system should compute & insert only period 4 (not all 21 remaining periods)
  ok(await request(`/payment-schedules/${pendingBefore[0].schedule_id}/pay`, { auth, method: 'POST', body: {} }));

  schedules = ok(await request('/payment-schedules?loan_id=103', { auth }));
  const pendingAfter = schedules.filter(s => s.status !== 'PAID');
  assert.equal(pendingAfter.length, 1);
  assert.equal(pendingAfter[0].installment_number, 4);
  assert.equal(pendingAfter[0].principal_amount, 3000000);
  assert.equal(pendingAfter[0].status, 'UNPAID');

  const profile = ok(await request('/credit-profile/recalculate', { auth, method: 'POST', body: {} }));
  assert.ok(profile.dti_ratio !== null && profile.credit_score !== null);
});

test('GET /payment-schedules/summary and paginated status/period filtering work accurately', async () => {
  const login = ok(await request('/auth/login', { auth: null, method: 'POST', body: { identifier: 'binha10k56@gmail.com', password: '123456' } }));
  const auth = login.accessToken;

  const summary = ok(await request('/payment-schedules/summary', { auth }));
  assert.equal(summary.total_count, summary.upcoming_count + summary.overdue_count + summary.paid_count);
  assert.ok(summary.paid_count >= 10);

  // Paginated PAID list with limit=3 -> page 1 & page 2 have no overlap
  const page1 = ok(await request('/payment-schedules?status=PAID&page=1&limit=3', { auth }));
  assert.equal(page1.data.length, 3);
  assert.equal(page1.pagination.page, 1);
  assert.equal(page1.pagination.limit, 3);
  assert.equal(page1.pagination.total, summary.paid_count);
  assert.equal(page1.pagination.has_more, true);
  assert.ok(page1.data.every(s => s.status === 'PAID'));
  assert.deepEqual(page1.summary, summary);

  const page2 = ok(await request('/payment-schedules?status=PAID&page=2&limit=3', { auth }));
  assert.equal(page2.data.length, 3);
  const ids1 = new Set(page1.data.map(s => s.schedule_id));
  assert.ok(page2.data.every(s => !ids1.has(s.schedule_id)));

  // Paginated ALL puts unpaid/overdue items before PAID items
  const allPage1 = ok(await request('/payment-schedules?status=ALL&page=1&limit=20', { auth }));
  assert.equal(allPage1.pagination.total, summary.total_count);
  const firstPaidIdx = allPage1.data.findIndex(s => s.status === 'PAID');
  if (firstPaidIdx > 0) {
    assert.ok(allPage1.data.slice(0, firstPaidIdx).every(s => s.status !== 'PAID'));
  }

  // Period filter & invalid filter validation
  const periodFiltered = ok(await request('/payment-schedules?status=PAID&period=1Y&page=1&limit=5', { auth }));
  assert.ok(periodFiltered.pagination.total <= summary.paid_count);
  assert.equal((await request('/payment-schedules?status=INVALID&page=1&limit=5', { auth })).status, 400);
  assert.equal((await request('/payment-schedules?period=99Y&page=1&limit=5', { auth })).status, 400);
});

test('Settling a loan early zeroes outstanding_amount and removes unpaid schedules', async () => {
  const login = ok(await request('/auth/login', { auth: null, method: 'POST', body: { identifier: 'binha10k56@gmail.com', password: '123456' } }));
  const auth = login.accessToken;

  const settled = ok(await request('/loans/106', { auth, method: 'PUT', body: { status: 'SETTLED', remaining_principal: 0 } }));
  assert.equal(settled.status, 'SETTLED');
  assert.equal(Number(settled.outstanding_amount), 0);
  assert.equal(settled.remaining_term_months, 0);
  assert.equal(settled.next_payment_date, null);

  const schedules = ok(await request('/payment-schedules?loan_id=106', { auth }));
  assert.ok(schedules.every(s => s.status === 'PAID'));
});

test('editLoan: paid loan only allows administrative fields; unpaid loan allows financial & collateral updates', async () => {
  const login = ok(await request('/auth/login', { auth: null, method: 'POST', body: { identifier: 'binha10k56@gmail.com', password: '123456' } }));
  const auth = login.accessToken;

  // Loan 101 has PAID periods -> renaming succeeds, changing collateral or principal fails 409
  const renamed = ok(await request('/loans/101', { auth, method: 'PUT', body: { loan_name: 'VF8 Đã Đổi Tên', lender_name: 'TPBank' } }));
  assert.equal(renamed.loan_name, 'VF8 Đã Đổi Tên');
  assert.equal((await request('/loans/101', { auth, method: 'PUT', body: { collateral_id: 2 } })).status, 409);

  // Settled loan 106 cannot be edited at all
  assert.equal((await request('/loans/106', { auth, method: 'PUT', body: { loan_name: 'Blocked' } })).status, 409);
});
