import { useEffect, useRef, useState } from 'react';
import { PokerGame } from './game/engine';

const SUITS = {
  h: { symbol: '♥', color: '#d42b2b' },
  d: { symbol: '♦', color: '#d42b2b' },
  c: { symbol: '♣', color: '#222' },
  s: { symbol: '♠', color: '#222' },
};

function Card({ card, hidden, glowing, small }) {
  const isHidden = hidden || !card || card === '??';
  const suit = isHidden ? null : card[1];
  const rank = isHidden ? null : card[0];
  const suitInfo = SUITS[suit] || { symbol: suit, color: '#000' };
  const w = small ? 54 : 64;
  const h = small ? 76 : 90;

  const style = {
    width: w,
    height: h,
    borderRadius: small ? 10 : 13,
    border: '1px solid rgba(255,255,255,0.16)',
    background: isHidden ? 'linear-gradient(180deg, #18304e 0%, #0f1d32 100%)' : '#fbfbfb',
    color: isHidden ? '#fff' : '#111',
    boxShadow: glowing ? '0 0 14px rgba(255,209,71,0.65)' : '0 6px 16px rgba(0,0,0,0.28)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: small ? 6 : 8,
    opacity: card ? 1 : 0.35,
    overflow: 'hidden',
    flexShrink: 0,
  };

  const backPattern = {
    backgroundImage:
      'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.14) 0, rgba(255,255,255,0.02) 12%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.16) 0, rgba(255,255,255,0.04) 10%)',
  };

  return (
    <div style={isHidden ? { ...style, ...backPattern } : style}>
      {isHidden ? (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: small ? 20 : 26 }}>♠</div>
      ) : (
        <>
          <span style={{ color: suitInfo.color, fontSize: small ? 13 : 16, fontWeight: 700 }}>{rank}</span>
          <span style={{ color: suitInfo.color, fontSize: small ? 24 : 30, textAlign: 'center' }}>{suitInfo.symbol}</span>
          <span style={{ color: suitInfo.color, fontSize: small ? 13 : 16, fontWeight: 700, alignSelf: 'flex-end' }}>{rank}</span>
        </>
      )}
    </div>
  );
}

function App() {
  const engineRef = useRef(new PokerGame());
  const nextHandTimer = useRef(null);
  const botTimer = useRef(null);
  const dealTimer = useRef(null);
  const [gameState, setGameState] = useState(null);
  const [message, setMessage] = useState('Dealing new hand…');
  const [error, setError] = useState(null);
  const [wagerAmount, setWagerAmount] = useState(engineRef.current.bigBlind);
  const [botThinking, setBotThinking] = useState(false);
  const [dealStep, setDealStep] = useState(0);
  const [isDealing, setIsDealing] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  const syncState = () => {
    const state = engineRef.current.getState();
    state.availableActions = engineRef.current.getAvailableActions(state.toAct);
    setGameState(state);
  };

  const startNewHand = (rebuy = false) => {
    if (nextHandTimer.current) { window.clearTimeout(nextHandTimer.current); nextHandTimer.current = null; }
    if (rebuy) {
      engineRef.current.resetMatch();
      setMessage('Stacks reset — new hand.');
    } else {
      setMessage('Dealing…');
    }
    engineRef.current.startHand();
    setWagerAmount(engineRef.current.bigBlind);
    setIsDealing(true);
    setDealStep(0);
    syncState();
  };

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(media.matches);
    const listener = (e) => setReducedMotion(e.matches);
    media.addEventListener('change', listener);
    startNewHand();
    return () => media.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    if (!gameState || !isDealing) return;
    const delay = reducedMotion ? 120 : 240;
    if (dealStep >= 4) {
      setIsDealing(false);
      setMessage(gameState.toAct === 'player' ? 'Your turn.' : 'Bot is thinking…');
      return;
    }
    dealTimer.current = window.setTimeout(() => setDealStep((s) => s + 1), delay);
    return () => { if (dealTimer.current) window.clearTimeout(dealTimer.current); };
  }, [dealStep, gameState, isDealing, reducedMotion]);

  useEffect(() => {
    if (!gameState || gameState.winner || isDealing) return;
    if (gameState.toAct !== 'bot') return;
    setBotThinking(true);
    setMessage('Bot is thinking…');
    botTimer.current = window.setTimeout(() => {
      const botDecision = engineRef.current.botAction();
      if (botDecision) {
        const { action, amount } = botDecision;
        if (action === 'fold' || action === 'check') {
          setMessage(`Bot ${action}.`);
        } else {
          setMessage(`Bot ${action} ${amount}.`);
        }
      }
      setBotThinking(false);
      syncState();
    }, reducedMotion ? 800 : 1600);
    return () => { if (botTimer.current) window.clearTimeout(botTimer.current); };
  }, [gameState?.toAct, gameState?.winner, isDealing, reducedMotion]);

  useEffect(() => {
    if (!gameState || !gameState.winner) return;
    nextHandTimer.current = window.setTimeout(() => {
      const rebuy = gameState.playerStack <= 0 || gameState.botStack <= 0;
      startNewHand(rebuy);
    }, reducedMotion ? 1200 : 2000);
    return () => { if (nextHandTimer.current) window.clearTimeout(nextHandTimer.current); };
  }, [gameState?.winner, reducedMotion]);

  const finishHand = () => {
    const state = engineRef.current.getState();
    const result = state.handLog?.result;
    const { playerStack, botStack } = state;
    if (!result) return;
    let msg = '';
    if (result.method === 'fold') {
      msg = `${result.winner === 'player' ? 'You win' : 'Bot wins'} by fold.`;
    } else {
      const winnerText = result.winner === 'player' ? 'You win' : result.winner === 'bot' ? 'Bot wins' : 'Split pot';
      msg = `${winnerText} — ${result.playerHand?.name ?? 'showdown'}.`;
    }
    if (playerStack <= 0 || botStack <= 0) msg += ' Rebuy incoming.';
    setMessage(msg);
  };

  const handlePlayerAction = (action, amount = wagerAmount) => {
    const isPlayerTurn = gameState?.toAct === 'player' && !botThinking && !isDealing && !gameState?.winner;
    if (!isPlayerTurn) return;
    const success = engineRef.current.playerAction(action, amount);
    if (success === false) return;
    if (action === 'fold' || action === 'check') {
      setMessage(`You ${action}.`);
    } else {
      setMessage(`You ${action} ${amount}.`);
    }
    syncState();
    if (engineRef.current.winner) finishHand();
  };

  if (error) return <div style={errorScreenStyle}>Error: {error}</div>;
  if (!gameState) return <div style={loadingStyle}>Loading…</div>;

  const callAmount = Math.max(gameState.currentBet - gameState.playerCommit, 0);
  const minWager = Math.max(engineRef.current.bigBlind, callAmount || engineRef.current.bigBlind);
  const maxWager = Math.max(0, gameState.playerStack);
  const actionDisabled = !(gameState.toAct === 'player' && !botThinking && !isDealing && !gameState.winner);
  const displayedCommunity = [...gameState.community, null, null, null, null, null].slice(0, 5);

  return (
    <div style={pageStyle}>
      {/* Top bar */}
      <div style={topBarStyle}>
        <div style={titleStyle}>Heads-Up Poker</div>
        <div style={metaRowStyle}>
          <span style={metaChipStyle}>Hand {gameState.handNumber}</span>
          <span style={metaChipStyle}>{gameState.street}</span>
        </div>
      </div>

      {/* Game area */}
      <div style={gameAreaStyle}>
        {/* Bot panel */}
        <div style={playerPanelStyle(gameState.winner === 'bot')}>
          <div style={panelHeaderStyle}>
            <span style={panelNameStyle}>Bot</span>
            <span style={stackStyle}>{gameState.botStack} chips</span>
          </div>
          <div style={cardRowStyle}>
            {gameState.botHole.map((card, i) => (
              <Card key={i} card={card} hidden={!gameState.winner} glowing={gameState.winner === 'bot'} />
            ))}
          </div>
          <div style={panelStatusStyle}>
            {gameState.toAct === 'bot' && !gameState.winner ? 'Thinking…' : 'Waiting'}
          </div>
        </div>

        {/* Board */}
        <div style={boardAreaStyle}>
          <div style={potRowStyle}>
            <span style={pillStyle}>Pot: {gameState.pot}</span>
            {gameState.currentBet > 0 && <span style={pillStyle}>Bet: {gameState.currentBet}</span>}
          </div>
          <div style={communityRowStyle}>
            {displayedCommunity.map((card, i) => (
              <div key={i} style={boardCardContainerStyle(i, !!card, reducedMotion)}>
                <Card card={card || '??'} hidden={!card} glowing={false} small />
              </div>
            ))}
          </div>
          <div style={messageStyle}>{message}</div>
        </div>

        {/* Player panel */}
        <div style={playerPanelStyle(gameState.winner === 'player')}>
          <div style={panelHeaderStyle}>
            <span style={panelNameStyle}>You</span>
            <span style={stackStyle}>{gameState.playerStack} chips</span>
          </div>
          <div style={cardRowStyle}>
            {gameState.playerHole.map((card, i) => (
              <Card key={i} card={card} hidden={false} glowing={gameState.winner === 'player'} />
            ))}
          </div>
          <div style={panelStatusStyle}>Your cards are live.</div>
        </div>
      </div>

      {/* Action bar */}
      <div style={actionBarStyle(actionDisabled)}>
        <div style={sliderRowStyle}>
          <span style={sliderLabelStyle}>Raise</span>
          <input
            type="range"
            min={minWager}
            max={maxWager}
            value={wagerAmount}
            disabled={actionDisabled}
            onChange={(e) => setWagerAmount(Math.max(minWager, Number(e.target.value) || minWager))}
            style={sliderStyle(actionDisabled)}
          />
          <span style={wagerValueStyle}>{wagerAmount}</span>
        </div>
        <div style={buttonRowStyle}>
          <button style={btnStyle('#b84040', actionDisabled)} disabled={actionDisabled} onClick={() => handlePlayerAction('fold')}>
            Fold
          </button>
          <button style={btnStyle('#2c6e8a', actionDisabled)} disabled={actionDisabled}
            onClick={() => handlePlayerAction(callAmount === 0 ? 'check' : 'call', callAmount === 0 ? undefined : callAmount)}>
            {callAmount === 0 ? 'Check' : `Call ${callAmount}`}
          </button>
          {gameState.availableActions.includes('bet') && (
            <button style={btnStyle('#3a8a5c', actionDisabled)} disabled={actionDisabled} onClick={() => handlePlayerAction('bet', wagerAmount)}>
              Bet {wagerAmount}
            </button>
          )}
          {gameState.availableActions.includes('raise') && (
            <button style={btnStyle('#3a8a5c', actionDisabled)} disabled={actionDisabled} onClick={() => handlePlayerAction('raise', wagerAmount)}>
              Raise {wagerAmount}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const pageStyle = {
  height: '100dvh',
  background: 'linear-gradient(180deg, #071116 0%, #0c1f33 100%)',
  color: '#edf2ff',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxSizing: 'border-box',
};

const topBarStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 16px 8px',
  borderBottom: '1px solid rgba(255,255,255,0.07)',
  flexShrink: 0,
};

const titleStyle = {
  fontSize: 18,
  fontWeight: 800,
  letterSpacing: '-0.03em',
};

const metaRowStyle = {
  display: 'flex',
  gap: 6,
};

const metaChipStyle = {
  fontSize: 11,
  fontWeight: 600,
  background: 'rgba(255,255,255,0.08)',
  borderRadius: 999,
  padding: '3px 10px',
  color: '#9cb3d0',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const gameAreaStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  padding: '8px 12px',
  gap: 8,
  overflow: 'hidden',
};

const playerPanelStyle = (glow) => ({
  borderRadius: 18,
  padding: '10px 14px 8px',
  background: 'rgba(255,255,255,0.04)',
  border: glow ? '1px solid rgba(255, 210, 73, 0.7)' : '1px solid rgba(255,255,255,0.08)',
  boxShadow: glow ? '0 0 18px rgba(255, 210, 73, 0.2)' : 'none',
  flexShrink: 0,
});

const panelHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 8,
};

const panelNameStyle = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: '#b0c3de',
};

const stackStyle = {
  fontSize: 12,
  color: '#9ab1d2',
};

const panelStatusStyle = {
  marginTop: 6,
  fontSize: 11,
  color: '#7a96b8',
  textAlign: 'center',
};

const cardRowStyle = {
  display: 'flex',
  gap: 10,
  justifyContent: 'center',
};

const boardAreaStyle = {
  flex: 1,
  borderRadius: 18,
  background: 'radial-gradient(circle at center, rgba(80, 121, 84, 0.15), rgba(9, 17, 30, 0.9) 60%)',
  border: '1px solid rgba(255,255,255,0.08)',
  padding: '10px 12px 8px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

const potRowStyle = {
  display: 'flex',
  gap: 8,
  justifyContent: 'center',
  flexWrap: 'wrap',
};

const pillStyle = {
  padding: '4px 12px',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.07)',
  color: '#f5f8ff',
  fontSize: 12,
  fontWeight: 700,
};

const communityRowStyle = {
  display: 'flex',
  gap: 6,
  justifyContent: 'center',
  flexWrap: 'nowrap',
};

const boardCardContainerStyle = (index, active, reducedMotion) => ({
  transform: active ? 'translateY(0)' : 'translateY(10px)',
  transition: reducedMotion ? 'none' : `transform 240ms ease ${index * 55}ms, opacity 240ms ease ${index * 55}ms`,
  opacity: active ? 1 : 0.3,
});

const messageStyle = {
  fontSize: 13,
  color: '#dce8ff',
  textAlign: 'center',
  lineHeight: 1.4,
};

const actionBarStyle = (disabled) => ({
  flexShrink: 0,
  padding: '10px 12px 28px',
  borderTop: '1px solid rgba(255,255,255,0.08)',
  background: disabled ? 'rgba(4, 9, 18, 0.96)' : 'rgba(8, 17, 35, 0.98)',
  backdropFilter: 'blur(14px)',
  opacity: disabled ? 0.8 : 1,
  transition: 'opacity 200ms ease',
});

const sliderRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 10,
};

const sliderLabelStyle = {
  fontSize: 11,
  color: '#7a96b8',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  flexShrink: 0,
};

const sliderStyle = (disabled) => ({
  flex: 1,
  accentColor: '#4dc9a7',
  opacity: disabled ? 0.4 : 1,
  cursor: disabled ? 'not-allowed' : 'pointer',
  height: 20,
});

const wagerValueStyle = {
  minWidth: 40,
  textAlign: 'center',
  fontSize: 13,
  fontWeight: 700,
  color: '#eef5ff',
  flexShrink: 0,
};

const buttonRowStyle = {
  display: 'flex',
  gap: 8,
};

const btnStyle = (color, disabled) => ({
  flex: 1,
  padding: '12px 4px',
  borderRadius: 14,
  border: 'none',
  background: disabled ? 'rgba(255,255,255,0.07)' : color,
  color: disabled ? '#5a7094' : '#fff',
  fontWeight: 700,
  fontSize: 14,
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'background 160ms ease',
});

const loadingStyle = {
  height: '100dvh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 16,
  color: '#c8d7ef',
  background: '#071018',
};

const errorScreenStyle = {
  height: '100dvh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  color: '#f27878',
  background: '#120f16',
};

export default App;
