import { AuthService } from '../services/auth.service.js';
import { endpoint, rows, one, found, id } from '../utils/api.js';
export const register = endpoint(req => AuthService.register(req.body), 201);
export const verifyOtp = endpoint(req => AuthService.verifyOtp({
  ...req.body,
  challenge_token: req.body.challenge_token || req.headers.authorization?.replace(/^Bearer /i, ''),
  clientInfo: { device_name: req.headers['x-device-name'], platform: req.headers['x-platform'], ip_address: req.ip },
}));
export const resendOtp = endpoint(req => AuthService.resendOtp({ ...req.body, challenge_token: req.body.challenge_token || req.headers.authorization?.replace(/^Bearer /i, '') }));
export const login = endpoint(req => AuthService.login({ ...req.body, clientInfo: { device_name: req.headers['x-device-name'], platform: req.headers['x-platform'], ip_address: req.ip } }));
export const refreshToken = endpoint(req => AuthService.refresh(req.body.refreshToken || req.body.refresh_token));
export const checkSession = endpoint(req => AuthService.checkSession(req.user, req.headers.authorization.split(' ')[1], req.headers['x-refresh-token']));
export const getActiveSessions = endpoint(async req => (await rows('SELECT token_id,device_name,platform,ip_address,location,last_active,expires_at FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>NOW() ORDER BY last_active DESC', [req.user.user_id])).map(s => ({ ...s, id: String(s.token_id), is_current: String(s.token_id) === String(req.user.session_id) })));
export const revokeSession = endpoint(async req => {
  const revoked = found(await one('UPDATE refresh_tokens SET revoked_at=NOW() WHERE token_id=$1 AND user_id=$2 RETURNING token_id', [id(req.params.sessionId), req.user.user_id]));
  const io = req.app?.get?.('io');
  if (io) {
    const room = `session_${revoked.token_id}`;
    io.to(room).emit('session_revoked', { session_id: String(revoked.token_id) });
    io.in(room).disconnectSockets(true);
  }
  return revoked;
});
export const logout = endpoint(async req => { await one('UPDATE refresh_tokens SET revoked_at=NOW() WHERE token_id=$1 AND user_id=$2 RETURNING token_id', [req.user.session_id, req.user.user_id]); return { logged_out: true }; });
export const changePassword = endpoint(req => AuthService.changePassword(req.user.user_id, req.body));
export const resetPassword = endpoint(req => AuthService.resetPassword(req.body, req.headers.authorization?.replace(/^Bearer /i, '')));
