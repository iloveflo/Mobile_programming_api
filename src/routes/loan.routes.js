// src/routes/loan.routes.js — Module 2: Khoản vay & Tài sản thế chấp
// Endpoints: /api/v1/loans/* và /api/v1/collaterals/*

import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import * as loanController from '../controllers/loan.controller.js';

const router = Router();

router.use(authenticateToken);

// ----- Loans -----
router.get('/',                     loanController.getLoans);
router.post('/',                    loanController.createLoan);
router.post('/ocr-scan',            loanController.ocrScan);         // Trước :id để tránh conflict
router.get('/:loanId',              loanController.getLoanDetail);
router.put('/:loanId',              loanController.updateLoan);
router.delete('/:loanId',           loanController.deleteLoan);
router.get('/:loanId/assets',       loanController.getLoanAssets);
router.get('/:loanId/documents',    loanController.getLoanDocuments);

// ----- Collaterals (mount cả ở /collaterals) -----
router.post('/collaterals',         loanController.addCollateral);    // Dùng khi mount ở /collaterals
router.post('/',                    loanController.addCollateral);    // Dùng khi mount router.use('/collaterals', loanRoutes)

export default router;
