import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, RotateCcw, Check, Hash, Settings2 } from 'lucide-react';

// ─── Indicator full names ────────────────────────────────────────────────────
const INDICATOR_NAMES = {
    MA:       'Moving Average',
    EMA:      'Exponential Moving Average',
    WMA:      'Weighted Moving Average',
    BOLL:     'Bollinger Bands',
    VWAP:     'Volume Weighted Average Price',
    SAR:      'Parabolic SAR',
    SUPER:    'Supertrend',
    TRIX:     'Triple Exponential Average',
    VOL:      'Volume',
    MACD:     'Moving Average Convergence Divergence',
    RSI:      'Relative Strength Index',
    MFI:      'Money Flow Index',
    KDJ:      'Stochastic Oscillator (KDJ)',
    OBV:      'On Balance Volume',
    CCI:      'Commodity Channel Index',
    StochRSI: 'Stochastic RSI',
    WR:       'Williams Percent Range',
};

const LINE_COLORS = ['#5AF2B5', '#E040FB', '#AB47BC', '#F6465D', '#0ECB81', '#FF9800'];

function makeMultiLine() {
    return {
        lines: [
            { enabled: true,  period: 7,  source: 'close', lineWidth: 1, color: LINE_COLORS[0] },
            { enabled: true,  period: 25, source: 'close', lineWidth: 1, color: LINE_COLORS[1] },
            { enabled: true,  period: 99, source: 'close', lineWidth: 1, color: LINE_COLORS[2] },
            { enabled: false, period: 0,  source: 'close', lineWidth: 1, color: LINE_COLORS[3] },
            { enabled: false, period: 0,  source: 'close', lineWidth: 1, color: LINE_COLORS[4] },
            { enabled: false, period: 0,  source: 'close', lineWidth: 1, color: LINE_COLORS[5] },
        ]
    };
}

const MAIN_INDICATORS = [
    { key: 'MA',    label: 'MA',    defaultParams: makeMultiLine() },
    { key: 'EMA',   label: 'EMA',   defaultParams: makeMultiLine() },
    { key: 'WMA',   label: 'WMA',   defaultParams: makeMultiLine() },
    { key: 'BOLL',  label: 'BOLL',  defaultParams: { period: 20, stdDev: 2, upperColor: '#5AF2B5', middleColor: '#5AF2B5', lowerColor: '#5AF2B5' } },
    { key: 'VWAP',  label: 'VWAP',  defaultParams: { color: '#00BCD4' } },
    { key: 'SAR',   label: 'SAR',   defaultParams: { step: 0.02, max: 0.2 } },
    { key: 'SUPER', label: 'SUPER', defaultParams: { period: 10, multiplier: 3 } },
    { key: 'TRIX',  label: 'TRIX',  defaultParams: { period: 14, color: '#00E5FF' } },
];

const SUB_INDICATORS = [
    { key: 'VOL',      label: 'VOL',      defaultParams: { maVolPeriod1: 7, maVolPeriod2: 14, maColor1: '#00BCD4', maColor2: '#E040FB' } },
    {
        key: 'MACD', label: 'MACD',
        defaultParams: {
            fast: 12, slow: 26, signal: 9,
            dea:      { visible: true,  color: '#E040FB' },
            dif:      { visible: true,  color: '#AB47BC' },
            macdBar:  true,
            longGrow:  { color: '#0ECB81' },
            longFall:  { color: '#0ECB81' },
            shortGrow: { color: '#F6465D' },
            shortFall: { color: '#F6465D' },
        }
    },
    { key: 'RSI',      label: 'RSI',      defaultParams: { period: 14, color: '#E040FB' } },
    { key: 'MFI',      label: 'MFI',      defaultParams: { period: 14, color: '#00BCD4' } },
    { key: 'KDJ',      label: 'KDJ',      defaultParams: { period: 9,  kColor: '#5AF2B5', dColor: '#E040FB', jColor: '#0ECB81' } },
    { key: 'OBV',      label: 'OBV',      defaultParams: { color: '#5AF2B5' } },
    { key: 'CCI',      label: 'CCI',      defaultParams: { period: 20, color: '#FF9800' } },
    { key: 'StochRSI', label: 'StochRSI', defaultParams: { rsiPeriod: 14, stochPeriod: 14, kColor: '#5AF2B5', dColor: '#E040FB' } },
    { key: 'WR',       label: 'WR',       defaultParams: { period: 14, color: '#5AF2B5' } },
];

// ─── Shared sub-components ───────────────────────────────────────────────────

function ColorSwatch({ value, onChange }) {
    return (
        <label style={p.swatch} title="Pick colour">
            <div style={{ ...p.swatchInner, background: value }} />
            <input type="color" value={value} onChange={e => onChange(e.target.value)} style={{ display: 'none' }} />
        </label>
    );
}

function NumInput({ value, onChange, min = 1, step = 1 }) {
    return (
        <input
            type="number"
            value={value}
            min={min}
            step={step}
            onChange={e => onChange(+e.target.value || 0)}
            style={p.numInput}
        />
    );
}

function SrcSelect({ value, onChange }) {
    return (
        <div style={{position: 'relative', display: 'flex', alignItems: 'center', width: '100%'}}>
            <Settings2 size={12} style={{position: 'absolute', left: 8, color: 'rgba(255,255,255,0.4)', pointerEvents: 'none'}} />
            <select value={value} onChange={e => onChange(e.target.value)} style={{...p.select, paddingLeft: 26, background: 'rgba(0, 0, 0, 0.4)'}}>
                {['close', 'open', 'high', 'low'].map(s => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
            </select>
        </div>
    );
}

// Custom line-width picker — shows visual thick lines, no text
function LineWidthSelect({ value, onChange }) {
    const [open, setOpen] = React.useState(false);
    return (
        <div style={{ position: 'relative', userSelect: 'none' }}>
            {/* Trigger */}
            <div
                style={p.lwWrapper}
                onClick={() => setOpen(o => !o)}
            >
                <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                    <div style={{ height: value || 1, background: '#FFFFFF', borderRadius: 0, width: '100%' }} />
                </div>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 10, lineHeight: 1 }}>▾</span>
            </div>

            {/* Dropdown list */}
            {open && (
                <div style={p.lwDropdown} onMouseLeave={() => setOpen(false)}>
                    {[1, 2, 3, 4].map(w => (
                        <div
                            key={w}
                            style={{
                                ...p.lwOption,
                                background: w === (value || 1) ? 'rgba(255, 255, 255, 0.05)' : 'transparent'
                            }}
                            onClick={() => { onChange(w); setOpen(false); }}
                        >
                            <div style={{ height: w, background: '#FFFFFF', borderRadius: 0, width: '100%' }} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function Row({ label, children }) {
    return (
        <div style={p.row}>
            <span style={p.rowLabel}>{label}</span>
            <div style={p.rowControls}>{children}</div>
        </div>
    );
}


function CustomCheckbox({ checked, onChange }) {
    return (
        <div 
            onClick={(e) => { e.stopPropagation(); onChange({ target: { checked: !checked } }); }}
            style={{
                width: 18, height: 18, borderRadius: '50%',
                border: `2px solid ${checked ? '#5AF2B5' : 'rgba(255,255,255,0.3)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: 'all 0.2s',
                backgroundColor: checked ? 'rgba(90, 242, 181, 0.15)' : 'rgba(0,0,0,0.2)',
                flexShrink: 0
            }}
        >
            <div style={{
                width: 8, height: 8, borderRadius: '50%', 
                backgroundColor: '#5AF2B5',
                transform: checked ? 'scale(1)' : 'scale(0)',
                transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
            }} />
        </div>
    );
}

function CheckRow({ label, checked, onCheck, children }) {
    return (
        <div style={p.checkRow}>
            <label style={p.checkLabel} onClick={e => e.stopPropagation()}>
                <CustomCheckbox checked={checked} onChange={onCheck} />
                <span style={p.checkText}>{label}</span>
            </label>
            <div style={p.rowControls}>{children}</div>
        </div>
    );
}

// ─── Multi-line editor (MA / EMA / WMA) ─────────────────────────────────────
// Grid columns: [checkbox 20px] [label 52px] [period 1fr] [source 1fr] [width 90px] [color 32px]
const ML_GRID = '20px 52px 1fr 1fr 90px 32px';

function MultiLineEditor({ lineLabel, params, onChange }) {
    const lines = params.lines || [];
    const setLine = (i, field, val) => {
        const next = lines.map((l, li) => li === i ? { ...l, [field]: val } : l);
        onChange({ ...params, lines: next });
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* Header row — same grid as data rows */}
            <div style={{ display: 'grid', gridTemplateColumns: ML_GRID, alignItems: 'center', gap: '8px', padding: '4px 0 8px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <span />
                <span style={p.mlColLabel}>{lineLabel}</span>
                <span style={p.mlColLabel}>Period</span>
                <span style={p.mlColLabel}>Source</span>
                <span style={p.mlColLabel}>Width</span>
                <span style={p.mlColLabel}>Color</span>
            </div>
            {lines.map((line, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: ML_GRID, alignItems: 'center', gap: '8px', padding: '8px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <CustomCheckbox checked={line.enabled} onChange={e => setLine(i, 'enabled', e.target.checked)} />
                    <span style={p.mlLineName}>{lineLabel}{i + 1}</span>
                    <NumInput value={line.period} onChange={v => setLine(i, 'period', v)} />
                    <SrcSelect value={line.source} onChange={v => setLine(i, 'source', v)} />
                    <LineWidthSelect value={line.lineWidth || 1} onChange={v => setLine(i, 'lineWidth', v)} />
                    <ColorSwatch value={line.color} onChange={v => setLine(i, 'color', v)} />
                </div>
            ))}
        </div>
    );
}

// ─── MACD editor ─────────────────────────────────────────────────────────────

function MACDEditor({ params, onChange }) {
    const set = (key, val) => onChange({ ...params, [key]: val });
    const setNested = (key, field, val) => onChange({ ...params, [key]: { ...params[key], [field]: val } });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <Row label="Fast Length">
                <NumInput value={params.fast} onChange={v => set('fast', v)} />
            </Row>
            <Row label="Slow Length">
                <NumInput value={params.slow} onChange={v => set('slow', v)} />
            </Row>
            <Row label="Signal Length">
                <NumInput value={params.signal} onChange={v => set('signal', v)} />
            </Row>

            <div style={p.divider} />

            <CheckRow
                label="DEA"
                checked={params.dea?.visible ?? true}
                onCheck={e => setNested('dea', 'visible', e.target.checked)}
            >
                <ColorSwatch value={params.dea?.color ?? '#E040FB'} onChange={v => setNested('dea', 'color', v)} />
            </CheckRow>

            <CheckRow
                label="DIF"
                checked={params.dif?.visible ?? true}
                onCheck={e => setNested('dif', 'visible', e.target.checked)}
            >
                <ColorSwatch value={params.dif?.color ?? '#AB47BC'} onChange={v => setNested('dif', 'color', v)} />
            </CheckRow>

            <CheckRow
                label="MACD"
                checked={params.macdBar ?? true}
                onCheck={e => set('macdBar', e.target.checked)}
            />

            <div style={p.divider} />

            <Row label="Long (Grow)">
                <ColorSwatch value={params.longGrow?.color ?? '#0ECB81'} onChange={v => setNested('longGrow', 'color', v)} />
            </Row>
            <Row label="Long (Fall)">
                <ColorSwatch value={params.longFall?.color ?? '#0ECB81'} onChange={v => setNested('longFall', 'color', v)} />
            </Row>
            <Row label="Short (Grow)">
                <ColorSwatch value={params.shortGrow?.color ?? '#F6465D'} onChange={v => setNested('shortGrow', 'color', v)} />
            </Row>
            <Row label="Short (Fall)">
                <ColorSwatch value={params.shortFall?.color ?? '#F6465D'} onChange={v => setNested('shortFall', 'color', v)} />
            </Row>
        </div>
    );
}

// ─── Generic param editor ─────────────────────────────────────────────────────

function ParamEditor({ indicatorKey, params, onChange }) {
    const set = (key, val) => onChange({ ...params, [key]: val });
    const setNested = (key, field, val) => onChange({ ...params, [key]: { ...params[key], [field]: val } });

    if (indicatorKey === 'MA')  return <MultiLineEditor lineLabel="MA"  params={params} onChange={onChange} />;
    if (indicatorKey === 'EMA') return <MultiLineEditor lineLabel="EMA" params={params} onChange={onChange} />;
    if (indicatorKey === 'WMA') return <MultiLineEditor lineLabel="WMA" params={params} onChange={onChange} />;
    if (indicatorKey === 'MACD') return <MACDEditor params={params} onChange={onChange} />;

    switch (indicatorKey) {
        case 'BOLL':
            return (<>
                <Row label="Period"><NumInput value={params.period} onChange={v => set('period', v)} /></Row>
                <Row label="Std Dev"><NumInput value={params.stdDev} onChange={v => set('stdDev', v)} /></Row>
                <Row label="Upper Band"><ColorSwatch value={params.upperColor}  onChange={v => set('upperColor', v)} /></Row>
                <Row label="Middle Band"><ColorSwatch value={params.middleColor} onChange={v => set('middleColor', v)} /></Row>
                <Row label="Lower Band"><ColorSwatch value={params.lowerColor}  onChange={v => set('lowerColor', v)} /></Row>
            </>);
        case 'VWAP':
            return <Row label="Color"><ColorSwatch value={params.color} onChange={v => set('color', v)} /></Row>;
        case 'SAR':
            return (<>
                <Row label="Step"><NumInput value={params.step} onChange={v => set('step', v)} min={0.001} step={0.01} /></Row>
                <Row label="Max Step"><NumInput value={params.max}  onChange={v => set('max', v)}  min={0.01}  step={0.01} /></Row>
            </>);
        case 'SUPER':
            return (<>
                <Row label="Period"><NumInput value={params.period} onChange={v => set('period', v)} /></Row>
                <Row label="Multiplier"><NumInput value={params.multiplier} onChange={v => set('multiplier', v)} min={0.1} step={0.1} /></Row>
            </>);
        case 'TRIX':
            return (<>
                <Row label="Period"><NumInput value={params.period} onChange={v => set('period', v)} /></Row>
                <Row label="Color"><ColorSwatch value={params.color} onChange={v => set('color', v)} /></Row>
            </>);
        case 'VOL':
            return (<>
                <Row label="MA1 Period"><NumInput value={params.maVolPeriod1} onChange={v => set('maVolPeriod1', v)} /><ColorSwatch value={params.maColor1} onChange={v => set('maColor1', v)} /></Row>
                <Row label="MA2 Period"><NumInput value={params.maVolPeriod2} onChange={v => set('maVolPeriod2', v)} /><ColorSwatch value={params.maColor2} onChange={v => set('maColor2', v)} /></Row>
            </>);
        case 'RSI':
        case 'MFI':
        case 'WR':
            return (<>
                <Row label="Period"><NumInput value={params.period} onChange={v => set('period', v)} /></Row>
                <Row label="Color"><ColorSwatch value={params.color} onChange={v => set('color', v)} /></Row>
            </>);
        case 'CCI':
            return (<>
                <Row label="Period"><NumInput value={params.period} onChange={v => set('period', v)} /></Row>
                <Row label="Color"><ColorSwatch value={params.color} onChange={v => set('color', v)} /></Row>
            </>);
        case 'OBV':
            return <Row label="Color"><ColorSwatch value={params.color} onChange={v => set('color', v)} /></Row>;
        case 'KDJ':
            return (<>
                <Row label="Period"><NumInput value={params.period} onChange={v => set('period', v)} /></Row>
                <Row label="K Color"><ColorSwatch value={params.kColor} onChange={v => set('kColor', v)} /></Row>
                <Row label="D Color"><ColorSwatch value={params.dColor} onChange={v => set('dColor', v)} /></Row>
                <Row label="J Color"><ColorSwatch value={params.jColor} onChange={v => set('jColor', v)} /></Row>
            </>);
        case 'StochRSI':
            return (<>
                <Row label="RSI Period"><NumInput value={params.rsiPeriod}   onChange={v => set('rsiPeriod', v)} /></Row>
                <Row label="Stoch Period"><NumInput value={params.stochPeriod} onChange={v => set('stochPeriod', v)} /></Row>
                <Row label="K Color"><ColorSwatch value={params.kColor} onChange={v => set('kColor', v)} /></Row>
                <Row label="D Color"><ColorSwatch value={params.dColor} onChange={v => set('dColor', v)} /></Row>
            </>);
        default:
            return <p style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No parameters available.</p>;
    }
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

function buildDefaults() {
    const all = [...MAIN_INDICATORS, ...SUB_INDICATORS];
    const defaults = Object.fromEntries(
        all.map(ind => [ind.key, { enabled: false, params: JSON.parse(JSON.stringify(ind.defaultParams)) }])
    );
    // MA is always on by default
    defaults.MA.enabled = true;
    return defaults;
}

export default function IndicatorModal({ initialConfig = {}, onSave, onClose, onLiveChange }) {
    const [tab, setTab] = useState('main');
    const [selected, setSelected] = useState('MA'); // Default to MA

    // Merge passed config with full defaults
    const merged = { ...buildDefaults(), ...initialConfig };
    // Deep-merge params to preserve user's nested state
    Object.keys(initialConfig).forEach(k => {
        if (merged[k]) {
            merged[k] = {
                ...merged[k],
                ...initialConfig[k],
                params: { ...(buildDefaults()[k]?.params ?? {}), ...initialConfig[k]?.params }
            };
        }
    });
    const [config, setConfig] = useState(merged);

    const list = tab === 'main' ? MAIN_INDICATORS : SUB_INDICATORS;

    const updateConfig = (newConfig) => {
        setConfig(newConfig);
        if (onLiveChange) onLiveChange(newConfig);
    };

    const toggleEnabled = (key) => {
        const newConfig = { ...config, [key]: { ...config[key], enabled: !config[key].enabled } };
        updateConfig(newConfig);
    };

    const setParams = (key, params) => {
        const newConfig = { ...config, [key]: { ...config[key], params } };
        updateConfig(newConfig);
    };

    const handleReset = () => {
        const fresh = buildDefaults();
        updateConfig(fresh);
    };

    const handleSave = () => {
        onSave(config);
        onClose();
    };

    // Auto-select first item on tab switch
    const switchTab = (t) => {
        setTab(t);
        setSelected(t === 'main' ? 'MA' : 'VOL');
    };

    const activeSelected = selected && list.find(i => i.key === selected) ? selected : list[0]?.key;

    const modalContent = (
        <div style={m.overlay} onClick={onClose}>
            <div style={m.modal} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={m.header}>
                    <div style={m.tabs}>
                        {[['main', 'Main Indicator'], ['sub', 'Sub Indicator']].map(([t, label]) => (
                            <button
                                key={t}
                                style={{ ...m.tab, ...(tab === t ? m.tabActive : {}) }}
                                onClick={() => switchTab(t)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <button style={m.closeBtn} onClick={onClose} title="Close"><X size={16} /></button>
                </div>

                {/* Body */}
                <div style={m.body}>
                    {/* Sidebar */}
                    <div style={m.sidebar}>
                        <div style={m.sideTitle}>{tab === 'main' ? 'Main' : 'Sub'}</div>
                        {list.map(ind => (
                            <div
                                key={ind.key}
                                style={{ ...m.sideItem, ...(activeSelected === ind.key ? m.sideItemActive : {}) }}
                                onClick={() => setSelected(ind.key)}
                            >
                                <label
                                    style={m.checkLabel}
                                    onClick={e => { e.stopPropagation(); }}
                                >
                                    <CustomCheckbox checked={config[ind.key]?.enabled ?? false} onChange={() => toggleEnabled(ind.key)} />
                                </label>
                                <span style={m.sideLabel}>{ind.label}</span>
                                <span style={m.chevron}>›</span>
                            </div>
                        ))}
                    </div>

                    {/* Right pane */}
                    <div style={m.rightPane}>
                        {activeSelected && (
                            <>
                                <div style={m.rightTitle}>
                                    {activeSelected} — {INDICATOR_NAMES[activeSelected] ?? activeSelected}
                                </div>
                                <div style={m.params}>
                                    <ParamEditor
                                        indicatorKey={activeSelected}
                                        params={config[activeSelected]?.params ?? {}}
                                        onChange={(p) => setParams(activeSelected, p)}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div style={m.footer}>
                    <button style={m.btnReset} onClick={handleReset}> <RotateCcw size={14} style={{marginRight: 6, display: 'inline-block', verticalAlign: 'middle'}} /> Reset</button>
                    <button style={m.btnSave} onClick={handleSave}> <Check size={14} style={{marginRight: 6, display: 'inline-block', verticalAlign: 'middle'}} /> Save</button>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const m = {
    overlay: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    },
    modal: {
        background: 'rgba(10, 10, 10, 0.6)', backdropFilter: 'blur(12px)', border: '1px solid rgba(90, 242, 181, 0.4)', borderRadius: "0px",
        width: '640px', maxWidth: '96vw', maxHeight: '82vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 0 40px rgba(90, 242, 181, 0.15), inset 0 0 20px rgba(90, 242, 181, 0.05)'
    },
    header: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)', padding: '0 18px', height: '48px', flexShrink: 0
    },
    tabs: { display: 'flex', gap: '24px', height: '100%', alignItems: 'stretch' },
    tab: {
        background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px',
        fontWeight: '600', fontFamily: "'Inter', 'DM Sans', 'Segoe UI', system-ui, sans-serif",
        color: 'var(--color-text-muted)',
        padding: '0 2px', borderBottom: '2px solid transparent', transition: 'color 0.2s',
        letterSpacing: '-0.01em'
    },
    tabActive: { color: '#FFFFFF', borderBottomColor: '#5AF2B5', fontWeight: '700' },
    closeBtn: {
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--color-text-muted)', padding: '4px', borderRadius: "0px",
        display: 'flex', alignItems: 'center'
    },
    body: { display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 },
    sidebar: {
        width: '148px', flexShrink: 0, borderRight: '1px solid rgba(255, 255, 255, 0.05)',
        overflowY: 'auto', padding: '6px 0'
    },
    sideTitle: {
        fontSize: '11px', color: 'var(--color-text-muted)', padding: '6px 14px 8px',
        textTransform: 'uppercase', letterSpacing: '0.06em'
    },
    sideItem: {
        display: 'flex', alignItems: 'center', padding: '8px 14px',
        cursor: 'pointer', transition: 'background 0.15s', gap: '8px'
    },
    sideItemActive: { background: 'rgba(255, 255, 255, 0.05)' },
    checkLabel: { display: 'flex', alignItems: 'center', cursor: 'pointer' },
    checkbox: { accentColor: '#5AF2B5', cursor: 'pointer', width: 14, height: 14 },
    sideLabel: { flex: 1, color: 'var(--color-text-main)', fontSize: '13px' },
    chevron: { color: 'var(--color-text-muted)', fontSize: '15px' },
    rightPane: { flex: 1, overflowY: 'auto', padding: '18px 20px' },
    rightTitle: {
        fontSize: '14px', fontWeight: '600', color: 'var(--color-text-main)',
        marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
    },
    params: { display: 'flex', flexDirection: 'column' },
    footer: {
        display: 'flex', justifyContent: 'flex-end', gap: '10px',
        padding: '12px 18px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', flexShrink: 0
    },
    btnReset: {
        background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', color: 'var(--color-text-main)',
        padding: '8px 22px', borderRadius: "0px", cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px'
    },
    btnSave: {
        background: '#5AF2B5', border: 'none', color: '#050505', fontWeight: '700',
        padding: '8px 26px', borderRadius: "0px", cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px'
    },
};

const p = {
    row: {
        display: 'flex', alignItems: 'center', padding: '9px 0',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)', gap: '12px', minHeight: 40
    },
    rowLabel: { flex: 1, color: 'var(--color-text-muted)', fontSize: '12px' },
    rowControls: { display: 'flex', gap: '8px', alignItems: 'center' },
    checkRow: {
        display: 'flex', alignItems: 'center', padding: '9px 0',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)', gap: '12px', minHeight: 40
    },
    checkLabel: { display: 'flex', alignItems: 'center', gap: '8px', flex: 1, cursor: 'pointer' },
    checkText: { color: 'var(--color-text-main)', fontSize: '13px' },
    checkbox: { accentColor: '#5AF2B5', cursor: 'pointer', width: 14, height: 14 },
    numInput: {
        width: '100%', background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(255, 255, 255, 0.1)',
        transition: 'border 0.2s, box-shadow 0.2s',
        color: 'var(--color-text-main)', borderRadius: "0px", padding: '5px 7px',
        fontFamily: 'inherit', fontSize: '13px', outline: 'none', boxSizing: 'border-box'
    },
    select: { appearance: 'none', backgroundImage: 'url("data:image/svg+xml;utf8,<svg fill=%27white%27 height=%2724%27 viewBox=%270 0 24 24%27 width=%2724%27 xmlns=%27http://www.w3.org/2000/svg%27><path d=%27M7 10l5 5 5-5z%27/></svg>")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center', backgroundSize: '14px', 
        width: '100%', background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(255, 255, 255, 0.1)',
        color: 'var(--color-text-main)', borderRadius: "0px", padding: '5px 20px 5px 6px',
        fontFamily: 'inherit', fontSize: '13px', outline: 'none', cursor: 'pointer', boxSizing: 'border-box'
    },
    swatch: { cursor: 'pointer', display: 'flex', justifyContent: 'center' },
    swatchInner: { width: '26px', height: '26px', borderRadius: "0px", border: '1px solid rgba(255, 255, 255, 0.1)' },
    divider: { height: '1px', background: 'rgba(255, 255, 255, 0.05)', margin: '4px 0' },
    // Line-width picker (custom dropdown)
    lwWrapper: {
        display: 'flex', alignItems: 'center', background: 'rgba(0, 0, 0, 0.4)',
        border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: "0px", padding: '0 8px',
        gap: '6px', height: '32px', boxSizing: 'border-box', cursor: 'pointer',
    },
    lwDropdown: {
        position: 'absolute', top: '36px', left: 0, right: 0, zIndex: 200,
        background: 'rgba(10, 10, 10, 0.95)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: "0px", backdropFilter: 'blur(8px)',
        padding: '4px', display: 'flex', flexDirection: 'column', gap: '2px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
    },
    lwOption: {
        display: 'flex', alignItems: 'center', padding: '6px 8px',
        borderRadius: "0px", cursor: 'pointer',
    },
    // Multi-line table styles
    mlColLabel: {
        fontSize: '11px', color: 'var(--color-text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.05em'
    },
    mlLineName: { fontSize: '13px', color: 'var(--color-text-main)' },
    mlHeader: {}, mlRow: {},
};
