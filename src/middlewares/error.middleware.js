// src/middlewares/error.middleware.js — Xử lý lỗi tập trung, trả JSON chuẩn

/**
 * Tạo lỗi với HTTP status code tùy chỉnh.
 * Dùng trong Controller: throw createError(404, 'Không tìm thấy khoản vay.')
 */
export function createError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Error-handling middleware Express (4 tham số).
 * Phải được đăng ký CUỐI CÙNG trong app.js.
 */
export function globalErrorHandler(err, req, res, _next) {
  console.error('[SERVER ERROR]:', err.message || err);
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Lỗi xử lý nội bộ máy chủ FinCredit.',
  });
}
