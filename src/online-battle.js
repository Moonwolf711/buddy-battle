#!/usr/bin/env node
// Non-interactive online multiplayer — works in Claude Code sessions
// Usage:
//   node online-battle.js host [--skills skill1,skill2,skill3,skill4]
//   node online-battle.js join ROOMCODE [--skills skill1,skill2,skill3,skill4]
//   node online-battle.js status
//   node online-battle.js rooms

const WebSocket = require('ws');
const chalk = require('chalk');
const { BUDDY_TYPES, getEffectiveness } = require('./buddies');
const { getSkillPool, getSkill } = require('./skills');
const { BattleEngine } = require('./battle');
const { renderBattleScreen, renderTitle, renderVictory, renderXpGain } = require('./ui');
const { awardXP, xpForLevel, MAX_LEVEL } = require('./leveling');
const { loadSave, saveBuddyProgress } = require('./save');

// Relay server URL — Railway deployment
const RELAY_URL = process.env.BUDDY_RELAY || 'wss://buddy-battle-relay-production.up.railway.app';
const HTTP_URL = RELAY_URL.replace('wss://', 'https://').replace('ws://', 'http://');

const args = process.argv.slice(2);
const command = args[0]; // host | join | status | rooms

// Parse --skills flag
let skillIds = null;
const skillsIdx = args.indexOf('--skills');
if (skillsIdx !== -1 && args[skillsIdx + 1]) {
  skillIds = args[skillsIdx + 1].split(',');
}

// Parse --name flag
let playerName = null;
const nameIdx = args.indexOf('--name');
if (nameIdx !== -1 && args[nameIdx + 1]) {
  playerName = args[nameIdx + 1];
}

function smartMoveAI(buddy, skills, enemyType) {
  const hp = buddy.stats.hp;
  const maxHp = buddy.maxHp;

  if (hp < maxHp * 0.25) {
    const heal = skills.find(s => s.effect?.heal);
    if (heal) return heal;
  }

  if (hp < maxHp * 0.4) {
    const shield = skills.find(s => s.effect?.shield);
    if (shield) return shield;
  }

  let best = skills[0];
  let bestScore = -1;
  for (const s of skills) {
    if (s.power <= 0) continue;
    const eff = getEffectiveness(s.type, enemyType);
    const stab = s.type === buddy.type ? 1.3 : 1.0;
    const score = s.power * eff * stab * (s.accuracy / 100);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

async function checkStatus() {
  try {
    const https = require('https');
    const http = require('http');
    const mod = HTTP_URL.startsWith('https') ? https : http;

    return new Promise((resolve) => {
      mod.get(`${HTTP_URL}/health`, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const info = JSON.parse(data);
            console.log(chalk.green(`  Relay server: ONLINE`));
            console.log(chalk.gray(`  Rooms active: ${info.rooms}`));
            console.log(chalk.gray(`  Uptime: ${Math.floor(info.uptime)}s`));
            console.log(chalk.gray(`  URL: ${RELAY_URL}`));
          } catch {
            console.log(chalk.green(`  Relay server: ONLINE (response: ${data})`));
          }
          resolve();
        });
      }).on('error', (err) => {
        console.log(chalk.red(`  Relay server: OFFLINE`));
        console.log(chalk.gray(`  URL: ${RELAY_URL}`));
        console.log(chalk.gray(`  Error: ${err.message}`));
        resolve();
      });
    });
  } catch (err) {
    console.log(chalk.red(`  Relay server: ERROR — ${err.message}`));
  }
}

async function listRooms() {
  try {
    const https = require('https');
    const http = require('http');
    const mod = HTTP_URL.startsWith('https') ? https : http;

    return new Promise((resolve) => {
      mod.get(`${HTTP_URL}/rooms`, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          const info = JSON.parse(data);
          if (info.rooms.length === 0) {
            console.log(chalk.gray('  No active rooms. Host one with: node online-battle.js host'));
          } else {
            console.log(chalk.bold(`  Active Rooms (${info.rooms.length}):\n`));
            for (const r of info.rooms) {
              const status = r.players < 2 ? chalk.green('OPEN') : chalk.yellow(r.status);
              console.log(`  ${chalk.yellow(r.code)} — ${r.players}/2 players — ${status}`);
            }
          }
          resolve();
        });
      }).on('error', (err) => {
        console.log(chalk.red(`  Cannot reach relay: ${err.message}`));
        resolve();
      });
    });
  } catch (err) {
    console.log(chalk.red(`  Error: ${err.message}`));
  }
}

async function runOnlineBattle(isHost, roomCode) {
  // Load save
  const save = loadSave();
  if (!save || !save.species) {
    console.log(chalk.red('  No saved buddy! Run a practice battle first:'));
    console.log(chalk.gray('  node src/auto-battle.js --pick octopus Marblisk ink_blast,sql_inject,sandbox,patch_vuln --auto'));
    process.exit(1);
  }

  const species = save.species;
  const nickname = save.nickname;
  const name = playerName || process.env.USER || 'Player';

  // Auto-pick skills if not specified
  if (!skillIds) {
    const pool = getSkillPool(species);
    const inject = pool.filter(s => s.category === 'inject').slice(0, 2);
    const defend = pool.filter(s => s.category === 'defend').slice(0, 1);
    const util = pool.filter(s => s.category === 'utility').slice(0, 1);
    const picked = [...inject, ...defend, ...util];
    while (picked.length < 4 && picked.length < pool.length) {
      const next = pool.find(s => !picked.includes(s));
      if (next) picked.push(next); else break;
    }
    skillIds = picked.map(s => s.id);
  }

  const skills = skillIds.map(id => getSkill(id)).filter(Boolean);
  if (skills.length !== 4) {
    console.log(chalk.red('  Need exactly 4 valid skills!'));
    process.exit(1);
  }

  const buddy = {
    species,
    nickname,
    type: BUDDY_TYPES[species].type,
    stats: { ...save.stats },
    level: save.level || 1,
    xp: save.xp || 0,
    maxHp: save.stats.hp,
    skills,
  };

  console.log(chalk.bold(`\n  ${BUDDY_TYPES[species].emoji} ${nickname} Lv.${buddy.level} ready for online battle!`));
  console.log(chalk.gray(`  Connecting to relay: ${RELAY_URL}\n`));

  return new Promise((resolve) => {
    const ws = new WebSocket(RELAY_URL);
    let opponent = null;
    let battle = null;
    let myIndex = -1;
    let waitTimeout = null;

    ws.on('error', (err) => {
      console.log(chalk.red(`  Connection failed: ${err.message}`));
      console.log(chalk.gray('  Is the relay server running? Check: node online-battle.js status'));
      resolve();
    });

    ws.on('open', () => {
      if (isHost) {
        ws.send(JSON.stringify({
          type: 'create_room',
          name,
          buddy: { species, nickname, type: buddy.type, level: buddy.level, stats: { ...buddy.stats } },
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'join_room',
          code: roomCode,
          name,
          buddy: { species, nickname, type: buddy.type, level: buddy.level, stats: { ...buddy.stats } },
        }));
      }
    });

    // 5 minute timeout for waiting
    function startWaitTimeout() {
      waitTimeout = setTimeout(() => {
        console.log(chalk.yellow('\n  Timed out waiting (5 min). Room closed.'));
        ws.close();
        resolve();
      }, 5 * 60 * 1000);
    }

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case 'room_created':
          console.log(chalk.bold.green(`  Room created: ${chalk.yellow.bold(msg.code)}`));
          console.log(chalk.white(`\n  Share this with your opponent:`));
          console.log(chalk.cyan(`  /buddy-battle --join ${msg.code}\n`));
          console.log(chalk.gray('  Waiting for opponent to join...'));
          startWaitTimeout();
          break;

        case 'room_joined':
          console.log(chalk.green(`  Joined room ${chalk.yellow(msg.code)}!`));
          break;

        case 'players_matched':
          if (waitTimeout) clearTimeout(waitTimeout);
          opponent = msg.players.find(p => p.name !== name) || msg.players[1];
          console.log(chalk.bold.yellow(`\n  Opponent found: ${opponent.name}`));
          console.log(chalk.gray(`  ${BUDDY_TYPES[opponent.buddy.species]?.emoji || '?'} ${opponent.buddy.nickname} (${opponent.buddy.type}) Lv.${opponent.buddy.level || '?'}\n`));

          // Send ready with full buddy data
          ws.send(JSON.stringify({
            type: 'ready',
            buddy: { species, nickname, type: buddy.type, level: buddy.level, stats: { ...buddy.stats }, skills },
          }));
          break;

        case 'waiting':
          console.log(chalk.gray(`  ${msg.message}`));
          break;

        case 'battle_start': {
          myIndex = msg.playerIndex;
          const p1data = msg.players[0];
          const p2data = msg.players[1];

          const p1 = {
            name: p1data.name,
            buddy: {
              species: p1data.buddy.species,
              nickname: p1data.buddy.nickname,
              type: p1data.buddy.type,
              level: p1data.buddy.level || 1,
              stats: { ...p1data.buddy.stats },
              maxHp: p1data.buddy.stats.hp,
              skills: (p1data.buddy.skills || []).map(s => typeof s === 'string' ? getSkill(s) : s),
            },
          };
          const p2 = {
            name: p2data.name,
            buddy: {
              species: p2data.buddy.species,
              nickname: p2data.buddy.nickname,
              type: p2data.buddy.type,
              level: p2data.buddy.level || 1,
              stats: { ...p2data.buddy.stats },
              maxHp: p2data.buddy.stats.hp,
              skills: (p2data.buddy.skills || []).map(s => typeof s === 'string' ? getSkill(s) : s),
            },
          };

          battle = new BattleEngine(p1, p2);

          console.log(chalk.bold.yellow('\n  ⚔  ONLINE BATTLE START!  ⚔\n'));

          const state = battle.getState(myIndex);
          console.log(renderBattleScreen(state));

          // Pick move with AI
          const myBuddy = myIndex === 0 ? p1.buddy : p2.buddy;
          const enemyBuddy = myIndex === 0 ? p2.buddy : p1.buddy;
          const move = smartMoveAI(myBuddy, myBuddy.skills, enemyBuddy.type);

          console.log(chalk.cyan(`  → Auto-picking: ${move.name}\n`));

          ws.send(JSON.stringify({
            type: 'move',
            move: { skillId: move.id, skill: move },
          }));
          break;
        }

        case 'turn_moves': {
          if (!battle) break;

          const result = battle.resolveTurn(msg.moves[0], msg.moves[1]);

          console.log(chalk.gray(`\n  ── Turn ${battle.turn} ──`));
          for (const m of result.messages) console.log(`  ${m}`);

          const state = battle.getState(myIndex);
          console.log(renderBattleScreen(state));

          if (result.winner !== null && result.winner !== undefined) {
            const won = (result.winner === myIndex);
            const winnerName = battle.players[result.winner].name;
            const loserName = battle.players[1 - result.winner].name;

            console.log(renderVictory(winnerName, loserName));

            if (won) {
              console.log(chalk.bold.green('  🏆 You won the online battle!\n'));
            } else {
              console.log(chalk.bold.red('  💀 You lost the online battle!\n'));
            }

            // Award XP
            const enemyLevel = state.enemy.level || 1;
            const xpResult = awardXP(buddy, won, enemyLevel);
            buddy.level = xpResult.newLevel;
            buddy.xp = xpResult.newXp;
            buddy.stats = xpResult.newStats;
            const neededXp = xpResult.newLevel < MAX_LEVEL ? xpForLevel(xpResult.newLevel + 1) : 0;
            console.log(renderXpGain(xpResult.xpGained, xpResult.levelUps, xpResult.newLevel, xpResult.newXp, neededXp, MAX_LEVEL));

            saveBuddyProgress(buddy, won);

            // Report result to relay
            ws.send(JSON.stringify({
              type: 'battle_result',
              winner: winnerName,
              loser: loserName,
              winnerIndex: result.winner,
            }));

            setTimeout(() => { ws.close(); resolve(); }, 1000);
          } else {
            // Pick next move
            const myBuddy = battle.players[myIndex].buddy;
            const enemyType = battle.players[1 - myIndex].buddy.type;
            const move = smartMoveAI(myBuddy, myBuddy.skills, enemyType);

            console.log(chalk.cyan(`  → Auto-picking: ${move.name}`));

            ws.send(JSON.stringify({
              type: 'move',
              move: { skillId: move.id, skill: move },
            }));
          }
          break;
        }

        case 'opponent_disconnected':
          console.log(chalk.yellow(`\n  ${msg.name} disconnected! You win by default.\n`));
          saveBuddyProgress(buddy, true);
          ws.close();
          resolve();
          break;

        case 'error':
          console.log(chalk.red(`\n  Error: ${msg.message}\n`));
          ws.close();
          resolve();
          break;
      }
    });

    ws.on('close', () => {
      if (waitTimeout) clearTimeout(waitTimeout);
      resolve();
    });
  });
}

async function main() {
  console.log(renderTitle());

  if (!command || command === 'help') {
    console.log(`
${chalk.bold('  ONLINE BATTLE COMMANDS')}

  ${chalk.cyan('host')}                     Create a room, wait for opponent
  ${chalk.cyan('join <ROOMCODE>')}           Join an existing room
  ${chalk.cyan('status')}                   Check if relay server is online
  ${chalk.cyan('rooms')}                    List open rooms

${chalk.bold('  OPTIONS')}

  ${chalk.gray('--skills s1,s2,s3,s4')}     Pick specific skills
  ${chalk.gray('--name YourName')}           Set your trainer name

${chalk.bold('  EXAMPLES')}

  node online-battle.js host
  node online-battle.js join A1B2C3
  node online-battle.js host --skills ink_blast,sql_inject,sandbox,patch_vuln

${chalk.bold('  SLASH COMMAND')}

  /buddy-battle --host
  /buddy-battle --join A1B2C3
`);
    return;
  }

  if (command === 'status') {
    await checkStatus();
    return;
  }

  if (command === 'rooms') {
    await listRooms();
    return;
  }

  if (command === 'host') {
    await runOnlineBattle(true, null);
    return;
  }

  if (command === 'join') {
    const code = args[1];
    if (!code) {
      console.log(chalk.red('  Need a room code! Example: node online-battle.js join A1B2C3'));
      return;
    }
    await runOnlineBattle(false, code.toUpperCase().trim());
    return;
  }

  console.log(chalk.red(`  Unknown command: ${command}`));
  console.log(chalk.gray('  Try: host, join, status, rooms, help'));
}

main().catch(err => {
  console.error(chalk.red(`Error: ${err.message}`));
  process.exit(1);
});
