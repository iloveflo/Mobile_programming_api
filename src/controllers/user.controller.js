// src/controllers/user.controller.js — Module 1 (tiếp): User Profile Controller

export async function getProfile(req, res, next) {
  // TODO: gọi userService.getProfile(req.user.user_id)
  res.json({ success: true, data: {} });
}

export async function updateProfile(req, res, next) {
  // TODO: gọi userService.updateProfile(req.user.user_id, req.body)
  res.json({ success: true, data: {} });
}

export async function updateSecuritySettings(req, res, next) {
  // TODO: gọi userService.updateSecuritySettings(req.user.user_id, req.body)
  res.json({ success: true, data: {} });
}

export async function exportFinancialPdf(req, res, next) {
  // TODO: gọi userService.exportFinancialPdf(req.user.user_id)
  res.json({ success: true, data: { pdf_url: '', file_key: '' } });
}

export async function verifyEkyc(req, res, next) {
  // TODO: gọi userService.verifyEkyc(req.user.user_id, req.body)
  res.json({ success: true, data: {} });
}

export async function getBankAccounts(req, res, next) {
  // TODO: gọi userService.getBankAccounts(req.user.user_id)
  res.json({ success: true, data: [] });
}

export async function addBankAccount(req, res, next) {
  // TODO: gọi userService.addBankAccount(req.user.user_id, req.body)
  res.status(201).json({ success: true, data: {} });
}

export async function deleteBankAccount(req, res, next) {
  // TODO: gọi userService.deleteBankAccount(req.user.user_id, req.params.id)
  res.json({ success: true, message: 'Xóa tài khoản ngân hàng thành công.' });
}
