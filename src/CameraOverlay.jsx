import { useEffect, useRef, useState } from 'react';
import { tellDetector } from './analysis/TellDetector';

const MARGIN = 14;
const SMALL  = { w: 108, h: 144 };
const LARGE  = { w: 168, h: 224 };

// ── Mesh colors ──────────────────────────────────────────────────────────────
const CLR = {
  mesh:    'rgba(77,201,167,0.12)',
  eye:     'rgba(77,201,167,0.75)',
  brow:    'rgba(245,200,66,0.75)',
  lips:    'rgba(255,120,120,0.65)',
  oval:    'rgba(77,201,167,0.25)',
};

// ── FaceMesh lazy loader ─────────────────────────────────────────────────────
let faceLandmarker = null;
let faceLoading    = false;
let DrawingUtilsClass = null;
let FaceLandmarkerClass = null;

async function loadFaceMesh() {
  if (faceLandmarker) return faceLandmarker;
  if (faceLoading)    return null;
  faceLoading = true;
  try {
    const vision = await import('@mediapipe/tasks-vision');
    const { FaceLandmarker, FilesetResolver, DrawingUtils } = vision;
    FaceLandmarkerClass = FaceLandmarker;
    DrawingUtilsClass   = DrawingUtils;

    const filesetResolver = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'CPU',
      },
      outputFaceBlendshapes: true,
      runningMode: 'VIDEO',
      numFaces: 1,
    });
    return faceLandmarker;
  } catch (e) {
    console.warn('FaceMesh failed to load:', e);
    faceLoading = false;
    return null;
  }
}

// ── Corner helpers ───────────────────────────────────────────────────────────
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
  return (cy < window.innerHeight / 2 ? 0 : 2) + (cx < window.innerWidth / 2 ? 0 : 1);
}

// ── Component ────────────────────────────────────────────────────────────────
export default function CameraOverlay() {
  const videoRef     = useRef(null);
  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const rafRef       = useRef(null);
  const drawUtilRef  = useRef(null);
  const dragRef      = useRef(null);
  const lastVideoTs  = useRef(-1);

  const cornerRef   = useRef(3);
  const expandedRef = useRef(false);
  const posRef      = useRef(null);
  const sizeRef     = useRef(SMALL);

  const [corner,   setCorner]   = useState(3);
  const [expanded, setExpanded] = useState(false);
  const [pos,      setPos]      = useState(null);
  const [dragging, setDragging] = useState(false);
  const [camError, setCamError] = useState(false);
  const [faceReady, setFaceReady] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);

  cornerRef.current   = corner;
  expandedRef.current = expanded;
  posRef.current      = pos;
  sizeRef.current     = expanded ? LARGE : SMALL;

  // ── Camera access ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) { setCamError(true); return; }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false })
      .then(stream => {
        if (videoRef.current) { videoRef.current.srcObject = stream; }
      })
      .catch(() => setCamError(true));

    // Load face mesh in background
    loadFaceMesh().then(lm => { if (lm) setFaceReady(true); });

    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ── Face detection loop ────────────────────────────────────────────────────
  useEffect(() => {
    if (!faceReady) return;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    let running = true;

    const loop = () => {
      if (!running) return;
      rafRef.current = requestAnimationFrame(loop);

      if (video.readyState < 2) return; // not ready yet

      // Sync canvas size to its displayed size
      const { clientWidth: w, clientHeight: h } = canvas;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      if (!w || !h) return;

      const ctx = canvas.getContext('2d');

      // Init DrawingUtils once
      if (!drawUtilRef.current && DrawingUtilsClass) {
        drawUtilRef.current = new DrawingUtilsClass(ctx);
      }

      // Run face detection ~15fps (skip every other frame via videoTimestamp)
      const now = performance.now();
      if (now - lastVideoTs.current < 66) return; // ~15fps
      lastVideoTs.current = now;

      let results;
      try {
        results = faceLandmarker.detectForVideo(video, now);
      } catch {
        return;
      }

      ctx.clearRect(0, 0, w, h);

      const hasface = results.faceLandmarks?.length > 0;
      setFaceDetected(hasface);

      if (hasface) {
        // Feed biometrics to tell detector
        tellDetector.addFrame(results.faceBlendshapes, results.faceLandmarks, Date.now());

        if (drawUtilRef.current) {
          const du = drawUtilRef.current;
          const FL = FaceLandmarkerClass;

          // Draw mesh layers (outermost first → innermost)
          du.drawConnectors(results.faceLandmarks[0], FL.FACE_LANDMARKS_TESSELATION,
            { color: CLR.mesh, lineWidth: 0.4 });
          du.drawConnectors(results.faceLandmarks[0], FL.FACE_LANDMARKS_FACE_OVAL,
            { color: CLR.oval, lineWidth: 1.2 });
          du.drawConnectors(results.faceLandmarks[0], FL.FACE_LANDMARKS_LEFT_EYEBROW,
            { color: CLR.brow, lineWidth: 1.5 });
          du.drawConnectors(results.faceLandmarks[0], FL.FACE_LANDMARKS_RIGHT_EYEBROW,
            { color: CLR.brow, lineWidth: 1.5 });
          du.drawConnectors(results.faceLandmarks[0], FL.FACE_LANDMARKS_LEFT_EYE,
            { color: CLR.eye, lineWidth: 1.5 });
          du.drawConnectors(results.faceLandmarks[0], FL.FACE_LANDMARKS_RIGHT_EYE,
            { color: CLR.eye, lineWidth: 1.5 });
          du.drawConnectors(results.faceLandmarks[0], FL.FACE_LANDMARKS_LIPS,
            { color: CLR.lips, lineWidth: 1.2 });

          // Live metric indicators
          const cur = tellDetector.getCurrent();
          if (cur) drawLiveIndicators(ctx, w, h, cur);
        }
      } else {
        // No face: draw scanning reticle
        drawReticle(ctx, w, h, now);
      }
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, [faceReady]);

  // ── Collapse on outside tap ────────────────────────────────────────────────
  useEffect(() => {
    if (!expanded) return;
    const h = (e) => { if (!containerRef.current?.contains(e.target)) setExpanded(false); };
    document.addEventListener('touchstart', h, { passive: true });
    return () => document.removeEventListener('touchstart', h);
  }, [expanded]);

  // ── Touch drag/tap ─────────────────────────────────────────────────────────
  const onTouchStart = (e) => {
    e.stopPropagation();
    const touch = e.touches[0];
    const cur = posRef.current ?? cornerPos(cornerRef.current, sizeRef.current);
    dragRef.current = {
      startX: touch.clientX, startY: touch.clientY,
      startT: Date.now(), moved: false,
      offX: touch.clientX - cur.x, offY: touch.clientY - cur.y,
    };
    setDragging(true);
  };

  const onTouchMove = (e) => {
    if (!dragRef.current) return;
    const touch = e.touches[0];
    if (Math.abs(touch.clientX - dragRef.current.startX) > 6 ||
        Math.abs(touch.clientY - dragRef.current.startY) > 6) dragRef.current.moved = true;
    const p = { x: touch.clientX - dragRef.current.offX, y: touch.clientY - dragRef.current.offY };
    posRef.current = p;
    setPos(p);
  };

  const onTouchEnd = () => {
    if (!dragRef.current) return;
    const { moved, startT } = dragRef.current;
    dragRef.current = null;
    if (!moved && Date.now() - startT < 280) {
      setExpanded(ex => !ex); setDragging(false); setPos(null); posRef.current = null; return;
    }
    setDragging(false);
    const last = posRef.current ?? cornerPos(cornerRef.current, sizeRef.current);
    const snap = nearestCorner(last.x, last.y, sizeRef.current);
    requestAnimationFrame(() => { setCorner(snap); cornerRef.current = snap; setPos(null); posRef.current = null; });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const size = expanded ? LARGE : SMALL;
  const displayPos = pos ?? cornerPos(corner, size);

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        position: 'fixed',
        left: displayPos.x, top: displayPos.y,
        width: size.w, height: size.h,
        zIndex: 999,
        borderRadius: expanded ? 22 : 18,
        overflow: 'hidden',
        background: '#050d14',
        border: faceDetected
          ? '2px solid rgba(77,201,167,0.6)'
          : '2px solid rgba(255,255,255,0.18)',
        boxShadow: expanded
          ? '0 16px 48px rgba(0,0,0,0.65)'
          : '0 8px 28px rgba(0,0,0,0.55)',
        touchAction: 'none',
        userSelect: 'none',
        cursor: 'grab',
        transition: dragging
          ? 'width 0.22s ease, height 0.22s ease, border-radius 0.22s ease, border-color 0.3s ease'
          : [
              'left 0.38s cubic-bezier(0.25,0.46,0.45,0.94)',
              'top 0.38s cubic-bezier(0.25,0.46,0.45,0.94)',
              'width 0.28s cubic-bezier(0.34,1.56,0.64,1)',
              'height 0.28s cubic-bezier(0.34,1.56,0.64,1)',
              'border-radius 0.25s ease',
              'border-color 0.3s ease',
            ].join(', '),
      }}
    >
      {camError ? (
        <div style={{ width:'100%',height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6 }}>
          <span style={{ fontSize: 26 }}>📷</span>
          <span style={{ fontSize: 10, color:'rgba(255,255,255,0.4)', textAlign:'center', padding:'0 8px', lineHeight:1.4 }}>Camera unavailable</span>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay playsInline muted
            style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', transform:'scaleX(-1)', display:'block' }}
          />
          <canvas
            ref={canvasRef}
            style={{ position:'absolute', inset:0, width:'100%', height:'100%', transform:'scaleX(-1)', pointerEvents:'none' }}
          />
          {/* Status dot */}
          <div style={{
            position: 'absolute', top: 7, right: 8,
            width: 7, height: 7, borderRadius: '50%',
            background: faceDetected ? '#4dc9a7' : faceReady ? '#f5c842' : '#888',
            boxShadow: faceDetected ? '0 0 6px #4dc9a7' : 'none',
            transition: 'background 0.4s, box-shadow 0.4s',
          }} />
        </>
      )}

      {/* Drag handle */}
      {!expanded && (
        <div style={{
          position:'absolute', bottom:5, left:'50%', transform:'translateX(-50%)',
          width:26, height:3, borderRadius:2,
          background:'rgba(255,255,255,0.3)', pointerEvents:'none',
        }} />
      )}
    </div>
  );
}

// ── Canvas helpers ──────────────────────────────────────────────────────────
function drawReticle(ctx, w, h, now) {
  const cx = w / 2, cy = h / 2;
  const sz = Math.min(w, h) * 0.32;
  const t = now / 1000;
  const alpha = 0.3 + 0.2 * Math.sin(t * 2);
  ctx.strokeStyle = `rgba(77,201,167,${alpha})`;
  ctx.lineWidth = 1.5;
  const len = sz * 0.35;
  const corners = [[-1,-1],[1,-1],[1,1],[-1,1]];
  corners.forEach(([sx, sy]) => {
    const ox = cx + sx * sz; const oy = cy + sy * sz;
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox - sx * len, oy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox, oy - sy * len); ctx.stroke();
  });
}

function drawLiveIndicators(ctx, w, h, cur) {
  const signals = [
    { val: cur.blink,     color: '#ff8888' },
    { val: cur.browRaise, color: '#f5c842' },
    { val: cur.smile,     color: '#4dc9a7' },
    { val: cur.lipPress,  color: '#a87af0' },
    { val: cur.eyeWide,   color: '#60b8ff' },
    { val: cur.noseSneer, color: '#ff9944' },
  ];
  signals.forEach(({ val, color }, i) => {
    const x = 5 + i * 8;
    const barH = Math.round(val * 13);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, 5, 6, 15);
    ctx.fillStyle = color;
    ctx.fillRect(x, 5 + (15 - barH), 6, barH);
  });
}
