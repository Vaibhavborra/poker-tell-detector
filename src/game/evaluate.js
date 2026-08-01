import { Hand } from 'pokersolver';

// cards: array of 7 card strings (2 hole + 5 community)
// returns a Hand object with .name (e.g. "Two Pair") and .rank (higher = better)
export function evaluateHand(cards) {
  return Hand.solve(cards);
}

// compares two hands, returns the winner (or tie array)
export function getWinner(hand1Cards, hand2Cards) {
  const hand1 = Hand.solve(hand1Cards);
  const hand2 = Hand.solve(hand2Cards);
  const winners = Hand.winners([hand1, hand2]);
  return winners;
}