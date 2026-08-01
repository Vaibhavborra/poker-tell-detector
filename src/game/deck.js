const SUITS = ['h', 'd', 'c', 's']; // hearts, diamonds, clubs, spades
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];

export function createDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push(rank + suit); // e.g. "Ah" = Ace of hearts
    }
  }
  return deck;
}

export function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}