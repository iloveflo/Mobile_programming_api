// src/config/constants.js — Hằng số & Mã lỗi dùng chung toàn hệ thống

export const HTTP_STATUS = {
  OK:                  200,
  CREATED:             201,
  BAD_REQUEST:         400,
  UNAUTHORIZED:        401,
  FORBIDDEN:           403,
  NOT_FOUND:           404,
  CONFLICT:            409,
  UNPROCESSABLE:       422,
  TOO_MANY_REQUESTS:   429,
  INTERNAL_ERROR:      500,
};

export const JWT_EXPIRES = {
  ACCESS:          process.env.JWT_EXPIRES_IN          || '15m',
  REFRESH:         process.env.JWT_REFRESH_EXPIRES_IN  || '7d',
  REFRESH_LONG:    '30d',   // remember_me = true
  REFRESH_SHORT:   '1d',    // remember_me = false
};

export const LOAN_STATUS = {
  ACTIVE:   'ACTIVE',
  CLOSED:   'CLOSED',
  OVERDUE:  'OVERDUE',
  SETTLED:  'SETTLED',
};

export const SCHEDULE_STATUS = {
  PENDING:  'PENDING',
  PAID:     'PAID',
  OVERDUE:  'OVERDUE',
};

export const STRATEGY_TYPE = {
  AVALANCHE: 'AVALANCHE',  // Lãi cao trả trước
  SNOWBALL:  'SNOWBALL',   // Nợ nhỏ trả trước
};

export const OTP_PURPOSE = {
  REGISTER:         'REGISTER',
  RESET_PASSWORD:   'RESET_PASSWORD',
  TRANSACTION:      'TRANSACTION',
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
};

export const NOTIFICATION_CHANNEL = {
  PUSH:  'PUSH',
  EMAIL: 'EMAIL',
  SMS:   'SMS',
};

// Số lần nhập sai mật khẩu tối đa trước khi khóa tài khoản
export const MAX_FAILED_LOGIN = 5;

// Thời gian khóa tài khoản (phút)
export const LOCK_DURATION_MINUTES = 15;

// Tỷ lệ cho vay tối đa trên giá trị tài sản bảo đảm (LTV) theo chuẩn ngân hàng VN (TT 39/2016/TT-NHNN)
export const MAX_LTV_BY_ASSET_TYPE = {
  REAL_ESTATE: 0.80, // Bất động sản: tối đa 80%
  VEHICLE:     0.70, // Phương tiện vận tải / Ô tô: tối đa 70%
  SAVINGS:     0.95, // Sổ tiết kiệm / Giấy tờ có giá: tối đa 95%
  OTHER:       0.70, // Tài sản bảo đảm khác: tối đa 70%
};

// Trần lãi suất vay dân sự theo Điều 468 Bộ luật Dân sự 2015 (20%/năm)
export const CIVIL_MAX_INTEREST_RATE_PCT = 20;

// Trần lãi suất hợp lý cho khoản vay TCTD / thẻ tín dụng
export const TCTD_MAX_INTEREST_RATE_PCT = 100;
