// src/models/credit-profile.model.js — Bảng credit_profiles (khớp credit_profile_model.dart)
import { query } from '../config/db.js';

export const CreditProfileModel = {
  async findByUserId(userId) {
    const rows = await query(
      'SELECT profile_id, user_id, credit_score, dti_ratio, ltv_ratio, credit_utilization, on_time_payment_rate, active_loan_count, risk_level, updated_at FROM credit_profiles WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    return rows[0] || null;
  },

  async upsert(userId, data) {
    const sql = `
      INSERT INTO credit_profiles (
        user_id, credit_score, dti_ratio, ltv_ratio, credit_utilization,
        on_time_payment_rate, active_loan_count, risk_level
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id) DO UPDATE SET
        credit_score = EXCLUDED.credit_score,
        dti_ratio = EXCLUDED.dti_ratio,
        ltv_ratio = EXCLUDED.ltv_ratio,
        credit_utilization = EXCLUDED.credit_utilization,
        on_time_payment_rate = EXCLUDED.on_time_payment_rate,
        active_loan_count = EXCLUDED.active_loan_count,
        risk_level = EXCLUDED.risk_level,
        updated_at = NOW()
      RETURNING *
    `;
    const params = [
      userId,
      data.credit_score,
      data.dti_ratio,
      data.ltv_ratio,
      data.credit_utilization,
      data.on_time_payment_rate,
      data.active_loan_count || 0,
      data.risk_level || 'LOW',
    ];
    const rows = await query(sql, params);
    return rows[0];
  },
};
