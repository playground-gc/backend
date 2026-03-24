# ─── Build stage ──────────────────────────────────────────────────────────────
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    cmake \
    g++ \
    pkg-config \
    libyaml-cpp-dev \
    libhiredis-dev \
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
    libyaml-cpp0.7 \
    libhiredis0.14 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/build/market_generator /usr/local/bin/market_generator

CMD ["market_generator"]
