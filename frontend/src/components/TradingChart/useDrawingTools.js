import { useState, useRef, useCallback, useEffect } from 'react';

// ─── Coordinate helpers ────────────────────────────────────────────────────────
function rectFromPoints(p1, p2) {
    return {
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        w: Math.abs(p2.x - p1.x),
        h: Math.abs(p2.y - p1.y),
    };
}

function dist(p1, p2) {
    return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

function pointNearLine(pt, a, b, thresh = 6) {
    const len = dist(a, b);
    if (len === 0) return dist(pt, a) < thresh;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * (b.x - a.x) + (pt.y - a.y) * (b.y - a.y)) / (len * len)));
    const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    return dist(pt, proj) < thresh;
}

function pointInRect(pt, r) {
    return pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export default function useDrawingTools(canvasRef, chartRef, onMessage) {
    const [activeTool, setActiveTool]   = useState('pointer');
    const [drawings, setDrawings]       = useState([]);
    const [selectedId, setSelectedId]   = useState(null);

    const drawingsRef  = useRef([]);
    const selectedRef  = useRef(null);
    const activeToolRef = useRef('pointer');

    // Keep refs in sync
    useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
    useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
    useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

    // ── Drawing state machine ────────────────────────────────────────────────
    const isDrawingRef = useRef(false);
    const startPtRef   = useRef(null);
    const currentPtRef = useRef(null);
    const penPointsRef = useRef([]);
    const dragOffsetRef = useRef(null);
    const drawingStepRef = useRef(0);
    const pendingChannelRef = useRef(null);
    const idCounter    = useRef(0);
    const textInputRef = useRef(null);

    const newId = () => `d${++idCounter.current}`;

    // ── Canvas rendering ─────────────────────────────────────────────────────
    const render = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const all = drawingsRef.current;
        const selId = selectedRef.current;

        all.forEach(d => {
            if (d.hidden) return;
            ctx.save();
            const sel = d.id === selId;
            ctx.globalAlpha = 1;

            switch (d.type) {
                case 'trendline':
                case 'ray':
                case 'arrow': {
                    const { p1, p2 } = d;
                    ctx.beginPath();
                    ctx.strokeStyle = d.color || '#ff4500';
                    ctx.lineWidth = sel ? 2.5 : 1.5;
                    ctx.setLineDash([]);
                    if (d.type === 'ray') {
                        // Extend the line in one direction to canvas edge
                        const dx = p2.x - p1.x, dy = p2.y - p1.y;
                        const len = Math.hypot(dx, dy) || 1;
                        const scale = Math.max(canvas.width, canvas.height) * 2 / len;
                        ctx.moveTo(p1.x, p1.y);
                        ctx.lineTo(p1.x + dx * scale, p1.y + dy * scale);
                    } else {
                        ctx.moveTo(p1.x, p1.y);
                        ctx.lineTo(p2.x, p2.y);
                    }
                    ctx.stroke();
                    if (d.type === 'arrow') {
                        // Arrowhead
                        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                        const hs = 10;
                        ctx.beginPath();
                        ctx.fillStyle = d.color || '#ff4500';
                        ctx.moveTo(p2.x, p2.y);
                        ctx.lineTo(p2.x - hs * Math.cos(angle - 0.4), p2.y - hs * Math.sin(angle - 0.4));
                        ctx.lineTo(p2.x - hs * Math.cos(angle + 0.4), p2.y - hs * Math.sin(angle + 0.4));
                        ctx.closePath();
                        ctx.fill();
                    }
                    if (sel) drawHandles(ctx, [p1, p2]);
                    break;
                }
                case 'hline': {
                    ctx.beginPath();
                    ctx.strokeStyle = d.color || '#ff4500';
                    ctx.lineWidth = sel ? 2 : 1.5;
                    ctx.setLineDash([8, 5]);
                    ctx.moveTo(0, d.y);
                    ctx.lineTo(canvas.width, d.y);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    if (sel) drawHandles(ctx, [{ x: canvas.width / 2, y: d.y }]);
                    break;
                }
                case 'vline': {
                    ctx.beginPath();
                    ctx.strokeStyle = d.color || '#ff4500';
                    ctx.lineWidth = sel ? 2 : 1.5;
                    ctx.setLineDash([8, 5]);
                    ctx.moveTo(d.x, 0);
                    ctx.lineTo(d.x, canvas.height);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    if (sel) drawHandles(ctx, [{ x: d.x, y: canvas.height / 2 }]);
                    break;
                }
                case 'crossline': {
                    ctx.beginPath();
                    ctx.strokeStyle = d.color || '#ff4500';
                    ctx.lineWidth = sel ? 2 : 1.5;
                    ctx.setLineDash([8, 5]);
                    ctx.moveTo(0, d.pt.y);
                    ctx.lineTo(canvas.width, d.pt.y);
                    ctx.moveTo(d.pt.x, 0);
                    ctx.lineTo(d.pt.x, canvas.height);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    if (sel) drawHandles(ctx, [{ x: d.pt.x, y: d.pt.y }]);
                    break;
                }
                case 'rectangle': {
                    const r = rectFromPoints(d.p1, d.p2);
                    ctx.beginPath();
                    ctx.strokeStyle = d.color || '#F6465D';
                    ctx.lineWidth = sel ? 2 : 1.5;
                    ctx.fillStyle = 'rgba(246,70,93,0.08)';
                    ctx.rect(r.x, r.y, r.w, r.h);
                    ctx.fill();
                    ctx.stroke();
                    if (sel) drawHandles(ctx, [d.p1, { x: d.p2.x, y: d.p1.y }, d.p2, { x: d.p1.x, y: d.p2.y }]);
                    break;
                }
                case 'ellipse': {
                    const r = rectFromPoints(d.p1, d.p2);
                    const cx2 = r.x + r.w / 2, cy2 = r.y + r.h / 2;
                    ctx.beginPath();
                    ctx.strokeStyle = d.color || '#F6465D';
                    ctx.lineWidth = sel ? 2 : 1.5;
                    ctx.fillStyle = 'rgba(246,70,93,0.06)';
                    ctx.ellipse(cx2, cy2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    if (sel) drawHandles(ctx, [d.p1, { x: d.p2.x, y: d.p1.y }, d.p2, { x: d.p1.x, y: d.p2.y }]);
                    break;
                }
                case 'highlighter':
                case 'brush': {
                    if (!d.points || d.points.length < 2) break;
                    ctx.beginPath();
                    if (d.type === 'highlighter') {
                        ctx.strokeStyle = d.color || 'rgba(252,213,53,0.3)';
                        ctx.lineWidth = sel ? 14 : 12;
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                    } else {
                        ctx.strokeStyle = d.color || '#AB47BC';
                        ctx.lineWidth = sel ? 4 : 3;
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                    }
                    ctx.setLineDash([]);
                    ctx.moveTo(d.points[0].x, d.points[0].y);
                    d.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
                    ctx.stroke();
                    break;
                }
                case 'channel': {
                    const { p1, p2, p3 } = d;
                    if (!p3) break;
                    ctx.strokeStyle = d.color || '#AB47BC';
                    ctx.lineWidth = sel ? 2 : 1.5;
                    ctx.setLineDash([]);
                    // Main line
                    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
                    // Parallel offset line
                    const dy = p3.y - p1.y;
                    ctx.setLineDash([4, 3]);
                    ctx.beginPath(); ctx.moveTo(p1.x, p1.y + dy); ctx.lineTo(p2.x, p2.y + dy); ctx.stroke();
                    ctx.setLineDash([]);
                    if (sel) drawHandles(ctx, [p1, p2, p3]);
                    break;
                }
                case 'ruler': {
                    const { p1, p2 } = d;
                    ctx.strokeStyle = '#ff4500';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 3]);
                    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p1.y); ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(p2.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
                    ctx.setLineDash([]);
                    // Label
                    const dx = Math.abs(p2.x - p1.x).toFixed(0);
                    const dy2 = Math.abs(p2.y - p1.y).toFixed(0);
                    ctx.fillStyle = '#ff4500';
                    ctx.font = '10px Roboto Mono, monospace';
                    ctx.fillText(`${dx}px / ${dy2}px`, Math.min(p1.x, p2.x) + 4, Math.min(p1.y, p2.y) - 4);
                    if (sel) drawHandles(ctx, [p1, p2]);
                    break;
                }
                case 'fib': {
                    const { p1, p2 } = d;
                    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
                    const colors = ['#ff4500','#E040FB','#ff4500','#0ECB81','#ff4500','#E040FB','#ff4500'];
                    const totalH = p2.y - p1.y;
                    levels.forEach((lvl, i) => {
                        const y = p1.y + totalH * lvl;
                        ctx.strokeStyle = colors[i];
                        ctx.globalAlpha = sel ? 1 : 0.75;
                        ctx.lineWidth = 1;
                        ctx.setLineDash([]);
                        ctx.beginPath(); ctx.moveTo(p1.x, y); ctx.lineTo(p2.x, y); ctx.stroke();
                        ctx.fillStyle = colors[i];
                        ctx.font = '10px Roboto Mono, monospace';
                        ctx.fillText(`${(lvl * 100).toFixed(1)}%`, p2.x + 4, y + 4);
                    });
                    ctx.globalAlpha = 1;
                    if (sel) drawHandles(ctx, [p1, p2]);
                    break;
                }
                case 'text': {
                    ctx.fillStyle = d.color || '#eaecef';
                    ctx.font = `${d.fontSize || 13}px Roboto Mono, monospace`;
                    ctx.fillText(d.text || '', d.x, d.y);
                    if (sel) {
                        const m = ctx.measureText(d.text || '');
                        ctx.strokeStyle = '#ff4500';
                        ctx.lineWidth = 1;
                        ctx.setLineDash([3, 3]);
                        ctx.strokeRect(d.x - 2, d.y - (d.fontSize || 13) - 2, m.width + 4, (d.fontSize || 13) + 6);
                        ctx.setLineDash([]);
                    }
                    break;
                }
                default: break;
            }
            ctx.restore();
        });

        // Preview while drawing
        if (isDrawingRef.current && startPtRef.current && currentPtRef.current) {
            renderPreview(ctx, canvas);
        }
    }, [canvasRef]);

    function drawHandles(ctx, pts) {
        pts.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#ff4500';
            ctx.fill();
            ctx.strokeStyle = 'transparent';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        });
    }

    function renderPreview(ctx, canvas) {
        const tool = activeToolRef.current;
        const p1 = startPtRef.current;
        const p2 = currentPtRef.current;
        ctx.save();
        ctx.globalAlpha = 0.7;

        switch (tool) {
            case 'trendline':
            case 'ruler':
            case 'fib':
            case 'channel': {
                if (drawingStepRef.current === 2) {
                    const { p1: rp1, p2: rp2 } = pendingChannelRef.current;
                    ctx.strokeStyle = '#ff4500';
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([5, 3]);
                    ctx.beginPath(); ctx.moveTo(rp1.x, rp1.y); ctx.lineTo(rp2.x, rp2.y); ctx.stroke();
                    
                    const dy = p2.y - rp1.y;
                    ctx.setLineDash([4, 3]);
                    ctx.beginPath(); ctx.moveTo(rp1.x, rp1.y + dy); ctx.lineTo(rp2.x, rp2.y + dy); ctx.stroke();
                    ctx.setLineDash([]);
                } else {
                    ctx.strokeStyle = '#ff4500';
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([5, 3]);
                    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
                    ctx.stroke(); ctx.setLineDash([]);
                }
                break;
            }
            case 'ray': {
                ctx.strokeStyle = '#ff4500';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([5, 3]);
                ctx.beginPath();
                const dx = p2.x - p1.x, dy = p2.y - p1.y;
                const len = Math.hypot(dx, dy) || 1;
                const scale = Math.max(canvas.width, canvas.height) * 2 / len;
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p1.x + dx * scale, p1.y + dy * scale);
                ctx.stroke(); 
                ctx.setLineDash([]);
                break;
            }
            case 'arrow': {
                ctx.strokeStyle = '#ff4500';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([5, 3]);
                ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
                ctx.stroke(); ctx.setLineDash([]);
                
                const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                const hs = 10;
                ctx.beginPath();
                ctx.fillStyle = '#ff4500';
                ctx.moveTo(p2.x, p2.y);
                ctx.lineTo(p2.x - hs * Math.cos(angle - 0.4), p2.y - hs * Math.sin(angle - 0.4));
                ctx.lineTo(p2.x - hs * Math.cos(angle + 0.4), p2.y - hs * Math.sin(angle + 0.4));
                ctx.closePath();
                ctx.fill();
                break;
            }
            case 'ellipse': {
                const r = rectFromPoints(p1, p2);
                const cx2 = r.x + r.w / 2, cy2 = r.y + r.h / 2;
                ctx.strokeStyle = '#F6465D';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([5, 3]);
                ctx.beginPath();
                ctx.ellipse(cx2, cy2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
                break;
            }
            case 'rectangle': {
                const r = rectFromPoints(p1, p2);
                ctx.strokeStyle = '#F6465D';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([5, 3]);
                ctx.strokeRect(r.x, r.y, r.w, r.h);
                ctx.setLineDash([]);
                break;
            }
            case 'highlighter':
            case 'brush': {
                if (penPointsRef.current.length > 2) {
                    ctx.beginPath();
                    if (tool === 'highlighter') {
                        ctx.strokeStyle = 'rgba(252,213,53,0.3)';
                        ctx.lineWidth = 12;
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                    } else {
                        ctx.strokeStyle = '#AB47BC';
                        ctx.lineWidth = 3;
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                    }
                    ctx.setLineDash([]);
                    ctx.moveTo(penPointsRef.current[0].x, penPointsRef.current[0].y);
                    penPointsRef.current.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
                    ctx.stroke();
                }
                break;
            }
            case 'hline': {
                ctx.strokeStyle = '#ff4500';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([8, 5]);
                ctx.beginPath(); ctx.moveTo(0, p1.y); ctx.lineTo(canvas.width, p1.y);
                ctx.stroke(); ctx.setLineDash([]);
                break;
            }
            case 'vline': {
                ctx.strokeStyle = '#ff4500';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([8, 5]);
                ctx.beginPath(); ctx.moveTo(p1.x, 0); ctx.lineTo(p1.x, canvas.height);
                ctx.stroke(); ctx.setLineDash([]);
                break;
            }
            case 'crossline': {
                ctx.strokeStyle = '#ff4500';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([8, 5]);
                ctx.beginPath();
                ctx.moveTo(0, p1.y); ctx.lineTo(canvas.width, p1.y);
                ctx.moveTo(p1.x, 0); ctx.lineTo(p1.x, canvas.height);
                ctx.stroke(); ctx.setLineDash([]);
                break;
            }
            default: break;
        }
        ctx.restore();
    }

    // ── Hit testing ──────────────────────────────────────────────────────────
    function hitTest(pt) {
        const all = [...drawingsRef.current].reverse(); // top-most first
        for (const d of all) {
            if (d.hidden) continue;
            switch (d.type) {
                case 'trendline':
                case 'ray':
                case 'arrow':
                case 'channel':
                case 'ruler':
                case 'fib':
                    if (pointNearLine(pt, d.p1, d.p2)) return d.id; break;
                case 'hline':
                    if (Math.abs(pt.y - d.y) < 6) return d.id; break;
                case 'vline':
                    if (Math.abs(pt.x - d.x) < 6) return d.id; break;
                case 'crossline':
                    if (Math.abs(pt.x - d.pt.x) < 6 || Math.abs(pt.y - d.pt.y) < 6) return d.id; break;
                case 'ellipse':
                case 'rectangle':
                    if (pointInRect(pt, rectFromPoints(d.p1, d.p2))) return d.id; break;
                case 'highlighter':
                case 'brush':
                    if (d.points?.some((p, i) => i > 0 && pointNearLine(pt, d.points[i - 1], p, 8))) return d.id; break;
                case 'text': {
                    const approx = { x: d.x, y: d.y - 14, w: 80, h: 18 };
                    if (pointInRect(pt, approx)) return d.id; break;
                }
                default: break;
            }
        }
        return null;
    }

    // ── Canvas event handlers ────────────────────────────────────────────────
    const getPos = (e, canvas) => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const handleMouseDown = useCallback((e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const pt = getPos(e, canvas);
        const tool = activeToolRef.current;

        if (tool === 'pointer' || tool === 'cursor-arrow' || tool === 'move') {
            const hit = hitTest(pt);
            setSelectedId(hit);
            selectedRef.current = hit;
            if (hit) {
                // Start drag
                const d = drawingsRef.current.find(x => x.id === hit);
                if (d && !d.locked) {
                    dragOffsetRef.current = { id: hit, startPt: pt, drawing: JSON.parse(JSON.stringify(d)) };
                }
            }
            render();
            return;
        }

        if (tool === 'channel' && drawingStepRef.current === 2) {
            const { p1, p2 } = pendingChannelRef.current;
            const dy = pt.y - p1.y;
            const p3 = { x: (p1.x + p2.x) / 2, y: p1.y + dy };
            const newDrawing = { type: 'channel', p1, p2, p3, color: '#AB47BC', id: newId(), locked: false, hidden: false };
            setDrawings(prev => [...prev, newDrawing]);
            setSelectedId(newDrawing.id);
            selectedRef.current = newDrawing.id;
            
            drawingStepRef.current = 0;
            pendingChannelRef.current = null;
            isDrawingRef.current = false;
            render();
            return;
        }

        isDrawingRef.current = true;
        startPtRef.current = pt;
        currentPtRef.current = pt;

        if (tool === 'brush' || tool === 'highlighter') penPointsRef.current = [pt];
        if (tool === 'hline') {
            // Snap and finalize immediately on mousedown for hline
        }
        if (tool === 'vline') {
            // Snap and finalize immediately on mousedown for vline
        }
        if (tool === 'crossline') {
            // Snap and finalize immediately on mousedown
        }
    }, [canvasRef, render]);

    const handleMouseMove = useCallback((e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const pt = getPos(e, canvas);
        const tool = activeToolRef.current;

        // Drag selected drawing
        if (dragOffsetRef.current) {
            const { id, startPt, drawing } = dragOffsetRef.current;
            const dx = pt.x - startPt.x;
            const dy = pt.y - startPt.y;
            setDrawings(prev => prev.map(d => {
                if (d.id !== id) return d;
                const nd = { ...d };
                if (nd.p1) nd.p1 = { x: drawing.p1.x + dx, y: drawing.p1.y + dy };
                if (nd.p2) nd.p2 = { x: drawing.p2.x + dx, y: drawing.p2.y + dy };
                if (nd.p3) nd.p3 = { x: drawing.p3.x + dx, y: drawing.p3.y + dy };
                if (nd.y !== undefined) nd.y = drawing.y + dy;
                if (nd.x !== undefined) nd.x = drawing.x + dx;
                if (nd.pt !== undefined) nd.pt = { x: drawing.pt.x + dx, y: drawing.pt.y + dy };
                if (nd.points) nd.points = drawing.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
                return nd;
            }));
            render();
            return;
        }

        if (!isDrawingRef.current) return;
        currentPtRef.current = pt;

        if (tool === 'brush' || tool === 'highlighter') penPointsRef.current.push(pt);

        render();
    }, [canvasRef, render]);

    const handleMouseUp = useCallback((e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const pt = getPos(e, canvas);
        const tool = activeToolRef.current;

        // End drag
        if (dragOffsetRef.current) {
            dragOffsetRef.current = null;
            return;
        }

        if (!isDrawingRef.current) return;
        
        if (drawingStepRef.current === 2) return;

        isDrawingRef.current = false;

        const p1 = startPtRef.current;
        const p2 = pt;
        let newDrawing = null;

        switch (tool) {
            // ── Line & ray family ──────────────────────────────────────────────
            case 'trendline': newDrawing = { type: 'trendline', p1, p2, color: '#ff4500' }; break;
            case 'ray':       newDrawing = { type: 'ray',       p1, p2, color: '#ff4500' }; break;
            // ── Arrow family ───────────────────────────────────────────────────
            case 'arrow': newDrawing = { type: 'arrow', p1, p2, color: '#ff4500' }; break;
            // ── Shapes ─────────────────────────────────────────────────────────
            case 'rectangle': {
                if (Math.abs(p2.x - p1.x) > 5 && Math.abs(p2.y - p1.y) > 5)
                    newDrawing = { type: 'rectangle', p1, p2, color: '#F6465D' };
                break;
            }
            case 'ellipse': {
                if (Math.abs(p2.x - p1.x) > 5 && Math.abs(p2.y - p1.y) > 5)
                    newDrawing = { type: 'ellipse', p1, p2, color: '#F6465D' };
                break;
            }
            // ── Draw family ────────────────────────────────────────────────────
            case 'highlighter':
            case 'brush': {
                if (penPointsRef.current.length > 2) {
                    newDrawing = { 
                        type: tool, 
                        points: [...penPointsRef.current], 
                        color: tool === 'highlighter' ? 'rgba(252,213,53,0.3)' : '#AB47BC'
                    };
                }
                penPointsRef.current = [];
                break;
            }
            // ── Price lines ────────────────────────────────────────────────────
            case 'hline': newDrawing = { type: 'hline', y: p1.y, color: '#ff4500' }; break;
            case 'vline': newDrawing = { type: 'vline', x: p1.x, color: '#ff4500' }; break;
            case 'crossline': newDrawing = { type: 'crossline', pt: p1, color: '#ff4500' }; break;
            // ── Channels ───────────────────────────────────────────────────────
            case 'channel': {
                if (Math.abs(p2.x - p1.x) > 5 || Math.abs(p2.y - p1.y) > 5) {
                    drawingStepRef.current = 2;
                    pendingChannelRef.current = { p1, p2 };
                    isDrawingRef.current = true; // keep drawing mode active
                }
                return;
            }
            // ── Measure ────────────────────────────────────────────────────────
            case 'ruler': newDrawing = { type: 'ruler', p1, p2, color: '#ff4500' }; break;
            // ── Fibonacci ──────────────────────────────────────────────────────
            case 'fib':
            case 'fibfan':    newDrawing = { type: 'fib', p1, p2, color: '#AB47BC' }; break;
            // ── Text / Note ────────────────────────────────────────────────────
            case 'text': {
                spawnTextInput(p1, canvas);
                return;
            }
            default: break;
        }

        if (newDrawing) {
            newDrawing.id = newId();
            newDrawing.locked = false;
            newDrawing.hidden = false;
            setDrawings(prev => [...prev, newDrawing]);
            setSelectedId(newDrawing.id);
            selectedRef.current = newDrawing.id;
        }

        render();
    }, [canvasRef, render]);

    // ── Inline text input ────────────────────────────────────────────────────
    function spawnTextInput(pt, canvas) {
        // Remove any existing input
        if (textInputRef.current) textInputRef.current.remove();

        const rect = canvas.getBoundingClientRect();
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Type text…';
        Object.assign(input.style, {
            position: 'fixed',
            left: `${rect.left + pt.x}px`,
            top:  `${rect.top + pt.y - 20}px`,
            background: 'rgba(10,10,10,0.9)',
            color: '#eaecef',
            border: '1px solid #ff4500',
            borderRadius: "0px",
            padding: '2px 6px',
            fontSize: '13px',
            fontFamily: 'Roboto Mono, monospace',
            outline: 'none',
            zIndex: 9999,
            minWidth: '80px',
        });

        const finish = () => {
            const text = input.value.trim();
            if (text) {
                const id = newId();
                const d = { id, type: 'text', text, x: pt.x, y: pt.y, color: '#eaecef', fontSize: 13, locked: false, hidden: false };
                setDrawings(prev => [...prev, d]);
                setSelectedId(id);
                selectedRef.current = id;
                render();
            }
            input.remove();
            textInputRef.current = null;
        };

        input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(); if (e.key === 'Escape') { input.remove(); textInputRef.current = null; } });
        input.addEventListener('blur', finish);
        document.body.appendChild(input);
        input.focus();
        textInputRef.current = input;
    }

    // ── Action handlers ──────────────────────────────────────────────────────
    const handleAction = useCallback((action) => {
        const selId = selectedRef.current;
        
        if (action === 'delete') {
            if (selId) {
                setDrawings(prev => prev.filter(d => d.id !== selId));
                setSelectedId(null);
                selectedRef.current = null;
            }
            return;
        }
        if (action === 'deleteAll') {
            setDrawings([]);
            setSelectedId(null);
            selectedRef.current = null;
            render();
            return;
        }
        
        if (action === 'hideAll') {
            setDrawings(prev => prev.map(d => ({ ...d, hidden: true })));
            setSelectedId(null);
            selectedRef.current = null;
            render();
            return;
        }
        if (action === 'unhideAll') {
            setDrawings(prev => prev.map(d => ({ ...d, hidden: false })));
            render();
            return;
        }
        
        const hideActions = ['hideLines', 'hideShapes', 'hideBrush', 'hideText', 'unhideLines', 'unhideShapes', 'unhideBrush', 'unhideText'];
        if (hideActions.includes(action)) {
            setDrawings(prev => prev.map(d => {
                const isLine = ['trendline','ray','hline','vline','crossline','channel'].includes(d.type);
                const isShape = ['rectangle','ellipse'].includes(d.type);
                const isBrush = ['brush','highlighter'].includes(d.type);
                const isTxt = d.type === 'text';
                
                if (action === 'hideLines' && isLine) return { ...d, hidden: true };
                if (action === 'hideShapes' && isShape) return { ...d, hidden: true };
                if (action === 'hideBrush' && isBrush) return { ...d, hidden: true };
                if (action === 'hideText' && isTxt) return { ...d, hidden: true };
                
                if (action === 'unhideLines' && isLine) return { ...d, hidden: false };
                if (action === 'unhideShapes' && isShape) return { ...d, hidden: false };
                if (action === 'unhideBrush' && isBrush) return { ...d, hidden: false };
                if (action === 'unhideText' && isTxt) return { ...d, hidden: false };
                return d;
            }));
            if (action.startsWith('hide')) {
                setSelectedId(null);
                selectedRef.current = null;
            }
            render();
            return;
        }

        setDrawings(prev => prev.map(d => {
            if (d.id !== selId) return d;
            switch (action) {
                case 'toggleLock': {
                    return { ...d, locked: !d.locked };
                }
                case 'hide': {
                    return { ...d, hidden: !d.hidden };
                }
                default: return d;
            }
        }));
        render();
    }, [render, onMessage]);

    // ── Clear all ────────────────────────────────────────────────────────────
    const clearAll = useCallback(() => {
        setDrawings([]);
        setSelectedId(null);
        selectedRef.current = null;
        render();
    }, [render]);

    // ── Attach canvas events ─────────────────────────────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mouseup',   handleMouseUp);
        return () => {
            canvas.removeEventListener('mousedown', handleMouseDown);
            canvas.removeEventListener('mousemove', handleMouseMove);
            canvas.removeEventListener('mouseup',   handleMouseUp);
        };
    }, [canvasRef, handleMouseDown, handleMouseMove, handleMouseUp]);

    // ── Re-render whenever drawings change ───────────────────────────────────
    useEffect(() => { render(); }, [drawings, selectedId, render]);

    // ── Resize canvas to match container ────────────────────────────────────
    const resizeCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const { offsetWidth: w, offsetHeight: h } = canvas;
        if (w === 0 || h === 0) return;
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width  = w;
            canvas.height = h;
        }
        render();
    }, [canvasRef, render]);

    // Auto-size canvas on mount + resize
    useEffect(() => {
        resizeCanvas();
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ro = new ResizeObserver(resizeCanvas);
        ro.observe(canvas);
        return () => ro.disconnect();
    }, [canvasRef, resizeCanvas]);

    return {
        activeTool,
        setActiveTool,
        drawings,
        selectedId,
        handleAction,
        clearAll,
        resizeCanvas,
    };
}
