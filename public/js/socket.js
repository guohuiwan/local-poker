// Socket.IO connection wrapper with auto-reconnect
class SocketClient {
  constructor() {
    this.socket = null;
    this.playerId = null;
    this.roomId = null;
    this.playerName = null;
  }

  connect() {
    this.socket = io({
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    let initialConnect = true;

    this.socket.on('connect', () => {
      console.log('Connected:', this.socket.id);
      // On reconnect (not initial), try to rejoin room
      if (!initialConnect && this.roomId && this.playerName) {
        this.socket.emit('room:join', {
          playerName: this.playerName,
          roomId: this.roomId
        }, (res) => {
          if (res.success) {
            this.playerId = res.playerId;
            console.log('Reconnected to room');
          }
        });
      }
      initialConnect = false;
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected');
    });

    return this.socket;
  }

  getSocket() {
    if (!this.socket) this.connect();
    return this.socket;
  }

  setSession(roomId, playerId, playerName) {
    this.roomId = roomId;
    this.playerId = playerId;
    this.playerName = playerName;
    // Store in sessionStorage for page navigation
    sessionStorage.setItem('poker_roomId', roomId);
    sessionStorage.setItem('poker_playerId', playerId);
    sessionStorage.setItem('poker_playerName', playerName);
  }

  restoreSession() {
    this.roomId = sessionStorage.getItem('poker_roomId');
    this.playerId = sessionStorage.getItem('poker_playerId');
    this.playerName = sessionStorage.getItem('poker_playerName');
    return !!(this.roomId && this.playerName);
  }

  clearSession() {
    this.roomId = null;
    this.playerId = null;
    this.playerName = null;
    sessionStorage.removeItem('poker_roomId');
    sessionStorage.removeItem('poker_playerId');
    sessionStorage.removeItem('poker_playerName');
  }
}

// Global instance
const socketClient = new SocketClient();
