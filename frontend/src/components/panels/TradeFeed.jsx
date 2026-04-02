import { useEffect, useState, useRef } from 'react';
import { dataManager } from '../../services/dataManager';

const MAX_TRADES = 35;

function formatTime(ms) {
  if (!ms) return '--:--:--';
  const d = new Date(ms);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function TradeFeed({ symbol }) {
  const [trades, setTrades] = useState([]);
  const [stats, setStats] = useState({ buyVol: 0, sellVol: 0, count: 0 });
  const flashSetRef = useRef(new Set());
  const prevTopRef = useRef(null);

  useEffect(() => {
    setTrades([]);
    prevTopRef.current = null;
    flashSetRef.current = new Set();

    const unsub = dataManager.subscribe(symbol, (data) => {
      const incoming = data.latestTrades;
      if (!incoming || incoming.length === 0) return;
      setTrades(prev => {
        const top = incoming[0];
        // detect new trade
        if (prevTopRef.current && top.time !== prevTopRef.current) {
          flashSetRef.current.add(top.time + '_' + top.price);
          setTimeout(() => flashSetRef.current.delete(top.time + '_' + top.price), 600);
        }
        prevTopRef.current = top?.time;
        return incoming.slice(0, MAX_TRADES);
      });
    });
    return unsub;
  }, [symbol]);

  // Annotate direction + compute stats
  const annotated = trades.map((t, i) => {
    const prev = trades[i + 1];
    let dir = 'neutral';
    if (prev) {
      if (t.price > prev.price) dir = 'up';
      else if (t.price < prev.price) dir = 'down';
    }
    return { ...t, dir };
  });

  const maxSize = annotated.length > 0 ? Math.max(...annotated.map(t => t.size || 0)) : 1;
  const buyVol = annotated.filter(t => t.dir === 'up').reduce((s, t) => s + (t.size || 0), 0);
  const totalVol = annotated.reduce((s, t) => s + (t.size || 0), 0);
  const buyPct = totalVol > 0 ? Math.round((buyVol / totalVol) * 100) : 50;

  return (
    <div style={s.wrapper}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.liveDot} />
          <span style={s.headerTitle}>Recent Trades</span>
        </div>
        <span style={s.symbolBadge}>{symbol}</span>
      </div>

      {/* Column labels */}
      <div style={s.colRow}>
        <span style={{ ...s.col, flex: 1.1 }}>Time</span>
        <span style={{ ...s.col, flex: 1.2, textAlign: 'right' }}>Price (USD)</span>
        <span style={{ ...s.col, flex: 0.9, textAlign: 'right' }}>Qty</span>
      </div>

      {/* Trade rows */}
      <div style={s.list}>
        {annotated.length === 0 ? (
          <div style={s.empty}>
            <div style={s.emptyDot} />
            <span>Awaiting trades…</span>
          </div>
        ) : (
          annotated.map((t, i) => {
            const isUp = t.dir === 'up';
            const isDown = t.dir === 'down';
            const color = isUp ? '#0ECB81' : isDown ? '#F6465D' : 'rgba(255,255,255,0.55)';
            const barColor = isUp ? 'rgba(14,203,129,0.12)' : isDown ? 'rgba(246,70,93,0.12)' : 'rgba(255,255,255,0.04)';
            const barW = maxSize > 0 ? `${Math.max(8, ((t.size || 0) / maxSize) * 100)}%` : '8%';
            const flashKey = t.time + '_' + t.price;
            const isFlash = flashSetRef.current.has(flashKey);

            return (
              <div
                key={i}
                style={{
                  ...s.row,
                  opacity: Math.max(0.25, 1 - i * 0.025),
                  background: isFlash
                    ? (isUp ? 'rgba(14,203,129,0.12)' : 'rgba(246,70,93,0.12)')
                    : 'transparent',
                }}
              >
                {/* Size bar behind row */}
                <div style={{ ...s.rowBar, width: barW, background: barColor }} />

                <span style={{ ...s.cell, flex: 1.1, color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>
                  {formatTime(t.time)}
                </span>
                <span style={{ ...s.cell, flex: 1.2, textAlign: 'right', color, fontWeight: 700, fontFamily: 'Roboto Mono, monospace', fontSize: 11 }}>
                  {t.price?.toFixed(2) ?? '--'}
                  {isUp && <span style={s.arrow}>▲</span>}
                  {isDown && <span style={{ ...s.arrow, color: '#F6465D' }}>▼</span>}
                </span>
                <span style={{ ...s.cell, flex: 0.9, textAlign: 'right', color: 'rgba(255,255,255,0.45)', fontFamily: 'Roboto Mono, monospace', fontSize: 10 }}>
                  {(t.size ?? 0).toFixed(1)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div style={s.footer}>
        <div style={s.footerStat}>
          <span style={s.footerKey}>Trades</span>
          <span style={s.footerVal}>{trades.length}</span>
        </div>
        <div style={s.footerStat}>
          <span style={s.footerKey}>Vol</span>
          <span style={s.footerVal}>{totalVol.toFixed(0)}</span>
        </div>
        <div style={s.footerStat}>
          <span style={s.footerKey}>Buy Vol</span>
          <span style={{ ...s.footerVal, color: '#0ECB81' }}>{buyVol.toFixed(0)}</span>
        </div>
        <div style={s.footerStat}>
          <span style={s.footerKey}>Sell Vol</span>
          <span style={{ ...s.footerVal, color: '#F6465D' }}>{(totalVol - buyVol).toFixed(0)}</span>
        </div>
      </div>
    </div>
  );
}

const s = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    flex: 1,
    minHeight: 0,
    backgroundColor: '#080c14',
    borderTop: '1px solid rgba(90,242,181,0.12)',
    overflow: 'hidden',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '7px 12px 6px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(6,9,16,0.98)',
    flexShrink: 0,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 7 },
  headerTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    backgroundColor: '#5AF2B5',
    boxShadow: '0 0 5px #5AF2B5, 0 0 10px rgba(90,242,181,0.4)',
    display: 'inline-block',
    flexShrink: 0,
  },
  symbolBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: '#5AF2B5',
    backgroundColor: 'rgba(90,242,181,0.08)',
    border: '1px solid rgba(90,242,181,0.2)',
    padding: '1px 7px',
    borderRadius: 3,
    letterSpacing: '0.05em',
  },
  pressureBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '5px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    flexShrink: 0,
    backgroundColor: 'rgba(6,9,16,0.7)',
  },
  pressureLabel: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.04em',
    minWidth: 32,
  },
  pressureTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)',
    display: 'flex',
  },
  pressureFill: { height: '100%', transition: 'width 0.6s ease', borderRadius: '2px 0 0 2px' },
  pressureFillRight: { height: '100%', transition: 'width 0.6s ease', borderRadius: '0 2px 2px 0' },
  colRow: {
    display: 'flex',
    padding: '4px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    flexShrink: 0,
    backgroundColor: 'rgba(10,14,22,0.8)',
  },
  col: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.2)',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    fontWeight: 600,
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  row: {
    position: 'relative',
    display: 'flex',
    padding: '3.5px 12px',
    alignItems: 'center',
    borderBottom: '1px solid rgba(255,255,255,0.025)',
    transition: 'background 0.4s ease',
    overflow: 'hidden',
  },
  rowBar: {
    position: 'absolute',
    right: 0,
    top: 0,
    height: '100%',
    transition: 'width 0.3s ease',
    pointerEvents: 'none',
  },
  cell: { flex: 1, position: 'relative', zIndex: 1 },
  arrow: { marginLeft: 3, fontSize: 8, color: '#0ECB81' },
  empty: {
    padding: '24px 12px',
    fontSize: 11,
    color: 'rgba(255,255,255,0.2)',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
  },
  emptyDot: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    border: '2px solid rgba(90,242,181,0.2)',
    animation: 'pulse 2s infinite',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 12px',
    borderTop: '1px solid rgba(255,255,255,0.05)',
    flexShrink: 0,
    backgroundColor: 'rgba(6,9,16,0.98)',
  },
  footerStat: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 },
  footerKey: { fontSize: 8, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 },
  footerVal: { fontSize: 10, color: 'rgba(255,255,255,0.55)', fontFamily: 'Roboto Mono, monospace', fontWeight: 600 },
};
