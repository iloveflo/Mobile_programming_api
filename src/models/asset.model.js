// src/models/asset.model.js — Bảng assets (khớp asset_model.dart và collateral_model.dart)
import { query } from '../config/db.js';

export const AssetModel = {
  async findByUserId(userId) {
    return await query(
      'SELECT asset_id, user_id, loan_id, asset_name, asset_type, asset_value, valuation_date, legal_document_url, image_url, description, created_at FROM assets WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
  },

  async findByLoanId(loanId) {
    return await query(
      'SELECT asset_id, user_id, loan_id, asset_name, asset_type, asset_value, valuation_date, legal_document_url, image_url, description, created_at FROM assets WHERE loan_id = $1 ORDER BY created_at DESC',
      [loanId]
    );
  },

  async create(data) {
    const sql = `
      INSERT INTO assets (
        user_id, loan_id, asset_name, asset_type, asset_value,
        valuation_date, legal_document_url, image_url, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    const params = [
      data.user_id,
      data.loan_id || null,
      data.asset_name,
      data.asset_type,
      data.asset_value,
      data.valuation_date || null,
      data.legal_document_url || null,
      data.image_url || null,
      data.description || null,
    ];
    const rows = await query(sql, params);
    return rows[0];
  },

  async delete(assetId, userId) {
    const rows = await query(
      'DELETE FROM assets WHERE asset_id = $1 AND user_id = $2 RETURNING *',
      [assetId, userId]
    );
    return rows.length > 0;
  },
};
