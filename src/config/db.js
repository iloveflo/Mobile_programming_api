// src/config/db.js — PostgreSQL Connection Pool + LISTEN/NOTIFY Realtime
// Theo hướng dẫn TaiLieuLamBE.md, Section 5.1

import pkg from 'pg';
const { Pool, types } = pkg;
import dotenv from 'dotenv';
dotenv.config();
// The supplied schema uses TIMESTAMP WITHOUT TIME ZONE. Persist and parse these
// values consistently as UTC, including when Node runs on a Vietnamese desktop.
process.env.TZ = 'UTC';
pkg.defaults.parseInputDatesAsUTC = true;
types.setTypeParser(1114, value => new Date(value.replace(' ', 'T') + 'Z'));
types.setTypeParser(1082, value => value);

// Tự động chuyển đổi PostgreSQL DECIMAL (1700) và BIGINT (20) sang kiểu number trong JS
// Giúp Flutter client không bị lỗi cast: (json['...'] as num).toDouble()
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));
types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));

const pool = new Pool({
  options: '-c timezone=UTC',
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT) || 5432,
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME     || 'credit_health_db',
  max:      Number(process.env.DB_MAX_CLIENTS) || 20,
  idleTimeoutMillis:    30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[POSTGRES POOL ERROR]: Lỗi kết nối CSDL đột ngột:', err);
});

/**
 * Hàm truy vấn rút gọn hỗ trợ async/await chuẩn PostgreSQL.
 * Trả về mảng dòng `rows` trực tiếp.
 * @param {string} text  - Câu lệnh SQL với tham số $1, $2, ...
 * @param {Array}  params - Mảng giá trị tương ứng
 * @returns {Promise<Array>} - Mảng các bản ghi trả về
 */
export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development') {
    console.log('[PG QUERY]:', { text, duration: `${duration}ms`, rows: res.rowCount });
  }
  return res.rows;
}

/**
 * Thực thi một khối lệnh bên trong một Database Transaction (ACID).
 * Tự động BEGIN, COMMIT khi thành công, và tự động ROLLBACK giải phóng client nếu có bất kỳ lỗi nào xảy ra.
 * @param {Function} callback - async (client) => { await client.query(...); }
 * @returns {Promise<any>} - Giá trị trả về từ callback
 */
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Lắng nghe kênh LISTEN/NOTIFY từ PostgreSQL Trigger.
 * Trigger `credit_health_realtime` đã được định nghĩa trong credit_health_db.sql (Section 19).
 * Khi có INSERT/UPDATE/DELETE trên 5 bảng quan trọng, Trigger tự pg_notify()
 * và hàm này sẽ nhận được rồi phát socket.io xuống đúng room của user.
 * @param {import('socket.io').Server} io - Socket.io Server instance
 */
export async function setupRealtimeListener(io) {
  let client; let timer; let stopped = false;
  async function connect() {
    if (stopped) return;
    try {
      client = await pool.connect();
      client.once('error', () => { client.release(true); client = null; if (!stopped) timer = setTimeout(connect, 5000); });
      await client.query('LISTEN credit_health_realtime');
      client.on('notification', async msg => {
        try {
          const payload = JSON.parse(msg.payload);
          const owner = payload.user_id || payload.data?.user_id;
          if (!owner) return;
          // Revalidate each recipient before delivering sensitive financial events.
          const { authenticate } = await import('../services/auth.service.js');
          const sockets = await io.in('user_' + owner).fetchSockets();
          for (const socket of sockets) {
            try { await authenticate(socket.handshake.auth?.token); socket.emit('credit_health_update', payload); }
            catch { socket.disconnect(true); }
          }
        } catch (error) { console.error('[REALTIME]', error.name); }
      });
    } catch (error) {
      if (client) { client.release(true); client = null; }
      console.error('[REALTIME] Connection unavailable; retrying.');
      if (!stopped) timer = setTimeout(connect, 5000);
    }
  }
  await connect();
  return async () => { stopped = true; clearTimeout(timer); if (client) { await client.query('UNLISTEN *'); client.release(); client = null; } };
}
export default pool;
