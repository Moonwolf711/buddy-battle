// Battle client — connects to server, handles game flow
const WebSocket = require('ws');
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const { BUDDY_TYPES } = require('./buddies');
const { getSkillPool, getSkill } = require('./skills');
const { renderBattleScreen, renderSkillMenu, renderTitle, renderVictory, renderXpGain } = require('./ui');
const { awardXP, xpForLevel, MAX_LEVEL } = require('./leveling');
const { loadSave, saveBuddyProgress } = require('./save');

class BattleClient {
  constructor() {
    this.ws = null;
    this.playerName = '';
    this.buddy = null;
    this.state = null;
    this.spinner = null;
    this.waitingForMove = false;
    this.moveResolver = null;
  }

  async connect(host, port) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://${host}:${port}`);
      this.ws.on('open', () => resolve());
      this.ws.on('error', (err) => reject(err));
      this.ws.on('message', (raw) => { try { this.handleMessage(JSON.parse(raw.toString())); } catch {} });
      this.ws.on('close', () => {
        console.log(chalk.red('\n  Connection lost!'));
        process.exit(1);
      });
    });
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  async handleMessage(msg) {
    switch (msg.type) {
      case 'room_created':
        if (this.spinner) this.spinner.stop();
        console.log(chalk.bold.green(`\n  Room created! Code: ${chalk.yellow.bold(msg.code)}`));
        console.log(chalk.gray('  Share this code with your opponent\n'));
        this.spinner = ora('Waiting for opponent to join...').start();
        break;

      case 'room_joined':
        if (this.spinner) this.spinner.stop();
        console.log(chalk.green(`\n  Joined room ${chalk.yellow(msg.code)}!`));
        break;

      case 'players_ready':
        if (this.spinner) this.spinner.stop();
        console.log(chalk.bold('\n  Both players connected!'));
        for (const p of msg.players) {
          console.log(chalk.white(`    ${p.name} — ${BUDDY_TYPES[p.species]?.emoji || '?'} ${p.buddy} (${p.type})`));
        }
        await this.selectSkills();
        break;

      case 'waiting':
        if (this.spinner) this.spinner.stop();
        this.spinner = ora(msg.message).start();
        break;

      case 'battle_start':
        if (this.spinner) this.spinner.stop();
        console.log(chalk.bold.yellow('\n  ⚔  BATTLE START!  ⚔\n'));
        this.state = msg.state;
        console.log(renderBattleScreen(this.state));
        await this.promptMove();
        break;

      case 'turn_result':
        if (this.spinner) this.spinner.stop();
        this.state = msg.state;
        console.clear();
        console.log(renderBattleScreen(this.state));
        if (!this.state.winner) {
          await this.promptMove();
        }
        break;

      case 'battle_end':
        if (this.spinner) this.spinner.stop();
        console.log(renderVictory(msg.winner, msg.loser));

        // Award XP and process level ups
        {
          const enemyLevel = this.state?.enemy?.level || 1;
          const result = awardXP(this.buddy, msg.youWon, enemyLevel);

          // Apply results to buddy
          this.buddy.level = result.newLevel;
          this.buddy.xp = result.newXp;
          this.buddy.stats = result.newStats;
          if (result.newSkill) {
            if (!this.buddy.unlockedSkills) this.buddy.unlockedSkills = [];
            this.buddy.unlockedSkills.push(result.newSkill.id);
          }

          // Show XP results
          const neededXp = result.newLevel < MAX_LEVEL ? xpForLevel(result.newLevel + 1) : 0;
          console.log(renderXpGain(result.xpGained, result.levelUps, result.newLevel, result.newXp, neededXp, MAX_LEVEL));

          // Save progress
          saveBuddyProgress(this.buddy, msg.youWon);
        }

        if (msg.youWon) {
          console.log(chalk.green.bold('  🏆 You won! Your opponent owes you a repo!\n'));
          await this.claimRepo();
        } else {
          console.log(chalk.red.bold('  💀 You lost. Time to share a repo...\n'));
          await this.shareRepo();
        }
        process.exit(0);
        break;

      case 'opponent_left':
        if (this.spinner) this.spinner.stop();
        console.log(chalk.yellow('\n  Opponent disconnected! You win by default.\n'));
        process.exit(0);
        break;

      case 'error':
        if (this.spinner) this.spinner.stop();
        console.log(chalk.red(`\n  Error: ${msg.message}\n`));
        break;
    }
  }

  async setupBuddy() {
    console.log(renderTitle());

    // Check for existing save
    const save = loadSave();
    if (save && save.species && save.nickname) {
      const record = save.record || { wins: 0, losses: 0 };
      console.log(chalk.gray(`  Saved buddy found: ${chalk.bold.white(save.nickname)} (${BUDDY_TYPES[save.species]?.name || save.species}) Lv.${save.level || 1}  W:${record.wins} L:${record.losses}`));
      const { useSave } = await inquirer.prompt([{
        type: 'list',
        name: 'useSave',
        message: `Continue with ${save.nickname} (Lv.${save.level || 1})?`,
        choices: [
          { name: `Continue with ${save.nickname}`, value: true },
          { name: 'New buddy (overwrites save)', value: false },
        ],
      }]);

      if (useSave) {
        const { name } = await inquirer.prompt([{
          type: 'input',
          name: 'name',
          message: 'Your trainer name:',
          default: process.env.USER || 'Player',
        }]);
        this.playerName = name;

        this.buddy = {
          species: save.species,
          nickname: save.nickname,
          type: BUDDY_TYPES[save.species]?.type || 'water',
          stats: { ...save.stats },
          level: save.level || 1,
          xp: save.xp || 0,
          unlockedSkills: save.unlockedSkills || [],
          skills: [],
        };
        return this.buddy;
      }
    }

    const { name } = await inquirer.prompt([{
      type: 'input',
      name: 'name',
      message: 'Your trainer name:',
      default: process.env.USER || 'Player',
    }]);
    this.playerName = name;

    // Pick buddy species
    const speciesChoices = Object.entries(BUDDY_TYPES).map(([key, b]) => ({
      name: `${b.emoji} ${b.name} (${b.type.toUpperCase()}) — ${b.description}\n     HP:${b.baseStats.hp} ATK:${b.baseStats.atk} DEF:${b.baseStats.def} SPD:${b.baseStats.spd}`,
      value: key,
      short: b.name,
    }));

    const { species } = await inquirer.prompt([{
      type: 'list',
      name: 'species',
      message: 'Choose your buddy:',
      choices: speciesChoices,
    }]);

    const { nickname } = await inquirer.prompt([{
      type: 'input',
      name: 'nickname',
      message: `Give your ${BUDDY_TYPES[species].name} a nickname:`,
      default: BUDDY_TYPES[species].name,
    }]);

    this.buddy = {
      species,
      nickname,
      type: BUDDY_TYPES[species].type,
      stats: { ...BUDDY_TYPES[species].baseStats },
      level: 1,
      xp: 0,
      unlockedSkills: [],
      skills: [],
    };

    return this.buddy;
  }

  async selectSkills() {
    const pool = getSkillPool(this.buddy.species);
    const choices = renderSkillMenu(pool);

    console.log(chalk.bold('\n  Pick 4 skills for battle:\n'));

    const { selectedSkills } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedSkills',
      message: 'Select exactly 4 skills:',
      choices,
      validate: (answer) => {
        if (answer.length !== 4) return 'You must select exactly 4 skills!';
        return true;
      },
    }]);

    this.buddy.skills = selectedSkills.map(id => getSkill(id));

    this.send({
      type: 'select_skills',
      skills: this.buddy.skills,
    });

    this.spinner = ora('Waiting for opponent to pick skills...').start();
  }

  async promptMove() {
    const skillChoices = this.state.you.skills.map(s => ({
      name: `${s.category === 'inject' ? '⚔' : s.category === 'defend' ? '🛡' : '⚡'} ${s.name} (${s.type}) ${s.power > 0 ? 'PWR:' + s.power : ''}`,
      value: s.id,
      short: s.name,
    }));

    const { move } = await inquirer.prompt([{
      type: 'list',
      name: 'move',
      message: 'Choose your move:',
      choices: skillChoices,
    }]);

    this.send({ type: 'move', skillId: move });
    this.spinner = ora('Waiting for opponent...').start();
  }

  async shareRepo() {
    console.log(chalk.yellow('  As the loser, you must share a private repo.\n'));

    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: 'Ready to pick a repo to share?',
      default: true,
    }]);

    if (!confirm) {
      console.log(chalk.gray('  Coward! Your reputation is tarnished.\n'));
      return;
    }

    const { repoName } = await inquirer.prompt([{
      type: 'input',
      name: 'repoName',
      message: 'Enter the private repo to share (owner/repo):',
    }]);

    const { opponentGh } = await inquirer.prompt([{
      type: 'input',
      name: 'opponentGh',
      message: 'Enter opponent\'s GitHub username:',
    }]);

    if (repoName && opponentGh) {
      console.log(chalk.yellow(`\n  To honor your bet, run:`));
      console.log(chalk.white(`  gh repo edit ${repoName} --visibility public`));
      console.log(chalk.gray(`  — or —`));
      console.log(chalk.white(`  gh api repos/${repoName}/collaborators/${opponentGh} -X PUT -f permission=pull\n`));
    }
  }

  async claimRepo() {
    console.log(chalk.green('  Your opponent should share a repo with you.'));
    console.log(chalk.gray('  They\'ll be prompted on their end.\n'));
  }
}

module.exports = { BattleClient };
