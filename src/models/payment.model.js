// src/models/payment.model.js — Bảng payments (khớp payment_model.dart)
import { query, withTransaction } from '../config/db.js';

export const PaymentModel = {
  async findByScheduleId(scheduleId) {
    return await query(
      'SELECT payment_id, schedule_id, paid_amount, paid_date, payment_method, transaction_reference, note, created_at FROM payments WHERE schedule_id = $1 ORDER BY paid_date DESC',
      [scheduleId]
    );
  },

  /**
   * Lấy lịch sử thanh toán theo user_id (hỗ trợ phân trang tùy chọn)
   */
  async findByUserId(userId, { limit, offset, page } = {}) {
    let sql = `
      SELECT p.*, ps.loan_id, l.loan_name
      FROM payments p
      JOIN payment_schedules ps ON p.schedule_id = ps.schedule_id
      JOIN loans l ON ps.loan_id = l.loan_id
      WHERE l.user_id = $1
      ORDER BY p.paid_date DESC
    `;
    const params = [userId];

    if (limit !== undefined) {
      const parsedLimit = Math.max(1, parseInt(limit, 10) || 20);
      const parsedOffset = offset !== undefined
        ? Math.max(0, parseInt(offset, 10) || 0)
        : (page ? Math.max(0, (parseInt(page, 10) - 1) * parsedLimit) : 0);
      params.push(parsedLimit, parsedOffset);
      sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
    }

    return await query(sql, params);
  },

  /**
   * Tạo giao dịch thanh toán trong Database Transaction (ACID):
   * 1. Cập nhật kỳ thanh toán sang PAID
   * 2. Chèn bản ghi giao dịch thanh toán vào payments
   * 3. Khấu trừ số dư nợ gốc còn lại của khoản vay (outstanding_amount)
   * Tự động ROLLBACK toàn bộ nếu có bất kỳ bước nào lỗi.
   */
  async recordPayment({ schedule_id, paid_amount, payment_method = 'BANK_TRANSFER', transaction_reference, note }) {
    return await withTransaction(async (client) => {
      // 1. Cập nhật kỳ thanh toán sang PAID
      const updateScheduleSql = `
        UPDATE payment_schedules
        SET status = 'PAID'
        WHERE schedule_id = $1
        RETURNING *
      `;
      const scheduleRes = await client.query(updateScheduleSql, [schedule_id]);
      const schedule = scheduleRes.rows[0];
      if (!schedule) return null;

      const amount = paid_amount || schedule.total_amount;

      // 2. Chèn bản ghi vào bảng payments
      const insertPaymentSql = `
        INSERT INTO payments (
          schedule_id, paid_amount, paid_date, payment_method, transaction_reference, note
        ) VALUES ($1, $2, NOW(), $3, $4, $5)
        RETURNING *
      `;
      const paymentRes = await client.query(insertPaymentSql, [
        schedule_id,
        amount,
        payment_method,
        transaction_reference || `TXN-${Date.now()}`,
        note || 'Thanh toán qua ứng dụng FinCredit',
      ]);

      // 3. Trừ nợ gốc còn lại của khoản vay
      await client.query(
        'UPDATE loans SET outstanding_amount = GREATEST(0, outstanding_amount - $1), updated_at = NOW() WHERE loan_id = $2',
        [schedule.principal_amount, schedule.loan_id]
      );

      return {
        payment: paymentRes.rows[0],
        schedule,
      };
    });
  },
};
