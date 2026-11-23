import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { idempotencyMiddleware } from '../middlewares/idempotency.middleware.js';
import * as c from '../controllers/credit.controller.js';
const router = Router(); router.use(authenticateToken);
router.get('/', c.getCreditProfile); router.post('/recalculate', idempotencyMiddleware, c.recalculate);
export const reportRoutes = Router(); reportRoutes.use(authenticateToken);
reportRoutes.get('/', c.getCreditReports); reportRoutes.post('/generate', idempotencyMiddleware, c.generateCreditReport); reportRoutes.get('/:id', c.getCreditReportDetail); reportRoutes.delete('/:id', c.deleteCreditReport);
export default router;
