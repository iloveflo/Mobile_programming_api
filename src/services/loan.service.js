import { withTransaction } from '../config/db.js';
import {
  MAX_LTV_BY_ASSET_TYPE,
  CIVIL_MAX_INTEREST_RATE_PCT,
  TCTD_MAX_INTEREST_RATE_PCT,
  UNSECURED_LOAN_RULES,
} from '../config/constants.js';
import { rows, one, found, insert, update, text, number, choice, date, id, fail } from '../utils/api.js';
import { loanDto } from '../utils/dto.js';
import { notifyBalanceFluctuation, triggerImmediateDispatch } from './notification.service.js';
export async function ownedLoan(userId, loanId, db) {
  return found(await one('SELECT * FROM loans WHERE loan_id=$1 AND user_id=$2', [id(loanId), userId], db));
}
export async function loanDetail(userId, loanId) {
  const loan = await ownedLoan(userId, loanId);
  loan.collaterals = await rows(
    `SELECT a.*, lc.priority_order, lc.secured_amount
     FROM assets a
     LEFT JOIN loan_collaterals lc ON lc.asset_id=a.asset_id AND lc.loan_id=$1
     WHERE a.user_id=$2 AND (lc.loan_id=$1 OR a.loan_id=$1)
     ORDER BY COALESCE(lc.priority_order, 1) ASC, a.created_at DESC`,
    [loan.loan_id, userId],
  );
  const nextSchedule = await one(
    "SELECT due_date, total_amount, installment_number FROM payment_schedules WHERE loan_id=$1 AND status <> 'PAID' ORDER BY due_date ASC, installment_number ASC LIMIT 1",
    [loan.loan_id],
  );
  const paidRow = await one(
    "SELECT count(*)::int AS count FROM payment_schedules WHERE loan_id=$1 AND status='PAID'",
    [loan.loan_id],
  );
  const isClosed = ['CLOSED', 'SETTLED'].includes(String(loan.status).toUpperCase()) || Number(loan.outstanding_amount) <= 0;
  loan.remaining_term_months = isClosed
    ? 0
    : nextSchedule
      ? Math.max(1, Number(loan.term_months) - Number(nextSchedule.installment_number) + 1)
      : Math.max(0, Number(loan.term_months) - Number(paidRow.count || 0));
  loan.next_payment_date = nextSchedule?.due_date ?? null;
  loan.next_payment_amount = nextSchedule ? Number(nextSchedule.total_amount) : null;
  return loanDto(loan);
}

/**
 * Gắn tài sản bảo đảm vào khoản vay theo Điều 296 BLDS 2015 & NĐ 21/2021/NĐ-CP:
 * - Một tài sản có thể bảo đảm cho nhiều khoản vay (kèm thứ tự ưu tiên thanh toán).
 * - Nếu tài sản đang bảo đảm cho nhiều khoản vay hoặc gắn 1-1 lúc tạo vay,
 *   tổng dư nợ được bảo đảm không được vượt quá giá trị tài sản * LTV tối đa theo loại tài sản.
 */
export async function linkCollateralToLoan(userId, loanId, assetId, db, { enforceSingleAssetLtv = false } = {}) {
  const loan = found(await one('SELECT * FROM loans WHERE loan_id=$1 AND user_id=$2 FOR UPDATE', [id(loanId), userId], db));
  const asset = found(await one('SELECT * FROM assets WHERE asset_id=$1 AND user_id=$2 FOR UPDATE', [id(assetId), userId], db));

  const existingLinks = await rows(
    `SELECT DISTINCT l.loan_id, l.outstanding_amount, l.principal_amount, l.status
     FROM loans l
     WHERE l.user_id=$1
       AND l.loan_id <> $2
       AND l.status IN ('ACTIVE', 'OVERDUE', 'PENDING')
       AND (
         EXISTS (SELECT 1 FROM loan_collaterals lc WHERE lc.loan_id=l.loan_id AND lc.asset_id=$3)
         OR EXISTS (SELECT 1 FROM assets a WHERE a.asset_id=$3 AND a.loan_id=l.loan_id)
       )`,
    [userId, loan.loan_id, asset.asset_id],
    db,
  );

  const otherSecuredDebt = existingLinks.reduce((sum, l) => sum + Number(l.outstanding_amount ?? l.principal_amount ?? 0), 0);
  const currentLoanDebt = ['CLOSED', 'SETTLED'].includes(String(loan.status).toUpperCase())
    ? 0
    : Number(loan.outstanding_amount ?? loan.principal_amount ?? 0);
  const totalSecuredOnAsset = otherSecuredDebt + currentLoanDebt;
  const maxLtv = MAX_LTV_BY_ASSET_TYPE[asset.asset_type] ?? MAX_LTV_BY_ASSET_TYPE.OTHER;
  const maxAllowedByLtv = Number(asset.asset_value) * maxLtv;

  if (existingLinks.length > 0 || enforceSingleAssetLtv) {
    if (totalSecuredOnAsset > Number(asset.asset_value)) {
      fail(400, `Tổng nghĩa vụ được bảo đảm (${Math.round(totalSecuredOnAsset).toLocaleString('vi-VN')} đ) vượt quá giá trị tài sản bảo đảm theo Điều 296 Bộ luật Dân sự 2015.`);
    }
    if (totalSecuredOnAsset > maxAllowedByLtv) {
      fail(400, `Tổng dư nợ bảo đảm vượt tỷ lệ LTV tối đa (${Math.round(maxLtv * 100)}%) đối với loại tài sản ${asset.asset_type}.`);
    }
  }

  const nextPriorityRow = await one(
    'SELECT COALESCE(MAX(priority_order), 0)::int + 1 AS next_priority FROM loan_collaterals WHERE asset_id=$1',
    [asset.asset_id],
    db,
  );
  await db.query(
    `INSERT INTO loan_collaterals (loan_id, asset_id, secured_amount, priority_order)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (loan_id, asset_id) DO UPDATE SET secured_amount=EXCLUDED.secured_amount`,
    [loan.loan_id, asset.asset_id, currentLoanDebt || loan.principal_amount, nextPriorityRow.next_priority],
  );
  if (asset.loan_id === null) {
    await db.query('UPDATE assets SET loan_id=$1 WHERE asset_id=$2', [loan.loan_id, asset.asset_id]);
  }
  return asset;
}
export function addMonths(start, months, day) {
  const d = new Date(start);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day || d.getUTCDate(), last));
  return target.toISOString().slice(0, 10);
}
export function buildSchedule(loan) {
  const result = []; let balance = Number(loan.outstanding_amount ?? loan.principal_amount);
  if (balance === 0) return result;
  const months = loan.remaining_term_months ?? Math.max(1, Math.ceil(balance / (Number(loan.principal_amount) / loan.term_months)));
  const principal = Math.round(balance / months * 100) / 100;
  const elapsed = loan.term_months - months;
  for (let i = 1; i <= months; i++) {
    const interest = Math.round((loan.interest_method === 'FLAT' ? loan.principal_amount : balance) * loan.interest_rate / 12 * 100) / 100;
    const part = i === months ? balance : Math.min(balance, principal);
    balance = Math.max(0, Math.round((balance - part) * 100) / 100);
    result.push({ loan_id: loan.loan_id, installment_number: elapsed + i, due_date: addMonths(loan.start_date, elapsed + i, loan.payment_day_of_month), principal_amount: part, interest_amount: interest, total_amount: Math.round((part + interest) * 100) / 100, remaining_balance: balance, status: 'PENDING' });
  }
  if (loan.end_date && result.length) {
    const end = new Date(loan.end_date).toISOString().slice(0, 10);
    if (result.length > 1 && end <= result[result.length - 2].due_date) fail(400, 'Ngày kết thúc phải sau kỳ thanh toán áp chót.');
    result[result.length - 1].due_date = end;
  }
  return result;
}
export async function loanInput(body, existing, db) {
  const data = {};
  const required = (key, fn) => { if (!existing || body[key] !== undefined) data[key] = fn(body[key], key); };
  required('loan_name', (v, k) => text(v, k, 150));
  required('principal_amount', (v, k) => number(v, k, 0.01));
  required('interest_rate', (v, k) => number(v, k, 0, TCTD_MAX_INTEREST_RATE_PCT) / 100);
  required('term_months', (v, k) => number(v, k, 1, 600, true));
  required('start_date', date);
  if (body.lender !== undefined || body.lender_name !== undefined) data.lender_name = text(body.lender ?? body.lender_name, 'lender', 100);
  if (!existing || body.interest_calculation_method !== undefined || body.interest_method !== undefined) data.interest_method = choice(body.interest_calculation_method ?? body.interest_method ?? 'REDUCING_BALANCE', 'interest_calculation_method', ['REDUCING_BALANCE', 'FLAT']);
  if (!existing || body.loan_type_code !== undefined || body.loan_type_id !== undefined || body.loan_type !== undefined) {
    const typeCode = body.loan_type_code ?? body.loan_type;
    const type = body.loan_type_id ? await one('SELECT * FROM loan_types WHERE loan_type_id=$1', [id(body.loan_type_id)], db) : await one('SELECT * FROM loan_types WHERE type_code=$1', [typeCode || 'OTHER'], db);
    if (!type) fail(400, 'Loại khoản vay không hợp lệ.');
    data.loan_type_id = type.loan_type_id; data.loan_type = type.type_code;
  }
  const effectiveType = data.loan_type ?? existing?.loan_type ?? 'OTHER';
  const effectiveLender = (data.lender_name ?? existing?.lender_name ?? '').trim();
  const effectiveRatePct = (data.interest_rate ?? existing?.interest_rate ?? 0) * 100;
  // Điều 468 BLDS 2015: Vay dân sự ngoài TCTD không vượt quá 20%/năm
  if (effectiveType === 'OTHER' && !effectiveLender && effectiveRatePct > CIVIL_MAX_INTEREST_RATE_PCT) {
    fail(400, `Lãi suất vay dân sự ngoài tổ chức tín dụng không được vượt quá ${CIVIL_MAX_INTEREST_RATE_PCT}%/năm theo Điều 468 Bộ luật Dân sự 2015.`);
  }
  if (body.status !== undefined) data.status = choice(body.status, 'status', ['ACTIVE', 'PENDING', 'CLOSED', 'OVERDUE', 'SETTLED']);
  if (body.payment_day_of_month !== undefined) data.payment_day_of_month = number(body.payment_day_of_month, 'payment_day_of_month', 1, 31, true);
  if (body.early_payment_fee_rate !== undefined) data.early_payment_fee_rate = number(body.early_payment_fee_rate, 'early_payment_fee_rate', 0, 1);
  const merged = { ...existing, ...data };
  if (body.due_date !== undefined) data.end_date = date(body.due_date, 'due_date');
  else if (!existing || ['start_date','term_months','payment_day_of_month'].some(k => data[k] !== undefined)) data.end_date = addMonths(merged.start_date, merged.term_months, merged.payment_day_of_month);
  if (data.end_date && data.end_date < new Date(merged.start_date).toISOString().slice(0,10)) fail(400, 'Ngày kết thúc phải sau ngày bắt đầu.');
  const isSettling = existing && ['CLOSED', 'SETTLED'].includes(data.status);
  if (existing && !isSettling && body.remaining_principal !== undefined && Number(body.remaining_principal) !== Number(existing.outstanding_amount)) fail(409, 'Dư nợ được cập nhật qua thanh toán kỳ nợ.');
  if (isSettling) data.outstanding_amount = 0;
  if (!existing) data.outstanding_amount = body.remaining_principal === undefined ? data.principal_amount : number(body.remaining_principal, 'remaining_principal', 0, data.principal_amount);
  return data;
}
export async function validateUnsecuredLoanCapacity(userId, data, remaining, db) {
  const user = found(await one('SELECT user_id, monthly_income FROM users WHERE user_id=$1 FOR UPDATE', [userId], db));
  const monthlyIncome = Number(user.monthly_income || 0);
  const {
    MIN_MONTHLY_INCOME,
    MIN_LOAN_AMOUNT,
    MAX_LOAN_CAP,
    INCOME_MULTIPLIER,
    MAX_ACTIVE_LOANS,
    MAX_DTI_RATIO,
  } = UNSECURED_LOAN_RULES;

  if (monthlyIncome < MIN_MONTHLY_INCOME) {
    fail(
      400,
      `Thu nhập hàng tháng tối thiểu ${MIN_MONTHLY_INCOME.toLocaleString('vi-VN')} đ để đăng ký khoản vay tín chấp không tài sản bảo đảm.`,
    );
  }

  const principal = Number(data.principal_amount || 0);
  if (principal < MIN_LOAN_AMOUNT) {
    fail(400, `Khoản vay tín chấp tối thiểu là ${MIN_LOAN_AMOUNT.toLocaleString('vi-VN')} đ.`);
  }
  if (principal > MAX_LOAN_CAP) {
    fail(400, `Khoản vay tín chấp tối đa không vượt quá ${MAX_LOAN_CAP.toLocaleString('vi-VN')} đ.`);
  }

  const activeUnsecured = await rows(
    `SELECT l.loan_id, l.loan_type, l.outstanding_amount, l.principal_amount, l.interest_rate, l.term_months, l.interest_method
     FROM loans l
     WHERE l.user_id=$1
       AND l.status IN ('ACTIVE', 'OVERDUE', 'PENDING')
       AND l.loan_type IN ('CONSUMER', 'CREDIT_CARD')
       AND NOT EXISTS (SELECT 1 FROM loan_collaterals lc WHERE lc.loan_id=l.loan_id)
       AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.loan_id=l.loan_id)`,
    [userId],
    db,
  );

  if (activeUnsecured.length >= MAX_ACTIVE_LOANS) {
    fail(400, `Bạn đã đạt giới hạn tối đa ${MAX_ACTIVE_LOANS} khoản vay tín chấp đang mở. Vui lòng tất toán bớt trước khi vay thêm.`);
  }

  const maxAllowedByIncome = Math.min(monthlyIncome * INCOME_MULTIPLIER, MAX_LOAN_CAP);
  const currentUnsecuredDebt = activeUnsecured.reduce(
    (sum, l) => sum + Number(l.outstanding_amount ?? l.principal_amount ?? 0),
    0,
  );
  const newLoanDebt = Number(data.outstanding_amount ?? principal);
  if (currentUnsecuredDebt + newLoanDebt > maxAllowedByIncome) {
    const remainingCap = Math.max(0, Math.round(maxAllowedByIncome - currentUnsecuredDebt));
    fail(
      400,
      `Tổng dư nợ vay tín chấp vượt hạn mức tối đa (${INCOME_MULTIPLIER}x thu nhập, tối đa ${MAX_LOAN_CAP.toLocaleString('vi-VN')} đ). Hạn mức tín chấp còn lại của bạn: ${remainingCap.toLocaleString('vi-VN')} đ.`,
    );
  }

  const existingActive = await rows(
    `SELECT l.loan_id, l.outstanding_amount, l.principal_amount, l.interest_rate, l.term_months, l.interest_method,
       (SELECT s.total_amount FROM payment_schedules s WHERE s.loan_id=l.loan_id AND s.status<>'PAID'
        ORDER BY s.due_date ASC, s.installment_number ASC LIMIT 1) AS next_due
     FROM loans l
     WHERE l.user_id=$1 AND l.status IN ('ACTIVE', 'OVERDUE') AND l.outstanding_amount>0`,
    [userId],
    db,
  );

  const existingMonthly = existingActive.reduce((sum, l) => {
    if (l.next_due !== null && l.next_due !== undefined) {
      return sum + Number(l.next_due);
    }
    const bal = Number(l.outstanding_amount ?? l.principal_amount ?? 0);
    const months = Math.max(1, Number(l.term_months || 1));
    const rate = Number(l.interest_rate || 0);
    const base = l.interest_method === 'FLAT' ? Number(l.principal_amount || bal) : bal;
    return sum + bal / months + (base * rate) / 12;
  }, 0);

  const firstNewInstallment = buildSchedule({
    ...data,
    loan_id: 0,
    remaining_term_months: remaining,
  })[0];
  const newMonthly = firstNewInstallment ? Number(firstNewInstallment.total_amount) : 0;
  const projectedDti = (existingMonthly + newMonthly) / monthlyIncome;
  if (projectedDti > MAX_DTI_RATIO) {
    fail(
      400,
      `Tỷ lệ nghĩa vụ trả nợ trên thu nhập (DTI dự kiến ${(projectedDti * 100).toFixed(1)}%) vượt ngưỡng an toàn ${Math.round(MAX_DTI_RATIO * 100)}%.`,
    );
  }
}

export async function createLoan(userId, body) {
  const data = await loanInput(body);
  const remaining = body.remaining_term_months === undefined ? undefined : number(body.remaining_term_months, 'remaining_term_months', 1, data.term_months, true);
  const collateralIds = Array.isArray(body.collateral_ids)
    ? body.collateral_ids
    : (body.collateral_id !== undefined && body.collateral_id !== null ? [body.collateral_id] : []);
  const contractFileKey = body.contract_file_key === undefined || body.contract_file_key === null || String(body.contract_file_key).trim() === ''
    ? null
    : text(body.contract_file_key, 'contract_file_key', 500);
  if (contractFileKey && (/^https?:/i.test(contractFileKey) || contractFileKey.includes('..'))) {
    fail(400, 'contract_file_key phải là file_key hợp lệ.');
  }
  const loan = await withTransaction(async db => {
    const isUnsecuredCredit =
      collateralIds.length === 0 &&
      ['CONSUMER', 'CREDIT_CARD'].includes(data.loan_type) &&
      !['CLOSED', 'SETTLED'].includes(String(data.status ?? 'ACTIVE').toUpperCase());
    if (isUnsecuredCredit) {
      await validateUnsecuredLoanCapacity(userId, data, remaining, db);
    }
    const l = await insert('loans', { ...data, user_id: userId }, db);
    const nextOnly = buildSchedule({ ...l, remaining_term_months: remaining }).slice(0, 1);
    for (const schedule of nextOnly) await insert('payment_schedules', schedule, db);
    for (const assetId of collateralIds) {
      await linkCollateralToLoan(userId, l.loan_id, assetId, db, { enforceSingleAssetLtv: collateralIds.length === 1 });
    }
    if (contractFileKey) {
      await insert(
        'loan_documents',
        {
          loan_id: l.loan_id,
          document_type: 'CONTRACT',
          file_url: contractFileKey,
          ocr_status: 'COMPLETED',
        },
        db,
      );
    }
    if (l.status === 'ACTIVE') {
      await notifyBalanceFluctuation(userId, {
        title: 'Ghi nhận giải ngân khoản vay mới',
        message: `Khoản vay "${l.loan_name}" vừa được ghi nhận với dư nợ ${Math.round(Number(l.outstanding_amount)).toLocaleString('vi-VN')} đ.`,
        db,
      });
    }
    return l;
  });
  triggerImmediateDispatch();
  return loanDetail(userId, loan.loan_id);
}
export async function editLoan(userId, loanId, body) {
  await withTransaction(async db => {
    const existing = found(await one('SELECT * FROM loans WHERE loan_id=$1 AND user_id=$2 FOR UPDATE', [id(loanId), userId], db));
    if (['CLOSED', 'SETTLED'].includes(existing.status)) {
      fail(409, 'Khoản vay đã đóng/tất toán, không thể chỉnh sửa thông tin.');
    }
    const firstUnpaid = await one("SELECT installment_number FROM payment_schedules WHERE loan_id=$1 AND status<>'PAID' ORDER BY installment_number ASC LIMIT 1", [existing.loan_id], db);
    const paidSummary = await one("SELECT count(*)::int AS count FROM payment_schedules WHERE loan_id=$1 AND status='PAID'", [existing.loan_id], db);
    const currentRemainingCount = firstUnpaid
      ? Math.max(1, existing.term_months - Number(firstUnpaid.installment_number) + 1)
      : Math.max(0, existing.term_months - Number(paidSummary.count || 0));
    let remaining = body.remaining_term_months === undefined ? undefined : number(body.remaining_term_months, 'remaining_term_months', 1, body.term_months ?? 600, true);
    const remainingChanged = remaining !== undefined && remaining !== currentRemainingCount;
    const effectiveBody = { ...body };
    if (remainingChanged && body.term_months === undefined) {
      // Keep the first outstanding period fixed when changing the remaining count.
      effectiveBody.term_months = existing.term_months - currentRemainingCount + remaining;
    }
    const data = await loanInput(effectiveBody, existing, db);
    const changesSchedule = remainingChanged || ['principal_amount','interest_rate','term_months','start_date','interest_method','payment_day_of_month','end_date'].some(k => data[k] !== undefined && String(data[k]) !== String(existing[k]));
    const paid = (changesSchedule || body.collateral_id !== undefined)
      ? await one("SELECT schedule_id FROM payment_schedules WHERE loan_id=$1 AND status='PAID' LIMIT 1", [existing.loan_id], db)
      : null;
    if (changesSchedule) {
      if (paid) fail(409, 'Không thể thay đổi điều khoản của khoản vay đã thanh toán.');
      const principalChanged = data.principal_amount !== undefined && Number(data.principal_amount) !== Number(existing.principal_amount);
      const termChanged = data.term_months !== undefined && data.term_months !== existing.term_months;
      if (principalChanged && Number(existing.outstanding_amount) !== Number(existing.principal_amount)) fail(409, 'Không thể thay đổi gốc ban đầu của khoản vay nhập dở.');
      if (principalChanged) data.outstanding_amount = data.principal_amount;
      // An imported loan may contain only its remaining installments. Rate/date
      // edits preserve both that count and the actual outstanding principal.
      if (remaining === undefined && !termChanged && !principalChanged && currentRemainingCount > 0) remaining = currentRemainingCount;
    }
    if (!Object.keys(data).length && body.remaining_term_months !== undefined && body.collateral_id === undefined) return;
    const loan = Object.keys(data).length
      ? await update('loans', data, 'loan_id=$1 AND user_id=$2', [existing.loan_id, userId], db)
      : existing;
    const isSettling = ['CLOSED', 'SETTLED'].includes(loan.status);
    if (!isSettling && body.collateral_id !== undefined) {
      const currentLinks = await rows(
        `SELECT asset_id FROM loan_collaterals WHERE loan_id=$1
         UNION
         SELECT asset_id FROM assets WHERE loan_id=$1`,
        [existing.loan_id],
        db,
      );
      const currentIds = new Set(currentLinks.map(r => String(r.asset_id)));
      const nextCollateralId = body.collateral_id === null ? null : String(id(body.collateral_id));
      const collateralChanged = nextCollateralId === null ? currentIds.size > 0 : !currentIds.has(nextCollateralId) || currentIds.size !== 1;
      if (collateralChanged) {
        if (paid) fail(409, 'Không thể thay đổi tài sản thế chấp của khoản vay đã phát sinh thanh toán.');
        await db.query('DELETE FROM loan_collaterals WHERE loan_id=$1', [existing.loan_id]);
        await db.query('UPDATE assets SET loan_id=NULL WHERE loan_id=$1', [existing.loan_id]);
        if (nextCollateralId !== null) {
          await linkCollateralToLoan(userId, existing.loan_id, nextCollateralId, db, { enforceSingleAssetLtv: true });
        }
      } else if (nextCollateralId !== null && changesSchedule) {
        await linkCollateralToLoan(userId, existing.loan_id, nextCollateralId, db, { enforceSingleAssetLtv: true });
      }
    }
    if (isSettling) {
      await db.query(
        "UPDATE notifications SET status='CANCELLED' WHERE status='PENDING' AND schedule_id IN (SELECT schedule_id FROM payment_schedules WHERE loan_id=$1 AND status<>'PAID')",
        [loan.loan_id],
      );
      await db.query("DELETE FROM payment_schedules WHERE loan_id=$1 AND status<>'PAID'", [loan.loan_id]);
    } else if (changesSchedule) {
      await db.query('DELETE FROM payment_schedules WHERE loan_id=$1', [loan.loan_id]);
      const nextOnly = buildSchedule({ ...loan, remaining_term_months: remaining }).slice(0, 1);
      for (const schedule of nextOnly) await insert('payment_schedules', schedule, db);
    }
    await refreshLoanStatus(existing.loan_id, db);
    const ratePct = (Number(loan.interest_rate) * 100).toFixed(2).replace(/\.?0+$/, '');
    await notifyBalanceFluctuation(userId, {
      title: isSettling ? 'Tất toán khoản vay trước hạn' : 'Cập nhật thông tin khoản vay',
      message: isSettling
        ? `Khoản vay "${loan.loan_name}" đã được tất toán hoàn tất. Dư nợ còn lại: 0 đ.`
        : `Khoản vay "${loan.loan_name}" đã được cập nhật. Dư nợ: ${Math.round(Number(loan.outstanding_amount)).toLocaleString('vi-VN')} đ, lãi suất: ${ratePct}%/năm, kỳ hạn: ${loan.term_months} tháng.`,
      db,
    });
  });
  triggerImmediateDispatch();
  return loanDetail(userId, loanId);
}

export async function refreshLoanStatus(loanId, db) {
  await db.query("UPDATE payment_schedules SET status=CASE WHEN due_date<CURRENT_DATE THEN 'OVERDUE' ELSE 'PENDING' END WHERE loan_id=$1 AND status IN ('PENDING','OVERDUE')", [loanId]);
  return one(`UPDATE loans l SET status=CASE
    WHEN outstanding_amount<=0 THEN 'CLOSED'
    WHEN EXISTS(SELECT 1 FROM payment_schedules s WHERE s.loan_id=l.loan_id AND s.status<>'PAID' AND s.due_date<CURRENT_DATE) THEN 'OVERDUE'
    ELSE 'ACTIVE' END
    WHERE loan_id=$1 AND status IN ('ACTIVE','OVERDUE') RETURNING *`, [loanId], db);
}
