import { endpoint, rows, one, found, insert, text, number, choice, date, booleans, id, fail } from '../utils/api.js';
import { assetDto } from '../utils/dto.js';
import { MAX_LTV_BY_ASSET_TYPE } from '../config/constants.js';
import * as service from '../services/loan.service.js';
import { callProvider } from '../services/provider.service.js';
import { withTransaction } from '../config/db.js';
import { deleteR2Object } from '../config/r2.js';
import { notifyBalanceFluctuation, triggerImmediateDispatch } from '../services/notification.service.js';
export const getLoans = endpoint(async req => {
  const params = [req.user.user_id]; let where = 'user_id=$1';
  for (const key of ['status','lender','keyword']) if (req.query[key]) {
    params.push(text(req.query[key], key)); const p = `$${params.length}`;
    where += key === 'status' ? ` AND status=${p}` : key === 'lender' ? ` AND lender_name ILIKE '%' || ${p} || '%'` : ` AND (loan_name ILIKE '%' || ${p} || '%' OR lender_name ILIKE '%' || ${p} || '%' OR loan_id::text ILIKE '%' || ${p} || '%')`;
  }
  const loans = await rows(`SELECT loan_id FROM loans WHERE ${where} ORDER BY created_at DESC`, params);
  return Promise.all(loans.map(l => service.loanDetail(req.user.user_id, l.loan_id)));
});
export const getLoanDetail = endpoint(req => service.loanDetail(req.user.user_id, req.params.loanId));
export const createLoan = endpoint(req => service.createLoan(req.user.user_id, req.body), 201);
export const updateLoan = endpoint(req => service.editLoan(req.user.user_id, req.params.loanId, req.body));
export const deleteLoan = endpoint(async req => {
  booleans(req.body, ['soft_delete']);
  const isHardDelete = req.body.soft_delete === false;
  const result = await withTransaction(async db => {
    const target = found(await one(
      isHardDelete
        ? 'DELETE FROM loans WHERE loan_id=$1 AND user_id=$2 RETURNING loan_id, loan_name, outstanding_amount'
        : "UPDATE loans SET status='CLOSED', outstanding_amount=0 WHERE loan_id=$1 AND user_id=$2 RETURNING loan_id, loan_name, outstanding_amount",
      [id(req.params.loanId), req.user.user_id],
      db,
    ));
    await notifyBalanceFluctuation(req.user.user_id, {
      title: isHardDelete ? 'Xóa khoản vay khỏi hệ thống' : 'Đóng / Tất toán khoản vay',
      message: `Khoản vay "${target.loan_name}" đã được ${isHardDelete ? 'xóa khỏi hệ thống' : 'đóng / tất toán'}. Dư nợ trước đó: ${Math.round(Number(target.outstanding_amount || 0)).toLocaleString('vi-VN')} đ.`,
      db,
      io: req.app?.get?.('io'),
    });
    return { loan_id: target.loan_id };
  });
  triggerImmediateDispatch(req.app?.get?.('io'));
  return result;
});
export const getLoanAssets = endpoint(async req => {
  const loanId = req.params.loanId || req.query.loan_id;
  if (loanId) await service.ownedLoan(req.user.user_id, loanId);
  const assetList = loanId
    ? await rows(
        `SELECT a.*, lc.priority_order
         FROM assets a
         LEFT JOIN loan_collaterals lc ON lc.asset_id=a.asset_id AND lc.loan_id=$2
         WHERE a.user_id=$1 AND (lc.loan_id=$2 OR a.loan_id=$2)
         ORDER BY COALESCE(lc.priority_order, 1) ASC, a.created_at DESC`,
        [req.user.user_id, id(loanId)],
      )
    : await rows('SELECT * FROM assets WHERE user_id=$1 ORDER BY created_at DESC', [req.user.user_id]);

  const activeLinks = await rows(
    `SELECT DISTINCT lk.asset_id, l.loan_id, l.outstanding_amount, l.principal_amount
     FROM (
       SELECT loan_id, asset_id FROM loan_collaterals
       UNION
       SELECT loan_id, asset_id FROM assets WHERE loan_id IS NOT NULL
     ) lk
     JOIN loans l ON l.loan_id=lk.loan_id
     WHERE l.user_id=$1 AND l.status IN ('ACTIVE', 'OVERDUE', 'PENDING')`,
    [req.user.user_id],
  );

  const byAsset = new Map();
  for (const row of activeLinks) {
    const entry = byAsset.get(row.asset_id) || { loanIds: [], debt: 0 };
    entry.loanIds.push(String(row.loan_id));
    entry.debt += Number(row.outstanding_amount ?? row.principal_amount ?? 0);
    byAsset.set(row.asset_id, entry);
  }

  return assetList.map(a => {
    const info = byAsset.get(a.asset_id) || { loanIds: [], debt: 0 };
    const maxLtv = MAX_LTV_BY_ASSET_TYPE[a.asset_type] ?? MAX_LTV_BY_ASSET_TYPE.OTHER;
    const maxCapacity = Number(a.asset_value) * maxLtv;
    return assetDto({
      ...a,
      max_ltv_ratio: maxLtv,
      linked_loan_ids: info.loanIds,
      total_secured_debt: info.debt,
      remaining_collateral_capacity: Math.max(0, Math.round((maxCapacity - info.debt) * 100) / 100),
    });
  });
});
export const getLoanDocuments = endpoint(async req => {
  await service.ownedLoan(req.user.user_id, req.params.loanId);
  return rows('SELECT * FROM loan_documents WHERE loan_id=$1 ORDER BY created_at DESC', [req.params.loanId]);
});
export const addCollateral = endpoint(async req => {
  const b = req.body;
  if (b.loan_id) await service.ownedLoan(req.user.user_id, b.loan_id);
  let legalDocUrl = null;
  if (b.legal_document_url) {
    legalDocUrl = text(b.legal_document_url, 'legal_document_url', 500);
    const uploaded = await one(
      "SELECT file_key FROM storage_uploads WHERE file_key=$1 AND user_id=$2 AND folder IN ('legal-documents','collaterals') AND confirmed_at IS NOT NULL",
      [legalDocUrl, req.user.user_id],
    );
    if (!uploaded) fail(400, 'Giấy tờ pháp lý tài sản chưa được tải lên và xác nhận.');
  }
  let imageUrl = null;
  if (b.image_url) {
    const rawImage = text(b.image_url, 'image_url', 500);
    const publicPrefix = process.env.R2_PUBLIC_DOMAIN ? `${process.env.R2_PUBLIC_DOMAIN.replace(/\/$/, '')}/` : '';
    const imageKey = publicPrefix && rawImage.startsWith(publicPrefix) ? rawImage.slice(publicPrefix.length) : rawImage;
    if (/^https?:/i.test(imageKey) || imageKey.includes('..')) {
      fail(400, 'Đường dẫn ảnh tài sản không hợp lệ.');
    }
    const uploadedImg = await one(
      "SELECT file_key, is_public FROM storage_uploads WHERE file_key=$1 AND user_id=$2 AND folder IN ('collaterals','legal-documents') AND confirmed_at IS NOT NULL",
      [imageKey, req.user.user_id],
    );
    if (!uploadedImg) fail(400, 'Ảnh tài sản chưa được tải lên và xác nhận.');
    imageUrl = uploadedImg.is_public && publicPrefix ? `${publicPrefix}${uploadedImg.file_key}` : uploadedImg.file_key;
  }
  const created = await withTransaction(async db => {
    const asset = await insert('assets', {
      user_id: req.user.user_id,
      loan_id: b.loan_id || null,
      asset_name: text(b.asset_name, 'asset_name', 150),
      asset_type: choice(b.asset_type, 'asset_type', ['REAL_ESTATE','VEHICLE','SAVINGS','OTHER']),
      asset_value: number(b.estimated_value ?? b.asset_value, 'estimated_value'),
      valuation_date: b.valuation_date ? date(b.valuation_date, 'valuation_date') : null,
      certificate_number: b.certificate_number ? text(b.certificate_number, 'certificate_number') : null,
      legal_document_url: legalDocUrl,
      image_url: imageUrl,
      description: b.description ? text(b.description, 'description', 5000) : null,
    }, db);
    if (b.loan_id) {
      await service.linkCollateralToLoan(req.user.user_id, b.loan_id, asset.asset_id, db);
    }
    return asset;
  });
  return assetDto(created);
}, 201);
export const linkCollateral = endpoint(async req => {
  const assetId = id(req.params.assetId);
  const loanId = id(req.body.loan_id);
  const asset = await withTransaction(db => service.linkCollateralToLoan(req.user.user_id, loanId, assetId, db));
  return assetDto(asset);
});
export const deleteCollateral = endpoint(async req => {
  const assetId = id(req.params.assetId);
  const objectsToDelete = [];
  await withTransaction(async db => {
    const asset = found(await one('SELECT * FROM assets WHERE asset_id=$1 AND user_id=$2 FOR UPDATE', [assetId, req.user.user_id], db));
    const blockingLoan = await one(
      `SELECT l.loan_id, l.loan_name, l.status
       FROM loans l
       WHERE l.user_id=$1
         AND l.status NOT IN ('CLOSED', 'SETTLED')
         AND (
           l.loan_id=$2
           OR EXISTS (SELECT 1 FROM loan_collaterals lc WHERE lc.loan_id=l.loan_id AND lc.asset_id=$3)
         )
       LIMIT 1`,
      [req.user.user_id, asset.loan_id, asset.asset_id],
      db,
    );
    if (blockingLoan) {
      fail(409, `Tài sản đang được thế chấp cho khoản vay "${blockingLoan.loan_name}". Vui lòng tất toán hoặc gỡ thế chấp khỏi khoản vay trước khi xóa.`);
    }
    const publicPrefix = process.env.R2_PUBLIC_DOMAIN ? `${process.env.R2_PUBLIC_DOMAIN.replace(/\/$/, '')}/` : '';
    for (const [col, isPublic] of [['legal_document_url', false], ['image_url', true]]) {
      const raw = asset[col];
      if (!raw) continue;
      const key = publicPrefix && raw.startsWith(publicPrefix) ? raw.slice(publicPrefix.length) : raw;
      if (key && !/^https?:/i.test(key)) {
        objectsToDelete.push({ fileKey: key, isPublic });
        await db.query('DELETE FROM storage_uploads WHERE file_key=$1 AND user_id=$2', [key, req.user.user_id]);
      }
    }
    await db.query('DELETE FROM assets WHERE asset_id=$1 AND user_id=$2', [assetId, req.user.user_id]);
  });
  if (process.env.R2_ENDPOINT && objectsToDelete.length > 0) {
    await Promise.all(objectsToDelete.map(obj => deleteR2Object(obj)));
  }
  return { deleted: true, asset_id: String(assetId) };
});
export const ocrScan = endpoint(async req => {
  const result = await callProvider('OCR', { image_path: text(req.body.image_path, 'image_path', 2000), user_id: req.user.user_id });
  try {
    return { lender: text(result.lender, 'lender', 100), principal_amount: number(result.principal_amount, 'principal_amount', 0.01), interest_rate: number(result.interest_rate, 'interest_rate', 0, 1000), term_months: number(result.term_months, 'term_months', 1, 600, true), start_date: date(result.start_date, 'start_date') };
  } catch { fail(502, 'Dữ liệu OCR trả về không đúng định dạng.'); }
});
