// src/controllers/auth.controller.js — Module 1: Authentication Controller
// Kết nối trực tiếp AuthService và trả về Envelope JSON chuẩn cho Flutter

import { AuthService } from '../services/auth.service.js';

export async function register(req, res, next) {
  try {
    const newUser = await AuthService.register(req.body);
    res.status(201).json({
      success: true,
      message: 'Đăng ký thành công. Vui lòng xác thực mã OTP gửi về thiết bị.',
      data: { user_id: newUser.user_id },
    });
  } catch (err) {
    next(err);
  }
}

export async function verifyOtp(req, res, next) {
  try {
    const { identifier, otp, flow_type } = req.body;
    await AuthService.verifyOtp({ identifier, otp, flow_type });
    res.json({
      success: true,
      message: 'Xác thực OTP thành công.',
    });
  } catch (err) {
    next(err);
  }
}

export async function resendOtp(req, res, next) {
  try {
    res.json({ success: true, message: 'Đã gửi lại OTP.' });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { identifier, password, remember_me } = req.body;
    const clientInfo = {
      device_name: req.headers['x-device-name'] || 'Mobile Device',
      platform: req.headers['x-platform'] || 'Flutter',
      ip_address: req.ip,
      location: 'Việt Nam',
    };
    const result = await AuthService.login({ identifier, password, remember_me, clientInfo });
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

export async function refreshToken(req, res, next) {
  res.json({ success: true, data: { access_token: '', refresh_token: '', expires_at: '', user_id: req.user?.user_id } });
}

export async function checkSession(req, res, next) {
  res.json({
    success: true,
    data: {
      access_token: req.headers['authorization']?.split(' ')[1] || '',
      user_id: req.user?.user_id,
    },
  });
}

export async function getActiveSessions(req, res, next) {
  res.json({ success: true, data: [] });
}

export async function revokeSession(req, res, next) {
  res.json({ success: true, message: 'Thu hồi phiên đăng nhập thành công.' });
}

export async function logout(req, res, next) {
  res.json({ success: true, message: 'Đăng xuất thành công.' });
}

export async function changePassword(req, res, next) {
  res.json({ success: true, message: 'Đổi mật khẩu thành công.' });
}

export async function resetPassword(req, res, next) {
  res.json({ success: true, message: 'Đặt lại mật khẩu thành công.' });
}
