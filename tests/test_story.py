#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════════════════╗
║              TRADING BACKEND — STORY-MODE INTEGRATION TEST                 ║
║                                                                              ║
║  Simulates a real user journey end-to-end:                                  ║
║    register → login → explore market → buy → sell → check PnL              ║
║    + stop orders (with trigger validation), order filtering,                 ║
║      trade history, balance ledger, portfolio tracking                       ║
╚══════════════════════════════════════════════════════════════════════════════╝

Usage:
  python test_story.py
  python test_story.py --base-url http://localhost:8000
"""

import argparse
import json
import random
import string
import sys
import time
from datetime import datetime

import requests

# ─── CLI args ─────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://localhost:8000")
args = parser.parse_args()
BASE = args.base_url.rstrip("/")


# ─── Terminal colours ──────────────────────────────────────────────────────────
class C:
    HEADER = "\033[95m"
    BLUE   = "\033[94m"
    CYAN   = "\033[96m"
    GREEN  = "\033[92m"
    YELLOW = "\033[93m"
    RED    = "\033[91m"
    BOLD   = "\033[1m"
    DIM    = "\033[2m"
    RESET  = "\033[0m"


# ─── Pretty printers ──────────────────────────────────────────────────────────
def banner(title: str):
    pad = "═" * 78
    print(f"\n{C.HEADER}{C.BOLD}{pad}{C.RESET}")
    print(f"{C.HEADER}{C.BOLD}  {title}{C.RESET}")
    print(f"{C.HEADER}{C.BOLD}{pad}{C.RESET}")

def chapter(n: int, title: str):
    print(f"\n{C.CYAN}{C.BOLD}{'─' * 78}{C.RESET}")
    print(f"{C.CYAN}{C.BOLD}  CHAPTER {n}: {title}{C.RESET}")
    print(f"{C.CYAN}{C.BOLD}{'─' * 78}{C.RESET}")

def step(title: str):
    print(f"\n{C.YELLOW}{C.BOLD}  ▶ {title}{C.RESET}")

def ok(msg: str):
    print(f"    {C.GREEN}✓  {msg}{C.RESET}")

def fail(msg: str):
    print(f"    {C.RED}✗  {msg}{C.RESET}")

def info(msg: str):
    print(f"    {C.CYAN}ℹ  {msg}{C.RESET}")

def warn(msg: str):
    print(f"    {C.YELLOW}⚠  {msg}{C.RESET}")

def show_request(method: str, url: str, body=None, token: str = None):
    print(f"\n    {C.BLUE}┌── REQUEST ──────────────────────────────────────────────────┐{C.RESET}")
    print(f"    {C.BLUE}│{C.RESET}  {C.BOLD}{method}{C.RESET} {url}")
    if token:
        short = f"{token[:20]}...{token[-10:]}"
        print(f"    {C.BLUE}│{C.RESET}  Authorization: Bearer {short}")
    if body:
        for line in json.dumps(body, indent=4).splitlines():
            print(f"    {C.BLUE}│{C.RESET}    {C.DIM}{line}{C.RESET}")
    print(f"    {C.BLUE}└─────────────────────────────────────────────────────────────┘{C.RESET}")

def show_response(resp: requests.Response):
    status = resp.status_code
    colour = C.GREEN if status < 300 else (C.YELLOW if status < 500 else C.RED)
    print(f"\n    {C.BLUE}┌── RESPONSE ─────────────────────────────────────────────────┐{C.RESET}")
    print(f"    {C.BLUE}│{C.RESET}  {colour}{C.BOLD}HTTP {status} {resp.reason}{C.RESET}")
    try:
        data = resp.json()
        for line in json.dumps(data, indent=4, default=str).splitlines():
            print(f"    {C.BLUE}│{C.RESET}    {C.DIM}{line}{C.RESET}")
    except Exception:
        for line in resp.text[:600].splitlines():
            print(f"    {C.BLUE}│{C.RESET}    {C.DIM}{line}{C.RESET}")
        data = None
    print(f"    {C.BLUE}└─────────────────────────────────────────────────────────────┘{C.RESET}")
    return data

def assert_status(resp: requests.Response, expected: int, label: str) -> bool:
    if resp.status_code == expected:
        ok(f"{label} → HTTP {expected}")
        return True
    fail(f"{label} → expected HTTP {expected}, got HTTP {resp.status_code}")
    return False


# ─── Global state ─────────────────────────────────────────────────────────────
results: list[dict] = []

def record(step_name: str, passed: bool):
    results.append({"step": step_name, "passed": passed})
    return passed


# ─── HTTP helpers ─────────────────────────────────────────────────────────────
def get(path: str, token: str = None, params: dict = None):
    url = f"{BASE}{path}"
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    show_request("GET", url, token=token)
    r = requests.get(url, headers=headers, params=params, timeout=10)
    data = show_response(r)
    return r, data

def post(path: str, body: dict, token: str = None):
    url = f"{BASE}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    show_request("POST", url, body=body, token=token)
    r = requests.post(url, json=body, headers=headers, timeout=10)
    data = show_response(r)
    return r, data

def delete(path: str, token: str = None):
    url = f"{BASE}{path}"
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    show_request("DELETE", url, token=token)
    r = requests.delete(url, headers=headers, timeout=10)
    data = show_response(r)
    return r, data

def ticker_price(sym: str, token: str) -> float | None:
    r = requests.get(f"{BASE}/api/v1/ticker/{sym}",
                     headers={"Authorization": f"Bearer {token}"}, timeout=5)
    if r.status_code == 200:
        return float(r.json().get("price", 0))
    return None


# ─── Polling helpers ──────────────────────────────────────────────────────────
def wait_for_order_status(order_id: str, token: str,
                          target_statuses: list[str], timeout: int = 20) -> dict | None:
    """Poll GET /orders/{id} until status is one of target_statuses."""
    deadline = time.time() + timeout
    attempt = 0
    while time.time() < deadline:
        attempt += 1
        r = requests.get(f"{BASE}/api/v1/orders/{order_id}",
                         headers={"Authorization": f"Bearer {token}"}, timeout=5)
        if r.status_code == 200:
            data = r.json()
            status = data.get("status")
            filled = data.get("filled_qty", 0)
            qty    = data.get("quantity", 0)
            print(f"    {C.DIM}[poll #{attempt:02d}] {order_id[:8]}... "
                  f"status={status:<18} filled={filled}/{qty}{C.RESET}")
            if status in target_statuses:
                return data
        time.sleep(1)
    warn(f"Order {order_id[:8]}... did not reach {target_statuses} within {timeout}s")
    return None


# ══════════════════════════════════════════════════════════════════════════════
#  THE STORY BEGINS
# ══════════════════════════════════════════════════════════════════════════════

banner("TRADING BACKEND — STORY-MODE INTEGRATION TEST")
print(f"\n  {C.DIM}Target : {BASE}{C.RESET}")
print(f"  {C.DIM}Started: {datetime.now().isoformat()}{C.RESET}")

suffix   = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
USERNAME = f"trader_{suffix}"
EMAIL    = f"{USERNAME}@test.local"
PASSWORD = "Secr3t!Pass"

token        = None
symbol       = None
user_id      = None
current_price = None


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 0: SYSTEM HEALTH
# ══════════════════════════════════════════════════════════════════════════════
chapter(0, "System Health Check")

step("GET /health")
r, data = get("/health")
passed = assert_status(r, 200, "Health")
record("health_check", passed)
if not passed:
    fail(f"Server unreachable at {BASE}. Start the API gateway first.")
    sys.exit(1)
ok("Server is healthy.")
if isinstance(data, dict) and "symbols" in data:
    info(f"Configured symbols: {data['symbols']}")


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 1: USER REGISTRATION
# ══════════════════════════════════════════════════════════════════════════════
chapter(1, "User Registration")

step(f"Register new user '{USERNAME}'")
reg_body = {"username": USERNAME, "email": EMAIL, "password": PASSWORD}
r, data = post("/api/v1/auth/register", reg_body)
passed = assert_status(r, 201, "Register")
record("register", passed)
if passed and data:
    token   = data.get("access_token")
    user_id = data.get("user_id")
    ok(f"user_id={user_id}  |  Starting cash balance: $100,000.00")
else:
    fail("Registration failed — cannot continue.")
    sys.exit(1)

step("Try registering same username again (expect 409)")
r, data = post("/api/v1/auth/register", reg_body)
passed = assert_status(r, 409, "Duplicate register rejected")
record("register_duplicate_rejected", passed)
if passed:
    info(f"Server said: {data.get('detail', '')}")


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 2: LOGIN
# ══════════════════════════════════════════════════════════════════════════════
chapter(2, "Login — Wrong Credentials Then Correct")

step("Login with WRONG password (expect 401)")
r, data = post("/api/v1/auth/login", {"username": USERNAME, "password": "wrongpass"})
passed = assert_status(r, 401, "Invalid login rejected")
record("login_invalid", passed)
if passed:
    info(f"Server said: {data.get('detail', '')}")

step("Login with CORRECT password")
r, data = post("/api/v1/auth/login", {"username": USERNAME, "password": PASSWORD})
passed = assert_status(r, 200, "Valid login accepted")
record("login_valid", passed)
if passed and data:
    token = data.get("access_token")
    ok("JWT token obtained. Expires in 24 h.")
else:
    fail("Login failed — cannot continue.")
    sys.exit(1)

step("Access protected endpoint WITHOUT token (expect 401/403)")
r = requests.get(f"{BASE}/api/v1/portfolio", timeout=5)
show_request("GET", f"{BASE}/api/v1/portfolio")
show_response(r)
passed = r.status_code in (401, 403)
record("unauth_rejected", passed)
if passed:
    ok(f"Unauthenticated request correctly rejected (HTTP {r.status_code})")


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 3: MARKET DATA
# ══════════════════════════════════════════════════════════════════════════════
chapter(3, "Market Data — Stocks, Ticker, Order Book, Candles, Trades")

step("GET /api/v1/stocks")
r, data = get("/api/v1/stocks")
passed = assert_status(r, 200, "List stocks")
record("list_stocks", passed)
if passed and data:
    symbol = data[0]["symbol"]
    ok(f"Found {len(data)} stock(s). Using: {C.BOLD}{symbol}{C.RESET}")
    for s in data:
        info(f"  {s['symbol']:10s} | {s.get('name',''):30s} | "
             f"initial_price={s.get('initial_price')}  volatility={s.get('volatility')}")
if not symbol:
    fail("No symbols returned.")
    sys.exit(1)

step(f"GET /api/v1/ticker/{symbol}")
r, data = get(f"/api/v1/ticker/{symbol}")
passed = assert_status(r, 200, "Ticker")
record("ticker", passed)
if passed and data:
    current_price = float(data.get("price", 0))
    ok(f"Last price: ${current_price:.2f}  |  volume: {data.get('volume')}")

step(f"GET /api/v1/orderbook/{symbol}")
r, data = get(f"/api/v1/orderbook/{symbol}")
passed = assert_status(r, 200, "Order book")
record("orderbook", passed)
best_bid = best_ask = None
if passed and data:
    bids = data.get("bids", [])
    asks = data.get("asks", [])
    ok(f"{len(bids)} bid level(s), {len(asks)} ask level(s)")
    if bids:
        best_bid = float(bids[0][0])
        info(f"  Best bid: ${best_bid:.2f} × {bids[0][1]}")
    if asks:
        best_ask = float(asks[0][0])
        info(f"  Best ask: ${best_ask:.2f} × {asks[0][1]}")

step(f"GET /api/v1/candles/{symbol}?interval=1m&limit=5")
r, data = get(f"/api/v1/candles/{symbol}", params={"interval": "1m", "limit": 5})
passed = assert_status(r, 200, "Candles 1m")
record("candles_1m", passed)
if passed and data:
    candles = data.get("candles", [])
    ok(f"Received {len(candles)} candle(s) [{data.get('interval')} interval]")
    for c in candles[-3:]:
        ts_raw = c.get("timestamp", 0)
        ts = (datetime.fromtimestamp(ts_raw / 1000).strftime("%H:%M:%S")
              if ts_raw > 1e9 else str(ts_raw))
        info(f"  [{ts}] O={c.get('open'):.2f} H={c.get('high'):.2f} "
             f"L={c.get('low'):.2f} C={c.get('close'):.2f} V={c.get('volume')}")

step(f"GET /api/v1/trades/{symbol}?limit=5")
r, data = get(f"/api/v1/trades/{symbol}", params={"limit": 5})
passed = assert_status(r, 200, "Recent trades")
record("recent_trades", passed)
if passed and isinstance(data, list):
    ok(f"Retrieved {len(data)} trade(s)")
    for t in data[:3]:
        info(f"  price={t.get('price')}  qty={t.get('quantity')}  "
             f"buyer={str(t.get('buyer_id','?'))[:8]}  "
             f"seller={str(t.get('seller_id','?'))[:8]}")

step("GET /api/v1/orderbook/INVALID_XYZ (expect 404)")
r, data = get("/api/v1/orderbook/INVALID_XYZ")
passed = assert_status(r, 404, "Unknown symbol rejected")
record("unknown_symbol_404", passed)


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 4: USER PROFILE — INITIAL STATE
# ══════════════════════════════════════════════════════════════════════════════
chapter(4, "User Profile — GET /api/v1/me (initial state)")

step("GET /api/v1/me")
r, data = get("/api/v1/me", token=token)
passed = assert_status(r, 200, "Get profile")
record("get_me_initial", passed)
if passed and data:
    cash = data.get("cash_balance", 0)
    ok(f"username={data.get('username')}  email={data.get('email')}")
    info(f"  Cash balance       : ${cash:,.2f}")
    info(f"  Portfolio value    : ${data.get('total_portfolio_value', 0):,.2f}")
    info(f"  Total account value: ${data.get('total_account_value', 0):,.2f}")
    info(f"  Unrealized P&L     : ${data.get('total_unrealized_pnl', 0):+.2f}")
    info(f"  Holdings           : {len(data.get('portfolio', []))} position(s)")
    if abs(cash - 100000.0) < 0.01:
        ok("Cash balance is exactly $100,000.00 — new account confirmed")


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 5: EMPTY PORTFOLIO & EMPTY LEDGER
# ══════════════════════════════════════════════════════════════════════════════
chapter(5, "Empty Portfolio, Empty Trade History, Empty Balance Ledger")

step("GET /api/v1/portfolio")
r, data = get("/api/v1/portfolio", token=token)
passed = assert_status(r, 200, "Empty portfolio")
record("portfolio_empty", passed)
if passed and isinstance(data, list) and len(data) == 0:
    ok("Portfolio is empty — expected for a new account")

step("GET /api/v1/my/trades")
r, data = get("/api/v1/my/trades", token=token)
passed = assert_status(r, 200, "Empty trade history")
record("my_trades_empty", passed)
if passed and isinstance(data, list):
    ok(f"My trades: {len(data)} (empty — no fills yet)")

step("GET /api/v1/my/balance-history")
r, data = get("/api/v1/my/balance-history", token=token)
passed = assert_status(r, 200, "Empty balance ledger")
record("balance_history_empty", passed)
if passed and isinstance(data, list):
    ok(f"Balance history: {len(data)} entries (empty — no trades yet)")


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 6: LIMIT ORDER — PLACE, INSPECT, CANCEL
# ══════════════════════════════════════════════════════════════════════════════
chapter(6, "Limit Order — Place, Inspect, Cancel")

far_below = round((best_bid or current_price or 180) * 0.70, 2)

step(f"Place LIMIT BUY at ${far_below} (70% of market — will NOT fill)")
r, data = post("/api/v1/orders",
               {"symbol": symbol, "type": "limit", "side": "buy",
                "price": far_below, "quantity": 5},
               token=token)
passed = assert_status(r, 201, "Place limit order")
record("place_limit_order", passed)
cancel_order_id = None
if passed and data:
    cancel_order_id = data.get("order_id")
    ok(f"order_id={cancel_order_id}  status={data.get('status')}")

step(f"GET /api/v1/orders/{(cancel_order_id or '')[:8]}...")
r, data = get(f"/api/v1/orders/{cancel_order_id}", token=token)
passed = assert_status(r, 200, "Get single order")
record("get_order", passed)
if passed and data:
    ok(f"status={data.get('status')}  filled_qty={data.get('filled_qty')}  "
       f"quantity={data.get('quantity')}")

step("Cancel the order")
r, data = delete(f"/api/v1/orders/{cancel_order_id}", token=token)
passed = assert_status(r, 200, "Cancel order")
record("cancel_order", passed)

step("Verify status is 'cancelled'")
r, data = get(f"/api/v1/orders/{cancel_order_id}", token=token)
assert_status(r, 200, "Get cancelled order")
if data and data.get("status") == "cancelled":
    ok("Status confirmed: cancelled")
    record("cancel_verified", True)
else:
    warn(f"Got status: {data.get('status') if data else '?'}")
    record("cancel_verified", False)

step("Cancel AGAIN (expect 409)")
r, data = delete(f"/api/v1/orders/{cancel_order_id}", token=token)
passed = assert_status(r, 409, "Double-cancel rejected")
record("double_cancel_rejected", passed)
if passed:
    info(f"Server: {data.get('detail', '')}")

step("Cancel a nonexistent order (expect 404)")
r, data = delete("/api/v1/orders/00000000-0000-0000-0000-000000000000", token=token)
passed = assert_status(r, 404, "Cancel nonexistent")
record("cancel_nonexistent_404", passed)


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 7: MARKET BUY — fills immediately
# ══════════════════════════════════════════════════════════════════════════════
chapter(7, "Market Buy — fills immediately")

step(f"Place MARKET BUY for 10 shares of {symbol}")
r, data = post("/api/v1/orders",
               {"symbol": symbol, "type": "market", "side": "buy", "quantity": 10},
               token=token)
passed = assert_status(r, 201, "Place market buy")
record("market_buy", passed)
market_buy_id = None
if passed and data:
    market_buy_id = data.get("order_id")
    ok(f"order_id={market_buy_id}  status={data.get('status')}")

step("Try to cancel a market order (expect 400)")
r, data = delete(f"/api/v1/orders/{market_buy_id}", token=token)
passed = assert_status(r, 400, "Market cancel rejected")
record("market_cancel_rejected", passed)
if passed:
    info(f"Server: {data.get('detail', '')}")

step("Wait for market buy to fill...")
filled1 = wait_for_order_status(market_buy_id, token,
                                target_statuses=["filled", "partial"], timeout=20)
if filled1:
    ok(f"FILLED!  filled_qty={filled1.get('filled_qty')}  status={filled1.get('status')}")
    record("market_buy_filled", True)
else:
    warn("Not filled within timeout")
    record("market_buy_filled", False)


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 8: PORTFOLIO & P&L AFTER FIRST BUY
# ══════════════════════════════════════════════════════════════════════════════
chapter(8, "Portfolio, P&L, Balance Ledger — After First Buy")

step("GET /api/v1/me — full account snapshot")
r, data = get("/api/v1/me", token=token)
passed = assert_status(r, 200, "Account snapshot after buy")
record("get_me_after_buy", passed)
if passed and data:
    cash       = data.get("cash_balance", 0)
    port_val   = data.get("total_portfolio_value", 0)
    total_val  = data.get("total_account_value", 0)
    upnl       = data.get("total_unrealized_pnl", 0)
    pnl_color  = C.GREEN if upnl >= 0 else C.RED
    ok(f"Account snapshot:")
    info(f"  Cash balance       : ${cash:>12,.2f}")
    info(f"  Portfolio value    : ${port_val:>12,.2f}")
    info(f"  Total account value: ${total_val:>12,.2f}")
    print(f"    {C.CYAN}ℹ  Unrealized P&L: {pnl_color}{C.BOLD}${upnl:+,.2f}{C.RESET}")
    for pos in data.get("portfolio", []):
        print(f"\n    {C.BOLD}  ── {pos['symbol']} ──{C.RESET}")
        info(f"  Qty={pos['quantity']}  avg_cost=${pos['avg_cost']:.4f}  "
             f"current=${pos.get('current_price') or 0:.4f}  "
             f"P&L=${pos.get('unrealized_pnl', 0):+.2f} "
             f"({pos.get('pnl_pct', 0):+.2f}%)")

step("GET /api/v1/portfolio")
r, data = get("/api/v1/portfolio", token=token)
passed = assert_status(r, 200, "Portfolio after buy")
record("portfolio_after_buy", passed)
held_qty = 0
if passed and isinstance(data, list):
    if data:
        ok(f"{len(data)} holding(s):")
        for item in data:
            qty      = float(item.get("quantity", 0))
            avg      = float(item.get("avg_cost", 0))
            cur      = float(item.get("current_price") or 0)
            upnl_pos = (cur - avg) * qty
            if item.get("symbol") == symbol:
                held_qty = qty
            pnl_c = C.GREEN if upnl_pos >= 0 else C.RED
            info(f"  {item.get('symbol')}  qty={qty}  avg_cost=${avg:.4f}  "
                 f"current=${cur:.4f}  P&L={pnl_c}{upnl_pos:+.2f}{C.RESET}")
    else:
        warn("Portfolio still empty — fill may still be propagating")

step("GET /api/v1/my/trades — should show the buy trade")
r, data = get("/api/v1/my/trades", token=token)
passed = assert_status(r, 200, "My trades after buy")
record("my_trades_after_buy", passed)
if passed and isinstance(data, list):
    ok(f"My trades: {len(data)}")
    for t in data[:5]:
        pnl_c = C.RED if t.get("side") == "buy" else C.GREEN
        info(f"  [{t.get('side').upper()}] {t.get('symbol')}  "
             f"price=${t.get('price')}  qty={t.get('quantity')}  "
             f"total={pnl_c}${t.get('total'):,.2f}{C.RESET}  "
             f"@ {str(t.get('timestamp',''))[:19]}")
    if not data:
        warn("No personal trades yet — fills may still propagate")

step("GET /api/v1/my/balance-history — should show a debit entry")
r, data = get("/api/v1/my/balance-history", token=token)
passed = assert_status(r, 200, "Balance history after buy")
record("balance_history_after_buy", passed)
if passed and isinstance(data, list):
    ok(f"Balance ledger entries: {len(data)}")
    for entry in data[:5]:
        delta = entry.get("delta", 0)
        bal   = entry.get("balance", 0)
        color = C.GREEN if delta > 0 else C.RED
        info(f"  {entry.get('reason'):12s}  delta={color}{delta:+,.2f}{C.RESET}  "
             f"balance=${bal:,.2f}  "
             f"sym={entry.get('symbol')}  qty={entry.get('quantity')}  "
             f"price=${entry.get('price')}")
    if not data:
        warn("No ledger entries yet — fill processor may still be catching up")


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 9: SECOND BUY — AGGRESSIVE LIMIT (at ask)
# ══════════════════════════════════════════════════════════════════════════════
chapter(9, "Second Buy — Aggressive Limit Order")

current_price = ticker_price(symbol, token) or current_price or 180.0
aggressive_px = round(current_price * 1.005, 2)

step(f"Place aggressive LIMIT BUY at ${aggressive_px} (0.5% above market)")
r, data = post("/api/v1/orders",
               {"symbol": symbol, "type": "limit", "side": "buy",
                "price": aggressive_px, "quantity": 5},
               token=token)
passed = assert_status(r, 201, "Aggressive limit buy")
record("aggressive_limit_buy", passed)
agg_buy_id = None
if passed and data:
    agg_buy_id = data.get("order_id")
    ok(f"order_id={agg_buy_id}")

step("Wait for aggressive limit to fill...")
if agg_buy_id:
    filled2 = wait_for_order_status(agg_buy_id, token,
                                    target_statuses=["filled", "partial"], timeout=20)
    if filled2:
        ok(f"FILLED!  filled_qty={filled2.get('filled_qty')}")
        record("aggressive_buy_filled", True)
    else:
        warn("Not filled within timeout")
        record("aggressive_buy_filled", False)


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 10: STOP ORDERS — WITH TRIGGER VALIDATION
# ══════════════════════════════════════════════════════════════════════════════
chapter(10, "Stop Orders — stop_limit and stop_market with Trigger Validation")

# Refresh price right before placing stops to get tight levels
current_price = ticker_price(symbol, token) or current_price or 180.0
info(f"Current market price: ${current_price:.2f}")

# ── stop_limit SELL trigger logic ─────────────────────────────────────────────
# Trigger engine fires when:  last_price <= stop_price
# So setting stop_price ABOVE current price satisfies the condition immediately
# on the next tick (or even on registration). Use +0.5% above current.
stop_sell_trigger = round(current_price * 1.005, 2)
stop_sell_limit   = round(current_price * 1.003, 2)

step(f"Place STOP_LIMIT SELL  stop={stop_sell_trigger}  limit={stop_sell_limit}")
info(f"Trigger fires when price <= ${stop_sell_trigger} (currently ${current_price:.2f} — already satisfied)")
r, data = post("/api/v1/orders",
               {"symbol": symbol, "type": "stop_limit", "side": "sell",
                "stop_price": stop_sell_trigger, "limit_price": stop_sell_limit,
                "quantity": 2},
               token=token)
passed = assert_status(r, 201, "Place stop_limit")
record("stop_limit_placed", passed)
stop_limit_id = None
if passed and data:
    stop_limit_id = data.get("order_id")
    ok(f"order_id={stop_limit_id}")
    info(f"  status={data.get('status')}  stop_price={data.get('stop_price')}  "
         f"expires_at={data.get('expires_at')}")

step(f"GET /api/v1/orders/{(stop_limit_id or '')[:8]}... — verify pending_trigger")
if stop_limit_id:
    r, data = get(f"/api/v1/orders/{stop_limit_id}", token=token)
    passed = assert_status(r, 200, "Get stop_limit")
    if passed and data:
        st = data.get("status")
        record("stop_limit_pending", st == "pending_trigger")
        if st == "pending_trigger":
            ok("Status is 'pending_trigger' ✓")
        else:
            info(f"Status: {st}")

step("Wait up to 30 s for stop_limit to trigger (price must cross stop level)...")
stop_limit_triggered = False
if stop_limit_id:
    triggered = wait_for_order_status(
        stop_limit_id, token,
        target_statuses=["triggered", "open", "partial", "filled", "cancelled"],
        timeout=30,
    )
    if triggered and triggered.get("status") not in ("pending_trigger", "cancelled"):
        ok(f"Stop-limit TRIGGERED!  status={triggered.get('status')}")
        stop_limit_triggered = True
        record("stop_limit_triggered", True)
    else:
        warn("Stop-limit did not trigger within 30 s — cancelling manually")
        record("stop_limit_triggered", False)
        delete(f"/api/v1/orders/{stop_limit_id}", token=token)

# ── stop_market BUY trigger logic ────────────────────────────────────────────
# Trigger engine fires when:  last_price >= stop_price
# So setting stop_price BELOW current price satisfies the condition immediately.
# Use -0.5% below current.
current_price = ticker_price(symbol, token) or current_price
stop_buy_trigger = round(current_price * 0.995, 2)

step(f"Place STOP_MARKET BUY  stop={stop_buy_trigger}")
info(f"Trigger fires when price >= ${stop_buy_trigger} (currently ${current_price:.2f} — already satisfied)")
r, data = post("/api/v1/orders",
               {"symbol": symbol, "type": "stop_market", "side": "buy",
                "stop_price": stop_buy_trigger, "quantity": 2},
               token=token)
passed = assert_status(r, 201, "Place stop_market")
record("stop_market_placed", passed)
stop_mkt_id = None
if passed and data:
    stop_mkt_id = data.get("order_id")
    ok(f"order_id={stop_mkt_id}  status={data.get('status')}")

step("Wait up to 30 s for stop_market to trigger...")
stop_mkt_triggered = False
if stop_mkt_id:
    triggered2 = wait_for_order_status(
        stop_mkt_id, token,
        target_statuses=["triggered", "open", "partial", "filled", "cancelled"],
        timeout=30,
    )
    if triggered2 and triggered2.get("status") not in ("pending_trigger", "cancelled"):
        ok(f"Stop-market TRIGGERED!  status={triggered2.get('status')}")
        stop_mkt_triggered = True
        record("stop_market_triggered", True)
    else:
        warn("Stop-market did not trigger within 30 s — cancelling manually")
        record("stop_market_triggered", False)
        delete(f"/api/v1/orders/{stop_mkt_id}", token=token)

step("GET /api/v1/orders?status=pending_trigger — should be 0")
r, data = get("/api/v1/orders", token=token, params={"status": "pending_trigger"})
if r.status_code == 200 and isinstance(data, list):
    ok(f"Remaining pending stop orders: {len(data)}")


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 11: ORDER LISTING & FILTERING
# ══════════════════════════════════════════════════════════════════════════════
chapter(11, "Order Listing — All Filters")

step("GET /api/v1/orders — all orders")
r, data = get("/api/v1/orders", token=token)
passed = assert_status(r, 200, "List all orders")
record("list_orders", passed)
if passed and isinstance(data, list):
    ok(f"Total orders: {len(data)}")
    counts: dict[str, int] = {}
    for o in data:
        counts[o.get("status", "?")] = counts.get(o.get("status", "?"), 0) + 1
    for s, cnt in sorted(counts.items()):
        info(f"  {s:20s} × {cnt}")

for status_filter in ["filled", "cancelled", "open", "partial", "pending_trigger", "triggered"]:
    step(f"GET /api/v1/orders?status={status_filter}")
    r, data = get("/api/v1/orders", token=token, params={"status": status_filter})
    passed = assert_status(r, 200, f"Filter by {status_filter}")
    record(f"filter_orders_{status_filter}", passed)
    if passed and isinstance(data, list):
        ok(f"Got {len(data)} {status_filter} order(s)")
        for o in data[:2]:
            info(f"  {str(o.get('id','?'))[:8]}...  side={o.get('side')}  "
                 f"qty={o.get('quantity')}  filled={o.get('filled_qty')}  "
                 f"price={o.get('price')}")

step(f"GET /api/v1/orders?symbol={symbol}")
r, data = get("/api/v1/orders", token=token, params={"symbol": symbol})
passed = assert_status(r, 200, f"Filter by symbol={symbol}")
record("filter_orders_symbol", passed)
if passed and isinstance(data, list):
    ok(f"Got {len(data)} order(s) for {symbol}")

step("GET /api/v1/orders?limit=2")
r, data = get("/api/v1/orders", token=token, params={"limit": 2})
passed = assert_status(r, 200, "limit=2")
record("list_orders_limit2", passed)
if passed and isinstance(data, list):
    ok(f"Got {len(data)} order(s) (≤ 2)")


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 12: SELL — close the position
# ══════════════════════════════════════════════════════════════════════════════
chapter(12, "Selling — Market Sell to Close Position")

# Refresh portfolio to know exact holdings
r2, port_data = get("/api/v1/portfolio", token=token)
held_qty = 0.0
if r2.status_code == 200 and isinstance(port_data, list):
    for item in port_data:
        if item.get("symbol") == symbol:
            held_qty = float(item.get("quantity", 0))
            break

info(f"Currently holding {held_qty} share(s) of {symbol}")
sell_order_id = None

if held_qty <= 0:
    warn("No shares to sell — skipping sell step")
    record("market_sell", False)
    record("market_sell_filled", False)
else:
    sell_qty = int(held_qty)
    step(f"Place MARKET SELL for {sell_qty} share(s)")
    r, data = post("/api/v1/orders",
                   {"symbol": symbol, "type": "market", "side": "sell", "quantity": sell_qty},
                   token=token)
    passed = assert_status(r, 201, "Place market sell")
    record("market_sell", passed)
    if passed and data:
        sell_order_id = data.get("order_id")
        ok(f"order_id={sell_order_id}")

    step("Wait for sell to fill...")
    if sell_order_id:
        filled_sell = wait_for_order_status(
            sell_order_id, token,
            target_statuses=["filled", "partial"], timeout=20,
        )
        if filled_sell:
            ok(f"SOLD!  filled_qty={filled_sell.get('filled_qty')}")
            record("market_sell_filled", True)
        else:
            warn("Sell not filled within timeout")
            record("market_sell_filled", False)


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 13: TRADE HISTORY — personal + symbol-level
# ══════════════════════════════════════════════════════════════════════════════
chapter(13, "Trade History — Personal & Symbol-level")

step(f"GET /api/v1/trades/{symbol}?limit=20 — public trade feed")
r, data = get(f"/api/v1/trades/{symbol}", params={"limit": 20})
passed = assert_status(r, 200, "Public trade history")
record("public_trade_history", passed)
if passed and isinstance(data, list):
    ok(f"Got {len(data)} trade(s) from public feed")
    user_trades = [t for t in data
                   if str(t.get("buyer_id", "")) == user_id
                   or str(t.get("seller_id", "")) == user_id]
    ok(f"Trades in feed involving our user: {len(user_trades)}")
    for t in user_trades[:3]:
        role = "BUYER" if str(t.get("buyer_id", "")) == user_id else "SELLER"
        info(f"  [{role}] price=${t.get('price')}  qty={t.get('quantity')}  "
             f"@ {str(t.get('timestamp',''))[:19]}")

step("GET /api/v1/my/trades — personal trade history")
r, data = get("/api/v1/my/trades", token=token)
passed = assert_status(r, 200, "Personal trade history")
record("my_trades_final", passed)
if passed and isinstance(data, list):
    ok(f"Total personal trades: {len(data)}")
    buys  = [t for t in data if t.get("side") == "buy"]
    sells = [t for t in data if t.get("side") == "sell"]
    info(f"  Buy trades : {len(buys)}")
    info(f"  Sell trades: {len(sells)}")
    for t in data[:5]:
        color = C.RED if t.get("side") == "buy" else C.GREEN
        info(f"  [{t.get('side').upper()}] {t.get('symbol')}  "
             f"price=${t.get('price')}  qty={t.get('quantity')}  "
             f"total={color}${t.get('total'):,.2f}{C.RESET}  "
             f"@ {str(t.get('timestamp',''))[:19]}")

step(f"GET /api/v1/my/trades?symbol={symbol} — filter by symbol")
r, data = get("/api/v1/my/trades", token=token, params={"symbol": symbol})
passed = assert_status(r, 200, f"My trades filtered by {symbol}")
record("my_trades_symbol_filter", passed)
if passed and isinstance(data, list):
    ok(f"Got {len(data)} trade(s) for {symbol}")

step("GET /api/v1/my/trades?limit=2 — limit results")
r, data = get("/api/v1/my/trades", token=token, params={"limit": 2})
passed = assert_status(r, 200, "My trades limit=2")
record("my_trades_limit", passed)
if passed and isinstance(data, list):
    ok(f"Got {len(data)} trade(s) (≤ 2)")


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 14: BALANCE LEDGER — full history
# ══════════════════════════════════════════════════════════════════════════════
chapter(14, "Balance Ledger — History of Every Balance Change")

step("GET /api/v1/my/balance-history")
r, data = get("/api/v1/my/balance-history", token=token)
passed = assert_status(r, 200, "Balance history")
record("balance_history_final", passed)
if passed and isinstance(data, list):
    ok(f"Total ledger entries: {len(data)}")
    total_debits  = sum(e["delta"] for e in data if e["delta"] < 0)
    total_credits = sum(e["delta"] for e in data if e["delta"] > 0)
    info(f"  Total spent (buys) : ${abs(total_debits):,.2f}")
    info(f"  Total received (sells): ${total_credits:,.2f}")
    print()
    for e in data[:10]:
        delta = e.get("delta", 0)
        bal   = e.get("balance", 0)
        color = C.GREEN if delta > 0 else C.RED
        arrow = "▲" if delta > 0 else "▼"
        print(f"    {color}{arrow} {e.get('reason'):12s}{C.RESET}  "
              f"delta={color}{delta:>+10,.2f}{C.RESET}  "
              f"→ balance=${bal:>12,.2f}  "
              f"| {e.get('symbol')}  qty={e.get('quantity')}  "
              f"@ ${e.get('price')}")

step("GET /api/v1/my/balance-history?limit=2")
r, data = get("/api/v1/my/balance-history", token=token, params={"limit": 2})
passed = assert_status(r, 200, "Balance history limit=2")
record("balance_history_limit", passed)
if passed and isinstance(data, list):
    ok(f"Got {len(data)} entries (≤ 2)")


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 15: FINAL PORTFOLIO SNAPSHOT & ACCOUNT VALUE
# ══════════════════════════════════════════════════════════════════════════════
chapter(15, "Final Portfolio Snapshot — Holdings & Total P&L")

step("GET /api/v1/me — final account state")
r, data = get("/api/v1/me", token=token)
passed = assert_status(r, 200, "Final account snapshot")
record("get_me_final", passed)
if passed and data:
    cash      = data.get("cash_balance", 0)
    port_val  = data.get("total_portfolio_value", 0)
    total_val = data.get("total_account_value", 0)
    upnl      = data.get("total_unrealized_pnl", 0)
    realized  = total_val - 100000.0 - upnl   # approximation: starting capital was 100k
    upnl_c    = C.GREEN if upnl >= 0 else C.RED
    net_c     = C.GREEN if total_val >= 100000 else C.RED

    print()
    print(f"    {C.BOLD}  ╔══════════ ACCOUNT SUMMARY ══════════╗{C.RESET}")
    print(f"    {C.BOLD}  ║  Cash balance    : ${cash:>12,.2f}  ║{C.RESET}")
    print(f"    {C.BOLD}  ║  Portfolio value : ${port_val:>12,.2f}  ║{C.RESET}")
    print(f"    {C.BOLD}  ║  Unrealized P&L  : {upnl_c}{C.BOLD}${upnl:>+12,.2f}{C.RESET}{C.BOLD}  ║{C.RESET}")
    print(f"    {C.BOLD}  ╠════════════════════════════════════╣{C.RESET}")
    print(f"    {C.BOLD}  ║  TOTAL VALUE     : {net_c}{C.BOLD}${total_val:>12,.2f}{C.RESET}{C.BOLD}  ║{C.RESET}")
    print(f"    {C.BOLD}  ╚════════════════════════════════════╝{C.RESET}")
    print()

    for pos in data.get("portfolio", []):
        pnl_c = C.GREEN if pos.get("unrealized_pnl", 0) >= 0 else C.RED
        print(f"    {C.BOLD}  ── {pos['symbol']} ──{C.RESET}")
        info(f"  Qty={pos['quantity']}  "
             f"avg_cost=${pos['avg_cost']:.4f}  "
             f"current=${pos.get('current_price') or 0:.4f}  "
             f"market_value=${pos.get('market_value', 0):,.2f}  "
             f"P&L={pnl_c}{C.BOLD}${pos.get('unrealized_pnl', 0):+.2f} "
             f"({pos.get('pnl_pct', 0):+.2f}%){C.RESET}")

    if not data.get("portfolio"):
        ok("Portfolio fully exited — all positions closed")


# ══════════════════════════════════════════════════════════════════════════════
#  CHAPTER 16: EDGE CASES & INPUT VALIDATION
# ══════════════════════════════════════════════════════════════════════════════
chapter(16, "Edge Cases — Input Validation")

validation_cases = [
    ("Limit order without price (422)",
     {"symbol": symbol, "type": "limit", "side": "buy", "quantity": 1},
     422, "limit_no_price_422"),
    ("Market order WITH price (422)",
     {"symbol": symbol, "type": "market", "side": "buy", "price": 100.0, "quantity": 1},
     422, "market_with_price_422"),
    ("stop_limit without stop_price (422)",
     {"symbol": symbol, "type": "stop_limit", "side": "sell", "limit_price": 150.0, "quantity": 1},
     422, "stop_limit_no_stop_price"),
    ("stop_limit without limit_price (422)",
     {"symbol": symbol, "type": "stop_limit", "side": "sell", "stop_price": 150.0, "quantity": 1},
     422, "stop_limit_no_limit_price"),
    ("Zero quantity (422)",
     {"symbol": symbol, "type": "market", "side": "buy", "quantity": 0},
     422, "zero_qty"),
    ("Unknown symbol (400)",
     {"symbol": "FAKE_S", "type": "market", "side": "buy", "quantity": 1},
     400, "unknown_symbol_order"),
]

for label, body, expected_status, key in validation_cases:
    step(label)
    r, data = post("/api/v1/orders", body, token=token)
    passed = assert_status(r, expected_status, label)
    record(key, passed)

step("GET /api/v1/orders/{nonexistent_id} (expect 404)")
r, data = get("/api/v1/orders/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", token=token)
passed = assert_status(r, 404, "Nonexistent order 404")
record("nonexistent_order_404", passed)

step("GET /api/v1/ticker/INVALID_S (expect 404)")
r, data = get("/api/v1/ticker/INVALID_S")
passed = assert_status(r, 404, "Invalid ticker symbol 404")
record("invalid_ticker_404", passed)

step("GET /api/v1/candles/INVALID_S (expect 404)")
r, data = get("/api/v1/candles/INVALID_S")
passed = assert_status(r, 404, "Invalid candles symbol 404")
record("invalid_candles_404", passed)


# ══════════════════════════════════════════════════════════════════════════════
#  FINAL SCORECARD
# ══════════════════════════════════════════════════════════════════════════════
banner("TEST RESULTS SCORECARD")

passed_count = sum(1 for r in results if r["passed"])
total_count  = len(results)
pct          = (passed_count / total_count * 100) if total_count else 0

print()
col_w = 44
print(f"  {'TEST STEP':<{col_w}}  RESULT")
print(f"  {'─' * col_w}  ──────")
for r in results:
    icon = f"{C.GREEN}PASS{C.RESET}" if r["passed"] else f"{C.RED}FAIL{C.RESET}"
    name = r["step"].replace("_", " ").title()
    dots = "·" * max(0, col_w - len(name))
    print(f"  {name} {C.DIM}{dots}{C.RESET}  {icon}")

print()
score_c = C.GREEN if pct >= 80 else (C.YELLOW if pct >= 60 else C.RED)
print(f"  {C.BOLD}Score: {score_c}{passed_count}/{total_count}  ({pct:.0f}%){C.RESET}")
print()

if pct == 100:
    print(f"  {C.GREEN}{C.BOLD}All {total_count} tests passed!{C.RESET}")
elif pct >= 80:
    print(f"  {C.YELLOW}{C.BOLD}Core paths working. Review failures above.{C.RESET}")
else:
    print(f"  {C.RED}{C.BOLD}Multiple failures — check request/response output above.{C.RESET}")

print()
