#!/usr/bin/env python3
"""
Synthetic-Bull Benchmark Suite
===============================
Measures throughput and latency across every layer of the trading stack.

Phases:
  0  Prerequisites — docker + service health checks
  1  Warmup       — register pool users, fetch live prices
  2  Market Reads — ticker / orderbook / candles throughput
  3  Auth         — concurrent register + login throughput
  4  Order Place  — limit-order placement P50/P95/P99
  5  Order Cancel — cancel latency
  6  E2E Fill     — order-to-fill round-trip latency
  7  Load Test    — N concurrent users placing burst orders
  8  WebSocket    — messages/sec, delivery latency
  9  Docker Stats — per-container CPU + memory snapshot

Usage:
  pip install aiohttp websockets docker
  python benchmark.py [--host localhost] [--api-port 8000] [--ws-port 8001]
                      [--users 20] [--orders-per-user 25] [--ws-clients 10]
                      [--ws-duration 15] [--skip-docker] [--symbol AAPL_S]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import random
import string
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Tuple

# ── optional deps ──────────────────────────────────────────────────────────────
try:
    import aiohttp
except ImportError:
    sys.exit("Missing: pip install aiohttp")

try:
    import websockets
except ImportError:
    sys.exit("Missing: pip install websockets")

# docker is optional — skipped if not installed or daemon unreachable
try:
    import docker as docker_sdk
    _DOCKER_AVAILABLE = True
except ImportError:
    _DOCKER_AVAILABLE = False


# ── CLI args ───────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Synthetic-Bull Benchmark Suite")
    p.add_argument("--host",            default="localhost")
    p.add_argument("--api-port",        type=int, default=8000)
    p.add_argument("--ws-port",         type=int, default=8001)
    p.add_argument("--symbol",          default="AAPL_S",
                   choices=["AAPL_S","GOOGL_S","TSLA_S","MSFT_S","AMZN_S"])
    p.add_argument("--users",           type=int, default=20,
                   help="Concurrent users for load test (default 20)")
    p.add_argument("--orders-per-user", type=int, default=25,
                   help="Limit orders each user places in load test (default 25)")
    p.add_argument("--ws-clients",      type=int, default=10,
                   help="Concurrent WebSocket clients (default 10)")
    p.add_argument("--ws-duration",     type=int, default=15,
                   help="WebSocket test duration in seconds (default 15)")
    p.add_argument("--skip-docker",     action="store_true",
                   help="Skip Docker container stats collection")
    p.add_argument("--warmup-orders",   type=int, default=5,
                   help="Orders placed per user during warmup (default 5)")
    return p.parse_args()


# ── helpers ────────────────────────────────────────────────────────────────────

def rnd(n: int = 8) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))

def pct(samples: List[float], p: float) -> float:
    if not samples:
        return 0.0
    s = sorted(samples)
    idx = max(0, min(len(s)-1, int(math.ceil(p/100 * len(s))) - 1))
    return s[idx]

def ms(t: float) -> str:
    return f"{t*1000:.2f} ms"

def fmt_bytes(b: float) -> str:
    for unit in ("B","KB","MB","GB"):
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} TB"

def hdr(title: str) -> None:
    w = 64
    print()
    print("┌" + "─"*w + "┐")
    print(f"│  {title:<{w-2}}│")
    print("└" + "─"*w + "┘")

def row(label: str, *values) -> None:
    col = 18
    vals = "  ".join(f"{str(v):>{col}}" for v in values)
    print(f"  {label:<28}{vals}")

def divider() -> None:
    print("  " + "─"*62)


# ── result storage ─────────────────────────────────────────────────────────────

@dataclass
class BenchResult:
    name: str
    samples: List[float] = field(default_factory=list)
    errors: int = 0
    total: int = 0

    @property
    def p50(self)  -> float: return pct(self.samples, 50)
    @property
    def p95(self)  -> float: return pct(self.samples, 95)
    @property
    def p99(self)  -> float: return pct(self.samples, 99)
    @property
    def mean(self) -> float: return sum(self.samples)/len(self.samples) if self.samples else 0
    @property
    def rps(self)  -> float:
        dur = self.p99 * self.total if self.total > 0 else 1
        return len(self.samples) / (sum(self.samples) or 1)

    def add(self, elapsed: float) -> None:
        self.samples.append(elapsed)
        self.total += 1

    def err(self) -> None:
        self.errors += 1
        self.total += 1


# ── shared session context ─────────────────────────────────────────────────────

class Ctx:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.api  = f"http://{args.host}:{args.api_port}/api/v1"
        self.ws   = f"ws://{args.host}:{args.ws_port}/ws"
        self.sym  = args.symbol
        self.results: Dict[str, BenchResult] = {}
        self.mid_price: float = 180.0   # updated during warmup
        self._session: Optional[aiohttp.ClientSession] = None

    def session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=10)
            connector = aiohttp.TCPConnector(limit=500, limit_per_host=500)
            self._session = aiohttp.ClientSession(timeout=timeout, connector=connector)
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    def result(self, key: str) -> BenchResult:
        if key not in self.results:
            self.results[key] = BenchResult(name=key)
        return self.results[key]


# ── Phase 0: Health Check ──────────────────────────────────────────────────────

async def phase0_health(ctx: Ctx) -> bool:
    hdr("Phase 0 · Prerequisites & Health")
    checks = [
        ("API Gateway",       f"{ctx.api.replace('/api/v1','')}/health"),
        ("Market ticker",     f"{ctx.api}/ticker/{ctx.sym}"),
        ("Order book",        f"{ctx.api}/orderbook/{ctx.sym}"),
    ]
    all_ok = True
    for name, url in checks:
        t0 = time.perf_counter()
        try:
            async with ctx.session().get(url) as r:
                ok = r.status < 300
                el = time.perf_counter() - t0
                status = "✓" if ok else "✗"
                print(f"  {status}  {name:<30} {r.status}  {ms(el)}")
                if not ok:
                    all_ok = False
        except Exception as e:
            print(f"  ✗  {name:<30} ERROR: {e}")
            all_ok = False

    if not all_ok:
        print("\n  [!] Some services unreachable. Start with: docker compose up -d")
    return all_ok


# ── Phase 1: Warmup ────────────────────────────────────────────────────────────

@dataclass
class User:
    username: str
    password: str
    token: str = ""
    user_id: str = ""
    order_ids: List[str] = field(default_factory=list)

async def register_user(ctx: Ctx, tag: str = "bm") -> Optional[User]:
    u = User(username=f"{tag}_{rnd()}", password="bench1234!")
    try:
        async with ctx.session().post(f"{ctx.api}/auth/register", json={
            "username": u.username,
            "email": f"{u.username}@bench.local",
            "password": u.password,
        }) as r:
            if r.status == 201:
                d = await r.json()
                u.token = d["access_token"]
                u.user_id = d["user_id"]
                return u
    except Exception:
        pass
    return None

async def phase1_warmup(ctx: Ctx, n_users: int = 4) -> List[User]:
    hdr("Phase 1 · Warmup")
    users = []
    tasks = [register_user(ctx) for _ in range(n_users)]
    results = await asyncio.gather(*tasks)
    users = [u for u in results if u]
    print(f"  Registered {len(users)}/{n_users} benchmark users")

    # fetch live mid price
    try:
        async with ctx.session().get(f"{ctx.api}/ticker/{ctx.sym}") as r:
            if r.status == 200:
                d = await r.json()
                ctx.mid_price = float(d.get("last_price") or d.get("price") or
                                      d.get("ask") or 180.0)
                print(f"  Live mid price for {ctx.sym}: ${ctx.mid_price:.2f}")
    except Exception as e:
        print(f"  Could not fetch price ({e}), using default ${ctx.mid_price:.2f}")

    return users


# ── Phase 2: Market Data Read Benchmark ───────────────────────────────────────

async def _timed_get(ctx: Ctx, url: str, key: str) -> None:
    t0 = time.perf_counter()
    try:
        async with ctx.session().get(url) as r:
            await r.read()
            if r.status < 300:
                ctx.result(key).add(time.perf_counter() - t0)
            else:
                ctx.result(key).err()
    except Exception:
        ctx.result(key).err()

async def phase2_market_reads(ctx: Ctx, n: int = 200) -> None:
    hdr("Phase 2 · Market Data Read Throughput")
    symbols = ["AAPL_S","GOOGL_S","TSLA_S","MSFT_S","AMZN_S"]
    endpoints = {
        "ticker":    [f"{ctx.api}/ticker/{s}" for s in symbols],
        "orderbook": [f"{ctx.api}/orderbook/{s}" for s in symbols],
        "candles":   [f"{ctx.api}/candles/{s}?interval=1m&limit=50" for s in symbols],
        "trades":    [f"{ctx.api}/trades/{s}?limit=50" for s in symbols],
        "stocks":    [f"{ctx.api}/stocks"],
    }

    for key, urls in endpoints.items():
        tasks = [_timed_get(ctx, random.choice(urls), key) for _ in range(n)]
        t0 = time.perf_counter()
        await asyncio.gather(*tasks)
        dur = time.perf_counter() - t0
        r = ctx.result(key)
        rps = len(r.samples) / dur if dur > 0 else 0
        print(f"  /{key:<12} n={len(r.samples):>4}  "
              f"p50={ms(r.p50):<12} p95={ms(r.p95):<12} p99={ms(r.p99):<12} "
              f"{rps:>6.0f} req/s  err={r.errors}")


# ── Phase 3: Auth Throughput ───────────────────────────────────────────────────

async def phase3_auth(ctx: Ctx, n: int = 100) -> None:
    hdr("Phase 3 · Authentication Throughput")

    # concurrent registrations
    async def do_register() -> None:
        t0 = time.perf_counter()
        u = User(username=f"auth_{rnd()}", password="bench1234!")
        try:
            async with ctx.session().post(f"{ctx.api}/auth/register", json={
                "username": u.username,
                "email": f"{u.username}@bench.local",
                "password": u.password,
            }) as r:
                await r.read()
                if r.status == 201:
                    ctx.result("auth_register").add(time.perf_counter() - t0)
                else:
                    ctx.result("auth_register").err()
        except Exception:
            ctx.result("auth_register").err()

    tasks = [do_register() for _ in range(n)]
    t0 = time.perf_counter()
    await asyncio.gather(*tasks)
    dur = time.perf_counter() - t0

    r = ctx.result("auth_register")
    rps = len(r.samples) / dur
    print(f"  register  n={len(r.samples):>4}  "
          f"p50={ms(r.p50):<12} p95={ms(r.p95):<12} p99={ms(r.p99):<12} "
          f"{rps:>6.1f} req/s  err={r.errors}")


# ── Phase 4: Order Placement Benchmark ────────────────────────────────────────

async def _place_order(ctx: Ctx, user: User, side: str, price: float, qty: int = 1) -> Optional[str]:
    """Place a limit order, return order_id or None."""
    t0 = time.perf_counter()
    try:
        async with ctx.session().post(
            f"{ctx.api}/orders",
            json={"symbol": ctx.sym, "type": "limit", "side": side,
                  "price": round(price, 2), "quantity": qty},
            headers={"Authorization": f"Bearer {user.token}"},
        ) as r:
            data = await r.json()
            elapsed = time.perf_counter() - t0
            if r.status == 201:
                ctx.result("order_place").add(elapsed)
                return data.get("order_id")
            ctx.result("order_place").err()
    except Exception:
        ctx.result("order_place").err()
    return None

async def phase4_order_placement(ctx: Ctx, users: List[User], n_per_user: int = 25) -> None:
    hdr("Phase 4 · Order Placement Benchmark")
    # Use prices far from mid so they rest on book (no immediate fill)
    buy_price  = round(ctx.mid_price * 0.70, 2)   # 30% below mid
    sell_price = round(ctx.mid_price * 1.30, 2)   # 30% above mid

    async def user_orders(u: User) -> None:
        for i in range(n_per_user):
            side  = "buy" if i % 2 == 0 else "sell"
            price = buy_price if side == "buy" else sell_price
            oid = await _place_order(ctx, u, side, price)
            if oid:
                u.order_ids.append(oid)

    t0 = time.perf_counter()
    await asyncio.gather(*[user_orders(u) for u in users])
    dur = time.perf_counter() - t0

    r = ctx.result("order_place")
    rps = len(r.samples) / dur
    print(f"  limit orders  n={len(r.samples):>4}  "
          f"p50={ms(r.p50):<12} p95={ms(r.p95):<12} p99={ms(r.p99):<12} "
          f"{rps:>6.1f} req/s  err={r.errors}")
    print(f"  Total resting orders placed: {len(r.samples)} in {dur:.2f}s")


# ── Phase 5: Order Cancel Benchmark ───────────────────────────────────────────

async def phase5_cancel(ctx: Ctx, users: List[User]) -> None:
    hdr("Phase 5 · Order Cancel Benchmark")

    # collect all order_ids across users
    pairs: List[Tuple[User, str]] = [
        (u, oid) for u in users for oid in u.order_ids
    ]
    if not pairs:
        print("  No orders to cancel (phase 4 may have failed)")
        return

    async def do_cancel(u: User, oid: str) -> None:
        t0 = time.perf_counter()
        try:
            async with ctx.session().delete(
                f"{ctx.api}/orders/{oid}",
                headers={"Authorization": f"Bearer {u.token}"},
            ) as r:
                await r.read()
                el = time.perf_counter() - t0
                if r.status in (200, 204):
                    ctx.result("order_cancel").add(el)
                else:
                    ctx.result("order_cancel").err()
        except Exception:
            ctx.result("order_cancel").err()

    t0 = time.perf_counter()
    await asyncio.gather(*[do_cancel(u, oid) for u, oid in pairs])
    dur = time.perf_counter() - t0

    # clear order lists
    for u in users:
        u.order_ids.clear()

    r = ctx.result("order_cancel")
    rps = len(r.samples) / dur
    print(f"  cancel  n={len(r.samples):>4}  "
          f"p50={ms(r.p50):<12} p95={ms(r.p95):<12} p99={ms(r.p99):<12} "
          f"{rps:>6.1f} req/s  err={r.errors}")


# ── Phase 6: End-to-End Fill Latency ──────────────────────────────────────────

async def _wait_fill(ctx: Ctx, user: User, order_id: str,
                     timeout: float = 10.0) -> Optional[float]:
    """Poll order status until filled; returns elapsed seconds or None."""
    deadline = time.perf_counter() + timeout
    while time.perf_counter() < deadline:
        try:
            async with ctx.session().get(
                f"{ctx.api}/orders/{order_id}",
                headers={"Authorization": f"Bearer {user.token}"},
            ) as r:
                if r.status == 200:
                    d = await r.json()
                    if d.get("status") in ("filled", "partial_fill"):
                        return True
        except Exception:
            pass
        await asyncio.sleep(0.05)
    return None

async def phase6_e2e_fill(ctx: Ctx) -> None:
    hdr("Phase 6 · End-to-End Fill Latency")

    N = 5   # pairs of crossing orders
    latencies = []

    for i in range(N):
        # Fresh pair of users per trial
        buyer, seller = await asyncio.gather(
            register_user(ctx, "buyer"),
            register_user(ctx, "seller"),
        )
        if not buyer or not seller:
            print(f"  Trial {i+1}: user registration failed — skipping")
            continue

        # Crossing prices: buyer bids high, seller asks low → guaranteed fill
        buy_price  = round(ctx.mid_price * 1.20, 2)   # 20% above mid
        sell_price = round(ctx.mid_price * 0.80, 2)   # 20% below mid

        t0 = time.perf_counter()

        b_id = await _place_order(ctx, buyer,  "buy",  buy_price,  qty=1)
        s_id = await _place_order(ctx, seller, "sell", sell_price, qty=1)

        if not b_id or not s_id:
            print(f"  Trial {i+1}: order placement failed")
            continue

        # Wait for fill on buyer side (fill_processor updates both sides)
        filled = await _wait_fill(ctx, buyer, b_id)
        elapsed = time.perf_counter() - t0

        if filled:
            latencies.append(elapsed)
            ctx.result("e2e_fill").add(elapsed)
            print(f"  Trial {i+1}: filled in {elapsed*1000:.1f} ms")
        else:
            print(f"  Trial {i+1}: timed out (>{10*1000:.0f} ms) — "
                  "fill_processor may be slow or prices didn't cross")

    if latencies:
        r = ctx.result("e2e_fill")
        print(f"\n  E2E Fill  n={len(r.samples)}  "
              f"mean={ms(r.mean)}  p50={ms(r.p50)}  p95={ms(r.p95)}")
    else:
        print("  No fills recorded")


# ── Phase 7: Load Test ─────────────────────────────────────────────────────────

async def phase7_load_test(ctx: Ctx, n_users: int, orders_per_user: int) -> None:
    hdr(f"Phase 7 · Load Test  ({n_users} users × {orders_per_user} orders)")

    # register fresh users in parallel
    users = await asyncio.gather(*[register_user(ctx, "load") for _ in range(n_users)])
    users = [u for u in users if u]
    print(f"  Registered {len(users)} users for load test")

    buy_p  = round(ctx.mid_price * 0.60, 2)
    sell_p = round(ctx.mid_price * 1.40, 2)
    placed = 0
    errors = 0

    semaphore = asyncio.Semaphore(200)  # cap concurrency

    async def user_burst(u: User) -> None:
        nonlocal placed, errors
        for i in range(orders_per_user):
            side  = "buy" if i % 2 == 0 else "sell"
            price = buy_p if side == "buy" else sell_p
            async with semaphore:
                oid = await _place_order(ctx, u, side, price)
                if oid:
                    placed += 1
                    u.order_ids.append(oid)
                else:
                    errors += 1

    t0 = time.perf_counter()
    await asyncio.gather(*[user_burst(u) for u in users])
    dur = time.perf_counter() - t0

    r = ctx.result("order_place")  # accumulates across phases
    tps = placed / dur
    print(f"  Placed {placed} orders in {dur:.2f}s → {tps:.1f} orders/sec")
    print(f"  Errors: {errors}  ({errors/(placed+errors)*100:.1f}%)" if placed+errors else "  No data")

    # cancel all load-test orders
    cancel_tasks = [
        do_cancel_silent(ctx, u, oid)
        for u in users for oid in u.order_ids
    ]
    await asyncio.gather(*cancel_tasks)
    print(f"  Cleanup: cancelled {sum(len(u.order_ids) for u in users)} resting orders")

async def do_cancel_silent(ctx: Ctx, u: User, oid: str) -> None:
    try:
        async with ctx.session().delete(
            f"{ctx.api}/orders/{oid}",
            headers={"Authorization": f"Bearer {u.token}"},
        ) as r:
            await r.read()
    except Exception:
        pass


# ── Phase 8: WebSocket Benchmark ──────────────────────────────────────────────

async def phase8_websocket(ctx: Ctx, n_clients: int, duration: int) -> None:
    hdr(f"Phase 8 · WebSocket  ({n_clients} clients, {duration}s)")

    msg_counts: List[int] = []
    first_byte_latencies: List[float] = []
    errors: int = 0

    async def ws_client(client_id: int) -> None:
        nonlocal errors
        url = f"{ctx.ws}/{ctx.sym}"
        count = 0
        first_received = False
        t_connect = time.perf_counter()
        try:
            async with websockets.connect(
                url,
                ping_interval=20,
                ping_timeout=10,
                open_timeout=5,
            ) as ws:
                deadline = time.perf_counter() + duration
                while time.perf_counter() < deadline:
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
                        if not first_received:
                            first_byte_latencies.append(time.perf_counter() - t_connect)
                            first_received = True
                        count += 1
                    except asyncio.TimeoutError:
                        break
                    except Exception:
                        break
        except Exception as e:
            errors += 1
        msg_counts.append(count)

    t0 = time.perf_counter()
    await asyncio.gather(*[ws_client(i) for i in range(n_clients)])
    actual_dur = time.perf_counter() - t0

    total_msgs = sum(msg_counts)
    if total_msgs > 0:
        avg_msgs_per_client = total_msgs / n_clients
        throughput = total_msgs / actual_dur
        print(f"  Clients: {n_clients - errors}/{n_clients} connected")
        print(f"  Total messages received: {total_msgs}")
        print(f"  Avg messages/client: {avg_msgs_per_client:.1f}")
        print(f"  Aggregate throughput: {throughput:.1f} msg/s")
        if first_byte_latencies:
            print(f"  First-message latency: "
                  f"p50={ms(pct(first_byte_latencies,50))}  "
                  f"p95={ms(pct(first_byte_latencies,95))}")
        per_client = [c / actual_dur for c in msg_counts if c > 0]
        if per_client:
            print(f"  Per-client rate: "
                  f"min={min(per_client):.1f}  "
                  f"avg={sum(per_client)/len(per_client):.1f}  "
                  f"max={max(per_client):.1f} msg/s")
        ctx.result("ws_msgs").samples = [1/r for r in per_client if r > 0]
    else:
        print(f"  No messages received ({errors} errors)")


# ── Phase 9: Docker Stats ──────────────────────────────────────────────────────

def phase9_docker(skip: bool) -> None:
    hdr("Phase 9 · Docker Container Stats")
    if skip or not _DOCKER_AVAILABLE:
        reason = "disabled via --skip-docker" if skip else "docker SDK not installed (pip install docker)"
        print(f"  Skipped: {reason}")
        return

    try:
        client = docker_sdk.from_env()
        containers = client.containers.list()
    except Exception as e:
        print(f"  Docker unreachable: {e}")
        return

    # filter to synthetic-bull services
    sb_names = {
        "redis","postgres","matching-engine","market-generator",
        "trigger-engine","api-gateway","websocket-service",
        "candle-service","market-maker-bot","alpha-bot",
    }
    rows = []
    for c in containers:
        # container name may be "backend-api-gateway-1" etc.
        short = c.name.replace("backend-","").rsplit("-",1)[0]
        if not any(sn in c.name for sn in sb_names):
            continue
        try:
            stats = c.stats(stream=False)
            cpu_delta  = stats["cpu_stats"]["cpu_usage"]["total_usage"] \
                       - stats["precpu_stats"]["cpu_usage"]["total_usage"]
            sys_delta  = stats["cpu_stats"]["system_cpu_usage"] \
                       - stats["precpu_stats"]["system_cpu_usage"]
            n_cpus     = stats["cpu_stats"].get("online_cpus", 1)
            cpu_pct    = (cpu_delta / sys_delta) * n_cpus * 100.0 if sys_delta > 0 else 0
            mem_used   = stats["memory_stats"]["usage"]
            mem_limit  = stats["memory_stats"].get("limit", 1)
            mem_pct    = mem_used / mem_limit * 100
            rows.append((c.name, c.status, cpu_pct, mem_used, mem_pct))
        except Exception:
            rows.append((c.name, c.status, -1, -1, -1))

    print(f"  {'Container':<35} {'Status':<12} {'CPU%':>6}  {'Memory':>10}  {'Mem%':>6}")
    divider()
    for name, status, cpu, mem, mpct in sorted(rows, key=lambda x: x[0]):
        cpu_s = f"{cpu:.1f}%" if cpu >= 0 else "N/A"
        mem_s = fmt_bytes(mem) if mem >= 0 else "N/A"
        mpc_s = f"{mpct:.1f}%" if mpct >= 0 else "N/A"
        print(f"  {name:<35} {status:<12} {cpu_s:>6}  {mem_s:>10}  {mpc_s:>6}")


# ── Final Report ───────────────────────────────────────────────────────────────

def print_report(ctx: Ctx, t_total: float) -> None:
    hdr("Summary Report")

    metrics = [
        ("ticker",        "GET /ticker",         "req/s", "read"),
        ("orderbook",     "GET /orderbook",       "req/s", "read"),
        ("candles",       "GET /candles",         "req/s", "read"),
        ("trades",        "GET /trades",          "req/s", "read"),
        ("auth_register", "POST /auth/register",  "req/s", "auth"),
        ("order_place",   "POST /orders",         "req/s", "write"),
        ("order_cancel",  "DELETE /orders",       "req/s", "write"),
        ("e2e_fill",      "E2E fill latency",     "fills", "e2e"),
    ]

    print(f"\n  {'Endpoint':<28} {'p50':>10} {'p95':>10} {'p99':>10} {'mean':>10} {'n':>6} {'err':>6}")
    divider()
    for key, label, unit, cat in metrics:
        r = ctx.results.get(key)
        if not r or not r.samples:
            print(f"  {label:<28} {'—':>10} {'—':>10} {'—':>10} {'—':>10} {'0':>6} {'—':>6}")
            continue
        print(f"  {label:<28} "
              f"{ms(r.p50):>10} {ms(r.p95):>10} {ms(r.p99):>10} "
              f"{ms(r.mean):>10} {len(r.samples):>6} {r.errors:>6}")

    # throughput summary
    divider()
    load_r = ctx.results.get("order_place")
    if load_r and load_r.samples:
        effective_rps = len(load_r.samples) / (sum(load_r.samples) / len(load_r.samples) * len(load_r.samples))
        print(f"\n  Estimated order throughput : {len(load_r.samples)} total orders")

    print(f"\n  Total benchmark runtime    : {t_total:.1f}s")
    print(f"  Benchmark completed at     : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # save JSON
    out = {
        "timestamp": datetime.now().isoformat(),
        "symbol": ctx.sym,
        "results": {
            k: {
                "p50_ms":  round(v.p50 * 1000, 2),
                "p95_ms":  round(v.p95 * 1000, 2),
                "p99_ms":  round(v.p99 * 1000, 2),
                "mean_ms": round(v.mean * 1000, 2),
                "n":       len(v.samples),
                "errors":  v.errors,
            }
            for k, v in ctx.results.items()
        }
    }
    fname = f"benchmark_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(fname, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\n  Results saved to: {fname}")


def print_tuning_suggestions(ctx: Ctx) -> None:
    hdr("Optimization Suggestions")

    suggestions = []

    r_place  = ctx.results.get("order_place")
    r_cancel = ctx.results.get("order_cancel")
    r_ticker = ctx.results.get("ticker")
    r_ob     = ctx.results.get("orderbook")
    r_fill   = ctx.results.get("e2e_fill")

    if r_place and r_place.p95 > 0.10:
        suggestions.append((
            "Order placement P95 > 100 ms",
            [
                "Increase matching-engine pool: ENGINE_POOL_SIZE in api-gateway config",
                "Add uvicorn workers: uvicorn --workers 4 (needs gunicorn)",
                "Profile fill_processor: reduce batch_size or block_time in fill_processor.py",
                "Check DB connection pool: raise max_size in asyncpg.create_pool()",
            ]
        ))

    if r_ticker and r_ticker.p95 > 0.020:
        suggestions.append((
            "Ticker reads P95 > 20 ms",
            [
                "Verify Redis is hit (not PG) — GET /ticker should read from Redis HASH",
                "Add response caching with a 50ms TTL for ticker data",
                "Reduce uvicorn startup overhead: use --workers + --preload",
            ]
        ))

    if r_ob and r_ob.p95 > 0.050:
        suggestions.append((
            "Orderbook reads P95 > 50 ms",
            [
                "Orderbook snapshot is JSON in Redis — check redis latency: redis-cli --latency",
                "Reduce snapshot depth: publish top-20 levels only instead of full book",
                "Enable Redis persistence=no for pure in-memory speed",
            ]
        ))

    if r_fill and r_fill.p95 > 2.0:
        suggestions.append((
            "E2E fill latency P95 > 2 s",
            [
                "fill_processor XREADGROUP block time is 1000 ms — lower to 100 ms",
                "Increase fill_processor batch_size from 50 to 200",
                "Run fill_processor as separate process (not asyncio task) for isolation",
                "Check PostgreSQL index on stream:trades consumer group lag",
            ]
        ))

    if not suggestions:
        suggestions.append((
            "System looks healthy!",
            [
                "To push further: increase --users and --orders-per-user flags",
                "Run a 60-second sustained test: python benchmark.py --users 50 --orders-per-user 100",
                "Profile C++ matching engine with perf or gprof under load",
            ]
        ))

    for title, items in suggestions:
        print(f"\n  [{title}]")
        for item in items:
            print(f"    • {item}")


# ── main ───────────────────────────────────────────────────────────────────────

async def main() -> None:
    args = parse_args()
    ctx = Ctx(args)

    print("=" * 66)
    print("  Synthetic-Bull Benchmark Suite")
    print(f"  Target : {ctx.api}")
    print(f"  Symbol : {ctx.sym}")
    print(f"  Config : {args.users} users × {args.orders_per_user} orders/user")
    print("=" * 66)

    t_start = time.perf_counter()

    try:
        ok = await phase0_health(ctx)
        if not ok:
            print("\n  Aborting: services not healthy. Run docker compose up -d first.")
            return

        users = await phase1_warmup(ctx, n_users=4)
        if not users:
            print("\n  Aborting: could not register any users.")
            return

        await phase2_market_reads(ctx, n=200)
        await phase3_auth(ctx, n=100)
        await phase4_order_placement(ctx, users, n_per_user=args.warmup_orders)
        await phase5_cancel(ctx, users)
        await phase6_e2e_fill(ctx)
        await phase7_load_test(ctx, n_users=args.users, orders_per_user=args.orders_per_user)
        await phase8_websocket(ctx, n_clients=args.ws_clients, duration=args.ws_duration)
        phase9_docker(skip=args.skip_docker)

        t_total = time.perf_counter() - t_start
        print_report(ctx, t_total)
        print_tuning_suggestions(ctx)

    finally:
        await ctx.close()

    print()
    print("=" * 66)
    print("  Benchmark complete.")
    print("=" * 66)


if __name__ == "__main__":
    asyncio.run(main())
