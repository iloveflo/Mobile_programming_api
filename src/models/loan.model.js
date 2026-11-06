// src/models/loan.model.js — Bảng loans (khớp loan_model.dart)
import { query } from '../config/db.js';

export const LoanModel = {
  async findByUserId(userId, { status, keyword, lender } = {}) {
    let sql = `
      SELECT l.*, lt.type_code, lt.type_name
      FROM loans l
      JOIN loan_types lt ON l.loan_type_id = lt.loan_type_id
      WHERE l.user_id = $1
    `;
    const params = [userId];

    if (status) {
      params.push(status);
      sql += ` AND l.status = $${params.length}`;
    }

    if (lender) {
      params.push(`%${lender}%`);
      sql += ` AND l.lender_name ILIKE $${params.length}`;
    }

    if (keyword) {
      params.push(`%${keyword}%`);
      sql += ` AND (l.loan_name ILIKE $${params.length} OR l.lender_name ILIKE $${params.length})`;
    }

    sql += ' ORDER BY l.created_at DESC';
    return await query(sql, params);
  },

  async findById(loanId, userId) {
    const sql = `
      SELECT l.*, lt.type_code, lt.type_name
      FROM loans l
      JOIN loan_types lt ON l.loan_type_id = lt.loan_type_id
      WHERE l.loan_id = $1 AND l.user_id = $2
      LIMIT 1
    `;
    const rows = await query(sql, [loanId, userId]);
    return rows[0] || null;
  },

  async create(data) {
    const sql = `
      INSERT INTO loans (
        user_id, loan_type_id, loan_name, lender_name, loan_type,
        principal_amount, interest_rate, interest_method, term_months,
        start_date, end_date, outstanding_amount, early_payment_fee_rate, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;
    const params = [
      data.user_id,
      data.loan_type_id,
      data.loan_name,
      data.lender_name || null,
      data.loan_type || null,
      data.principal_amount,
      data.interest_rate,
      data.interest_method,
      data.term_months,
      data.start_date,
      data.end_date || null,
      data.outstanding_amount || data.principal_amount,
      data.early_payment_fee_rate || 0,
      data.status || 'ACTIVE',
    ];
    const rows = await query(sql, params);
    return rows[0];
  },

  async update(loanId, userId, data) {
    const sql = `
      UPDATE loans SET
        loan_name = COALESCE($1, loan_name),
        lender_name = COALESCE($2, lender_name),
        outstanding_amount = COALESCE($3, outstanding_amount),
        status = COALESCE($4, status),
        updated_at = NOW()
      WHERE loan_id = $5 AND user_id = $6
      RETURNING *
    `;
    const rows = await query(sql, [
      data.loan_name,
      data.lender_name,
      data.outstanding_amount,
      data.status,
      loanId,
      userId,
    ]);
    return rows[0] || null;
  },

  async delete(loanId, userId, softDelete = true) {
    if (softDelete) {
      const rows = await query(
        "UPDATE loans SET status = 'CLOSED', updated_at = NOW() WHERE loan_id = $1 AND user_id = $2 RETURNING *",
        [loanId, userId]
      );
      return rows.length > 0;
    }
    const rows = await query(
      'DELETE FROM loans WHERE loan_id = $1 AND user_id = $2 RETURNING *',
      [loanId, userId]
    );
    return rows.length > 0;
  },
};

// Re-export để tương thích
export { AssetModel } from './asset.model.js';
export { LoanDocumentModel } from './loan-document.model.js';
export { LoanTypeModel } from './loan-type.model.js';
