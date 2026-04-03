// WebSocket battle server — host creates a room, friend joins
const WebSocket = require('ws');
const crypto = require('crypto');
const { BattleEngine } = require('./battle');
const { getSkill } = require('./skills');

class BattleServer {
  constructor(port = 9876) {
    this.port = port;
    this.rooms = new Map();
    this.wss = null;
  }

  start() {
    return new Promise((resolve) => {
      this.wss = new WebSocket.Server({ port: this.port }, () => {
        resolve(this.port);
      });

      this.wss.on('connection', (ws) => {
        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            this.handleMessage(ws, msg);
          } catch (e) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
          }
        });

        ws.on('close', () => {
          // Clean up rooms where this player was
          for (const [code, room] of this.rooms) {
            const idx = room.players.findIndex(p => p.ws === ws);
            if (idx !== -1) {
              room.players.splice(idx, 1);
              // Notify other player
              for (const p of room.players) {
                p.ws.send(JSON.stringify({ type: 'opponent_left' }));
              }
              if (room.players.length === 0) {
                this.rooms.delete(code);
              }
            }
          }
        });
      });
    });
  }

  generateRoomCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
  }

  handleMessage(ws, msg) {
    switch (msg.type) {
      case 'create_room': {
        const code = this.generateRoomCode();
        this.rooms.set(code, {
          players: [{ ws, name: msg.name, buddy: msg.buddy, ready: false }],
          battle: null,
          moves: [null, null],
        });
        ws.send(JSON.stringify({ type: 'room_created', code }));
        break;
      }

      case 'join_room': {
        const room = this.rooms.get(msg.code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        if (room.players.length >= 2) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
          return;
        }
        room.players.push({ ws, name: msg.name, buddy: msg.buddy, ready: false });
        ws.send(JSON.stringify({ type: 'room_joined', code: msg.code }));

        // Notify both players
        for (const p of room.players) {
          p.ws.send(JSON.stringify({
            type: 'players_ready',
            players: room.players.map(pl => ({
              name: pl.name,
              buddy: pl.buddy.nickname || pl.buddy.species,
              species: pl.buddy.species,
              type: pl.buddy.type,
            })),
          }));
        }
        break;
      }

      case 'select_skills': {
        const room = this.findRoom(ws);
        if (!room) return;
        const player = room.players.find(p => p.ws === ws);
        player.buddy.skills = msg.skills;
        player.ready = true;

        // Check if both ready
        if (room.players.every(p => p.ready)) {
          this.startBattle(room);
        } else {
          ws.send(JSON.stringify({ type: 'waiting', message: 'Waiting for opponent to pick skills...' }));
        }
        break;
      }

      case 'move': {
        const room = this.findRoom(ws);
        if (!room || !room.battle) return;
        const idx = room.players.findIndex(p => p.ws === ws);
        if (idx === -1) return;

        const skill = getSkill(msg.skillId);
        room.moves[idx] = { skillId: msg.skillId, skill };

        // Check if both moved
        if (room.moves.every(m => m !== null)) {
          const result = room.battle.resolveTurn(room.moves[0], room.moves[1]);
          room.moves = [null, null];

          // Send state to each player
          for (let i = 0; i < 2; i++) {
            room.players[i].ws.send(JSON.stringify({
              type: 'turn_result',
              state: room.battle.getState(i),
              messages: result.messages,
            }));
          }

          // Handle winner
          if (result.winner !== null) {
            const winnerName = room.players[result.winner].name;
            const loserIdx = 1 - result.winner;
            const loserName = room.players[loserIdx].name;

            for (let i = 0; i < 2; i++) {
              room.players[i].ws.send(JSON.stringify({
                type: 'battle_end',
                winner: winnerName,
                loser: loserName,
                youWon: i === result.winner,
              }));
            }
          }
        } else {
          ws.send(JSON.stringify({ type: 'waiting', message: 'Waiting for opponent...' }));
        }
        break;
      }
    }
  }

  startBattle(room) {
    const p1 = {
      name: room.players[0].name,
      buddy: {
        ...room.players[0].buddy,
        maxHp: room.players[0].buddy.stats.hp,
      },
    };
    const p2 = {
      name: room.players[1].name,
      buddy: {
        ...room.players[1].buddy,
        maxHp: room.players[1].buddy.stats.hp,
      },
    };

    room.battle = new BattleEngine(p1, p2);

    for (let i = 0; i < 2; i++) {
      room.players[i].ws.send(JSON.stringify({
        type: 'battle_start',
        state: room.battle.getState(i),
      }));
    }
  }

  findRoom(ws) {
    for (const [, room] of this.rooms) {
      if (room.players.some(p => p.ws === ws)) return room;
    }
    return null;
  }

  stop() {
    if (this.wss) this.wss.close();
  }
}

module.exports = { BattleServer };
