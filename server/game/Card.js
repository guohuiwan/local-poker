const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const SUIT_SYMBOLS = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠'
};

const RANK_VALUES = {};
RANKS.forEach((r, i) => { RANK_VALUES[r] = i + 2; });

class Card {
  constructor(rank, suit) {
    this.rank = rank;
    this.suit = suit;
    this.value = RANK_VALUES[rank];
  }

  toString() {
    return `${this.rank}${SUIT_SYMBOLS[this.suit]}`;
  }

  toJSON() {
    return { rank: this.rank, suit: this.suit, display: this.toString() };
  }
}

module.exports = { Card, SUITS, RANKS, RANK_VALUES, SUIT_SYMBOLS };
