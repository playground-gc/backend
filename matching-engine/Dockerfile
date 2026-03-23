# ─── Build stage ──────────────────────────────────────────────────────────────
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    cmake \
    g++ \
    pkg-config \
    libhiredis-dev \
    libyaml-cpp-dev \
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
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/build/matching_engine /usr/local/bin/matching_engine

EXPOSE 9000

CMD ["matching_engine"]
