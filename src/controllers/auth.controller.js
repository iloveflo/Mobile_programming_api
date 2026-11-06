// src/controllers/auth.controller.js — Module 1: Authentication Controller
// Mỗi hàm nhận (req, res, next), gọi service tương ứng, trả response chuẩn JSON.
// TODO: Triển khai logic nghiệp vụ trong auth.service.js

export async function register(req, res, next) {
  // TODO: gọi authService.register(req.body)
  res.status(201).json({ success: true, message: 'Đăng ký thành công. Vui lòng xác thực mã OTP gửi về thiết bị.' });
}

export async function verifyOtp(req, res, next) {
  // TODO: gọi authService.verifyOtp(req.body)
  res.json({ success: true, message: 'Xác thực OTP thành công.' });
}

export async function resendOtp(req, res, next) {
  // TODO: gọi authService.resendOtp(req.body)
  res.json({ success: true, message: 'Đã gửi lại OTP.' });
}

export async function login(req, res, next) {
  // TODO: gọi authService.login(req.body)
  res.json({ success: true, data: { token: '', accessToken: '', refreshToken: '', user: {} } });
}

export async function refreshToken(req, res, next) {
  // TODO: gọi authService.refreshToken(req.body)
  res.json({ success: true, data: { access_token: '', refresh_token: '', expires_at: '', user_id: 0 } });
}

export async function checkSession(req, res, next) {
  // TODO: gọi authService.checkSession(req.user)
  res.json({ success: true, data: { access_token: '', refresh_token: '', expires_at: '', user_id: req.user?.user_id } });
}

export async function getActiveSessions(req, res, next) {
  // TODO: gọi authService.getActiveSessions(req.user.user_id)
  res.json({ success: true, data: [] });
}

export async function revokeSession(req, res, next) {
  // TODO: gọi authService.revokeSession(req.params.sessionId, req.user.user_id)
  res.json({ success: true, message: 'Thu hồi phiên đăng nhập thành công.' });
}

export async function logout(req, res, next) {
  // TODO: gọi authService.logout(req.user.user_id)
  res.json({ success: true, message: 'Đăng xuất thành công.' });
}

export async function changePassword(req, res, next) {
  // TODO: gọi authService.changePassword(req.user.user_id, req.body)
  res.json({ success: true, message: 'Đổi mật khẩu thành công.' });
}

export async function resetPassword(req, res, next) {
  // TODO: gọi authService.resetPassword(req.user, req.body)
  res.json({ success: true, message: 'Đặt lại mật khẩu thành công.' });
}
