import { useEffect, useRef, useState } from 'react';
import { tellDetector } from './analysis/TellDetector';

const STRENGTH_COLOR = {
  strong:   { bg: 'rgba(255,75,75,0.14)',  border: 'rgba(255,75,75,0.4)',  text: '#ff7070', label: 'STRONG' },
  moderate: { bg: 'rgba(255,155,50,0.14)', border: 'rgba(255,155,50,0.4)', text: '#ffaa44', label: 'MODERATE' },
  weak:     { bg: 'rgba(77,201,167,0.10)', border: 'rgba(77,201,167,0.28)',text: '#4dc9a7', label: 'WEAK' },
};

const CAT_ORDER = ['Value/Bluff', 'Strong Hand', 'Eyes', 'Brows', 'Mouth', 'Face', 'Head', 'Folding'];

function TellCard({ tell }) {
  if (!tell.hasData) {
    const pct = Math.min(1, (tell.aSamples + tell.bSamples) / (tell.samplesNeeded * 4));
    return (
      <div style={card('rgba(255,255,255,0.03)', 'rgba(255,255,255,0.06)')}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
          <span style={{ fontSize:12, fontWeight:700, color:'#6a8aaa' }}>{tell.icon} {tell.name}</span>
          <span style={{ fontSize:9, color:'#3a5a7a', fontWeight:700, letterSpacing:'0.08em' }}>LEARNING</span>
        </div>
        <div style={{ height:3, borderRadius:2, background:'rgba(255,255,255,0.05)', overflow:'hidden', marginBottom:5 }}>
          <div style={{ height:'100%', width:`${pct*100}%`, background:'#1e4a7a', borderRadius:2, transition:'width 0.5s' }} />
        </div>
        <div style={{ fontSize:10, color:'#3a5a7a' }}>
          Need {tell.samplesNeeded} more samples — keep playing
        </div>
      </div>
    );
  }

  const col = STRENGTH_COLOR[tell.strength] || STRENGTH_COLOR.weak;
  const bar = Math.min(1, Math.abs(tell.d) / 1.4);
  const dir = tell.d > 0.18 ? '▲ higher in group A' : tell.d < -0.18 ? '▼ lower in group A' : '≈ similar';

  return (
    <div style={card(col.bg, col.border)}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
        <span style={{ fontSize:12, fontWeight:700, color:'#edf2ff' }}>{tell.icon} {tell.name}</span>
        <span style={{ fontSize:9, fontWeight:800, color:col.text, letterSpacing:'0.08em' }}>{col.label}</span>
      </div>
      <div style={{ fontSize:11, color:'#8aaecc', lineHeight:1.55, marginBottom:6 }}>{tell.description}</div>
      <div style={{ height:3, borderRadius:2, background:'rgba(255,255,255,0.06)', overflow:'hidden', marginBottom:5 }}>
        <div style={{ height:'100%', width:`${bar*100}%`, background:col.text, borderRadius:2, transition:'width 0.4s' }} />
      </div>
      <div style={{ fontSize:9, color:'#3a5a7a', display:'flex', justifyContent:'space-between' }}>
        <span>{dir}</span>
        <span>{tell.aSamples} vs {tell.bSamples} samples</span>
      </div>
    </div>
  );
}

function card(bg, border) {
  return { background:bg, border:`1px solid ${border}`, borderRadius:13, padding:'11px 13px', marginBottom:8 };
}

function StatRow({ label, value, sub }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', padding:'4px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontSize:11, color:'#5a7a9a' }}>{label}</span>
      <div style={{ textAlign:'right' }}>
        <span style={{ fontSize:13, fontWeight:700, color:'#ccd8ee' }}>{value}</span>
        {sub && <span style={{ fontSize:10, color:'#3a5a7a', marginLeft:5 }}>{sub}</span>}
      </div>
    </div>
  );
}

export default function TellsPanel() {
  const [open, setOpen]     = useState(false);
  const [tab,  setTab]      = useState('tells'); // 'tells' | 'stats'
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
  const catEntries  = report
    ? CAT_ORDER.filter(c => report.byCategory?.[c]?.length).map(c => [c, report.byCategory[c]])
    : [];

  return (
    <>
      <button onClick={() => setOpen(true)} style={{
        padding: '3px 10px', borderRadius:999,
        border: strongCount > 0 ? '1px solid rgba(255,75,75,0.5)' : '1px solid rgba(255,255,255,0.12)',
        background: strongCount > 0 ? 'rgba(255,75,75,0.14)' : 'rgba(255,255,255,0.07)',
        color: strongCount > 0 ? '#ff8888' : '#9cb3d0',
        fontSize:11, fontWeight:700, cursor:'pointer',
        letterSpacing:'0.06em', textTransform:'uppercase',
      }}>
        {strongCount > 0 ? `⚠ ${strongCount} Tell${strongCount > 1 ? 's' : ''}` : '📊 Tells'}
      </button>

      {open && (
        <div
          style={{ position:'fixed', inset:0, zIndex:2000, background:'rgba(0,0,0,0.65)', backdropFilter:'blur(6px)', display:'flex', alignItems:'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div style={{ width:'100%', maxHeight:'82vh', background:'#07111c', borderTop:'1px solid rgba(255,255,255,0.1)', borderRadius:'22px 22px 0 0', display:'flex', flexDirection:'column', overflow:'hidden' }}>

            {/* Header */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'15px 18px 10px', borderBottom:'1px solid rgba(255,255,255,0.07)', flexShrink:0 }}>
              <div>
                <div style={{ fontSize:16, fontWeight:800, color:'#edf2ff' }}>Tell Analysis</div>
                <div style={{ fontSize:10, color:'#3a5a7a', marginTop:2 }}>
                  {report ? `${report.totalSamples} resolved actions · ${report.valueSamples} value · ${report.bluffSamples} bluff` : 'Loading…'}
                </div>
              </div>
              <button onClick={() => setOpen(false)} style={{ width:30, height:30, borderRadius:'50%', border:'none', background:'rgba(255,255,255,0.09)', color:'#9cb3d0', fontSize:15, cursor:'pointer', fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
            </div>

            {/* Tabs */}
            <div style={{ display:'flex', padding:'8px 18px 0', gap:8, flexShrink:0 }}>
              {['tells','stats'].map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  flex:1, padding:'7px 0', borderRadius:10, border:'none', cursor:'pointer', fontSize:12, fontWeight:700,
                  background: tab === t ? 'rgba(77,201,167,0.18)' : 'rgba(255,255,255,0.05)',
                  color: tab === t ? '#4dc9a7' : '#5a7a9a',
                  textTransform:'uppercase', letterSpacing:'0.07em',
                }}>
                  {t === 'tells' ? '🔍 Patterns' : '📈 Stats'}
                </button>
              ))}
            </div>

            {/* Disclaimer */}
            <div style={{ padding:'8px 18px 2px', fontSize:10, color:'#2a4a6a', lineHeight:1.5, flexShrink:0 }}>
              Minimum 5 samples per comparison group. Single events are ignored — only repeated patterns are flagged.
            </div>

            {/* Content */}
            <div style={{ overflowY:'auto', padding:'6px 18px 36px', flex:1 }}>

              {tab === 'tells' && (
                <>
                  {!report && <div style={{ color:'#3a5a7a', fontSize:12, textAlign:'center', paddingTop:20 }}>Loading…</div>}
                  {report?.totalSamples === 0 && (
                    <div style={{ color:'#3a5a7a', fontSize:12, textAlign:'center', paddingTop:20 }}>
                      No data yet — play some hands with camera active.
                    </div>
                  )}
                  {catEntries.map(([cat, catTells]) => (
                    <div key={cat}>
                      <div style={{ fontSize:10, fontWeight:800, color:'#2a4a6a', letterSpacing:'0.12em', textTransform:'uppercase', margin:'12px 0 6px' }}>
                        {cat}
                      </div>
                      {catTells.map(tell => <TellCard key={tell.id} tell={tell} />)}
                    </div>
                  ))}
                  {report && catEntries.length === 0 && report.totalSamples > 0 && (
                    <div style={{ color:'#3a5a7a', fontSize:12, textAlign:'center', paddingTop:20 }}>
                      Still building your profile — keep playing.
                    </div>
                  )}
                </>
              )}

              {tab === 'stats' && report && (
                <div style={{ paddingTop:4 }}>
                  <div style={{ fontSize:10, fontWeight:800, color:'#2a4a6a', letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:8 }}>Action Breakdown</div>
                  <StatRow label="Total resolved actions" value={report.totalSamples} />
                  <StatRow label="Bets / Raises" value={report.bettingSamples} />
                  <StatRow label="Checks / Calls" value={report.passiveSamples} />
                  <StatRow label="Folds" value={report.foldSamples} />

                  <div style={{ fontSize:10, fontWeight:800, color:'#2a4a6a', letterSpacing:'0.12em', textTransform:'uppercase', margin:'14px 0 8px' }}>Bet Outcomes</div>
                  <StatRow label="Value bets (won)" value={report.valueSamples} />
                  <StatRow label="Bluffs (lost)" value={report.bluffSamples} />
                  {report.bettingSamples > 0 && (
                    <StatRow
                      label="Bluff frequency"
                      value={`${Math.round((report.bluffSamples / report.bettingSamples) * 100)}%`}
                      sub="of your bets/raises"
                    />
                  )}

                  <div style={{ fontSize:10, fontWeight:800, color:'#2a4a6a', letterSpacing:'0.12em', textTransform:'uppercase', margin:'14px 0 8px' }}>Tell Summary</div>
                  {['strong','moderate','weak'].map(s => {
                    const n = report.tells.filter(t => t.hasData && t.strength === s).length;
                    const col = STRENGTH_COLOR[s]?.text || '#fff';
                    return <StatRow key={s} label={`${s.charAt(0).toUpperCase()+s.slice(1)} tells`} value={<span style={{ color:col }}>{n}</span>} />;
                  })}
                  <StatRow label="Still learning" value={report.tells.filter(t => !t.hasData).length} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
