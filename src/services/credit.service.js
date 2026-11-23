import { one, rows, insert, found, fail } from '../utils/api.js';
import { withTransaction } from '../config/db.js';
export async function calculateProfile(userId, db) {
  const user = found(await one('SELECT * FROM users WHERE user_id=$1', [userId], db));
  const loans = await rows("SELECT * FROM loans WHERE user_id=$1 AND status IN ('ACTIVE','OVERDUE')", [userId], db);
  const total = loans.reduce((s, l) => s + Number(l.outstanding_amount), 0);
  // Each active loan contributes its next unpaid installment, including fees.
  // Imported loans must use their actual remaining repayment plan.
  const obligations = await rows(`SELECT l.loan_id,
    (SELECT s.total_amount FROM payment_schedules s WHERE s.loan_id=l.loan_id AND s.status<>'PAID'
     ORDER BY s.due_date,s.installment_number LIMIT 1) AS next_due
    FROM loans l WHERE l.user_id=$1 AND l.status IN ('ACTIVE','OVERDUE') AND l.outstanding_amount>0`, [userId], db);
  const monthly = obligations.some(o => o.next_due === null) ? null : obligations.reduce((sum, o) => sum + Number(o.next_due), 0);
  // Chỉ tính LTV trên các khoản vay có tài sản bảo đảm, không gộp nợ tín chấp; dùng DISTINCT asset_id để tránh nhân đôi tài sản dùng chung (Điều 296 BLDS 2015)
  const ltvStats = await one(
    `WITH linked AS (
       SELECT lc.loan_id, lc.asset_id FROM loan_collaterals lc
       UNION
       SELECT a.loan_id, a.asset_id FROM assets a WHERE a.loan_id IS NOT NULL
     )
     SELECT
       COALESCE((SELECT sum(l.outstanding_amount) FROM loans l WHERE l.user_id=$1 AND l.status IN ('ACTIVE','OVERDUE') AND EXISTS (SELECT 1 FROM linked lk WHERE lk.loan_id=l.loan_id)), 0) AS secured_debt,
       COALESCE((SELECT sum(DISTINCT a.asset_value) FROM assets a JOIN linked lk ON lk.asset_id=a.asset_id JOIN loans l ON l.loan_id=lk.loan_id WHERE a.user_id=$1 AND l.user_id=$1 AND l.status IN ('ACTIVE','OVERDUE')), 0) AS collateral_value`,
    [userId],
    db,
  );
  const history = await one("SELECT count(*) FILTER(WHERE s.status='PAID')::int AS paid, count(*) FILTER(WHERE s.due_date<CURRENT_DATE OR s.status='PAID')::int AS due, count(*) FILTER(WHERE s.status='PAID' AND s.paid_at::date<=s.due_date)::int AS on_time, COALESCE(sum(s.total_amount) FILTER(WHERE s.status<>'PAID' AND s.due_date<CURRENT_DATE),0) AS overdue FROM payment_schedules s JOIN loans l USING(loan_id) WHERE l.user_id=$1", [userId], db);
  const cards = loans.filter(l => l.loan_type === 'CREDIT_CARD');
  const cardLimit = cards.reduce((s, l) => s + Number(l.principal_amount), 0);
  // Null means insufficient data, not a fabricated zero-risk measurement.
  const dti = Number(user.monthly_income) > 0 && monthly !== null ? monthly / Number(user.monthly_income) : null;
  const ltv = Number(ltvStats.collateral_value) > 0 ? Number(ltvStats.secured_debt) / Number(ltvStats.collateral_value) : null;
  const utilization = cardLimit > 0 ? cards.reduce((s,l) => s + Number(l.outstanding_amount), 0) / cardLimit : null;
  const onTime = history.due ? history.on_time / history.due : null;
  const ltvPenalty = ltv !== null && ltv > 0.7 ? Math.min(0.5, ltv - 0.7) * 100 : 0;
  const score = dti === null ? null : Math.max(300, Math.min(850, Math.round(850 - Math.min(dti, 2) * 200 - (utilization || 0) * 100 - (onTime === null ? 0 : (1 - onTime) * 200) - ltvPenalty)));
  const risk = dti === null ? 'UNKNOWN' : dti > 0.5 || Number(history.overdue) > 0 || (ltv !== null && ltv > 0.85) ? 'HIGH' : dti > 0.35 || (ltv !== null && ltv > 0.7) ? 'MEDIUM' : 'LOW';
  const cap = v => v === null ? null : Math.min(999.9999, v);
  const profile = await one(`INSERT INTO credit_profiles(user_id,credit_score,dti_ratio,ltv_ratio,credit_utilization,on_time_payment_rate,active_loan_count,risk_level)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id) DO UPDATE SET credit_score=EXCLUDED.credit_score,dti_ratio=EXCLUDED.dti_ratio,ltv_ratio=EXCLUDED.ltv_ratio,credit_utilization=EXCLUDED.credit_utilization,on_time_payment_rate=EXCLUDED.on_time_payment_rate,active_loan_count=EXCLUDED.active_loan_count,risk_level=EXCLUDED.risk_level RETURNING *`, [userId, score, cap(dti), cap(ltv), cap(utilization), onTime, loans.length, risk], db);
  return { profile, total_debt: total, overdue_amount: Number(history.overdue) };
}
export async function recalculate(userId) { return withTransaction(async db => { await db.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [userId]); return (await calculateProfile(userId, db)).profile; }); }
export async function generateReport(userId, period) {
  if (typeof period !== 'string' || !/^\d{4}-(Q[1-4]|0[1-9]|1[0-2])$/.test(period)) fail(400, 'report_period phải có dạng YYYY-Q1 hoặc YYYY-MM.');
  const [yearStr, part] = period.split('-');
  const year = Number(yearStr);
  const startMonth = part.startsWith('Q') ? (Number(part.slice(1)) - 1) * 3 : Number(part) - 1;
  const endMonth = part.startsWith('Q') ? startMonth + 3 : startMonth + 1;
  const periodStart = new Date(Date.UTC(year, startMonth, 1));
  const periodEnd = new Date(Date.UTC(year, endMonth, 0, 23, 59, 59));
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (periodStart > currentMonthStart) fail(400, 'Không thể lập báo cáo cho kỳ tương lai.');

  return withTransaction(async db => {
    await db.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [userId]);
    const activity = await one(
      'SELECT LEAST(u.created_at::date, COALESCE((SELECT MIN(start_date) FROM loans WHERE user_id=$1), u.created_at::date)) AS earliest_date FROM users u WHERE u.user_id=$1',
      [userId],
      db,
    );
    if (activity?.earliest_date) {
      const earliest = new Date(activity.earliest_date);
      const earliestMonthStart = new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), 1));
      if (periodEnd < earliestMonthStart) {
        fail(400, 'Không thể lập báo cáo cho kỳ trước thời điểm tài khoản hoặc khoản vay phát sinh dữ liệu.');
      }
    }
    if (await one('SELECT report_id FROM credit_reports WHERE user_id=$1 AND report_period=$2', [userId, period], db)) fail(409, 'Kỳ báo cáo này đã được khởi tạo trước đó. Mỗi kỳ báo cáo chỉ lập một bản ghi ảnh chụp duy nhất.');
    const { profile: p, total_debt, overdue_amount } = await calculateProfile(userId, db);
    return insert('credit_reports', { user_id: userId, report_period: period, credit_score: p.credit_score, dti_ratio: p.dti_ratio, ltv_ratio: p.ltv_ratio, credit_utilization: p.credit_utilization, on_time_payment_rate: p.on_time_payment_rate, risk_level: p.risk_level, total_debt, overdue_amount }, db);
  });
}
