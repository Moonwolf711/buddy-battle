#!/usr/bin/env node
// Non-interactive online multiplayer — works in Claude Code sessions
// Usage:
//   node online-battle.js host [--stake owner/repo] [--skills s1,s2,s3,s4]
//   node online-battle.js join ROOMCODE [--stake owner/repo] [--skills s1,s2,s3,s4]
//   node online-battle.js evaluate owner/repo
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
const { evaluateRepo, renderRepoCard, renderRarityComparison, renderStakeResult } = require('./repo-rarity');

// Relay server URL — Railway deployment
const RELAY_URL = process.env.BUDDY_RELAY || 'wss://buddy-battle-relay-production.up.railway.app';
const HTTP_URL = RELAY_URL.replace('wss://', 'https://').replace('ws://', 'http://');

const args = process.argv.slice(2);
const command = args[0]; // host | join | status | rooms | evaluate

// Parse flags
function getFlag(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const skillIds_raw = getFlag('--skills');
let skillIds = skillIds_raw ? skillIds_raw.split(',') : null;
const playerName = getFlag('--name');
const stakeRepo = getFlag('--stake');
const stakeMode = getFlag('--mode') || 'collaborator'; // collaborator | partner | zip

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
          console.log(chalk.gray(`  Rooms: ${info.rooms} | Uptime: ${Math.floor(info.uptime)}s`));
          console.log(chalk.gray(`  URL: ${RELAY_URL}`));
        } catch {
          console.log(chalk.green(`  Relay server: ONLINE`));
        }
        resolve();
      });
    }).on('error', (err) => {
      console.log(chalk.red(`  Relay server: OFFLINE — ${err.message}`));
      resolve();
    });
  });
}

async function listRooms() {
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
          console.log(chalk.gray('  No active rooms.'));
        } else {
          console.log(chalk.bold(`\n  Active Rooms (${info.rooms.length}):\n`));
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
}

async function evaluateRepoCmd(repo) {
  console.log(chalk.gray(`  Evaluating ${repo}...\n`));
  const result = evaluateRepo(repo);
  console.log(renderRepoCard(repo, result));
}

async function runOnlineBattle(isHost, roomCode) {
  const save = loadSave();
  if (!save || !save.species) {
    console.log(chalk.red('  No saved buddy! Run /buddy-battle first to create one.'));
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
    species, nickname,
    type: BUDDY_TYPES[species].type,
    stats: { ...save.stats },
    level: save.level || 1,
    xp: save.xp || 0,
    maxHp: save.stats.hp,
    skills,
  };

  // Evaluate staked repo if provided
  let myStake = null;
  if (stakeRepo) {
    console.log(chalk.gray(`  Evaluating your stake: ${stakeRepo}...\n`));
    myStake = { repo: stakeRepo, eval: evaluateRepo(stakeRepo) };
    console.log(renderRepoCard(stakeRepo, myStake.eval));
  }

  console.log(chalk.bold(`\n  ${BUDDY_TYPES[species].emoji} ${nickname} Lv.${buddy.level} ready for online battle!`));
  if (myStake) {
    console.log(chalk.yellow(`  Staking: ${myStake.eval.rarity.emoji} ${stakeRepo} (${myStake.eval.rarity.name})`));
  } else {
    console.log(chalk.gray(`  No repo staked. Add --stake owner/repo to bet a repo.`));
  }
  console.log(chalk.gray(`  Connecting to relay: ${RELAY_URL}\n`));

  return new Promise((resolve) => {
    const ws = new WebSocket(RELAY_URL);
    let opponent = null;
    let opponentStake = null;
    let battle = null;
    let myIndex = -1;
    let waitTimeout = null;

    ws.on('error', (err) => {
      console.log(chalk.red(`  Connection failed: ${err.message}`));
      resolve();
    });

    ws.on('open', () => {
      const payload = {
        type: isHost ? 'create_room' : 'join_room',
        name,
        buddy: { species, nickname, type: buddy.type, level: buddy.level, stats: { ...buddy.stats } },
        stake: myStake ? { repo: myStake.repo, rarity: myStake.eval.rarity.name, score: myStake.eval.score } : null,
      };
      if (!isHost) payload.code = roomCode;
      ws.send(JSON.stringify(payload));
    });

    function startWaitTimeout() {
      waitTimeout = setTimeout(() => {
        console.log(chalk.yellow('\n  Timed out waiting (5 min). Room closed.'));
        ws.close();
        resolve();
      }, 5 * 60 * 1000);
    }

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {
        case 'room_created':
          console.log(chalk.bold.green(`  Room created: ${chalk.yellow.bold(msg.code)}`));
          console.log(chalk.white(`\n  Share with your opponent:`));
          console.log(chalk.cyan(`  /buddy-battle --join ${msg.code}${stakeRepo ? ' --stake their/repo' : ''}\n`));
          console.log(chalk.gray('  Waiting for opponent to join...'));
          startWaitTimeout();
          break;

        case 'room_joined':
          console.log(chalk.green(`  Joined room ${chalk.yellow(msg.code)}!`));
          break;

        case 'players_matched': {
          if (waitTimeout) clearTimeout(waitTimeout);
          opponent = msg.players.find(p => p.name !== name) || msg.players[1];
          opponentStake = opponent.stake;

          console.log(chalk.bold.yellow(`\n  Opponent found: ${opponent.name}`));
          console.log(chalk.gray(`  ${BUDDY_TYPES[opponent.buddy.species]?.emoji || '?'} ${opponent.buddy.nickname} (${opponent.buddy.type}) Lv.${opponent.buddy.level || '?'}`));

          // Show stake comparison
          if (myStake && opponentStake) {
            console.log(chalk.bold('\n  ⚖  STAKES:'));
            console.log(`  You:  ${myStake.eval.rarity.emoji} ${myStake.repo} (${myStake.eval.rarity.name}, ${myStake.eval.score}pts)`);
            console.log(`  Them: ${opponentStake.rarity || '?'} ${opponentStake.repo} (${opponentStake.score || '?'}pts)`);

            // Check rarity mismatch
            const myTier = myStake.eval.rarity.tier;
            const theirScore = opponentStake.score || 0;
            let theirTier = 1;
            if (theirScore >= 85) theirTier = 5;
            else if (theirScore >= 60) theirTier = 4;
            else if (theirScore >= 35) theirTier = 3;
            else if (theirScore >= 15) theirTier = 2;

            const diff = Math.abs(myTier - theirTier);
            if (diff >= 2) {
              console.log(chalk.red.bold('\n  ⚠  RARITY MISMATCH! Difference of ' + diff + ' tiers.'));
            } else {
              console.log(chalk.green('\n  ✓ Fair stakes!'));
            }
          } else if (myStake) {
            console.log(chalk.yellow(`\n  ⚠ You staked a repo but opponent did not. Honor system!`));
          } else if (opponentStake) {
            console.log(chalk.yellow(`\n  ⚠ Opponent staked ${opponentStake.repo} — you staked nothing!`));
          } else {
            console.log(chalk.gray('\n  No repos staked. Friendly match!'));
          }

          console.log('');

          // Send ready
          ws.send(JSON.stringify({
            type: 'ready',
            buddy: { species, nickname, type: buddy.type, level: buddy.level, stats: { ...buddy.stats }, skills },
          }));
          break;
        }

        case 'waiting':
          console.log(chalk.gray(`  ${msg.message}`));
          break;

        case 'battle_start': {
          myIndex = msg.playerIndex;
          const p1data = msg.players[0];
          const p2data = msg.players[1];

          const makeBuddy = (d) => ({
            species: d.buddy.species,
            nickname: d.buddy.nickname,
            type: d.buddy.type,
            level: d.buddy.level || 1,
            stats: { ...d.buddy.stats },
            maxHp: d.buddy.stats.hp,
            skills: (d.buddy.skills || []).map(s => typeof s === 'string' ? getSkill(s) : s),
          });

          const p1 = { name: p1data.name, buddy: makeBuddy(p1data) };
          const p2 = { name: p2data.name, buddy: makeBuddy(p2data) };

          battle = new BattleEngine(p1, p2);

          console.log(chalk.bold.yellow('\n  ⚔  ONLINE BATTLE START!  ⚔\n'));

          const state = battle.getState(myIndex);
          console.log(renderBattleScreen(state));

          const myBuddy = myIndex === 0 ? p1.buddy : p2.buddy;
          const enemyBuddy = myIndex === 0 ? p2.buddy : p1.buddy;
          const move = smartMoveAI(myBuddy, myBuddy.skills, enemyBuddy.type);
          console.log(chalk.cyan(`  → Auto-picking: ${move.name}\n`));

          ws.send(JSON.stringify({ type: 'move', move: { skillId: move.id, skill: move } }));
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

            // Handle repo stakes
            if (myStake || opponentStake) {
              console.log(chalk.yellow('\n  ★ ★ ★  REPO STAKES  ★ ★ ★\n'));

              if (won && opponentStake) {
                console.log(chalk.green.bold(`  You won ${opponentStake.repo}!\n`));
                console.log(chalk.white(`  Ask your opponent to run:`));
                if (stakeMode === 'partner') {
                  console.log(chalk.cyan(`  gh api repos/${opponentStake.repo}/collaborators/${name} -X PUT -f permission=push`));
                  console.log(chalk.gray(`  (Partner — you get push/write access)\n`));
                } else if (stakeMode === 'zip') {
                  console.log(chalk.cyan(`  gh api repos/${opponentStake.repo}/zipball > repo.zip`));
                  console.log(chalk.gray(`  (Zip — they send you a snapshot)\n`));
                } else {
                  console.log(chalk.cyan(`  gh api repos/${opponentStake.repo}/collaborators/${name} -X PUT -f permission=pull`));
                  console.log(chalk.gray(`  (Collaborator — you get read access)\n`));
                }
              } else if (!won && myStake) {
                console.log(chalk.red.bold(`  You lost ${myStake.repo}!\n`));
                console.log(chalk.white(`  Honor your stake — run:`));
                const oppName = opponent?.name || 'OPPONENT_GITHUB';
                if (stakeMode === 'partner') {
                  console.log(chalk.cyan(`  gh api repos/${myStake.repo}/collaborators/${oppName} -X PUT -f permission=push`));
                  console.log(chalk.gray(`  (Partner — they get push/write access)\n`));
                } else if (stakeMode === 'zip') {
                  console.log(chalk.cyan(`  gh api repos/${myStake.repo}/zipball > repo.zip`));
                  console.log(chalk.gray(`  (Send them the zip)\n`));
                } else {
                  console.log(chalk.cyan(`  gh api repos/${myStake.repo}/collaborators/${oppName} -X PUT -f permission=pull`));
                  console.log(chalk.gray(`  (Collaborator — they get read access)\n`));
                }
              } else if (won && !opponentStake) {
                console.log(chalk.gray(`  You won but opponent didn't stake a repo. Bragging rights only!\n`));
              } else {
                console.log(chalk.gray(`  Opponent won — they didn't stake, no repo exchanged.\n`));
              }
            }

            // Report result
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
            ws.send(JSON.stringify({ type: 'move', move: { skillId: move.id, skill: move } }));
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

  ${chalk.cyan('host')}                          Create a room, wait for opponent
  ${chalk.cyan('join <CODE>')}                    Join an existing room
  ${chalk.cyan('evaluate <owner/repo>')}          Check a repo's rarity tier
  ${chalk.cyan('status')}                        Check relay server
  ${chalk.cyan('rooms')}                         List open rooms

${chalk.bold('  STAKE OPTIONS')}

  ${chalk.gray('--stake owner/repo')}             Bet a repo on the battle
  ${chalk.gray('--mode collaborator')}            Loser gives read access (default)
  ${chalk.gray('--mode partner')}                 Loser adds winner as contributor
  ${chalk.gray('--mode zip')}                     Loser sends repo snapshot

${chalk.bold('  OTHER OPTIONS')}

  ${chalk.gray('--skills s1,s2,s3,s4')}           Pick skills
  ${chalk.gray('--name YourName')}                Set trainer name

${chalk.bold('  EXAMPLES')}

  node online-battle.js host --stake Moonwolf711/secret-project
  node online-battle.js join A1B2C3 --stake friend/cool-repo --mode partner
  node online-battle.js evaluate facebook/react

${chalk.bold('  RARITY TIERS')}

  ${chalk.gray('⬜ Common')}     0-14 pts   Bare repos, no README
  ${chalk.green('🟩 Uncommon')}   15-34 pts  Active, basic structure
  ${chalk.blue('🟦 Rare')}       35-59 pts  Tests, CI, contributors
  ${chalk.magenta('🟪 Epic')}       60-84 pts  200+ stars, deployed
  ${chalk.yellow('🟨 Mythic')}     85+ pts    1000+ stars, full infra
`);
    return;
  }

  if (command === 'status') return checkStatus();
  if (command === 'rooms') return listRooms();

  if (command === 'evaluate') {
    const repo = args[1];
    if (!repo) {
      console.log(chalk.red('  Usage: node online-battle.js evaluate owner/repo'));
      return;
    }
    return evaluateRepoCmd(repo);
  }

  if (command === 'host') return runOnlineBattle(true, null);

  if (command === 'join') {
    const code = args[1];
    if (!code) {
      console.log(chalk.red('  Need a room code!'));
      return;
    }
    return runOnlineBattle(false, code.toUpperCase().trim());
  }

  console.log(chalk.red(`  Unknown: ${command}. Try: host, join, evaluate, status, rooms`));
}

main().catch(err => {
  console.error(chalk.red(`Error: ${err.message}`));
  process.exit(1);
});
