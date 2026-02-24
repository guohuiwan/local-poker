/**
 * AI Decision Engine — Action Mix Sampling + Directive LLM Prompting
 *
 * Decision flow:
 *   1. normalizeInput()      — collect game state into structured input
 *   2. _computeQuality()     — hand quality 0-1 score
 *   3. computeActionMix()    — probability distribution per action
 *   4. sampleAction()        — weighted random pick
 *   5. computeRaiseSizing()  — tier sampling + jitter (if raise)
 *   6. decideWithLLM()       — directive prompt: reasoning + optional raise tuning
 *   7. validateAction()      — legality check; _safeFallback() if invalid
 */

const { HandEvaluator } = require('../game/HandEvaluator');
const aiConfig = require('./aiConfig');

// LLM request/response logging (opt-in via AI_LLM_LOG=1)
const LLM_LOG = process.env.AI_LLM_LOG === '1';
const LLM_LOG_PREFIX = '[AI][LLM]';

function _llmLog(...args) {
  if (LLM_LOG) console.log(LLM_LOG_PREFIX, ...args);
}

// AI player name pool
const AI_NAMES = ['Alice AI', 'Bob AI', 'Charlie AI', 'Diana AI'];

// AI personality definitions
const AI_PERSONALITIES = {
  BALANCED: {
    id: 'balanced',
    name: '均衡',
    description: '根据牌力和赔率合理决策，各种动作频率适中。',
    instruction: '根据牌力和赔率合理决策。偶尔在有利位置进行小额诈唬，强牌时正常价值下注（锅注的50-75%）。'
  },
  BLUFFER: {
    id: 'bluffer',
    name: '诈唬',
    description: '弱牌时更常诈唬加注，强牌时倾向慢打隐藏牌力，下注偏小。',
    instruction: '在有利位置时比均衡风格更频繁选择下注而非过牌，弱牌时偶尔做小额诈唬（不超过锅注）。强牌时正常跟注或小幅加注，避免大注暴露风格。'
  },
  AGGRESSIVE: {
    id: 'aggressive',
    name: '激进',
    description: '更频繁加注，下注档位偏大，弃牌频率低。',
    instruction: '比均衡风格更频繁加注，中等以上手牌倾向加注而非跟注。强牌时选择较大的价值下注（锅注的75-100%）。但不用全下代替正常加注。'
  }
};

// ── Personality-specific action weights & sizing tiers ──

const PERSONALITY_CONFIG = {
  balanced: {
    actionWeights: {
      raiseBoost: 1.0,
      callBoost: 1.0,
      foldBoost: 1.0,
      bluffBoost: 1.0,
      slowplayBoost: 1.0
    },
    sizingTiers: [
      { fraction: 0.33, weight: 0.10 },
      { fraction: 0.50, weight: 0.35 },
      { fraction: 0.67, weight: 0.35 },
      { fraction: 0.80, weight: 0.15 },
      { fraction: 1.00, weight: 0.05 }
    ],
    jitterRange: 0.08
  },
  aggressive: {
    actionWeights: {
      raiseBoost: 1.6,
      callBoost: 0.9,
      foldBoost: 0.7,
      bluffBoost: 1.3,
      slowplayBoost: 0.6
    },
    sizingTiers: [
      { fraction: 0.50, weight: 0.10 },
      { fraction: 0.67, weight: 0.30 },
      { fraction: 0.80, weight: 0.30 },
      { fraction: 1.00, weight: 0.25 },
      { fraction: 1.50, weight: 0.05 }
    ],
    jitterRange: 0.10
  },
  bluffer: {
    actionWeights: {
      raiseBoost: 1.1,
      callBoost: 1.0,
      foldBoost: 0.9,
      bluffBoost: 2.2,
      slowplayBoost: 1.5
    },
    sizingTiers: [
      { fraction: 0.25, weight: 0.15 },
      { fraction: 0.33, weight: 0.35 },
      { fraction: 0.50, weight: 0.35 },
      { fraction: 0.67, weight: 0.10 },
      { fraction: 1.00, weight: 0.05 }
    ],
    jitterRange: 0.10
  }
};
const DEFAULT_PERSONALITY_CONFIG = PERSONALITY_CONFIG.balanced;

/**
 * Get a random AI personality.
 * @returns {object} A personality object from AI_PERSONALITIES
 */
function getRandomPersonality() {
  const personalities = Object.values(AI_PERSONALITIES);
  return personalities[Math.floor(Math.random() * personalities.length)];
}

// Hand quality thresholds
const QUALITY_TIERS = {
  very_strong: 0.8,
  strong: 0.7,
  medium: 0.5,
  marginal: 0.3
  // below 0.3 = weak
};

// Base action probabilities by quality tier
const BASE_ACTION_PROBS = {
  very_strong: { fold: 0.00, check: 0.10, call: 0.15, raise: 0.75 },
  strong:      { fold: 0.02, check: 0.13, call: 0.35, raise: 0.50 },
  medium:      { fold: 0.12, check: 0.25, call: 0.38, raise: 0.25 },
  marginal:    { fold: 0.35, check: 0.25, call: 0.25, raise: 0.15 },
  weak:        { fold: 0.60, check: 0.25, call: 0.08, raise: 0.07 }
};

class AIDecisionEngine {
  constructor() {}

  /**
   * Main entry point: decide an action for the AI player.
   * @param {object} game - PokerGame instance
   * @param {string} playerId - AI player's id
   * @param {object} personality - AI personality object (optional)
   * @returns {{ action: string, amount: number|null, meta: object }}
   */
  async decide(game, playerId, personality = null) {
    const input = this.normalizeInput(game, playerId);
    const pConfig = personality
      ? (PERSONALITY_CONFIG[personality.id] || DEFAULT_PERSONALITY_CONFIG)
      : DEFAULT_PERSONALITY_CONFIG;

    // Compute hand quality
    const quality = this._computeQuality(input);
    const qualityLabel = this._qualityToLabel(quality);

    // Build probability distribution and sample
    const actionMix = this.computeActionMix(input, quality, pConfig);
    const sampledAction = this.sampleAction(actionMix);

    // Compute raise sizing if needed
    let targetSizing = null;
    let sizingRange = null;
    const raiseInfo = input.availableActions.find(a => a.action === 'raise');
    if (sampledAction === 'raise' && raiseInfo) {
      targetSizing = this.computeRaiseSizing(input, pConfig, quality);
      sizingRange = { min: raiseInfo.min, max: raiseInfo.max };
    }

    // Build sampling context string for LLM
    const samplingContext = `牌力${qualityLabel}, 位置${input.position}, ${personality ? personality.name : '均衡'}性格`;

    // Build the decision (before LLM)
    let decision;
    if (sampledAction === 'raise' && targetSizing != null) {
      decision = { action: 'raise', amount: targetSizing, meta: { source: 'sampled' } };
    } else if (sampledAction === 'fold') {
      decision = { action: 'fold', amount: null, meta: { source: 'sampled' } };
    } else if (sampledAction === 'check') {
      decision = { action: 'check', amount: null, meta: { source: 'sampled' } };
    } else {
      decision = { action: 'call', amount: null, meta: { source: 'sampled' } };
    }

    // Call LLM for reasoning (and optional raise amount tuning)
    const llmResult = await this.decideWithLLM(input, {
      personality,
      actionMix,
      sampledAction,
      samplingContext,
      targetSizing,
      sizingRange,
      quality,
      qualityLabel
    });

    if (llmResult) {
      decision.meta.source = 'sampled+llm';
      decision.meta.reasoning = llmResult.reasoning || null;
      // LLM can tune raise amount within range
      if (sampledAction === 'raise' && typeof llmResult.amount === 'number' && sizingRange) {
        const tuned = Math.round(llmResult.amount);
        if (tuned >= sizingRange.min && tuned <= sizingRange.max) {
          decision.amount = tuned;
        }
      }
    }

    // Validate and fallback
    if (!this.validateAction(decision, input)) {
      console.log(`[AI] Invalid sampled action: ${JSON.stringify(decision)}, using safe fallback`);
      decision = this._safeFallback(input);
    }

    return decision;
  }

  /**
   * Normalize game state into structured input for decision-making.
   */
  normalizeInput(game, playerId) {
    const player = game.players.find(p => p.id === playerId);
    const playerIdx = game.players.indexOf(player);
    const maxBet = Math.max(0, ...game.players.map(p => p.bet));
    const activePlayers = game.getActivePlayers();
    const actionablePlayers = game.getActionablePlayers();

    const stageToStreet = {
      'PRE_FLOP': 'preflop',
      'FLOP': 'flop',
      'TURN': 'turn',
      'RIVER': 'river'
    };

    const availableActions = game._getAvailableActions(player);

    let handStrength = null;
    if (player.hand.length === 2 && game.communityCards.length > 0) {
      const allCards = [...player.hand, ...game.communityCards];
      handStrength = HandEvaluator.evaluate(allCards);
    }

    let preflopStrength = 0;
    if (player.hand.length === 2 && game.communityCards.length === 0) {
      preflopStrength = this._estimatePreflopStrength(player.hand);
    }

    return {
      street: stageToStreet[game.stage] || game.stage,
      stage: game.stage,
      publicCards: game.communityCards.map(c => c.toJSON()),
      holeCards: player.hand.map(c => c.toJSON()),
      potSize: game.pot,
      currentBet: maxBet,
      playerBet: player.bet,
      playerChips: player.chips,
      minRaise: maxBet + game.lastRaiseSize,
      callAmount: Math.min(maxBet - player.bet, player.chips),
      playersInHand: activePlayers.length,
      actionablePlayers: actionablePlayers.length,
      totalPlayers: game.players.filter(p => !p.sittingOut).length,
      position: this._getPosition(game, playerIdx),
      dealerIndex: game.dealerIndex,
      playerIndex: playerIdx,
      handStrength,
      preflopStrength,
      availableActions,
      bigBlind: game.bigBlind,
      smallBlind: game.smallBlind
    };
  }

  /**
   * Compute hand quality (0-1) from input.
   */
  _computeQuality(input) {
    if (input.street === 'preflop') {
      return input.preflopStrength;
    } else if (input.handStrength) {
      return this._handRankToQuality(input.handStrength);
    }
    return 0.3; // default mediocre
  }

  /**
   * Map quality score to label.
   */
  _qualityToLabel(quality) {
    if (quality >= QUALITY_TIERS.very_strong) return 'very_strong';
    if (quality >= QUALITY_TIERS.strong) return 'strong';
    if (quality >= QUALITY_TIERS.medium) return 'medium';
    if (quality >= QUALITY_TIERS.marginal) return 'marginal';
    return 'weak';
  }

  /**
   * Compute action probability distribution with personality/position/pot-odds adjustments.
   * Returns { fold, check, call, raise } summing to 1.0
   */
  computeActionMix(input, quality, pConfig) {
    const label = this._qualityToLabel(quality);
    const mix = { ...BASE_ACTION_PROBS[label] };
    const w = pConfig.actionWeights;

    // 1. Personality boosts
    mix.raise *= w.raiseBoost;
    mix.call *= w.callBoost;
    mix.fold *= w.foldBoost;

    // 2. Bluff boost (weak/marginal hands get extra raise weight)
    if (label === 'weak' || label === 'marginal') {
      mix.raise *= w.bluffBoost;
    }

    // 3. Slowplay boost (strong/very_strong hands get extra check/call weight)
    if (label === 'very_strong' || label === 'strong') {
      mix.check *= w.slowplayBoost;
      mix.call *= w.slowplayBoost;
    }

    // 4. Position adjustment: late position favors raising
    const latePositions = ['dealer', 'late'];
    if (latePositions.includes(input.position)) {
      mix.raise *= 1.15;
      mix.fold *= 0.85;
    }

    // 5. Pot odds adjustment
    if (input.callAmount > 0 && input.potSize > 0) {
      const potOdds = input.callAmount / (input.potSize + input.callAmount);
      if (potOdds > 0.35) {
        // Expensive to call relative to pot — increase fold, decrease call
        mix.fold *= 1.3;
        mix.call *= 0.7;
      } else if (potOdds < 0.15) {
        // Very cheap to call — decrease fold, increase call
        mix.fold *= 0.6;
        mix.call *= 1.4;
      }
    }

    // 6. Short stack: chips < 5BB → push/fold simplification
    if (input.playerChips < input.bigBlind * 5) {
      // Polarize to raise (push) or fold
      mix.raise += mix.call * 0.7 + mix.check * 0.5;
      mix.fold += mix.call * 0.3 + mix.check * 0.5;
      mix.call = 0;
      mix.check = 0;
    }

    // 7. Legality adjustments
    const canCheck = input.availableActions.includes('check') ||
      (input.currentBet <= input.playerBet);
    const canRaise = !!input.availableActions.find(a => a.action === 'raise');
    const needsCall = input.callAmount > 0 && input.currentBet > input.playerBet;

    if (!canCheck && !needsCall) {
      // Can't check and nothing to call — shouldn't happen, but transfer to fold
      mix.fold += mix.check;
      mix.check = 0;
    } else if (!canCheck && needsCall) {
      // Can't check (there's a bet) — transfer check weight to call
      mix.call += mix.check;
      mix.check = 0;
    } else if (canCheck && !needsCall) {
      // Can check (no bet to match) — transfer fold weight to check
      mix.check += mix.fold;
      mix.fold = 0;
    }

    if (!canRaise) {
      mix.call += mix.raise;
      mix.raise = 0;
    }

    // 8. Normalize
    const total = mix.fold + mix.check + mix.call + mix.raise;
    if (total > 0) {
      mix.fold /= total;
      mix.check /= total;
      mix.call /= total;
      mix.raise /= total;
    } else {
      // Shouldn't happen, but default to check/fold
      mix.fold = canCheck ? 0 : 1;
      mix.check = canCheck ? 1 : 0;
    }

    return mix;
  }

  /**
   * Weighted random sample from action probability distribution.
   * @returns {'fold'|'check'|'call'|'raise'}
   */
  sampleAction(mix) {
    const rand = Math.random();
    let cumulative = 0;
    for (const action of ['fold', 'check', 'call', 'raise']) {
      cumulative += mix[action];
      if (rand < cumulative) return action;
    }
    return 'fold'; // fallback (rounding edge case)
  }

  /**
   * Compute raise amount by sampling from sizing tiers with jitter.
   * @returns {number} raise-to amount, clamped to legal range
   */
  computeRaiseSizing(input, pConfig, quality) {
    const { potSize, currentBet, bigBlind, availableActions } = input;
    const raiseInfo = availableActions.find(a => a.action === 'raise');
    if (!raiseInfo) return null;

    // 1. Sample a tier from sizingTiers by weight
    const tiers = pConfig.sizingTiers;
    const totalWeight = tiers.reduce((s, t) => s + t.weight, 0);
    let rand = Math.random() * totalWeight;
    let selectedFraction = tiers[0].fraction;
    for (const tier of tiers) {
      rand -= tier.weight;
      if (rand <= 0) {
        selectedFraction = tier.fraction;
        break;
      }
    }

    // 2. Base amount = currentBet + fraction * potSize
    let amount = currentBet + selectedFraction * potSize;

    // 3. Jitter: ±jitterRange
    const jitter = 1 + (Math.random() * 2 - 1) * pConfig.jitterRange;
    amount *= jitter;

    // 4. Round to nearest bigBlind
    amount = Math.round(amount / bigBlind) * bigBlind;

    // 5. Clamp to legal range
    amount = Math.max(raiseInfo.min, Math.min(raiseInfo.max, amount));

    return amount;
  }

  /**
   * Directive LLM call: action is already decided, LLM provides reasoning
   * and optionally tunes raise amount within the given range.
   */
  async decideWithLLM(input, context) {
    const baseUrl = `${aiConfig.endpoint}/openai/v1`;
    const apiKey = aiConfig.apiKey;
    const model = aiConfig.model;

    const { personality, actionMix, sampledAction, samplingContext,
            targetSizing, sizingRange, quality, qualityLabel } = context;

    const instructions = this._buildLLMInstructions(personality, sampledAction);
    const userInput = this._buildLLMInput(input, context);

    try {
      _llmLog('--- REQUEST ---');
      _llmLog('model:', model);
      _llmLog('sampledAction:', sampledAction);
      _llmLog('actionMix:', JSON.stringify(actionMix));
      _llmLog('instructions:', instructions);
      _llmLog('input:', userInput);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const url = `${baseUrl.replace(/\/+$/, '')}/responses`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.7,
          instructions,
          input: userInput
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!res.ok) {
        console.log(`[AI] LLM HTTP error ${res.status}, using sampled action without LLM`);
        return null;
      }

      const data = await res.json();
      const text = this._extractResponseText(data);
      _llmLog('--- RESPONSE ---');
      _llmLog('raw text:', text || '(empty)');

      if (!text) {
        console.log('[AI] LLM returned empty response, using sampled action');
        return null;
      }

      const parsed = this._parseLLMResponse(text);
      _llmLog('parsed:', parsed ? JSON.stringify(parsed) : '(parse failed)');
      return parsed;
    } catch (err) {
      const reason = err.name === 'AbortError' ? 'timeout' : err.message;
      console.log(`[AI] LLM call failed (${reason}), using sampled action`);
      return null;
    }
  }

  /**
   * Build directive system instructions for the LLM.
   */
  _buildLLMInstructions(personality, sampledAction) {
    const lines = [
      '你是一个poker AI的思维引擎。动作已经由代码层通过概率抽样决定，你的任务是：',
      `1. 用一句中文解释这个决定的思考过程（参考性格和局面，生成自然的"真人式"理由）`,
      `2. 如果动作是raise，在给定的sizingRange范围内给出具体金额（可微调targetSizing）`,
      '',
      '【重要】你不能改变已决定的动作，只能提供理由和微调raise金额。',
      '',
      '【输出格式】',
      '输出一个JSON对象，不要输出其他内容：',
      '{"amount": <number or null>, "reasoning": "一句话中文理由"}'
    ];

    if (personality) {
      lines.push('');
      lines.push(`【性格】${personality.name}：${personality.description || personality.instruction}`);
    }

    return lines.join('\n');
  }

  /**
   * Build directive user input for the LLM with full decision context.
   */
  _buildLLMInput(input, context) {
    const { personality, actionMix, sampledAction, samplingContext,
            targetSizing, sizingRange, qualityLabel } = context;

    const state = {
      street: input.street,
      publicCards: input.publicCards,
      holeCards: input.holeCards,
      potSize: input.potSize,
      currentBet: input.currentBet,
      playerBet: input.playerBet,
      playerChips: input.playerChips,
      callAmount: input.callAmount,
      playersInHand: input.playersInHand,
      position: input.position,
      bigBlind: input.bigBlind,
      // Decision context
      personality: personality ? personality.name : '均衡',
      handQualityLabel: qualityLabel,
      actionMix: {
        fold: +actionMix.fold.toFixed(2),
        check: +actionMix.check.toFixed(2),
        call: +actionMix.call.toFixed(2),
        raise: +actionMix.raise.toFixed(2)
      },
      sampledAction,
      samplingContext,
      targetSizing: targetSizing || null,
      sizingRange: sizingRange || null
    };

    return JSON.stringify(state);
  }

  /**
   * Extract text content from Azure OpenAI Responses API output.
   */
  _extractResponseText(data) {
    if (data.output && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === 'message' && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part.type === 'output_text' && part.text) return part.text;
          }
        }
      }
    }
    if (data.output_text) return data.output_text;
    return null;
  }

  /**
   * Parse LLM response: { amount, reasoning }
   * LLM no longer decides the action, only provides reasoning and optional amount tuning.
   */
  _parseLLMResponse(text) {
    const jsonMatches = text.match(/\{[^{}]*\}/g);
    if (!jsonMatches || jsonMatches.length === 0) return null;
    const jsonStr = jsonMatches[jsonMatches.length - 1];

    try {
      const obj = JSON.parse(jsonStr);
      return {
        amount: typeof obj.amount === 'number' ? obj.amount : null,
        reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : null
      };
    } catch {
      return null;
    }
  }

  /**
   * Validate that the decided action is legal.
   * @returns {boolean}
   */
  validateAction(decision, input) {
    if (!decision || !decision.action) return false;

    const { action, amount } = decision;
    const { availableActions, currentBet, playerBet, playerChips } = input;

    const validActions = ['fold', 'check', 'call', 'raise', 'allin'];
    if (!validActions.includes(action)) return false;

    if (action === 'fold') return true;

    if (action === 'check') {
      return availableActions.includes('check') || currentBet <= playerBet;
    }

    if (action === 'call') {
      const callInfo = availableActions.find(a => a.action === 'call');
      return !!callInfo || (currentBet > playerBet && playerChips > 0);
    }

    if (action === 'raise') {
      const raiseInfo = availableActions.find(a => a.action === 'raise');
      if (!raiseInfo || amount == null) return false;
      return amount >= raiseInfo.min && amount <= raiseInfo.max;
    }

    if (action === 'allin') {
      return playerChips > 0;
    }

    return false;
  }

  /**
   * Safe fallback when validateAction fails: check → call → fold.
   */
  _safeFallback(input) {
    const { availableActions, currentBet, playerBet, callAmount } = input;

    // Try check
    if (availableActions.includes('check') || currentBet <= playerBet) {
      return { action: 'check', amount: null, meta: { source: 'safeFallback' } };
    }

    // Try call
    if (callAmount > 0) {
      return { action: 'call', amount: null, meta: { source: 'safeFallback' } };
    }

    // Fold
    return { action: 'fold', amount: null, meta: { source: 'safeFallback' } };
  }

  // --- Helper methods ---

  /**
   * Rough pre-flop hand strength estimator (0-1).
   */
  _estimatePreflopStrength(hand) {
    if (hand.length !== 2) return 0.3;

    const r1 = hand[0].value;
    const r2 = hand[1].value;
    const suited = hand[0].suit === hand[1].suit;
    const paired = r1 === r2;

    let score = 0;

    if (paired) {
      score = 0.5 + (r1 - 2) * 0.042;
    } else {
      const high = Math.max(r1, r2);
      const low = Math.min(r1, r2);
      const gap = high - low;

      score = (high + low) / 28;
      if (suited) score += 0.06;
      if (gap <= 2) score += 0.04;
      if (gap >= 5) score -= 0.05;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Convert HandEvaluator result to 0-1 quality scale.
   */
  _handRankToQuality(evalResult) {
    const rank = evalResult.score[0];
    const rankMap = {
      1: 0.15, // high card
      2: 0.35, // pair
      3: 0.55, // two pair
      4: 0.65, // three of a kind
      5: 0.75, // straight
      6: 0.78, // flush
      7: 0.85, // full house
      8: 0.92, // four of a kind
      9: 0.98  // straight flush
    };
    return rankMap[rank] || 0.2;
  }

  /**
   * Determine position label for the AI player.
   */
  _getPosition(game, playerIdx) {
    const inHand = game.getPlayersInHand();
    const n = inHand.length;
    if (n <= 1) return 'unknown';

    const dealerSeat = game.players[game.dealerIndex]?.seat;
    const playerSeat = game.players[playerIdx]?.seat;

    const seats = inHand.map(p => p.seat).sort((a, b) => a - b);
    const dealerPos = seats.indexOf(dealerSeat);
    const playerPos = seats.indexOf(playerSeat);

    const relPos = ((playerPos - dealerPos) + n) % n;

    if (relPos === 0) return 'dealer';
    if (relPos === 1) return n === 2 ? 'bb' : 'sb';
    if (relPos === 2 && n > 2) return 'bb';
    if (relPos <= Math.floor(n / 3) + 2) return 'early';
    if (relPos <= Math.floor(2 * n / 3) + 1) return 'middle';
    return 'late';
  }
}

module.exports = { AIDecisionEngine, AI_NAMES, AI_PERSONALITIES, getRandomPersonality };
