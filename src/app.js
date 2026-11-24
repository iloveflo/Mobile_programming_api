import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';
import { query } from './config/db.js';
import { globalErrorHandler } from './middlewares/error.middleware.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import loanRoutes, { collateralRoutes } from './routes/loan.routes.js';
import creditRoutes, { reportRoutes } from './routes/credit.routes.js';
import debtRoutes from './routes/debt.routes.js';
import scheduleRoutes, { notificationRoutes } from './routes/schedule.routes.js';
import simulationRoutes from './routes/simulation.routes.js';
import storageRoutes from './routes/storage.routes.js';
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY_HOPS) app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
app.use(helmet({ frameguard: { action: 'deny' } }));
const rawCorsOrigin = (process.env.CORS_ORIGIN || '').trim();
const corsOrigin =
  !rawCorsOrigin || (rawCorsOrigin === '*' && process.env.NODE_ENV === 'production')
    ? false
    : rawCorsOrigin === '*'
      ? '*'
      : rawCorsOrigin.split(',').map(x => x.trim()).filter(Boolean);
if (corsOrigin) {
  app.use(cors({ origin: corsOrigin }));
}
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use((req,res,next) => { req.body ??= {}; next(); });
const limitMessage = { success: false, message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' };
app.use(rateLimit({ windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 900000), limit: Number(process.env.RATE_LIMIT_MAX || 300), standardHeaders: 'draft-7', legacyHeaders: false, message: limitMessage }));
const authLimit = rateLimit({ windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 300000), limit: Number(process.env.AUTH_RATE_LIMIT_MAX || 10), standardHeaders: 'draft-7', legacyHeaders: false, message: limitMessage });
const sensitiveActionLimit = rateLimit({ windowMs: Number(process.env.SENSITIVE_RATE_LIMIT_WINDOW_MS || 900000), limit: Number(process.env.SENSITIVE_RATE_LIMIT_MAX || 40), standardHeaders: 'draft-7', legacyHeaders: false, message: limitMessage });
const routes = { auth: authRoutes, user: userRoutes, loans: loanRoutes, collaterals: collateralRoutes, 'credit-profile': creditRoutes, 'credit-reports': reportRoutes, 'debt-strategies': debtRoutes, 'payment-schedules': scheduleRoutes, notifications: notificationRoutes, simulations: simulationRoutes, storage: storageRoutes };
for (const prefix of new Set([process.env.API_PREFIX || '/api/v1', '/api', ''])) {
  app.use(`${prefix}/auth`, authLimit);
  app.use(`${prefix}/storage/presigned-url`, sensitiveActionLimit);
  app.use(`${prefix}/user/ekyc`, sensitiveActionLimit);
  for (const [name, router] of Object.entries(routes)) app.use(`${prefix}/${name}`, router);
}
app.get('/', (req,res) => res.json({ success: true, message: 'FinCredit API is running', version: '1.0.0' }));
app.get('/health', async (req,res) => { try { await query('SELECT 1'); res.json({ success: true, database: 'connected' }); } catch { res.status(503).json({ success: false, message: 'Không kết nối được cơ sở dữ liệu.' }); } });
app.use((req,res) => res.status(404).json({ success: false, message: 'Không tìm thấy endpoint.' }));
app.use(globalErrorHandler);
export default app;
