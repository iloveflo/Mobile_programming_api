import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { idempotencyMiddleware } from '../middlewares/idempotency.middleware.js';
import * as c from '../controllers/schedule.controller.js';
const router = Router(); router.use(authenticateToken);
router.get('/', c.getSchedules); router.get('/summary', c.getScheduleSummary); router.post('/sync', c.syncSchedules); router.get('/:scheduleId', c.getScheduleDetail); router.post('/:scheduleId/pay', idempotencyMiddleware, c.markAsPaid); router.put('/:scheduleId', idempotencyMiddleware, c.updateSchedule);
export const notificationRoutes = Router(); notificationRoutes.use(authenticateToken);
notificationRoutes.get('/', c.getNotifications); notificationRoutes.delete('/', c.clearNotifications); notificationRoutes.delete('/:id', c.deleteNotification); notificationRoutes.get('/preference', c.getNotifPreference); notificationRoutes.put('/preference', c.updateNotifPreference);
export default router;
