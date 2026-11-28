import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import bcrypt from 'bcryptjs';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-test-secret-only-01234567890123456789';
process.env.RATE_LIMIT_MAX = '10000';
process.env.AUTH_RATE_LIMIT_MAX = '10000';
process.env.OTP_DELIVERY = 'console';
process.env.CORS_ORIGIN = '';

const r2Env = {
  R2_ENDPOINT: 'https://test.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET_PUBLIC: 'test-public',
  R2_BUCKET_PRIVATE: 'test-private',
  R2_PUBLIC_DOMAIN: 'https://cdn.example.test',
};
Object.assign(process.env, r2Env);

const { default: pool, setupRealtimeListener } = await import('../src/config/db.js');
const { r2Client } = await import('../src/config/r2.js');
const { default: app } = await import('../src/app.js');
const { requireFields } = await import('../src/middlewares/validate.middleware.js');
const { renderOtpEmail, renderNotificationEmail } = await import('../src/utils/email-templates.js');

let db;
let server;
let base;
let token;
let userId;
let tail = Promise.resolve();

async function lock() {
  const prev = tail;
  let release;
  tail = new Promise(r => { release = r; });
  await prev;
  return release;
}

async function pgQuery(sql, params) {
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

async function request(path, { method = 'GET', body, auth = token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json()) };
}

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('../credit_health_db.sql', import.meta.url), 'utf8'));
  pool.query = async (sql, params) => {
    const release = await lock();
    try { return await pgQuery(sql, params); } finally { release(); }
  };
  pool.connect = async () => {
    const release = await lock();
    return { query: pgQuery, release };
  };
  await pool.query("UPDATE users SET password_hash=$1 WHERE email='binha10k56@gmail.com'", [
    await bcrypt.hash('123456', 10),
  ]);
  server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await request('/api/auth/login', {
    method: 'POST',
    auth: null,
    body: {
      identifier: 'binha10k56@gmail.com',
      password: '123456',
      device_name: 'CoverageTest',
      platform: 'Node',
    },
  });
  assert.equal(login.status, 200);
  token = login.data.token;
  userId = login.data.user_id;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
  if (db) await db.close();
  await pool.end();
});

test('validate.middleware requireFields catches missing fields and passes valid body', () => {
  const mw = requireFields(['email', 'password']);
  let statusCode = null;
  let jsonBody = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { jsonBody = body; return this; },
  };
  let calledNext = false;
  mw({ body: { email: 'a@b.com' } }, res, () => { calledNext = true; });
  assert.equal(statusCode, 400);
  assert.equal(jsonBody.success, false);
  assert.equal(calledNext, false);

  mw({ body: { email: 'a@b.com', password: '123' } }, res, () => { calledNext = true; });
  assert.equal(calledNext, true);
});

test('email-templates renders all OTP purposes and notification ledger formats', () => {
  for (const purpose of ['REGISTER', 'RESET_PASSWORD', 'LOGIN_DEVICE']) {
    const mail = renderOtpEmail({ fullName: 'Test <User>', code: '123456', purpose, expiresSeconds: 180 });
    assert.ok(mail.html.includes('123456'));
    assert.ok(mail.text.includes('123456'));
  }

  const samples = [
    ['PAYMENT_REMINDER', 'Nhắc hạn', 'Kỳ 1 hợp đồng Vay mua nhà số tiền 5.000.000 đ sẽ đến hạn vào 30/11/2026'],
    ['PAYMENT_REMINDER', 'Nhắc hạn', 'Ky 2: 2500000 VND'],
    ['BALANCE_FLUCTUATION', 'Giải ngân', 'Khoản vay "Vay mua xe" vừa được ghi nhận với dư nợ 300.000.000 đ'],
    ['BALANCE_FLUCTUATION', 'Thanh toán', 'Đã thanh toán kỳ 1 (Vay mua xe): giảm 5.000.000 đ gốc. Dư nợ còn lại: 295.000.000 đ'],
    ['BALANCE_FLUCTUATION', 'Cập nhật', 'Khoản vay "Vay mua xe" đã được cập nhật. Dư nợ: 290.000.000 đ, lãi suất: 9.5%/năm, kỳ hạn: 36 tháng'],
    ['BALANCE_FLUCTUATION', 'Tất toán', 'Khoản vay "Vay mua xe" đã được đóng / tất toán. Dư nợ trước đó: 290.000.000 đ'],
    ['BALANCE_FLUCTUATION', 'Xóa', 'Khoản vay "Vay mua xe" đã được xóa khỏi hệ thống. Dư nợ trước đó: 290.000.000 đ'],
    ['MONTHLY_STATEMENT', 'Sao kê tháng', '- Tổng dư nợ: 100.000.000 đ\n- Số khoản vay: 2'],
    ['GENERAL', 'Thông báo chung', 'Nội dung thông báo đơn giản'],
  ];

  for (const [type, title, message] of samples) {
    const mail = renderNotificationEmail({
      fullName: 'Nguyễn Văn A',
      title,
      message,
      notificationType: type,
    });
    assert.ok(mail.html.includes('FinCredit'));
    assert.ok(mail.text.length > 0);
  }
});

test('storage.controller full flows: presigned URL validation, magic bytes, avatar/collateral/legal-doc & delete/list', async () => {
  Object.assign(process.env, r2Env);

  // Validation errors on presigned-url
  const badFolder = await request('/api/storage/presigned-url', {
    method: 'POST',
    body: { folder: 'avatars', file_name: 'a.pdf', content_type: 'application/pdf', is_public: true },
  });
  assert.equal(badFolder.status, 400);

  const badPublic = await request('/api/storage/presigned-url', {
    method: 'POST',
    body: { folder: 'avatars', file_name: 'a.jpg', content_type: 'image/jpeg', is_public: false },
  });
  assert.equal(badPublic.status, 400);

  const badName = await request('/api/storage/presigned-url', {
    method: 'POST',
    body: { folder: 'avatars', file_name: '../bad.jpg', content_type: 'image/jpeg', is_public: true },
  });
  assert.equal(badName.status, 400);

  // Mock r2Client.send for PNG, WEBP, PDF, JPEG and error cases
  const origSend = r2Client.send.bind(r2Client);
  let mockContentType = 'image/png';
  let mockContentLength = 1024;
  let mockHeaderBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]);
  let throw404 = false;

  r2Client.send = async cmd => {
    const name = cmd.constructor.name;
    if (name === 'HeadObjectCommand') {
      if (throw404) { const e = new Error('NotFound'); e.$metadata = { httpStatusCode: 404 }; throw e; }
      return { ContentType: mockContentType, ContentLength: mockContentLength };
    }
    if (name === 'GetObjectCommand') {
      return {
        Body: {
          async transformToByteArray() { return mockHeaderBytes; },
        },
      };
    }
    if (name === 'DeleteObjectCommand') return {};
    return origSend(cmd);
  };

  try {
    // 1. PNG avatar upload & confirm (then replace with a second avatar to test old avatar cleanup)
    const up1 = await request('/api/storage/presigned-url', {
      method: 'POST',
      body: { folder: 'avatars', file_name: 'av1.png', content_type: 'image/png', is_public: true },
    });
    assert.equal(up1.status, 200);
    const key1 = up1.data.file_key;

    const conf1 = await request('/api/storage/confirm-upload', {
      method: 'POST',
      body: { file_key: key1, folder: 'avatars' },
    });
    assert.equal(conf1.status, 200);

    // 2. WEBP collateral upload replacing image_url
    const upWebp = await request('/api/storage/presigned-url', {
      method: 'POST',
      body: { folder: 'collaterals', file_name: 'col.webp', content_type: 'image/webp', is_public: true },
    });
    assert.equal(upWebp.status, 200);
    mockContentType = 'image/webp';
    mockHeaderBytes = Buffer.from('RIFF1234WEBP', 'ascii');
    const confWebp = await request('/api/storage/confirm-upload', {
      method: 'POST',
      body: { file_key: upWebp.data.file_key, folder: 'collaterals' },
    });
    assert.equal(confWebp.status, 200);

    // 3. Invalid magic bytes rejected with 400
    const upPdf = await request('/api/storage/presigned-url', {
      method: 'POST',
      body: { folder: 'contracts', file_name: 'hd.pdf', content_type: 'application/pdf', is_public: false },
    });
    assert.equal(upPdf.status, 200);
    mockContentType = 'application/pdf';
    mockHeaderBytes = Buffer.from('NOTAPDF!', 'ascii');
    const badMagic = await request('/api/storage/confirm-upload', {
      method: 'POST',
      body: { file_key: upPdf.data.file_key, folder: 'contracts' },
    });
    assert.equal(badMagic.status, 400);

    // 4. Valid PDF bytes
    mockHeaderBytes = Buffer.from('%PDF-1.7', 'ascii');
    const okPdf = await request('/api/storage/confirm-upload', {
      method: 'POST',
      body: { file_key: upPdf.data.file_key, folder: 'contracts' },
    });
    assert.equal(okPdf.status, 200);

    // 5. listFiles with & without folder filter
    const listAll = await request('/api/storage/files');
    assert.equal(listAll.status, 200);
    assert.ok(listAll.data.length >= 2);

    const listAvatars = await request('/api/storage/files?folder=avatars');
    assert.equal(listAvatars.status, 200);

    // 6. getViewUrl error cases
    const badViewUrl = await request('/api/storage/view-url?file_key=https://evil.com/a.jpg');
    assert.equal(badViewUrl.status, 404);

    // 7. deleteFile
    const delRes = await request(`/api/storage/file?file_key=${encodeURIComponent(key1)}`, {
      method: 'DELETE',
    });
    assert.equal(delRes.status, 200);
    assert.equal(delRes.deleted, true);

    const delMissing = await request('/api/storage/file?file_key=nonexistent/key.jpg', {
      method: 'DELETE',
    });
    assert.equal(delMissing.status, 404);
  } finally {
    r2Client.send = origSend;
  }
});

test('db.setupRealtimeListener handles notifications and stop cleanup', async () => {
  const fakeClient = new EventEmitter();
  fakeClient.query = async () => ({ rows: [] });
  fakeClient.release = () => {};

  const origConnect = pool.connect;
  pool.connect = async () => fakeClient;

  const emitted = [];
  const fakeIo = {
    in() {
      return {
        async fetchSockets() {
          return [{
            handshake: { auth: { token } },
            emit(ev, data) { emitted.push({ ev, data }); },
            disconnect() {},
          }];
        },
      };
    },
  };

  try {
    const stop = await setupRealtimeListener(fakeIo);
    fakeClient.emit('notification', {
      payload: JSON.stringify({ user_id: userId, table: 'loans' }),
    });
    await new Promise(r => setTimeout(r, 50));
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].ev, 'credit_health_update');

    await stop();
  } finally {
    pool.connect = origConnect;
  }
});

test('storage.controller stream body, 404/oversize, asset legal-doc 409 & collateral replace', async () => {
  Object.assign(process.env, r2Env);
  const origSend = r2Client.send.bind(r2Client);

  const assetRes = await request('/api/collaterals', {
    method: 'POST',
    body: {
      asset_name: 'Căn hộ test coverage',
      asset_type: 'REAL_ESTATE',
      estimated_value: 2500000000,
    },
  });
  assert.equal(assetRes.status, 201);
  const assetId = assetRes.data.asset_id;

  let mode = '404_head';
  r2Client.send = async cmd => {
    const name = cmd.constructor.name;
    if (name === 'HeadObjectCommand') {
      if (mode === '404_head') { const e = new Error('NF'); e.$metadata = { httpStatusCode: 404 }; throw e; }
      if (mode === 'oversize') return { ContentType: 'image/jpeg', ContentLength: 999999999 };
      return { ContentType: 'image/jpeg', ContentLength: 100 };
    }
    if (name === 'GetObjectCommand') {
      return {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
        },
        Body: {
          async *[Symbol.asyncIterator]() {
            yield Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
          },
        },
      };
    }
    if (name === 'DeleteObjectCommand') return {};
    return origSend(cmd);
  };

  try {
    const up = await request('/api/storage/presigned-url', {
      method: 'POST',
      body: { folder: 'legal-documents', file_name: 'so_hong.jpg', content_type: 'image/jpeg', is_public: false },
    });
    assert.equal(up.status, 200);
    const key = up.data.file_key;

    // 404 on HeadObject -> 400
    const r404 = await request('/api/storage/confirm-upload', {
      method: 'POST',
      body: { file_key: key, folder: 'legal-documents', metadata: { asset_id: assetId } },
    });
    assert.equal(r404.status, 400);

    // Oversize -> 400
    mode = 'oversize';
    const rBig = await request('/api/storage/confirm-upload', {
      method: 'POST',
      body: { file_key: key, folder: 'legal-documents', metadata: { asset_id: assetId } },
    });
    assert.equal(rBig.status, 400);

    // Valid stream JPEG -> 200
    mode = 'ok';
    const rOk = await request('/api/storage/confirm-upload', {
      method: 'POST',
      body: { file_key: key, folder: 'legal-documents', metadata: { asset_id: assetId } },
    });
    assert.equal(rOk.status, 200);

    // Second legal-document on same asset -> 409 conflict
    const up2 = await request('/api/storage/presigned-url', {
      method: 'POST',
      body: { folder: 'legal-documents', file_name: 'so_hong2.jpg', content_type: 'image/jpeg', is_public: false },
    });
    const r409 = await request('/api/storage/confirm-upload', {
      method: 'POST',
      body: { file_key: up2.data.file_key, folder: 'legal-documents', metadata: { asset_id: assetId } },
    });
    assert.equal(r409.status, 409);

    // Collateral image upload + replace
    const c1 = await request('/api/storage/presigned-url', {
      method: 'POST',
      body: { folder: 'collaterals', file_name: 'img1.jpg', content_type: 'image/jpeg', is_public: true },
    });
    assert.equal((await request('/api/storage/confirm-upload', {
      method: 'POST',
      body: { file_key: c1.data.file_key, folder: 'collaterals', metadata: { asset_id: assetId } },
    })).status, 200);

    const c2 = await request('/api/storage/presigned-url', {
      method: 'POST',
      body: { folder: 'collaterals', file_name: 'img2.jpg', content_type: 'image/jpeg', is_public: true },
    });
    assert.equal((await request('/api/storage/confirm-upload', {
      method: 'POST',
      body: { file_key: c2.data.file_key, folder: 'collaterals', metadata: { asset_id: assetId } },
    })).status, 200);
  } finally {
    r2Client.send = origSend;
  }
});

test('user.controller eKYC verified profile guard & auth.service SMTP missing guard', async () => {
  await pool.query('UPDATE users SET is_ekyc_verified=TRUE WHERE user_id=$1', [userId]);
  const blocked = await request('/api/user/profile', {
    method: 'PUT',
    body: { full_name: 'Cannot Change Name' },
  });
  assert.equal(blocked.status, 403);
  await pool.query('UPDATE users SET is_ekyc_verified=FALSE WHERE user_id=$1', [userId]);

  const { deliverOtp, checkUser } = await import('../src/services/auth.service.js');
  assert.throws(() => checkUser(null), { statusCode: 401 });
  assert.throws(() => checkUser({ is_locked: true }), { statusCode: 403 });
  assert.throws(() => checkUser({ is_locked: false, is_active: false }), { statusCode: 403 });

  const prevDelivery = process.env.OTP_DELIVERY;
  const prevHost = process.env.SMTP_HOST;
  process.env.OTP_DELIVERY = 'smtp';
  process.env.SMTP_HOST = '';
  try {
    await assert.rejects(
      () => deliverOtp({ email: 'a@b.com', full_name: 'Test' }, '123456'),
      { statusCode: 503 },
    );
  } finally {
    process.env.OTP_DELIVERY = prevDelivery;
    process.env.SMTP_HOST = prevHost;
  }
});

test('sensitiveActionLimit (40/15m) applies to /api/v1/user/ekyc-verify and returns 429 when exceeded', async () => {
  const firstRes = await fetch(`${base}/api/v1/user/ekyc-verify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id_card_number: 'invalid' }),
  });
  const policy = firstRes.headers.get('ratelimit-policy') || '';
  assert.match(policy, /^40;/);

  let got429 = false;
  for (let i = 0; i < 45; i++) {
    const r = await fetch(`${base}/api/v1/user/ekyc-verify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id_card_number: 'invalid' }),
    });
    if (r.status === 429) {
      got429 = true;
      const body = await r.json();
      assert.equal(body.success, false);
      break;
    }
  }
  assert.equal(got429, true);
});

test('Refresh Token Reuse Detection: reusing rotated refresh token revokes active session immediately', async () => {
  const loginRes = await request('/api/auth/login', {
    method: 'POST',
    auth: null,
    body: {
      identifier: 'binha10k56@gmail.com',
      password: '123456',
      device_name: 'ReuseTestDevice',
      platform: 'Node',
    },
  });
  assert.equal(loginRes.status, 200);
  const refresh1 = loginRes.data.refresh_token;

  // Normal rotation: refresh1 -> refresh2
  const rotRes = await request('/api/auth/refresh-token', {
    method: 'POST',
    auth: null,
    body: { refreshToken: refresh1 },
  });
  assert.equal(rotRes.status, 200);
  const access2 = rotRes.data.access_token;
  const refresh2 = rotRes.data.refresh_token;
  assert.notEqual(refresh2, refresh1);

  // Attacker reuses refresh1 -> 401 and revokes the entire session
  const reuseRes = await request('/api/auth/refresh-token', {
    method: 'POST',
    auth: null,
    body: { refreshToken: refresh1 },
  });
  assert.equal(reuseRes.status, 401);

  // Both refresh2 and access2 are now revoked
  const afterReuseRefresh = await request('/api/auth/refresh-token', {
    method: 'POST',
    auth: null,
    body: { refreshToken: refresh2 },
  });
  assert.equal(afterReuseRefresh.status, 401);

  const afterReuseAccess = await request('/api/auth/session', {
    method: 'GET',
    auth: access2,
  });
  assert.equal(afterReuseAccess.status, 401);
});
