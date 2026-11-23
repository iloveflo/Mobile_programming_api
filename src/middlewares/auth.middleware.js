import { authenticate } from '../services/auth.service.js';
import { createError } from './error.middleware.js';
export async function authenticateToken(req, res, next) {
  try {
    const match = /^Bearer ([^ ]+)$/i.exec(req.headers.authorization || '');
    if (!match) throw createError(401, 'Yêu cầu Bearer token.');
    req.user = await authenticate(match[1]);
    next();
  } catch (error) { next(error); }
}
