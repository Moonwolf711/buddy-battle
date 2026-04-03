#!/usr/bin/env node
// Public relay server — deployed to Railway
// Manages rooms, relays moves between players
// No game logic here — just message passing + room management

const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT) || 9877;

// Room storage
const rooms = new Map();

// Clean up stale rooms every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > 30 * 60 * 1000) { // 30 min timeout
      for (const p of room.players) {
        try { p.ws.close(); } catch {}
      }
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1000);

function generateCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// HTTP server for health checks + room list
const httpServer = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/health') {
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.size, uptime: process.uptime() }));
  } else if (req.url === '/rooms') {
    const roomList = [];
    for (const [code, room] of rooms) {
      roomList.push({
        code,
        players: room.players.length,
        status: room.status,
        createdAt: room.createdAt,
      });
    }
    res.end(JSON.stringify({ rooms: roomList }));
  } else {
    res.end(JSON.stringify({
      name: 'buddy-battle-relay',
      version: '1.0.0',
      ws: `ws://${req.headers.host}`,
    }));
  }
});

// WebSocket server
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleMessage(ws, msg);
    } catch (e) {
      send(ws, { type: 'error', message: 'Invalid message format' });
    }
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });
});

// Heartbeat — kill dead connections
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(room, msg, exclude = null) {
  for (const p of room.players) {
    if (p.ws !== exclude) send(p.ws, msg);
  }
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'create_room': {
      const code = generateCode();
      rooms.set(code, {
        players: [{ ws, name: msg.name, buddy: msg.buddy, stake: msg.stake || null, ready: false, move: null }],
        status: 'waiting',
        createdAt: Date.now(),
        battleState: null,
        turnCount: 0,
      });
      ws._roomCode = code;
      ws._playerIndex = 0;
      send(ws, { type: 'room_created', code });
      console.log(`Room ${code} created by ${msg.name}`);
      break;
    }

    case 'join_room': {
      const code = (msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) {
        send(ws, { type: 'error', message: `Room ${code} not found` });
        return;
      }
      if (room.players.length >= 2) {
        send(ws, { type: 'error', message: 'Room is full' });
        return;
      }

      room.players.push({ ws, name: msg.name, buddy: msg.buddy, stake: msg.stake || null, ready: false, move: null });
      ws._roomCode = code;
      ws._playerIndex = 1;
      room.status = 'matched';

      send(ws, { type: 'room_joined', code });

      // Notify both players
      const playerInfo = room.players.map(p => ({
        name: p.name,
        buddy: p.buddy,
        stake: p.stake,
      }));
      for (const p of room.players) {
        send(p.ws, { type: 'players_matched', players: playerInfo });
      }
      console.log(`Room ${code}: ${msg.name} joined. Battle ready!`);
      break;
    }

    case 'ready': {
      const room = rooms.get(ws._roomCode);
      if (!room) return;
      const player = room.players[ws._playerIndex];
      if (!player) return;

      player.ready = true;
      player.buddy = msg.buddy; // Updated buddy with skills

      if (room.players.every(p => p.ready)) {
        room.status = 'battling';
        room.turnCount = 0;
        // Tell both to start
        for (let i = 0; i < room.players.length; i++) {
          send(room.players[i].ws, {
            type: 'battle_start',
            playerIndex: i,
            players: room.players.map(p => ({
              name: p.name,
              buddy: p.buddy,
            })),
          });
        }
        console.log(`Room ${ws._roomCode}: Battle started!`);
      } else {
        send(ws, { type: 'waiting', message: 'Waiting for opponent to ready up...' });
      }
      break;
    }

    case 'move': {
      const room = rooms.get(ws._roomCode);
      if (!room || room.status !== 'battling') return;
      const player = room.players[ws._playerIndex];
      if (!player) return;

      player.move = msg.move; // { skillId, skill }
      room.turnCount++;

      // Check if both moved
      if (room.players.every(p => p.move !== null)) {
        // Relay both moves to both players for local resolution
        for (let i = 0; i < room.players.length; i++) {
          send(room.players[i].ws, {
            type: 'turn_moves',
            moves: [room.players[0].move, room.players[1].move],
          });
        }
        // Reset moves
        for (const p of room.players) p.move = null;
      } else {
        send(ws, { type: 'waiting', message: 'Waiting for opponent move...' });
      }
      break;
    }

    case 'battle_result': {
      const room = rooms.get(ws._roomCode);
      if (!room) return;
      // Player reports final result
      broadcast(room, {
        type: 'battle_end',
        winner: msg.winner,
        loser: msg.loser,
        winnerIndex: msg.winnerIndex,
      });
      room.status = 'finished';
      console.log(`Room ${ws._roomCode}: Battle ended. ${msg.winner} wins!`);
      break;
    }

    case 'chat': {
      const room = rooms.get(ws._roomCode);
      if (!room) return;
      broadcast(room, {
        type: 'chat',
        from: room.players[ws._playerIndex]?.name || 'Unknown',
        message: (msg.message || '').slice(0, 200),
      }, ws);
      break;
    }
  }
}

function handleDisconnect(ws) {
  const code = ws._roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;

  const idx = room.players.findIndex(p => p.ws === ws);
  if (idx === -1) return;

  const name = room.players[idx].name;
  room.players.splice(idx, 1);

  // Notify remaining player
  for (const p of room.players) {
    send(p.ws, { type: 'opponent_disconnected', name });
  }

  if (room.players.length === 0) {
    rooms.delete(code);
    console.log(`Room ${code} closed (empty)`);
  }
}

httpServer.listen(PORT, () => {
  console.log(`Buddy Battle Relay Server`);
  console.log(`  HTTP: http://0.0.0.0:${PORT}`);
  console.log(`  WS:   ws://0.0.0.0:${PORT}`);
  console.log(`  Health: http://0.0.0.0:${PORT}/health`);
});
