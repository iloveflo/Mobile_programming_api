// src/models/otp-verification.model.js — Bảng otp_verifications (khớp otp_verification_model.dart)
import { query } from '../config/db.js';

export const OtpVerificationModel = {
  async create({ user_id, email, phone, otp_code, purpose, expires_in_seconds = 120 }) {
    const sql = `
      INSERT INTO otp_verifications (
        user_id, email, phone, otp_code, purpose, expires_at
      ) VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' seconds')::INTERVAL)
      RETURNING *
    `;
    const params = [
      user_id || null,
      email || null,
      phone || null,
      otp_code,
      purpose,
      expires_in_seconds,
    ];
    const rows = await query(sql, params);
    return rows[0];
  },

  async verifyLatest({ identifier, otp_code, purpose }) {
    const sql = `
      SELECT * FROM otp_verifications
      WHERE (email = $1 OR phone = $1)
        AND purpose = $2
        AND status = 'PENDING'
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const rows = await query(sql, [identifier, purpose]);
    const otpRecord = rows[0];

    if (!otpRecord) return { valid: false, message: 'Mã OTP không hợp lệ hoặc đã hết hạn.' };

    if (otpRecord.attempt_count >= otpRecord.max_attempts) {
      return { valid: false, message: 'Đã vượt quá số lần thử OTP cho phép.' };
    }

    if (otpRecord.otp_code !== otp_code) {
      await query(
        'UPDATE otp_verifications SET attempt_count = attempt_count + 1 WHERE otp_id = $1',
        [otpRecord.otp_id]
      );
      return { valid: false, message: 'Mã OTP không chính xác.' };
    }

    await query(
      "UPDATE otp_verifications SET status = 'VERIFIED', verified_at = NOW() WHERE otp_id = $1",
      [otpRecord.otp_id]
    );
    return { valid: true, otpRecord };
  },
};
