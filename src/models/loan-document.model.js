// src/models/loan-document.model.js — Bảng loan_documents (khớp loan_document_model.dart)
import { query } from '../config/db.js';

export const LoanDocumentModel = {
  async findByLoanId(loanId) {
    return await query(
      'SELECT document_id, loan_id, document_type, file_url, ocr_status, ocr_result, created_at, updated_at FROM loan_documents WHERE loan_id = $1 ORDER BY created_at DESC',
      [loanId]
    );
  },

  async create(data) {
    const sql = `
      INSERT INTO loan_documents (
        loan_id, document_type, file_url, ocr_status, ocr_result
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const params = [
      data.loan_id,
      data.document_type || 'CONTRACT',
      data.file_url,
      data.ocr_status || 'PENDING',
      data.ocr_result ? JSON.stringify(data.ocr_result) : null,
    ];
    const rows = await query(sql, params);
    return rows[0];
  },
};
