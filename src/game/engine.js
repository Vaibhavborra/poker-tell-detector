import { Hand } from 'pokersolver';
import { createDeck, shuffleDeck } from './deck';
import { evaluateHand, getWinner } from './evaluate';

const SMALL_BLIND = 10;
const BIG_BLIND   = 20;
const ALL_RANKS   = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const ALL_SUITS   = ['h','d','c','s'];

const FULL_DECK = [];
for (const r of ALL_RANKS) for (const s of ALL_SUITS) FULL_DECK.push(r + s);

function opponent(player) { return player === 'player' ? 'bot' : 'player'; }
function handDescription(cards) {
  const h = evaluateHand(cards);
  return { name: h.name, rank: h.rank };
}

// ─── Available actions ────────────────────────────────────────────────────────
function availableActionsFor(actor, state) {
  const commit = actor === 'player' ? state.playerCommit : state.botCommit;
  if (state.winner) return [];
  if (state.currentBet === 0)        return ['check', 'bet'];
  if (commit < state.currentBet)     return ['fold', 'call', 'raise'];
  return ['check', 'raise']; // commit === currentBet: BB option or limped
}

// ─── Monte Carlo equity estimator ─────────────────────────────────────────────
function estimateEquity(botHole, community, simCount = 200) {
  const known     = new Set([...botHole, ...community]);
  const remaining = FULL_DECK.filter(c => !known.has(c));
  const commNeeded = 5 - community.length;
  const arr = [...remaining];
  let wins = 0, ties = 0;

  for (let i = 0; i < simCount; i++) {
    const need = 2 + commNeeded;
    for (let j = 0; j < need; j++) {
      const r = j + Math.floor(Math.random() * (arr.length - j));
      const tmp = arr[j]; arr[j] = arr[r]; arr[r] = tmp;
    }
    const oppHole  = [arr[0], arr[1]];
    const fullComm = [...community, ...arr.slice(2, 2 + commNeeded)];
    const botHand  = evaluateHand([...botHole, ...fullComm]);
    const oppHand  = evaluateHand([...oppHole, ...fullComm]);
    const winners  = Hand.winners([botHand, oppHand]);
    if (winners.length === 2) ties++;
    else if (winners[0] === botHand) wins++;
  }
  return (wins + ties * 0.5) / simCount;
}

// ─── Board texture ─────────────────────────────────────────────────────────────
function boardTexture(community) {
  if (!community.length) return { wet: false, dry: true, paired: false };
  const suits = community.map(c => c[1]);
  const ranks = community.map(c => ({ '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 }[c[0]])).sort((a,b)=>a-b);
  const sc = {}; suits.forEach(s => sc[s] = (sc[s]||0)+1);
  const rc = {}; community.forEach(c => rc[c[0]] = (rc[c[0]]||0)+1);
  const maxSuit   = Math.max(...Object.values(sc));
  const paired    = Object.values(rc).some(v => v >= 2);
  const flushDraw = maxSuit >= 2;
  let straightDraw = false;
  for (let i = 0; i < ranks.length - 1; i++) {
    if (ranks[ranks.length-1] - ranks[i] <= 4) { straightDraw = true; break; }
  }
  const wet = flushDraw || straightDraw;
  return { wet, dry: !wet && !paired, paired, flushDraw, straightDraw };
}

// ─── Bot decision engine ───────────────────────────────────────────────────────
function chooseBotAction(state) {
  const { botHole, community, pot, currentBet, botCommit, botStack, street } = state;
  const available  = availableActionsFor('bot', state);
  const callCost   = Math.max(0, currentBet - botCommit);
  // "Free play": bot's commit already equals the bet (BB option, or checked around)
  const isFreePlay = currentBet > 0 && callCost === 0;
  const hasBet     = currentBet > 0 && !isFreePlay;
  const potOdds    = hasBet ? callCost / (pot + callCost) : 0;
  const texture    = boardTexture(community);
  const isRiver    = street === 'river';
  const isPreflop  = street === 'preflop';
  const r          = Math.random();
  const equity     = estimateEquity(botHole, community, isPreflop ? 150 : 250);

  const clamp    = v  => Math.max(BIG_BLIND, Math.min(v, botStack));
  const betAmt   = fr => clamp(Math.round(pot * fr));
  const raiseAmt = fr => clamp(Math.round(pot * fr));

  let action = 'check';
  let amount = BIG_BLIND;

  // ══════════════════════════════════════════════════════════
  //  PREFLOP
  // ══════════════════════════════════════════════════════════
  if (isPreflop) {
    if (!hasBet) {
      // No bet outstanding — check or initiate
      // (covers: bot is BB and player folded/called, or bot is SB and can act first)
      if (equity > 0.65)             { action='bet';   amount=betAmt(2.5); }
      else if (equity > 0.54)        { action=r<0.65?'bet':'check'; amount=betAmt(2.0); }
      else if (equity > 0.45)        { action=r<0.42?'bet':'check'; amount=betAmt(1.5); }
      else if (r < 0.18)             { action='bet';   amount=betAmt(1.5); } // bluff
      else                           { action='check'; }
    } else {
      // Facing a raise we must call or fold
      if (equity > 0.65)             { action=r<0.44?'raise':'call'; amount=raiseAmt(2.5); }
      else if (equity > potOdds+0.10){ action='call'; }
      else if (equity > potOdds+0.03){ action=r<0.78?'call':'fold'; }
      else if (r < 0.10)             { action='raise'; amount=raiseAmt(2.0); } // 3-bet bluff
      else                           { action='fold'; }
    }
  }

  // ══════════════════════════════════════════════════════════
  //  POSTFLOP
  // ══════════════════════════════════════════════════════════
  else if (!hasBet) {
    // Check or bet (no outstanding bet OR free play / BB option)
    if (equity > 0.74)      { action=r<0.78?'bet':'check'; amount=betAmt(texture.wet?0.85:0.70); }
    else if (equity > 0.62) { action=r<0.68?'bet':'check'; amount=betAmt(0.60); }
    else if (equity > 0.52) { action=r<0.45?'bet':'check'; amount=betAmt(0.45); }
    else if (equity > 0.38) { action=r<(isRiver?0.12:0.32)?'bet':'check'; amount=betAmt(0.55); }
    else {
      const bluffFreq = isRiver ? 0.28 : texture.dry ? 0.22 : 0.18;
      action = r<bluffFreq?'bet':'check';
      amount = betAmt(isRiver ? 0.80 : 0.55);
    }
  } else {
    // Facing a bet that costs us chips
    if (equity > potOdds+0.22)      { action=r<0.42&&available.includes('raise')?'raise':'call'; amount=raiseAmt(isRiver?1.10:0.90); }
    else if (equity > potOdds+0.09) { action=r<0.18&&available.includes('raise')&&!isRiver?'raise':'call'; amount=raiseAmt(0.70); }
    else if (equity > potOdds+0.01) { action=r<0.72?'call':'fold'; }
    else if (equity > potOdds-0.06) { action=r<0.28?'call':'fold'; }
    else if (equity > 0.26&&r<0.10&&available.includes('raise')) { action='raise'; amount=raiseAmt(1.00); }
    else                             { action='fold'; }
  }

  // ─── Normalise to available actions ──────────────────────
  if (!available.includes(action)) {
    if (action === 'bet') {
      // bet→raise works in BB-option scenario; otherwise check
      action = available.includes('raise') ? 'raise'
             : available.includes('check')  ? 'check'
             : available[0];
    } else if (action === 'raise') {
      action = available.includes('call')  ? 'call'
             : available.includes('check') ? 'check'
             : available[0];
    } else if (action === 'call') {
      action = available.includes('check') ? 'check' : available[0];
    } else {
      action = available[0];
    }
  }

  amount = clamp(amount);
  return { action, amount };
}

// ─── PokerGame ────────────────────────────────────────────────────────────────
export class PokerGame {
  constructor({ startingStacks = { player: 1000, bot: 1000 }, bigBlind = BIG_BLIND } = {}) {
    this.startingStacks = startingStacks;
    this.bigBlind       = bigBlind;
    this.handNumber     = 0;
    this.history        = [];
    // dealerSeat: 0 = player is button/SB, 1 = bot is button/SB
    // starts at 1 so first hand player is BB (bot acts first) — alternates every hand
    this.dealerSeat     = 1;
    this.resetMatch();
  }

  resetMatch() {
    this.playerStack = this.startingStacks.player;
    this.botStack    = this.startingStacks.bot;
    this.history     = [];
  }

  startHand() {
    this.handNumber   += 1;
    this.dealerSeat    = this.dealerSeat === 0 ? 1 : 0; // alternate each hand
    this.actedThisStreet = new Set();

    this.deck         = shuffleDeck(createDeck());
    this.playerHole   = this.deck.splice(0, 2);
    this.botHole      = this.deck.splice(0, 2);
    this.community    = [];
    this.street       = 'preflop';
    this.currentBet   = BIG_BLIND;
    this.winner       = null;
    this.lastAction   = null;
    this.lastActor    = null;

    if (this.dealerSeat === 0) {
      // Player is button (SB), bot is BB
      // Preflop: player (SB) acts first
      this.playerStack -= SMALL_BLIND;
      this.botStack    -= BIG_BLIND;
      this.playerCommit = SMALL_BLIND;
      this.botCommit    = BIG_BLIND;
      this.toAct        = 'player';
    } else {
      // Bot is button (SB), player is BB
      // Preflop: bot (SB) acts first
      this.botStack    -= SMALL_BLIND;
      this.playerStack -= BIG_BLIND;
      this.botCommit    = SMALL_BLIND;
      this.playerCommit = BIG_BLIND;
      this.toAct        = 'bot';
    }

    this.pot = SMALL_BLIND + BIG_BLIND;

    this.handLog = {
      handNumber:  this.handNumber,
      dealerSeat:  this.dealerSeat,
      playerHole:  [...this.playerHole],
      botHole:     [...this.botHole],
      community:   [],
      blinds:      { sb: this.dealerSeat === 0 ? 'player' : 'bot' },
      actions:     [],
      result:      null,
    };
  }

  getState() {
    return {
      handNumber:   this.handNumber,
      dealerSeat:   this.dealerSeat,   // 0=player is BTN/SB, 1=bot is BTN/SB
      street:       this.street,
      pot:          this.pot,
      currentBet:   this.currentBet,
      playerCommit: this.playerCommit,
      botCommit:    this.botCommit,
      toAct:        this.toAct,
      playerHole:   [...this.playerHole],
      botHole:      [...this.botHole],
      community:    [...this.community],
      playerStack:  this.playerStack,
      botStack:     this.botStack,
      winner:       this.winner,
      handLog:      this.handLog,
    };
  }

  getAvailableActions(actor = this.toAct) { return availableActionsFor(actor, this); }
  canAct(actor) { return !this.winner && this.toAct === actor; }

  playerAction(action, amount = this.bigBlind) {
    if (!this.canAct('player')) return false;
    this._takeAction('player', action, amount);
    return true;
  }

  botAction() {
    if (!this.canAct('bot')) return false;
    const { action, amount } = chooseBotAction(this);
    const actualCallAmount   = this.currentBet - this.botCommit;
    this._takeAction('bot', action, amount);
    return { action, amount: action === 'call' ? Math.max(0, actualCallAmount) : amount };
  }

  _takeAction(actor, action, amount) {
    if (this.winner || this.toAct !== actor) return false;

    const actorCommit  = actor === 'player' ? this.playerCommit : this.botCommit;
    const opponentName = opponent(actor);

    // Record that this actor has acted this street
    this.actedThisStreet.add(actor);

    if (action === 'fold') {
      this.winner = opponentName;
      this._logAction(actor, 'fold', 0);
      this._settleFold(opponentName);
      return;
    }

    const actorStack = actor === 'player' ? this.playerStack : this.botStack;

    if (action === 'check') {
      if (this.currentBet > 0 && actorCommit < this.currentBet)
        throw new Error('Cannot check when a bet is outstanding.');
      this._logAction(actor, 'check', 0);
    } else if (action === 'bet') {
      if (this.currentBet !== 0) throw new Error('Cannot bet; use raise.');
      // Cap to available stack (all-in)
      const betAmt = Math.min(amount, actorStack);
      this.currentBet = betAmt;
      this._applyCommit(actor, betAmt);
      this.pot += betAmt - actorCommit;
      this._logAction(actor, 'bet', betAmt);
    } else if (action === 'call') {
      if (this.currentBet === 0) throw new Error('Nothing to call.');
      // Cap call to available stack (all-in call)
      const callTarget = Math.min(this.currentBet, actorCommit + actorStack);
      const contrib = callTarget - actorCommit;
      this._applyCommit(actor, callTarget);
      this.pot += contrib;
      this._logAction(actor, 'call', contrib);
    } else if (action === 'raise') {
      if (this.currentBet === 0) throw new Error('No bet to raise.');
      // Max raise amount = what actor can still put in after calling
      const maxRaise = actorStack - (this.currentBet - actorCommit);
      const safeAmt  = Math.min(amount, Math.max(0, maxRaise));
      const newBet   = this.currentBet + safeAmt;
      const contrib  = newBet - actorCommit;
      this.currentBet = newBet;
      this._applyCommit(actor, newBet);
      this.pot += contrib;
      this._logAction(actor, 'raise', safeAmt);
    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    this.lastAction = action;
    this.lastActor  = actor;

    if ((action === 'check' || action === 'call') && this._bettingRoundComplete()) {
      this._advanceStreet();
      return;
    }

    if (action !== 'check' && action !== 'call') {
      // bet or raise: other player must respond
      this.toAct = opponentName;
    } else {
      // check or call but round not complete: other player acts
      this.toAct = opponentName;
    }
  }

  _logAction(actor, action, amount) {
    this.handLog.actions.push({ actor, action, amount, street: this.street, pot: this.pot, timestamp: Date.now() });
  }

  _applyCommit(actor, totalCommit) {
    const delta = actor === 'player'
      ? totalCommit - this.playerCommit
      : totalCommit - this.botCommit;
    if (actor === 'player') { this.playerCommit = totalCommit; this.playerStack -= delta; }
    else                    { this.botCommit    = totalCommit; this.botStack    -= delta; }
  }

  // ─── Betting round complete only when BOTH players have acted ─────────────
  _bettingRoundComplete() {
    // Both must have voluntarily acted this street
    if (!this.actedThisStreet.has('player') || !this.actedThisStreet.has('bot')) return false;

    if (this.currentBet === 0) {
      // Both checked (last action was a check after both acted)
      return this.lastAction === 'check';
    }
    // Bets equalised
    return this.playerCommit === this.currentBet && this.botCommit === this.currentBet;
  }

  _advanceStreet() {
    if (this.street === 'showdown') return;

    if (this.street === 'preflop')      { this.community.push(...this.deck.splice(0, 3)); this.street = 'flop';  }
    else if (this.street === 'flop')    { this.community.push(...this.deck.splice(0, 1)); this.street = 'turn';  }
    else if (this.street === 'turn')    { this.community.push(...this.deck.splice(0, 1)); this.street = 'river'; }
    else if (this.street === 'river')   { this.street = 'showdown'; this._settleShowdown(); return; }

    this.currentBet   = 0;
    this.playerCommit = 0;
    this.botCommit    = 0;
    this.lastAction   = null;
    this.lastActor    = null;
    this.actedThisStreet = new Set();

    // Out-of-position player acts first postflop (non-button)
    // dealerSeat 0 = player is button → bot is OOP → bot acts first postflop
    // dealerSeat 1 = bot is button   → player is OOP → player acts first postflop
    this.toAct = this.dealerSeat === 0 ? 'bot' : 'player';

    this.handLog.community = [...this.community];
  }

  _settleFold(winner) {
    if (winner === 'player') this.playerStack += this.pot;
    else                     this.botStack    += this.pot;
    this.handLog.result = { winner, method: 'fold', pot: this.pot };
    this.history.push(this.handLog);
  }

  _settleShowdown() {
    const pCards  = [...this.playerHole, ...this.community];
    const bCards  = [...this.botHole,    ...this.community];
    const pHand   = evaluateHand(pCards);
    const winners = getWinner(pCards, bCards);
    let winner;
    if (winners.length === 2) {
      winner = 'split';
      const half = Math.floor(this.pot / 2);
      this.playerStack += half; this.botStack += half;
    } else if (winners[0] === pHand) {
      winner = 'player'; this.playerStack += this.pot;
    } else {
      winner = 'bot'; this.botStack += this.pot;
    }
    this.winner = winner;
    this.handLog.result = {
      winner, method: 'showdown', pot: this.pot,
      playerHand: handDescription(pCards),
      botHand:    handDescription(bCards),
    };
    this.history.push(this.handLog);
  }
}
