/**
 * DataManager.js
 * Manages REST (Port 8000) and WebSocket (Port 8001) state.
 *
 * Two WS connections per symbol:
 *   ws://{host}:8001/ws/market/{symbol}  → 100Hz GBM L2 data (price + synthetic book)
 *   ws://{host}:8001/ws/{symbol}         → matching engine orderbook, trades, candle closes
 *
 * REST:
 *   GET /api/v1/stocks                   → symbol list
 *   GET /api/v1/candles/{symbol}         → OHLCV history
 */

const REST_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
// WebSocket goes through the Vite dev proxy (/ws → VITE_WS_BASE_URL)
// so the browser only ever opens a same-origin WebSocket to localhost — no cross-origin issue.
const WS_PROTO = () => (window.location.protocol === "https:" ? "wss:" : "ws:");
const WS_BASE = () => {
  const base =
    import.meta.env.VITE_WS_BASE_URL ||
    `${WS_PROTO()}//${window.location.host}`;
  // Upgrade ws:// → wss:// when served over HTTPS (mixed content blocked by browsers)
  return window.location.protocol === "https:"
    ? base.replace(/^ws:\/\//, "wss://")
    : base;
};

class DataManager {
  get basePairs() {
    return Object.keys(this.buffers);
  }

  constructor() {
    this.subscribers = new Map();
    this.buffers = {};
    this.candleHistory = {};
    this.intervals = {}; // Map<symbol, '1s'|'10s'|'1m'>
    this.marketWS = {}; // Map<symbol, WebSocket>  ← GBM L2 stream
    this.exchangeWS = {}; // Map<symbol, WebSocket>  ← matching engine stream
    this._flushStarted = false;
    this._symbolsReady = false;
    this._readyCallbacks = [];
    this._pendingSubscriptions = {}; // subscriptions made before symbol loaded

    this._initSymbols();
  }

  // ── Notify when symbols are loaded (async) ───────────────────────────────────
  onReady(cb) {
    if (this._symbolsReady) {
      cb(this.basePairs);
    } else {
      this._readyCallbacks.push(cb);
    }
  }

  // ── Initialise symbols from backend ─────────────────────────────────────────

  async _initSymbols() {
    try {
      const resp = await fetch(`${REST_BASE}/api/v1/stocks`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const stocks = await resp.json();

      for (const stock of stocks) {
        const sym = stock.symbol;
        const ip = stock.initial_price || 100;

        this.buffers[sym] = {
          ticker: {
            symbol: sym,
            price: ip,
            change: 0,
            high: ip,
            low: ip,
            volume: 0,
          },
          orderBook: { bids: [], asks: [] },
          latestTrades: [],
          chartCandle: {
            time: Math.floor(Date.now() / 1000),
            open: ip,
            high: ip,
            low: ip,
            close: ip,
            volume: 0,
          },
          historyLoaded: false,
        };
        this.subscribers.set(sym, new Set());
        this.intervals[sym] = "1m";

        // Flush any subscriptions that arrived before this symbol was ready
        if (this._pendingSubscriptions[sym]) {
          for (const cb of this._pendingSubscriptions[sym]) {
            this.subscribers.get(sym).add(cb);
            cb({ ...this.buffers[sym] }); // send initial snapshot immediately
          }
          delete this._pendingSubscriptions[sym];
        }

        this._connectMarketWS(sym);
        this._connectExchangeWS(sym);
        this._loadCandleHistory(sym, "1m");
      }
    } catch (err) {
      console.error("[DataManager] Init failed:", err);
    }

    this._symbolsReady = true;
    this._readyCallbacks.forEach((cb) => cb(this.basePairs));
    this._readyCallbacks = [];

    if (!this._flushStarted) {
      this._flushStarted = true;
      this._startFlushLoop();
    }
  }

  // ── GBM market-data stream (100 Hz, price + synthetic L2) ───────────────────

  _connectMarketWS(symbol) {
    const url = `${WS_BASE()}/ws/market/${symbol}`;
    const connect = () => {
      try {
        const ws = new WebSocket(url);
        this.marketWS[symbol] = ws;

        ws.onopen = () => console.log(`[WS market] connected: ${url}`);
        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === "market_data") this._handleMarketData(symbol, msg);
          } catch (_) {}
        };
        ws.onerror = (e) =>
          console.warn(`[WS market] error ${symbol}:`, e.message || e);
        ws.onclose = (e) => {
          console.warn(
            `[WS market] closed ${symbol} code=${e.code}, retrying…`,
          );
          setTimeout(connect, 2000);
        };
      } catch (e) {
        console.error("[WS market] init error:", e);
      }
    };
    connect();
  }

  _handleMarketData(symbol, msg) {
    const buf = this.buffers[symbol];
    if (!buf) return;

    const price = msg.mid;
    if (!price) return;

    // Update ticker
    buf.ticker.price = price;
    if (price > buf.ticker.high) buf.ticker.high = price;
    if (price < buf.ticker.low || buf.ticker.low === 0) buf.ticker.low = price;

    const hist = this.candleHistory[symbol];
    const openPrice = hist && hist.length > 0 ? hist[0].open : price;
    buf.ticker.change =
      openPrice > 0 ? ((price - openPrice) / openPrice) * 100 : 0;

    // Use GBM book to seed orderBook if matching engine hasn't provided one yet
    if (buf.orderBook.bids.length === 0 && msg.bids && msg.bids.length > 0) {
      let bt = 0;
      buf.orderBook.bids = msg.bids.map((b) => {
        bt += b.size;
        return { price: b.price, size: b.size, total: bt };
      });
      let at = 0;
      buf.orderBook.asks = msg.asks.map((a) => {
        at += a.size;
        return { price: a.price, size: a.size, total: at };
      });
    }

    // Update the forming live candle
    this._tickLiveCandle(symbol, price);
  }

  // ── Matching-engine exchange stream (orderbook + trades + candles) ───────────

  _connectExchangeWS(symbol) {
    const url = `${WS_BASE()}/ws/${symbol}`;
    const connect = () => {
      try {
        const interval = this.intervals[symbol] || "1m";
        const ws = new WebSocket(url);
        this.exchangeWS[symbol] = ws;

        ws.onopen = () => {
          console.log(`[WS exchange] connected: ${url}`);
          ws.send(
            JSON.stringify({
              subscribe: ["orderbook", "trades", `candles:${interval}`],
            }),
          );
        };

        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            this._handleExchangeMsg(symbol, msg);
          } catch (_) {}
        };

        ws.onerror = (e) =>
          console.warn(`[WS exchange] error ${symbol}:`, e.message || e);
        ws.onclose = (e) => {
          console.warn(
            `[WS exchange] closed ${symbol} code=${e.code}, retrying…`,
          );
          setTimeout(connect, 2000);
        };
      } catch (e) {
        console.error("[WS exchange] init error:", e);
      }
    };
    connect();
  }

  _handleExchangeMsg(symbol, msg) {
    const buf = this.buffers[symbol];
    if (!buf) return;

    // ── Orderbook snapshot (matching engine)
    // bids/asks are [[price, qty], ...] arrays
    if (msg.event === "orderbook") {
      const rawBids = msg.bids || [];
      const rawAsks = msg.asks || [];

      let bt = 0;
      buf.orderBook.bids = rawBids.map(([price, size]) => {
        bt += size;
        return { price, size, total: bt };
      });
      let at = 0;
      buf.orderBook.asks = rawAsks.map(([price, size]) => {
        at += size;
        return { price, size, total: at };
      });

      // Derive mid price from spread
      if (rawBids.length > 0 && rawAsks.length > 0) {
        const mid = (rawBids[0][0] + rawAsks[0][0]) / 2;
        this._tickLiveCandle(symbol, mid);
        buf.ticker.price = mid;
        if (mid > buf.ticker.high) buf.ticker.high = mid;
        if (mid < buf.ticker.low || buf.ticker.low === 0) buf.ticker.low = mid;
      }
    }

    // ── Trade execution
    // Format: { event:"trade", price, quantity, timestamp (ms) }
    else if (msg.event === "trade") {
      const price = msg.price;
      const qty = msg.quantity;
      const ts = msg.timestamp;

      buf.latestTrades.unshift({
        price,
        size: qty,
        time: ts,
        isBuyerMaker: false,
      });
      if (buf.latestTrades.length > 30) buf.latestTrades.pop();

      buf.ticker.price = price;
      if (price > buf.ticker.high) buf.ticker.high = price;
      if (price < buf.ticker.low || buf.ticker.low === 0)
        buf.ticker.low = price;

      const hist = this.candleHistory[symbol];
      const openPrice = hist && hist.length > 0 ? hist[0].open : price;
      buf.ticker.change =
        openPrice > 0 ? ((price - openPrice) / openPrice) * 100 : 0;
      buf.ticker.volume += qty;

      this._tickLiveCandle(symbol, price, qty);
    }

    // ── Candle close from candle service
    // Format: { event:"candle", interval, open, high, low, close, volume, timestamp (ms) }
    else if (msg.event === "candle") {
      if (msg.interval !== this.intervals[symbol]) return;

      const time = Math.floor(msg.timestamp / 1000); // ms → seconds
      const candle = {
        time,
        open: msg.open,
        high: msg.high,
        low: msg.low,
        close: msg.close,
        volume: msg.volume || 0,
      };

      if (!this.candleHistory[symbol]) this.candleHistory[symbol] = [];
      const idx = this.candleHistory[symbol].findIndex((c) => c.time === time);
      if (idx >= 0) {
        this.candleHistory[symbol][idx] = candle;
      } else {
        this.candleHistory[symbol].push(candle);
        this.candleHistory[symbol].sort((a, b) => a.time - b.time);
        if (this.candleHistory[symbol].length > 500)
          this.candleHistory[symbol].shift();
      }

      // Reset the live forming candle to start after this closed bucket
      const intervalSec =
        msg.interval === "1s" ? 1 : msg.interval === "10s" ? 10 : 60;
      const currentPrice = buf.ticker.price || msg.close;
      buf.chartCandle = {
        time: time + intervalSec,
        open: currentPrice,
        high: currentPrice,
        low: currentPrice,
        close: currentPrice,
        volume: 0,
      };
    }
  }

  // ── Update the currently-forming live candle ─────────────────────────────────

  _tickLiveCandle(symbol, price, vol = 0) {
    const buf = this.buffers[symbol];
    if (!buf || !price) return;

    const intervalSec =
      this.intervals[symbol] === "1s"
        ? 1
        : this.intervals[symbol] === "10s"
          ? 10
          : 60;

    const now = Math.floor(Date.now() / 1000);
    const bucketStart = Math.floor(now / intervalSec) * intervalSec;
    const candle = buf.chartCandle;

    if (candle.time < bucketStart) {
      // Completed candle — add to history
      const completed = { ...candle };
      if (!this.candleHistory[symbol]) this.candleHistory[symbol] = [];
      if (!this.candleHistory[symbol].find((c) => c.time === completed.time)) {
        this.candleHistory[symbol].push(completed);
        this.candleHistory[symbol].sort((a, b) => a.time - b.time);
        if (this.candleHistory[symbol].length > 500)
          this.candleHistory[symbol].shift();
      }
      buf.chartCandle = {
        time: bucketStart,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: vol,
      };
    } else {
      candle.close = price;
      candle.volume += vol;
      if (price > candle.high) candle.high = price;
      if (price < candle.low || candle.low === 0) candle.low = price;
    }
  }

  // ── Load candle history from REST ────────────────────────────────────────────

  async _loadCandleHistory(symbol, interval = "1m") {
    const buf = this.buffers[symbol];
    if (buf) buf.historyLoaded = false;
    try {
      const resp = await fetch(
        `${REST_BASE}/api/v1/candles/${symbol}?interval=${interval}&limit=300`,
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      const candles = (data.candles || [])
        .map((c) => ({
          time: Math.floor(c.timestamp / 1000), // ms → seconds
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume || 0,
        }))
        .filter((c) => c.time > 0);

      candles.sort((a, b) => a.time - b.time);
      this.candleHistory[symbol] = candles;

      if (buf && candles.length > 0) {
        const last = candles[candles.length - 1];
        const first = candles[0];

        // Seed ticker from history
        buf.ticker.high = Math.max(...candles.slice(-200).map((c) => c.high));
        buf.ticker.low = Math.min(...candles.slice(-200).map((c) => c.low));
        buf.ticker.volume = candles
          .slice(-200)
          .reduce((s, c) => s + (c.volume || 0), 0);
        if (!buf.ticker.price || buf.ticker.price === buf.ticker.high) {
          buf.ticker.price = last.close;
        }
        buf.ticker.change =
          first.open > 0 ? ((last.close - first.open) / first.open) * 100 : 0;

        // Position live candle just after the last closed candle
        const intervalSec =
          interval === "1s" ? 1 : interval === "10s" ? 10 : 60;
        buf.chartCandle = {
          time: last.time + intervalSec,
          open: last.close,
          high: last.close,
          low: last.close,
          close: last.close,
          volume: 0,
        };
      }
    } catch (err) {
      console.warn(`[DataManager] Candle history failed for ${symbol}:`, err);
    }

    if (buf) buf.historyLoaded = true;
  }

  // ── Public: read candle data synchronously ───────────────────────────────────

  getCandles(symbol) {
    const history = this.candleHistory[symbol] ?? [];
    const current = this.buffers[symbol]?.chartCandle;
    let all = [...history];

    if (current && current.time > 0) {
      const lastTime = all.length > 0 ? all[all.length - 1].time : 0;
      if (current.time > lastTime) {
        all.push({ ...current, volume: current.volume ?? 0 });
      } else if (current.time === lastTime) {
        all[all.length - 1] = { ...all[all.length - 1], ...current };
      }
    }

    all.sort((a, b) => a.time - b.time);
    const seen = new Set();
    all = all.filter((c) => {
      if (seen.has(c.time)) return false;
      seen.add(c.time);
      return true;
    });

    // Fill gaps with flat candles so lightweight-charts doesn't show empty space
    const intervalSec =
      this.intervals[symbol] === "1s"
        ? 1
        : this.intervals[symbol] === "10s"
          ? 10
          : 60;
    const filled = [];
    for (let i = 0; i < all.length; i++) {
      if (i > 0) {
        const prev = all[i - 1];
        const curr = all[i];
        const gap = (curr.time - prev.time) / intervalSec;
        // Only fill if gap is reasonable (avoid filling huge gaps)
        if (gap > 1 && gap <= 200) {
          for (let t = prev.time + intervalSec; t < curr.time; t += intervalSec) {
            filled.push({
              time: t,
              open: prev.close,
              high: prev.close,
              low: prev.close,
              close: prev.close,
              volume: 0,
            });
          }
        }
      }
      filled.push(all[i]);
    }

    return filled;
  }

  // ── Public: change candle interval ───────────────────────────────────────────

  async changeInterval(symbol, interval) {
    if (!this.buffers[symbol]) return;
    if (this.intervals[symbol] === interval) return;

    this.intervals[symbol] = interval;
    this.candleHistory[symbol] = [];
    this.buffers[symbol].historyLoaded = false;

    // Re-subscribe WS to new candle channel
    const ws = this.exchangeWS[symbol];
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ subscribe: [`candles:${interval}`] }));
    }

    await this._loadCandleHistory(symbol, interval);
  }

  // ── Public: force a fresh candle history load (e.g. when switching back to a symbol) ──
  async refreshCandleHistory(symbol) {
    if (!this.buffers[symbol]) return;
    const interval = this.intervals[symbol] || "1m";
    // Clear stale cached candles so getCandles() returns nothing until REST responds
    this.candleHistory[symbol] = [];
    this.buffers[symbol].historyLoaded = false;
    await this._loadCandleHistory(symbol, interval);
  }

  // ── Flush loop: notify subscribers at 50 ms cadence ─────────────────────────

  _startFlushLoop() {
    setInterval(() => {
      for (const [symbol, subs] of this.subscribers) {
        if (subs.size > 0 && this.buffers[symbol]) {
          const snapshot = {
            ...this.buffers[symbol],
            orderBook: {
              bids: [...(this.buffers[symbol].orderBook.bids || [])],
              asks: [...(this.buffers[symbol].orderBook.asks || [])],
            },
          };
          subs.forEach((cb) => cb(snapshot));
        }
      }
    }, 50);
  }

  // ── Public: subscribe to symbol updates ─────────────────────────────────────

  subscribe(symbol, callback) {
    if (!this.buffers[symbol]) {
      // Symbol not loaded yet — buffer it; will be applied once _initSymbols creates it
      if (!this._pendingSubscriptions[symbol])
        this._pendingSubscriptions[symbol] = [];
      this._pendingSubscriptions[symbol].push(callback);
      return () => {
        // Support unsubscribing even before symbol loads
        if (this._pendingSubscriptions[symbol]) {
          this._pendingSubscriptions[symbol] = this._pendingSubscriptions[
            symbol
          ].filter((cb) => cb !== callback);
        }
        if (this.subscribers.get(symbol)) {
          this.subscribers.get(symbol).delete(callback);
        }
      };
    }
    const subs = this.subscribers.get(symbol);
    subs.add(callback);
    callback({ ...this.buffers[symbol] }); // immediate snapshot
    return () => subs.delete(callback);
  }
}

export const dataManager = new DataManager();
