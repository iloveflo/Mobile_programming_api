// src/models/notification.model.js — Bảng notifications (khớp notification_model.dart)
import { query } from '../config/db.js';

export const NotificationModel = {
  async findByUserId(userId) {
    return await query(
      'SELECT notification_id, user_id, schedule_id, notification_type, channel, title, message, scheduled_at, sent_at, status, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [userId]
    );
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
