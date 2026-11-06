// src/sockets/socket.server.js — Khởi tạo Socket.io, Auth JWT, Quản lý Room

import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Khởi tạo Socket.io Server gắn vào HTTP server.
 * Mọi kết nối socket phải gửi JWT access token trong handshake.auth.token
 * hoặc query ?token=<jwt>
 * @param {import('http').Server} httpServer
 * @returns {import('socket.io').Server} io
 */
export function setupSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
  });

  // Middleware xác thực JWT cho mọi socket connection
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token;

    if (!token) {
      return next(new Error('Socket: Thiếu Bearer Token xác thực.'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.user_id;
      next();
    } catch {
      next(new Error('Socket: Token không hợp lệ hoặc đã hết hạn.'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[SOCKET] User ${socket.userId} kết nối — socket: ${socket.id}`);

    // Cho user vào Room riêng theo user_id
    // Từ backend: io.to(`user_${userId}`).emit(event, data)
    socket.join(`user_${socket.userId}`);

    socket.on('disconnect', (reason) => {
      console.log(`[SOCKET] User ${socket.userId} ngắt kết nối — lý do: ${reason}`);
    });
  });

  return io;
}
