import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomInt, randomBytes, createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import { withTransaction } from '../config/db.js';
import { one, rows, insert, fail, text, number, booleans, safeUser, choice, date } from '../utils/api.js';
import { renderOtpEmail } from '../utils/email-templates.js';
export const hashToken = value => createHash('sha256').update(value).digest('hex');
const sign = (payload, expiresIn) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn, algorithm: 'HS256' });
export function decode(token, type) {
  try { const value = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }); if (value.type !== type) throw new Error(); return value; }
  catch { fail(401, 'Token không hợp lệ hoặc đã hết hạn.'); }
}
export function password(value) { text(value, 'password', 72); if (Buffer.byteLength(value) > 72 || value.length < 8) fail(400, 'Mật khẩu phải có từ 8 đến 72 byte.'); return value; }
const findUser = (identifier, db) => one('SELECT * FROM users WHERE lower(email)=lower($1) OR phone=$1 OR id_card_number=$1', [text(identifier, 'identifier', 150)], db);
export function checkUser(user) {
  if (!user) fail(401, 'Phiên đăng nhập không hợp lệ.');
  if ((user.is_locked && !user.lock_until) || (user.lock_until && new Date(user.lock_until) > new Date())) fail(403, 'Tài khoản bị tạm khóa do vi phạm chính sách bảo mật.');
  if (!user.is_active) fail(403, 'Tài khoản chưa được kích hoạt qua OTP.');
}
export async function deliverOtp(user, code, purpose = 'REGISTER') {
  if (process.env.OTP_DELIVERY === 'console' && process.env.NODE_ENV !== 'production') {
    console.log(`[DEV OTP] ${user.email}: ${code}`); return;
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) fail(503, 'Chưa cấu hình dịch vụ gửi email OTP.');
  const expiresSeconds = Number(process.env.OTP_EXPIRES_IN_SECONDS || 120);
  const mail = renderOtpEmail({ fullName: user.full_name, code, purpose, expiresSeconds });
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, connectionTimeout: 10000, socketTimeout: 15000 });
  try { await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: user.email, subject: mail.subject, text: mail.text, html: mail.html }); }
  catch { fail(502, 'Không gửi được email OTP. Vui lòng thử lại.'); }
  finally { transport.close(); }
}
async function issueOtp(db, user, purpose, extraClaims = {}) {
  const latest = await one('SELECT created_at FROM otp_verifications WHERE user_id=$1 AND purpose=$2 ORDER BY otp_id DESC LIMIT 1', [user.user_id, purpose], db);
  if (latest && Date.now() - new Date(latest.created_at).getTime() < 60000) fail(429, 'Vui lòng đợi 60 giây trước khi gửi lại OTP.');
  await db.query("UPDATE otp_verifications SET status='SUPERSEDED' WHERE user_id=$1 AND purpose=$2 AND status='PENDING'", [user.user_id, purpose]);
  const code = String(randomInt(100000, 1000000));
  const otp = await insert('otp_verifications', { user_id: user.user_id, email: user.email, phone: user.phone, otp_code: await bcrypt.hash(code, 10), purpose, expires_at: new Date(Date.now() + Number(process.env.OTP_EXPIRES_IN_SECONDS || 120) * 1000) }, db);
  await deliverOtp(user, code, purpose);
  return { user_id: user.user_id, challenge_token: sign({ type: 'otp', user_id: user.user_id, otp_id: otp.otp_id, purpose, ...extraClaims }, '10m') };
}
async function tokenPair(db, user, info, days) {
  const raw = randomBytes(48).toString('base64url');
  const hasExplicitDevice = typeof info.device_name === 'string' && info.device_name.trim().length > 0;
  const deviceName = String(info.device_name || 'Mobile Device').slice(0, 150);
  const platform = String(info.platform || 'Flutter').slice(0, 100);
  // Chỉ tự động thu hồi phiên cũ trùng thiết bị khi client gửi định danh thiết bị cụ thể
  if (hasExplicitDevice) {
    await db.query(
      'UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND device_name=$2 AND platform=$3 AND revoked_at IS NULL',
      [user.user_id, deviceName, platform]
    );
  }
  const session = await insert('refresh_tokens', { user_id: user.user_id, token: hashToken(raw), device_name: deviceName, platform, ip_address: info.ip_address, expires_at: new Date(Date.now() + days * 86400000) }, db);
  return sessionData(user, session, raw);
}
function sessionData(user, session, raw) {
  const access = sign({ type: 'access', user_id: user.user_id, session_id: session.token_id }, process.env.JWT_EXPIRES_IN || '15m');
  return { token: access, accessToken: access, refreshToken: raw, access_token: access, refresh_token: raw, expires_at: new Date(jwt.decode(access).exp * 1000).toISOString(), user_id: user.user_id, user: safeUser(user) };
}
export const AuthService = {
  async register(data) {
    const email = text(data.email, 'email', 150).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Email không hợp lệ.');
    const password_hash = await bcrypt.hash(password(data.password), 10);
    if (data.monthly_income !== undefined) number(data.monthly_income, 'monthly_income');
    if (data.date_of_birth) date(data.date_of_birth, 'date_of_birth');
    if (data.phone && !/^\+?\d{9,15}$/.test(data.phone)) fail(400, 'Số điện thoại không hợp lệ.');
    if (data.id_card_number && !/^\d{12}$/.test(data.id_card_number)) fail(400, 'CCCD phải có 12 chữ số.');
    return withTransaction(async db => {
      const existing = await one('SELECT * FROM users WHERE lower(email)=lower($1) FOR UPDATE', [email], db);
      if (existing && !existing.is_active) {
        const updated = await one(
          `UPDATE users SET full_name=$2, password_hash=$3, phone=COALESCE($4, phone),
            monthly_income=COALESCE($5, monthly_income), date_of_birth=COALESCE($6, date_of_birth),
            id_card_number=COALESCE($7, id_card_number), address=COALESCE($8, address),
            occupation=COALESCE($9, occupation), workplace=COALESCE($10, workplace),
            contract_type=COALESCE($11, contract_type)
           WHERE user_id=$1 RETURNING *`,
          [
            existing.user_id, text(data.full_name, 'full_name', 100), password_hash,
            data.phone || null, data.monthly_income ?? null, data.date_of_birth || null,
            data.id_card_number || null, data.address ?? null, data.occupation ?? null,
            data.workplace ?? null, data.contract_type ?? null,
          ],
          db,
        );
        return issueOtp(db, updated, 'REGISTER');
      }
      const user = await insert('users', { full_name: text(data.full_name, 'full_name', 100), email, password_hash, is_active: false,
        phone: data.phone || null, monthly_income: data.monthly_income, date_of_birth: data.date_of_birth || null, id_card_number: data.id_card_number || null, address: data.address, occupation: data.occupation, workplace: data.workplace, contract_type: data.contract_type }, db);
      return issueOtp(db, user, 'REGISTER');
    });
  },
  async resendOtp(data) {
    const challenge = data.challenge_token ? decode(data.challenge_token, 'otp') : null;
    const purpose = choice(data.flow_type || challenge?.purpose || 'REGISTER', 'flow_type', ['REGISTER','RESET_PASSWORD','TRANSACTION','LOGIN_DEVICE']);
    if (challenge && challenge.purpose !== purpose) fail(400, 'OTP không đúng mục đích.');
    return withTransaction(async db => {
      const user = challenge ? await one('SELECT * FROM users WHERE user_id=$1', [challenge.user_id], db) : await findUser(data.identifier, db);
      if (!user) fail(404, 'Không tìm thấy tài khoản.');
      await db.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [user.user_id]);
      if (purpose === 'REGISTER' && user.is_active) fail(409, 'Tài khoản đã được kích hoạt.');
      const extraClaims = purpose === 'LOGIN_DEVICE' && challenge?.remember_me !== undefined
        ? { remember_me: Boolean(challenge.remember_me) }
        : {};
      return issueOtp(db, user, purpose, extraClaims);
    });
  },
  async checkSession(claims, accessToken, refreshToken) {
    let raw = null;
    if (refreshToken !== undefined) {
      if (typeof refreshToken !== 'string' || !refreshToken || refreshToken.length > 1000) fail(401, 'Refresh token không hợp lệ.');
      const session = await one('SELECT token_id FROM refresh_tokens WHERE token_id=$1 AND user_id=$2 AND token=$3 AND revoked_at IS NULL AND expires_at>NOW()', [claims.session_id, claims.user_id, hashToken(refreshToken)]);
      if (!session) fail(401, 'Refresh token không thuộc phiên hiện tại.');
      raw = refreshToken;
    }
    return { access_token: accessToken, refresh_token: raw, expires_at: new Date(claims.exp * 1000).toISOString(), user_id: claims.user_id };
  },
  async verifyOtp(data) {
    const purpose = choice(data.flow_type || 'REGISTER', 'flow_type', ['REGISTER','RESET_PASSWORD','TRANSACTION','LOGIN_DEVICE']);
    if (!/^\d{6}$/.test(data.otp || '')) fail(400, 'OTP phải gồm 6 chữ số.');
    const challenge = data.challenge_token ? decode(data.challenge_token, 'otp') : null;
    if (challenge && challenge.purpose !== purpose) fail(400, 'OTP không đúng mục đích.');
    const result = await withTransaction(async db => {
      const user = challenge ? await one('SELECT * FROM users WHERE user_id=$1', [challenge.user_id], db) : await findUser(data.identifier, db);
      if (!user) return { error: [400, 'OTP không hợp lệ.'] };
      const otp = await one('SELECT * FROM otp_verifications WHERE user_id=$1 AND purpose=$2 ORDER BY otp_id DESC LIMIT 1 FOR UPDATE', [user.user_id, purpose], db);
      if (!otp || (challenge && String(challenge.otp_id) !== String(otp.otp_id)) || otp.status !== 'PENDING' || new Date(otp.expires_at) <= new Date()) return { error: [400, 'OTP không hợp lệ hoặc đã hết hạn.'] };
      if (otp.attempt_count >= otp.max_attempts) return { error: [429, 'Đã vượt quá số lần thử OTP.'] };
      if (!(await bcrypt.compare(data.otp, otp.otp_code))) {
        await db.query('UPDATE otp_verifications SET attempt_count=attempt_count+1 WHERE otp_id=$1', [otp.otp_id]);
        return { error: [otp.attempt_count + 1 >= otp.max_attempts ? 429 : 400, 'Mã OTP không chính xác.'] };
      }
      await db.query("UPDATE otp_verifications SET status='VERIFIED', verified_at=NOW() WHERE otp_id=$1", [otp.otp_id]);
      if (purpose === 'REGISTER') {
        await db.query('UPDATE users SET is_active=TRUE WHERE user_id=$1', [user.user_id]);
        const session = await tokenPair(db, { ...user, is_active: true }, data.clientInfo || {}, 30);
        return { verified: true, ...session };
      }
      if (purpose === 'LOGIN_DEVICE') {
        const rememberMe = challenge?.remember_me ?? true;
        const session = await tokenPair(db, user, data.clientInfo || {}, rememberMe ? 30 : 1);
        return { verified: true, ...session };
      }
      return purpose === 'RESET_PASSWORD' ? { reset_token: sign({ type: 'reset', user_id: user.user_id, otp_id: otp.otp_id }, '10m') } : { verified: true };
    });
    if (result.error) fail(...result.error);
    return result;
  },
  async login({ identifier, password: supplied, remember_me = true, clientInfo = {} }) {
    text(supplied, 'password', 72); booleans({ remember_me }, ['remember_me']);
    const result = await withTransaction(async db => {
      const initial = await findUser(identifier, db);
      if (!initial) return { error: [401, 'Tài khoản hoặc mật khẩu không chính xác.'] };
      const user = await one('SELECT * FROM users WHERE user_id=$1 FOR UPDATE', [initial.user_id], db);
      checkUser(user);
      const expiredLock = user.lock_until && new Date(user.lock_until) <= new Date();
      if (!(await bcrypt.compare(supplied, user.password_hash))) {
        const attempts = (expiredLock ? 0 : user.failed_login_attempts) + 1;
        await db.query("UPDATE users SET failed_login_attempts=$2, is_locked=$3, lock_until=CASE WHEN $3 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END WHERE user_id=$1", [user.user_id, attempts, attempts >= 5]);
        return { error: [attempts >= 5 ? 403 : 401, attempts >= 5 ? 'Tài khoản bị tạm khóa 15 phút.' : 'Tài khoản hoặc mật khẩu không chính xác.'] };
      }
      await db.query('UPDATE users SET failed_login_attempts=0, is_locked=FALSE, lock_until=NULL WHERE user_id=$1', [user.user_id]);
      const hasExplicitDevice = typeof clientInfo.device_name === 'string' && clientInfo.device_name.trim().length > 0;
      if (hasExplicitDevice) {
        const deviceName = String(clientInfo.device_name).slice(0, 150);
        const platform = String(clientInfo.platform || 'Flutter').slice(0, 100);
        const knownDevice = await one(
          'SELECT token_id FROM refresh_tokens WHERE user_id=$1 AND device_name=$2 AND platform=$3 LIMIT 1',
          [user.user_id, deviceName, platform],
          db,
        );
        if (!knownDevice) {
          const otpChallenge = await issueOtp(db, user, 'LOGIN_DEVICE', {
            remember_me: Boolean(remember_me),
          });
          return {
            requires_otp: true,
            otp_required: true,
            flow_type: 'LOGIN_DEVICE',
            email: user.email,
            phone: user.phone,
            ...otpChallenge,
          };
        }
      }
      return tokenPair(db, { ...user, is_locked: false, lock_until: null }, clientInfo, remember_me ? 30 : 1);
    });
    if (result.error) fail(...result.error);
    return result;
  },
  async refresh(raw, io = null) {
    if (typeof raw !== 'string' || !raw || raw.length > 1000) fail(401, 'Refresh token không hợp lệ.');
    const rawHash = hashToken(raw);
    const outcome = await withTransaction(async db => {
      const session = await one(
        'SELECT * FROM refresh_tokens WHERE token=$1 OR previous_token=$1 FOR UPDATE',
        [rawHash],
        db,
      );
      if (!session) fail(401, 'Refresh token không hợp lệ hoặc đã hết hạn.');
      if (session.previous_token && session.previous_token === rawHash && session.token !== rawHash) {
        // Phát hiện Refresh Token Reuse: thu hồi ngay phiên hiện tại (commit trước khi ném 401).
        await db.query(
          'UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at, NOW()) WHERE token_id=$1',
          [session.token_id],
        );
        return { reusedSessionId: session.token_id };
      }
      if (session.revoked_at || new Date(session.expires_at) <= new Date()) {
        fail(401, 'Refresh token không hợp lệ hoặc đã hết hạn.');
      }
      const user = await one('SELECT * FROM users WHERE user_id=$1', [session.user_id], db); checkUser(user);
      const replacement = randomBytes(48).toString('base64url');
      // Rotation preserves the original remember-me deadline, never extending a 1-day session.
      await db.query(
        "UPDATE refresh_tokens SET previous_token=token, token=$1, last_active=NOW(), expires_at=LEAST(expires_at, NOW()+INTERVAL '7 days') WHERE token_id=$2",
        [hashToken(replacement), session.token_id],
      );
      return { data: sessionData(user, session, replacement) };
    });
    if (outcome.reusedSessionId) {
      if (io) {
        const room = `session_${outcome.reusedSessionId}`;
        io.to(room).emit('session_revoked', { session_id: String(outcome.reusedSessionId), reason: 'token_reuse' });
        io.in(room).disconnectSockets(true);
      }
      fail(401, 'Phát hiện sử dụng lại refresh token. Phiên đăng nhập đã bị thu hồi để bảo vệ tài khoản.');
    }
    return outcome.data;
  },
  async changePassword(userId, data) {
    const hash = await bcrypt.hash(password(data.new_password), 10);
    await withTransaction(async db => {
      const user = await one('SELECT * FROM users WHERE user_id=$1 FOR UPDATE', [userId], db);
      if (!user || !(await bcrypt.compare(text(data.current_password, 'current_password', 72), user.password_hash))) fail(400, 'Mật khẩu hiện tại không chính xác.');
      await db.query('UPDATE users SET password_hash=$1 WHERE user_id=$2', [hash, userId]);
      await db.query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
    });
    return { changed: true };
  },
  async resetPassword(data, bearer) {
    const token = decode(data.reset_token || bearer, 'reset');
    const hash = await bcrypt.hash(password(data.new_password), 10);
    await withTransaction(async db => {
      const otp = await one("UPDATE otp_verifications SET status='CONSUMED' WHERE otp_id=$1 AND user_id=$2 AND purpose='RESET_PASSWORD' AND status='VERIFIED' RETURNING otp_id", [token.otp_id, token.user_id], db);
      if (!otp) fail(401, 'Quyền đặt lại mật khẩu đã được sử dụng.');
      await db.query('UPDATE users SET password_hash=$1, failed_login_attempts=0,is_locked=CASE WHEN is_locked AND lock_until IS NULL THEN TRUE ELSE FALSE END,lock_until=NULL WHERE user_id=$2', [hash, token.user_id]);
      await db.query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [token.user_id]);
    });
    return { changed: true };
  }
};
export async function authenticate(raw) {
  const token = decode(raw, 'access');
  const session = await one('SELECT * FROM refresh_tokens WHERE token_id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>NOW()', [token.session_id, token.user_id]);
  if (!session) fail(401, 'Phiên đăng nhập đã bị thu hồi.');
  checkUser(await one('SELECT * FROM users WHERE user_id=$1', [token.user_id]));
  return token;
}
