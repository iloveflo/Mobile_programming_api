// src/controllers/storage.controller.js — Module 7: Cloudflare R2 Storage Controller
// Khớp 100% với ApiStorageRepository và TaiLieuLamBE.md (Module 7)

import { generateR2UploadUrl, generateR2ViewUrl } from '../config/r2.js';
import pool from '../config/db.js';

/**
 * Bước 1: Sinh Presigned Upload URL cho Mobile PUT trực tiếp lên Cloudflare R2
 * POST /api/v1/storage/presigned-url
 */
export async function getPresignedUrl(req, res, next) {
  try {
    const { folder, file_name, content_type, is_public = true } = req.body;
    const result = await generateR2UploadUrl({
      folder,
      fileName: file_name,
      contentType: content_type,
      isPublic: is_public,
    });
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Bước 3: Xác nhận đã upload xong lên R2, ghi thông tin vào PostgreSQL
 * POST /api/v1/storage/confirm-upload
 */
export async function confirmUpload(req, res, next) {
  try {
    const { file_key, folder, metadata = {} } = req.body;
    const isPublic = folder.startsWith('avatars') || folder.startsWith('collaterals');

    // Nguyên tắc: Tệp public lưu full CDN URL, tệp private chỉ lưu file_key
    const savedPath = isPublic
      ? `${process.env.R2_PUBLIC_DOMAIN}/${file_key}`
      : file_key;

    if (folder.startsWith('avatars') && metadata.user_id) {
      await pool.query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE user_id = $2', [
        savedPath,
        metadata.user_id,
      ]);
    } else if (folder.startsWith('contracts') && metadata.loan_id) {
      await pool.query(
        'INSERT INTO loan_documents (loan_id, document_type, file_url, ocr_status) VALUES ($1, $2, $3, $4)',
        [metadata.loan_id, metadata.document_type || 'CONTRACT', savedPath, 'PENDING']
      );
    }

    res.json({
      success: true,
      download_url: isPublic ? savedPath : '',
      file_key: file_key,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Bước 4: Lấy Presigned URL xem tài liệu riêng tư (Private Documents)
 * GET /api/v1/storage/view-url?file_key=...&expires_in=600
 */
export async function getViewUrl(req, res, next) {
  try {
    const { file_key, expires_in = 600 } = req.query;
    if (!file_key) {
      return res.status(400).json({ success: false, message: 'Thiếu file_key.' });
    }
    const viewUrl = await generateR2ViewUrl({ fileKey: file_key, expiresIn: Number(expires_in) });
    res.json({
      success: true,
      view_url: viewUrl,
    });
  } catch (err) {
    next(err);
  }
}
