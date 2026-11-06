// src/routes/credit.routes.js — Module 3: Hồ sơ & Báo cáo Tín dụng
// Endpoints: /api/v1/credit-profile/* và /api/v1/credit-reports/*

import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import * as creditController from '../controllers/credit.controller.js';

const router = Router();

router.use(authenticateToken);

// ----- Credit Profile (/credit-profile) -----
router.get('/',               creditController.getCreditProfile);
router.post('/recalculate',   creditController.recalculate);

// ----- Credit Reports (/credit-reports) -----
router.get('/reports',        creditController.getCreditReports);
router.get('/reports/:id',    creditController.getCreditReportDetail);
router.post('/generate',      creditController.generateCreditReport);

// Khi mount ở /credit-reports
router.get('/',               creditController.getCreditReports);
router.get('/:id',            creditController.getCreditReportDetail);
router.post('/generate',      creditController.generateCreditReport);

export default router;
