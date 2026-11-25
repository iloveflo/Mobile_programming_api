import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import bcrypt from 'bcryptjs';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'idempotency-test-secret-only-01234567890123456789';
process.env.RATE_LIMIT_MAX = '10000';
process.env.AUTH_RATE_LIMIT_MAX = '10000';
process.env.OTP_DELIVERY = 'console';
for (const key of ['OCR_PROVIDER_URL', 'EKYC_PROVIDER_URL', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_PUBLIC', 'R2_BUCKET_PRIVATE', 'R2_PUBLIC_DOMAIN']) {
  process.env[key] = '';
}

const { default: pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');

let db;
let server;
let base;
let token1;
let token2;
let user1Id;
let tail = Promise.resolve();

async function lock() {
  const prev = tail;
  let release;
  tail = new Promise(r => { release = r; });
  await prev;
  return release;
}

async function query(sql, params) {
  const r = await db.query(sql, params);
  for (const row of r.rows) {
    for (const field of r.fields) {
      if ([20, 1700].includes(field.dataTypeID) && row[field.name] !== null) {
        row[field.name] = Number(row[field.name]);
      }
    }
  }
  return { ...r, rowCount: r.affectedRows ?? r.rows.length };
}

async function apiReq(path, { method = 'GET', body, auth = token1, idempotencyKey } = {}) {
  const headers = {
    ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
  const res = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: res.status,
    replayed: res.headers.get('idempotency-replayed'),
    ...(await res.json()),
  };
}

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('../credit_health_db.sql', import.meta.url), 'utf8'));
  pool.query = async (sql, params) => {
    const release = await lock();
    try { return await query(sql, params); } finally { release(); }
  };
  pool.connect = async () => {
    const release = await lock();
    return { query, release };
  };

  const hash = await bcrypt.hash('123456', 10);
  await pool.query("UPDATE users SET password_hash=$1 WHERE email='binha10k56@gmail.com'", [hash]);
  const u2 = await pool.query(
    "INSERT INTO users(full_name, email, password_hash, monthly_income, is_ekyc_verified) VALUES('User Two', 'user2@test.local', $1, 30000000, true) RETURNING user_id",
    [hash],
  );
  const u1 = await pool.query("SELECT user_id FROM users WHERE email='binha10k56@gmail.com'");
  user1Id = u1.rows[0].user_id;

  const login1 = await apiReq('/api/auth/login', {
    method: 'POST',
    auth: null,
    body: { identifier: 'binha10k56@gmail.com', password: '123456' },
  });
  token1 = login1.data.access_token;

  const login2 = await apiReq('/api/auth/login', {
    method: 'POST',
    auth: null,
    body: { identifier: 'user2@test.local', password: '123456' },
  });
  token2 = login2.data.access_token;

  assert.ok(u2.rows[0].user_id);
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
  if (db) await db.close();
  await pool.end();
});

// Start server before running tests
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test('POST /api/loans replays identical Idempotency-Key without creating duplicate loans', async () => {
  const beforeLoans = await pool.query('SELECT COUNT(*)::int AS c FROM loans WHERE user_id=$1', [user1Id]);
  const key = 'idem-loan-create-0001';
  const payload = {
    loan_name: 'Vay Idempotent Test',
    lender_name: 'Techcombank',
    loan_type: 'CONSUMER',
    principal_amount: 20000000,
    interest_rate: 12,
    term_months: 12,
    start_date: '2026-10-01',
    interest_method: 'REDUCING_BALANCE',
  };

  const first = await apiReq('/api/loans', { method: 'POST', body: payload, idempotencyKey: key });
  assert.equal(first.status, 201);
  assert.equal(first.replayed, null);

  const second = await apiReq('/api/loans', { method: 'POST', body: payload, idempotencyKey: key });
  assert.equal(second.status, 201);
  assert.equal(second.replayed, 'true');
  assert.equal(second.data.loan_id, first.data.loan_id);

  const afterLoans = await pool.query('SELECT COUNT(*)::int AS c FROM loans WHERE user_id=$1', [user1Id]);
  assert.equal(afterLoans.rows[0].c, beforeLoans.rows[0].c + 1);
});

test('POST /api/loans rejects mismatched payload with same Idempotency-Key (422) and invalid short key (400)', async () => {
  const key = 'idem-loan-mismatch-0001';
  const payload1 = {
    loan_name: 'Vay A',
    lender_name: 'ACB',
    loan_type: 'OTHER',
    principal_amount: 10000000,
    interest_rate: 10,
    term_months: 12,
    start_date: '2026-10-01',
    interest_method: 'REDUCING_BALANCE',
  };
  const payload2 = { ...payload1, principal_amount: 15000000 };

  const res1 = await apiReq('/api/loans', { method: 'POST', body: payload1, idempotencyKey: key });
  assert.equal(res1.status, 201);

  const res2 = await apiReq('/api/loans', { method: 'POST', body: payload2, idempotencyKey: key });
  assert.equal(res2.status, 422);

  const badKey = await apiReq('/api/loans', { method: 'POST', body: payload1, idempotencyKey: 'short' });
  assert.equal(badKey.status, 400);
});

test('POST /api/payment-schedules/:id/pay replays safely with Idempotency-Key', async () => {
  const loanRes = await apiReq('/api/loans', {
    method: 'POST',
    idempotencyKey: 'idem-loan-for-pay-0001',
    body: {
      loan_name: 'Vay Pay Idem',
      lender_name: 'TPBank',
      loan_type: 'OTHER',
      principal_amount: 12000000,
      interest_rate: 12,
      term_months: 12,
      start_date: '2026-10-01',
      interest_method: 'REDUCING_BALANCE',
    },
  });
  assert.equal(loanRes.status, 201);
  const sch = await pool.query('SELECT schedule_id FROM payment_schedules WHERE loan_id=$1 LIMIT 1', [loanRes.data.loan_id]);
  const scheduleId = sch.rows[0].schedule_id;

  const payKey = 'idem-pay-schedule-0001';
  const pay1 = await apiReq(`/api/payment-schedules/${scheduleId}/pay`, { method: 'POST', body: {}, idempotencyKey: payKey });
  assert.equal(pay1.status, 200);
  assert.equal(pay1.replayed, null);

  const pay2 = await apiReq(`/api/payment-schedules/${scheduleId}/pay`, { method: 'POST', body: {}, idempotencyKey: payKey });
  assert.equal(pay2.status, 200);
  assert.equal(pay2.replayed, 'true');

  const paidCount = await pool.query('SELECT COUNT(*)::int AS c FROM payments WHERE schedule_id=$1', [scheduleId]);
  assert.equal(paidCount.rows[0].c, 1);
});

test('POST /api/simulations and user isolation with identical Idempotency-Key', async () => {
  const l1 = await apiReq('/api/loans', {
    method: 'POST',
    auth: token1,
    body: {
      loan_name: 'Loan Sim 1',
      lender_name: 'ACB',
      loan_type: 'OTHER',
      principal_amount: 10000000,
      interest_rate: 10,
      term_months: 12,
      start_date: '2026-10-01',
      interest_method: 'REDUCING_BALANCE',
    },
  });
  const l2 = await apiReq('/api/loans', {
    method: 'POST',
    auth: token2,
    body: {
      loan_name: 'Loan Sim 2',
      lender_name: 'ACB',
      loan_type: 'CONSUMER',
      principal_amount: 10000000,
      interest_rate: 10,
      term_months: 12,
      start_date: '2026-10-01',
      interest_method: 'REDUCING_BALANCE',
    },
  });

  const key = 'idem-sim-shared-0001';
  const body1 = {
    loan_id: l1.data.loan_id,
    scenario_name: 'Mo phong A',
    simulation_type: 'EXTRA_PAYMENT',
    extra_monthly_payment: 2000000,
    lump_sum_payment: 0,
  };
  const body2 = {
    ...body1,
    loan_id: l2.data.loan_id,
  };

  const u1First = await apiReq('/api/simulations', { method: 'POST', auth: token1, body: body1, idempotencyKey: key });
  const u1Second = await apiReq('/api/simulations', { method: 'POST', auth: token1, body: body1, idempotencyKey: key });
  const u2First = await apiReq('/api/simulations', { method: 'POST', auth: token2, body: body2, idempotencyKey: key });

  assert.equal(u1First.status, 201);
  assert.equal(u1Second.status, 201);
  assert.equal(u1Second.replayed, 'true');
  assert.equal(u1Second.data.simulation_id, u1First.data.simulation_id);

  assert.equal(u2First.status, 201);
  assert.equal(u2First.replayed, null);
  assert.notEqual(u2First.data.simulation_id, u1First.data.simulation_id);
});
