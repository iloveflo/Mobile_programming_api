// src/routes/auth.routes.js — Module 1: Authentication
// Endpoints: /api/v1/auth/* (và fallback /api/auth/*)

import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { requireFields } from '../middlewares/validate.middleware.js';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

// ----- Public routes (không cần token) -----
router.post('/register',        requireFields(['full_name','email','password']), authController.register);
router.post('/verify-otp',      requireFields(['otp','flow_type']),              authController.verifyOtp);
router.post('/resend-otp',      authController.resendOtp);
router.post('/login',           requireFields(['identifier','password']),        authController.login);
router.post('/refresh-token',   authController.refreshToken);
router.post('/reset-password',  requireFields(['new_password']),                 authController.resetPassword);

// ----- Protected routes (cần token) -----
router.use(authenticateToken);

router.get('/session',                      authController.checkSession);
router.get('/sessions',                     authController.getActiveSessions);
router.delete('/sessions/:sessionId',       authController.revokeSession);
router.post('/logout',                      authController.logout);
router.post('/change-password',             requireFields(['current_password','new_password']), authController.changePassword);

export default router;
