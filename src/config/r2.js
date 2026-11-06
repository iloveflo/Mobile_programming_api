// src/config/r2.js — Cloudflare R2 Client & Presigned URL Generator
// Theo hướng dẫn TaiLieuLamBE.md, Section 5.2 & Module 7

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';
dotenv.config();

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
  const bucketName = isPublic ? process.env.R2_BUCKET_PUBLIC : process.env.R2_BUCKET_PRIVATE;
  const fileKey    = `${folder}/${fileName}`;
  const expiresIn  = Number(process.env.R2_PRESIGNED_UPLOAD_EXPIRES) || 300;

  const command = new PutObjectCommand({
    Bucket:       bucketName,
    Key:          fileKey,
    ContentType:  contentType,
    // Public: CDN cache 1 năm; Private: không cache
    CacheControl: isPublic ? 'public, max-age=31536000, immutable' : 'no-cache, private',
  });

  const uploadUrl   = await getSignedUrl(r2Client, command, { expiresIn });
  const downloadUrl = isPublic
    ? `${process.env.R2_PUBLIC_DOMAIN}/${fileKey}`
    : '';

  return {
    upload_url:   uploadUrl,
    file_key:     fileKey,
    download_url: downloadUrl,
    expires_in:   expiresIn,
    http_method:  'PUT',
    headers: { 'Content-Type': contentType },
  };
}

/**
 * Sinh Presigned GET URL để Mobile xem tài liệu riêng tư từ bucket private.
 * Link có thời hạn 10 phút (600s) mặc định.
 * @param {object} opts
 * @param {string} opts.fileKey    - Đường dẫn tương đối trên bucket (vd: 'contracts/101/hop_dong.pdf')
 * @param {number} opts.expiresIn  - Giây, mặc định 600
 */
export async function generateR2ViewUrl({ fileKey, expiresIn = 600 }) {
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_PRIVATE,
    Key:    fileKey,
  });
  return await getSignedUrl(r2Client, command, { expiresIn: Number(expiresIn) });
}
