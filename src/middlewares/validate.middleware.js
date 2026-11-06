// src/middlewares/validate.middleware.js — Validation request body đầu vào

/**
 * Kiểm tra các trường bắt buộc có tồn tại trong req.body không.
 * Dùng: router.post('/register', requireFields(['email','password','full_name']), controller)
 * @param {string[]} fields - Danh sách tên trường bắt buộc
 */
export function requireFields(fields) {
  return (req, res, next) => {
    const missing = fields.filter(
      (f) => req.body[f] === undefined || req.body[f] === null || req.body[f] === ''
    );
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Thiếu các trường bắt buộc: ${missing.join(', ')}.`,
      });
    }
    next();
  };
}
