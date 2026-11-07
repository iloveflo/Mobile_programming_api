// src/app.js — Cấu hình Express App, CORS, Middleware, Routes
// Theo hướng dẫn TaiLieuLamBE.md, Section 5.4

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { query } from './config/db.js';

// Import tất cả Router
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import loanRoutes from './routes/loan.routes.js';
import creditRoutes from './routes/credit.routes.js';
import debtRoutes from './routes/debt.routes.js';
import scheduleRoutes from './routes/schedule.routes.js';
import simulationRoutes from './routes/simulation.routes.js';
import storageRoutes from './routes/storage.routes.js';

dotenv.config();

const app = express();

// =========================================================
// MIDDLEWARE TOÀN CỤC
// =========================================================
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================================================
// MOUNT ROUTES — Prefix chuẩn /api/v1
// =========================================================
const PREFIX = process.env.API_PREFIX || '/api/v1';

// Nhóm Auth & User
app.use(`${PREFIX}/auth`,         authRoutes);
app.use(`${PREFIX}/user`,         userRoutes);

// Nhóm Loans & Collaterals
app.use(`${PREFIX}/loans`,        loanRoutes);
app.use(`${PREFIX}/collaterals`,  loanRoutes);

// Nhóm Credit
app.use(`${PREFIX}/credit-profile`,  creditRoutes);
app.use(`${PREFIX}/credit-reports`,  creditRoutes);

// Nhóm Debt & Simulation
app.use(`${PREFIX}/debt-strategies`, debtRoutes);
app.use(`${PREFIX}/simulations`,     simulationRoutes);

// Nhóm Payment Schedules & Notifications
app.use(`${PREFIX}/payment-schedules`, scheduleRoutes);
app.use(`${PREFIX}/notifications`,     scheduleRoutes);

// Nhóm Storage (Cloudflare R2)
app.use(`${PREFIX}/storage`, storageRoutes);

// =========================================================
// FALLBACK — Tương thích các route gọi /api/* (không có /v1)
// Phục vụ các ApiRepository Flutter đã hardcode /api/auth/...
// =========================================================
app.use('/api/auth',              authRoutes);
app.use('/api/user',              userRoutes);
app.use('/api/loans',             loanRoutes);
app.use('/api/collaterals',       loanRoutes);
app.use('/credit-profile',        creditRoutes);
app.use('/credit-reports',        creditRoutes);
app.use('/debt-strategies',       debtRoutes);
app.use('/simulations',           simulationRoutes);
app.use('/payment-schedules',     scheduleRoutes);
app.use('/notifications',         scheduleRoutes);
app.use('/api/storage',           storageRoutes);

// =========================================================
// ROUTE KIỂM TRA SỨC KHỎE SERVER & DATABASE (Health Check)
// =========================================================
app.get('/', (req, res) => {
  res.json({ success: true, message: 'FinCredit API is running 🚀', version: '1.0.0' });
});

app.get('/health', async (req, res) => {
  try {
    const result = await query('SELECT NOW() as current_time, count(*)::int as total_users FROM users;');
    res.json({
      success: true,
      status: 'healthy',
      database: 'connected',
      db_time: result[0]?.current_time,
      users_count: result[0]?.total_users,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message,
    });
  }
});

// =========================================================
// MIDDLEWARE XỬ LÝ LỖI TẬP TRUNG (đặt cuối cùng)
// =========================================================
app.use((err, req, res, _next) => {
  console.error('[SERVER ERROR]:', err);
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Lỗi xử lý nội bộ máy chủ FinCredit.',
  });
});

export default app;
