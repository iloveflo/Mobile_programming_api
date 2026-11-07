// src/models/payment-schedule.model.js — Bảng payment_schedules (khớp payment_schedule_model.dart)
import { query } from '../config/db.js';

export const PaymentScheduleModel = {
  async findByFilters({ loan_id, user_id, limit, offset, page } = {}) {
    let sql = `
      SELECT ps.*, l.loan_name, l.lender_name
      FROM payment_schedules ps
      JOIN loans l ON ps.loan_id = l.loan_id
      WHERE 1=1
    `;
    const params = [];

    if (loan_id) {
      params.push(loan_id);
      sql += ` AND ps.loan_id = $${params.length}`;
    }

    if (user_id) {
      params.push(user_id);
      sql += ` AND l.user_id = $${params.length}`;
    }

    sql += ' ORDER BY ps.due_date ASC, ps.installment_number ASC';

    if (limit !== undefined) {
      const parsedLimit = Math.max(1, parseInt(limit, 10) || 50);
      const parsedOffset = offset !== undefined
        ? Math.max(0, parseInt(offset, 10) || 0)
        : (page ? Math.max(0, (parseInt(page, 10) - 1) * parsedLimit) : 0);
      params.push(parsedLimit, parsedOffset);
      sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
    }

    return await query(sql, params);
  },

  async findById(scheduleId) {
    const sql = `
      SELECT ps.*, l.user_id, l.loan_name, l.outstanding_amount
      FROM payment_schedules ps
      JOIN loans l ON ps.loan_id = l.loan_id
      WHERE ps.schedule_id = $1
      LIMIT 1
    `;
    const rows = await query(sql, [scheduleId]);
    return rows[0] || null;
  },

  async create(data) {
    const sql = `
      INSERT INTO payment_schedules (
        loan_id, installment_number, due_date,
        principal_amount, interest_amount, fee_amount,
        total_amount, remaining_balance, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    const params = [
      data.loan_id,
      data.installment_number,
      data.due_date,
      data.principal_amount || 0,
      data.interest_amount || 0,
      data.fee_amount || 0,
      data.total_amount || 0,
      data.remaining_balance || 0,
      data.status || 'PENDING',
    ];
    const rows = await query(sql, params);
    return rows[0];
  },

  async updateStatus(scheduleId, status) {
    const rows = await query(
      'UPDATE payment_schedules SET status = $1 WHERE schedule_id = $2 RETURNING *',
      [status, scheduleId]
    );
    return rows[0] || null;
  },
};
