import crypto from 'node:crypto';
import { query } from '../config/db.js';
import { one } from '../utils/api.js';

function normalizeRoutePath(req) {
  const combined = `${req.baseUrl || ''}${req.path || ''}`;
  return combined.replace(/^\/api(\/v\d+)?/, '') || '/';
}

function hashBody(body) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(body ?? {}))
    .digest('hex');
}

export async function idempotencyMiddleware(req, res, next) {
  const rawKey = req.get('Idempotency-Key') || req.get('X-Idempotency-Key');
  if (!rawKey) return next();

  const key = String(rawKey).trim();
  if (key.length < 8 || key.length > 128) {
    return res.status(400).json({
      success: false,
      message: 'Idempotency-Key không hợp lệ (độ dài phải từ 8 đến 128 ký tự).',
    });
  }

  const userId = req.user?.user_id;
  if (!userId) return next();

  const method = req.method.toUpperCase();
  const routePath = normalizeRoutePath(req);
  const requestHash = hashBody(req.body);
  const keyParams = [userId, method, routePath, key];

  try {
    // Dọn khóa đã hết hạn (nếu có) trước khi chiếm khóa mới
    await query(
      'DELETE FROM idempotency_keys WHERE user_id=$1 AND method=$2 AND route_path=$3 AND idempotency_key=$4 AND expires_at < NOW()',
      keyParams,
    );

    const inserted = await one(
      `INSERT INTO idempotency_keys (user_id, method, route_path, idempotency_key, request_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, method, route_path, idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [...keyParams, requestHash],
    );

    if (!inserted) {
      const existing = await one(
        'SELECT request_hash, status_code, response_body FROM idempotency_keys WHERE user_id=$1 AND method=$2 AND route_path=$3 AND idempotency_key=$4',
        keyParams,
      );
      if (!existing) {
        return res.status(409).json({
          success: false,
          message: 'Yêu cầu đang được xử lý, vui lòng thử lại sau giây lát.',
        });
      }
      if (existing.request_hash !== requestHash) {
        return res.status(422).json({
          success: false,
          message: 'Idempotency-Key đã được sử dụng cho một nội dung yêu cầu khác.',
        });
      }
      if (existing.status_code === null) {
        return res.status(409).json({
          success: false,
          message: 'Yêu cầu đang được xử lý, vui lòng không gửi trùng lặp.',
        });
      }
      res.set('Idempotency-Replayed', 'true');
      return res.status(existing.status_code).json(existing.response_body);
    }

    const origJson = res.json.bind(res);
    let finalized = false;

    res.on('close', () => {
      if (!finalized) {
        finalized = true;
        query(
          'DELETE FROM idempotency_keys WHERE user_id=$1 AND method=$2 AND route_path=$3 AND idempotency_key=$4 AND status_code IS NULL',
          keyParams,
        ).catch(() => {});
      }
    });

    res.json = body => {
      if (finalized) return origJson(body);
      finalized = true;
      const status = res.statusCode || 200;
      const op = status >= 500
        ? query(
            'DELETE FROM idempotency_keys WHERE user_id=$1 AND method=$2 AND route_path=$3 AND idempotency_key=$4',
            keyParams,
          )
        : query(
            'UPDATE idempotency_keys SET status_code=$1, response_body=$2::jsonb WHERE user_id=$3 AND method=$4 AND route_path=$5 AND idempotency_key=$6',
            [status, JSON.stringify(body ?? null), ...keyParams],
          );
      op.catch(() => {}).finally(() => origJson(body));
      return res;
    };

    return next();
  } catch (err) {
    return next(err);
  }
}
