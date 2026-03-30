#!/usr/bin/env python3
"""
test_market_stream.py – Live L2 order book viewer for Synthetic-Bull.

Connects to ws://host:port/ws/market/{symbol} and renders the full
10-level bid/ask book refreshing in place at 100 ticks/sec.

Usage:
    python test_market_stream.py [SYMBOL] [--host HOST] [--port PORT]

Examples:
    python test_market_stream.py
    python test_market_stream.py TSLA_S
    python test_market_stream.py AAPL_S --host 192.168.1.10 --port 8001

Press Ctrl+C to quit.
"""

import argparse
import asyncio
import json
import os
import signal
import sys
from datetime import datetime

try:
    import websockets
except ImportError:
    print("ERROR: 'websockets' package not found.\n"
          "Install it with:  pip install websockets")
    sys.exit(1)


# ─── ANSI colours ─────────────────────────────────────────────────────────────

RED    = "\033[31m"
GREEN  = "\033[32m"
YELLOW = "\033[33m"
CYAN   = "\033[36m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

SEP_HEAVY = "═" * 64
SEP_LIGHT = "─" * 64


# ─── Rendering ────────────────────────────────────────────────────────────────

def render_book(data: dict) -> str:
    symbol     = data.get("symbol", "?")
    tick       = data.get("tick", 0)
    mid        = data.get("mid", 0.0)
    spread     = data.get("spread", 0.0)
    spread_pct = data.get("spread_pct", 0.0)
    ts_ms      = data.get("ts", 0)
    asks: list = data.get("asks", [])
    bids: list = data.get("bids", [])

    ts_str = datetime.fromtimestamp(ts_ms / 1000).strftime("%H:%M:%S.%f")[:-3]

    lines: list[str] = []
    lines.append(SEP_HEAVY)
    lines.append(
        f"  {BOLD}{CYAN}{symbol}{RESET}"
        f"   Tick: {tick:<10}"
        f"   {ts_str}"
    )
    lines.append(
        f"  Mid: {BOLD}{mid:>12.4f}{RESET}"
        f"   Spread: {spread:>8.4f}"
        f"  ({spread_pct:.4f} %)"
    )
    lines.append(SEP_HEAVY)
    lines.append(
        f"  {'Side':<6}"
        f"{'Level':>7}"
        f"{'Price':>14}"
        f"{'Size':>10}"
        f"{'Bar':<20}"
    )
    lines.append(SEP_LIGHT)

    # ASKs — worst (deepest) down to best (top of book)
    max_size = max((lvl["size"] for lvl in asks + bids), default=1)
    for i in range(len(asks) - 1, -1, -1):
        lvl   = asks[i]
        bar_w = max(1, int(lvl["size"] / max_size * 18))
        bar   = "█" * bar_w
        lines.append(
            f"  {RED}ASK{RESET}"
            f"  [{i + 1:>2}]"
            f"  {lvl['price']:>14.4f}"
            f"  {lvl['size']:>8}"
            f"  {RED}{bar}{RESET}"
        )

    lines.append(SEP_LIGHT)
    lines.append(f"  {BOLD}{'*** mid':>10}  {mid:>12.4f} ***{RESET}")
    lines.append(SEP_LIGHT)

    # BIDs — best (top of book) down to worst
    for i, lvl in enumerate(bids):
        bar_w = max(1, int(lvl["size"] / max_size * 18))
        bar   = "█" * bar_w
        lines.append(
            f"  {GREEN}BID{RESET}"
            f"  [{i + 1:>2}]"
            f"  {lvl['price']:>14.4f}"
            f"  {lvl['size']:>8}"
            f"  {GREEN}{bar}{RESET}"
        )

    lines.append(SEP_HEAVY)
    lines.append(f"  {YELLOW}Press Ctrl+C to quit{RESET}")

    return "\n".join(lines)


# ─── WebSocket client ─────────────────────────────────────────────────────────

async def stream(uri: str) -> None:
    reconnect_delay = 1

    while True:
        try:
            print(f"Connecting to {uri} …")
            async with websockets.connect(
                uri,
                ping_interval=20,
                ping_timeout=10,
            ) as ws:
                reconnect_delay = 1  # reset on successful connect
                async for raw in ws:
                    try:
                        data = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    if data.get("type") == "ping":
                        continue

                    # Clear screen + move cursor to top-left (ANSI)
                    sys.stdout.write("\033[2J\033[H")
                    sys.stdout.write(render_book(data))
                    sys.stdout.write("\n")
                    sys.stdout.flush()

        except (websockets.exceptions.ConnectionClosed,
                websockets.exceptions.WebSocketException,
                OSError) as e:
            print(f"\nConnection lost: {e}")
            print(f"Reconnecting in {reconnect_delay}s …")
            await asyncio.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, 30)

        except asyncio.CancelledError:
            return


# ─── Entry point ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Live L2 order book viewer — Synthetic-Bull market stream",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "symbol",
        nargs="?",
        default=os.environ.get("SYMBOL", "AAPL_S"),
        help="Stock symbol to stream (default: AAPL_S)",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("WS_HOST", "localhost"),
        help="WebSocket host (default: localhost, env: WS_HOST)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("WS_PORT", "8001")),
        help="WebSocket port (default: 8001, env: WS_PORT)",
    )
    args = parser.parse_args()

    uri = f"ws://{args.host}:{args.port}/ws/market/{args.symbol}"

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    task = loop.create_task(stream(uri))

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, task.cancel)

    try:
        loop.run_until_complete(task)
    except asyncio.CancelledError:
        pass
    finally:
        loop.close()
        # Restore cursor / clear line on exit
        sys.stdout.write("\033[?25h\n")
        print("Disconnected.")


if __name__ == "__main__":
    main()
