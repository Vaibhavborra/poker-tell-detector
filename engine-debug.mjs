import { PokerGame } from './src/game/engine.js';  
const game = new PokerGame();  
try {  
  const result = game.autoPlaySampleHand();  
  console.log('done', result.street, result.winner, result.pot, result.handLog.actions.length);  
} catch (err) {  
  console.error('ERROR', err);  
}  
