// src/config/r2.js — Cloudflare R2 Client & Presigned URL Generator
// Theo hướng dẫn TaiLieuLamBE.md, Section 5.2 & Module 7

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';
dotenv.config();

export function requireR2() {
  if (!['R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_PUBLIC','R2_BUCKET_PRIVATE','R2_PUBLIC_DOMAIN'].every(k => process.env[k])) {
    const error = new Error('Chưa cấu hình đầy đủ Cloudflare R2.'); error.statusCode = 503; throw error;
  }
}

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/**
 * Sinh Presigned PUT URL để Mobile upload file thẳng lên R2.
 * @param {object} opts
 * @param {string} opts.folder      - Thư mục trong bucket (vd: 'avatars', 'contracts')
 * @param {string} opts.fileName    - Tên file (vd: 'avatar_1710000000.jpg')
 * @param {string} opts.contentType - MIME type (vd: 'image/jpeg', 'application/pdf')
 * @param {boolean} opts.isPublic   - true: bucket public, false: bucket private
 */
export async function generateR2UploadUrl({ folder, fileName, contentType, isPublic }) {
  const bucketName   = isPublic ? process.env.R2_BUCKET_PUBLIC : process.env.R2_BUCKET_PRIVATE;
  const fileKey      = `${folder}/${fileName}`;
  const expiresIn    = Number(process.env.R2_PRESIGNED_UPLOAD_EXPIRES) || 300;
  // Public: CDN Edge cache 1 năm; Private: không cache trên CDN
  const cacheControl = isPublic ? 'public, max-age=31536000, immutable' : 'no-cache, private';

  const command = new PutObjectCommand({
    Bucket:       bucketName,
    Key:          fileKey,
    ContentType:  contentType,
    CacheControl: cacheControl,
  });

  const uploadUrl    = await getSignedUrl(r2Client, command, { expiresIn });
  const publicDomain = process.env.R2_PUBLIC_DOMAIN.replace(/\/$/, '');
  const downloadUrl  = isPublic
    ? `${publicDomain}/${fileKey}`
    : '';

  return {
    upload_url:   uploadUrl,
    file_key:     fileKey,
    download_url: downloadUrl,
    expires_in:   expiresIn,
    http_method:  'PUT',
    headers: {
      'Content-Type':  contentType,
      'Cache-Control': cacheControl,
    },
  };
}

/**
 * Sinh Presigned GET URL để Mobile xem tài liệu riêng tư từ bucket private.
 * Link có thời hạn 10 phút (600s) mặc định.
 * @param {object} opts
 * @param {string} opts.fileKey    - Đường dẫn tương đối trên bucket (vd: 'contracts/101/hop_dong.pdf')
 * @param {number} opts.expiresIn  - Giây, mặc định 600
 */
export async function generateR2ViewUrl({ fileKey, expiresIn = Number(process.env.R2_PRESIGNED_VIEW_EXPIRES) || 600 }) {
  const ttl = Number(expiresIn);
  const command = new GetObjectCommand({
    Bucket:               process.env.R2_BUCKET_PRIVATE,
    Key:                  fileKey,
    // Cho phép thiết bị Mobile cache cục bộ trong thời hạn link, cấm CDN/proxy trung gian lưu cache
    ResponseCacheControl: `private, max-age=${ttl}`,
  });
  return await getSignedUrl(r2Client, command, { expiresIn: ttl });
}

/**
 * Xóa object trên Cloudflare R2 (không làm lỗi luồng chính nếu object không còn).
 */
export async function deleteR2Object({ fileKey, isPublic = false }) {
  if (!fileKey) return;
  try {
    const bucketName = isPublic ? process.env.R2_BUCKET_PUBLIC : process.env.R2_BUCKET_PRIVATE;
    await r2Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: fileKey }));
  } catch {
    // Bỏ qua nếu object đã bị xóa hoặc đang chạy mock test
  }
}
