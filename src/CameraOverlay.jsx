import { useEffect, useRef, useState } from 'react';

const MARGIN = 14;
const SMALL  = { w: 92,  h: 124 };
const LARGE  = { w: 158, h: 212 };

function cornerPos(c, size) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (c === 0) return { x: MARGIN,                y: MARGIN };
  if (c === 1) return { x: vw - size.w - MARGIN,  y: MARGIN };
  if (c === 2) return { x: MARGIN,                y: vh - size.h - MARGIN };
  return           { x: vw - size.w - MARGIN,  y: vh - size.h - MARGIN };
}

function nearestCorner(x, y, size) {
  const cx = x + size.w / 2;
  const cy = y + size.h / 2;
  const isLeft = cx < window.innerWidth  / 2;
  const isTop  = cy < window.innerHeight / 2;
  return (isTop ? 0 : 2) + (isLeft ? 0 : 1);
}

export default function CameraOverlay() {
  const videoRef     = useRef(null);
  const containerRef = useRef(null);
  const dragRef      = useRef(null);

  // Use refs for values needed inside touch handlers to avoid stale closures
  const cornerRef   = useRef(3);   // start bottom-right
  const expandedRef = useRef(false);
  const posRef      = useRef(null);
  const sizeRef     = useRef(SMALL);

  const [corner,   setCorner]   = useState(3);
  const [expanded, setExpanded] = useState(false);
  const [pos,      setPos]      = useState(null);   // {x,y} while dragging
  const [dragging, setDragging] = useState(false);
  const [camError, setCamError] = useState(false);

  // Keep refs in sync with state
  cornerRef.current   = corner;
  expandedRef.current = expanded;
  posRef.current      = pos;
  sizeRef.current     = expanded ? LARGE : SMALL;

  // ── Camera access ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) { setCamError(true); return; }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false })
      .then(stream => {
        if (videoRef.current) { videoRef.current.srcObject = stream; }
      })
      .catch(() => setCamError(true));
    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // ── Collapse when tapping outside (while expanded) ───────────────────────
  useEffect(() => {
    if (!expanded) return;
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) setExpanded(false);
    };
    document.addEventListener('touchstart', handler, { passive: true });
    return () => document.removeEventListener('touchstart', handler);
  }, [expanded]);

  // ── Touch handlers ───────────────────────────────────────────────────────
  const onTouchStart = (e) => {
    e.stopPropagation();
    const touch = e.touches[0];
    const cur = posRef.current ?? cornerPos(cornerRef.current, sizeRef.current);
    dragRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startT: Date.now(),
      moved:  false,
      offX:   touch.clientX - cur.x,
      offY:   touch.clientY - cur.y,
    };
    setDragging(true);
  };

  const onTouchMove = (e) => {
    if (!dragRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - dragRef.current.startX;
    const dy = touch.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) dragRef.current.moved = true;
    const newPos = {
      x: touch.clientX - dragRef.current.offX,
      y: touch.clientY - dragRef.current.offY,
    };
    posRef.current = newPos;
    setPos(newPos);
  };

  const onTouchEnd = () => {
    if (!dragRef.current) return;
    const { moved, startT } = dragRef.current;
    dragRef.current = null;

    if (!moved && Date.now() - startT < 280) {
      // ── Tap: toggle expanded ──
      setExpanded(ex => !ex);
      setDragging(false);
      setPos(null);
      posRef.current = null;
      return;
    }

    // ── Drag end: two-phase snap ──
    // Phase 1: enable transition while element is still at drag position
    setDragging(false);
    const lastPos = posRef.current ?? cornerPos(cornerRef.current, sizeRef.current);
    const snap = nearestCorner(lastPos.x, lastPos.y, sizeRef.current);

    // Phase 2 (next frame): update corner → CSS transition animates the snap
    requestAnimationFrame(() => {
      setCorner(snap);
      cornerRef.current = snap;
      setPos(null);
      posRef.current = null;
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const size = expanded ? LARGE : SMALL;
  const displayPos = pos ?? cornerPos(corner, size);

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        position:    'fixed',
        left:        displayPos.x,
        top:         displayPos.y,
        width:       size.w,
        height:      size.h,
        zIndex:      999,
        borderRadius: expanded ? 22 : 18,
        overflow:    'hidden',
        background:  '#0a0a0a',
        border:      '2px solid rgba(255,255,255,0.22)',
        boxShadow:   expanded
          ? '0 16px 48px rgba(0,0,0,0.65), 0 4px 12px rgba(0,0,0,0.4)'
          : '0 8px 28px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.3)',
        touchAction: 'none',
        userSelect:  'none',
        cursor:      'grab',
        transition:  dragging
          // During drag: no position transition, but still animate size/radius
          ? 'width 0.22s ease, height 0.22s ease, border-radius 0.22s ease, box-shadow 0.22s ease'
          // Snap + resize: smooth spring-like easing
          : [
              'left 0.38s cubic-bezier(0.25,0.46,0.45,0.94)',
              'top 0.38s cubic-bezier(0.25,0.46,0.45,0.94)',
              'width 0.28s cubic-bezier(0.34,1.56,0.64,1)',
              'height 0.28s cubic-bezier(0.34,1.56,0.64,1)',
              'border-radius 0.25s ease',
              'box-shadow 0.25s ease',
            ].join(', '),
      }}
    >
      {camError ? (
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 6, padding: 10,
        }}>
          <span style={{ fontSize: 28 }}>📷</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 1.4 }}>
            Camera{'\n'}unavailable
          </span>
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%', height: '100%',
            objectFit: 'cover',
            transform: 'scaleX(-1)', // mirror like a selfie camera
            display: 'block',
          }}
        />
      )}

      {/* Subtle drag-handle indicator */}
      {!expanded && (
        <div style={{
          position: 'absolute', bottom: 6, left: '50%',
          transform: 'translateX(-50%)',
          width: 28, height: 3, borderRadius: 2,
          background: 'rgba(255,255,255,0.35)',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}
