// src/controllers/schedule.controller.js — Module 5: Payment Schedule & Notification Controller

export async function getSchedules(req, res, next) {
  // TODO: gọi scheduleService.getSchedules(req.user.user_id, req.query)
  res.json({ success: true, data: [] });
}

export async function getScheduleDetail(req, res, next) {
  // TODO: gọi scheduleService.getScheduleDetail(req.params.scheduleId)
  res.json({ success: true, data: {} });
}

export async function markAsPaid(req, res, next) {
  // TODO: gọi scheduleService.markAsPaid(req.params.scheduleId, req.user.user_id)
  // Sau khi cập nhật DB, trigger pg_notify → socket.io sẽ tự bắn event xuống Flutter
  res.json({ success: true, data: {} });
}

export async function updateSchedule(req, res, next) {
  // TODO: gọi scheduleService.updateSchedule(req.params.scheduleId, req.body)
  res.json({ success: true, data: {} });
}

export async function syncSchedules(req, res, next) {
  // TODO: gọi scheduleService.syncSchedules(req.user.user_id)
  res.json({ success: true, cancelled_count: 0 });
}

export async function getNotifications(req, res, next) {
  // TODO: gọi scheduleService.getNotifications(req.user.user_id, req.query)
  res.json({ success: true, data: [] });
}

export async function getNotifPreference(req, res, next) {
  // TODO: gọi scheduleService.getNotifPreference(req.user.user_id)
  res.json({ success: true, data: {} });
}

export async function updateNotifPreference(req, res, next) {
  // TODO: gọi scheduleService.updateNotifPreference(req.user.user_id, req.body)
  res.json({ success: true, data: {} });
}
