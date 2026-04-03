// Terminal UI rendering — health bars, battle screen, menus
const chalk = require('chalk');
const { BUDDY_TYPES } = require('./buddies');

const TYPE_COLORS = {
  water: chalk.blue,
  fire: chalk.red,
  electric: chalk.yellow,
  shadow: chalk.magenta,
  glitch: chalk.green,
  ice: chalk.cyan,
};

function typeColor(type) {
  return TYPE_COLORS[type] || chalk.white;
}

function healthBar(current, max, width = 20) {
  const ratio = Math.max(0, current / max);
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  let color;
  if (ratio > 0.5) color = chalk.green;
  else if (ratio > 0.25) color = chalk.yellow;
  else color = chalk.red;

  const bar = color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  return `${bar} ${current}/${max}`;
}

function renderBuddy(species, side) {
  const buddy = BUDDY_TYPES[species];
  if (!buddy) return ['  ???  '];
  const art = buddy.ascii;
  if (side === 'right') {
    // Mirror for right side
    return art.map(line => '    ' + line);
  }
  return art;
}

function renderBattleScreen(state) {
  const lines = [];

  lines.push('');
  lines.push(chalk.gray('═'.repeat(56)));
  lines.push(chalk.bold.white(`  ⚔  BUDDY BATTLE — Turn ${state.turn}  ⚔`));
  lines.push(chalk.gray('═'.repeat(56)));
  lines.push('');

  // Enemy side (top)
  const enemyType = typeColor(state.enemy.type);
  const enemyArt = renderBuddy(state.enemy.species, 'right');
  lines.push(chalk.gray('  ┌─ OPPONENT ─────────────────────────────────┐'));
  const enemyLvl = state.enemy.level ? chalk.gray(` Lv.${state.enemy.level}`) : '';
  lines.push(`  │ ${enemyType(state.enemy.buddy)}${enemyLvl} ${chalk.gray('(' + state.enemy.type.toUpperCase() + ')')}  ${chalk.dim('— ' + state.enemy.name)}`);
  lines.push(`  │ HP: ${healthBar(state.enemy.hp, state.enemy.maxHp)}`);
  for (const line of enemyArt) {
    lines.push(`  │ ${chalk.dim(line)}`);
  }
  lines.push(chalk.gray('  └────────────────────────────────────────────┘'));

  lines.push('');
  lines.push(chalk.gray('          ─── vs ───'));
  lines.push('');

  // Your side (bottom)
  const yourType = typeColor(state.you.type);
  const yourArt = renderBuddy(state.you.species, 'left');
  lines.push(chalk.gray('  ┌─ YOUR BUDDY ───────────────────────────────┐'));
  const yourLvl = state.you.level ? chalk.gray(` Lv.${state.you.level}`) : '';
  lines.push(`  │ ${yourType.bold(state.you.buddy)}${yourLvl} ${chalk.gray('(' + state.you.type.toUpperCase() + ')')}  ${chalk.dim('— ' + state.you.name)}`);
  lines.push(`  │ HP: ${healthBar(state.you.hp, state.you.maxHp)}`);
  lines.push(`  │ ATK:${chalk.red(state.you.atk)} DEF:${chalk.blue(state.you.def)} SPD:${chalk.yellow(state.you.spd)}`);
  for (const line of yourArt) {
    lines.push(`  │ ${yourType(line)}`);
  }
  lines.push(chalk.gray('  └────────────────────────────────────────────┘'));

  lines.push('');

  // Battle log
  if (state.log && state.log.length > 0) {
    lines.push(chalk.gray('  ┌─ BATTLE LOG ────────────────────────────────┐'));
    for (const msg of state.log) {
      let styled = msg;
      if (msg.includes('Super effective')) styled = chalk.green(msg);
      else if (msg.includes('Not very effective')) styled = chalk.yellow(msg);
      else if (msg.includes('missed')) styled = chalk.gray(msg);
      else if (msg.includes('wins')) styled = chalk.bold.yellow(msg);
      else if (msg.includes('fainted')) styled = chalk.red(msg);
      else if (msg.includes('→')) styled = chalk.cyan(msg);
      lines.push(`  │ ${styled}`);
    }
    lines.push(chalk.gray('  └────────────────────────────────────────────┘'));
  }

  return lines.join('\n');
}

function renderSkillMenu(skills) {
  const choices = skills.map((s, i) => {
    const cat = s.category === 'inject' ? chalk.red('⚔ INJECT')
              : s.category === 'defend' ? chalk.blue('🛡 DEFEND')
              : chalk.yellow('⚡ UTIL');

    const power = s.power > 0 ? chalk.white(`PWR:${s.power}`) : chalk.gray('---');
    const acc = chalk.gray(`ACC:${s.accuracy}%`);
    const type = typeColor(s.type)(`[${s.type.toUpperCase()}]`);

    return {
      name: `${cat} ${chalk.bold(s.name)} ${type} ${power} ${acc}\n         ${chalk.dim(s.description)}`,
      value: s.id,
      short: s.name,
    };
  });

  return choices;
}

function renderTitle() {
  return `
${chalk.red('  ____            _     _         ')}
${chalk.yellow(' | __ ) _   _  __| | __| |_   _   ')}
${chalk.green(' |  _ \\| | | |/ _` |/ _` | | | |  ')}
${chalk.cyan(' | |_) | |_| | (_| | (_| | |_| |  ')}
${chalk.blue(' |____/ \\__,_|\\__,_|\\__,_|\\__, |  ')}
${chalk.magenta('  ____        _   _   _  |___/    ')}
${chalk.red(' | __ )  __ _| |_| |_| | ___      ')}
${chalk.yellow(' |  _ \\ / _` | __| __| |/ _ \\     ')}
${chalk.green(' | |_) | (_| | |_| |_| |  __/     ')}
${chalk.cyan(' |____/ \\__,_|\\__|\\__|_|\\___|     ')}
${chalk.gray('                                    ')}
${chalk.bold.white('   ⚔  Battle your buddy. Stake repos.  ⚔')}
`;
}

function renderVictory(winnerName, loserName) {
  return `
${chalk.yellow('  ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★')}

${chalk.bold.green(`    ${winnerName} WINS!`)}

${chalk.red(`    ${loserName} must share a private repo...`)}

${chalk.yellow('  ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★')}
`;
}

function xpBar(currentXp, neededXp, level, maxLevel, width = 20) {
  if (level >= maxLevel) {
    return chalk.yellow('★'.repeat(width)) + chalk.bold.yellow(' MAX');
  }
  const ratio = neededXp > 0 ? Math.min(1, currentXp / neededXp) : 0;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const bar = chalk.cyan('▓'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  return `${bar} ${currentXp}/${neededXp} XP`;
}

function renderXpGain(xpGained, levelUps, newLevel, newXp, neededXp, maxLevel) {
  const lines = [];
  lines.push('');
  lines.push(chalk.gray('  ┌─ XP RESULTS ────────────────────────────────┐'));
  lines.push(`  │  ${chalk.cyan('+')}${chalk.bold.cyan(xpGained + ' XP')} earned!`);

  for (const lu of levelUps) {
    lines.push(`  │`);
    lines.push(`  │  ${chalk.bold.yellow('★ LEVEL UP! → Lv.' + lu.level)}`);
    const statName = lu.statBoosted.toUpperCase();
    const amount = lu.amount;
    lines.push(`  │  ${chalk.green('+' + amount + ' ' + statName)}`);
    if (lu.milestoneStat) {
      lines.push(`  │  ${chalk.green('+1 ' + lu.milestoneStat.toUpperCase())} (milestone)`);
    }
    if (lu.newSkill) {
      lines.push(`  │  ${chalk.magenta('NEW SKILL: ' + lu.newSkill.name + '!')}`);
    }
  }

  lines.push(`  │`);
  lines.push(`  │  Lv.${newLevel}  ${xpBar(newXp, neededXp, newLevel, maxLevel)}`);
  lines.push(chalk.gray('  └────────────────────────────────────────────┘'));
  lines.push('');
  return lines.join('\n');
}

module.exports = { renderBattleScreen, renderSkillMenu, renderTitle, renderVictory, healthBar, typeColor, xpBar, renderXpGain };
