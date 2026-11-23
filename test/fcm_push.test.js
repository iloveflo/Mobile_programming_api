import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import bcrypt from 'bcryptjs';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'fcm-push-test-secret-only-01234567890123456789';
process.env.RATE_LIMIT_MAX = '10000';
process.env.AUTH_RATE_LIMIT_MAX = '10000';
process.env.OTP_DELIVERY = 'console';
for (const key of ['OCR_PROVIDER_URL', 'EKYC_PROVIDER_URL', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_PUBLIC', 'R2_BUCKET_PRIVATE', 'R2_PUBLIC_DOMAIN']) {
  process.env[key] = '';
}

const { default: pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');
const { setPushSenderForTest, buildFcmMulticastPayload } = await import('../src/services/push.service.js');
const { notifyBalanceFluctuation, dispatchDueNotifications } = await import('../src/services/notification.service.js');

let db;
let server;
let base;
let token1;
let token2;
let user1Id;
let user2Id;
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

async function apiReq(path, { method = 'GET', body, auth = token1 } = {}) {
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
    try { return await query(sql, params); } finally { release(); }
  };
  pool.connect = async () => {
    const release = await lock();
    return { query, release };
  };

  server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const hash = await bcrypt.hash('123456', 10);
  await pool.query("UPDATE users SET password_hash=$1 WHERE email='binha10k56@gmail.com'", [hash]);
  const u1 = await pool.query("SELECT user_id FROM users WHERE email='binha10k56@gmail.com'");
  user1Id = u1.rows[0].user_id;

  const u2 = await pool.query(
    "INSERT INTO users(full_name, email, password_hash, monthly_income, is_ekyc_verified) VALUES('User Two', 'fcm2@test.local', $1, 25000000, true) RETURNING user_id",
    [hash],
  );
  user2Id = u2.rows[0].user_id;

  const login1 = await apiReq('/api/auth/login', {
    method: 'POST',
    auth: null,
    body: { identifier: 'binha10k56@gmail.com', password: '123456' },
  });
  token1 = login1.data.access_token;

  const login2 = await apiReq('/api/auth/login', {
    method: 'POST',
    auth: null,
    body: { identifier: 'fcm2@test.local', password: '123456' },
  });
  token2 = login2.data.access_token;
});

after(async () => {
  setPushSenderForTest(null);
  if (server) {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
  if (db) await db.close();
  await pool.end();
});

test('POST & DELETE /api/user/fcm-token registers, reassigns across users, and unregisters cleanly', async () => {
  const sharedToken = 'fcm-device-token-abc123';

  const r1 = await apiReq('/api/user/fcm-token', {
    method: 'POST',
    auth: token1,
    body: { fcm_token: sharedToken, platform: 'android' },
  });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.user_id, user1Id);

  // Re-login on same device with user2 reassigns token to user2
  const r2 = await apiReq('/api/user/fcm-token', {
    method: 'POST',
    auth: token2,
    body: { fcm_token: sharedToken, platform: 'android' },
  });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.user_id, user2Id);

  const count1 = await pool.query('SELECT COUNT(*)::int AS c FROM device_tokens WHERE user_id=$1', [user1Id]);
  assert.equal(count1.rows[0].c, 0);

  const del = await apiReq('/api/user/fcm-token', {
    method: 'DELETE',
    auth: token2,
    body: { fcm_token: sharedToken },
  });
  assert.equal(del.status, 200);
  assert.equal(del.data.removed, 1);
});

test('FCM push sends high-priority Android notification payload and prunes invalid tokens', async () => {
  const validToken = 'fcm-valid-token-001';
  const staleToken = 'fcm-stale-token-002';

  await apiReq('/api/user/fcm-token', { method: 'POST', auth: token1, body: { fcm_token: validToken, platform: 'android' } });
  await apiReq('/api/user/fcm-token', { method: 'POST', auth: token1, body: { fcm_token: staleToken, platform: 'android' } });

  const sentPayloads = [];
  setPushSenderForTest(async payload => {
    sentPayloads.push(payload);
    return {
      successCount: 1,
      failureCount: 1,
      responses: payload.tokens.map(t =>
        t === staleToken
          ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
          : { success: true, messageId: 'msg-1' },
      ),
    };
  });

  const sch = await pool.query('SELECT schedule_id FROM payment_schedules LIMIT 1');
  const existingScheduleId = sch.rows[0]?.schedule_id ?? null;

  await notifyBalanceFluctuation(user1Id, {
    title: 'Nhắc thanh toán',
    message: 'Kỳ 1 đến hạn hôm nay',
    scheduleId: existingScheduleId,
  });

  assert.equal(sentPayloads.length, 1);
  assert.deepEqual(sentPayloads[0].tokens.sort(), [staleToken, validToken].sort());
  assert.equal(sentPayloads[0].android.priority, 'high');
  assert.equal(sentPayloads[0].android.notification.channelId, 'fincredit_reminders');
  if (existingScheduleId != null) {
    assert.equal(sentPayloads[0].data.scheduleId, String(existingScheduleId));
  }
  assert.equal(sentPayloads[0].data.tabIndex, '2');

  // Stale token was automatically pruned
  const remaining = await pool.query('SELECT fcm_token FROM device_tokens WHERE user_id=$1', [user1Id]);
  assert.deepEqual(remaining.rows.map(r => r.fcm_token), [validToken]);
});

test('dispatchDueNotifications delivers pending PUSH notifications via FCM', async () => {
  await pool.query(
    `INSERT INTO notifications (user_id, notification_type, channel, title, message, scheduled_at, status)
     VALUES ($1, 'PAYMENT_REMINDER', 'PUSH', 'Sắp đến hạn trả nợ', 'Còn 3 ngày đến hạn kỳ 2', NOW() - INTERVAL '1 minute', 'PENDING')`,
    [user1Id],
  );

  const sentPayloads = [];
  setPushSenderForTest(async payload => {
    sentPayloads.push(payload);
    return {
      successCount: payload.tokens.length,
      failureCount: 0,
      responses: payload.tokens.map(() => ({ success: true })),
    };
  });

  const stats = await dispatchDueNotifications(null);
  assert.ok(stats.sent >= 1);
  assert.ok(sentPayloads.some(p => p.notification.title === 'Sắp đến hạn trả nợ'));
});

test('buildFcmMulticastPayload converts all data fields to strings for FCM compatibility', () => {
  const msg = buildFcmMulticastPayload({
    tokens: ['t1'],
    title: 'FinCredit',
    body: 'Body',
    data: { tabIndex: 2, scheduleId: 10, ignored: null },
  });
  assert.deepEqual(msg.data, { tabIndex: '2', scheduleId: '10' });
});
