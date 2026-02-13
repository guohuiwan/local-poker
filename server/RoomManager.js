const { Room } = require('./game/Room');

// Characters excluding confusing ones: I/O/0/1
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(options = {}) {
    const id = this._generateId();
    const room = new Room(id, options);
    this.rooms.set(id, room);
    return room;
  }

  getRoom(id) {
    return this.rooms.get(id) || null;
  }

  removeRoom(id) {
    this.rooms.delete(id);
  }

  cleanupEmpty() {
    for (const [id, room] of this.rooms) {
      if (room.isEmpty()) {
        this.rooms.delete(id);
      }
    }
  }

  _generateId() {
    let id;
    do {
      id = '';
      for (let i = 0; i < 6; i++) {
        id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
      }
    } while (this.rooms.has(id));
    return id;
  }
}

module.exports = { RoomManager };
