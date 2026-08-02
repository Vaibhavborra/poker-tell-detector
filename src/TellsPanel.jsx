import { useEffect, useRef, useState } from 'react';
import { tellDetector } from './analysis/TellDetector';

const STRENGTH_COLOR = {
  strong:   { bg: 'rgba(255,80,80,0.15)',  border: 'rgba(255,80,80,0.4)',  text: '#ff7070' },
  moderate: { bg: 'rgba(255,160,60,0.15)', border: 'rgba(255,160,60,0.4)', text: '#ffb040' },
  weak:     { bg: 'rgba(77,201,167,0.12)', border: 'rgba(77,201,167,0.3)', text: '#4dc9a7' },
};

function TellCard({ tell }) {
  if (!tell.hasData) {
    const total = tell.aSamples + tell.bSamples;
    const needed = tell.samplesNeeded * 2;
    const pct = Math.min(1, total / (needed || 1));
    return (
      <div style={cardBase('#0a1420', 'rgba(255,255,255,0.07)')}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#8aa8cc' }}>
            {tell.icon} {tell.name}
          </span>
          <span style={{ fontSize: 10, color: '#4a6a8a', fontWeight: 600 }}>LEARNING</span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: 6 }}>
          <div style={{ height: '100%', width: `${pct * 100}%`, background: '#2c5a8a', borderRadius: 2, transition: 'width 0.5s ease' }} />
        </div>
        <div style={{ fontSize: 11, color: '#4a6a8a' }}>
          Needs {tell.samplesNeeded} more sample{tell.samplesNeeded !== 1 ? 's' : ''} per category
        </div>
      </div>
    );
  }

  const col = STRENGTH_COLOR[tell.strength] || STRENGTH_COLOR.weak;
  const bar = Math.min(1, Math.abs(tell.d) / 1.5);
  const dir = tell.d > 0 ? '▲ higher when betting' : '▼ lower when betting';

  return (
    <div style={cardBase(col.bg, col.border)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#edf2ff' }}>
          {tell.icon} {tell.name}
        </span>
        <span style={{ fontSize: 10, fontWeight: 800, color: col.text, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {tell.strength}
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#9cb8d8', lineHeight: 1.5, marginBottom: 7 }}>
        {tell.description}
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: 5 }}>
        <div style={{ height: '100%', width: `${bar * 100}%`, background: col.text, borderRadius: 2 }} />
      </div>
      <div style={{ fontSize: 10, color: '#5a7a9a', display: 'flex', justifyContent: 'space-between' }}>
        <span>{dir}</span>
        <span>{tell.aSamples} / {tell.bSamples} samples</span>
      </div>
    </div>
  );
}

function cardBase(bg, border) {
  return {
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 14,
    padding: '12px 14px',
    marginBottom: 10,
  };
}

export default function TellsPanel() {
  const [open, setOpen]     = useState(false);
  const [report, setReport] = useState(null);
  const timerRef            = useRef(null);

  useEffect(() => {
    if (!open) return;
    const refresh = () => setReport(tellDetector.getReport());
    refresh();
    timerRef.current = setInterval(refresh, 2000);
    return () => clearInterval(timerRef.current);
  }, [open]);

  const strongCount = report?.tells?.filter(t => t.hasData && (t.strength === 'strong' || t.strength === 'moderate')).length ?? 0;

  return (
    <>
      {/* ── Trigger button ── */}
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: '3px 10px',
          borderRadius: 999,
          border: strongCount > 0
            ? '1px solid rgba(255,80,80,0.5)'
            : '1px solid rgba(255,255,255,0.12)',
          background: strongCount > 0
            ? 'rgba(255,80,80,0.15)'
            : 'rgba(255,255,255,0.07)',
          color: strongCount > 0 ? '#ff8888' : '#9cb3d0',
          fontSize: 11, fontWeight: 700,
          cursor: 'pointer',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {strongCount > 0 ? `⚠ ${strongCount} Tell${strongCount > 1 ? 's' : ''}` : '📊 Tells'}
      </button>

      {/* ── Panel ── */}
      {open && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'flex-end',
        }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div style={{
            width: '100%',
            maxHeight: '80vh',
            background: '#08131f',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '24px 24px 0 0',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '16px 18px 12px',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
              flexShrink: 0,
            }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#edf2ff' }}>Tell Analysis</div>
                <div style={{ fontSize: 11, color: '#5a7a9a', marginTop: 2 }}>
                  {report
                    ? `${report.totalSamples} actions recorded · ${report.bettingSamples} bets · ${report.passiveSamples} passive`
                    : 'Loading…'
                  }
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                style={{
                  width: 32, height: 32, borderRadius: '50%',
                  border: 'none', background: 'rgba(255,255,255,0.1)',
                  color: '#9cb3d0', fontSize: 16, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700,
                }}
              >×</button>
            </div>

            {/* Notice */}
            <div style={{
              padding: '10px 18px 6px',
              fontSize: 11, color: '#4a6a8a', lineHeight: 1.5,
              flexShrink: 0,
            }}>
              Patterns detected only after 5+ samples per action type. Single occurrences are ignored.
            </div>

            {/* Tell list */}
            <div style={{ overflowY: 'auto', padding: '6px 18px 32px', flex: 1 }}>
              {!report && (
                <div style={{ color: '#4a6a8a', fontSize: 13, textAlign: 'center', paddingTop: 20 }}>Loading tell data…</div>
              )}
              {report && report.totalSamples === 0 && (
                <div style={{ color: '#4a6a8a', fontSize: 13, textAlign: 'center', paddingTop: 20 }}>
                  No data yet — play some hands to build your profile.
                </div>
              )}
              {report && report.tells.map(tell => (
                <TellCard key={tell.id} tell={tell} />
              ))}
              {report && report.tells.length === 0 && report.totalSamples > 0 && (
                <div style={{ color: '#4a6a8a', fontSize: 13, textAlign: 'center', paddingTop: 20 }}>
                  Still collecting data — keep playing.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
