// src/models/user.model.js — Bảng users (khớp user_model.dart)
import { query } from '../config/db.js';

export const UserModel = {
  async findById(userId) {
    const rows = await query('SELECT * FROM users WHERE user_id = $1 LIMIT 1', [userId]);
    return rows[0] || null;
  },

  async findByIdentifier(identifier) {
    const sql = `
      SELECT * FROM users 
      WHERE email = $1 OR phone = $1 OR id_card_number = $1 
      LIMIT 1
    `;
    const rows = await query(sql, [identifier]);
    return rows[0] || null;
  },

  async create(userData) {
    const sql = `
      INSERT INTO users (
        full_name, email, phone, password_hash, monthly_income, date_of_birth,
        id_card_number, address, occupation, workplace, contract_type, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, FALSE)
      RETURNING *
    `;
    const params = [
      userData.full_name,
      userData.email,
      userData.phone || null,
      userData.password_hash,
      userData.monthly_income || null,
      userData.date_of_birth || null,
      userData.id_card_number || null,
      userData.address || null,
      userData.occupation || null,
      userData.workplace || null,
      userData.contract_type || null,
    ];
    const rows = await query(sql, params);
    return rows[0];
  },

  async activate(userId) {
    const rows = await query(
      'UPDATE users SET is_active = TRUE, updated_at = NOW() WHERE user_id = $1 RETURNING *',
      [userId]
    );
    return rows[0];
  },

  async updateProfile(userId, data) {
    const sql = `
      UPDATE users SET
        full_name = COALESCE($1, full_name),
        monthly_income = COALESCE($2, monthly_income),
        date_of_birth = COALESCE($3, date_of_birth),
        address = COALESCE($4, address),
        occupation = COALESCE($5, occupation),
        workplace = COALESCE($6, workplace),
        contract_type = COALESCE($7, contract_type),
        avatar_url = COALESCE($8, avatar_url),
        updated_at = NOW()
      WHERE user_id = $9
      RETURNING *
    `;
    const params = [
      data.full_name,
      data.monthly_income,
      data.date_of_birth,
      data.address,
      data.occupation,
      data.workplace,
      data.contract_type,
      data.avatar_url,
      userId,
    ];
    const rows = await query(sql, params);
    return rows[0];
  },

  async updateSecuritySettings(userId, { is_biometric_enabled, auto_lock_enabled }) {
    const sql = `
      UPDATE users SET
        is_biometric_enabled = COALESCE($1, is_biometric_enabled),
        auto_lock_enabled = COALESCE($2, auto_lock_enabled),
        updated_at = NOW()
      WHERE user_id = $3
      RETURNING *
    `;
    const rows = await query(sql, [is_biometric_enabled, auto_lock_enabled, userId]);
    return rows[0];
  },

  async updatePassword(userId, newPasswordHash) {
    await query(
      'UPDATE users SET password_hash = $1, failed_login_attempts = 0, is_locked = FALSE, lock_until = NULL, updated_at = NOW() WHERE user_id = $2',
      [newPasswordHash, userId]
    );
  },

  async recordFailedLogin(userId, attempts, lockMinutes = 15) {
    const isLocked = attempts >= 5;
    const sql = `
      UPDATE users SET
        failed_login_attempts = $1,
        is_locked = $2,
        lock_until = CASE WHEN $2 THEN NOW() + ($3 || ' minutes')::INTERVAL ELSE lock_until END,
        updated_at = NOW()
      WHERE user_id = $4
    `;
    await query(sql, [attempts, isLocked, lockMinutes, userId]);
  },

  async resetLoginAttempts(userId) {
    await query(
      'UPDATE users SET failed_login_attempts = 0, is_locked = FALSE, lock_until = NULL, updated_at = NOW() WHERE user_id = $1',
      [userId]
    );
  },

  async updateEkyc(userId, idCardNumber, tier = 'C06') {
    const sql = `
      UPDATE users SET
        id_card_number = $1,
        is_ekyc_verified = TRUE,
        ekyc_tier = $2,
        updated_at = NOW()
      WHERE user_id = $3
      RETURNING *
    `;
    const rows = await query(sql, [idCardNumber, tier, userId]);
    return rows[0];
  },
};

// Re-export để tương thích ngược với các file đã import cũ
export { BankAccountModel } from './bank-account.model.js';
export { RefreshTokenModel } from './refresh-token.model.js';
export { OtpVerificationModel as OtpModel } from './otp-verification.model.js';
