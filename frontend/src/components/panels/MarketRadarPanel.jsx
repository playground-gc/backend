import { useEffect, useRef, useState } from 'react';

const TABS = ['Radar', 'Heat', 'Flow'];
const SYMBOLS = ['AAPL_S', 'AMZN_S', 'GOOGL_S', 'MSFT_S', 'TSLA_S'];

export function MarketRadarPanel() {
  const [tab, setTab] = useState('Radar');

  return (
    <div style={s.wrapper}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.headerTitle}>
          {tab === 'Radar' ? 'Market Radar' : tab === 'Heat' ? 'Market Heat' : 'Order Flow'}
        </span>
        <div style={s.tabs}>
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{ ...s.tab, ...(tab === t ? s.tabActive : s.tabInactive) }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={s.body}>
        {tab === 'Radar' && <RadarView />}
        {tab === 'Heat'  && <HeatView />}
        {tab === 'Flow'  && <FlowView />}
      </div>
    </div>
  );
}

/* ── RADAR VIEW ─────────────────────────── */
function RadarView() {
  const canvasRef = useRef(null);
  const animRef   = useRef(null);
  const [buy, setBuy] = useState(64);
  const [spread] = useState('0.42');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cx = 130, cy = 80, maxR = 68;
    let angle = 0, t = 0;
    const dots = Array.from({ length: 18 }, (_, i) => ({
      a: (i / 18) * Math.PI * 2,
      r: 20 + Math.random() * 46,
      side: Math.random() > 0.45 ? 'buy' : 'sell',
      size: 1.5 + Math.random() * 2,
    }));

    function draw() {
      ctx.clearRect(0, 0, 260, 160);
      t += 0.025;
      const bp = Math.max(0.2, Math.min(0.8, 0.5 + 0.22 * Math.sin(t * 0.6) + 0.08 * Math.sin(t * 1.4)));
      setBuy(Math.round(bp * 100));

      [0.35, 0.6, 0.85, 1].forEach(f => {
        ctx.beginPath(); ctx.arc(cx, cy, maxR * f, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(90,242,181,0.12)'; ctx.lineWidth = 0.5; ctx.stroke();
      });
      [[cx - maxR, cy, cx + maxR, cy], [cx, cy - maxR, cx, cy + maxR]].forEach(([x1, y1, x2, y2]) => {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.strokeStyle = 'rgba(90,242,181,0.1)'; ctx.lineWidth = 0.5; ctx.stroke();
      });

      const sweepLen = Math.PI * 0.55;
      for (let i = 20; i >= 0; i--) {
        const a = angle - (i / 20) * sweepLen;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, maxR, a, a + sweepLen / 20); ctx.closePath();
        ctx.fillStyle = `rgba(90,242,181,${0.003 * (20 - i)})`; ctx.fill();
      }

      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
      ctx.strokeStyle = 'rgba(90,242,181,0.8)'; ctx.lineWidth = 1.2; ctx.stroke();

      dots.forEach(d => {
        const px = cx + Math.cos(d.a) * d.r, py = cy + Math.sin(d.a) * d.r;
        const diff = ((d.a - angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        const lit = diff < sweepLen + 0.3;
        ctx.beginPath(); ctx.arc(px, py, d.size, 0, Math.PI * 2);
        ctx.fillStyle = d.side === 'buy'
          ? `rgba(14,203,129,${lit ? 1 : 0.3})`
          : `rgba(246,70,93,${lit ? 1 : 0.3})`;
        ctx.fill();
        if (lit) {
          ctx.beginPath(); ctx.arc(px, py, d.size + 3, 0, Math.PI * 2);
          ctx.strokeStyle = d.side === 'buy' ? 'rgba(14,203,129,0.3)' : 'rgba(246,70,93,0.3)';
          ctx.lineWidth = 1; ctx.stroke();
        }
      });

      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = 'bold 9px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('AAPL_S', cx, cy - 8);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui';
      ctx.fillText('179.02', cx, cy + 6);
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#5AF2B5'; ctx.fill();

      angle = (angle + 0.018) % (Math.PI * 2);
      if (Math.random() < 0.04)
        dots[Math.floor(Math.random() * dots.length)].r = 20 + Math.random() * 46;

      animRef.current = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}>
      <canvas ref={canvasRef} width={260} height={160} style={{ marginTop: 4 }} />
      <div style={s.statsRow}>
        {[
          { label: 'Buy Pressure', val: `${buy}%`,        color: '#0ECB81' },
          { label: 'Spread',       val: `$${spread}`,     color: 'rgba(255,255,255,0.5)' },
          { label: 'Sell Pressure',val: `${100 - buy}%`,  color: '#F6465D' },
        ].map(stat => (
          <div key={stat.label} style={s.statCell}>
            <div style={s.statLabel}>{stat.label}</div>
            <div style={{ ...s.statVal, color: stat.color }}>{stat.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── HEAT VIEW ──────────────────────────── */
function HeatView() {
  const [changes, setChanges] = useState(() =>
    Object.fromEntries(SYMBOLS.map(s => [s, (Math.random() - 0.47) * 5]))
  );

  useEffect(() => {
    const t = setInterval(() => {
      setChanges(prev => {
        const next = { ...prev };
        SYMBOLS.forEach(sym => {
          next[sym] = Math.max(-6, Math.min(6, prev[sym] + (Math.random() - 0.5) * 0.4));
        });
        return next;
      });
    }, 900);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={s.heatGrid}>
      {SYMBOLS.map(sym => {
        const c = changes[sym] || 0;
        const intensity = Math.min(Math.abs(c) / 5, 1);
        const bg = c > 0
          ? `rgba(5,${Math.floor(46 + intensity * 140)},${Math.floor(intensity * 80)},${0.25 + intensity * 0.55})`
          : `rgba(${Math.floor(100 + intensity * 139)},${Math.floor(intensity * 30)},${Math.floor(intensity * 30)},${0.25 + intensity * 0.55})`;
        const border = c > 0
          ? `1px solid rgba(14,203,129,${intensity * 0.4})`
          : `1px solid rgba(246,70,93,${intensity * 0.4})`;
        return (
          <div key={sym} style={{ ...s.heatCell, background: bg, border, transition: 'background 0.5s, border 0.5s' }}>
            <div style={s.heatSymbol}>{sym.replace('_S', '')}</div>
            <div style={{ ...s.heatChange, color: c > 0 ? '#0ECB81' : '#F6465D' }}>
              {c > 0 ? '+' : ''}{c.toFixed(2)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── FLOW VIEW ──────────────────────────── */
function FlowView() {
  const canvasRef = useRef(null);
  const animRef   = useRef(null);
  const barsRef   = useRef(
    Array.from({ length: 38 }, () => ({ buy: Math.random() * 70 + 10, sell: Math.random() * 70 + 10 }))
  );
  const [ratio, setRatio] = useState(50);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const midY = H / 2;

    const pushInterval = setInterval(() => {
      barsRef.current.shift();
      barsRef.current.push({ buy: Math.random() * 70 + 10, sell: Math.random() * 70 + 10 });
    }, 400);

    function draw() {
      ctx.fillStyle = '#060910'; ctx.fillRect(0, 0, W, H);
      ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY);
      ctx.strokeStyle = 'rgba(90,242,181,0.15)'; ctx.lineWidth = 1; ctx.stroke();

      const bars = barsRef.current;
      const barW = W / bars.length;
      let tb = 0, ts = 0;
      bars.forEach((b, i) => {
        const x = i * barW;
        const alpha = 0.3 + (i / bars.length) * 0.7;
        const bH = (b.buy / 100) * (midY - 8);
        const sH = (b.sell / 100) * (midY - 8);
        ctx.fillStyle = `rgba(14,203,129,${alpha})`;
        ctx.fillRect(x + 0.5, midY - bH, barW - 1, bH);
        ctx.fillStyle = `rgba(246,70,93,${alpha})`;
        ctx.fillRect(x + 0.5, midY, barW - 1, sH);
        tb += b.buy; ts += b.sell;
      });
      setRatio(Math.round(tb / (tb + ts) * 100));
      animRef.current = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(animRef.current); clearInterval(pushInterval); };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <canvas ref={canvasRef} width={298} height={170} style={{ flex: 1, width: '100%' }} />
      <div style={s.flowFooter}>
        <div style={s.flowLegend}>
          <span style={{ ...s.dot, background: '#0ECB81' }} /> Buy
        </div>
        <div style={s.flowLegend}>
          <span style={{ ...s.dot, background: '#F6465D' }} /> Sell
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, color: ratio > 50 ? '#0ECB81' : '#F6465D' }}>
          Buy {ratio}% / Sell {100 - ratio}%
        </div>
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────── */
const s = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    flex: 1,
    minHeight: 0,
    backgroundColor: 'rgba(8,8,8,0.94)',
    border: '1px solid rgba(90,242,181,0.1)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 12px',
    borderBottom: '1px solid rgba(90,242,181,0.08)',
    backgroundColor: 'rgba(10,14,26,0.95)',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  tabs: { display: 'flex', gap: 2 },
  tab: {
    fontSize: 10,
    padding: '2px 8px',
    border: 'none',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background 0.15s, color 0.15s',
  },
  tabActive:   { backgroundColor: 'rgba(90,242,181,0.15)', color: '#5AF2B5' },
  tabInactive: { backgroundColor: 'transparent', color: 'rgba(255,255,255,0.3)' },
  body: { flex: 1, overflow: 'hidden', minHeight: 0 },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    width: '100%',
    borderTop: '1px solid rgba(90,242,181,0.08)',
    marginTop: 'auto',
  },
  statCell: { textAlign: 'center', padding: '6px 0' },
  statLabel: { fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 },
  statVal:   { fontSize: 11, fontWeight: 700 },
  heatGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 3,
    padding: 8,
    height: '100%',
    boxSizing: 'border-box',
    alignContent: 'start',
  },
  heatCell: { borderRadius: 4, padding: '6px 4px', textAlign: 'center', cursor: 'pointer' },
  heatSymbol: { fontSize: 9, color: 'rgba(255,255,255,0.45)', fontWeight: 500, marginBottom: 2 },
  heatChange: { fontSize: 11, fontWeight: 700 },
  flowFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '4px 12px',
    borderTop: '1px solid rgba(90,242,181,0.08)',
    flexShrink: 0,
  },
  flowLegend: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'rgba(255,255,255,0.4)' },
  dot: { width: 6, height: 6, borderRadius: '50%', display: 'inline-block' },
};
