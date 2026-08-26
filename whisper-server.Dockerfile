# Используем официальный образ CUDA SDK для компиляции
FROM nvidia/cuda:12.2.0-devel-ubuntu22.04 AS builder

# Отключаем интерактивные диалоги apt
ENV DEBIAN_FRONTEND=noninteractive

# Устанавливаем необходимые утилиты для сборки (cmake, g++, git)
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Копируем исходники whisper.cpp
COPY whisper.cpp .

# Собираем whisper-server с поддержкой CUDA (GGML_CUDA=ON)
RUN cmake -B build -DGGML_CUDA=ON && \
    cmake --build build --config Release --target whisper-server whisper-cli -j$(nproc)

# Финальный легкий образ runtime
FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04

WORKDIR /app

# Устанавливаем libgomp1 (необходим для OpenMP/multithreading)
RUN apt-get update && apt-get install -y \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Копируем скомпилированные бинарники из этапа builder
COPY --from=builder /app/build/bin/whisper-server /app/whisper-server
COPY --from=builder /app/build/bin/whisper-cli /app/whisper-cli

# Экспузим порт сервера
EXPOSE 8080

# Точка входа по умолчанию
ENTRYPOINT ["/app/whisper-server"]
