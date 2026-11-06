// src/routes/schedule.routes.js — Module 5: Lịch Phân kỳ & Thông báo
// Endpoints: /api/v1/payment-schedules/* và /api/v1/notifications/*

import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import * as scheduleController from '../controllers/schedule.controller.js';

const router = Router();

router.use(authenticateToken);

// ----- Payment Schedules (/payment-schedules) -----
router.get('/',                         scheduleController.getSchedules);
router.post('/sync',                    scheduleController.syncSchedules);     // trước /:id
router.get('/:scheduleId',              scheduleController.getScheduleDetail);
router.post('/:scheduleId/pay',         scheduleController.markAsPaid);
router.put('/:scheduleId',              scheduleController.updateSchedule);

// ----- Notifications (/notifications) -----
router.get('/',                         scheduleController.getNotifications);  // Dùng khi mount /notifications
router.get('/preference',               scheduleController.getNotifPreference);
router.put('/preference',               scheduleController.updateNotifPreference);

export default router;
