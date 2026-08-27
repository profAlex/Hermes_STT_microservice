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

RUN apt-get update && apt-get install -y --no-install-recommends --allow-change-held-packages \
    curl \
    libgomp1 \
    libcublas-12-2 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY node-service/package*.json ./

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Создаем символическую ссылку на бинарник из монтируемого Volume
# В коде Node.js (WhisperService) путь к бинарнику можно указать как /app/binaries/whisper-cli или /app/whisper-cli
RUN mkdir -p /app/binaries && ln -s /app/binaries/whisper-cli /app/whisper-cli

EXPOSE 8085

CMD ["node", "dist/server.js"]
