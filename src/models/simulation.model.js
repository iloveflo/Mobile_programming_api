// src/models/simulation.model.js — Tương tác CSDL: simulations
// Khớp với schema credit_health_db.sql (Bảng 13)

import { query } from '../config/db.js';

export const SimulationModel = {
  async findByUserId(userId) {
    const sql = `
      SELECT s.*, l.loan_name, l.principal_amount, l.interest_rate
      FROM simulations s
      JOIN loans l ON s.loan_id = l.loan_id
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC
    `;
    return await query(sql, [userId]);
  },

  async create(data) {
    const sql = `
      INSERT INTO simulations (
        user_id, loan_id, extra_payment, early_payment_fee,
        estimated_interest, estimated_interest_saved, months_reduced, total_saving,
        scenario_type, scenario_name, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const params = [
      data.user_id,
      data.loan_id,
      data.extra_payment || 0,
      data.early_payment_fee || 0,
      data.estimated_interest || 0,
      data.estimated_interest_saved || 0,
      data.months_reduced || 0,
      data.total_saving || 0,
      data.scenario_type || 'EXTRA_PAYMENT',
      data.scenario_name || null,
      data.status || 'SIMULATION_REFERENCE',
    ];
    const rows = await query(sql, params);
    return rows[0];
  },

  async delete(simulationId, userId) {
    const rows = await query(
      'DELETE FROM simulations WHERE simulation_id = $1 AND user_id = $2 RETURNING *',
      [simulationId, userId]
    );
    return rows.length > 0;
  },
};
