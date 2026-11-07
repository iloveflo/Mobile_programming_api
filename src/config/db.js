// src/config/db.js — PostgreSQL Connection Pool + LISTEN/NOTIFY Realtime
// Theo hướng dẫn TaiLieuLamBE.md, Section 5.1

import pkg from 'pg';
const { Pool, types } = pkg;
import dotenv from 'dotenv';
dotenv.config();

// Tự động chuyển đổi PostgreSQL DECIMAL (1700) và BIGINT (20) sang kiểu number trong JS
// Giúp Flutter client không bị lỗi cast: (json['...'] as num).toDouble()
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));
types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));

const pool = new Pool({
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
  try {
    const client = await pool.connect();
    await client.query('LISTEN credit_health_realtime');
    console.log('[PG REALTIME] Đang lắng nghe kênh credit_health_realtime...');

    client.on('notification', (msg) => {
      try {
        const payload = JSON.parse(msg.payload);
        console.log(`[PG REALTIME] ${payload.table}:${payload.action}`);

        // Phát đến room riêng của user nếu payload chứa user_id
        if (payload.data && payload.data.user_id) {
          io.to(`user_${payload.data.user_id}`).emit('credit_health_update', payload);
        } else {
          io.emit('credit_health_update', payload);
        }
      } catch (err) {
        console.error('[REALTIME PARSE ERROR]:', err);
      }
    });

    client.on('error', (err) => {
      console.error('[PG REALTIME CLIENT ERROR]:', err);
    });
  } catch (err) {
    console.error('[PG REALTIME SETUP ERROR]: Không thể kết nối để LISTEN:', err.message);
  }
}

export default pool;
