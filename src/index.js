#!/usr/bin/env node

const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const { BattleServer } = require('./server');
const { BattleClient } = require('./client');
const { renderTitle, renderXpGain } = require('./ui');
const { loadSave, saveBuddyProgress } = require('./save');
const { awardXP, xpForLevel, MAX_LEVEL } = require('./leveling');

const DEFAULT_PORT = 9877;

async function main() {
  const args = process.argv.slice(2);

  // Quick mode: buddy-battle host / buddy-battle join
  if (args[0] === 'host') return hostGame(args[1]);
  if (args[0] === 'join') return joinGame(args[1], args[2]);

  // Interactive mode
  console.clear();
  console.log(renderTitle());

  const { mode } = await inquirer.prompt([{
    type: 'list',
    name: 'mode',
    message: 'What do you want to do?',
    choices: [
      { name: '⚔  Host a battle (create room)', value: 'host' },
      { name: '🎯 Join a battle (enter code)', value: 'join' },
      { name: '🤖 Practice (fight a bot)', value: 'bot' },
      { name: '📖 How to play', value: 'help' },
    ],
  }]);

  if (mode === 'help') {
    printHelp();
    return;
  }

  if (mode === 'bot') {
    await practiceMode();
    return;
  }

  if (mode === 'host') return hostGame();
  if (mode === 'join') return joinGame();
}

async function hostGame(portArg) {
  const port = parseInt(portArg) || DEFAULT_PORT;

  const client = new BattleClient();
  const buddy = await client.setupBuddy();

  // Start server
  const server = new BattleServer(port);
  const actualPort = await server.start();

  // Get local IP for sharing
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }

  console.log(chalk.bold.cyan(`\n  Server started on port ${actualPort}`));
  console.log(chalk.gray(`  Your friend can join with:`));
  console.log(chalk.white(`  npx buddy-battle join ${localIP} ${actualPort}\n`));

  // Connect to own server
  await client.connect('localhost', actualPort);

  client.send({
    type: 'create_room',
    name: client.playerName,
    buddy: {
      species: buddy.species,
      nickname: buddy.nickname,
      type: buddy.type,
      level: buddy.level || 1,
      stats: { ...buddy.stats },
    },
  });
}

async function joinGame(hostArg, portArg) {
  const client = new BattleClient();
  const buddy = await client.setupBuddy();

  let host = hostArg;
  let port = parseInt(portArg) || DEFAULT_PORT;

  if (!host) {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'host',
        message: 'Host IP address:',
        default: 'localhost',
      },
      {
        type: 'input',
        name: 'port',
        message: 'Port:',
        default: String(DEFAULT_PORT),
      },
    ]);
    host = answers.host;
    port = parseInt(answers.port);
  }

  const spinner = ora(`Connecting to ${host}:${port}...`).start();

  try {
    await client.connect(host, port);
    spinner.succeed('Connected!');

    // Need room code
    const { code } = await inquirer.prompt([{
      type: 'input',
      name: 'code',
      message: 'Enter room code:',
    }]);

    client.send({
      type: 'join_room',
      code: code.toUpperCase().trim(),
      name: client.playerName,
      buddy: {
        species: buddy.species,
        nickname: buddy.nickname,
        type: buddy.type,
        level: buddy.level || 1,
        stats: { ...buddy.stats },
      },
    });
  } catch (err) {
    spinner.fail(`Could not connect: ${err.message}`);
    process.exit(1);
  }
}

async function practiceMode() {
  const { BattleEngine } = require('./battle');
  const { getSkillPool, getSkill } = require('./skills');
  const { BUDDY_TYPES } = require('./buddies');
  const { renderBattleScreen, renderSkillMenu } = require('./ui');

  const client = new BattleClient();
  const buddy = await client.setupBuddy();

  // Pick skills
  const pool = getSkillPool(buddy.species);
  const choices = renderSkillMenu(pool);

  console.log(chalk.bold('\n  Pick 4 skills:\n'));
  const { selectedSkills } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selectedSkills',
    message: 'Select exactly 4 skills:',
    choices,
    validate: (a) => a.length === 4 || 'Pick exactly 4!',
  }]);

  buddy.skills = selectedSkills.map(id => getSkill(id));

  // Create bot opponent
  const botTypes = Object.keys(BUDDY_TYPES).filter(t => t !== buddy.species);
  const botSpecies = botTypes[Math.floor(Math.random() * botTypes.length)];
  const botBuddy = {
    species: botSpecies,
    nickname: `Wild ${BUDDY_TYPES[botSpecies].name}`,
    type: BUDDY_TYPES[botSpecies].type,
    stats: { ...BUDDY_TYPES[botSpecies].baseStats },
    skills: getSkillPool(botSpecies).slice(0, 4).map(s => getSkill(s.id)),
  };

  const player = {
    name: client.playerName,
    buddy: { ...buddy, maxHp: buddy.stats.hp, level: buddy.level || 1 },
  };
  const botLevel = Math.max(1, (buddy.level || 1) + Math.floor(Math.random() * 3) - 1);
  const bot = {
    name: 'CPU',
    buddy: { ...botBuddy, maxHp: botBuddy.stats.hp, level: botLevel },
  };

  const battle = new BattleEngine(player, bot);

  console.log(chalk.yellow(`\n  ⚔  VS ${BUDDY_TYPES[botSpecies].emoji} ${botBuddy.nickname} Lv.${botLevel}!\n`));

  while (!battle.winner && battle.winner !== 0) {
    const state = battle.getState(0);
    console.log(renderBattleScreen(state));

    const skillChoices = buddy.skills.map(s => ({
      name: `${s.category === 'inject' ? '⚔' : s.category === 'defend' ? '🛡' : '⚡'} ${s.name} (PWR:${s.power || '-'})`,
      value: s.id,
      short: s.name,
    }));

    const { move } = await inquirer.prompt([{
      type: 'list',
      name: 'move',
      message: 'Your move:',
      choices: skillChoices,
    }]);

    // Bot picks random skill
    const botSkill = botBuddy.skills[Math.floor(Math.random() * botBuddy.skills.length)];

    const playerSkill = getSkill(move);
    const result = battle.resolveTurn(
      { skillId: move, skill: playerSkill },
      { skillId: botSkill.id, skill: botSkill }
    );

    console.clear();
    for (const m of result.messages) {
      console.log(chalk.white(`  ${m}`));
    }

    if (result.winner !== null && result.winner !== undefined) {
      const finalState = battle.getState(0);
      console.log(renderBattleScreen(finalState));
      const won = result.winner === 0;
      if (won) {
        console.log(chalk.bold.green('\n  🏆 You defeated the wild buddy!\n'));
      } else {
        console.log(chalk.bold.red('\n  💀 Your buddy fainted!\n'));
      }

      // Award XP and save
      const xpResult = awardXP(buddy, won, botLevel);
      buddy.level = xpResult.newLevel;
      buddy.xp = xpResult.newXp;
      buddy.stats = xpResult.newStats;
      if (xpResult.newSkill) {
        if (!buddy.unlockedSkills) buddy.unlockedSkills = [];
        buddy.unlockedSkills.push(xpResult.newSkill.id);
      }

      const neededXp = xpResult.newLevel < MAX_LEVEL ? xpForLevel(xpResult.newLevel + 1) : 0;
      console.log(renderXpGain(xpResult.xpGained, xpResult.levelUps, xpResult.newLevel, xpResult.newXp, neededXp, MAX_LEVEL));

      saveBuddyProgress(buddy, won);
      break;
    }
  }
}

function printHelp() {
  console.log(`
${chalk.bold('  HOW TO PLAY')}

${chalk.cyan('  1.')} Host creates a room → gets a room code
${chalk.cyan('  2.')} Friend joins with the code
${chalk.cyan('  3.')} Both pick a buddy + 4 skills
${chalk.cyan('  4.')} Turn-based battle begins!

${chalk.bold('  SKILL TYPES')}
  ${chalk.red('⚔  INJECT')}  — Attack moves that damage the opponent
  ${chalk.blue('🛡 DEFEND')}  — Shield, heal, or buff yourself
  ${chalk.yellow('⚡ UTILITY')} — Stat changes, reveals, mixed effects

${chalk.bold('  TYPE CHART')}
  🌊 Water  → beats 🔥 Fire
  🔥 Fire   → beats 🧊 Ice, 🟢 Glitch
  ⚡ Electric → beats 🌊 Water, 👤 Shadow
  👤 Shadow  → beats 🟢 Glitch, 🧊 Ice
  🟢 Glitch  → beats ⚡ Electric, 🌊 Water
  🧊 Ice     → beats 🌊 Water

${chalk.bold('  STAKES')}
  ${chalk.red('Loser shares a private GitHub repo with the winner!')}
  (via gh CLI — collaborator invite or visibility change)

${chalk.bold('  COMMANDS')}
  npx buddy-battle              Interactive mode
  npx buddy-battle host [port]  Host a room
  npx buddy-battle join IP PORT Join a room
`);
}

main().catch(err => {
  console.error(chalk.red(`Error: ${err.message}`));
  process.exit(1);
});
