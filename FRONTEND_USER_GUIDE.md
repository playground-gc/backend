# Synthetic-Bull — Frontend Dashboard User Guide

A complete reference for everything a user can see and do on the Synthetic-Bull trading dashboard.

---

## Table of Contents

1. [What is Synthetic-Bull?](#1-what-is-synthetic-bull)
2. [Getting Started — Account Setup](#2-getting-started--account-setup)
3. [The Dashboard Layout](#3-the-dashboard-layout)
4. [Available Instruments](#4-available-instruments)
5. [Market Data Panels](#5-market-data-panels)
   - 5.1 [Price Ticker](#51-price-ticker)
   - 5.2 [Candlestick Chart](#52-candlestick-chart)
   - 5.3 [Order Book](#53-order-book)
   - 5.4 [Recent Trades Feed](#54-recent-trades-feed)
6. [Placing Orders](#6-placing-orders)
   - 6.1 [Limit Order](#61-limit-order)
   - 6.2 [Market Order](#62-market-order)
   - 6.3 [Stop-Limit Order](#63-stop-limit-order)
   - 6.4 [Stop-Market Order](#64-stop-market-order)
7. [Order Management](#7-order-management)
   - 7.1 [Open Orders](#71-open-orders)
   - 7.2 [Order Statuses Explained](#72-order-statuses-explained)
   - 7.3 [Cancelling an Order](#73-cancelling-an-order)
8. [Portfolio & Holdings](#8-portfolio--holdings)
9. [Trade History](#9-trade-history)
10. [Real-Time Updates — WebSocket](#10-real-time-updates--websocket)
11. [Quick Reference — What Can I Do?](#11-quick-reference--what-can-i-do)

---

## 1. What is Synthetic-Bull?

Synthetic-Bull is a **simulated real-time stock trading exchange**. It runs five synthetic instruments whose prices evolve continuously using a market simulation engine (Geometric Brownian Motion). There is no real money involved — it is a sandbox for practising trading strategies and experiencing how a live order-driven exchange works.

Key characteristics:

- Prices move continuously in real time, 24/7, driven by the simulation engine.
- Orders are matched by a real limit-order-book matching engine — the same mechanics used by real exchanges.
- Trades, fills, portfolio balances, and order history are all persisted to a database.
- The system supports four order types: **Limit**, **Market**, **Stop-Limit**, and **Stop-Market**.

---

## 2. Getting Started — Account Setup

### Register

Create a new account with a unique username, email address, and password (minimum 6 characters).

| Field    | Rules                        |
|----------|------------------------------|
| Username | 3–50 characters, unique      |
| Email    | Valid email, unique          |
| Password | Minimum 6 characters         |

On successful registration you are immediately logged in and receive a session token. You start with a pre-funded virtual balance.

### Login

Existing users log in with their username and password. A JWT session token is issued and used for all subsequent authenticated actions. Sessions are valid until expiry; after expiry you are redirected to the login screen.

### Security note

All order placement, cancellation, portfolio, and order-history endpoints require you to be logged in. Market data (prices, orderbook, candles, recent trades) is public and accessible without an account.

---

## 3. The Dashboard Layout

The main dashboard is divided into the following areas:

```
┌────────────────────────────────────────────────────────────────┐
│  HEADER:  Logo  |  Symbol Selector  |  Account / Balance       │
├──────────────────────────────┬─────────────────────────────────┤
│                              │  ORDER BOOK                      │
│   CANDLESTICK CHART          │  (bids / asks, top 20 levels)   │
│   (1s / 10s / 1m intervals)  ├─────────────────────────────────┤
│                              │  RECENT TRADES FEED              │
├──────────────────────────────┴─────────────────────────────────┤
│  TICKER BAR:  Last Price | Volume | Timestamp                   │
├───────────────────────────────────────────────────────────────-┤
│  ORDER ENTRY PANEL (Limit / Market / Stop-Limit / Stop-Market) │
├────────────────────────────────────────────────────────────────┤
│  TABS:  Open Orders  |  Order History  |  Portfolio            │
└────────────────────────────────────────────────────────────────┘
```

---

## 4. Available Instruments

Five synthetic instruments are available. All symbols carry the `_S` suffix to distinguish them from real-world tickers.

| Symbol   | Name                | Approx. Base Price | Volatility |
|----------|---------------------|--------------------|------------|
| AAPL_S   | Apple Synthetic     | ~$180              | Low (2%)   |
| GOOGL_S  | Google Synthetic    | ~$140              | Low (2.5%) |
| TSLA_S   | Tesla Synthetic     | ~$200              | High (4%)  |
| MSFT_S   | Microsoft Synthetic | ~$380              | Low (1.8%) |
| AMZN_S   | Amazon Synthetic    | ~$170              | Medium (2.2%) |

You can trade all five simultaneously using the same account. Switch between instruments using the symbol selector in the header — all panels (chart, order book, trades feed, order entry) update to the selected symbol.

---

## 5. Market Data Panels

### 5.1 Price Ticker

Displayed prominently at the top of the chart area, showing:

- **Last Price** — the price of the most recent trade for this symbol.
- **Volume** — quantity traded in the most recent trade.
- **Timestamp** — when the last trade occurred (millisecond precision).

The ticker updates in real time via WebSocket every time a new trade executes. There is no polling — the number changes the instant a trade happens.

---

### 5.2 Candlestick Chart

A standard OHLCV (Open / High / Low / Close / Volume) candlestick chart.

**Available intervals:**

| Interval | Bar duration | Use case                      |
|----------|--------------|-------------------------------|
| 1s       | 1 second     | Scalping / very short-term     |
| 10s      | 10 seconds   | Short-term intraday view       |
| 1m       | 1 minute     | Standard intraday view         |

Switch intervals using the toolbar above the chart. The chart loads up to 100 historical bars on first open, and new bars are appended in real time as each interval closes.

Each candle shows:
- **Open** — first trade price in the interval
- **High** — highest trade price in the interval
- **Low** — lowest trade price in the interval
- **Close** — last trade price in the interval
- **Volume** — total quantity traded in the interval

Hovering over a candle displays all five values in a tooltip.

---

### 5.3 Order Book

The order book shows the current resting limit orders on both sides of the market, aggregated by price level.

```
ASKS (sell orders — lowest ask at top)
─────────────────────────────────────
  Price      Size (total qty at level)
  180.45     12.5
  180.30     8.0
  180.15     22.0
──────────── SPREAD ─────────────────
  180.00     15.0
  179.85     30.5
  179.70     10.0
BIDS (buy orders — highest bid at top)
```

- Displays top **20 price levels** on each side.
- Updates in real time via WebSocket after every order placement or trade.
- The spread (difference between best ask and best bid) is highlighted between the two sides.
- Size shown is the **total remaining quantity** across all resting orders at that price level.

---

### 5.4 Recent Trades Feed

A scrolling live feed of the most recent executed trades for the selected symbol.

Each entry shows:

| Column    | Description                                    |
|-----------|------------------------------------------------|
| Price     | Execution price                                |
| Quantity  | Quantity traded                                |
| Side      | Buy-initiated (green) or sell-initiated (red)  |
| Time      | Timestamp of the trade                         |

Trades are pushed in real time via WebSocket. New trades appear at the top of the list. Up to the 50 most recent trades are shown; older trades scroll off the bottom.

---

## 6. Placing Orders

The order entry panel is located below the chart. Select the **order type** using the tab/toggle at the top of the panel, fill in the required fields, choose Buy or Sell, and submit.

### 6.1 Limit Order

**What it does:** Places an order to buy or sell at a specific price or better. The order rests on the order book until it is fully filled, partially filled, or cancelled.

**Required fields:**

| Field    | Description                                              |
|----------|----------------------------------------------------------|
| Symbol   | Which instrument to trade (selected from symbol picker)  |
| Side     | Buy or Sell                                              |
| Price    | The limit price — maximum price to pay (buy) or minimum price to accept (sell) |
| Quantity | Number of units                                          |

**Behaviour:**

- If the limit price immediately crosses a resting order on the opposite side, the order fills at once (at the resting order's price, which is equal to or better than your limit).
- If the limit price does not cross any resting order, the order is added to the book and waits.
- A limit order can be **partially filled** — some quantity fills immediately and the rest rests on the book.
- Limit orders **can be cancelled** at any time while they are `open` or `partial`.

**Example — Buy Limit:**
> You place a BUY LIMIT for 5 units of AAPL_S at $179.50.
> If the best ask is $179.30 (below your limit), 5 units fill immediately at $179.30.
> If the best ask is $181.00 (above your limit), your order rests on the bid side at $179.50 until a seller is willing to sell at ≤ $179.50.

---

### 6.2 Market Order

**What it does:** Executes immediately at the best available price(s) on the opposite side of the book. No price is specified — you accept whatever price the market offers.

**Required fields:**

| Field    | Description             |
|----------|-------------------------|
| Symbol   | Which instrument        |
| Side     | Buy or Sell             |
| Quantity | Number of units         |

**Behaviour:**

- Executes against the cheapest available asks (for a buy) or the highest available bids (for a sell), sweeping through price levels until the full quantity is filled or liquidity is exhausted.
- If there is not enough liquidity to fill the entire quantity, the remaining unfilled quantity is **discarded** — market orders never rest on the book.
- Market orders **cannot be cancelled** — by the time a cancel request could arrive, execution has already happened.
- Because market orders sweep the book, they may fill at multiple prices (price slippage) if a single price level doesn't have enough size.

**When to use:**
Use a market order when you need to execute immediately and the exact price is less important than certainty of execution.

**Example — Sell Market:**
> You place a SELL MARKET for 10 units of TSLA_S.
> Best bids: 5 units @ $199.80, 8 units @ $199.60.
> Result: 5 units fill at $199.80, 5 units fill at $199.60. Total: 10 units filled across two price levels.

---

### 6.3 Stop-Limit Order

**What it does:** A two-stage order. It sits dormant (not visible in the public order book) until the market price reaches your **stop price** — at that point it activates and places a **limit order** at your specified **limit price**.

**Required fields:**

| Field       | Description                                                         |
|-------------|---------------------------------------------------------------------|
| Symbol      | Which instrument                                                    |
| Side        | Buy or Sell                                                         |
| Stop Price  | The trigger price — when the market trades at this level, the order activates |
| Limit Price | The price of the limit order that gets placed after activation      |
| Quantity    | Number of units                                                     |

**Behaviour:**

- The order is saved server-side with status `pending_trigger`. It does **not** appear in the public order book.
- The trigger engine monitors live trade prices for all symbols. The moment a trade executes at or past the stop price, your stop-limit activates.
- **For a stop-limit SELL:** triggers when market price **drops to or below** your stop price.
- **For a stop-limit BUY:** triggers when market price **rises to or above** your stop price.
- After triggering, a limit order is submitted to the matching engine at your specified limit price. From this point it behaves exactly like a regular limit order.
- Stop-limit orders expire automatically after **30 days** if never triggered.
- Stop-limit orders **can be cancelled** while in `pending_trigger` status.

**Typical use case — Stop-Loss:**
> You own 10 units of TSLA_S bought at $200. To protect against a big loss:
> Place a SELL STOP-LIMIT: Stop Price = $190, Limit Price = $189.50, Quantity = 10.
> If TSLA_S trades down to $190, your sell limit order at $189.50 is placed automatically.

**Typical use case — Breakout Buy:**
> AAPL_S is consolidating at $180. You believe if it breaks above $185 it will rally.
> Place a BUY STOP-LIMIT: Stop Price = $185, Limit Price = $185.50, Quantity = 5.
> If AAPL_S trades up to $185, your buy limit order at $185.50 is placed automatically.

**Important:** There is a gap risk — if the market gaps through your limit price, the limit order may not fill. For example: stop price $190, limit price $189.50, but price gaps from $195 to $187 — your limit order is placed at $189.50 but the best bid may be $187, and it will rest unfilled until bids recover to $189.50.

---

### 6.4 Stop-Market Order

**What it does:** Like a stop-limit order, but instead of placing a limit order on activation, it places a **market order**. Guaranteed execution once triggered, but no control over the fill price.

**Required fields:**

| Field      | Description                                                         |
|------------|---------------------------------------------------------------------|
| Symbol     | Which instrument                                                    |
| Side       | Buy or Sell                                                         |
| Stop Price | The trigger price                                                   |
| Quantity   | Number of units                                                     |

**Behaviour:**

- Sits dormant as `pending_trigger`, invisible in the order book.
- Triggers when market price reaches the stop price (same directional rules as stop-limit).
- On activation, a **market order** is submitted — execution is immediate at the best available price.
- No limit price risk — will always fill as long as there is any liquidity on the opposite side.
- Stop-market orders expire automatically after **30 days** if never triggered.
- Can be cancelled while `pending_trigger`.

**When to use stop-market vs stop-limit:**
Use stop-market when you **must exit** (or enter) the position at any cost once the trigger level is hit. Use stop-limit when you want price control but accept the risk of not filling.

**Example — Emergency Stop-Loss:**
> You hold TSLA_S and want to exit no matter what if it falls to $195.
> Place a SELL STOP-MARKET: Stop Price = $195, Quantity = 10.
> If TSLA_S trades at $195, a market sell for 10 units fires immediately.

---

## 7. Order Management

### 7.1 Open Orders

The **Open Orders** tab (bottom of the dashboard) lists all your orders that are currently active — status `open`, `partial`, or `pending_trigger`.

Columns shown:

| Column      | Description                                        |
|-------------|----------------------------------------------------|
| Order ID    | Unique identifier (truncated)                      |
| Symbol      | Instrument                                         |
| Type        | limit / market / stop_limit / stop_market          |
| Side        | buy / sell                                         |
| Price       | Limit price (blank for market / stop orders)       |
| Stop Price  | Trigger price (stop orders only)                   |
| Limit Price | Activation limit price (stop_limit only)           |
| Quantity    | Total order quantity                               |
| Filled      | Quantity filled so far                             |
| Status      | Current status                                     |
| Created     | Time the order was placed                          |
| Action      | Cancel button (where applicable)                   |

---

### 7.2 Order Statuses Explained

| Status            | Meaning                                                                 |
|-------------------|-------------------------------------------------------------------------|
| `open`            | Resting on the order book, waiting for a match. Quantity filled = 0.   |
| `partial`         | Partially matched. Some quantity filled; remainder still on the book.  |
| `filled`          | Fully executed. No remaining quantity.                                  |
| `pending_trigger` | Stop order saved but not yet triggered. Waiting for price condition.   |
| `triggered`       | Stop order has fired; a new limit/market order was sent to the engine. |
| `cancelled`       | Order was cancelled by the user before fully filling.                  |
| `failed`          | Order could not be submitted to the matching engine (system error).    |

**Terminal statuses** (`filled`, `cancelled`, `failed`) cannot be changed — these orders move to the order history.

---

### 7.3 Cancelling an Order

Click the **Cancel** button next to any `open`, `partial`, or `pending_trigger` order.

Rules:
- **Limit orders** (`open` or `partial`): cancel removes the remaining quantity from the order book immediately.
- **Stop orders** (`pending_trigger`): cancel removes the order from the trigger engine — it will never activate.
- **Market orders**: cannot be cancelled — they execute instantly on submission.
- **Filled orders**: cannot be cancelled — they are already done.
- **Triggered stop orders**: the underlying limit/market order that was submitted may be cancellable (if it is still `open`/`partial`), but the original stop order record itself is already `triggered`.

After cancellation the order moves to the order history with status `cancelled`.

---

## 8. Portfolio & Holdings

The **Portfolio** tab shows your current holdings across all symbols.

| Column        | Description                                                             |
|---------------|-------------------------------------------------------------------------|
| Symbol        | Instrument you hold                                                     |
| Quantity      | Number of units currently held (only positive holdings shown)          |
| Avg Cost      | Your average purchase cost per unit (weighted average of all fills)    |
| Current Price | Latest market price fetched from the live ticker                       |
| Unrealized P&L| (Current Price − Avg Cost) × Quantity — how much your position is up/down |

**Balance:** Your current cash balance (virtual) is shown in the account header. It decreases when you buy (cost = fill price × quantity) and increases when you sell.

**How average cost is calculated:**

When you buy, your average cost is recalculated as:

```
new_avg_cost = (old_avg_cost × old_quantity + fill_price × fill_qty)
               ─────────────────────────────────────────────────────
                        old_quantity + fill_qty
```

When you sell, the quantity decreases and the average cost of remaining shares stays unchanged.

**Holdings update** automatically after each trade that involves your orders — there is a short async processing delay (typically under 1 second) between a fill and the portfolio refreshing.

---

## 9. Trade History

The **Order History** tab shows all past orders regardless of status. Use it to review:

- All filled orders with their fill quantities and prices.
- Cancelled orders.
- Failed orders.
- Triggered stop orders and the fill result of the orders they spawned.

You can filter by:
- **Symbol** — show only orders for a specific instrument.
- **Status** — e.g. show only `filled`, or only `cancelled`.

Up to 50 orders are shown per page (most recent first).

For executed trades specifically — the **Recent Trades** panel on the chart shows the market-wide trade tape (all participants). Your individual trades are reflected in your order history and portfolio.

---

## 10. Real-Time Updates — WebSocket

The dashboard maintains a persistent WebSocket connection to the server for the currently selected symbol. No page refresh is needed — everything updates live.

**What updates in real time:**

| Panel                  | Update trigger                                      |
|------------------------|-----------------------------------------------------|
| Price ticker           | Every trade execution                               |
| Candlestick chart      | Every new candle close (1s / 10s / 1m)             |
| Order book             | After every order placement, cancellation, or fill |
| Recent trades feed     | Every trade execution                               |
| Open orders status     | After your orders fill or partially fill            |
| Stop order activation  | When your stop order triggers                       |

When you switch symbols, the WebSocket subscription changes to the new symbol automatically.

**Connection status** is shown in the header (connected / reconnecting). If the connection drops, the dashboard reconnects automatically with exponential backoff.

---

## 11. Quick Reference — What Can I Do?

### Without logging in
- Browse all 5 symbols.
- View live price ticker for any symbol.
- View the live order book for any symbol.
- View the candlestick chart (1s / 10s / 1m) for any symbol.
- View the recent trades feed for any symbol.

### After logging in
Everything above, plus:

**Trading**
- Place a **limit order** (buy or sell) at a specific price.
- Place a **market order** (buy or sell) for immediate execution at the best available price.
- Place a **stop-limit order** — activates a limit order when price reaches your stop level.
- Place a **stop-market order** — activates a market order when price reaches your stop level.
- Trade all 5 symbols from the same account simultaneously.

**Order control**
- View all open orders (open, partial, pending_trigger).
- Cancel any resting limit order at any time.
- Cancel any pending stop order before it triggers.
- View full order history with fill details, timestamps, and statuses.

**Portfolio**
- View current holdings per symbol.
- See quantity held, average cost, current price, and unrealized P&L.
- Monitor your cash balance.

**Notifications / real-time**
- Receive a real-time notification when a stop order triggers.
- See order status update live when a fill happens (no page refresh needed).

---

### Order type decision guide

```
Do you need to execute RIGHT NOW at any price?
  └─ YES → Market Order

Do you need a specific price or better?
  └─ YES → Limit Order

Do you want to trigger a trade only AFTER price moves to a certain level?
  ├─ Need guaranteed execution once triggered → Stop-Market Order
  └─ Need price control after triggering      → Stop-Limit Order
```
