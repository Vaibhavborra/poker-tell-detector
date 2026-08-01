import { useEffect, useRef, useState } from 'react';
import { PokerGame } from './game/engine';

const SUITS = {
  h: { symbol: '♥', color: '#d42b2b' },
  d: { symbol: '♦', color: '#d42b2b' },
  c: { symbol: '♣', color: '#222' },
  s: { symbol: '♠', color: '#222' },
};

function Card({ card, hidden, glowing }) {
  const isHidden = hidden || !card || card === '??';
  const suit = isHidden ? null : card[1];
  const rank = isHidden ? null : card[0];
  const suitInfo = SUITS[suit] || { symbol: suit, color: '#000' };

  const style = {
    width: 74,
    height: 104,
    borderRadius: 16,
    border: '1px solid rgba(255,255,255,0.16)',
    background: isHidden
      ? 'linear-gradient(180deg, #18304e 0%, #0f1d32 100%)'
      : '#fbfbfb',
    color: isHidden ? '#fff' : '#111',
    boxShadow: glowing ? '0 0 18px rgba(255,209,71,0.65)' : '0 18px 40px rgba(0,0,0,0.22)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: 12,
    transition: 'transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease',
    opacity: card ? 1 : 0.35,
    position: 'relative',
    overflow: 'hidden',
  };

  const backPattern = {
    backgroundImage:
      'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.14) 0, rgba(255,255,255,0.02) 12%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.16) 0, rgba(255,255,255,0.04) 10%)',
  };

  return (
    <div style={isHidden ? { ...style, ...backPattern } : style}>
      {isHidden ? (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>♠</div>
      ) : (
        <>
          <span style={{ color: suitInfo.color, fontSize: 18 }}>{rank}</span>
          <span style={{ color: suitInfo.color, fontSize: 34 }}>{suitInfo.symbol}</span>
          <span style={{ color: suitInfo.color, fontSize: 18, alignSelf: 'flex-end' }}>{rank}</span>
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
  const previousPot = useRef(0);
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
    if (nextHandTimer.current) {
      window.clearTimeout(nextHandTimer.current);
      nextHandTimer.current = null;
    }

    if (rebuy) {
      engineRef.current.resetMatch();
      setMessage('Stacks reset after a bust — dealing a fresh hand.');
    } else {
      setMessage('Dealing a fresh hand…');
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
    const listener = (event) => setReducedMotion(event.matches);
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

    dealTimer.current = window.setTimeout(() => setDealStep((step) => step + 1), delay);
    return () => {
      if (dealTimer.current) window.clearTimeout(dealTimer.current);
    };
  }, [dealStep, gameState, isDealing, reducedMotion]);

  useEffect(() => {
    if (!gameState) return;
    if (previousPot.current !== gameState.pot) {
      previousPot.current = gameState.pot;
    }
  }, [gameState?.pot]);

  useEffect(() => {
    if (!gameState || gameState.winner || isDealing) return;
    if (gameState.toAct !== 'bot') return;

    setBotThinking(true);
    setMessage('Bot is thinking…');

    botTimer.current = window.setTimeout(() => {
      const botDecision = engineRef.current.botAction();
      if (botDecision) {
        setMessage(`Bot ${botDecision.action}${botDecision.amount ? ` ${botDecision.amount}` : ''}.`);
      }
      setBotThinking(false);
      syncState();
    }, reducedMotion ? 800 : 1600);

    return () => {
      if (botTimer.current) window.clearTimeout(botTimer.current);
    };
  }, [gameState?.toAct, gameState?.winner, isDealing, reducedMotion]);

  useEffect(() => {
    if (!gameState || !gameState.winner) return;
    nextHandTimer.current = window.setTimeout(() => {
      const rebuy = gameState.playerStack <= 0 || gameState.botStack <= 0;
      startNewHand(rebuy);
    }, reducedMotion ? 1200 : 1800);
    return () => {
      if (nextHandTimer.current) window.clearTimeout(nextHandTimer.current);
    };
  }, [gameState?.winner, reducedMotion]);

  const finishHand = () => {
    const state = engineRef.current.getState();
    const { result, playerStack, botStack } = state;
    if (!result) return;

    let resultMessage = '';
    if (result.method === 'fold') {
      resultMessage = `${result.winner === 'player' ? 'You win' : 'Bot wins'} by fold.`;
    } else {
      const winnerText =
        result.winner === 'player' ? 'You win' : result.winner === 'bot' ? 'Bot wins' : 'Split pot';
      const handName = result.playerHand?.name ?? 'the showdown';
      resultMessage = `${winnerText} with ${handName}.`;
    }

    if (playerStack <= 0 || botStack <= 0) {
      resultMessage += ' A stack busted, rebuy incoming.';
    }
    setMessage(resultMessage);
  };

  const handlePlayerAction = (action, amount = wagerAmount) => {
    const isPlayerTurn = gameState?.toAct === 'player' && !botThinking && !isDealing && !gameState?.winner;
    if (!isPlayerTurn) return;

    const success = engineRef.current.playerAction(action, amount);
    if (!success) return;

    setMessage(`You ${action}${amount ? ` ${amount}` : ''}.`);
    syncState();

    if (engineRef.current.winner) {
      finishHand();
    }
  };

  if (error) {
    return <div style={errorScreenStyle}>Error: {error}</div>;
  }

  if (!gameState) {
    return <div style={loadingStyle}>Loading poker table…</div>;
  }

  const callAmount = Math.max(gameState.currentBet - gameState.playerCommit, 0);
  const minWager = Math.max(engineRef.current.bigBlind, callAmount || engineRef.current.bigBlind);
  const maxWager = Math.max(0, gameState.playerStack);
  const actionDisabled = !(gameState.toAct === 'player' && !botThinking && !isDealing && !gameState.winner);
  const botCards = gameState.winner ? gameState.botHole : ['??', '??'];
  const displayedCommunity = [...gameState.community, null, null, null, null].slice(0, 5);

  return (
    <div style={pageStyle}>
      <div style={tableShellStyle}>
        <div style={topBarStyle}>
          <div>
            <div style={titleStyle}>Heads-Up Poker</div>
            <div style={subtitleStyle}>A fast mobile-first poker table with realistic turn flow.</div>
          </div>
          <div style={metaStyle}>
            <div style={metaLabel}>Hand</div>
            <div style={metaValue}>{gameState.handNumber}</div>
            <div style={metaLabel}>Street</div>
            <div style={metaValue}>{gameState.street}</div>
          </div>
        </div>

        <div style={areaStyle}>
          <div style={opponentPanelStyle(gameState.winner === 'bot')}>
            <div style={panelTextStyle}>Bot</div>
            <div style={cardRowStyle}>
              {gameState.botHole.map((card, index) => (
                <Card key={`bot-${index}`} card={card} hidden={!gameState.winner} glowing={gameState.winner === 'bot'} />
              ))}
            </div>
            <div style={infoRowStyle}>Stack: {gameState.botStack}</div>
            <div style={infoRowStyle}>{gameState.toAct === 'bot' && !gameState.winner ? 'Bot is thinking…' : 'Waiting'}</div>
          </div>

          <div style={boardAreaStyle}>
            <div style={boardTopStyle}>
              <div style={pillStyle}>Pot: {gameState.pot}</div>
              <div style={pillStyle}>Current bet: {gameState.currentBet}</div>
            </div>
            <div style={boardStyle}>
              {displayedCommunity.map((card, index) => (
                <div key={index} style={boardCardContainerStyle(index, !!card, reducedMotion)}>
                  <Card card={card || '??'} hidden={!card} glowing={false} />
                </div>
              ))}
            </div>
            <div style={tableTextStyle}>{message}</div>
          </div>

          <div style={playerPanelStyle(gameState.winner === 'player')}>
            <div style={panelTextStyle}>You</div>
            <div style={cardRowStyle}>
              {gameState.playerHole.map((card, index) => (
                <Card key={`player-${index}`} card={card} hidden={false} glowing={gameState.winner === 'player'} />
              ))}
            </div>
            <div style={infoRowStyle}>Stack: {gameState.playerStack}</div>
            <div style={infoRowStyle}>Your cards are live.</div>
          </div>
        </div>
      </div>

      <div style={actionPanelStyle(actionDisabled)}>
        <div style={actionHeaderStyle(actionDisabled)}>
          <div style={{ fontWeight: 700 }}>{actionDisabled ? 'Waiting for bot' : 'Your turn'}</div>
          <div style={{ color: '#b0c3de' }}>{gameState.winner ? 'Hand complete' : actionDisabled ? 'Actions disabled' : 'Choose an action'}</div>
        </div>

        <div style={wagerRowStyle}>
          <div style={wagerLabelStyle}>Raise amount</div>
          <div style={wagerControlStyle}>
            <input
              type="range"
              min={minWager}
              max={maxWager}
              value={wagerAmount}
              disabled={actionDisabled}
              onChange={(event) => setWagerAmount(Math.max(minWager, Number(event.target.value) || minWager))}
              style={sliderStyle(actionDisabled)}
            />
            <div style={wagerValueStyle}>{wagerAmount}</div>
          </div>
          <button
            style={miniButtonStyle(actionDisabled)}
            onClick={() => setWagerAmount(Math.min(maxWager, Math.max(minWager, wagerAmount + engineRef.current.bigBlind)))}
            disabled={actionDisabled}
          >
            +{engineRef.current.bigBlind}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button style={actionButtonStyle(actionDisabled)} disabled={actionDisabled} onClick={() => handlePlayerAction('fold')}>
            Fold
          </button>
          <button
            style={actionButtonStyle(actionDisabled)}
            disabled={actionDisabled}
            onClick={() => handlePlayerAction(callAmount === 0 ? 'check' : 'call', callAmount === 0 ? undefined : callAmount)}
          >
            {callAmount === 0 ? 'Check' : `Call ${callAmount}`}
          </button>
          {gameState.availableActions.includes('bet') && (
            <button style={actionButtonStyle(actionDisabled)} disabled={actionDisabled} onClick={() => handlePlayerAction('bet', wagerAmount)}>
              Bet {wagerAmount}
            </button>
          )}
          {gameState.availableActions.includes('raise') && (
            <button style={actionButtonStyle(actionDisabled)} disabled={actionDisabled} onClick={() => handlePlayerAction('raise', wagerAmount)}>
              Raise {wagerAmount}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const pageStyle = {
  minHeight: '100vh',
  background: 'radial-gradient(circle at top, rgba(108, 74, 34, 0.22), transparent 28%), linear-gradient(180deg, #071116 0%, #08131d 18%, #0c1f33 100%)',
  color: '#edf2ff',
  padding: '16px 12px 92px',
  boxSizing: 'border-box',
};

const tableShellStyle = {
  maxWidth: 980,
  margin: '0 auto',
  borderRadius: 32,
  background: '#09121f',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 28px 80px rgba(0,0,0,0.32)',
  overflow: 'hidden',
};

const topBarStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 18,
  alignItems: 'flex-end',
  padding: '24px 24px 6px',
};

const titleStyle = {
  fontSize: 28,
  fontWeight: 800,
  letterSpacing: '-0.04em',
  marginBottom: 6,
};

const subtitleStyle = {
  color: '#9cb3d0',
  fontSize: 14,
  lineHeight: 1.5,
};

const metaStyle = {
  display: 'grid',
  gap: 8,
  textAlign: 'right',
};

const metaLabel = {
  color: '#7f97b6',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.2em',
};

const metaValue = {
  fontSize: 18,
  fontWeight: 700,
};

const areaStyle = {
  display: 'grid',
  gap: 22,
  padding: '0 24px 24px',
};

const opponentPanelStyle = (glow) => ({
  borderRadius: 28,
  padding: '18px 18px 14px',
  background: 'rgba(255,255,255,0.04)',
  border: glow ? '1px solid rgba(255, 210, 73, 0.62)' : '1px solid rgba(255,255,255,0.08)',
  boxShadow: glow ? '0 0 20px rgba(255, 210, 73, 0.22)' : 'inset 0 0 0 1px rgba(255,255,255,0.03)',
});

const playerPanelStyle = (glow) => ({
  borderRadius: 28,
  padding: '18px 18px 14px',
  background: 'rgba(255,255,255,0.05)',
  border: glow ? '1px solid rgba(255, 210, 73, 0.62)' : '1px solid rgba(255,255,255,0.08)',
  boxShadow: glow ? '0 0 20px rgba(255, 210, 73, 0.22)' : 'inset 0 0 0 1px rgba(255,255,255,0.03)',
});

const panelTextStyle = {
  fontSize: 14,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#b0c3de',
  marginBottom: 14,
};

const cardRowStyle = {
  display: 'flex',
  gap: 12,
  justifyContent: 'center',
};

const infoRowStyle = {
  marginTop: 16,
  fontSize: 13,
  color: '#9ab1d2',
  textAlign: 'center',
};

const boardAreaStyle = {
  borderRadius: 34,
  background: 'radial-gradient(circle at center, rgba(80, 121, 84, 0.18), rgba(9, 17, 30, 0.92) 54%)',
  border: '1px solid rgba(255,255,255,0.09)',
  padding: '26px 18px 22px',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.03)',
};

const boardTopStyle = {
  display: 'flex',
  justifyContent: 'center',
  gap: 12,
  marginBottom: 20,
  flexWrap: 'wrap',
};

const pillStyle = {
  padding: '10px 14px',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.06)',
  color: '#f5f8ff',
  fontSize: 13,
  fontWeight: 700,
};

const boardStyle = {
  display: 'flex',
  justifyContent: 'center',
  gap: 12,
  flexWrap: 'wrap',
};

const boardCardContainerStyle = (index, active, reducedMotion) => ({
  transform: active ? 'translateY(0)' : 'translateY(12px)',
  transition: reducedMotion ? 'none' : `transform 260ms ease ${index * 60}ms, opacity 260ms ease ${index * 60}ms`,
  opacity: active ? 1 : 0.36,
});

const tableTextStyle = {
  marginTop: 18,
  textAlign: 'center',
  color: '#dce8ff',
  fontSize: 15,
  lineHeight: 1.6,
};

const actionPanelStyle = (disabled) => ({
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 10,
  padding: '16px 14px 22px',
  background: disabled ? 'rgba(4, 9, 18, 0.95)' : 'rgba(8, 17, 35, 0.98)',
  boxShadow: '0 -20px 40px rgba(0,0,0,0.42)',
  backdropFilter: 'blur(14px)',
  borderTop: '1px solid rgba(255,255,255,0.08)',
  opacity: disabled ? 0.84 : 1,
  transition: 'opacity 220ms ease, background 220ms ease',
});

const actionHeaderStyle = (disabled) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 16,
  marginBottom: 14,
  color: disabled ? '#8295b5' : '#f6fcff',
});

const wagerRowStyle = {
  display: 'grid',
  gap: 10,
  marginBottom: 16,
};

const wagerLabelStyle = {
  fontSize: 13,
  color: '#8aa1c7',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const wagerControlStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const sliderStyle = (disabled) => ({
  flex: 1,
  accentColor: '#4dc9a7',
  opacity: disabled ? 0.5 : 1,
  cursor: disabled ? 'not-allowed' : 'pointer',
});

const wagerValueStyle = {
  minWidth: 64,
  textAlign: 'center',
  background: 'rgba(255,255,255,0.06)',
  borderRadius: 12,
  padding: '10px 12px',
  color: '#eef5ff',
  fontWeight: 700,
};

const miniButtonStyle = (disabled) => ({
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.12)',
  background: disabled ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.08)',
  color: disabled ? '#7a8da7' : '#f4f8ff',
  padding: '10px 14px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'background 180ms ease',
});

const actionButtonStyle = (disabled) => ({
  borderRadius: 18,
  padding: '14px 20px',
  border: 'none',
  background: disabled ? 'rgba(255,255,255,0.08)' : '#4dc9a7',
  color: disabled ? '#7c92af' : '#081419',
  fontWeight: 700,
  flex: '1 1 120px',
  minWidth: 120,
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'transform 160ms ease, background 160ms ease',
});

const loadingStyle = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 18,
  color: '#c8d7ef',
  background: '#071018',
};

const errorScreenStyle = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  color: '#f27878',
  background: '#120f16',
};

export default App;
