// src/controllers/credit.controller.js — Module 3: Credit Profile & Reports

export async function getCreditProfile(req, res, next) {
  // TODO: gọi creditService.getCreditProfile(req.user.user_id)
  // Nếu chưa có hồ sơ → trả 404 để Flutter hiển thị CreditEmptyState
  res.json({ success: true, data: {} });
}

export async function recalculate(req, res, next) {
  // TODO: gọi creditService.recalculate(req.user.user_id)
  res.json({ success: true, data: {} });
}

export async function getCreditReports(req, res, next) {
  // TODO: gọi creditService.getCreditReports(req.user.user_id)
  res.json({ success: true, data: [] });
}

export async function getCreditReportDetail(req, res, next) {
  // TODO: gọi creditService.getCreditReportDetail(req.params.id)
  res.json({ success: true, data: {} });
}

export async function generateCreditReport(req, res, next) {
  // TODO: gọi creditService.generateCreditReport(req.user.user_id, req.body.report_period)
  // Nếu kỳ đã tồn tại → trả 409 Conflict
  res.status(201).json({ success: true, data: {} });
}
