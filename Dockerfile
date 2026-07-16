FROM node:18-bullseye-slim

# Cài lua5.1 (tương thích Roblox/Luau), luajit, và openssl
# (Prometheus dùng openssl để tạo seed ngẫu nhiên cho bước mã hóa chuỗi)
RUN apt-get update && \
    apt-get install -y lua5.1 luajit openssl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package.json trước để tận dụng Docker layer cache
COPY package*.json ./
RUN npm install

# Copy toàn bộ source code (bao gồm obfuscator/prometheus)
COPY . .

# Đảm bảo thư mục uploads tồn tại cho file tạm
RUN mkdir -p uploads

EXPOSE 3000
CMD ["node", "server.js"]
