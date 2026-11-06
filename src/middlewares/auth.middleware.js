// src/middlewares/auth.middleware.js — Xác thực JWT Bearer Token
// Theo hướng dẫn TaiLieuLamBE.md, Section 5.3

import jwt from 'jsonwebtoken';

/**
 * Middleware bảo vệ route — Yêu cầu header: Authorization: Bearer <token>
 * Nếu hợp lệ, gắn thông tin user đã decode vào req.user và gọi next().
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Yêu cầu không có mã xác thực Bearer Token.',
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({
        success: false,
        message: 'Phiên đăng nhập đã hết hạn hoặc token không hợp lệ.',
      });
    }
    req.user = decoded; // { user_id, email, ... }
    next();
  });
}
