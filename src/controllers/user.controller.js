import { endpoint, rows, one, found, insert, update, pick, text, number, booleans, date, id, choice, safeUser, fail } from '../utils/api.js';
import { query } from '../config/db.js';
import { withTransaction } from '../config/db.js';
import { callProvider } from '../services/provider.service.js';
import { calculateProfile } from '../services/credit.service.js';
import { financialPdf, generateFinancialPdfBuffer } from '../services/pdf.service.js';
export const getProfile = endpoint(async req => safeUser(found(await one('SELECT * FROM users WHERE user_id=$1', [req.user.user_id]))));
export const updateProfile = endpoint(async req => {
  const b = pick(req.body, ['full_name','monthly_income','date_of_birth','address','occupation','workplace','contract_type']);
  const current = found(await one('SELECT is_ekyc_verified FROM users WHERE user_id=$1', [req.user.user_id]));
  if (current.is_ekyc_verified && ['full_name','date_of_birth','address'].some(k => b[k] !== undefined)) {
    fail(403, 'Thông tin trên CCCD đã xác thực eKYC không thể chỉnh sửa thủ công.');
  }
  if (b.monthly_income !== undefined) number(b.monthly_income, 'monthly_income');
  if (b.date_of_birth !== undefined) b.date_of_birth = date(b.date_of_birth, 'date_of_birth');
  for (const key of ['full_name','address','occupation','workplace','contract_type']) if (b[key] !== undefined) text(b[key], key, key === 'address' ? 255 : key === 'workplace' ? 150 : 100);
  const updatedUser = await withTransaction(async db => {
    const user = await update('users', b, 'user_id=$1', [req.user.user_id], db);
    if (b.monthly_income !== undefined) {
      await calculateProfile(req.user.user_id, db);
    }
    return user;
  });
  return safeUser(updatedUser);
});
export const updateSecuritySettings = endpoint(async req => {
  const b = pick(req.body, ['is_biometric_enabled','auto_lock_enabled']); booleans(b, Object.keys(b));
  return safeUser(await update('users', b, 'user_id=$1', [req.user.user_id]));
});
export const verifyEkyc = endpoint(async req => {
  const b = req.body;
  for (const key of ['front_card_url','back_card_url']) {
    text(b[key], key, 500);
    const file = await one("SELECT file_key FROM storage_uploads WHERE file_key=$1 AND user_id=$2 AND folder='ekyc' AND confirmed_at IS NOT NULL", [b[key], req.user.user_id]);
    if (!file) fail(400, 'Vui lòng chụp/tải lên đủ 2 mặt ảnh CCCD trước khi xác thực.');
  }

  let extracted = {
    id_card_number: b.id_card_number,
    full_name: undefined,
    date_of_birth: undefined,
    address: undefined,
  };

  if (process.env.EKYC_PROVIDER_URL) {
    if (b.id_card_number !== undefined && !/^\d{12}$/.test(b.id_card_number || '')) {
      fail(400, 'CCCD phải có 12 chữ số.');
    }
    const result = await callProvider('EKYC', { ...pick(b, ['id_card_number','front_card_url','back_card_url']), user_id: req.user.user_id });
    if (result.verified !== true || result.tier !== 'C06') fail(422, 'Không xác minh được danh tính C06.');
    extracted = {
      id_card_number: result.id_card_number || b.id_card_number,
      full_name: result.full_name,
      date_of_birth: result.date_of_birth,
      address: result.address,
    };
  } else {
    // Dữ liệu CCCD được trích xuất trực tiếp on-device (QR + MRZ) từ 2 ảnh đã upload lên R2
    if (!/^\d{12}$/.test(b.id_card_number || '')) {
      fail(400, 'Không đọc được đủ 12 chữ số CCCD từ ảnh thẻ.');
    }
    extracted = {
      id_card_number: b.id_card_number,
      full_name: text(b.full_name, 'full_name', 100),
      date_of_birth: date(b.date_of_birth, 'date_of_birth'),
      address: text(b.address, 'address', 255),
    };
  }

  if (!/^\d{12}$/.test(extracted.id_card_number || '')) fail(400, 'CCCD phải có 12 chữ số.');

  const fields = {
    id_card_number: extracted.id_card_number,
    is_ekyc_verified: true,
    ekyc_tier: 'C06',
    front_card_url: b.front_card_url,
    back_card_url: b.back_card_url,
  };
  if (extracted.full_name) fields.full_name = extracted.full_name;
  if (extracted.date_of_birth) fields.date_of_birth = extracted.date_of_birth;
  if (extracted.address) fields.address = extracted.address;

  return safeUser(await update('users', fields, 'user_id=$1', [req.user.user_id]));
});
export const exportFinancialPdf = async (req, res, next) => {
  try {
    if (req.query.direct === '1') {
      const buffer = await generateFinancialPdfBuffer(req.user.user_id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="HoSoNangLuc_FinCredit_${req.user.user_id}.pdf"`);
      return res.send(buffer);
    }
    res.json({ success: true, data: await financialPdf(req.user.user_id) });
  } catch (e) {
    next(e);
  }
};

export const registerFcmToken = endpoint(async req => {
  const fcmToken = text(req.body.fcm_token, 'fcm_token', 512);
  const platform = choice(req.body.platform || 'android', 'platform', ['android', 'ios', 'web']);
  return one(
    `INSERT INTO device_tokens (user_id, fcm_token, platform)
     VALUES ($1, $2, $3)
     ON CONFLICT (fcm_token) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           platform = EXCLUDED.platform,
           updated_at = CURRENT_TIMESTAMP
     RETURNING token_id, user_id, fcm_token, platform, updated_at`,
    [req.user.user_id, fcmToken, platform],
  );
});

export const unregisterFcmToken = endpoint(async req => {
  const rawToken = req.body?.fcm_token ?? req.query?.fcm_token;
  if (!rawToken) return { removed: 0 };
  const fcmToken = text(rawToken, 'fcm_token', 512);
  const deleted = await rows(
    'DELETE FROM device_tokens WHERE user_id=$1 AND fcm_token=$2 RETURNING token_id',
    [req.user.user_id, fcmToken],
  );
  return { removed: deleted.length };
});
