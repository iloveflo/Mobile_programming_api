// src/models/bank-account.model.js — Bảng bank_accounts (khớp bank_account_model.dart)
import { query } from '../config/db.js';

export const BankAccountModel = {
  async findByUserId(userId) {
    return await query(
      'SELECT account_id, user_id, bank_name, account_number, account_holder_name, is_default_disbursal, is_auto_debit, created_at FROM bank_accounts WHERE user_id = $1 ORDER BY is_default_disbursal DESC, created_at DESC',
      [userId]
    );
  },

  async create(data) {
    const sql = `
      INSERT INTO bank_accounts (
        user_id, bank_name, account_number, account_holder_name,
        is_default_disbursal, is_auto_debit
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const rows = await query(sql, [
      data.user_id,
      data.bank_name,
      data.account_number,
      data.account_holder_name,
      data.is_default_disbursal || false,
      data.is_auto_debit || false,
    ]);
    return rows[0];
  },

  async delete(accountId, userId) {
    const rows = await query(
      'DELETE FROM bank_accounts WHERE account_id = $1 AND user_id = $2 RETURNING *',
      [accountId, userId]
    );
    return rows.length > 0;
  },
};
