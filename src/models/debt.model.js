// src/models/debt.model.js — Tương tác CSDL: debt_strategies
// Khớp với schema credit_health_db.sql (Bảng 12)

import { query } from '../config/db.js';

export const DebtStrategyModel = {
  async findByUserId(userId) {
    return await query(
      'SELECT * FROM debt_strategies WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
  },

  async findActive(userId) {
    const rows = await query(
      "SELECT * FROM debt_strategies WHERE user_id = $1 AND status = 'ACTIVE' LIMIT 1",
      [userId]
    );
    return rows[0] || null;
  },

  async create(data) {
    // Nếu có chiến lược ACTIVE cũ, chuyển sang INACTIVE
    await query(
      "UPDATE debt_strategies SET status = 'INACTIVE' WHERE user_id = $1 AND status = 'ACTIVE'",
      [data.user_id]
    );

    const sql = `
      INSERT INTO debt_strategies (
        user_id, strategy_type, extra_payment,
        estimated_interest_saved, estimated_months_saved, status
      ) VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
      RETURNING *
    `;
    const params = [
      data.user_id,
      data.strategy_type,
      data.extra_payment || 0,
      data.estimated_interest_saved || 0,
      data.estimated_months_saved || 0,
    ];
    const rows = await query(sql, params);
    return rows[0];
  },

  async cancel(strategyId, userId) {
    const rows = await query(
      "UPDATE debt_strategies SET status = 'CANCELLED' WHERE strategy_id = $1 AND user_id = $2 RETURNING *",
      [strategyId, userId]
    );
    return rows.length > 0;
  },
};
