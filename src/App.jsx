import { useEffect, useRef, useState } from 'react';
import { PokerGame } from './game/engine';

const SUITS = {
  h: { symbol: '♥', color: '#d42b2b' },
  d: { symbol: '♦', color: '#d42b2b' },
  c: { symbol: '♣', color: '#222' },
  s: { symbol: '♠', color: '#222' },
};

// ─── Sound ───────────────────────────────────────────────────────────────────
let audioCtx = null;
function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window['webkitAudioContext'])();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function tone(ctx, freq, start, dur, vol = 0.28, type = 'sine') {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + dur + 0.01);
}
function playSound(type) {
  try {
    const ctx = getCtx();
    if (type === 'win') {
      tone(ctx, 523, 0,    0.25);
      tone(ctx, 659, 0.13, 0.25);
      tone(ctx, 784, 0.26, 0.45);
      tone(ctx, 1046,0.38, 0.5, 0.2);
    } else if (type === 'lose') {
      tone(ctx, 392, 0,    0.3);
      tone(ctx, 311, 0.18, 0.35);
      tone(ctx, 220, 0.38, 0.55, 0.32);
    } else if (type === 'fold') {
      tone(ctx, 220, 0,    0.08, 0.4, 'triangle');
      tone(ctx, 160, 0.06, 0.18, 0.25, 'triangle');
    }
  } catch (_) {}
}

// ─── Card component ───────────────────────────────────────────────────────────
function Card({ card, hidden, glowing, small }) {
  const isHidden = hidden || !card || card === '??';
  const suit = isHidden ? null : card[1];
  const rank = isHidden ? null : card[0];
  const suitInfo = SUITS[suit] || { symbol: suit, color: '#000' };
  const w = small ? 54 : 64;
  const h = small ? 76 : 90;

  const style = {
    width: w, height: h,
    borderRadius: small ? 10 : 13,
    border: '1px solid rgba(255,255,255,0.16)',
    background: isHidden ? 'linear-gradient(180deg,#18304e,#0f1d32)' : '#fbfbfb',
    boxShadow: glowing ? '0 0 14px rgba(255,209,71,0.65)' : '0 6px 16px rgba(0,0,0,0.28)',
    display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    padding: small ? 6 : 8,
    opacity: card ? 1 : 0.35,
    overflow: 'hidden', flexShrink: 0,
  };
  const backPattern = {
    backgroundImage:
      'radial-gradient(circle at 20% 20%,rgba(255,255,255,0.14) 0,rgba(255,255,255,0.02) 12%),radial-gradient(circle at 80% 80%,rgba(255,255,255,0.16) 0,rgba(255,255,255,0.04) 10%)',
  };

  return (
    <div style={isHidden ? { ...style, ...backPattern } : style}>
      {isHidden ? (
        <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize: small?20:26 }}>♠</div>
      ) : (
        <>
          <span style={{ color: suitInfo.color, fontSize: small?13:16, fontWeight:700 }}>{rank}</span>
          <span style={{ color: suitInfo.color, fontSize: small?24:30, textAlign:'center' }}>{suitInfo.symbol}</span>
          <span style={{ color: suitInfo.color, fontSize: small?13:16, fontWeight:700, alignSelf:'flex-end' }}>{rank}</span>
        </>
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const engineRef    = useRef(new PokerGame());
  const nextHandTimer = useRef(null);
  const botTimer      = useRef(null);
  const dealTimer     = useRef(null);

  const [gameState,     setGameState]     = useState(null);
  const [message,       setMessage]       = useState('Dealing…');
  const [wagerAmount,   setWagerAmount]   = useState(engineRef.current.bigBlind);
  const [botThinking,   setBotThinking]   = useState(false);
  const [dealStep,      setDealStep]      = useState(0);
  const [isDealing,     setIsDealing]     = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [raiseMode,     setRaiseMode]     = useState(false);
  const [raiseAction,   setRaiseAction]   = useState('raise'); // 'bet' | 'raise'

  const BB = engineRef.current.bigBlind;

  const syncState = () => {
    const state = engineRef.current.getState();
    state.availableActions = engineRef.current.getAvailableActions(state.toAct);
    setGameState(state);
  };

  const startNewHand = (rebuy = false) => {
    if (nextHandTimer.current) { clearTimeout(nextHandTimer.current); nextHandTimer.current = null; }
    engineRef.current[rebuy ? 'resetMatch' : 'startHand'] && (rebuy ? engineRef.current.resetMatch() : null);
    if (rebuy) { engineRef.current.resetMatch(); setMessage('Stacks reset — new hand.'); }
    else { setMessage('Dealing…'); }
    engineRef.current.startHand();
    setWagerAmount(BB);
    setIsDealing(true);
    setDealStep(0);
    setRaiseMode(false);
    syncState();
  };

  // init
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(media.matches);
    const l = (e) => setReducedMotion(e.matches);
    media.addEventListener('change', l);
    startNewHand();
    return () => media.removeEventListener('change', l);
  }, []);

  // deal animation
  useEffect(() => {
    if (!gameState || !isDealing) return;
    if (dealStep >= 4) {
      setIsDealing(false);
      setMessage(gameState.toAct === 'player' ? 'Your turn.' : 'Bot is thinking…');
      return;
    }
    dealTimer.current = setTimeout(() => setDealStep(s => s + 1), reducedMotion ? 120 : 240);
    return () => clearTimeout(dealTimer.current);
  }, [dealStep, gameState, isDealing, reducedMotion]);

  // bot turn
  useEffect(() => {
    if (!gameState || gameState.winner || isDealing || gameState.toAct !== 'bot') return;
    setBotThinking(true);
    setMessage('Bot is thinking…');
    botTimer.current = setTimeout(() => {
      const d = engineRef.current.botAction();
      if (d) {
        const { action, amount } = d;
        setMessage(action === 'fold' || action === 'check' ? `Bot ${action}.` : `Bot ${action} ${amount}.`);
      }
      setBotThinking(false);
      syncState();
    }, reducedMotion ? 800 : 1600);
    return () => clearTimeout(botTimer.current);
  }, [gameState?.toAct, gameState?.winner, isDealing, reducedMotion]);

  // winner → sound + next hand
  useEffect(() => {
    if (!gameState?.winner) return;
    const result = engineRef.current.getState().handLog?.result;
    if (gameState.winner === 'player') playSound('win');
    else if (result?.method === 'fold') playSound('fold'); // player folded
    else playSound('lose');

    nextHandTimer.current = setTimeout(() => {
      startNewHand(gameState.playerStack <= 0 || gameState.botStack <= 0);
    }, reducedMotion ? 1200 : 2000);
    return () => clearTimeout(nextHandTimer.current);
  }, [gameState?.winner, reducedMotion]);

  // reset raise mode when turn changes
  useEffect(() => {
    const disabled = !(gameState?.toAct === 'player' && !botThinking && !isDealing && !gameState?.winner);
    if (disabled) setRaiseMode(false);
  }, [gameState?.toAct, botThinking, isDealing, gameState?.winner]);

  const finishHand = () => {
    const result = engineRef.current.getState().handLog?.result;
    if (!result) return;
    let msg = result.method === 'fold'
      ? `${result.winner === 'player' ? 'You win' : 'Bot wins'} by fold.`
      : `${result.winner === 'player' ? 'You win' : result.winner === 'bot' ? 'Bot wins' : 'Split pot'} — ${result.playerHand?.name ?? 'showdown'}.`;
    const { playerStack, botStack } = engineRef.current.getState();
    if (playerStack <= 0 || botStack <= 0) msg += ' Rebuy incoming.';
    setMessage(msg);
  };

  const handlePlayerAction = (action, amount = wagerAmount) => {
    if (!(gameState?.toAct === 'player' && !botThinking && !isDealing && !gameState?.winner)) return;
    const success = engineRef.current.playerAction(action, amount);
    if (success === false) return;
    setMessage(action === 'fold' || action === 'check' ? `You ${action}.` : `You ${action} ${amount}.`);
    setRaiseMode(false);
    syncState();
    if (engineRef.current.winner) finishHand();
  };

  if (!gameState) {
    return <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center', background:'#071116', color:'#c8d7ef', fontSize:16 }}>Loading…</div>;
  }

  const callAmount    = Math.max(gameState.currentBet - gameState.playerCommit, 0);
  const minWager      = Math.max(BB, callAmount || BB);
  const maxWager      = Math.max(0, gameState.playerStack);
  const actionDisabled = !(gameState.toAct === 'player' && !botThinking && !isDealing && !gameState.winner);
  const community     = [...gameState.community, null, null, null, null, null].slice(0, 5);
  const hasBet        = gameState.availableActions.includes('bet');
  const hasRaise      = gameState.availableActions.includes('raise');

  return (
    <div style={page}>
      {/* ── Top bar ── */}
      <div style={topBar}>
        <span style={titleTxt}>Heads-Up Poker</span>
        <div style={metaRow}>
          <span style={chip}>Hand {gameState.handNumber}</span>
          <span style={chip}>{gameState.street}</span>
        </div>
      </div>

      {/* ── Game area ── */}
      <div style={gameArea}>
        {/* Bot */}
        <div style={panel(gameState.winner === 'bot')}>
          <div style={panelHead}>
            <span style={panelName}>Bot</span>
            <span style={stackTxt}>{gameState.botStack} chips</span>
          </div>
          <div style={cardRow}>
            {gameState.botHole.map((c, i) => (
              <Card key={i} card={c} hidden={!gameState.winner} glowing={gameState.winner === 'bot'} />
            ))}
          </div>
          <div style={statusTxt}>
            {gameState.toAct === 'bot' && !gameState.winner ? 'Thinking…' : 'Waiting'}
          </div>
        </div>

        {/* Board */}
        <div style={board}>
          <div style={potRow}>
            <span style={pill}>Pot: {gameState.pot}</span>
            {gameState.currentBet > 0 && <span style={pill}>Bet: {gameState.currentBet}</span>}
          </div>
          <div style={communityRow}>
            {community.map((c, i) => (
              <div key={i} style={cardSlot(i, !!c, reducedMotion)}>
                <Card card={c || '??'} hidden={!c} glowing={false} small />
              </div>
            ))}
          </div>
          <div style={msgTxt}>{message}</div>
        </div>

        {/* Player */}
        <div style={panel(gameState.winner === 'player')}>
          <div style={panelHead}>
            <span style={panelName}>You</span>
            <span style={stackTxt}>{gameState.playerStack} chips</span>
          </div>
          <div style={cardRow}>
            {gameState.playerHole.map((c, i) => (
              <Card key={i} card={c} hidden={false} glowing={gameState.winner === 'player'} />
            ))}
          </div>
          <div style={statusTxt}>Your cards are live.</div>
        </div>
      </div>

      {/* ── Action bar ── */}
      <div style={actionBar(actionDisabled)}>
        {raiseMode ? (
          /* ── Raise mode ── */
          <>
            <div style={sliderRow}>
              <input
                type="range"
                min={minWager} max={maxWager} value={wagerAmount}
                onChange={e => setWagerAmount(Math.max(minWager, Number(e.target.value) || minWager))}
                style={slider}
              />
              <span style={wagerVal}>{wagerAmount}</span>
            </div>
            <div style={btnRow}>
              <button style={btn('#334', false, 'auto')} onClick={() => setRaiseMode(false)}>← Back</button>
              <button style={btn('#334', wagerAmount <= minWager, 36)}
                onClick={() => setWagerAmount(a => Math.max(minWager, a - BB))}>−{BB}</button>
              <span style={raiseCtr}>{wagerAmount}</span>
              <button style={btn('#334', wagerAmount >= maxWager, 36)}
                onClick={() => setWagerAmount(a => Math.min(maxWager, a + BB))}>+{BB}</button>
              <button style={btn('#3a8a5c', false, 'auto')}
                onClick={() => handlePlayerAction(raiseAction, wagerAmount)}>
                {raiseAction === 'bet' ? 'Bet' : 'Raise'} {wagerAmount}
              </button>
            </div>
          </>
        ) : (
          /* ── Normal mode ── */
          <div style={btnRow}>
            <button style={btn('#8a3a3a', actionDisabled)} disabled={actionDisabled}
              onClick={() => handlePlayerAction('fold')}>Fold</button>
            <button style={btn('#2c6e8a', actionDisabled)} disabled={actionDisabled}
              onClick={() => handlePlayerAction(callAmount === 0 ? 'check' : 'call', callAmount === 0 ? undefined : callAmount)}>
              {callAmount === 0 ? 'Check' : `Call ${callAmount}`}
            </button>
            {(hasBet || hasRaise) && (
              <button style={btn('#3a8a5c', actionDisabled)} disabled={actionDisabled}
                onClick={() => { setRaiseAction(hasBet ? 'bet' : 'raise'); setRaiseMode(true); }}>
                {hasBet ? 'Bet' : 'Raise'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const page = {
  height: '100%',
  background: 'linear-gradient(180deg,#071116 0%,#0c1f33 100%)',
  color: '#edf2ff',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const topBar = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '10px 16px 8px',
  borderBottom: '1px solid rgba(255,255,255,0.07)',
  flexShrink: 0,
};
const titleTxt = { fontSize: 17, fontWeight: 800, letterSpacing: '-0.03em' };
const metaRow  = { display: 'flex', gap: 6 };
const chip     = {
  fontSize: 11, fontWeight: 600,
  background: 'rgba(255,255,255,0.08)', borderRadius: 999,
  padding: '3px 10px', color: '#9cb3d0',
  textTransform: 'uppercase', letterSpacing: '0.06em',
};

const gameArea = {
  flex: 1, minHeight: 0,
  display: 'flex', flexDirection: 'column',
  padding: '8px 12px', gap: 8,
  overflow: 'hidden',
};

const panel = (glow) => ({
  borderRadius: 18, padding: '10px 14px 8px',
  background: 'rgba(255,255,255,0.04)',
  border: glow ? '1px solid rgba(255,210,73,0.7)' : '1px solid rgba(255,255,255,0.08)',
  boxShadow: glow ? '0 0 18px rgba(255,210,73,0.2)' : 'none',
  flexShrink: 0,
});
const panelHead = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 };
const panelName = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#b0c3de' };
const stackTxt  = { fontSize: 12, color: '#9ab1d2' };
const statusTxt = { marginTop: 6, fontSize: 11, color: '#7a96b8', textAlign: 'center' };
const cardRow   = { display: 'flex', gap: 10, justifyContent: 'center' };

const board = {
  flex: 1, minHeight: 0,
  borderRadius: 18,
  background: 'radial-gradient(circle at center,rgba(80,121,84,0.15),rgba(9,17,30,0.9) 60%)',
  border: '1px solid rgba(255,255,255,0.08)',
  padding: '10px 12px 8px',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 8,
};
const potRow     = { display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' };
const pill       = { padding: '4px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.07)', color: '#f5f8ff', fontSize: 12, fontWeight: 700 };
const communityRow = { display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'nowrap' };
const cardSlot   = (i, active, rm) => ({
  transform: active ? 'translateY(0)' : 'translateY(8px)',
  opacity: active ? 1 : 0.3,
  transition: rm ? 'none' : `transform 240ms ease ${i*55}ms, opacity 240ms ease ${i*55}ms`,
});
const msgTxt = { fontSize: 13, color: '#dce8ff', textAlign: 'center', lineHeight: 1.4 };

const actionBar = (disabled) => ({
  flexShrink: 0,
  padding: '10px 12px',
  paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
  borderTop: '1px solid rgba(255,255,255,0.08)',
  background: disabled ? 'rgba(4,9,18,0.96)' : 'rgba(8,17,35,0.98)',
  backdropFilter: 'blur(14px)',
  opacity: disabled ? 0.75 : 1,
  transition: 'opacity 200ms ease',
});

const sliderRow = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 };
const slider    = { flex: 1, accentColor: '#4dc9a7', height: 20 };
const wagerVal  = { minWidth: 40, textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#eef5ff', flexShrink: 0 };
const raiseCtr  = { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 700, color: '#eef5ff' };

const btnRow = { display: 'flex', gap: 8, alignItems: 'center' };

const btn = (color, disabled, flex = 1) => ({
  flex,
  padding: '13px 10px',
  borderRadius: 14, border: 'none',
  background: disabled ? 'rgba(255,255,255,0.07)' : color,
  color: disabled ? '#5a7094' : '#fff',
  fontWeight: 700, fontSize: 14,
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'background 160ms ease',
  whiteSpace: 'nowrap',
});
