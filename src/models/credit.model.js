// src/models/credit.model.js — Tương tác CSDL: credit_profiles, credit_reports
// Khớp với schema credit_health_db.sql (Bảng 9, 10)

import { query } from '../config/db.js';

export const CreditProfileModel = {
  async findByUserId(userId) {
    const rows = await query(
      'SELECT * FROM credit_profiles WHERE user_id = $1 LIMIT 1',
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

// =========================================================
// CREDIT REPORT MODEL
// =========================================================
export const CreditReportModel = {
  async findByUserId(userId) {
    return await query(
      'SELECT * FROM credit_reports WHERE user_id = $1 ORDER BY generated_at DESC',
      [userId]
    );
  },

  async findById(reportId, userId) {
    const rows = await query(
      'SELECT * FROM credit_reports WHERE report_id = $1 AND user_id = $2 LIMIT 1',
      [reportId, userId]
    );
    return rows[0] || null;
  },

  async findByPeriod(userId, period) {
    const rows = await query(
      'SELECT * FROM credit_reports WHERE user_id = $1 AND report_period = $2 LIMIT 1',
      [userId, period]
    );
    return rows[0] || null;
  },

  async create(data) {
    const sql = `
      INSERT INTO credit_reports (
        user_id, credit_score, dti_ratio, ltv_ratio, credit_utilization,
        on_time_payment_rate, total_debt, overdue_amount, risk_level, report_period
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    const params = [
      data.user_id,
      data.credit_score,
      data.dti_ratio,
      data.ltv_ratio,
      data.credit_utilization,
      data.on_time_payment_rate,
      data.total_debt || 0,
      data.overdue_amount || 0,
      data.risk_level || 'LOW',
      data.report_period,
    ];
    const rows = await query(sql, params);
    return rows[0];
  },
};
