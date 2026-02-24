/**
 * AI Player Manager
 *
 * Manages AI player lifecycle within rooms:
 *   - Adding/removing AI players to rooms
 *   - Detecting when it's an AI player's turn
 *   - Triggering AI decisions with a realistic delay
 *   - Bridging AI actions into the game engine
 */

const { AIDecisionEngine, AI_NAMES, getRandomPersonality } = require('./AIDecisionEngine');

// AI player IDs use this prefix for easy identification
const AI_ID_PREFIX = 'ai_';
const AI_THINK_DELAY_MIN = 0;  // ms — minimum "thinking" time
const AI_THINK_DELAY_MAX = 0;  // ms — maximum "thinking" time

// AI chat messages by personality
const AI_CHAT_MESSAGES = {
  balanced: [
    '这手牌看起来不错',
    '让我想想...',
    '这把很有意思',
    '我看好这一手',
    '这个底池不错',
    '稳扎稳打',
    '等待时机',
    '这一局很精彩',
    '保持冷静',
    '祝大家好运'
  ],
  bluffer: [
    '谁在诈唬？',
    '吓唬不了我',
    '这把我要搞点事情',
    '嘿嘿，有意思',
    '你们以为我有好牌？',
    '诈唬的艺术',
    '这一把看你们怎么应对',
    '诈唬大师在此',
    '有时候得靠演技'
  ],
  aggressive: [
    '干！',
    '别怂',
    '这把要大干一场',
    '谁怕谁',
    '加注才是王道',
    '激进是我的风格',
    '要的就是刺激',
    '别跟我比加注',
    '这把我要赢了',
    '干到底'
  ]
};

class AIPlayerManager {
  constructor(io) {
    this.engine = new AIDecisionEngine();
    this.io = io; // Socket.IO instance for chat broadcasting
    // Track AI players per room: roomId -> Set<playerId>
    this.aiPlayers = new Map();
    // Track AI personalities per room: roomId -> Map<playerId, personality>
    this.aiPersonalities = new Map();
    // Track pending AI action timers: roomId -> timeoutId
    this.pendingActions = new Map();
    // Track AI chat cooldowns: roomId -> Map<playerId, lastChatTime>
    this.chatCooldowns = new Map();
    // Counter for unique AI IDs
    this._nextId = 1;
    // Chat cooldown: minimum 15 seconds between AI messages
    this.CHAT_COOLDOWN = 15000;
  }

  /**
   * Add an AI player to a room.
   * @param {Room} room
   * @returns {{ success: boolean, error?: string, aiPlayer?: object }}
   */
  addAIPlayer(room) {
    const currentAIs = this.getAIPlayers(room.id);
    if (currentAIs.size >= 2) {
      return { success: false, error: '最多添加2个AI玩家' };
    }

    if (room.players.size >= room.maxPlayers) {
      return { success: false, error: '房间已满' };
    }

    const aiId = `${AI_ID_PREFIX}${this._nextId++}`;
    const nameIdx = currentAIs.size;
    const aiName = AI_NAMES[nameIdx] || `AI_${nameIdx + 1}`;

    // Assign random personality
    const personality = getRandomPersonality();

    // Add to room (AI uses its own ID as socketId — it won't actually use sockets)
    const result = room.addPlayer(aiId, aiName, aiId);
    if (!result.success) {
      return result;
    }

    // Track this AI
    this.aiPlayers.set(room.id, (this.aiPlayers.get(room.id) || new Set()).add(aiId));

    // Track personality
    if (!this.aiPersonalities.has(room.id)) {
      this.aiPersonalities.set(room.id, new Map());
    }
    this.aiPersonalities.get(room.id).set(aiId, personality);

    // Log personality
    console.log(`[AI][LLM] AI玩家 ${aiName} (${aiId}) 添加，性格：${personality.name}`);

    return { success: true, aiPlayer: { id: aiId, name: aiName, seat: result.seat } };
  }

  /**
   * Remove an AI player from a room.
   */
  removeAIPlayer(room, aiPlayerId) {
    if (!this.isAIPlayer(aiPlayerId)) {
      return { success: false, error: '不是AI玩家' };
    }

    room.removePlayer(aiPlayerId);

    const roomAIs = this.aiPlayers.get(room.id);
    if (roomAIs) {
      roomAIs.delete(aiPlayerId);
      if (roomAIs.size === 0) this.aiPlayers.delete(room.id);
    }

    // Clean up personality data
    const roomPersonalities = this.aiPersonalities.get(room.id);
    if (roomPersonalities) {
      roomPersonalities.delete(aiPlayerId);
      if (roomPersonalities.size === 0) this.aiPersonalities.delete(room.id);
    }

    return { success: true };
  }

  /**
   * Check if a player ID belongs to an AI.
   */
  isAIPlayer(playerId) {
    return typeof playerId === 'string' && playerId.startsWith(AI_ID_PREFIX);
  }

  /**
   * Get the set of AI player IDs in a room.
   */
  getAIPlayers(roomId) {
    return this.aiPlayers.get(roomId) || new Set();
  }

  /**
   * Check if the current player is an AI and schedule its action.
   * Call this after every state change / action in the game.
   *
   * @param {Room} room
   * @param {Function} onActionReady - callback(playerId, action, amount) when AI decides
   */
  checkAndScheduleAIAction(room, onActionReady) {
    if (!room.game) return;

    const game = room.game;
    if (game.stage === 'WAITING' || game.stage === 'SHOWDOWN') return;

    const currentIdx = game.currentPlayerIndex;
    if (currentIdx < 0 || currentIdx >= game.players.length) return;

    const currentPlayer = game.players[currentIdx];
    if (!currentPlayer || !this.isAIPlayer(currentPlayer.id)) return;
    if (currentPlayer.folded || currentPlayer.allIn || currentPlayer.sittingOut) return;

    // Clear any existing pending action for this room
    this.clearPendingAction(room.id);

    // Schedule AI action with a realistic delay
    const delay = AI_THINK_DELAY_MIN + Math.random() * (AI_THINK_DELAY_MAX - AI_THINK_DELAY_MIN);
    const playerId = currentPlayer.id;

    // Get AI personality
    const personality = this.aiPersonalities.get(room.id)?.get(playerId);

    // Random chance to chat during the turn (10% chance)
    if (personality && Math.random() < 0.10) {
      this.sendAIMessage(room.id, playerId, currentPlayer.name, personality.id);
    }

    const timer = setTimeout(async () => {
      this.pendingActions.delete(room.id);

      // Double-check it's still this AI's turn
      if (!room.game || room.game.stage === 'WAITING' || room.game.stage === 'SHOWDOWN') return;
      const stillCurrent = room.game.players[room.game.currentPlayerIndex];
      if (!stillCurrent || stillCurrent.id !== playerId) return;

      // Make decision (async — may call LLM)
      const decision = await this.engine.decide(room.game, playerId, personality);
      console.log(`[AI] ${currentPlayer.name} decides: ${decision.action}${decision.amount != null ? ` ${decision.amount}` : ''} (${JSON.stringify(decision.meta)})`);

      onActionReady(playerId, decision.action, decision.amount);
    }, delay);

    this.pendingActions.set(room.id, timer);
  }

  /**
   * Clear any pending AI action for a room.
   */
  clearPendingAction(roomId) {
    const timer = this.pendingActions.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.pendingActions.delete(roomId);
    }
  }

  /**
   * Send a chat message from AI player.
   * @param {string} roomId
   * @param {string} aiPlayerId
   * @param {string} aiPlayerName
   * @param {string} personalityId
   */
  sendAIMessage(roomId, aiPlayerId, aiPlayerName, personalityId) {
    // Check cooldown
    if (!this.chatCooldowns.has(roomId)) {
      this.chatCooldowns.set(roomId, new Map());
    }
    const roomCooldowns = this.chatCooldowns.get(roomId);
    const lastChat = roomCooldowns.get(aiPlayerId);
    const now = Date.now();

    if (lastChat && (now - lastChat) < this.CHAT_COOLDOWN) {
      return; // Too soon to chat again
    }

    // Update last chat time
    roomCooldowns.set(aiPlayerId, now);

    // Get message pool for this personality
    const messages = AI_CHAT_MESSAGES[personalityId] || AI_CHAT_MESSAGES.balanced;

    // Random message
    const message = messages[Math.floor(Math.random() * messages.length)];

    // Broadcast chat message
    this.io.to(roomId).emit('chat:message', {
      playerId: aiPlayerId,
      playerName: aiPlayerName,
      message: message,
      timestamp: now,
      isAI: true
    });

    console.log(`[AI][Chat] ${aiPlayerName}: ${message}`);
  }

  /**
   * Clean up all AI state for a room (when room is destroyed).
   */
  cleanupRoom(roomId) {
    this.clearPendingAction(roomId);
    this.aiPlayers.delete(roomId);
    this.aiPersonalities.delete(roomId);
    this.chatCooldowns.delete(roomId);
  }
}

// Singleton instance - needs io parameter
let aiPlayerManagerInstance = null;

function aiPlayerManager(io) {
  if (!aiPlayerManagerInstance) {
    aiPlayerManagerInstance = new AIPlayerManager(io);
  }
  return aiPlayerManagerInstance;
}

module.exports = { aiPlayerManager, AIPlayerManager, AI_ID_PREFIX };
