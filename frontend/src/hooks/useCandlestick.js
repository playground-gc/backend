/**
 * @file useCandlestick.js
 * @description Builds the initial OHLCV series from marketStore history and subscribes to
 * live candle updates, returning a ref-safe API for lightweight-charts series.update().
 * @exports useCandlestick  (interval: '1s' | '5s') => { seriesData: CandleData[], latestCandle }
 * @note Batch candle updates within a requestAnimationFrame to cap redraws at 60fps.
 */

export const useCandlestick = () => ({ seriesData: [], latestCandle: null });
