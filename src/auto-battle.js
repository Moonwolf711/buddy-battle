#!/usr/bin/env node
// Non-interactive battle mode — works without TTY
// Usage: node auto-battle.js [species] [nickname] [skill1,skill2,skill3,skill4]
// Or:    node auto-battle.js --auto (random picks, AI plays)
// Or:    node auto-battle.js --pick octopus Marblisk ink_blast,sql_inject,sandbox,patch_vuln

const chalk = require('chalk');
const { BUDDY_TYPES, getEffectiveness } = require('./buddies');
const { getSkillPool, getSkill } = require('./skills');
const { BattleEngine } = require('./battle');
const { renderBattleScreen, renderTitle, renderVictory, renderXpGain } = require('./ui');
const { awardXP, xpForLevel, MAX_LEVEL } = require('./leveling');
const { loadSave, saveBuddyProgress } = require('./save');

const args = process.argv.slice(2);

// Parse args
let species = args[0] || null;
let nickname = args[1] || null;
let skillIds = args[2] ? args[2].split(',') : null;
let autoPlay = args.includes('--auto');
let showMenu = args.includes('--menu');
let moveChoice = null;

// If --move flag, extract the move index
const moveIdx = args.indexOf('--move');
if (moveIdx !== -1 && args[moveIdx + 1]) {
  moveChoice = parseInt(args[moveIdx + 1]);
}

// If --pick flag, extract species/nickname/skills after it
const pickIdx = args.indexOf('--pick');
if (pickIdx !== -1) {
  species = args[pickIdx + 1] || 'octopus';
  nickname = args[pickIdx + 2] || BUDDY_TYPES[species]?.name || 'Buddy';
  if (args[pickIdx + 3]) skillIds = args[pickIdx + 3].split(',');
}

function printSpecies() {
  console.log(chalk.bold('\n  Available Buddies:\n'));
  Object.entries(BUDDY_TYPES).forEach(([key, b], i) => {
    console.log(`  ${chalk.yellow(i + 1)}) ${b.emoji} ${chalk.bold(b.name)} [${key}] (${b.type.toUpperCase()})`);
    console.log(`     HP:${b.baseStats.hp} ATK:${b.baseStats.atk} DEF:${b.baseStats.def} SPD:${b.baseStats.spd}`);
    console.log(`     ${chalk.dim(b.description)}`);
    b.ascii.forEach(line => console.log(`     ${chalk.dim(line)}`));
    console.log('');
  });
}

function printSkillPool(buddySpecies) {
  const pool = getSkillPool(buddySpecies);
  console.log(chalk.bold(`\n  Skills for ${BUDDY_TYPES[buddySpecies].name}:\n`));
  pool.forEach((s, i) => {
    const cat = s.category === 'inject' ? chalk.red('INJECT')
              : s.category === 'defend' ? chalk.blue('DEFEND')
              : chalk.yellow('UTIL');
    const pwr = s.power > 0 ? `PWR:${s.power}` : '---';
    console.log(`  ${chalk.yellow(i + 1)}) [${chalk.white(s.id)}] ${cat} ${chalk.bold(s.name)} (${s.type}) ${pwr} ACC:${s.accuracy}%`);
    console.log(`     ${chalk.dim(s.description)}`);
  });
  console.log(chalk.gray(`\n  Pick 4 by ID: node auto-battle.js --pick ${buddySpecies} Name skill1,skill2,skill3,skill4`));
}

function smartMoveAI(buddy, skills, enemyState, turnCount) {
  const hp = buddy.stats.hp;
  const maxHp = buddy.maxHp;

  // Turn 1: if enemy type is super effective against us, lead with Sandbox
  if (turnCount <= 1) {
    const enemyEff = getEffectiveness(enemyState.type, buddy.type);
    if (enemyEff >= 2.0) {
      const shield = skills.find(s => s.effect?.shield);
      if (shield) return shield;
    }
  }

  // If below 25% HP, try to heal
  if (hp < maxHp * 0.25) {
    const healSkill = skills.find(s => s.effect?.heal);
    if (healSkill) return healSkill;
  }

  // If below 40% HP, heal if possible, but don't Sandbox-loop — alternate attacks
  if (hp < maxHp * 0.4) {
    const healSkill = skills.find(s => s.effect?.heal);
    if (healSkill) return healSkill;
    // Only shield if we DON'T already have one up (odd turns = attack)
    if (turnCount % 2 === 0) {
      const shield = skills.find(s => s.effect?.shield);
      if (shield) return shield;
    }
  }

  // Pick highest expected damage move, considering type effectiveness
  let best = skills[0];
  let bestScore = -1;
  for (const s of skills) {
    if (s.power <= 0) continue;
    const eff = getEffectiveness(s.type, enemyState.type);
    const stab = s.type === buddy.type ? 1.3 : 1.0;
    const score = s.power * eff * stab * (s.accuracy / 100);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

async function run() {
  console.clear();
  console.log(renderTitle());

  // Menu mode — just show options
  if (showMenu) {
    printSpecies();
    return;
  }

  // Check for save
  const save = loadSave();

  // No species given — show help or use save
  if (!species) {
    if (save && save.species) {
      species = save.species;
      nickname = save.nickname || BUDDY_TYPES[species].name;
      console.log(chalk.green(`  Loaded save: ${nickname} (${BUDDY_TYPES[species].name}) Lv.${save.level || 1}`));
      console.log(chalk.gray(`  W:${save.record?.wins || 0} L:${save.record?.losses || 0}\n`));
    } else {
      console.log(chalk.bold('  No save found. Pick a buddy:\n'));
      printSpecies();
      console.log(chalk.gray('\n  Usage: node auto-battle.js --pick <species> <nickname> <skill1,skill2,skill3,skill4>'));
      console.log(chalk.gray('  Example: node auto-battle.js --pick octopus Marblisk ink_blast,sql_inject,sandbox,patch_vuln'));
      console.log(chalk.gray('  Auto:    node auto-battle.js --auto'));
      return;
    }
  }

  if (!BUDDY_TYPES[species]) {
    console.log(chalk.red(`  Unknown species: ${species}`));
    printSpecies();
    return;
  }

  // No skills given — show pool
  if (!skillIds && !autoPlay) {
    if (save && save.species === species) {
      // Use saved skills if available, otherwise show pool
    }
    printSkillPool(species);
    return;
  }

  // Auto-pick skills if --auto
  if (autoPlay && !skillIds) {
    const pool = getSkillPool(species);
    // Pick 2 inject, 1 defend, 1 utility (or best available)
    const inject = pool.filter(s => s.category === 'inject').slice(0, 2);
    const defend = pool.filter(s => s.category === 'defend').slice(0, 1);
    const util = pool.filter(s => s.category === 'utility').slice(0, 1);
    const picked = [...inject, ...defend, ...util];
    while (picked.length < 4 && picked.length < pool.length) {
      const next = pool.find(s => !picked.includes(s));
      if (next) picked.push(next);
      else break;
    }
    skillIds = picked.map(s => s.id);
  }

  if (!skillIds || skillIds.length !== 4) {
    console.log(chalk.red('  Need exactly 4 skills!'));
    printSkillPool(species);
    return;
  }

  // Validate skills
  const skills = skillIds.map(id => getSkill(id)).filter(Boolean);
  if (skills.length !== 4) {
    console.log(chalk.red(`  Invalid skill IDs. Valid ones:`));
    printSkillPool(species);
    return;
  }

  nickname = nickname || BUDDY_TYPES[species].name;

  // Build buddy
  const baseStats = save && save.species === species
    ? { ...save.stats }
    : { ...BUDDY_TYPES[species].baseStats };

  const buddy = {
    species,
    nickname,
    type: BUDDY_TYPES[species].type,
    stats: baseStats,
    level: (save && save.species === species) ? (save.level || 1) : 1,
    xp: (save && save.species === species) ? (save.xp || 0) : 0,
    maxHp: baseStats.hp,
    skills,
  };

  // Create bot
  const botTypes = Object.keys(BUDDY_TYPES).filter(t => t !== species);
  const botSpecies = botTypes[Math.floor(Math.random() * botTypes.length)];
  const botLevel = Math.max(1, buddy.level + Math.floor(Math.random() * 3) - 1);
  const botBuddy = {
    species: botSpecies,
    nickname: `Wild ${BUDDY_TYPES[botSpecies].name}`,
    type: BUDDY_TYPES[botSpecies].type,
    stats: { ...BUDDY_TYPES[botSpecies].baseStats },
    level: botLevel,
    maxHp: BUDDY_TYPES[botSpecies].baseStats.hp,
    skills: getSkillPool(botSpecies).slice(0, 4).map(s => getSkill(s.id)),
  };

  const player = { name: 'Player', buddy };
  const bot = { name: 'CPU', buddy: botBuddy };
  const battle = new BattleEngine(player, bot);

  console.log(chalk.yellow(`\n  ⚔  ${nickname} Lv.${buddy.level} VS ${BUDDY_TYPES[botSpecies].emoji} ${botBuddy.nickname} Lv.${botLevel}!\n`));

  // If --move was given, play one turn
  if (moveChoice !== null) {
    const state = battle.getState(0);
    console.log(renderBattleScreen(state));

    const skill = skills[moveChoice - 1];
    if (!skill) {
      console.log(chalk.red(`  Invalid move #${moveChoice}. Pick 1-4.`));
      return;
    }

    const botSkill = smartMoveAI(botBuddy, botBuddy.skills, { type: buddy.type }, turnCount);
    const result = battle.resolveTurn(
      { skillId: skill.id, skill },
      { skillId: botSkill.id, skill: botSkill }
    );

    console.log('');
    for (const m of result.messages) console.log(chalk.white(`  ${m}`));

    const finalState = battle.getState(0);
    console.log(renderBattleScreen(finalState));

    if (result.winner !== null && result.winner !== undefined) {
      const won = result.winner === 0;
      console.log(won ? chalk.bold.green('\n  🏆 Victory!\n') : chalk.bold.red('\n  💀 Defeated!\n'));
      const xpResult = awardXP(buddy, won, botLevel);
      const neededXp = xpResult.newLevel < MAX_LEVEL ? xpForLevel(xpResult.newLevel + 1) : 0;
      console.log(renderXpGain(xpResult.xpGained, xpResult.levelUps, xpResult.newLevel, xpResult.newXp, neededXp, MAX_LEVEL));
      saveBuddyProgress({ ...buddy, level: xpResult.newLevel, xp: xpResult.newXp, stats: xpResult.newStats }, won);
    } else {
      // Show move options for next turn
      console.log(chalk.bold('\n  Your moves:'));
      skills.forEach((s, i) => {
        const cat = s.category === 'inject' ? chalk.red('⚔')
                  : s.category === 'defend' ? chalk.blue('🛡')
                  : chalk.yellow('⚡');
        console.log(`  ${chalk.yellow(i + 1)}) ${cat} ${s.name} (${s.type}) ${s.power > 0 ? 'PWR:' + s.power : ''}`);
      });
      console.log(chalk.gray('\n  Next: node auto-battle.js --pick ... --move <1-4>'));
    }
    return;
  }

  // Auto-play: full battle
  if (autoPlay) {
    let turnCount = 0;
    while (!battle.winner && battle.winner !== 0 && turnCount < 50) {
      turnCount++;
      const state = battle.getState(0);

      // AI picks move for player
      const playerSkill = smartMoveAI(buddy, skills, { type: botBuddy.type }, turnCount);
      const botSkill = smartMoveAI(botBuddy, botBuddy.skills, { type: buddy.type }, turnCount);

      const result = battle.resolveTurn(
        { skillId: playerSkill.id, skill: playerSkill },
        { skillId: botSkill.id, skill: botSkill }
      );

      // Print turn
      console.log(chalk.gray(`  ── Turn ${turnCount} ──`));
      for (const m of result.messages) console.log(`  ${m}`);

      const afterState = battle.getState(0);
      const youHp = afterState.you.hp;
      const themHp = afterState.enemy.hp;
      console.log(chalk.dim(`  [${nickname}: ${youHp}/${buddy.maxHp} HP | ${botBuddy.nickname}: ${themHp}/${botBuddy.maxHp} HP]`));
      console.log('');

      if (result.winner !== null && result.winner !== undefined) {
        console.log(renderBattleScreen(afterState));
        const won = result.winner === 0;
        console.log(won ? chalk.bold.green('\n  🏆 Victory!\n') : chalk.bold.red('\n  💀 Defeated!\n'));

        const xpResult = awardXP(buddy, won, botLevel);
        buddy.level = xpResult.newLevel;
        buddy.xp = xpResult.newXp;
        buddy.stats = xpResult.newStats;

        const neededXp = xpResult.newLevel < MAX_LEVEL ? xpForLevel(xpResult.newLevel + 1) : 0;
        console.log(renderXpGain(xpResult.xpGained, xpResult.levelUps, xpResult.newLevel, xpResult.newXp, neededXp, MAX_LEVEL));
        saveBuddyProgress(buddy, won);
        break;
      }
    }
    return;
  }

  // Default: show the battle state and available moves
  const state = battle.getState(0);
  console.log(renderBattleScreen(state));
  console.log(chalk.bold('\n  Your moves:'));
  skills.forEach((s, i) => {
    const cat = s.category === 'inject' ? chalk.red('⚔')
              : s.category === 'defend' ? chalk.blue('🛡')
              : chalk.yellow('⚡');
    console.log(`  ${chalk.yellow(i + 1)}) ${cat} ${s.name} (${s.type}) ${s.power > 0 ? 'PWR:' + s.power : ''}`);
  });
  console.log(chalk.gray(`\n  Play: node auto-battle.js --pick ${species} ${nickname} ${skillIds.join(',')} --move <1-4>`));
  console.log(chalk.gray(`  Auto: node auto-battle.js --pick ${species} ${nickname} ${skillIds.join(',')} --auto`));
}

run().catch(err => {
  console.error(chalk.red(`Error: ${err.message}`));
  process.exit(1);
});
