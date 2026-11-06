// src/controllers/debt.controller.js — Module 4: Debt Strategy Controller

export async function getStrategies(req, res, next) {
  // TODO: gọi debtService.getStrategies(req.user.user_id)
  res.json({ success: true, data: [] });
}

export async function getActiveStrategy(req, res, next) {
  // TODO: gọi debtService.getActiveStrategy(req.user.user_id)
  res.json({ success: true, data: null });
}

export async function applyStrategy(req, res, next) {
  // TODO: gọi debtService.applyStrategy(req.user.user_id, req.body)
  res.status(201).json({ success: true, data: {} });
}

export async function cancelStrategy(req, res, next) {
  // TODO: gọi debtService.cancelStrategy(req.params.strategyId, req.user.user_id)
  res.json({ success: true, message: 'Hủy chiến lược trả nợ thành công.' });
}
