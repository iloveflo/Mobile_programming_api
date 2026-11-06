// src/services/auth.service.js — Nghiệp vụ Xác thực, Mã hóa & Cấp phát JWT Token
// Phối hợp: UserModel, RefreshTokenModel, OtpModel, bcryptjs, jsonwebtoken

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserModel, RefreshTokenModel, OtpModel } from '../models/user.model.js';
import { createError } from '../middlewares/error.middleware.js';

export const AuthService = {
  /**
   * Đăng ký tài khoản mới & sinh mã OTP 6 số
   */
  async register(data) {
    const existing = await UserModel.findByIdentifier(data.email);
    if (existing) {
      throw createError(409, 'Email này đã được sử dụng trên hệ thống.');
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(data.password, salt);

    const newUser = await UserModel.create({
      ...data,
      password_hash,
    });

    // Sinh mã OTP 6 số lưu bảng otp_verifications
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    await OtpModel.create({
      user_id: newUser.user_id,
      email: newUser.email,
      phone: newUser.phone,
      otp_code: otpCode,
      purpose: 'REGISTER',
      expires_in_seconds: 120,
    });

    console.log(`[OTP REGISTER] Gửi OTP ${otpCode} đến ${newUser.email}`);
    return newUser;
  },

  /**
   * Xác thực mã OTP
   */
  async verifyOtp({ identifier, otp, flow_type }) {
    const result = await OtpModel.verifyLatest({
      identifier,
      otp_code: otp,
      purpose: flow_type || 'REGISTER',
    });

    if (!result.valid) {
      throw createError(400, result.message);
    }

    if (result.otpRecord?.user_id && flow_type === 'REGISTER') {
      await UserModel.activate(result.otpRecord.user_id);
    }

    return true;
  },

  /**
   * Đăng nhập với Email / SĐT / CCCD + Password + Remember Me
   */
  async login({ identifier, password, remember_me = true, clientInfo = {} }) {
    const user = await UserModel.findByIdentifier(identifier);
    if (!user) {
      throw createError(401, 'Tài khoản hoặc mật khẩu không chính xác.');
    }

    // 1. Kiểm tra trạng thái khóa tài khoản
    if (user.is_locked && user.lock_until && new Date(user.lock_until) > new Date()) {
      throw createError(403, 'Tài khoản bị tạm khóa do vi phạm chính sách bảo mật.');
    }

    // 2. Kiểm tra tài khoản đã kích hoạt qua OTP chưa
    if (!user.is_active) {
      throw createError(403, 'Tài khoản chưa được kích hoạt qua OTP.');
    }

    // 3. So khớp mật khẩu qua bcrypt
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      await UserModel.recordFailedLogin(user.user_id, attempts);
      if (attempts >= 5) {
        throw createError(403, 'Tài khoản bị tạm khóa do đăng nhập sai quá 5 lần.');
      }
      throw createError(401, 'Tài khoản hoặc mật khẩu không chính xác.');
    }

    // 4. Reset số lần đăng nhập sai
    await UserModel.resetLoginAttempts(user.user_id);

    // 5. Cấp Access Token (15m) & Refresh Token (30d nếu remember_me, 1d nếu false)
    const accessToken = jwt.sign(
      { user_id: user.user_id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    const refreshDays = remember_me ? 30 : 1;
    const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);
    const refreshTokenStr = `ref_${Date.now()}_${Math.random().toString(36).substring(2)}`;

    await RefreshTokenModel.create({
      user_id: user.user_id,
      token: refreshTokenStr,
      device_name: clientInfo.device_name || 'Mobile Device',
      platform: clientInfo.platform || 'Flutter App',
      ip_address: clientInfo.ip_address || '127.0.0.1',
      location: clientInfo.location || 'Việt Nam',
      expires_at: expiresAt,
    });

    // Không trả password_hash ra ngoài client
    const { password_hash, ...safeUser } = user;

    return {
      token: accessToken,
      accessToken,
      refreshToken: refreshTokenStr,
      user: safeUser,
    };
  },
};
