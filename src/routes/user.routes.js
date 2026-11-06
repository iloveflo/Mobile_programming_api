// src/routes/user.routes.js — Module 1 (tiếp): User Profile & Settings
// Endpoints: /api/v1/user/*

import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import * as userController from '../controllers/user.controller.js';

const router = Router();

// Toàn bộ routes user cần xác thực
router.use(authenticateToken);

router.get('/profile',                  userController.getProfile);
router.put('/profile',                  userController.updateProfile);
router.put('/security-settings',        userController.updateSecuritySettings);
router.get('/financial-profile-pdf',    userController.exportFinancialPdf);
router.post('/ekyc-verify',             userController.verifyEkyc);

// Tài khoản ngân hàng liên kết
router.get('/bank-accounts',            userController.getBankAccounts);
router.post('/bank-accounts',           userController.addBankAccount);
router.delete('/bank-accounts/:id',     userController.deleteBankAccount);

export default router;
