const HAND_RANKS = {
  ROYAL_FLUSH: 10,
  STRAIGHT_FLUSH: 9,
  FOUR_OF_A_KIND: 8,
  FULL_HOUSE: 7,
  FLUSH: 6,
  STRAIGHT: 5,
  THREE_OF_A_KIND: 4,
  TWO_PAIR: 3,
  ONE_PAIR: 2,
  HIGH_CARD: 1
};

const HAND_NAMES = {
  10: '皇家同花顺',
  9: '同花顺',
  8: '四条',
  7: '葫芦',
  6: '同花',
  5: '顺子',
  4: '三条',
  3: '两对',
  2: '一对',
  1: '高牌'
};

class HandEvaluator {
  /**
   * Evaluate best 5-card hand from 7 cards.
   * Returns { rank, score: [handRank, ...tiebreakers], name, bestCards }
   */
  static evaluate(cards) {
    const combos = HandEvaluator._combinations(cards, 5);
    let bestResult = null;

    for (const combo of combos) {
      const result = HandEvaluator._evaluate5(combo);
      if (!bestResult || HandEvaluator.compareScores(result.score, bestResult.score) > 0) {
        bestResult = result;
        bestResult.bestCards = combo;
      }
    }

    bestResult.name = HAND_NAMES[bestResult.score[0]];
    return bestResult;
  }

  /**
   * Evaluate exactly 5 cards. Returns { score: number[] }
   */
  static _evaluate5(cards) {
    const values = cards.map(c => c.value).sort((a, b) => b - a);
    const suits = cards.map(c => c.suit);

    const isFlush = suits.every(s => s === suits[0]);
    const isWheel = values[0] === 14 && values[1] === 5 && values[2] === 4 && values[3] === 3 && values[4] === 2;
    const isStraight = isWheel || (
      values[0] - values[4] === 4 &&
      new Set(values).size === 5
    );

    // Count ranks
    const counts = {};
    for (const v of values) {
      counts[v] = (counts[v] || 0) + 1;
    }
    const groups = Object.entries(counts)
      .map(([v, c]) => ({ value: parseInt(v), count: c }))
      .sort((a, b) => b.count - a.count || b.value - a.value);

    // Royal flush
    if (isFlush && isStraight && values[0] === 14 && values[4] === 10) {
      return { score: [HAND_RANKS.ROYAL_FLUSH] };
    }

    // Straight flush
    if (isFlush && isStraight) {
      const high = isWheel ? 5 : values[0];
      return { score: [HAND_RANKS.STRAIGHT_FLUSH, high] };
    }

    // Four of a kind
    if (groups[0].count === 4) {
      return { score: [HAND_RANKS.FOUR_OF_A_KIND, groups[0].value, groups[1].value] };
    }

    // Full house
    if (groups[0].count === 3 && groups[1].count === 2) {
      return { score: [HAND_RANKS.FULL_HOUSE, groups[0].value, groups[1].value] };
    }

    // Flush
    if (isFlush) {
      return { score: [HAND_RANKS.FLUSH, ...values] };
    }

    // Straight
    if (isStraight) {
      const high = isWheel ? 5 : values[0];
      return { score: [HAND_RANKS.STRAIGHT, high] };
    }

    // Three of a kind
    if (groups[0].count === 3) {
      const kickers = groups.slice(1).map(g => g.value).sort((a, b) => b - a);
      return { score: [HAND_RANKS.THREE_OF_A_KIND, groups[0].value, ...kickers] };
    }

    // Two pair
    if (groups[0].count === 2 && groups[1].count === 2) {
      const pairs = [groups[0].value, groups[1].value].sort((a, b) => b - a);
      const kicker = groups[2].value;
      return { score: [HAND_RANKS.TWO_PAIR, pairs[0], pairs[1], kicker] };
    }

    // One pair
    if (groups[0].count === 2) {
      const kickers = groups.slice(1).map(g => g.value).sort((a, b) => b - a);
      return { score: [HAND_RANKS.ONE_PAIR, groups[0].value, ...kickers] };
    }

    // High card
    return { score: [HAND_RANKS.HIGH_CARD, ...values] };
  }

  /**
   * Compare two score arrays. Returns >0 if a wins, <0 if b wins, 0 if tie.
   */
  static compareScores(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const va = a[i] || 0;
      const vb = b[i] || 0;
      if (va !== vb) return va - vb;
    }
    return 0;
  }

  /**
   * Generate all C(n,k) combinations.
   */
  static _combinations(arr, k) {
    const results = [];
    const combo = [];

    function recurse(start) {
      if (combo.length === k) {
        results.push([...combo]);
        return;
      }
      for (let i = start; i < arr.length; i++) {
        combo.push(arr[i]);
        recurse(i + 1);
        combo.pop();
      }
    }

    recurse(0);
    return results;
  }
}

module.exports = { HandEvaluator, HAND_RANKS, HAND_NAMES };
