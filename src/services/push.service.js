import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { query } from '../config/db.js';
import { rows } from '../utils/api.js';

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

let testPushSender = null;

export function setPushSenderForTest(sender) {
  testPushSender = typeof sender === 'function' ? sender : null;
}

function getFirebaseMessaging() {
  if (getApps().length === 0) {
    const rawB64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
    if (!rawB64) return null;
    try {
      const jsonStr = Buffer.from(rawB64, 'base64').toString('utf8');
      const serviceAccount = JSON.parse(jsonStr);
      initializeApp({
        credential: cert(serviceAccount),
      });
    } catch (err) {
      console.error('[FCM INIT ERROR]', err.message);
      return null;
    }
  }
  return getMessaging();
}

export function buildFcmMulticastPayload({ tokens, title, body, data = {} }) {
  const stringData = Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [String(k), String(v)]),
  );
  return {
    tokens,
    notification: {
      title: String(title || 'FinCredit'),
      body: String(body || ''),
    },
    data: stringData,
    android: {
      priority: 'high',
      notification: {
        channelId: 'fincredit_reminders',
        sound: 'default',
      },
    },
    apns: {
      headers: {
        'apns-priority': '10',
      },
      payload: {
        aps: {
          sound: 'default',
        },
      },
    },
  };
}

/**
 * Gửi Push Notification qua Firebase Cloud Messaging (FCM) tới tất cả thiết bị đã đăng ký của user.
 * Tự động xóa các token đã hết hạn / không còn hợp lệ.
 */
export async function sendPushToUser(userId, { title, body, data = {} }, db) {
  if (process.env.NODE_ENV === 'test' && !testPushSender) {
    return { sent: 0, removed: 0 };
  }

  const tokenRows = await rows(
    'SELECT fcm_token FROM device_tokens WHERE user_id=$1',
    [userId],
    db,
  );
  const tokens = tokenRows.map(r => r.fcm_token).filter(Boolean);
  if (tokens.length === 0) return { sent: 0, removed: 0 };

  const payload = buildFcmMulticastPayload({ tokens, title, body, data });

  let result;
  if (testPushSender) {
    result = await testPushSender(payload);
  } else {
    const messaging = getFirebaseMessaging();
    if (!messaging) return { sent: 0, removed: 0 };
    result = await messaging.sendEachForMulticast(payload);
  }

  const invalidTokens = [];
  if (Array.isArray(result?.responses)) {
    result.responses.forEach((resp, idx) => {
      if (!resp.success && INVALID_TOKEN_CODES.has(resp.error?.code)) {
        invalidTokens.push(tokens[idx]);
      }
    });
  }

  if (invalidTokens.length > 0) {
    const runner = db ? db.query.bind(db) : query;
    await runner('DELETE FROM device_tokens WHERE fcm_token = ANY($1)', [invalidTokens]);
  }

  return {
    sent: Number(result?.successCount ?? 0),
    removed: invalidTokens.length,
  };
}
