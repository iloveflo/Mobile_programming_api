import nodemailer from 'nodemailer';
import { withTransaction } from '../config/db.js';
import { insert, one, rows } from '../utils/api.js';
import { renderNotificationEmail } from '../utils/email-templates.js';
import { sendPushToUser } from './push.service.js';

function formatVnd(amount) {
  return `${Math.round(Number(amount || 0)).toLocaleString('vi-VN')} đ`;
}

/**
 * Đảm bảo user luôn có bản ghi notification_preferences và trả về cấu hình hiện tại.
 */
export async function getUserNotificationPref(userId, db) {
  await (db
    ? db.query('INSERT INTO notification_preferences(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING', [userId])
    : rows('INSERT INTO notification_preferences(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING', [userId]));
  return one('SELECT * FROM notification_preferences WHERE user_id=$1', [userId], db);
}

/**
 * Gửi email thông báo qua SMTP (dùng chung cấu hình SMTP với OTP).
 */
export async function sendEmailNotification({ to, subject, text, html, mailer }) {
  if (!to) return false;
  if (typeof mailer === 'function') {
    await mailer({ to, subject, text, html });
    return true;
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV EMAIL] To=${to} | Subject=${subject}`);
      return true;
    }
    return false;
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
    });
    return true;
  } finally {
    transport.close();
  }
}

/**
 * Tạo thông báo biến động dư nợ khi giải ngân/tạo khoản vay mới hoặc thanh toán kỳ nợ
 * (Thông báo bình thường: chỉ gửi kênh PUSH -> Trong app + Màn hình điện thoại, không gửi Email).
 */
export async function notifyBalanceFluctuation(userId, { title, message, scheduleId = null, db, io }) {
  const pref = await getUserNotificationPref(userId, db);
  if (!pref || !pref.balance_fluctuation_enabled || !pref.push_enabled) return [];

  const notif = await insert(
    'notifications',
    {
      user_id: userId,
      schedule_id: scheduleId,
      notification_type: 'BALANCE_FLUCTUATION',
      channel: 'PUSH',
      title,
      message,
      scheduled_at: new Date(),
      sent_at: new Date(),
      status: 'SENT',
    },
    db,
  );
  if (io) {
    io.to(`user_${userId}`).emit('notification', notif);
  }
  await sendPushToUser(
    userId,
    {
      title,
      body: message,
      data: {
        notificationId: notif.notification_id,
        notificationType: 'BALANCE_FLUCTUATION',
        tabIndex: 2,
        ...(scheduleId ? { scheduleId } : {}),
      },
    },
    db,
  ).catch(() => {});
  return [notif];
}

/**
 * Tự động phát sinh cảnh báo quá hạn (OVERDUE_ALERT) cho các kỳ đã quá hạn chưa thanh toán.
 * Đây là thông báo QUAN TRỌNG -> gửi đủ cả 3: Email + Trong app + Màn hình điện thoại (chống trùng theo schedule_id + channel).
 */
export async function generateOverdueAlerts(io, dbClient) {
  const run = async db => {
    const overdueRows = await rows(
      `SELECT s.schedule_id, s.installment_number, s.due_date, s.total_amount,
              l.user_id, l.loan_name,
              COALESCE(np.push_enabled, TRUE) AS push_enabled,
              COALESCE(np.email_enabled, TRUE) AS email_enabled
       FROM payment_schedules s
       JOIN loans l USING(loan_id)
       LEFT JOIN notification_preferences np ON np.user_id = l.user_id
       WHERE l.status IN ('ACTIVE', 'OVERDUE')
         AND s.status <> 'PAID'
         AND s.due_date < CURRENT_DATE`,
      [],
      db,
    );

    let created = 0;
    for (const row of overdueRows) {
      const dueStr = new Date(row.due_date).toISOString().slice(0, 10).split('-').reverse().join('/');
      const title = 'Cảnh báo kỳ thanh toán quá hạn';
      const message = `Kỳ ${row.installment_number} khoản vay "${row.loan_name}" (${formatVnd(row.total_amount)}) đã quá hạn ngày ${dueStr}. Vui lòng thanh toán sớm để bảo vệ điểm tín dụng.`;

      for (const channel of ['PUSH', 'EMAIL']) {
        if (channel === 'PUSH' && !row.push_enabled) continue;
        if (channel === 'EMAIL' && !row.email_enabled) continue;

        const exists = await one(
          `SELECT notification_id FROM notifications
           WHERE schedule_id = $1 AND channel = $2 AND notification_type = 'OVERDUE_ALERT'
             AND status IN ('SENT', 'PENDING', 'DISMISSED')
           LIMIT 1`,
          [row.schedule_id, channel],
          db,
        );
        if (exists) continue;

        const isPush = channel === 'PUSH';
        const notif = await insert(
          'notifications',
          {
            user_id: row.user_id,
            schedule_id: row.schedule_id,
            notification_type: 'OVERDUE_ALERT',
            channel,
            title,
            message,
            scheduled_at: new Date(),
            sent_at: isPush ? new Date() : null,
            status: isPush ? 'SENT' : 'PENDING',
          },
          db,
        );
        created++;
        if (isPush && io) {
          io.to(`user_${row.user_id}`).emit('notification', notif);
        }
      }
    }
    return { created };
  };
  return dbClient ? run(dbClient) : withTransaction(run);
}

/**
 * Tạo thông báo sao kê tín dụng định kỳ vào ngày 01 hàng tháng cho các user bật
 * monthly_statement_enabled + email_enabled (chống trùng theo tháng YYYY-MM).
 */
export async function generateMonthlyStatements(now = new Date(), { force = false } = {}) {
  if (!force && now.getUTCDate() !== 1) return { created: 0 };
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const title = `Sao kê tín dụng định kỳ Tháng ${month}/${year}`;

  return withTransaction(async db => {
    const eligibleUsers = await rows(
      `SELECT u.user_id, u.full_name, u.email
       FROM users u
       JOIN notification_preferences np ON np.user_id = u.user_id
       WHERE u.is_active = TRUE
         AND np.monthly_statement_enabled = TRUE
         AND np.email_enabled = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.user_id = u.user_id
             AND n.notification_type = 'MONTHLY_STATEMENT'
             AND n.title = $1
         )`,
      [title],
      db,
    );

    let created = 0;
    for (const user of eligibleUsers) {
      const summary = await one(
        `SELECT
           COUNT(*)::int AS active_count,
           COALESCE(SUM(outstanding_amount), 0) AS total_debt,
           COALESCE(AVG(interest_rate) * 100, 0) AS avg_rate
         FROM loans
         WHERE user_id = $1 AND status IN ('ACTIVE', 'OVERDUE')`,
        [user.user_id],
        db,
      );
      const message = [
        `Xin chào ${user.full_name || 'Quý khách'},`,
        `Báo cáo sao kê tín dụng định kỳ Tháng ${month}/${year}:`,
        `- Số khoản vay đang hoạt động: ${summary.active_count}`,
        `- Tổng dư nợ hiện tại: ${formatVnd(summary.total_debt)}`,
        `- Lãi suất bình quân: ${Number(summary.avg_rate).toFixed(2)}%/năm`,
        `Trân trọng, FinCredit.`,
      ].join('\n');

      await insert(
        'notifications',
        {
          user_id: user.user_id,
          schedule_id: null,
          notification_type: 'MONTHLY_STATEMENT',
          channel: 'EMAIL',
          title,
          message,
          scheduled_at: now,
          status: 'PENDING',
        },
        db,
      );
      created++;
    }
    return { created };
  });
}

/**
 * Worker quét và gửi các thông báo đến hạn (status = 'PENDING' và scheduled_at <= NOW()).
 */
export async function dispatchDueNotifications(io, { mailer, limit = 50 } = {}) {
  return withTransaction(async db => {
    const dueRows = await rows(
      `SELECT n.*, u.email, u.full_name,
              COALESCE(np.push_enabled, TRUE) AS push_enabled,
              COALESCE(np.email_enabled, TRUE) AS email_enabled
       FROM notifications n
       JOIN users u ON u.user_id = n.user_id
       LEFT JOIN notification_preferences np ON np.user_id = n.user_id
       WHERE n.status = 'PENDING'
         AND (n.scheduled_at IS NULL OR n.scheduled_at <= NOW())
       ORDER BY n.scheduled_at ASC NULLS FIRST, n.notification_id ASC
       LIMIT $1
       FOR UPDATE OF n SKIP LOCKED`,
      [limit],
      db,
    );

    let sent = 0;
    let cancelled = 0;
    let failed = 0;

    for (const n of dueRows) {
      if (n.channel === 'EMAIL') {
        if (!n.email_enabled || !n.email) {
          await db.query("UPDATE notifications SET status='CANCELLED' WHERE notification_id=$1", [n.notification_id]);
          cancelled++;
          continue;
        }
        try {
          const mail = renderNotificationEmail({
            fullName: n.full_name,
            title: n.title,
            message: n.message,
            notificationType: n.notification_type,
          });
          const ok = await sendEmailNotification({
            to: n.email,
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
            mailer,
          });
          if (ok) {
            await db.query("UPDATE notifications SET status='SENT', sent_at=NOW() WHERE notification_id=$1", [n.notification_id]);
            sent++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      } else {
        if (!n.push_enabled) {
          await db.query("UPDATE notifications SET status='CANCELLED' WHERE notification_id=$1", [n.notification_id]);
          cancelled++;
          continue;
        }
        if (io) {
          io.to(`user_${n.user_id}`).emit('notification', n);
        }
        await sendPushToUser(
          n.user_id,
          {
            title: n.title,
            body: n.message,
            data: {
              notificationId: n.notification_id,
              notificationType: n.notification_type,
              tabIndex: 2,
              ...(n.schedule_id ? { scheduleId: n.schedule_id } : {}),
            },
          },
          db,
        ).catch(() => {});
        await db.query("UPDATE notifications SET status='SENT', sent_at=NOW() WHERE notification_id=$1", [n.notification_id]);
        sent++;
      }
    }

    return { processed: dueRows.length, sent, cancelled, failed };
  });
}

export function triggerImmediateDispatch(io) {
  if (process.env.NODE_ENV === 'test') return;
  setImmediate(() => {
    dispatchDueNotifications(io).catch(error => {
      console.error('[IMMEDIATE DISPATCH]', error.message);
    });
  });
}

export function startNotificationWorker(io, intervalMs = 60000) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await generateOverdueAlerts(io);
      await generateMonthlyStatements(new Date());
      await dispatchDueNotifications(io);
    } catch (error) {
      console.error('[NOTIFICATION WORKER]', error.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref();
  run();
  return () => clearInterval(timer);
}
