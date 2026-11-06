// src/models/payment.model.js — Bảng payments (khớp payment_model.dart)
import { query } from '../config/db.js';

export const PaymentModel = {
  async findByScheduleId(scheduleId) {
    return await query(
      'SELECT payment_id, schedule_id, paid_amount, paid_date, payment_method, transaction_reference, note, created_at FROM payments WHERE schedule_id = $1 ORDER BY paid_date DESC',
      [scheduleId]
    );
  },

  async findByUserId(userId) {
    const sql = `
      SELECT p.*, ps.loan_id, l.loan_name
      FROM payments p
      JOIN payment_schedules ps ON p.schedule_id = ps.schedule_id
      JOIN loans l ON ps.loan_id = l.loan_id
      WHERE l.user_id = $1
      ORDER BY p.paid_date DESC
    `;
    return await query(sql, [userId]);
  },

  /**
   * Tạo giao dịch thanh toán, đổi trạng thái schedule sang PAID, trừ nợ gốc còn lại của khoản vay
   */
  async recordPayment({ schedule_id, paid_amount, payment_method = 'BANK_TRANSFER', transaction_reference, note }) {
    // 1. Cập nhật kỳ thanh toán sang PAID
    const updateScheduleSql = `
      UPDATE payment_schedules
      SET status = 'PAID'
      WHERE schedule_id = $1
      RETURNING *
    `;
    const scheduleRows = await query(updateScheduleSql, [schedule_id]);
    const schedule = scheduleRows[0];
    if (!schedule) return null;

    const amount = paid_amount || schedule.total_amount;

    // 2. Chèn bản ghi vào bảng payments
    const insertPaymentSql = `
      INSERT INTO payments (
        schedule_id, paid_amount, paid_date, payment_method, transaction_reference, note
      ) VALUES ($1, $2, NOW(), $3, $4, $5)
      RETURNING *
    `;
    const paymentRows = await query(insertPaymentSql, [
      schedule_id,
      amount,
      payment_method,
      transaction_reference || `TXN-${Date.now()}`,
      note || 'Thanh toán qua ứng dụng FinCredit',
    ]);

    // 3. Trừ nợ gốc còn lại của khoản vay
    await query(
      'UPDATE loans SET outstanding_amount = GREATEST(0, outstanding_amount - $1), updated_at = NOW() WHERE loan_id = $2',
      [schedule.principal_amount, schedule.loan_id]
    );

    return {
      payment: paymentRows[0],
      schedule,
    };
  },
};
