# Stage 1: Builder
FROM nvidia/cuda:12.2.0-devel-ubuntu22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN rm -f /etc/apt/sources.list.d/cuda*.list \
    && apt-get update -o Acquire::AllowInsecureRepositories=true -o Acquire::AllowDowngradeToInsecureRepositories=true || true \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
       build-essential \
       cmake \
       git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY whisper.cpp .

ENV LIBRARY_PATH=/usr/local/cuda/lib64/stubs:${LIBRARY_PATH}
ENV LD_LIBRARY_PATH=/usr/local/cuda/lib64/stubs:${LD_LIBRARY_PATH}

# Компилируем и собираем все .so библиотеки во временную папку /app/lib_export
RUN cmake -B build \
      -DGGML_CUDA=ON \
      -DCMAKE_EXE_LINKER_FLAGS="-L/usr/local/cuda/lib64/stubs -lcuda" \
      -DCMAKE_SHARED_LINKER_FLAGS="-L/usr/local/cuda/lib64/stubs -lcuda" \
      -DCMAKE_MODULE_LINKER_FLAGS="-L/usr/local/cuda/lib64/stubs -lcuda" && \
    cmake --build build --config Release --target whisper-server whisper-cli -j2 && \
    mkdir -p /app/lib_export && \
    find /app/build -name "*.so*" -exec cp -a {} /app/lib_export/ \;

# Stage 2: Runtime
FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04 AS whisper_cuda_server

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends --allow-change-held-packages \
    libgomp1 \
    libcublas-12-2 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Копируем бинарники
COPY --from=builder /app/build/bin/whisper-server /app/whisper-server
COPY --from=builder /app/build/bin/whisper-cli /app/whisper-cli

# Копируем абсолютно ВСЕ найденные .so библиотеки (libwhisper, libggml и т.д.)
COPY --from=builder /app/lib_export/ /usr/local/lib/
RUN ldconfig

# Создаем папку для экспорта в Volume
RUN mkdir -p /app/binaries && cp /app/whisper-cli /app/binaries/whisper-cli

EXPOSE 8080

ENTRYPOINT ["/app/whisper-server"]

