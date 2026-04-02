/**
 * indicators.js
 * Pure calculation functions for technical indicators.
 * All functions accept an array of candle objects: { time, open, high, low, close, volume }
 * and return arrays of { time, value } (or structured objects for bands/MACD/KDJ).
 */

function getSource(c, source) {
    switch (source) {
        case 'open':  return c.open;
        case 'high':  return c.high;
        case 'low':   return c.low;
        default:      return c.close;
    }
}

/** Simple Moving Average */
export function calcSMA(candles, period, source = 'close') {
    const result = [];
    for (let i = period - 1; i < candles.length; i++) {
        const slice = candles.slice(i - period + 1, i + 1);
        const avg = slice.reduce((s, c) => s + getSource(c, source), 0) / period;
        result.push({ time: candles[i].time, value: +avg.toFixed(4) });
    }
    return result;
}

/** Exponential Moving Average */
export function calcEMA(candles, period, source = 'close') {
    const k = 2 / (period + 1);
    const result = [];
    let ema = null;
    for (let i = 0; i < candles.length; i++) {
        if (ema === null) {
            if (i < period - 1) continue;
            ema = candles.slice(0, period).reduce((s, c) => s + getSource(c, source), 0) / period;
        } else {
            ema = getSource(candles[i], source) * k + ema * (1 - k);
        }
        result.push({ time: candles[i].time, value: +ema.toFixed(4) });
    }
    return result;
}

/** Weighted Moving Average */
export function calcWMA(candles, period, source = 'close') {
    const result = [];
    const denom = (period * (period + 1)) / 2;
    for (let i = period - 1; i < candles.length; i++) {
        let wsum = 0;
        for (let j = 0; j < period; j++) {
            wsum += getSource(candles[i - period + 1 + j], source) * (j + 1);
        }
        result.push({ time: candles[i].time, value: +(wsum / denom).toFixed(4) });
    }
    return result;
}

/** Bollinger Bands — returns { upper, middle, lower } each being {time,value}[] */
export function calcBollingerBands(candles, period = 20, stdDevMult = 2) {
    const upper = [], middle = [], lower = [];
    for (let i = period - 1; i < candles.length; i++) {
        const slice = candles.slice(i - period + 1, i + 1);
        const avg = slice.reduce((s, c) => s + c.close, 0) / period;
        const variance = slice.reduce((s, c) => s + Math.pow(c.close - avg, 2), 0) / period;
        const sd = Math.sqrt(variance);
        const t = candles[i].time;
        middle.push({ time: t, value: +avg.toFixed(4) });
        upper.push({ time: t, value: +(avg + stdDevMult * sd).toFixed(4) });
        lower.push({ time: t, value: +(avg - stdDevMult * sd).toFixed(4) });
    }
    return { upper, middle, lower };
}

/** VWAP — Volume-Weighted Average Price, returns {time,value}[] */
export function calcVWAP(candles) {
    const result = [];
    let cumPV = 0, cumVol = 0;
    for (const c of candles) {
        const typical = (c.high + c.low + c.close) / 3;
        const vol = c.volume ?? 0;
        cumPV += typical * vol;
        cumVol += vol;
        result.push({ time: c.time, value: cumVol === 0 ? typical : +(cumPV / cumVol).toFixed(4) });
    }
    return result;
}

/** Parabolic SAR — returns {time, value, color}[] */
export function calcSAR(candles, step = 0.02, max = 0.2) {
    if (candles.length < 2) return [];
    const result = [];
    let bull = true;
    let sar = candles[0].low;
    let ep = candles[0].high;
    let af = step;

    for (let i = 1; i < candles.length; i++) {
        const c = candles[i];
        const prevSar = sar;
        sar = prevSar + af * (ep - prevSar);

        if (bull) {
            if (c.low < sar) {
                bull = false;
                sar = ep;
                ep = c.low;
                af = step;
            } else {
                if (c.high > ep) { ep = c.high; af = Math.min(af + step, max); }
                sar = Math.min(sar, candles[i - 1].low, i > 1 ? candles[i - 2].low : candles[i - 1].low);
            }
        } else {
            if (c.high > sar) {
                bull = true;
                sar = ep;
                ep = c.high;
                af = step;
            } else {
                if (c.low < ep) { ep = c.low; af = Math.min(af + step, max); }
                sar = Math.max(sar, candles[i - 1].high, i > 1 ? candles[i - 2].high : candles[i - 1].high);
            }
        }
        result.push({ time: c.time, value: +sar.toFixed(4), color: bull ? '#0ECB81' : '#F6465D' });
    }
    return result;
}

/** Supertrend — returns { upper, lower, trend }[] where trend is 1 (bull) or -1 (bear) */
export function calcSupertrend(candles, period = 10, multiplier = 3) {
    if (candles.length < period) return [];
    // ATR
    const atr = [];
    for (let i = 1; i < candles.length; i++) {
        const tr = Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - candles[i - 1].close),
            Math.abs(candles[i].low - candles[i - 1].close)
        );
        atr.push({ time: candles[i].time, tr, idx: i });
    }
    // Smooth ATR
    let smoothATR = atr.slice(0, period).reduce((s, a) => s + a.tr, 0) / period;
    const atrSmooth = [{ ...atr[period - 1], atr: smoothATR }];
    for (let i = period; i < atr.length; i++) {
        smoothATR = (smoothATR * (period - 1) + atr[i].tr) / period;
        atrSmooth.push({ ...atr[i], atr: smoothATR });
    }

    const result = [];
    let prevUpper = 0, prevLower = 0, prevTrend = 1;

    for (let i = 0; i < atrSmooth.length; i++) {
        const ci = candles[atrSmooth[i].idx];
        const hl2 = (ci.high + ci.low) / 2;
        let upper = hl2 + multiplier * atrSmooth[i].atr;
        let lower = hl2 - multiplier * atrSmooth[i].atr;

        if (i > 0) {
            upper = (upper < prevUpper || candles[atrSmooth[i - 1].idx].close > prevUpper) ? upper : prevUpper;
            lower = (lower > prevLower || candles[atrSmooth[i - 1].idx].close < prevLower) ? lower : prevLower;
        }

        let trend = prevTrend;
        if (ci.close > prevUpper) trend = 1;
        else if (ci.close < prevLower) trend = -1;

        result.push({
            time: ci.time,
            value: trend === 1 ? +lower.toFixed(4) : +upper.toFixed(4),
            color: trend === 1 ? '#0ECB81' : '#F6465D'
        });
        prevUpper = upper; prevLower = lower; prevTrend = trend;
    }
    return result;
}

/** TRIX — Triple EMA Rate-of-Change, returns {time,value}[] */
export function calcTRIX(candles, period = 14) {
    const e1 = calcEMAValues(candles, period);
    const fauxCandles1 = e1.map(p => ({ ...candles.find(c => c.time === p.time), close: p.value })).filter(Boolean);
    const e2 = calcEMAValues(fauxCandles1, period);
    const fauxCandles2 = e2.map(p => ({ ...fauxCandles1.find(c => c.time === p.time), close: p.value })).filter(Boolean);
    const e3 = calcEMAValues(fauxCandles2, period);

    const result = [];
    for (let i = 1; i < e3.length; i++) {
        const trix = ((e3[i].value - e3[i - 1].value) / e3[i - 1].value) * 100;
        result.push({ time: e3[i].time, value: +trix.toFixed(6) });
    }
    return result;
}

/** RSI — returns {time, value}[] */
export function calcRSI(candles, period = 14) {
    const result = [];
    if (candles.length < period + 1) return result;

    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = candles[i].close - candles[i - 1].close;
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period; i < candles.length; i++) {
        if (i > period) {
            const diff = candles[i].close - candles[i - 1].close;
            const gain = diff >= 0 ? diff : 0;
            const loss = diff < 0 ? -diff : 0;
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
        }
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
        result.push({ time: candles[i].time, value: +rsi.toFixed(2) });
    }
    return result;
}

/** StochRSI — RSI of RSI, returns { k, d }[] */
export function calcStochRSI(candles, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3) {
    const rsi = calcRSI(candles, rsiPeriod);
    const k = [], d = [];
    for (let i = stochPeriod - 1; i < rsi.length; i++) {
        const slice = rsi.slice(i - stochPeriod + 1, i + 1).map(p => p.value);
        const minRSI = Math.min(...slice);
        const maxRSI = Math.max(...slice);
        const kVal = maxRSI === minRSI ? 0 : ((rsi[i].value - minRSI) / (maxRSI - minRSI)) * 100;
        k.push({ time: rsi[i].time, value: +kVal.toFixed(2) });
    }
    // Smooth K
    const kSmoothed = [];
    for (let i = kSmooth - 1; i < k.length; i++) {
        const avg = k.slice(i - kSmooth + 1, i + 1).reduce((s, p) => s + p.value, 0) / kSmooth;
        kSmoothed.push({ time: k[i].time, value: +avg.toFixed(2) });
    }
    // D = SMA of smoothed K
    for (let i = dSmooth - 1; i < kSmoothed.length; i++) {
        const avg = kSmoothed.slice(i - dSmooth + 1, i + 1).reduce((s, p) => s + p.value, 0) / dSmooth;
        d.push({ time: kSmoothed[i].time, value: +avg.toFixed(2) });
    }
    const dMap = new Map(d.map(p => [p.time, p.value]));
    return kSmoothed.map(p => ({ time: p.time, k: p.value, d: dMap.get(p.time) ?? null }));
}

/** MACD — returns { macd, signal, histogram } each being {time,value}[] */
export function calcMACD(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const fastEMA = calcEMAValues(candles, fastPeriod);
    const slowEMA = calcEMAValues(candles, slowPeriod);

    const slowMap = new Map(slowEMA.map(p => [p.time, p.value]));
    const macdLine = fastEMA
        .filter(p => slowMap.has(p.time))
        .map(p => ({ time: p.time, value: +(p.value - slowMap.get(p.time)).toFixed(4) }));

    const signalLine = calcEMAFromValues(macdLine, signalPeriod);
    const signalMap = new Map(signalLine.map(p => [p.time, p.value]));

    const histogram = signalLine.map(p => ({
        time: p.time,
        value: +((macdLine.find(m => m.time === p.time)?.value ?? 0) - p.value).toFixed(4)
    }));

    return { macd: macdLine, signal: signalLine, histogram };
}

/** KDJ — Stochastic oscillator, returns { k, d, j }[] */
export function calcKDJ(candles, period = 9, kSmooth = 3, dSmooth = 3) {
    const result = [];
    for (let i = period - 1; i < candles.length; i++) {
        const slice = candles.slice(i - period + 1, i + 1);
        const highestHigh = Math.max(...slice.map(c => c.high));
        const lowestLow = Math.min(...slice.map(c => c.low));
        const rsv = highestHigh === lowestLow ? 50 :
            ((candles[i].close - lowestLow) / (highestHigh - lowestLow)) * 100;

        const prevK = result.length > 0 ? result[result.length - 1].k : 50;
        const prevD = result.length > 0 ? result[result.length - 1].d : 50;

        const k = (prevK * (kSmooth - 1) + rsv) / kSmooth;
        const d = (prevD * (dSmooth - 1) + k) / dSmooth;
        const j = 3 * k - 2 * d;

        result.push({ time: candles[i].time, k: +k.toFixed(2), d: +d.toFixed(2), j: +j.toFixed(2) });
    }
    return result;
}

/** OBV — On-Balance Volume, returns {time, value}[] */
export function calcOBV(candles) {
    const result = [];
    let obv = 0;
    for (let i = 0; i < candles.length; i++) {
        if (i > 0) {
            if (candles[i].close > candles[i - 1].close) obv += (candles[i].volume ?? 0);
            else if (candles[i].close < candles[i - 1].close) obv -= (candles[i].volume ?? 0);
        }
        result.push({ time: candles[i].time, value: +obv.toFixed(0) });
    }
    return result;
}

/** CCI — Commodity Channel Index, returns {time, value}[] */
export function calcCCI(candles, period = 20) {
    const result = [];
    for (let i = period - 1; i < candles.length; i++) {
        const slice = candles.slice(i - period + 1, i + 1);
        const typicals = slice.map(c => (c.high + c.low + c.close) / 3);
        const avg = typicals.reduce((s, v) => s + v, 0) / period;
        const meanDev = typicals.reduce((s, v) => s + Math.abs(v - avg), 0) / period;
        const cci = meanDev === 0 ? 0 : (typicals[typicals.length - 1] - avg) / (0.015 * meanDev);
        result.push({ time: candles[i].time, value: +cci.toFixed(2) });
    }
    return result;
}

/** Williams %R, returns {time, value}[] */
export function calcWR(candles, period = 14) {
    const result = [];
    for (let i = period - 1; i < candles.length; i++) {
        const slice = candles.slice(i - period + 1, i + 1);
        const highestHigh = Math.max(...slice.map(c => c.high));
        const lowestLow = Math.min(...slice.map(c => c.low));
        const wr = highestHigh === lowestLow ? -50 :
            ((highestHigh - candles[i].close) / (highestHigh - lowestLow)) * -100;
        result.push({ time: candles[i].time, value: +wr.toFixed(2) });
    }
    return result;
}

/** MFI — Money Flow Index, returns {time, value}[] */
export function calcMFI(candles, period = 14) {
    const result = [];
    if (candles.length < period + 1) return result;

    for (let i = period; i < candles.length; i++) {
        let posFlow = 0, negFlow = 0;
        const prevTypical = (candles[i - period].high + candles[i - period].low + candles[i - period].close) / 3;
        for (let j = i - period + 1; j <= i; j++) {
            const typical = (candles[j].high + candles[j].low + candles[j].close) / 3;
            const prevTyp = (candles[j - 1].high + candles[j - 1].low + candles[j - 1].close) / 3;
            const mf = typical * (candles[j].volume ?? 0);
            if (typical > prevTyp) posFlow += mf;
            else if (typical < prevTyp) negFlow += mf;
        }
        const mfi = negFlow === 0 ? 100 : 100 - (100 / (1 + posFlow / negFlow));
        result.push({ time: candles[i].time, value: +mfi.toFixed(2) });
    }
    return result;
}

/** Volume — returns {time, value, color}[] */
export function calcVolume(candles) {
    return candles.map(c => ({
        time: c.time,
        value: c.volume ?? 0,
        color: c.close >= c.open ? 'rgba(14,203,129,0.5)' : 'rgba(246,70,93,0.5)'
    }));
}

// ─── helpers ────────────────────────────────────────────────────────────────

function calcEMAValues(candles, period) {
    const k = 2 / (period + 1);
    const result = [];
    let ema = null;
    for (let i = 0; i < candles.length; i++) {
        if (ema === null) {
            if (i < period - 1) continue;
            ema = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
        } else {
            ema = candles[i].close * k + ema * (1 - k);
        }
        result.push({ time: candles[i].time, value: +ema.toFixed(4) });
    }
    return result;
}

function calcEMAFromValues(pts, period) {
    const k = 2 / (period + 1);
    const result = [];
    let ema = null;
    for (let i = 0; i < pts.length; i++) {
        if (ema === null) {
            if (i < period - 1) continue;
            ema = pts.slice(0, period).reduce((s, p) => s + p.value, 0) / period;
        } else {
            ema = pts[i].value * k + ema * (1 - k);
        }
        result.push({ time: pts[i].time, value: +ema.toFixed(4) });
    }
    return result;
}
