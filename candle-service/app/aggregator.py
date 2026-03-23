"""
OHLCV candle aggregation using bucket-aligned timestamps.
Bucket boundary: (ts_ms // interval_ms) * interval_ms
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional


@dataclass
class OpenCandle:
    symbol: str
    interval: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    start_time: int  # bucket start unix ms
    trade_count: int = 0

    def to_dict(self) -> dict:
        return {
            "open":       self.open,
            "high":       self.high,
            "low":        self.low,
            "close":      self.close,
            "volume":     self.volume,
            "timestamp":  self.start_time,
        }


class Aggregator:
    """
    Stateful OHLCV aggregator.
    Tracks open candles per (symbol, interval) pair.
    Returns closed candles when a trade crosses a bucket boundary.
    """

    INTERVALS: Dict[str, int] = {
        "1s":  1_000,
        "10s": 10_000,
        "1m":  60_000,
    }

    def __init__(self) -> None:
        # _open[symbol][interval] = OpenCandle | None
        self._open: Dict[str, Dict[str, Optional[OpenCandle]]] = {}

    def process_trade(
        self,
        symbol: str,
        price: float,
        quantity: float,
        timestamp_ms: int,
    ) -> list[OpenCandle]:
        """
        Process one trade tick.
        Returns a list of candles that were *closed* by this trade.
        """
        closed: list[OpenCandle] = []

        for interval, ms in self.INTERVALS.items():
            bucket = (timestamp_ms // ms) * ms
            sym_open = self._open.setdefault(symbol, {})
            existing = sym_open.get(interval)

            if existing is None or existing.start_time != bucket:
                # Close the old candle (if any)
                if existing is not None:
                    closed.append(existing)

                # Open a new candle for this bucket
                sym_open[interval] = OpenCandle(
                    symbol=symbol,
                    interval=interval,
                    open=price,
                    high=price,
                    low=price,
                    close=price,
                    volume=quantity,
                    start_time=bucket,
                    trade_count=1,
                )
            else:
                # Update existing candle
                c = existing
                c.high = max(c.high, price)
                c.low = min(c.low, price)
                c.close = price
                c.volume += quantity
                c.trade_count += 1

        return closed

    def force_close_stale(self, now_ms: int) -> list[OpenCandle]:
        """
        Force-close any candle whose bucket has already ended.
        Called by a periodic timer to flush candles even if no new trade arrives.
        """
        closed: list[OpenCandle] = []

        for symbol, intervals in self._open.items():
            for interval, ms in self.INTERVALS.items():
                current_bucket = (now_ms // ms) * ms
                existing = intervals.get(interval)
                if existing and existing.start_time < current_bucket:
                    closed.append(existing)
                    intervals[interval] = None

        return closed
