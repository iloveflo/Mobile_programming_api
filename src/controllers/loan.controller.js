// src/controllers/loan.controller.js — Module 2: Loan Controller

export async function getLoans(req, res, next) {
  // TODO: gọi loanService.getLoans(req.user.user_id, req.query)
  res.json({ success: true, data: [] });
}

export async function getLoanDetail(req, res, next) {
  // TODO: gọi loanService.getLoanDetail(req.params.loanId, req.user.user_id)
  res.json({ success: true, data: {} });
}

export async function createLoan(req, res, next) {
  // TODO: gọi loanService.createLoan(req.user.user_id, req.body)
  res.status(201).json({ success: true, data: {} });
}

export async function updateLoan(req, res, next) {
  // TODO: gọi loanService.updateLoan(req.params.loanId, req.user.user_id, req.body)
  res.json({ success: true, data: {} });
}

export async function deleteLoan(req, res, next) {
  // TODO: gọi loanService.deleteLoan(req.params.loanId, req.user.user_id)
  res.json({ success: true, message: 'Xóa khoản vay thành công.' });
}

export async function getLoanAssets(req, res, next) {
  // TODO: gọi loanService.getLoanAssets(req.params.loanId)
  res.json({ success: true, data: [] });
}

export async function getLoanDocuments(req, res, next) {
  // TODO: gọi loanService.getLoanDocuments(req.params.loanId)
  res.json({ success: true, data: [] });
}

export async function addCollateral(req, res, next) {
  // TODO: gọi loanService.addCollateral(req.user.user_id, req.body)
  res.status(201).json({ success: true, data: {} });
}

export async function ocrScan(req, res, next) {
  // TODO: gọi loanService.ocrScan(req.body.image_path)
  res.json({ success: true, data: { lender: '', principal_amount: 0, interest_rate: 0, term_months: 0, start_date: '' } });
}
