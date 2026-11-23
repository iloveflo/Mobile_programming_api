export function createError(statusCode, message) { const err = new Error(message); err.statusCode = statusCode; return err; }
export function globalErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const sqlStatus = { '23505': 409, '23503': 400, '23502': 400, '23514': 400, '22P02': 400, '22001': 400, '22003': 400, '22007': 400, '22008': 400 };
  const status = sqlStatus[err.code] || err.statusCode || err.status || 500;
  if (status >= 500) console.error('[SERVER ERROR]', err.code || err.name);
  res.status(status).json({ success: false, message: sqlStatus[err.code] ? (status === 409 ? 'Dữ liệu đã tồn tại.' : 'Dữ liệu đầu vào không hợp lệ.') : status >= 500 && !err.statusCode ? 'Lỗi xử lý nội bộ máy chủ.' : err.message || 'Yêu cầu không hợp lệ.' });
}
