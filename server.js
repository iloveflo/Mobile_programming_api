// server.js — Entry point: khởi HTTP Server + Socket.io
// Theo hướng dẫn TaiLieuLamBE.md, Section 5

import http from 'http';
import app from './src/app.js';
import { setupRealtimeListener } from './src/config/db.js';
import { setupSocketServer } from './src/sockets/socket.server.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.PORT || 3000;

// 1. Tạo HTTP server từ Express app
const server = http.createServer(app);

// 2. Gắn Socket.io lên cùng HTTP server
const io = setupSocketServer(server);

// 3. Gắn `io` vào Express app để các Controllers có thể dùng
app.set('io', io);

// 4. Khởi động LISTEN/NOTIFY từ PostgreSQL → Socket.io
setupRealtimeListener(io);

// 5. Lắng nghe cổng
server.listen(PORT, () => {
  console.log(`\n🚀 FinCredit API Server đang chạy tại http://localhost:${PORT}`);
  console.log(`   Môi trường: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   API Prefix:  ${process.env.API_PREFIX || '/api/v1'}`);
  console.log(`   Socket.io:   ws://localhost:${PORT}\n`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[SERVER ERROR] Cổng ${PORT} đang được sử dụng bởi tiến trình khác.`);
  } else {
    console.error('[SERVER ERROR]:', error);
  }
  process.exit(1);
});
