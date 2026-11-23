import { endpoint, rows, one, found, insert, update, pick, number, booleans, date, id, fail } from '../utils/api.js';
import { scheduleDto } from '../utils/dto.js';
import { withTransaction } from '../config/db.js';
import { addMonths, refreshLoanStatus } from '../services/loan.service.js';
import { getUserNotificationPref, notifyBalanceFluctuation, triggerImmediateDispatch } from '../services/notification.service.js';
async function ownedSchedule(userId, scheduleId, db, lock = false) {
  return found(await one(`SELECT s.*,l.user_id FROM payment_schedules s JOIN loans l USING(loan_id) WHERE s.schedule_id=$1 AND l.user_id=$2${lock ? ' FOR UPDATE OF s' : ''}`, [id(scheduleId), userId], db));
}
const PERIOD_INTERVALS = {
  '1M': '1 month',
  '3M': '3 months',
  '6M': '6 months',
  '1Y': '1 year',
};

function buildScheduleQuery(req) {
  const params = [req.user.user_id];
  const conditions = ['l.user_id=$1'];
  if (req.query.loan_id) {
    params.push(id(req.query.loan_id));
    conditions.push(`s.loan_id=$${params.length}`);
  }
  const status = String(req.query.status || 'ALL').trim().toUpperCase();
  if (status === 'UPCOMING') {
    conditions.push("s.status <> 'PAID' AND s.status <> 'OVERDUE' AND s.due_date >= CURRENT_DATE");
  } else if (status === 'OVERDUE') {
    conditions.push("(s.status = 'OVERDUE' OR (s.status <> 'PAID' AND s.due_date < CURRENT_DATE))");
  } else if (status === 'PAID') {
    conditions.push("s.status = 'PAID'");
  } else if (status && status !== 'ALL') {
    const allowed = new Set(['PENDING', 'OVERDUE', 'PAID']);
    const mapped = status
      .split(',')
      .map(s => s.trim())
      .map(s => (s === 'UNPAID' ? 'PENDING' : s))
      .filter(s => allowed.has(s));
    if (!mapped.length) fail(400, 'Trạng thái lọc kỳ thanh toán không hợp lệ.');
    params.push(mapped);
    conditions.push(`s.status = ANY($${params.length})`);
  }

  const period = String(req.query.period || 'ALL').trim().toUpperCase();
  if (period && period !== 'ALL') {
    const interval = PERIOD_INTERVALS[period];
    if (!interval) fail(400, 'Khoảng thời gian lọc không hợp lệ.');
    conditions.push(`COALESCE(s.paid_at::date, s.due_date) >= (CURRENT_DATE - INTERVAL '${interval}')`);
  }

  const where = conditions.join(' AND ');
  const isPaginated = req.query.page !== undefined || req.query.limit !== undefined || req.query.paginated === 'true';
  let orderBy = 'ORDER BY s.due_date, s.installment_number';
  if (status === 'PAID') {
    orderBy = 'ORDER BY COALESCE(s.paid_at, s.due_date) DESC, s.due_date DESC, s.installment_number DESC';
  } else if (status === 'UPCOMING' || status === 'OVERDUE') {
    orderBy = 'ORDER BY s.due_date ASC, s.installment_number ASC';
  } else if (isPaginated) {
    orderBy = "ORDER BY CASE WHEN s.status = 'PAID' THEN 1 ELSE 0 END ASC, CASE WHEN s.status = 'PAID' THEN NULL ELSE s.due_date END ASC, s.due_date DESC, s.installment_number DESC";
  }

  return { params, where, orderBy, isPaginated };
}

async function computeScheduleSummary(userId, loanId) {
  const params = [userId];
  const loanFilter = loanId ? (params.push(id(loanId)), ` AND s.loan_id=$${params.length}`) : '';
  const row = await one(
    `SELECT
       COALESCE(SUM(CASE WHEN s.status = 'OVERDUE' OR (s.status <> 'PAID' AND s.due_date < CURRENT_DATE) THEN 1 ELSE 0 END), 0)::int AS overdue_count,
       COALESCE(SUM(CASE WHEN s.status <> 'PAID' AND s.status <> 'OVERDUE' AND s.due_date >= CURRENT_DATE THEN 1 ELSE 0 END), 0)::int AS upcoming_count,
       COALESCE(SUM(CASE WHEN s.status = 'PAID' THEN 1 ELSE 0 END), 0)::int AS paid_count,
       COUNT(*)::int AS total_count,
       COALESCE(SUM(CASE WHEN s.status <> 'PAID' AND date_trunc('month', s.due_date) = date_trunc('month', CURRENT_DATE) THEN s.total_amount ELSE 0 END), 0)::numeric AS current_month_due_amount
     FROM payment_schedules s
     JOIN loans l USING(loan_id)
     WHERE l.user_id=$1${loanFilter}`,
    params,
  );
  return {
    upcoming_count: Number(row?.upcoming_count ?? 0),
    overdue_count: Number(row?.overdue_count ?? 0),
    paid_count: Number(row?.paid_count ?? 0),
    total_count: Number(row?.total_count ?? 0),
    current_month_due_amount: Number(row?.current_month_due_amount ?? 0),
  };
}

export const getScheduleSummary = endpoint(req =>
  computeScheduleSummary(req.user.user_id, req.query.loan_id || null),
);

export const getSchedules = endpoint(async req => {
  const { params, where, orderBy, isPaginated } = buildScheduleQuery(req);
  if (!isPaginated) {
    return (await rows(`SELECT s.*,l.loan_name,l.lender_name FROM payment_schedules s JOIN loans l USING(loan_id) WHERE ${where} ${orderBy}`, params)).map(scheduleDto);
  }
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const countRow = await one(`SELECT COUNT(*)::int AS total FROM payment_schedules s JOIN loans l USING(loan_id) WHERE ${where}`, params);
  const total = Number(countRow?.total ?? 0);
  const listParams = [...params, limit, offset];
  const list = await rows(
    `SELECT s.*,l.loan_name,l.lender_name FROM payment_schedules s JOIN loans l USING(loan_id) WHERE ${where} ${orderBy} LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );
  const summary = await computeScheduleSummary(req.user.user_id, req.query.loan_id || null);
  return {
    data: list.map(scheduleDto),
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / limit)),
      has_more: offset + list.length < total,
    },
    summary,
  };
});
export const getScheduleDetail = endpoint(async req => scheduleDto(await ownedSchedule(req.user.user_id, req.params.scheduleId)));
export const markAsPaid = endpoint(async req => {
  const paid = await withTransaction(async db => {
    const initial = await ownedSchedule(req.user.user_id, req.params.scheduleId, db);
    // All payment and loan edits acquire the loan lock first to avoid deadlocks.
    const loan = found(await one('SELECT * FROM loans WHERE loan_id=$1 AND user_id=$2 FOR UPDATE', [initial.loan_id, req.user.user_id], db));
    const schedule = await ownedSchedule(req.user.user_id, req.params.scheduleId, db, true);
    if (schedule.status === 'PAID') fail(409, 'Kỳ nợ này đã được thanh toán.');
    if (!['ACTIVE','OVERDUE'].includes(loan.status)) fail(409, 'Chỉ thanh toán khoản vay đang hoạt động hoặc quá hạn.');
    if (Number(schedule.principal_amount) > Number(loan.outstanding_amount)) fail(409, 'Nợ gốc kỳ thanh toán vượt dư nợ còn lại.');
    await insert('payments', { schedule_id: schedule.schedule_id, paid_amount: schedule.total_amount, paid_date: new Date(), payment_method: 'MANUAL', transaction_reference: req.body.transaction_reference || null, note: req.body.note || null }, db);
    const updatedSchedule = await update('payment_schedules', { status: 'PAID', paid_at: new Date() }, 'schedule_id=$1', [schedule.schedule_id], db);
    await db.query("UPDATE loans SET outstanding_amount=GREATEST(0,outstanding_amount-$1),status=CASE WHEN outstanding_amount-$1<=0 THEN 'CLOSED' ELSE status END WHERE loan_id=$2", [schedule.principal_amount, schedule.loan_id]);
    const updatedLoan = await refreshLoanStatus(schedule.loan_id, db);
    await db.query("UPDATE notifications SET status='CANCELLED' WHERE schedule_id=$1 AND status='PENDING'", [schedule.schedule_id]);
    const remainingDebt = Number(updatedLoan?.outstanding_amount ?? Math.max(0, Number(loan.outstanding_amount) - Number(schedule.principal_amount)));
    await notifyBalanceFluctuation(req.user.user_id, {
      title: 'Biến động dư nợ sau thanh toán',
      message: `Đã thanh toán kỳ ${schedule.installment_number} (${loan.loan_name}): giảm ${Math.round(Number(schedule.principal_amount)).toLocaleString('vi-VN')} đ gốc. Dư nợ còn lại: ${Math.round(remainingDebt).toLocaleString('vi-VN')} đ.`,
      scheduleId: schedule.schedule_id,
      db,
      io: req.app?.get?.('io'),
    });
    const { cnt: unpaidCount } = await one(
      "SELECT count(*)::int AS cnt FROM payment_schedules WHERE loan_id=$1 AND status<>'PAID'",
      [schedule.loan_id],
      db,
    );
    if (remainingDebt > 0 && unpaidCount === 0) {
      const nextInst = Number(schedule.installment_number) + 1;
      const remainingMonths = Math.max(1, Number(loan.term_months) - Number(schedule.installment_number));
      const basePrincipal = Number(schedule.principal_amount) > 0
        ? Number(schedule.principal_amount)
        : Math.round((remainingDebt / remainingMonths) * 100) / 100;
      const nextPrincipal = remainingMonths === 1
        ? remainingDebt
        : Math.min(remainingDebt, basePrincipal);
      const interestBase = loan.interest_method === 'FLAT'
        ? Number(loan.principal_amount)
        : remainingDebt;
      const nextInterest = Math.round(interestBase * Number(loan.interest_rate) / 12 * 100) / 100;
      const nextTotal = Math.round((nextPrincipal + nextInterest) * 100) / 100;
      const nextRemaining = Math.max(0, Math.round((remainingDebt - nextPrincipal) * 100) / 100);
      const nextDueDate = nextInst === Number(loan.term_months) && loan.end_date
        ? new Date(loan.end_date).toISOString().slice(0, 10)
        : addMonths(loan.start_date, nextInst, loan.payment_day_of_month);
      await insert('payment_schedules', {
        loan_id: schedule.loan_id,
        installment_number: nextInst,
        due_date: nextDueDate,
        principal_amount: nextPrincipal,
        interest_amount: nextInterest,
        fee_amount: 0,
        total_amount: nextTotal,
        remaining_balance: nextRemaining,
        status: 'PENDING',
      }, db);
      await refreshLoanStatus(schedule.loan_id, db);
    }
    return scheduleDto(updatedSchedule);
  });
  triggerImmediateDispatch(req.app?.get?.('io'));
  return paid;
});
export const updateSchedule = endpoint(req => withTransaction(async db => {
  const initial = await ownedSchedule(req.user.user_id, req.params.scheduleId, db);
  await one('SELECT loan_id FROM loans WHERE loan_id=$1 FOR UPDATE', [initial.loan_id], db);
  const s = await ownedSchedule(req.user.user_id, req.params.scheduleId, db, true);
  if (s.status === 'PAID') fail(409, 'Không thể sửa kỳ đã thanh toán.');
  await update('payment_schedules', { due_date: date(req.body.due_date, 'due_date') }, 'schedule_id=$1', [s.schedule_id], db);
  await refreshLoanStatus(s.loan_id, db);
  await db.query('UPDATE loans SET end_date=(SELECT MAX(due_date) FROM payment_schedules WHERE loan_id=$1) WHERE loan_id=$1', [s.loan_id]);
  return scheduleDto(await ownedSchedule(req.user.user_id, req.params.scheduleId, db));
}));
async function preference(userId, db) {
  const p = await getUserNotificationPref(userId, db);
  return { ...p, id: p.preference_id };
}
export const getNotifPreference = endpoint(req => preference(req.user.user_id));
export const updateNotifPreference = endpoint(req => withTransaction(async db => {
  await db.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [req.user.user_id]);
  await preference(req.user.user_id, db);
  const b = pick(req.body, ['push_enabled','email_enabled','balance_fluctuation_enabled','monthly_statement_enabled','reminder_days']);
  booleans(b, ['push_enabled','email_enabled','balance_fluctuation_enabled','monthly_statement_enabled']);
  if (b.reminder_days !== undefined) number(b.reminder_days, 'reminder_days', 0, 30, true);
  const p = await update('notification_preferences', b, 'user_id=$1', [req.user.user_id], db);
  return { ...p, id: p.preference_id };
}));
export const getNotifications = endpoint(req => rows("SELECT * FROM notifications WHERE user_id=$1 AND status<>'DISMISSED' ORDER BY created_at DESC", [req.user.user_id]));
export const deleteNotification = endpoint(async req => found(await one("UPDATE notifications SET status='DISMISSED' WHERE notification_id=$1 AND user_id=$2 AND status<>'DISMISSED' RETURNING notification_id", [id(req.params.id), req.user.user_id])));
export const clearNotifications = endpoint(async req => {
  const deleted = await rows("UPDATE notifications SET status='DISMISSED' WHERE user_id=$1 AND status<>'DISMISSED' RETURNING notification_id", [req.user.user_id]);
  return { deleted_count: deleted.length };
});
export const syncSchedules = endpoint(req => withTransaction(async db => {
  await db.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [req.user.user_id]);
  const p = await preference(req.user.user_id, db);
  const loans = await rows("SELECT loan_id FROM loans WHERE user_id=$1 AND status IN ('ACTIVE','OVERDUE') ORDER BY loan_id FOR UPDATE", [req.user.user_id], db);
  for (const loan of loans) await refreshLoanStatus(loan.loan_id, db);
  const cancelled = await rows("UPDATE notifications n SET status='CANCELLED' WHERE n.user_id=$1 AND n.notification_type='PAYMENT_REMINDER' AND n.status='PENDING' AND ((n.channel='PUSH' AND NOT $2) OR (n.channel='EMAIL' AND NOT $3) OR NOT EXISTS(SELECT 1 FROM payment_schedules s JOIN loans l USING(loan_id) WHERE s.schedule_id=n.schedule_id AND s.status<>'PAID' AND l.status IN ('ACTIVE','OVERDUE'))) RETURNING notification_id", [req.user.user_id,p.push_enabled,p.email_enabled], db);
  const schedules = await rows("SELECT s.* FROM payment_schedules s JOIN loans l USING(loan_id) WHERE l.user_id=$1 AND s.status IN ('PENDING','OVERDUE') AND l.status IN ('ACTIVE','OVERDUE')", [req.user.user_id], db);
  let created = 0;
  for (const s of schedules) for (const channel of ['PUSH','EMAIL']) {
    if (!(channel === 'PUSH' ? p.push_enabled : p.email_enabled)) continue;
    const existing = await one("SELECT notification_id,status FROM notifications WHERE schedule_id=$1 AND channel=$2 AND notification_type='PAYMENT_REMINDER' AND status IN ('SENT','PENDING','DISMISSED') ORDER BY notification_id DESC LIMIT 1", [s.schedule_id, channel], db);
    if (existing?.status === 'SENT' || existing?.status === 'DISMISSED') continue;
    const scheduled = new Date(s.due_date); scheduled.setUTCDate(scheduled.getUTCDate() - p.reminder_days);
    if (existing) { await db.query('UPDATE notifications SET scheduled_at=$1 WHERE notification_id=$2',[scheduled,existing.notification_id]); continue; }
    await insert('notifications', { user_id: req.user.user_id, schedule_id: s.schedule_id, notification_type: 'PAYMENT_REMINDER', channel, title: 'Nhắc thanh toán khoản vay', message: `Kỳ ${s.installment_number}: ${Math.round(Number(s.total_amount)).toLocaleString('vi-VN')} đ`, scheduled_at: scheduled }, db); created++;
  }
  return { cancelled_count: cancelled.length, created_count: created };
}));
