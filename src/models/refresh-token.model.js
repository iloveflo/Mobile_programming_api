// src/models/refresh-token.model.js — Bảng refresh_tokens (khớp refresh_token_model.dart & session_model.dart)
import { query } from '../config/db.js';

export const RefreshTokenModel = {
  async create({ user_id, token, device_name, platform, ip_address, location, expires_at }) {
    const sql = `
      INSERT INTO refresh_tokens (
        user_id, token, device_name, platform, ip_address, location, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const rows = await query(sql, [
      user_id,
      token,
      device_name || null,
      platform || null,
      ip_address || null,
      location || null,
      expires_at,
    ]);
    return rows[0];
  },

  async findValidToken(token) {
    const sql = `
      SELECT * FROM refresh_tokens 
      WHERE token = $1 AND revoked_at IS NULL AND expires_at > NOW() 
      LIMIT 1
    `;
    const rows = await query(sql, [token]);
    return rows[0] || null;
  },

  /**
   * Khớp SessionModel: id, device_name, platform, ip_address, location, last_active, is_current
   */
  async findActiveSessions(userId, currentTokenId = null) {
    const sql = `
      SELECT 
        token_id::text AS id,
        device_name,
        platform,
        ip_address,
        location,
        last_active,
        expires_at,
        CASE WHEN token_id = $2 THEN TRUE ELSE FALSE END AS is_current
      FROM refresh_tokens
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY last_active DESC
    `;
    return await query(sql, [userId, currentTokenId]);
  },

  async revoke(tokenId, userId) {
    await query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_id = $1 AND user_id = $2',
      [tokenId, userId]
    );
  },

  async revokeByToken(token) {
    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token = $1', [token]);
  },
};
