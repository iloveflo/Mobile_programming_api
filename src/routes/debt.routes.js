// src/routes/debt.routes.js — Module 4: Chiến lược Tối ưu Nợ
// Endpoints: /api/v1/debt-strategies/*

import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import * as debtController from '../controllers/debt.controller.js';

const router = Router();

router.use(authenticateToken);

router.get('/',                         debtController.getStrategies);
router.get('/active',                   debtController.getActiveStrategy);
router.post('/apply',                   debtController.applyStrategy);
router.patch('/:strategyId/cancel',     debtController.cancelStrategy);

export default router;
