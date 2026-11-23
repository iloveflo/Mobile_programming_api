import http from 'node:http';
import 'dotenv/config';
import app from './src/app.js';
import pool, { setupRealtimeListener } from './src/config/db.js';
import { setupSocketServer } from './src/sockets/socket.server.js';
import { startNotificationWorker } from './src/services/notification.service.js';
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith('your_')) throw new Error('JWT_SECRET must be a unique random secret of at least 32 characters.');
const server = http.createServer(app);
const io = setupSocketServer(server);
app.set('io', io);
const stopRealtime = await setupRealtimeListener(io);
const stopNotificationWorker = startNotificationWorker(io);
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => console.log(`FinCredit API listening on ${process.env.PORT || 3000}`));
server.on('error', error => { console.error('HTTP server:', error.code); process.exit(1); });
let stopping = false;
async function shutdown() {
  if (stopping) return; stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10000); deadline.unref();
  stopNotificationWorker();
  await stopRealtime();
  await new Promise(resolve => io.close(resolve));
  await pool.end(); clearTimeout(deadline);
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
