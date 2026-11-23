import { fail } from '../utils/api.js';
// Only operator-configured URLs are fetched. Client image URLs are passed as data.
export async function callProvider(name, payload) {
  const url = process.env[`${name}_PROVIDER_URL`];
  if (!url) fail(503, `Dịch vụ ${name} chưa được cấu hình.`);
  let response;
  try { response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env[`${name}_PROVIDER_TOKEN`] || ''}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) }); }
  catch { fail(502, `Không kết nối được dịch vụ ${name}.`); }
  if (!response.ok) fail(502, `Dịch vụ ${name} xử lý thất bại.`);
  try { return await response.json(); } catch { fail(502, `Phản hồi ${name} không hợp lệ.`); }
}
