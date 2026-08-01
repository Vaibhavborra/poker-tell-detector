import { createDeck, shuffleDeck } from './deck';
import { evaluateHand, getWinner } from './evaluate';

const STREET_ORDER = ['preflop', 'flop', 'turn', 'river', 'showdown'];
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const RANK_VALUES = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

function sortedRanks(cardA, cardB) {
  return RANK_VALUES[cardB[0]] - RANK_VALUES[cardA[0]];
}

function preflopStrength(hole) {
  const [a, b] = [...hole].sort(sortedRanks);
  const rankA = RANK_VALUES[a[0]];
  const rankB = RANK_VALUES[b[0]];
  let score = rankA + rankB;
  if (a[0] === b[0]) score += 8;
  if (a[1] === b[1]) score += 3;
  if (rankA >= 12) score += 2;
  if (rankB >= 12) score += 1;
  return score;
}

function opponent(player) {
  return player === 'player' ? 'bot' : 'player';
}

function handDescription(cards) {
  const hand = evaluateHand(cards);
  return {
    name: hand.name,
    rank: hand.rank,
  };
}

function availableActionsFor(actor, state) {
  const actorCommit = actor === 'player' ? state.playerCommit : state.botCommit;
  if (state.winner) return [];
  if (state.currentBet === 0) {
    return ['check', 'bet'];
  }
  if (actorCommit < state.currentBet) {
    return ['fold', 'call', 'raise'];
  }
  return ['check', 'raise'];
}

function chooseBotAction(state) {
  const community = state.community;
  const hole = state.botHole;
  const knownHand = evaluateHand([...hole, ...community]);
  const name = knownHand.name;
  const hasBet = state.currentBet > 0;
  const score = preflopStrength(hole);
  let action = 'check';
  let amount = BIG_BLIND;

  if (community.length === 0) {
    if (!hasBet) {
      if (score > 38) {
        action = 'raise';
        amount = BIG_BLIND * 2;
      } else if (score > 30) {
        action = 'bet';
        amount = BIG_BLIND;
      } else if (score > 24 && Math.random() < 0.4) {
        action = 'bet';
        amount = BIG_BLIND;
      } else {
        action = 'check';
      }
    } else {
      if (score > 32) {
        action = 'call';
      } else if (score > 22 && Math.random() < 0.6) {
        action = 'call';
      } else {
        action = 'fold';
      }
    }
  } else {
    if (!hasBet) {
      if (
        ['Straight Flush', 'Four of a Kind', 'Full House', 'Flush', 'Straight'].includes(name)
      ) {
        action = Math.random() < 0.8 ? 'bet' : 'check';
        amount = BIG_BLIND * 3;
      } else if (['Three of a Kind', 'Two Pair'].includes(name)) {
        action = Math.random() < 0.75 ? 'bet' : 'check';
        amount = BIG_BLIND * 2;
      } else if (name === 'Pair') {
        action = 'check';
      } else {
        action = Math.random() < 0.2 ? 'bet' : 'check';
        amount = BIG_BLIND;
      }
    } else {
      if (
        ['Straight Flush', 'Four of a Kind', 'Full House', 'Flush', 'Straight'].includes(name)
      ) {
        action = 'call';
      } else if (['Three of a Kind', 'Two Pair'].includes(name)) {
        action = Math.random() < 0.85 ? 'call' : 'fold';
      } else if (name === 'Pair') {
        action = Math.random() < 0.55 ? 'call' : 'fold';
      } else {
        action = Math.random() < 0.3 ? 'call' : 'fold';
      }
    }
  }

  const available = availableActionsFor('bot', state);
  if (!available.includes(action)) {
    if (available.includes('call')) action = 'call';
    else if (available.includes('check')) action = 'check';
    else action = available[0];
  }

  return { action, amount };
}

export class PokerGame {
  constructor({ startingStacks = { player: 1000, bot: 1000 }, bigBlind = BIG_BLIND } = {}) {
    this.startingStacks = startingStacks;
    this.bigBlind = bigBlind;
    this.handNumber = 0;
    this.history = [];
    this.resetMatch();
  }

  resetMatch() {
    this.playerStack = this.startingStacks.player;
    this.botStack = this.startingStacks.bot;
    this.history = [];
  }

  startHand() {
    this.handNumber += 1;
    this.deck = shuffleDeck(createDeck());
    this.playerHole = this.deck.splice(0, 2);
    this.botHole = this.deck.splice(0, 2);
    this.community = [];
    this.street = 'preflop';
    this.playerStack -= SMALL_BLIND;
    this.botStack -= BIG_BLIND;
    this.pot = SMALL_BLIND + BIG_BLIND;
    this.currentBet = BIG_BLIND;
    this.playerCommit = SMALL_BLIND;
    this.botCommit = BIG_BLIND;
    this.toAct = 'player';
    this.lastAction = null;
    this.lastActor = null;
    this.winner = null;
    this.handLog = {
      handNumber: this.handNumber,
      playerHole: [...this.playerHole],
      botHole: [...this.botHole],
      community: [...this.community],
      blinds: {
        player: SMALL_BLIND,
        bot: BIG_BLIND,
      },
      actions: [],
      result: null,
    };
  }

  getState() {
    return {
      handNumber: this.handNumber,
      street: this.street,
      pot: this.pot,
      currentBet: this.currentBet,
      playerCommit: this.playerCommit,
      botCommit: this.botCommit,
      toAct: this.toAct,
      playerHole: [...this.playerHole],
      botHole: [...this.botHole],
      community: [...this.community],
      playerStack: this.playerStack,
      botStack: this.botStack,
      winner: this.winner,
      handLog: this.handLog,
    };
  }

  getAvailableActions(actor = this.toAct) {
    return availableActionsFor(actor, this);
  }

  canAct(actor) {
    return !this.winner && this.toAct === actor;
  }

  playerAction(action, amount = this.bigBlind) {
    if (!this.canAct('player')) {
      return false;
    }
    return this._takeAction('player', action, amount);
  }

  botAction() {
    if (!this.canAct('bot')) {
      return false;
    }
    const { action, amount } = chooseBotAction(this);
    const actualCallAmount = this.currentBet - this.botCommit;
    this._takeAction('bot', action, amount);
    return { action, amount: action === 'call' ? actualCallAmount : amount };
  }

  _takeAction(actor, action, amount) {
    if (this.winner) {
      return false;
    }
    if (this.toAct !== actor) {
      return false;
    }

    const actorCommit = actor === 'player' ? this.playerCommit : this.botCommit;
    const opponentCommit = actor === 'player' ? this.botCommit : this.playerCommit;
    const opponentName = opponent(actor);
    let contribution = 0;

    if (action === 'fold') {
      this.winner = opponentName;
      this._logAction(actor, 'fold', 0);
      this._settleFold(opponentName);
      return;
    }

    if (action === 'check') {
      if (this.currentBet > 0 && actorCommit < this.currentBet) {
        throw new Error('Cannot check when a bet is outstanding.');
      }
      this._logAction(actor, 'check', 0);
    } else if (action === 'bet') {
      if (this.currentBet !== 0) {
        throw new Error('Cannot bet after a bet exists; use raise instead.');
      }
      this.currentBet = amount;
      contribution = amount - actorCommit;
      this._applyCommit(actor, amount);
      this.pot += contribution;
      this._logAction(actor, 'bet', amount);
    } else if (action === 'call') {
      if (this.currentBet === 0) {
        throw new Error('Nothing to call.');
      }
      contribution = this.currentBet - actorCommit;
      this._applyCommit(actor, this.currentBet);
      this.pot += contribution;
      this._logAction(actor, 'call', contribution);
    } else if (action === 'raise') {
      if (this.currentBet === 0) {
        throw new Error('Cannot raise when there is no current bet.');
      }
      const newBet = this.currentBet + amount;
      contribution = newBet - actorCommit;
      this.currentBet = newBet;
      this._applyCommit(actor, newBet);
      this.pot += contribution;
      this._logAction(actor, 'raise', amount);
    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    this.lastAction = action;
    this.lastActor = actor;
    const nextToAct = opponentName;

    if ((action === 'check' || action === 'call') && this._bettingRoundComplete(nextToAct)) {
      this._advanceStreet();
      return;
    }

    if (action === 'fold') {
      return;
    }

    if (action === 'bet' || action === 'raise') {
      this.toAct = opponentName;
      return;
    }

    if (action === 'check' || action === 'call') {
      this.toAct = opponentName;
      return;
    }
  }

  _logAction(actor, action, amount) {
    this.handLog.actions.push({
      actor,
      action,
      amount,
      street: this.street,
      pot: this.pot,
      toAct: this.toAct,
      timestamp: Date.now(),
    });
  }

  _applyCommit(actor, amount) {
    const commitDelta = actor === 'player' ? amount - this.playerCommit : amount - this.botCommit;
    if (actor === 'player') {
      this.playerCommit = amount;
      this.playerStack -= commitDelta;
    } else {
      this.botCommit = amount;
      this.botStack -= commitDelta;
    }
  }

  _bettingRoundComplete(nextToAct = this.toAct) {
    if (this.currentBet === 0) {
      return (
        this.lastAction === 'check' &&
        this.lastActor !== null &&
        this.lastActor !== nextToAct
      );
    }
    return (
      this.playerCommit === this.currentBet &&
      this.botCommit === this.currentBet &&
      this.lastActor !== null &&
      this.lastActor !== nextToAct
    );
  }

  _advanceStreet() {
    const currentIndex = STREET_ORDER.indexOf(this.street);
    if (currentIndex === -1 || this.street === 'showdown') {
      return;
    }
    if (this.street === 'preflop') {
      this.community.push(...this.deck.splice(0, 3));
      this.street = 'flop';
    } else if (this.street === 'flop') {
      this.community.push(...this.deck.splice(0, 1));
      this.street = 'turn';
    } else if (this.street === 'turn') {
      this.community.push(...this.deck.splice(0, 1));
      this.street = 'river';
    } else if (this.street === 'river') {
      this.street = 'showdown';
      this._settleShowdown();
      return;
    }

    this.currentBet = 0;
    this.playerCommit = 0;
    this.botCommit = 0;
    this.toAct = 'player';
    this.lastAction = null;
    this.lastActor = null;
    this.handLog.community = [...this.community];
  }

  _settleFold(winner) {
    const loser = opponent(winner);
    const collect = this.pot;
    if (winner === 'player') {
      this.playerStack += collect;
    } else {
      this.botStack += collect;
    }
    this.handLog.result = {
      winner,
      method: 'fold',
      pot: this.pot,
    };
    this.history.push(this.handLog);
  }

  _settleShowdown() {
    const playerCards = [...this.playerHole, ...this.community];
    const botCards = [...this.botHole, ...this.community];
    const playerHand = evaluateHand(playerCards);
    const botHand = evaluateHand(botCards);
    const winners = getWinner(playerCards, botCards);
    let winner = null;
    if (winners.length === 2) {
      winner = 'split';
      const splitAmount = Math.floor(this.pot / 2);
      this.playerStack += splitAmount;
      this.botStack += splitAmount;
    } else if (winners[0] === playerHand) {
      winner = 'player';
      this.playerStack += this.pot;
    } else {
      winner = 'bot';
      this.botStack += this.pot;
    }
    this.winner = winner;
    this.handLog.result = {
      winner,
      method: 'showdown',
      pot: this.pot,
      playerHand: handDescription([...this.playerHole, ...this.community]),
      botHand: handDescription([...this.botHole, ...this.community]),
    };
    this.history.push(this.handLog);
  }

  autoPlaySampleHand(maxSteps = 100) {
    this.startHand();
    let steps = 0;
    while (!this.winner) {
      if (steps++ > maxSteps) {
        throw new Error('autoPlaySampleHand exceeded maximum step count');
      }

      if (this.toAct === 'player') {
        const available = this.getAvailableActions('player');
        if (available.includes('check')) {
          this.playerAction('check');
        } else if (available.includes('call')) {
          this.playerAction('call');
        } else {
          this.playerAction('check');
        }
      } else {
        this.botAction();
      }
    }
    return this.getState();
  }
}
