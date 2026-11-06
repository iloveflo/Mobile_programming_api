// src/controllers/simulation.controller.js — Module 6: Simulation Controller

export async function getSimulations(req, res, next) {
  // TODO: gọi simulationService.getSimulations(req.user.user_id, req.query)
  res.json({ success: true, data: [] });
}

export async function createSimulation(req, res, next) {
  // TODO: gọi simulationService.createSimulation(req.user.user_id, req.body)
  res.status(201).json({ success: true, data: {} });
}

export async function deleteSimulation(req, res, next) {
  // TODO: gọi simulationService.deleteSimulation(req.params.simulationId, req.user.user_id)
  res.json({ success: true, message: 'Xóa kịch bản mô phỏng thành công.' });
}
