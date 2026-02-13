const { Card, SUITS, RANKS } = require('./Card');

class Deck {
  constructor() {
    this.cards = [];
    this.reset();
  }

  reset() {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push(new Card(rank, suit));
      }
    }
    this.shuffle();
  }

  shuffle() {
    // Fisher-Yates shuffle
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  deal(count = 1) {
    if (count === 1) return this.cards.pop();
    const hand = [];
    for (let i = 0; i < count; i++) {
      hand.push(this.cards.pop());
    }
    return hand;
  }

  burn() {
    this.cards.pop();
  }
}

module.exports = { Deck };
