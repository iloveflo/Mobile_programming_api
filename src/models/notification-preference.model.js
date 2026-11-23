// src/models/notification-preference.model.js — Bảng notification_preferences (khớp notification_preference_model.dart)
import { query } from '../config/db.js';

export const NotificationPreferenceModel = {
  async findByUserId(userId) {
    const rows = await query(
      'SELECT preference_id, user_id, push_enabled, email_enabled, balance_fluctuation_enabled, monthly_statement_enabled, reminder_days, updated_at FROM notification_preferences WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    return rows[0] || null;
  },

  async upsert(userId, data) {
    const sql = `
      INSERT INTO notification_preferences (
        user_id, push_enabled, email_enabled, reminder_days,
        balance_fluctuation_enabled, monthly_statement_enabled
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id) DO UPDATE SET
        push_enabled = EXCLUDED.push_enabled,
        email_enabled = EXCLUDED.email_enabled,
        reminder_days = EXCLUDED.reminder_days,
        balance_fluctuation_enabled = EXCLUDED.balance_fluctuation_enabled,
        monthly_statement_enabled = EXCLUDED.monthly_statement_enabled,
        updated_at = NOW()
      RETURNING *
    `;
    const params = [
      userId,
      data.push_enabled ?? true,
      data.email_enabled ?? true,
      data.reminder_days ?? 3,
      data.balance_fluctuation_enabled ?? true,
      data.monthly_statement_enabled ?? true,
    ];
    const rows = await query(sql, params);
    return rows[0];
  },
};
