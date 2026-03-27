# ─── Build stage ──────────────────────────────────────────────────────────────
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    cmake \
    g++ \
    pkg-config \
    libhiredis-dev \
    libyaml-cpp-dev \
    libpq-dev \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY . .

RUN cmake -B build \
    -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build -j"$(nproc)"

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    libhiredis0.14 \
    libyaml-cpp0.7 \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/build/trigger_engine /usr/local/bin/trigger_engine

CMD ["trigger_engine"]
