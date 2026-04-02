import React, { useEffect, useRef } from 'react';
import { createChart, LineSeries, HistogramSeries } from 'lightweight-charts';

/**
 * IndicatorPanel
 * Renders a single sub-chart pane for one sub-indicator (MACD, RSI, VOL, etc.)
 * Props:
 *   - indicatorKey  string
 *   - data          computed result from indicators.js
 *   - params        indicator params (colours, etc.)
 *   - height        number (px), default 120
 */
export default function IndicatorPanel({ indicatorKey, data, params, height = 120 }) {
    const containerRef = useRef(null);
    const chartRef = useRef(null);

    useEffect(() => {
        if (!containerRef.current || !data) return;

        const chart = createChart(containerRef.current, {
            layout: {
                background: { type: 'solid', color: 'transparent' },
                textColor: 'rgba(255,255,255,0.7)',
                fontFamily: 'Roboto Mono',
            },
            grid: {
                vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
                horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
            },
            timeScale: {
                visible: false,
                borderColor: 'rgba(255, 255, 255, 0.05)',
            },
            rightPriceScale: {
                borderColor: 'rgba(255, 255, 255, 0.05)',
                scaleMargins: { top: 0.1, bottom: 0.1 },
            },
            crosshair: { mode: 0 },
            handleScroll: false,
            handleScale: false,
            width: containerRef.current.clientWidth,
            height,
        });

        chartRef.current = chart;

        const addLine = (pts, color, lineWidth = 1) => {
            if (!pts || pts.length === 0) return null;
            const s = chart.addSeries(LineSeries, { color, lineWidth, priceLineVisible: false, lastValueVisible: false });
            s.setData(pts);
            return s;
        };

        const addHist = (pts, color) => {
            if (!pts || pts.length === 0) return null;
            const s = chart.addSeries(HistogramSeries, { color, priceLineVisible: false, lastValueVisible: false });
            s.setData(pts);
            return s;
        };

        switch (indicatorKey) {
            case 'VOL': {
                const volSeries = chart.addSeries(HistogramSeries, {
                    priceLineVisible: false, lastValueVisible: false, priceScaleId: 'right',
                });
                volSeries.setData(data.volume ?? []);
                if (data.ma1 && data.ma1.length) addLine(data.ma1, params?.maColor1 ?? '#00BCD4');
                if (data.ma2 && data.ma2.length) addLine(data.ma2, params?.maColor2 ?? '#E040FB');
                break;
            }
        case 'MACD': {
            const p = params ?? {};
            // Histogram bars: color based on direction (positive/negative) and previous value
            const histogram = data.histogram ?? [];
            const histData = histogram.map((bar, i) => {
                const prev = histogram[i - 1]?.value ?? 0;
                const positive = bar.value >= 0;
                const growing  = bar.value > prev;
                let color;
                if (positive && growing)  color = p.longGrow?.color  ?? 'rgba(14,203,129,0.9)';
                if (positive && !growing) color = p.longFall?.color   ?? 'rgba(14,203,129,0.5)';
                if (!positive && growing) color = p.shortGrow?.color  ?? 'rgba(246,70,93,0.5)';
                if (!positive && !growing)color = p.shortFall?.color  ?? 'rgba(246,70,93,0.9)';
                return { ...bar, color };
            });
            // MACD bar
            if (p.macdBar !== false && histData.length > 0) {
                const hs = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false });
                hs.setData(histData);
            }
            // DIF line (macd line = fast EMA – slow EMA)
            if (p.dif?.visible !== false && data.macd?.length > 0) {
                addLine(data.macd, p.dif?.color ?? '#AB47BC');
            }
            // DEA line (signal line = EMA of DIF)
            if (p.dea?.visible !== false && data.signal?.length > 0) {
                addLine(data.signal, p.dea?.color ?? '#E040FB');
            }
            break;
        }

            case 'RSI':
                addLine(data, params?.color ?? '#E040FB');
                // Overbought/Oversold reference lines
                chart.addSeries(LineSeries, { color: 'rgba(246,70,93,0.4)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
                    .setData(data.map(p => ({ time: p.time, value: 70 })));
                chart.addSeries(LineSeries, { color: 'rgba(14,203,129,0.4)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
                    .setData(data.map(p => ({ time: p.time, value: 30 })));
                break;
            case 'KDJ':
                addLine(data.map(p => ({ time: p.time, value: p.k })), params?.kColor ?? '#ff4500');
                addLine(data.map(p => ({ time: p.time, value: p.d })), params?.dColor ?? '#E040FB');
                addLine(data.map(p => ({ time: p.time, value: p.j })), params?.jColor ?? '#0ECB81');
                break;
            case 'StochRSI':
                addLine(data.map(p => ({ time: p.time, value: p.k })), params?.kColor ?? '#ff4500');
                addLine(data.filter(p => p.d !== null).map(p => ({ time: p.time, value: p.d })), params?.dColor ?? '#E040FB');
                break;
            case 'OBV':
                addLine(data, params?.color ?? '#ff4500');
                break;
            case 'CCI':
                addLine(data, params?.color ?? '#FF9800');
                chart.addSeries(LineSeries, { color: 'rgba(246,70,93,0.3)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
                    .setData(data.map(p => ({ time: p.time, value: 100 })));
                chart.addSeries(LineSeries, { color: 'rgba(14,203,129,0.3)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
                    .setData(data.map(p => ({ time: p.time, value: -100 })));
                break;
            case 'WR':
                addLine(data, params?.color ?? '#ff4500');
                chart.addSeries(LineSeries, { color: 'rgba(246,70,93,0.3)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
                    .setData(data.map(p => ({ time: p.time, value: -20 })));
                chart.addSeries(LineSeries, { color: 'rgba(14,203,129,0.3)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
                    .setData(data.map(p => ({ time: p.time, value: -80 })));
                break;
            case 'MFI':
                addLine(data, params?.color ?? '#00BCD4');
                chart.addSeries(LineSeries, { color: 'rgba(246,70,93,0.3)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
                    .setData(data.map(p => ({ time: p.time, value: 80 })));
                chart.addSeries(LineSeries, { color: 'rgba(14,203,129,0.3)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
                    .setData(data.map(p => ({ time: p.time, value: 20 })));
                break;
            default:
                break;
        }

        const handleResize = () => {
            if (containerRef.current && chartRef.current) {
                chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
            }
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
            chartRef.current = null;
        };
    }, [indicatorKey, data, params, height]);

    const LABELS = {
        VOL: 'VOL', MACD: 'MACD', RSI: 'RSI', KDJ: 'KDJ',
        OBV: 'OBV', CCI: 'CCI', StochRSI: 'StochRSI', WR: 'WR%', MFI: 'MFI'
    };

    return (
        <div style={{ position: 'relative', width: '100%', height, flexShrink: 0, borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
            <div style={{
                position: 'absolute', top: 4, left: 8, zIndex: 5,
                fontSize: '10px', color: 'var(--color-text-muted)', pointerEvents: 'none'
            }}>
                {LABELS[indicatorKey] ?? indicatorKey}
            </div>
            <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        </div>
    );
}
