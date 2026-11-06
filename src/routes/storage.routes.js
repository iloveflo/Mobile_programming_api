// src/routes/storage.routes.js — Module 7: Quản lý tệp Cloudflare R2
// Endpoints: /api/v1/storage/*

import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { requireFields } from '../middlewares/validate.middleware.js';
import * as storageController from '../controllers/storage.controller.js';

const router = Router();

router.use(authenticateToken);

// Bước 1: Xin Presigned Upload URL
router.post('/presigned-url',   requireFields(['folder','file_name','content_type']),  storageController.getPresignedUrl);

// Bước 3: Xác nhận upload xong, lưu vào CSDL
router.post('/confirm-upload',  requireFields(['file_key','folder']),                  storageController.confirmUpload);

// Bước 4: Lấy link xem tài liệu Private
router.get('/view-url',         storageController.getViewUrl);

export default router;
