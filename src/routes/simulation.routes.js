// src/routes/simulation.routes.js — Module 6: Mô phỏng Tài chính
// Endpoints: /api/v1/simulations/*

import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { idempotencyMiddleware } from '../middlewares/idempotency.middleware.js';
import * as simulationController from '../controllers/simulation.controller.js';

const router = Router();

router.use(authenticateToken);

router.get('/',                     simulationController.getSimulations);
router.post('/',                    idempotencyMiddleware, simulationController.createSimulation);
router.delete('/:simulationId',     simulationController.deleteSimulation);

export default router;
