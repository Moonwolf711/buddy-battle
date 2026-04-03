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
  // 4 bytes = 8 hex chars = ~4.3 billion possibilities
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// HTTP server for health checks + room list
const httpServer = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/health') {
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.size, uptime: process.uptime() }));
  } else if (req.url === '/rooms') {
    // Only show room count and status — never expose room codes publicly
    // Room codes should only be shared out-of-band between players
    const roomList = [];
    for (const [code, room] of rooms) {
      roomList.push({
        players: room.players.length,
        status: room.status,
      });
    }
    res.end(JSON.stringify({ count: roomList.length, rooms: roomList }));
  } else {
    res.end(JSON.stringify({
      name: 'buddy-battle-relay',
      version: '1.0.0',
      ws: `ws://${req.headers.host}`,
    }));
  }
});

// WebSocket server — limit payload to 16KB to prevent memory exhaustion
const wss = new WebSocket.Server({ server: httpServer, maxPayload: 16 * 1024 });

// Rate limiting: max 20 messages per 5 seconds per connection
const RATE_WINDOW = 5000;
const RATE_MAX = 20;

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws._msgCount = 0;
  ws._msgWindowStart = Date.now();
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    // Rate limiting
    const now = Date.now();
    if (now - ws._msgWindowStart > RATE_WINDOW) {
      ws._msgCount = 0;
      ws._msgWindowStart = now;
    }
    ws._msgCount++;
    if (ws._msgCount > RATE_MAX) {
      send(ws, { type: 'error', message: 'Rate limited. Slow down.' });
      return;
    }

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

// Limit rooms per IP/connection to prevent room flooding
const MAX_ROOMS_TOTAL = 100;

// Basic input sanitization: ensure string fields are strings, truncate length
function sanitizeString(val, maxLen = 50) {
  if (typeof val !== 'string') return '';
  return val.slice(0, maxLen).replace(/[^\x20-\x7E]/g, '');
}

// Validate buddy stats are reasonable numbers
function sanitizeBuddyData(buddy) {
  if (!buddy || typeof buddy !== 'object') return null;
  return {
    species: sanitizeString(buddy.species, 30),
    nickname: sanitizeString(buddy.nickname, 30),
    type: sanitizeString(buddy.type, 20),
    level: Math.max(1, Math.min(20, parseInt(buddy.level) || 1)),
    stats: {
      hp: Math.max(1, Math.min(500, parseInt(buddy.stats?.hp) || 100)),
      atk: Math.max(1, Math.min(100, parseInt(buddy.stats?.atk) || 10)),
      def: Math.max(1, Math.min(100, parseInt(buddy.stats?.def) || 10)),
      spd: Math.max(1, Math.min(100, parseInt(buddy.stats?.spd) || 10)),
    },
    skills: Array.isArray(buddy.skills) ? buddy.skills.slice(0, 4) : [],
  };
}

function handleMessage(ws, msg) {
  // Validate msg.type is a known type
  const VALID_TYPES = ['create_room', 'join_room', 'ready', 'move', 'battle_result', 'chat'];
  if (!msg || typeof msg.type !== 'string' || !VALID_TYPES.includes(msg.type)) {
    send(ws, { type: 'error', message: 'Unknown message type' });
    return;
  }

  switch (msg.type) {
    case 'create_room': {
      // Prevent room flooding
      if (rooms.size >= MAX_ROOMS_TOTAL) {
        send(ws, { type: 'error', message: 'Server is full. Try again later.' });
        return;
      }
      // Prevent one client from creating multiple rooms
      if (ws._roomCode) {
        send(ws, { type: 'error', message: 'You already have a room.' });
        return;
      }
      const code = generateCode();
      const name = sanitizeString(msg.name, 30) || 'Player';
      rooms.set(code, {
        players: [{ ws, name, buddy: sanitizeBuddyData(msg.buddy), stake: msg.stake || null, ready: false, move: null }],
        status: 'waiting',
        createdAt: Date.now(),
        battleState: null,
        turnCount: 0,
      });
      ws._roomCode = code;
      ws._playerIndex = 0;
      send(ws, { type: 'room_created', code });
      console.log(`Room ${code} created by ${name}`);
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

      const joinName = sanitizeString(msg.name, 30) || 'Player';
      room.players.push({ ws, name: joinName, buddy: sanitizeBuddyData(msg.buddy), stake: msg.stake || null, ready: false, move: null });
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
      player.buddy = sanitizeBuddyData(msg.buddy) || player.buddy;

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
      // Only allow battle_result once per room, and only during battling
      if (room.status !== 'battling') return;
      room.status = 'finished';
      // Sanitize winner/loser names — relay only, don't trust winner index from client
      // NOTE: The relay is stateless (no game logic), so both clients resolve
      // the battle locally. This message is informational only.
      const sanitizedWinner = sanitizeString(msg.winner, 30);
      const sanitizedLoser = sanitizeString(msg.loser, 30);
      broadcast(room, {
        type: 'battle_end',
        winner: sanitizedWinner,
        loser: sanitizedLoser,
        winnerIndex: typeof msg.winnerIndex === 'number' ? (msg.winnerIndex === 0 ? 0 : 1) : 0,
      });
      console.log(`Room ${ws._roomCode}: Battle ended. ${sanitizedWinner} wins!`);
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
