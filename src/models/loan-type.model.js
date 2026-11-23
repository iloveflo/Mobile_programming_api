// src/models/loan-type.model.js — Bảng loan_types (khớp loan_type_model.dart)
import { query } from '../config/db.js';

export const LoanTypeModel = {
  async findAll() {
    return await query('SELECT * FROM loan_types ORDER BY loan_type_id ASC');
  },

  async findById(loanTypeId) {
    const rows = await query('SELECT * FROM loan_types WHERE loan_type_id = $1 LIMIT 1', [loanTypeId]);
    return rows[0] || null;
  },

  async findByCode(typeCode) {
    const rows = await query('SELECT * FROM loan_types WHERE type_code = $1 LIMIT 1', [typeCode]);
    return rows[0] || null;
  },
};
