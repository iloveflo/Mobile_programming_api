// src/models/notification.model.js — Bảng notifications (khớp notification_model.dart)
import { query } from '../config/db.js';

export const NotificationModel = {
  async findByUserId(userId, { limit = 50, offset, page } = {}) {
    let sql = `
      SELECT notification_id, user_id, schedule_id, notification_type, channel, title, message, scheduled_at, sent_at, status, created_at
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    const params = [userId];
    const parsedLimit = Math.max(1, parseInt(limit, 10) || 50);
    const parsedOffset = offset !== undefined
      ? Math.max(0, parseInt(offset, 10) || 0)
      : (page ? Math.max(0, (parseInt(page, 10) - 1) * parsedLimit) : 0);
    params.push(parsedLimit, parsedOffset);
    sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    return await query(sql, params);
  },

  async create(data) {
    const sql = `
      INSERT INTO notifications (
        user_id, schedule_id, notification_type, channel, title, message, scheduled_at, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const params = [
      data.user_id,
      data.schedule_id || null,
      data.notification_type,
      data.channel || 'PUSH',
      data.title,
      data.message,
      data.scheduled_at || null,
      data.status || 'PENDING',
    ];
    const rows = await query(sql, params);
    return rows[0];
  },

  async markAsSent(notificationId) {
    const rows = await query(
      "UPDATE notifications SET status = 'SENT', sent_at = NOW() WHERE notification_id = $1 RETURNING *",
      [notificationId]
    );
    return rows[0] || null;
  },
};
