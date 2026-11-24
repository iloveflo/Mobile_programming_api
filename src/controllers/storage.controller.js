import { randomUUID } from 'node:crypto';
import { HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { generateR2UploadUrl, generateR2ViewUrl, deleteR2Object, r2Client, requireR2 } from '../config/r2.js';
import { rows, one, found, insert, text, choice, number, fail } from '../utils/api.js';
import { ownedLoan } from '../services/loan.service.js';
import { withTransaction } from '../config/db.js';
const publicFolders = ['avatars','collaterals'];
const folders = [...publicFolders,'contracts','legal-documents','ekyc','payslips'];
const wrap = fn => async (req,res,next) => { try { res.json({ success: true, ...await fn(req) }); } catch(e) { next(e); } };

async function readHeadBytes(body, maxBytes = 32) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body.subarray(0, maxBytes);
  if (body instanceof Uint8Array) return Buffer.from(body.subarray(0, maxBytes));
  if (typeof body.transformToByteArray === 'function') {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr.subarray(0, maxBytes));
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buf);
    total += buf.length;
    if (total >= maxBytes) break;
  }
  return Buffer.concat(chunks).subarray(0, maxBytes);
}

function matchesMagicBytes(buf, contentType) {
  if (!buf || buf.length < 4) return false;
  switch (contentType) {
    case 'image/jpeg':
      return buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    case 'image/png':
      return (
        buf.length >= 8 &&
        buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
        buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A
      );
    case 'image/webp':
      return (
        buf.length >= 12 &&
        buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buf.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    case 'application/pdf':
      return buf.subarray(0, 4).toString('ascii') === '%PDF';
    default:
      return false;
  }
}
export const getPresignedUrl = wrap(async req => {
  requireR2();
  const folder = choice(req.body.folder, 'folder', folders);
  const isPublic = publicFolders.includes(folder);
  if (req.body.is_public !== undefined && req.body.is_public !== isPublic) fail(400, 'Loại bucket không phù hợp với thư mục.');
  const name = text(req.body.file_name, 'file_name', 150);
  if (!/^[\p{L}\p{N}_. -]+$/u.test(name) || name.includes('..')) fail(400, 'Tên tệp không hợp lệ.');
  const contentType = choice(req.body.content_type, 'content_type', ['image/jpeg','image/png','image/webp','application/pdf']);
  if (folder === 'avatars' && contentType === 'application/pdf') fail(400, 'Ảnh đại diện phải là tệp ảnh.');
  const result = await generateR2UploadUrl({ folder: `${folder}/${req.user.user_id}`, fileName: `${randomUUID()}_${name}`, contentType, isPublic });
  await insert('storage_uploads', { user_id: req.user.user_id, file_key: result.file_key, folder, is_public: isPublic, content_type: contentType });
  return { data: result };
});
export const confirmUpload = wrap(async req => {
  requireR2();
  const key = text(req.body.file_key, 'file_key', 500);
  const file = found(await one('SELECT * FROM storage_uploads WHERE file_key=$1 AND user_id=$2', [key, req.user.user_id]));
  if (req.body.folder !== file.folder) fail(400, 'Thư mục không khớp tệp tải lên.');
  const meta = req.body.metadata || {};
  if (meta.user_id !== undefined && String(meta.user_id) !== String(req.user.user_id)) fail(403, 'Không có quyền cập nhật người dùng khác.');
  // One HEAD + 32-byte magic-byte check at confirmation validates upload completion and real file type.
  if (!file.confirmed_at) {
    const bucket = file.is_public ? process.env.R2_BUCKET_PUBLIC : process.env.R2_BUCKET_PRIVATE;
    let object;
    try { object = await r2Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); }
    catch (e) { if (e.$metadata?.httpStatusCode === 404) fail(400, 'Tệp chưa được tải lên R2.'); throw e; }
    if (object.ContentType !== file.content_type || !object.ContentLength || object.ContentLength > Number(process.env.MAX_UPLOAD_BYTES || 10485760)) {
      await deleteR2Object({ fileKey: key, isPublic: file.is_public });
      fail(400, 'Tệp không đúng định dạng hoặc vượt dung lượng cho phép.');
    }
    let headObj;
    try {
      headObj = await r2Client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-31' }));
    } catch (e) {
      if (e.$metadata?.httpStatusCode === 404) fail(400, 'Tệp chưa được tải lên R2.');
      throw e;
    }
    const headerBytes = await readHeadBytes(headObj?.Body, 32);
    if (!matchesMagicBytes(headerBytes, file.content_type)) {
      await deleteR2Object({ fileKey: key, isPublic: file.is_public });
      fail(400, 'Nội dung tệp không khớp với định dạng đã khai báo.');
    }
  }
  const saved = file.is_public ? `${process.env.R2_PUBLIC_DOMAIN.replace(/\/$/, '')}/${key}` : key;
  const oldObjectsToDelete = [];
  await withTransaction(async db => {
    const locked = await one('SELECT * FROM storage_uploads WHERE file_key=$1 AND user_id=$2 FOR UPDATE', [key, req.user.user_id], db);
    if (locked.confirmed_at) return;
    if (file.folder === 'avatars') {
      const oldAvatars = await rows("SELECT file_key FROM storage_uploads WHERE user_id=$1 AND folder='avatars' AND file_key <> $2", [req.user.user_id, key], db);
      for (const old of oldAvatars) oldObjectsToDelete.push({ fileKey: old.file_key, isPublic: true });
      if (oldAvatars.length > 0) {
        await db.query("DELETE FROM storage_uploads WHERE user_id=$1 AND folder='avatars' AND file_key <> $2", [req.user.user_id, key]);
      }
      await db.query('UPDATE users SET avatar_url=$1 WHERE user_id=$2', [saved, req.user.user_id]);
    }
    if (file.folder === 'contracts' && meta.loan_id !== undefined && meta.loan_id !== null && String(meta.loan_id).trim() !== '') {
      await ownedLoan(req.user.user_id, meta.loan_id, db);
      await insert('loan_documents', { loan_id: meta.loan_id, document_type: choice(meta.document_type || 'CONTRACT', 'document_type', ['CONTRACT','APPENDIX','OTHER']), file_url: key, ocr_status: 'PENDING' }, db);
    }
    if (['collaterals','legal-documents'].includes(file.folder) && meta.asset_id !== undefined && meta.asset_id !== null) {
      const asset = found(await one('SELECT * FROM assets WHERE asset_id=$1 AND user_id=$2 FOR UPDATE', [meta.asset_id, req.user.user_id], db));
      const column = file.folder === 'collaterals' ? 'image_url' : 'legal_document_url';
      const oldVal = asset[column];
      if (file.folder === 'legal-documents' && oldVal && oldVal !== saved) {
        fail(409, 'Mỗi tài sản chỉ được lưu tối đa 1 giấy tờ pháp lý. Vui lòng xóa giấy tờ cũ trước khi tải bản mới.');
      }
      if (oldVal && oldVal !== saved) {
        const publicPrefix = `${process.env.R2_PUBLIC_DOMAIN.replace(/\/$/, '')}/`;
        const oldKey = oldVal.startsWith(publicPrefix) ? oldVal.slice(publicPrefix.length) : oldVal;
        if (oldKey && !/^https?:/i.test(oldKey)) {
          oldObjectsToDelete.push({ fileKey: oldKey, isPublic: file.is_public });
          await db.query('DELETE FROM storage_uploads WHERE file_key=$1 AND user_id=$2', [oldKey, req.user.user_id]);
        }
      }
      await db.query(`UPDATE assets SET ${column}=$1 WHERE asset_id=$2`, [saved, asset.asset_id]);
    }
    await db.query('UPDATE storage_uploads SET confirmed_at=NOW() WHERE file_key=$1', [key]);
  });
  if (oldObjectsToDelete.length > 0) {
    await Promise.all(oldObjectsToDelete.map(obj => deleteR2Object(obj)));
  }
  return { download_url: file.is_public ? saved : '', file_key: key };
});
export const getViewUrl = wrap(async req => {
  const key = text(req.query.file_key, 'file_key', 500);
  const defaultExpiry = Number(process.env.R2_PRESIGNED_VIEW_EXPIRES) || 600;
  const expiry = req.query.expires_in === undefined ? defaultExpiry : Number(req.query.expires_in);
  number(expiry, 'expires_in', 1, 600, true);
  let file = await one('SELECT * FROM storage_uploads WHERE file_key=$1 AND user_id=$2 AND confirmed_at IS NOT NULL', [key, req.user.user_id]);
  if (!file) {
    // Existing documents imported before storage_uploads was introduced retain ownership checks.
    const existing = await one('SELECT d.document_id FROM loan_documents d JOIN loans l USING(loan_id) WHERE d.file_url=$1 AND l.user_id=$2 UNION ALL SELECT asset_id FROM assets WHERE legal_document_url=$1 AND user_id=$2', [key, req.user.user_id]);
    if (!existing) fail(404, 'Không tìm thấy tài liệu.');
    file = { is_public: false };
  }
  if (/^https?:/i.test(key) || key.includes('..')) fail(400, 'Cần file_key riêng tư, không phải URL.');
  requireR2();
  return { view_url: file.is_public ? `${process.env.R2_PUBLIC_DOMAIN.replace(/\/$/, '')}/${key}` : await generateR2ViewUrl({ fileKey: key, expiresIn: expiry }) };
});

export const deleteFile = wrap(async req => {
  const rawKey = text(req.query.file_key || req.body?.file_key, 'file_key', 500);
  const publicPrefix = process.env.R2_PUBLIC_DOMAIN ? `${process.env.R2_PUBLIC_DOMAIN.replace(/\/$/, '')}/` : '';
  const key = publicPrefix && rawKey.startsWith(publicPrefix) ? rawKey.slice(publicPrefix.length) : rawKey;
  if (/^https?:/i.test(key) || key.includes('..')) fail(400, 'Cần file_key hợp lệ, không phải URL ngoài.');

  let file = await one('SELECT * FROM storage_uploads WHERE file_key=$1 AND user_id=$2', [key, req.user.user_id]);
  let isPublic = file?.is_public ?? false;
  if (!file) {
    const existing = await one('SELECT d.document_id FROM loan_documents d JOIN loans l USING(loan_id) WHERE d.file_url=$1 AND l.user_id=$2 UNION ALL SELECT asset_id FROM assets WHERE (legal_document_url=$1 OR image_url=$1) AND user_id=$2', [key, req.user.user_id]);
    if (!existing) fail(404, 'Không tìm thấy tài liệu.');
  }

  await withTransaction(async db => {
    await db.query('DELETE FROM loan_documents WHERE file_url=$1 AND loan_id IN (SELECT loan_id FROM loans WHERE user_id=$2)', [key, req.user.user_id]);
    const fullPublicUrl = publicPrefix ? `${publicPrefix}${key}` : key;
    await db.query('UPDATE users SET avatar_url=NULL WHERE user_id=$1 AND (avatar_url=$2 OR avatar_url=$3)', [req.user.user_id, key, fullPublicUrl]);
    await db.query('UPDATE users SET front_card_url=NULL WHERE user_id=$1 AND front_card_url=$2', [req.user.user_id, key]);
    await db.query('UPDATE users SET back_card_url=NULL WHERE user_id=$1 AND back_card_url=$2', [req.user.user_id, key]);
    await db.query('UPDATE assets SET image_url=NULL WHERE user_id=$1 AND (image_url=$2 OR image_url=$3)', [req.user.user_id, key, fullPublicUrl]);
    await db.query('UPDATE assets SET legal_document_url=NULL WHERE user_id=$1 AND (legal_document_url=$2 OR legal_document_url=$3)', [req.user.user_id, key, fullPublicUrl]);
    await db.query('DELETE FROM storage_uploads WHERE file_key=$1 AND user_id=$2', [key, req.user.user_id]);
  });

  if (process.env.R2_ENDPOINT) {
    await deleteR2Object({ fileKey: key, isPublic });
  }
  return { deleted: true, file_key: key };
});

export const listFiles = wrap(async req => {
  const folder = req.query.folder ? text(req.query.folder, 'folder', 50) : null;
  const user = await one('SELECT avatar_url, front_card_url, back_card_url FROM users WHERE user_id=$1', [req.user.user_id]);
  const params = folder ? [req.user.user_id, folder] : [req.user.user_id];
  const whereFolder = folder ? 'AND folder=$2' : '';
  const files = await rows(
    `SELECT file_key, folder, is_public, content_type, created_at, confirmed_at
     FROM storage_uploads
     WHERE user_id=$1 AND confirmed_at IS NOT NULL ${whereFolder}
     ORDER BY created_at DESC`,
    params,
  );
  return {
    data: files.map(f => ({
      ...f,
      is_current: Boolean(
        user &&
        (f.file_key === user.front_card_url ||
         f.file_key === user.back_card_url ||
         (user.avatar_url && user.avatar_url.endsWith(f.file_key)))
      ),
    })),
  };
});
