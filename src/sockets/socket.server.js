import { Server } from 'socket.io';
import { authenticate } from '../services/auth.service.js';
export function setupSocketServer(httpServer) {
  const rawCorsOrigin = (process.env.CORS_ORIGIN || '').trim();
  const origin =
    !rawCorsOrigin || (rawCorsOrigin === '*' && process.env.NODE_ENV === 'production')
      ? false
      : rawCorsOrigin === '*'
        ? '*'
        : rawCorsOrigin.split(',').map(v => v.trim()).filter(Boolean);
  const io = new Server(httpServer, origin ? { cors: { origin, methods: ['GET', 'POST'] } } : {});
  io.use(async (socket,next) => {
    try { socket.claims = await authenticate(socket.handshake.auth?.token); next(); }
    catch { next(new Error('Socket: Phiên đăng nhập không hợp lệ.')); }
  });
  io.on('connection', socket => {
    socket.join(`user_${socket.claims.user_id}`);
    if (socket.claims.session_id) {
      socket.join(`session_${socket.claims.session_id}`);
    }
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0,socket.claims.exp * 1000-Date.now()));
    // Revalidate revocation during long-lived connections.
    const check = setInterval(async () => { try { await authenticate(socket.handshake.auth?.token); } catch { socket.disconnect(true); } }, 30000);
    socket.on('disconnect', () => { clearTimeout(expiry); clearInterval(check); });
  });
  return io;
}
