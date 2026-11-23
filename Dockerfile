FROM node:20-alpine

# Cài đặt Nginx và Supervisor
RUN apk update && apk add --no-cache nginx supervisor

# Khởi tạo thư mục log và runtime cho Nginx & Supervisor
RUN mkdir -p /var/log/supervisor /run/nginx /var/log/nginx

WORKDIR /app

# Cache dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy toàn bộ mã nguồn ứng dụng
COPY . .

# Copy cấu hình Nginx và Supervisor
COPY nginx.conf /etc/nginx/nginx.conf
COPY supervisord.conf /etc/supervisord.conf

# Port 80 (Nginx Reverse Proxy -> Express 127.0.0.1:3000)
EXPOSE 80

# Khởi chạy supervisord quản lý cả Nginx và Express API
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
