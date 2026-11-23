import pool from '../config/db.js';
import { createError } from '../middlewares/error.middleware.js';

export const fail = (status, message) => { throw createError(status, message); };
export const found = (value) => value || fail(404, 'Không tìm thấy dữ liệu.');
export const endpoint = (fn, status = 200) => async (req, res, next) => {
  try { res.status(status).json({ success: true, message: 'Thao tác thành công.', data: await fn(req) }); } catch (error) { next(error); }
};
export function text(value, field, max = 255) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `${field} không hợp lệ.`);
  return value.trim();
}
export function number(value, field, min = 0, max = 1e13, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(400, `${field} không hợp lệ.`);
  return value;
}
export function choice(value, field, values) {
  if (!values.includes(value)) fail(400, `${field} không hợp lệ.`);
  return value;
}
export function id(value) {
  if (!/^[1-9]\d*$/.test(String(value))) fail(400, 'Mã bản ghi phải là số nguyên dương.');
  return String(value);
}
export function date(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)) fail(400, `${field} không hợp lệ.`);
  return value.slice(0, 10);
}
export function booleans(data, keys) {
  for (const key of keys) if (data[key] !== undefined && typeof data[key] !== 'boolean') fail(400, `${key} phải là boolean.`);
}
export const safeUser = ({ password_hash, failed_login_attempts, ...user }) => user;
export async function rows(sql, params = [], db = pool) { return (await db.query(sql, params)).rows; }
export async function one(sql, params = [], db = pool) { return (await rows(sql, params, db))[0]; }
// Table and column names are supplied only by server-side whitelists.
export async function insert(table, data, db = pool) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  return one(`INSERT INTO ${table} (${entries.map(([k]) => k).join(',')}) VALUES (${entries.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, entries.map(([, v]) => v), db);
}
export async function update(table, data, where, params, db = pool) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (!entries.length) fail(400, 'Không có trường hợp lệ để cập nhật.');
  return found(await one(`UPDATE ${table} SET ${entries.map(([k], i) => `${k}=$${params.length + i + 1}`).join(',')} WHERE ${where} RETURNING *`, [...params, ...entries.map(([, v]) => v)], db));
}
export const pick = (data, keys) => Object.fromEntries(keys.filter(k => data[k] !== undefined).map(k => [k, data[k]]));
