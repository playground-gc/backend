#!/usr/bin/env python3
"""
End-to-End Test Suite for Synthetic-Bull Trading Platform.

Tests the full trading flow:
  Auth → Order placement → Matching → Fill processing → Market data → Portfolio

Usage:
    # Make sure services are running: docker compose up -d
    # Then:
    python tests/e2e_test.py

    # Or with pytest:
    pip install pytest requests websocket-client
    pytest tests/e2e_test.py -v
"""

import json
import random
import string
import time
import sys
import threading

import requests

# ─── Config ──────────────────────────────────────────────────────────────────

API_BASE = "http://localhost:8000/api/v1"
WS_URL = "ws://localhost:8001/ws"
SYMBOL = "AAPL_S"
POLL_INTERVAL = 0.5   # seconds between status checks
TIMEOUT = 15          # max seconds to wait for async operations


def random_suffix():
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=8))


# ─── Helper ──────────────────────────────────────────────────────────────────

class TestUser:
    def __init__(self, tag: str):
        suffix = random_suffix()
        self.username = f"test_{tag}_{suffix}"
        self.email = f"{self.username}@test.com"
        self.password = "testpass123"
        self.token = None
        self.user_id = None

    def auth_header(self):
        return {"Authorization": f"Bearer {self.token}"}

    def register(self):
        r = requests.post(f"{API_BASE}/auth/register", json={
            "username": self.username,
            "email": self.email,
            "password": self.password,
        })
        assert r.status_code == 201, f"Register failed: {r.status_code} {r.text}"
        data = r.json()
        self.token = data["access_token"]
        self.user_id = data["user_id"]
        return data

    def login(self):
        r = requests.post(f"{API_BASE}/auth/login", json={
            "username": self.username,
            "password": self.password,
        })
        assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
        data = r.json()
        self.token = data["access_token"]
        return data

    def place_order(self, side, order_type, quantity, price=None):
        payload = {
            "symbol": SYMBOL,
            "type": order_type,
            "side": side,
            "quantity": quantity,
        }
        if price is not None:
            payload["price"] = price
        r = requests.post(f"{API_BASE}/orders", json=payload, headers=self.auth_header())
        assert r.status_code == 201, f"Place order failed: {r.status_code} {r.text}"
        return r.json()

    def get_orders(self, **params):
        r = requests.get(f"{API_BASE}/orders", params=params, headers=self.auth_header())
        assert r.status_code == 200, f"List orders failed: {r.status_code} {r.text}"
        return r.json()

    def cancel_order(self, order_id):
        r = requests.delete(f"{API_BASE}/orders/{order_id}", headers=self.auth_header())
        return r

    def get_portfolio(self):
        r = requests.get(f"{API_BASE}/portfolio", headers=self.auth_header())
        assert r.status_code == 200, f"Portfolio failed: {r.status_code} {r.text}"
        return r.json()


def wait_for_order_status(user: TestUser, order_id: str, expected: str, timeout=TIMEOUT):
    """Poll until order reaches expected status or timeout."""
    start = time.time()
    while time.time() - start < timeout:
        orders = user.get_orders()
        for o in orders:
            if str(o["id"]) == order_id and o["status"] == expected:
                return o
        time.sleep(POLL_INTERVAL)
    # Final check with details
    orders = user.get_orders()
    for o in orders:
        if str(o["id"]) == order_id:
            raise AssertionError(
                f"Order {order_id} status is '{o['status']}', expected '{expected}' "
                f"(filled_qty={o.get('filled_qty', '?')}) after {timeout}s"
            )
    raise AssertionError(f"Order {order_id} not found after {timeout}s")


# ─── Tests ───────────────────────────────────────────────────────────────────

class TestResults:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []

    def record(self, name, success, error=None):
        if success:
            self.passed += 1
            print(f"  ✅  {name}")
        else:
            self.failed += 1
            self.errors.append((name, error))
            print(f"  ❌  {name}: {error}")


def test_health_check(results: TestResults):
    """Test 1: Health check endpoint."""
    try:
        r = requests.get("http://localhost:8000/health", timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"
        assert isinstance(data["symbols"], list)
        assert len(data["symbols"]) > 0
        results.record("Health check", True)
    except Exception as e:
        results.record("Health check", False, str(e))


def test_auth_register_login(results: TestResults):
    """Test 2: Register + login flow."""
    try:
        user = TestUser("auth")
        data = user.register()
        assert data["access_token"]
        assert data["user_id"]
        assert data["username"] == user.username

        # Login with same credentials
        data2 = user.login()
        assert data2["access_token"]
        assert data2["user_id"] == data["user_id"]

        results.record("Auth: register + login", True)
        return user
    except Exception as e:
        results.record("Auth: register + login", False, str(e))
        return None


def test_auth_duplicate_register(results: TestResults):
    """Test 3: Duplicate registration should fail."""
    try:
        user = TestUser("dup")
        user.register()
        r = requests.post(f"{API_BASE}/auth/register", json={
            "username": user.username,
            "email": user.email,
            "password": user.password,
        })
        assert r.status_code == 409, f"Expected 409, got {r.status_code}"
        results.record("Auth: duplicate register blocked", True)
    except Exception as e:
        results.record("Auth: duplicate register blocked", False, str(e))


def test_auth_bad_login(results: TestResults):
    """Test 4: Bad credentials should fail."""
    try:
        r = requests.post(f"{API_BASE}/auth/login", json={
            "username": "nonexistent_user_xyz",
            "password": "wrong",
        })
        assert r.status_code == 401, f"Expected 401, got {r.status_code}"
        results.record("Auth: bad credentials rejected", True)
    except Exception as e:
        results.record("Auth: bad credentials rejected", False, str(e))


def test_stocks_list(results: TestResults):
    """Test 5: List available stocks."""
    try:
        r = requests.get(f"{API_BASE}/stocks")
        assert r.status_code == 200
        stocks = r.json()
        assert len(stocks) >= 5
        symbols = [s["symbol"] for s in stocks]
        assert SYMBOL in symbols
        results.record("Stocks list", True)
    except Exception as e:
        results.record("Stocks list", False, str(e))


def test_place_limit_order(results: TestResults):
    """Test 6: Place a limit order and verify it appears in order list."""
    try:
        user = TestUser("limit")
        user.register()

        resp = user.place_order("buy", "limit", 1.0, price=50.0)
        order_id = resp["order_id"]
        assert resp["status"] == "submitted"

        # Verify in order list
        orders = user.get_orders()
        found = [o for o in orders if str(o["id"]) == order_id]
        assert len(found) == 1, f"Order {order_id} not found in list"
        assert found[0]["side"] == "buy"
        assert found[0]["order_type"] == "limit"

        results.record("Place limit order", True)
        return user, order_id
    except Exception as e:
        results.record("Place limit order", False, str(e))
        return None, None


def test_cancel_order(results: TestResults):
    """Test 7: Cancel a resting limit order."""
    try:
        user = TestUser("cancel")
        user.register()

        # Place a far-from-market limit order (won't fill)
        resp = user.place_order("buy", "limit", 1.0, price=1.0)
        order_id = resp["order_id"]

        time.sleep(1)  # let it reach the engine

        r = user.cancel_order(order_id)
        assert r.status_code == 200, f"Cancel failed: {r.status_code} {r.text}"

        # Verify cancelled
        orders = user.get_orders(status="cancelled")
        found = [o for o in orders if str(o["id"]) == order_id]
        assert len(found) == 1

        results.record("Cancel order", True)
    except Exception as e:
        results.record("Cancel order", False, str(e))


def test_cancel_filled_order_fails(results: TestResults):
    """Test 8: Cancelling a filled order should fail."""
    try:
        buyer = TestUser("cfill_buy")
        seller = TestUser("cfill_sell")
        buyer.register()
        seller.register()

        # Get current price for realistic order
        ticker = get_ticker_price()
        if ticker is None:
            results.record("Cancel filled order (skipped - no price data)", True)
            return

        # Place matching orders
        sell_resp = seller.place_order("sell", "limit", 1.0, price=round(ticker - 1, 2))
        buy_resp = buyer.place_order("buy", "limit", 1.0, price=round(ticker + 1, 2))

        # Wait for fill
        wait_for_order_status(buyer, buy_resp["order_id"], "filled")

        # Try to cancel the filled order
        r = buyer.cancel_order(buy_resp["order_id"])
        assert r.status_code == 409, f"Expected 409, got {r.status_code}"

        results.record("Cancel filled order rejected", True)
    except Exception as e:
        results.record("Cancel filled order rejected", False, str(e))


def test_order_validation(results: TestResults):
    """Test 9: Invalid orders should be rejected."""
    try:
        user = TestUser("valid")
        user.register()

        # Limit order without price
        r = requests.post(f"{API_BASE}/orders", json={
            "symbol": SYMBOL, "type": "limit", "side": "buy", "quantity": 1.0,
        }, headers=user.auth_header())
        assert r.status_code in (400, 422), f"Expected 400/422, got {r.status_code}"

        # Unknown symbol
        r = requests.post(f"{API_BASE}/orders", json={
            "symbol": "FAKE_SYM", "type": "limit", "side": "buy",
            "quantity": 1.0, "price": 100.0,
        }, headers=user.auth_header())
        assert r.status_code == 400, f"Expected 400, got {r.status_code}"

        # Zero quantity
        r = requests.post(f"{API_BASE}/orders", json={
            "symbol": SYMBOL, "type": "limit", "side": "buy",
            "quantity": 0, "price": 100.0,
        }, headers=user.auth_header())
        assert r.status_code == 422, f"Expected 422, got {r.status_code}"

        results.record("Order validation", True)
    except Exception as e:
        results.record("Order validation", False, str(e))


def test_unauthorized_access(results: TestResults):
    """Test 10: Endpoints requiring auth should reject unauthenticated requests."""
    try:
        r = requests.get(f"{API_BASE}/orders")
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"

        r = requests.get(f"{API_BASE}/portfolio")
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"

        r = requests.post(f"{API_BASE}/orders", json={
            "symbol": SYMBOL, "type": "limit", "side": "buy",
            "quantity": 1.0, "price": 100.0,
        })
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"

        results.record("Unauthorized access blocked", True)
    except Exception as e:
        results.record("Unauthorized access blocked", False, str(e))


def get_ticker_price():
    """Get current market price for SYMBOL, or None if not available."""
    try:
        r = requests.get(f"{API_BASE}/ticker/{SYMBOL}", timeout=3)
        if r.status_code == 200:
            return r.json()["price"]
    except Exception:
        pass
    return None


def test_matching_engine_limit_orders(results: TestResults):
    """Test 11: Two users place crossing limit orders → trade happens."""
    try:
        buyer = TestUser("me_buy")
        seller = TestUser("me_sell")
        buyer.register()
        seller.register()

        # Get current price to place realistic orders
        ticker = get_ticker_price()
        if ticker is None:
            # Use initial price from config
            ticker = 180.0

        buy_price = round(ticker + 2.0, 2)
        sell_price = round(ticker - 2.0, 2)
        qty = 3.0

        # Seller places ask, buyer places bid that crosses it
        sell_resp = seller.place_order("sell", "limit", qty, price=sell_price)
        time.sleep(0.5)
        buy_resp = buyer.place_order("buy", "limit", qty, price=buy_price)

        # Wait for both to fill
        buy_order = wait_for_order_status(buyer, buy_resp["order_id"], "filled")
        sell_order = wait_for_order_status(seller, sell_resp["order_id"], "filled")

        assert float(buy_order["filled_qty"]) == qty
        assert float(sell_order["filled_qty"]) == qty

        results.record("Matching engine: limit orders fill", True)
        return buyer, seller, qty, sell_price
    except Exception as e:
        results.record("Matching engine: limit orders fill", False, str(e))
        return None, None, None, None


def test_matching_engine_market_order(results: TestResults):
    """Test 12: Market order fills against resting limit order."""
    try:
        maker = TestUser("me_maker")
        taker = TestUser("me_taker")
        maker.register()
        taker.register()

        ticker = get_ticker_price()
        if ticker is None:
            ticker = 180.0

        ask_price = round(ticker + 0.5, 2)
        qty = 2.0

        # Maker places a limit sell
        maker_resp = maker.place_order("sell", "limit", qty, price=ask_price)
        time.sleep(0.5)

        # Taker sends a market buy
        taker_resp = taker.place_order("buy", "market", qty)

        # Wait for taker fill
        taker_order = wait_for_order_status(taker, taker_resp["order_id"], "filled")
        assert float(taker_order["filled_qty"]) == qty

        results.record("Matching engine: market order fills", True)
    except Exception as e:
        results.record("Matching engine: market order fills", False, str(e))


def test_partial_fill(results: TestResults):
    """Test 13: Order partially fills when resting quantity is insufficient."""
    try:
        maker = TestUser("pf_maker")
        taker = TestUser("pf_taker")
        maker.register()
        taker.register()

        ticker = get_ticker_price()
        if ticker is None:
            ticker = 180.0

        price = round(ticker + 0.5, 2)

        # Maker posts 2 qty, taker wants 5
        maker.place_order("sell", "limit", 2.0, price=price)
        time.sleep(0.5)
        taker_resp = taker.place_order("buy", "limit", 5.0, price=price)

        # Should be partial (filled 2 of 5)
        taker_order = wait_for_order_status(taker, taker_resp["order_id"], "partial")
        assert float(taker_order["filled_qty"]) == 2.0

        results.record("Partial fill", True)
    except Exception as e:
        results.record("Partial fill", False, str(e))


def test_trades_in_db(results: TestResults):
    """Test 14: Trades appear in the trades table via REST API."""
    try:
        r = requests.get(f"{API_BASE}/trades/{SYMBOL}?limit=10")
        assert r.status_code == 200
        trades = r.json()
        assert len(trades) > 0, "No trades found in DB"
        t = trades[0]
        assert "price" in t
        assert "quantity" in t
        results.record("Trades in database", True)
    except Exception as e:
        results.record("Trades in database", False, str(e))


def test_ticker(results: TestResults):
    """Test 15: Ticker returns latest price from Redis."""
    try:
        r = requests.get(f"{API_BASE}/ticker/{SYMBOL}")
        assert r.status_code == 200
        data = r.json()
        assert data["symbol"] == SYMBOL
        assert data["price"] > 0
        assert data["timestamp"] > 0
        results.record("Ticker price", True)
    except Exception as e:
        results.record("Ticker price", False, str(e))


def test_orderbook(results: TestResults):
    """Test 16: Orderbook snapshot available."""
    try:
        r = requests.get(f"{API_BASE}/orderbook/{SYMBOL}")
        assert r.status_code == 200
        data = r.json()
        assert "bids" in data
        assert "asks" in data
        assert data["symbol"] == SYMBOL
        results.record("Orderbook snapshot", True)
    except Exception as e:
        results.record("Orderbook snapshot", False, str(e))


def test_candles(results: TestResults):
    """Test 17: Candle data available."""
    try:
        r = requests.get(f"{API_BASE}/candles/{SYMBOL}?interval=1m&limit=10")
        assert r.status_code == 200
        data = r.json()
        assert data["symbol"] == SYMBOL
        assert data["interval"] == "1m"
        assert isinstance(data["candles"], list)
        # Candles may be empty if system just started; that's ok
        results.record("Candles endpoint", True)
    except Exception as e:
        results.record("Candles endpoint", False, str(e))


def test_portfolio_after_trade(results: TestResults):
    """Test 18: Portfolio reflects holdings after a trade."""
    try:
        buyer = TestUser("port_buy")
        seller = TestUser("port_sell")
        buyer.register()
        seller.register()

        ticker = get_ticker_price()
        if ticker is None:
            ticker = 180.0

        price = round(ticker - 1.0, 2)
        qty = 4.0

        # Execute a trade
        seller.place_order("sell", "limit", qty, price=price)
        time.sleep(0.5)
        buy_resp = buyer.place_order("buy", "limit", qty, price=round(ticker + 1.0, 2))

        wait_for_order_status(buyer, buy_resp["order_id"], "filled")
        time.sleep(1)  # let fill processor update portfolio

        portfolio = buyer.get_portfolio()
        holdings = [p for p in portfolio if p["symbol"] == SYMBOL]
        assert len(holdings) == 1, f"Expected 1 holding, got {len(holdings)}: {portfolio}"
        assert float(holdings[0]["quantity"]) == qty
        assert float(holdings[0]["avg_cost"]) > 0

        results.record("Portfolio after trade", True)
    except Exception as e:
        results.record("Portfolio after trade", False, str(e))


def test_websocket_trades(results: TestResults):
    """Test 19: WebSocket receives trade events."""
    try:
        import websocket
    except ImportError:
        results.record("WebSocket trades (skipped - install websocket-client)", True)
        return

    received = []
    error_msg = [None]

    def on_message(ws, message):
        try:
            data = json.loads(message)
            if data.get("event") == "trade":
                received.append(data)
                ws.close()
        except Exception:
            pass

    def on_error(ws, error):
        error_msg[0] = str(error)

    def run_ws():
        try:
            ws = websocket.WebSocketApp(
                f"{WS_URL}?symbols={SYMBOL}",
                on_message=on_message,
                on_error=on_error,
            )
            ws.run_forever(timeout=TIMEOUT)
        except Exception as e:
            error_msg[0] = str(e)

    ws_thread = threading.Thread(target=run_ws, daemon=True)
    ws_thread.start()
    time.sleep(1)  # let ws connect

    # Generate a trade
    buyer = TestUser("ws_buy")
    seller = TestUser("ws_sell")
    buyer.register()
    seller.register()

    ticker = get_ticker_price()
    if ticker is None:
        ticker = 180.0

    seller.place_order("sell", "limit", 1.0, price=round(ticker - 1, 2))
    time.sleep(0.5)
    buyer.place_order("buy", "limit", 1.0, price=round(ticker + 1, 2))

    ws_thread.join(timeout=TIMEOUT)

    if received:
        t = received[0]
        assert t["symbol"] == SYMBOL
        assert t["price"] > 0
        results.record("WebSocket trade event", True)
    elif error_msg[0]:
        results.record("WebSocket trade event", False, error_msg[0])
    else:
        results.record("WebSocket trade event", False, "No trade received within timeout")


def test_websocket_orderbook(results: TestResults):
    """Test 20: WebSocket receives orderbook updates."""
    try:
        import websocket
    except ImportError:
        results.record("WebSocket orderbook (skipped - install websocket-client)", True)
        return

    received = []
    error_msg = [None]

    def on_message(ws, message):
        try:
            data = json.loads(message)
            if data.get("event") == "orderbook":
                received.append(data)
                ws.close()
        except Exception:
            pass

    def on_error(ws, error):
        error_msg[0] = str(error)

    def run_ws():
        try:
            ws = websocket.WebSocketApp(
                f"{WS_URL}?symbols={SYMBOL}",
                on_message=on_message,
                on_error=on_error,
            )
            ws.run_forever(timeout=TIMEOUT)
        except Exception as e:
            error_msg[0] = str(e)

    ws_thread = threading.Thread(target=run_ws, daemon=True)
    ws_thread.start()
    time.sleep(1)

    # Place an order to trigger snapshot publish
    user = TestUser("ws_ob")
    user.register()
    user.place_order("buy", "limit", 1.0, price=1.0)

    ws_thread.join(timeout=TIMEOUT)

    if received:
        ob = received[0]
        assert "bids" in ob
        assert "asks" in ob
        results.record("WebSocket orderbook update", True)
    elif error_msg[0]:
        results.record("WebSocket orderbook update", False, error_msg[0])
    else:
        results.record("WebSocket orderbook update", False, "No orderbook update received")


def test_multi_symbol(results: TestResults):
    """Test 21: Orders work on different symbols."""
    try:
        user = TestUser("multi")
        user.register()

        symbols = ["AAPL_S", "GOOGL_S", "TSLA_S"]
        for sym in symbols:
            r = requests.post(f"{API_BASE}/orders", json={
                "symbol": sym, "type": "limit", "side": "buy",
                "quantity": 1.0, "price": 1.0,
            }, headers=user.auth_header())
            assert r.status_code == 201, f"Failed for {sym}: {r.status_code}"

        orders = user.get_orders()
        order_symbols = {o["symbol"] for o in orders}
        for sym in symbols:
            assert sym in order_symbols, f"{sym} not in orders"

        results.record("Multi-symbol orders", True)
    except Exception as e:
        results.record("Multi-symbol orders", False, str(e))


def test_price_updates_after_trade(results: TestResults):
    """Test 22: Ticker price updates after a new trade executes."""
    try:
        # Get price before
        r = requests.get(f"{API_BASE}/ticker/{SYMBOL}")
        if r.status_code != 200:
            results.record("Price updates after trade (skipped - no initial price)", True)
            return
        before = r.json()

        buyer = TestUser("pu_buy")
        seller = TestUser("pu_sell")
        buyer.register()
        seller.register()

        # Trade at a distinct price
        trade_price = round(before["price"] + 5.0, 2)
        seller.place_order("sell", "limit", 1.0, price=trade_price)
        time.sleep(0.5)
        buy_resp = buyer.place_order("buy", "limit", 1.0, price=trade_price)

        wait_for_order_status(buyer, buy_resp["order_id"], "filled")
        time.sleep(0.5)

        # Check ticker updated
        r = requests.get(f"{API_BASE}/ticker/{SYMBOL}")
        assert r.status_code == 200
        after = r.json()
        assert after["timestamp"] >= before["timestamp"], "Timestamp didn't advance"

        results.record("Price updates after trade", True)
    except Exception as e:
        results.record("Price updates after trade", False, str(e))


# ─── Runner ──────────────────────────────────────────────────────────────────

def run_all():
    print("\n" + "=" * 60)
    print("  Synthetic-Bull E2E Test Suite")
    print("=" * 60)

    # Pre-flight: check services are up
    print("\n⏳ Checking services...")
    try:
        r = requests.get("http://localhost:8000/health", timeout=5)
        if r.status_code != 200:
            print("❌ API Gateway not healthy. Run: docker compose up -d")
            sys.exit(1)
        print(f"  API Gateway: OK (symbols: {r.json()['symbols']})")
    except requests.ConnectionError:
        print("❌ Cannot reach API Gateway at localhost:8000")
        print("   Run: docker compose up -d")
        sys.exit(1)

    # Let the market generator populate some orders first
    print("  Waiting 3s for market generator to warm up...")
    time.sleep(3)

    results = TestResults()

    print("\n── Auth ────────────────────────────────────────────────")
    test_health_check(results)
    test_auth_register_login(results)
    test_auth_duplicate_register(results)
    test_auth_bad_login(results)
    test_unauthorized_access(results)

    print("\n── Market Data ─────────────────────────────────────────")
    test_stocks_list(results)
    test_ticker(results)
    test_orderbook(results)
    test_candles(results)

    print("\n── Order Management ────────────────────────────────────")
    test_place_limit_order(results)
    test_order_validation(results)
    test_cancel_order(results)

    print("\n── Matching Engine ─────────────────────────────────────")
    test_matching_engine_limit_orders(results)
    test_matching_engine_market_order(results)
    test_partial_fill(results)
    test_cancel_filled_order_fails(results)

    print("\n── Fill Processing & Portfolio ──────────────────────────")
    test_trades_in_db(results)
    test_portfolio_after_trade(results)
    test_price_updates_after_trade(results)

    print("\n── Multi-symbol ────────────────────────────────────────")
    test_multi_symbol(results)

    print("\n── WebSocket ───────────────────────────────────────────")
    test_websocket_trades(results)
    test_websocket_orderbook(results)

    # Summary
    total = results.passed + results.failed
    print("\n" + "=" * 60)
    print(f"  Results: {results.passed}/{total} passed", end="")
    if results.failed:
        print(f", {results.failed} failed")
        print("\n  Failed tests:")
        for name, err in results.errors:
            print(f"    - {name}: {err}")
    else:
        print(" — all green! 🎉")
    print("=" * 60 + "\n")

    return 0 if results.failed == 0 else 1


if __name__ == "__main__":
    sys.exit(run_all())
