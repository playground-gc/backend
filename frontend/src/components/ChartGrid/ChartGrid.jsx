import React, { useState, useRef, useEffect } from 'react';
import TradingChart from '../TradingChart/TradingChart';
import { LayoutGrid, Square, Columns, Rows, Grid2x2, ChevronDown, Maximize, Minimize } from 'lucide-react';

export default function ChartGrid({ mainSymbol, comparisonSymbols }) {
    // layout map: '1x1', '2x1' (side-by-side), '1x2' (above-below), '2x2'
    const [layout, setLayout] = useState('1x1');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const wrapperRef = useRef();

    // Verified backend symbols from your DataManager logs
    const subSymbols = ['GOOGL_S', 'TSLA_S', 'MSFT_S', 'AMZN_S'];

    // Track fullscreen state
    useEffect(() => {
        const onFsChange = () => {
            setIsFullscreen(document.fullscreenElement === wrapperRef.current);
        };
        document.addEventListener('fullscreenchange', onFsChange);
        return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            wrapperRef.current
                ?.requestFullscreen()
                .catch((err) => console.error('Fullscreen error:', err.message));
        } else {
            document.exitFullscreen();
        }
    };

    const renderCharts = () => {
        if (layout === '1x1') {
            return (
                <div style={styles.chartContainer}>
                    <TradingChart
                        key={`1x1-${mainSymbol}`}
                        symbol={mainSymbol}
                        comparisonSymbols={comparisonSymbols}
                    />
                </div>
            );
        }

        if (layout === '2x1') {
            return (
                <div style={styles.flexRow}>
                    <div style={styles.flexItem}>
                        <TradingChart key={`2x1-a-${mainSymbol}`} symbol={mainSymbol} />
                    </div>
                    <div style={styles.flexItem}>
                        <TradingChart key={`2x1-b-${subSymbols[0]}`} symbol={subSymbols[0]} />
                    </div>
                </div>
            );
        }

        if (layout === '1x2') {
            return (
                <div style={styles.flexCol}>
                    <div style={styles.flexItem}>
                        <TradingChart key={`1x2-a-${mainSymbol}`} symbol={mainSymbol} />
                    </div>
                    <div style={styles.flexItem}>
                        <TradingChart key={`1x2-b-${subSymbols[0]}`} symbol={subSymbols[0]} />
                    </div>
                </div>
            );
        }

        if (layout === '2x2') {
            return (
                <div style={styles.flexCol}>
                    <div style={styles.flexRow}>
                        <div style={styles.flexItem}><TradingChart key="2x2-a" symbol={mainSymbol} /></div>
                        <div style={styles.flexItem}><TradingChart key="2x2-b" symbol={subSymbols[0]} /></div>
                    </div>
                    <div style={styles.flexRow}>
                        <div style={styles.flexItem}><TradingChart key="2x2-c" symbol={subSymbols[1]} /></div>
                        <div style={styles.flexItem}><TradingChart key="2x2-d" symbol={subSymbols[2]} /></div>
                    </div>
                </div>
            );
        }
    };

    return (
        <div
            ref={wrapperRef}
            style={{
                ...styles.wrapper,
                ...(isFullscreen ? styles.fullscreenOverride : {}),
            }}
        >
            {/* Multi-Chart Layout Toolbar */}
            <div style={styles.toolbar}>
                {/* Layout picker */}
                <div style={styles.dropdownContainer}>
                    <div
                        style={styles.dropdownToggle}
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                    >
                        <LayoutGrid size={14} style={{ marginRight: 6 }} />
                        <span style={{ fontSize: '11px' }}>Layout</span>
                        <ChevronDown size={14} style={{ marginLeft: 6, transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
                    </div>

                    {dropdownOpen && (
                        <div style={styles.dropdownMenu}>
                            <div style={styles.menuItem} onClick={() => { setLayout('1x1'); setDropdownOpen(false); }}>
                                <Square size={14} style={{ marginRight: 10 }} /> Single Chart
                            </div>
                            <div style={styles.menuItem} onClick={() => { setLayout('2x1'); setDropdownOpen(false); }}>
                                <Columns size={14} style={{ marginRight: 10 }} /> Side-by-Side
                            </div>
                            <div style={styles.menuItem} onClick={() => { setLayout('1x2'); setDropdownOpen(false); }}>
                                <Rows size={14} style={{ marginRight: 10 }} /> Top-Bottom
                            </div>
                            <div style={styles.menuItem} onClick={() => { setLayout('2x2'); setDropdownOpen(false); }}>
                                <Grid2x2 size={14} style={{ marginRight: 10 }} /> Quad View
                            </div>
                        </div>
                    )}
                </div>

                {/* Fullscreen button — expands the WHOLE grid */}
                <div
                    title={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
                    style={styles.fsBtn}
                    onClick={toggleFullscreen}
                >
                    {isFullscreen
                        ? <Minimize size={14} color="var(--color-text-muted)" />
                        : <Maximize size={14} color="var(--color-text-muted)" />
                    }
                </div>
            </div>

            <div style={{ flex: 1, overflow: 'hidden', backgroundColor: 'transparent' }}>
                {renderCharts()}
            </div>
        </div>
    );
}

const styles = {
    wrapper: {
        width: '100%',
        height: '100%',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'transparent',
    },
    // Applied when the grid is fullscreen — overrides parent's fixed 600px height
    fullscreenOverride: {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 99999,
        backgroundColor: '#0a0a0a',
    },
    toolbar: {
        position: 'absolute',
        top: '8px',
        right: '8px',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
    },
    dropdownContainer: {
        position: 'relative',
    },
    chartContainer: {
        width: '100%',
        height: '100%'
    },
    flexRow: {
        display: 'flex',
        flexDirection: 'row',
        width: '100%',
        height: '100%',
        gap: '2px',
        backgroundColor: 'rgba(255, 255, 255, 0.05)'
    },
    flexCol: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        gap: '2px',
        backgroundColor: 'rgba(255, 255, 255, 0.05)'
    },
    flexItem: {
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        backgroundColor: 'transparent'
    },
    dropdownToggle: {
        display: 'flex',
        alignItems: 'center',
        color: 'var(--color-text-main)',
        cursor: 'pointer',
        padding: '4px 10px',
        borderRadius: '0px',
        backgroundColor: 'rgba(10, 10, 10, 0.9)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(4px)'
    },
    dropdownMenu: {
        position: 'absolute',
        top: '32px',
        right: '0',
        backgroundColor: 'rgba(10, 10, 10, 0.95)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '0px',
        padding: '6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        boxShadow: '0 8px 16px rgba(0,0,0,0.4)',
        width: '140px'
    },
    menuItem: {
        display: 'flex',
        alignItems: 'center',
        padding: '8px 10px',
        cursor: 'pointer',
        color: 'var(--color-text-main)',
        borderRadius: '0px',
        fontSize: '11px',
        transition: 'background 0.2s',
    },
    fsBtn: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4px 8px',
        cursor: 'pointer',
        backgroundColor: 'rgba(10, 10, 10, 0.9)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(4px)',
    },
};