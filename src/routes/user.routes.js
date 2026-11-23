// src/routes/user.routes.js — Module 1 (tiếp): User Profile & Settings
// Endpoints: /api/v1/user/*

import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { idempotencyMiddleware } from '../middlewares/idempotency.middleware.js';
import * as userController from '../controllers/user.controller.js';

const router = Router();

// Toàn bộ routes user cần xác thực
router.use(authenticateToken);

router.get('/profile',                  userController.getProfile);
router.put('/profile',                  idempotencyMiddleware, userController.updateProfile);
router.put('/security-settings',        idempotencyMiddleware, userController.updateSecuritySettings);
router.get('/financial-profile-pdf',    userController.exportFinancialPdf);
router.post('/ekyc-verify',             idempotencyMiddleware, userController.verifyEkyc);
router.post('/fcm-token',               userController.registerFcmToken);
router.delete('/fcm-token',             userController.unregisterFcmToken);

export default router;
