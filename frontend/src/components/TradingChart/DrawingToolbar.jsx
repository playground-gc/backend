import React, { useState, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';

// ── Tiny SVG wrapper ───────────────────────────────────────────────────────────
const Svg = ({ children, size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
    </svg>
);

// ── All sub-tool icons ─────────────────────────────────────────────────────────
const Icons = {
    // Pointer group
    Crosshair: () => <Svg><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="3"/></Svg>,
    Arrow:     () => <Svg><path d="M5 3l14 9-7 1-4 7z"/></Svg>,

    // Line group
    TrendLine: () => <Svg><line x1="4" y1="20" x2="20" y2="4"/><circle cx="4" cy="20" r="2" fill="currentColor" stroke="none"/><circle cx="20" cy="4" r="2" fill="currentColor" stroke="none"/></Svg>,
    Ray:       () => <Svg><line x1="5" y1="19" x2="19" y2="5"/><polyline points="13 5 19 5 19 11"/></Svg>,

    // Shape group
    Rectangle: () => <Svg><rect x="3" y="6" width="18" height="12" rx="1"/></Svg>,
    Ellipse:   () => <Svg><ellipse cx="12" cy="12" rx="9" ry="6"/></Svg>,

    // Draw group
    Brush:       () => <Svg><path d="M20.2 4.8a2.5 2.5 0 0 0-3.5 0L10 11.5l3.5 3.5 6.7-6.7a2.5 2.5 0 0 0 0-3.5z"/><path d="M10 11.5c-3 0-5 3.5-6.5 8.5 5-.5 8-3.5 10-5Z"/></Svg>,
    Highlighter: () => <Svg><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></Svg>,

    // Arrows group
    DrawArrow: () => <Svg><line x1="6" y1="18" x2="18" y2="6"/><polyline points="12 6 18 6 18 12"/></Svg>,

    // Text / annotation
    Text:      () => <Svg><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></Svg>,
    CrossLine: () => <Svg><line x1="12" y1="2" x2="12" y2="22" strokeDasharray="4 3"/><line x1="2" y1="12" x2="22" y2="12" strokeDasharray="4 3"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></Svg>,

    // Price tools
    HorizLine: () => <Svg><line x1="2" y1="12" x2="22" y2="12" strokeDasharray="4 3"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></Svg>,
    VertLine:  () => <Svg><line x1="12" y1="2" x2="12" y2="22" strokeDasharray="4 3"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></Svg>,

    // Channel
    Channel:   () => <Svg><line x1="4" y1="18" x2="20" y2="8"/><line x1="4" y1="13" x2="20" y2="3" strokeDasharray="3 2" opacity="0.6"/></Svg>,
    Regression:() => <Svg><line x1="4" y1="20" x2="20" y2="4"/><line x1="4" y1="16" x2="20" y2="8" strokeDasharray="3 2" opacity="0.4"/><line x1="4" y1="12" x2="20" y2="12" strokeDasharray="3 2" opacity="0.4"/></Svg>,

    // Measure
    Ruler:     () => <Svg><path d="M21.3 15.3l-7.6-7.6a2 2 0 0 0-2.8 0l-8.2 8.2a2 2 0 0 0 0 2.8l7.6 7.6a2 2 0 0 0 2.8 0l8.2-8.2a2 2 0 0 0 0-2.8z"/><path d="M14.5 10.5l3 3"/><path d="M10.5 14.5l3 3"/><path d="M6.5 18.5l3 3"/></Svg>,
    PriceDiff: () => <Svg><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="18" x2="20" y2="18"/><line x1="12" y1="6" x2="12" y2="18" strokeDasharray="3 3"/><polyline points="8 10 12 6 16 10"/><polyline points="8 14 12 18 16 14"/></Svg>,

    // Fibonacci
    Fib:       () => <Svg><line x1="3" y1="5" x2="21" y2="5" opacity="0.9"/><line x1="3" y1="10" x2="21" y2="10" opacity="0.7"/><line x1="3" y1="14" x2="21" y2="14" opacity="0.5"/><line x1="3" y1="19" x2="21" y2="19" opacity="0.3"/><line x1="4" y1="5" x2="20" y2="19" strokeDasharray="3 2"/></Svg>,
    FibFan:    () => <Svg><line x1="4" y1="20" x2="20" y2="4"/><line x1="4" y1="20" x2="20" y2="9" opacity="0.6"/><line x1="4" y1="20" x2="20" y2="14" opacity="0.4"/></Svg>,

    // Actions
    Lock:      () => <Svg><path d="M8 10V7a4 4 0 0 1 8 0v3h-2V7a2 2 0 0 0-4 0v3H8zM17 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z" fill="currentColor" stroke="none"/></Svg>,
    Unlock:    () => <Svg><path d="M14 10V7a4 4 0 0 1 8 0v4h-2V7a2 2 0 0 0-4 0v3h-2zM17 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z" fill="currentColor" stroke="none"/></Svg>,
    Hide:      () => <Svg><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></Svg>,
    Show:      () => <Svg><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></Svg>,
    Delete:    () => <Svg><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4h6v2"/></Svg>,
    Magnet:    () => <Svg><path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/></Svg>,
};

// ── Tool group definitions ─────────────────────────────────────────────────────
// Each group has a default sub-tool + list of sub-tools
// id must match keys in useDrawingTools
const TOOL_GROUPS = [
    {
        id: 'pointer-group',
        subTools: [
            { id: 'pointer',  label: 'Crosshair', Icon: Icons.Crosshair },
            { id: 'cursor-arrow', label: 'Arrow',     Icon: Icons.Arrow },
        ],
    },
    {
        id: 'line-group',
        subTools: [
            { id: 'trendline', label: 'Trend Line',       Icon: Icons.TrendLine },
            { id: 'ray',       label: 'Ray',              Icon: Icons.Ray },
            { id: 'hline',     label: 'Horizontal Line',  Icon: Icons.HorizLine },
            { id: 'vline',     label: 'Vertical Line',    Icon: Icons.VertLine },
            { id: 'crossline', label: 'Cross Line',       Icon: Icons.CrossLine },
            { id: 'channel',   label: 'Parallel Lines',   Icon: Icons.Channel },
        ],
    },
    {
        id: 'shape-group',
        subTools: [
            { id: 'rectangle', label: 'Rectangle',  Icon: Icons.Rectangle },
            { id: 'ellipse',   label: 'Ellipse',    Icon: Icons.Ellipse },
        ],
    },
    {
        id: 'draw-group',
        subTools: [
            { id: 'brush',       label: 'Brush',       Icon: Icons.Brush },
            { id: 'highlighter', label: 'Highlighter', Icon: Icons.Highlighter },
        ],
    },
    {
        id: 'arrows-group',
        subTools: [
            { id: 'arrow', label: 'Arrow', Icon: Icons.DrawArrow },
        ],
    },
    {
        id: 'text-group',
        subTools: [
            { id: 'text', label: 'Text',      Icon: Icons.Text },
        ],
    },

    {
        id: 'ruler-group',
        subTools: [
            { id: 'ruler',     label: 'Ruler',            Icon: Icons.Ruler },
        ],
    },
    {
        id: 'fib-group',
        subTools: [
            { id: 'fib',    label: 'Fib Retracement', Icon: Icons.Fib },
            { id: 'fibfan', label: 'Fib Fan',         Icon: Icons.FibFan },
        ],
    },
];

// ── Component ──────────────────────────────────────────────────────────────────
export default function DrawingToolbar({ activeTool, onToolChange, onAction, drawings = [], selectedId }) {
    // Track which sub-tool is "face" of each group
    const [groupFace, setGroupFace] = useState(() => {
        const m = {};
        TOOL_GROUPS.forEach(g => { m[g.id] = g.subTools[0]; });
        return m;
    });

    // Which group's flyout is open
    const [openGroup, setOpenGroup] = useState(null);
    const [flyoutPos, setFlyoutPos] = useState({ x: 0, y: 0 });
    const [magnetOn, setMagnetOn]   = useState(false);

    const isHidden = (types) => {
        const relevant = types ? drawings.filter(d => types.includes(d.type)) : drawings;
        if (relevant.length === 0) return false;
        return relevant.every(d => d.hidden);
    };

    const allHidden = isHidden(null);
    const linesHidden = isHidden(['trendline','ray','hline','vline','crossline','channel']);
    const shapesHidden = isHidden(['rectangle','ellipse']);
    const brushHidden = isHidden(['brush','highlighter']);
    const textHidden = isHidden(['text']);
    
    // Evaluate if the currently selected drawing is already hidden
    const selectedItem = selectedId ? drawings.find(d => d.id === selectedId) : null;
    const isSelectedHidden = selectedItem ? selectedItem.hidden : false;
    const isSelectedLocked = selectedItem ? selectedItem.locked : false;

    const ACTIONS = [
        { id: 'magnet',     label: 'Magnet Mode', Icon: Icons.Magnet, toggle: true },
        { id: 'toggleLock', label: isSelectedLocked ? 'Unlock' : 'Lock', Icon: isSelectedLocked ? Icons.Unlock : Icons.Lock },
        { 
            id: 'hide-group', label: 'Hide Options', Icon: Icons.Hide,
            subActions: [
                { id: 'hide', label: isSelectedHidden ? 'Show Selected' : 'Hide Selected', Icon: isSelectedHidden ? Icons.Show : Icons.Hide },
                { id: allHidden ? 'unhideAll' : 'hideAll', label: allHidden ? 'Show All' : 'Hide All', Icon: allHidden ? Icons.Show : Icons.Hide },
                { id: linesHidden ? 'unhideLines' : 'hideLines', label: linesHidden ? 'Show Lines' : 'Hide Lines', Icon: linesHidden ? Icons.Show : Icons.Hide },
                { id: shapesHidden ? 'unhideShapes' : 'hideShapes', label: shapesHidden ? 'Show Shapes' : 'Hide Shapes', Icon: shapesHidden ? Icons.Show : Icons.Hide },
                { id: brushHidden ? 'unhideBrush' : 'hideBrush', label: brushHidden ? 'Show Brushes' : 'Hide Brushes', Icon: brushHidden ? Icons.Show : Icons.Hide },
                { id: textHidden ? 'unhideText' : 'hideText', label: textHidden ? 'Show Text' : 'Hide Text', Icon: textHidden ? Icons.Show : Icons.Hide },
            ]
        },
        { 
            id: 'delete-group', label: 'Delete Options', Icon: Icons.Delete, danger: true,
            subActions: [
                { id: 'delete',    label: 'Delete Selected', Icon: Icons.Delete },
                { id: 'deleteAll', label: 'Delete All',      Icon: Icons.Delete },
            ]
        },
    ];

    const hoverTimerRef = useRef(null);
    const leaveTimerRef = useRef(null);

    const openFlyout = useCallback((groupId, x, y) => {
        clearTimeout(hoverTimerRef.current);
        clearTimeout(leaveTimerRef.current);
        hoverTimerRef.current = setTimeout(() => {
            setOpenGroup(groupId);
            setFlyoutPos({ x, y });
        }, 100);
    }, []);

    const closeFlyout = useCallback(() => {
        leaveTimerRef.current = setTimeout(() => setOpenGroup(null), 180);
    }, []);

    const keepOpen = useCallback(() => {
        clearTimeout(leaveTimerRef.current);
    }, []);

    const handleSubToolClick = (group, subTool) => {
        setGroupFace(prev => ({ ...prev, [group.id]: subTool }));
        onToolChange(subTool.id);
        setOpenGroup(null);
    };

    const handleGroupClick = (group) => {
        // Single-click activates the current face tool
        onToolChange(groupFace[group.id].id);
    };

    const handleActionClick = (action) => {
        if (action.toggle) {
            setMagnetOn(v => !v);
        }
        onAction?.(action.id);
    };

    // Determine if a group has the active tool
    const groupIsActive = (group) =>
        group.subTools.some(st => st.id === activeTool);

    const hasMultiple = (group) => group.subTools.length > 1;

    return (
        <div style={st.sidebar}>
            {/* ── Scrollable tool list ── */}
            <div style={st.scrollArea}>
                {TOOL_GROUPS.map(group => {
                    const face = groupFace[group.id];
                    const active = groupIsActive(group);
                    const isOpen = openGroup === group.id;

                    return (
                        <div
                            key={group.id}
                            style={st.groupRow}
                            onMouseLeave={closeFlyout}
                        >
                            {/* Main button */}
                            <div
                                style={{
                                    ...st.btn,
                                    ...(active ? st.btnActive : {}),
                                }}
                                onClick={() => handleGroupClick(group)}
                                onMouseEnter={(e) => {
                                    if (hasMultiple(group)) {
                                        const r = e.currentTarget.getBoundingClientRect();
                                        openFlyout(group.id, r.right + 4, r.top);
                                    }
                                }}
                                title={face.label}
                            >
                                <span style={st.icon}><face.Icon /></span>
                                {hasMultiple(group) && (
                                    <span style={{ ...st.chevron, ...(isOpen ? st.chevronOpen : {}) }}>
                                        <ChevronRightIcon />
                                    </span>
                                )}
                            </div>

                            {/* No inline flyout here — rendered via portal below */}
                        </div>
                    );
                })}
            </div>

            {/* ── Divider ── */}
            <div style={st.divider} />

            {/* ── Action buttons ── */}
            <div style={st.actions}>
                {ACTIONS.map(action => {
                    const isToggled = action.toggle && magnetOn;
                    const isOpen = openGroup === action.id;
                    return (
                        <div
                            key={action.id}
                            style={st.groupRow}
                            onMouseLeave={closeFlyout}
                        >
                            <div
                                title={action.label}
                                style={{
                                    ...st.btn,
                                    ...(isToggled ? st.btnActive : {}),
                                    ...(action.danger ? st.btnDanger : {}),
                                }}
                                onClick={() => {
                                    if (action.subActions) {
                                        handleActionClick(action.subActions[0]);
                                    } else {
                                        handleActionClick(action);
                                    }
                                }}
                                onMouseEnter={(e) => {
                                    if (action.subActions) {
                                        const r = e.currentTarget.getBoundingClientRect();
                                        openFlyout(action.id, r.right + 4, r.top);
                                    }
                                }}
                            >
                                <span style={st.icon}><action.Icon /></span>
                                {action.subActions && (
                                    <span style={{ ...st.chevron, ...(isOpen ? st.chevronOpen : {}) }}>
                                        <ChevronRightIcon />
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ── Flyout portal (rendered into body to escape all overflow clipping) ── */}
            {openGroup && (() => {
                const group = TOOL_GROUPS.find(g => g.id === openGroup) || ACTIONS.find(a => a.id === openGroup);
                if (!group) return null;
                const items = group.subTools || group.subActions;
                return ReactDOM.createPortal(
                    <div
                        style={{ ...st.flyout, left: flyoutPos.x, top: flyoutPos.y }}
                        onMouseEnter={keepOpen}
                        onMouseLeave={closeFlyout}
                    >
                        {items.map(st2 => (
                            <div
                                key={st2.id}
                                style={{
                                    ...st.flyoutItem,
                                    ...(st2.id === activeTool ? st.flyoutItemActive : {}),
                                }}
                                onClick={() => {
                                    if (group.subTools) {
                                        handleSubToolClick(group, st2);
                                    } else {
                                        handleActionClick(st2);
                                        setOpenGroup(null);
                                    }
                                }}
                            >
                                <span style={st.flyoutIcon}><st2.Icon /></span>
                                <span style={st.flyoutLabel}>{st2.label}</span>
                            </div>
                        ))}
                    </div>,
                    document.body
                );
            })()}
        </div>
    );
}

// ── Tiny chevron icon ──────────────────────────────────────────────────────────
function ChevronRightIcon() {
    return (
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
        </svg>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const st = {
    sidebar: {
        width: '40px',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'transparent',
        borderRight: '1px solid rgba(255, 255, 255, 0.05)',
        flexShrink: 0,
        userSelect: 'none',
        paddingTop: '4px',
        paddingBottom: '4px',
        position: 'relative',
    },
    // Scrollable area — shows ~5 tools at once, rest scroll
    scrollArea: {
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2px',
        paddingTop: '2px',
        paddingBottom: '2px',
        maxHeight: '180px',   /* ~5 tools × 36px each */
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255, 255, 255, 0.05) transparent',
    },
    groupRow: {
        position: 'relative',
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
    },
    btn: {
        width: '32px',
        height: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: "0px",
        cursor: 'pointer',
        color: 'rgba(255, 255, 255, 0.5)',
        position: 'relative',
        transition: 'color 0.15s, background 0.15s',
        flexShrink: 0,
        gap: '1px',
    },
    btnActive: {
        color: '#ff4500',
        backgroundColor: 'rgba(255,69,0,0.1)',
    },
    btnDanger: {
        color: '#f6465d',
    },
    icon: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    chevron: {
        display: 'flex',
        alignItems: 'center',
        position: 'absolute',
        right: '2px',
        bottom: '3px',
        color: 'rgba(255, 255, 255, 0.3)',
        transition: 'transform 0.15s',
        lineHeight: 1,
    },
    chevronOpen: {
        color: '#ff4500',
    },
    // Flyout popup — portal-rendered into body at fixed screen coordinates
    flyout: {
        position: 'fixed',
        backgroundColor: 'rgba(10, 10, 10, 0.95)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: "0px",
        padding: '5px',
        zIndex: 99999,
        minWidth: '160px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
    },
    flyoutItem: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '7px 10px',
        borderRadius: "0px",
        cursor: 'pointer',
        color: 'rgba(255, 255, 255, 0.7)',
        fontSize: '13px',
        fontFamily: 'Inter, Roboto, sans-serif',
        fontWeight: '400',
        transition: 'background 0.12s, color 0.12s',
        whiteSpace: 'nowrap',
    },
    flyoutItemActive: {
        color: '#ff4500',
        backgroundColor: 'rgba(255,69,0,0.1)',
    },
    flyoutIcon: {
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        color: 'inherit',
    },
    flyoutLabel: {
        color: 'inherit',
    },
    divider: {
        width: '24px',
        height: '1px',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        margin: '4px auto',
        flexShrink: 0,
    },
    actions: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2px',
        flexShrink: 0,
        paddingBottom: '4px',
    },
};
