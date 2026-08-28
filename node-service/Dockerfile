# Stage 1: Build Node.js + node-vad
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY node-service/package*.json ./
RUN npm ci

COPY node-service/ .
RUN npm run build
RUN npm prune --omit=dev


# Stage 2: Production Runtime
FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

# Устанавливаем Node.js, тулчейн для сборки C++ модулей (чтобы пересобрать node-vad) и sox
RUN apt-get update && apt-get install -y --no-install-recommends --allow-change-held-packages \
    curl \
    build-essential \
    python3 \
    sox \
    libsox-fmt-all \
    alsa-utils \
    libgomp1 \
    libcublas-12-2 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY node-service/package*.json ./

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Пересобираем native C++ аддоны (node-vad) в целевой среде Ubuntu
RUN npm rebuild node-vad --build-from-source

# Создаем символическую ссылку на бинарник из монтируемого Volume
RUN mkdir -p /app/binaries && ln -s /app/binaries/whisper-cli /app/whisper-cli

EXPOSE 8085

CMD ["node", "dist/server.js"]

