// Repo rarity evaluation — scores GitHub repos as Common/Uncommon/Rare/Epic/Mythic
const { execSync } = require('child_process');
const chalk = require('chalk');

const RARITY = {
  COMMON:   { name: 'Common',   color: chalk.gray,    emoji: '⬜', tier: 1, min: 0 },
  UNCOMMON: { name: 'Uncommon', color: chalk.green,   emoji: '🟩', tier: 2, min: 15 },
  RARE:     { name: 'Rare',     color: chalk.blue,    emoji: '🟦', tier: 3, min: 35 },
  EPIC:     { name: 'Epic',     color: chalk.magenta, emoji: '🟪', tier: 4, min: 60 },
  MYTHIC:   { name: 'Mythic',   color: chalk.yellow,  emoji: '🟨', tier: 5, min: 85 },
};

// Strict validation: owner/repo must be alphanumeric, hyphens, underscores, dots only
const REPO_NAME_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

function validateRepoName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length > 200) return false;
  return REPO_NAME_RE.test(name);
}

function validateGitHubUsername(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length > 100) return false;
  return /^[a-zA-Z0-9._-]+$/.test(name);
}

function gh(cmd) {
  try {
    // Use full path or rely on shell to find gh
    const opts = { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'], shell: true };
    return execSync(`gh ${cmd}`, opts).trim();
  } catch (e) {
    return null;
  }
}

function evaluateRepo(repoFullName) {
  // repoFullName: "owner/repo"
  if (!validateRepoName(repoFullName)) {
    return { rarity: RARITY.COMMON, score: 0, error: 'Invalid repo name. Must be owner/repo (alphanumeric, hyphens, dots, underscores only).' };
  }

  const score = { total: 0, breakdown: {}, details: {} };

  // 1. Basic repo info
  const infoRaw = gh(`api repos/${repoFullName} --jq "{stars: .stargazers_count, forks: .forks_count, size: .size, lang: .language, desc: .description, has_wiki: .has_wiki, license: .license.spdx_id, created: .created_at, updated: .pushed_at, private: .private, archived: .archived}"`);

  if (!infoRaw) {
    return { rarity: RARITY.COMMON, score: 0, error: 'Could not fetch repo info. Is gh authenticated?' };
  }

  let info;
  try { info = JSON.parse(infoRaw); } catch { return { rarity: RARITY.COMMON, score: 0, error: 'Invalid repo data' }; }

  score.details.private = info.private;
  score.details.language = info.lang;
  score.details.description = info.desc;

  // Stars (0-20 points)
  const stars = info.stars || 0;
  if (stars >= 1000) score.breakdown.stars = 20;
  else if (stars >= 200) score.breakdown.stars = 16;
  else if (stars >= 50) score.breakdown.stars = 12;
  else if (stars >= 10) score.breakdown.stars = 8;
  else if (stars >= 1) score.breakdown.stars = 3;
  else score.breakdown.stars = 0;
  score.details.stars = stars;

  // Forks (0-10 points)
  const forks = info.forks || 0;
  if (forks >= 100) score.breakdown.forks = 10;
  else if (forks >= 20) score.breakdown.forks = 7;
  else if (forks >= 5) score.breakdown.forks = 4;
  else if (forks >= 1) score.breakdown.forks = 2;
  else score.breakdown.forks = 0;

  // Size (0-10 points) — larger = more substantial
  const sizeKB = info.size || 0;
  if (sizeKB >= 10000) score.breakdown.size = 10;
  else if (sizeKB >= 1000) score.breakdown.size = 7;
  else if (sizeKB >= 100) score.breakdown.size = 4;
  else if (sizeKB >= 10) score.breakdown.size = 2;
  else score.breakdown.size = 0;

  // Activity (0-15 points) — recent pushes = active project
  const lastPush = new Date(info.updated);
  const daysSincePush = (Date.now() - lastPush.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSincePush < 7) score.breakdown.activity = 15;
  else if (daysSincePush < 30) score.breakdown.activity = 12;
  else if (daysSincePush < 90) score.breakdown.activity = 8;
  else if (daysSincePush < 365) score.breakdown.activity = 4;
  else score.breakdown.activity = 1;
  score.details.lastPush = `${Math.floor(daysSincePush)}d ago`;

  // Contributors (0-10 points)
  const contribRaw = gh(`api repos/${repoFullName}/contributors --jq 'length'`);
  const contributors = parseInt(contribRaw) || 1;
  if (contributors >= 20) score.breakdown.contributors = 10;
  else if (contributors >= 10) score.breakdown.contributors = 7;
  else if (contributors >= 5) score.breakdown.contributors = 5;
  else if (contributors >= 2) score.breakdown.contributors = 3;
  else score.breakdown.contributors = 1;
  score.details.contributors = contributors;

  // Languages diversity (0-10 points)
  const langsRaw = gh(`api repos/${repoFullName}/languages --jq 'keys | length'`);
  const langCount = parseInt(langsRaw) || 1;
  if (langCount >= 5) score.breakdown.languages = 10;
  else if (langCount >= 3) score.breakdown.languages = 7;
  else if (langCount >= 2) score.breakdown.languages = 4;
  else score.breakdown.languages = 2;
  score.details.languages = langCount;

  // Topics (0-5 points) — fetch first since infra uses it
  const topicsRaw = gh(`api repos/${repoFullName}/topics --jq ".names | length"`);
  const topicCount = parseInt(topicsRaw) || 0;
  score.breakdown.topics = Math.min(5, topicCount);

  // Has key files (0-15 points)
  let infraScore = 0;
  const treeRaw = gh(`api repos/${repoFullName}/git/trees/HEAD --jq "[.tree[].path] | join(\\",\\")"`)
    || gh(`api repos/${repoFullName}/contents --jq "[.[].name] | join(\\",\\")"`)
    || '';
  const files = treeRaw.toLowerCase().split(',');

  if (files.some(f => f.includes('readme'))) infraScore += 2;
  if (files.some(f => f.includes('license'))) infraScore += 1;
  if (files.some(f => f.includes('dockerfile') || f.includes('docker-compose'))) infraScore += 3;
  if (files.some(f => f.includes('.github') || f.includes('ci') || f.includes('.yml'))) infraScore += 3;
  if (files.some(f => f.includes('test') || f.includes('spec') || f.includes('__test'))) infraScore += 3;
  if (files.some(f => f.includes('package.json') || f.includes('cargo.toml') || f.includes('requirements.txt'))) infraScore += 1;
  if (files.some(f => f.includes('.env.example'))) infraScore += 1;
  if (topicCount > 0) infraScore += 1;
  score.breakdown.infrastructure = Math.min(15, infraScore);

  // License bonus (0-5 points)
  if (info.license) score.breakdown.license = 3;
  else score.breakdown.license = 0;

  // Total
  score.total = Object.values(score.breakdown).reduce((a, b) => a + b, 0);

  // Determine rarity
  let rarity = RARITY.COMMON;
  if (score.total >= RARITY.MYTHIC.min) rarity = RARITY.MYTHIC;
  else if (score.total >= RARITY.EPIC.min) rarity = RARITY.EPIC;
  else if (score.total >= RARITY.RARE.min) rarity = RARITY.RARE;
  else if (score.total >= RARITY.UNCOMMON.min) rarity = RARITY.UNCOMMON;

  return { rarity, score: score.total, breakdown: score.breakdown, details: score.details };
}

function renderRepoCard(repoFullName, evaluation) {
  const r = evaluation.rarity;
  const d = evaluation.details || {};
  const lines = [];

  if (evaluation.error) {
    lines.push('');
    lines.push(chalk.red(`  ⚠  Could not evaluate: ${evaluation.error}`));
    lines.push(chalk.gray(`  Repo: ${repoFullName} — defaulting to Common\n`));
    return lines.join('\n');
  }

  lines.push('');
  lines.push(r.color(`  ┌─ ${r.emoji} REPO STAKE ─ ${r.name.toUpperCase()} ──────────────────────┐`));
  lines.push(r.color(`  │`) + chalk.bold.white(` ${repoFullName}`));
  lines.push(r.color(`  │`) + chalk.gray(` ${d.language || 'Unknown'} | ${d.stars || 0} stars | ${d.contributors || 1} contributors`));
  lines.push(r.color(`  │`) + chalk.gray(` Last push: ${d.lastPush || 'unknown'} | Private: ${d.private ? 'Yes' : 'No'}`));
  lines.push(r.color(`  │`));
  lines.push(r.color(`  │`) + ` Rarity: ${r.color.bold(`${r.emoji} ${r.name}`)} (Score: ${evaluation.score}/100)`);
  lines.push(r.color(`  │`));

  // Score breakdown
  const bd = evaluation.breakdown;
  const bar = (val, max) => {
    const filled = Math.round((val / max) * 10);
    return chalk.cyan('█'.repeat(filled)) + chalk.gray('░'.repeat(10 - filled));
  };

  lines.push(r.color(`  │`) + `  Stars:      ${bar(bd.stars || 0, 20)} ${bd.stars || 0}/20`);
  lines.push(r.color(`  │`) + `  Activity:   ${bar(bd.activity || 0, 15)} ${bd.activity || 0}/15`);
  lines.push(r.color(`  │`) + `  Infra:      ${bar(bd.infrastructure || 0, 15)} ${bd.infrastructure || 0}/15`);
  lines.push(r.color(`  │`) + `  Languages:  ${bar(bd.languages || 0, 10)} ${bd.languages || 0}/10`);
  lines.push(r.color(`  │`) + `  Size:       ${bar(bd.size || 0, 10)} ${bd.size || 0}/10`);
  lines.push(r.color(`  │`) + `  Community:  ${bar((bd.forks || 0) + (bd.contributors || 0), 20)} ${(bd.forks || 0) + (bd.contributors || 0)}/20`);
  lines.push(r.color(`  └────────────────────────────────────────────────┘`));
  lines.push('');

  return lines.join('\n');
}

function renderRarityComparison(stake1, eval1, stake2, eval2) {
  const diff = Math.abs(eval1.rarity.tier - eval2.rarity.tier);
  const lines = [];

  lines.push(chalk.bold('\n  ⚖  STAKE COMPARISON\n'));
  lines.push(`  ${eval1.rarity.emoji} ${eval1.rarity.color(stake1)} — ${eval1.rarity.color.bold(eval1.rarity.name)} (${eval1.score}pts)`);
  lines.push(chalk.gray('  vs'));
  lines.push(`  ${eval2.rarity.emoji} ${eval2.rarity.color(stake2)} — ${eval2.rarity.color.bold(eval2.rarity.name)} (${eval2.score}pts)`);
  lines.push('');

  if (diff >= 2) {
    lines.push(chalk.red.bold('  ⚠  RARITY MISMATCH! Difference of ' + diff + ' tiers.'));
    lines.push(chalk.yellow('  Consider evening the stakes or adding a handicap.\n'));
  } else if (diff === 1) {
    lines.push(chalk.yellow('  ⚡ Slight rarity difference — acceptable stake.\n'));
  } else {
    lines.push(chalk.green('  ✓ Fair matchup! Similar rarity.\n'));
  }

  return lines.join('\n');
}

// Stake a repo — adds collaborator invite or provides zip instructions
function getStakeCommands(repoFullName, winnerGithub, mode) {
  if (!validateRepoName(repoFullName) || !validateGitHubUsername(winnerGithub)) {
    return { description: 'Invalid repo or username', command: '# ERROR: invalid input — refusing to generate command', undo: null };
  }
  if (mode === 'collaborator') {
    return {
      description: `Add ${winnerGithub} as collaborator to ${repoFullName}`,
      command: `gh api repos/${repoFullName}/collaborators/${winnerGithub} -X PUT -f permission=pull`,
      undo: `gh api repos/${repoFullName}/collaborators/${winnerGithub} -X DELETE`,
    };
  }
  if (mode === 'partner') {
    return {
      description: `Add ${winnerGithub} as partner (write access) to ${repoFullName}`,
      command: `gh api repos/${repoFullName}/collaborators/${winnerGithub} -X PUT -f permission=push`,
      undo: `gh api repos/${repoFullName}/collaborators/${winnerGithub} -X DELETE`,
    };
  }
  if (mode === 'zip') {
    return {
      description: `Download ${repoFullName} as zip for ${winnerGithub}`,
      command: `gh api repos/${repoFullName}/zipball -H "Accept: application/vnd.github+json" > ${repoFullName.replace('/', '_')}.zip`,
    };
  }
  return null;
}

function renderStakeResult(winner, loser, winnerRepo, loserRepo, winnerEval, loserEval, mode) {
  const lines = [];

  lines.push(chalk.yellow('\n  ★ ★ ★  BATTLE STAKES RESOLVED  ★ ★ ★\n'));
  lines.push(chalk.bold.green(`  Winner: ${winner}`));
  lines.push(chalk.bold.red(`  Loser:  ${loser}\n`));

  lines.push(chalk.gray(`  ${loser} staked: `) + loserEval.rarity.color(`${loserEval.rarity.emoji} ${loserRepo} (${loserEval.rarity.name})`));
  lines.push('');

  if (mode === 'partner') {
    lines.push(chalk.cyan.bold(`  🤝 PARTNERSHIP MODE`));
    lines.push(chalk.white(`  ${loser} will add ${winner} as a contributor to ${loserRepo}`));
    lines.push(chalk.gray(`  (push access — you can collaborate on the project)\n`));
    const cmd = getStakeCommands(loserRepo, winner, 'partner');
    lines.push(chalk.yellow(`  Run this to honor the stake:`));
    lines.push(chalk.white(`  ${cmd.command}\n`));
  } else if (mode === 'collaborator') {
    lines.push(chalk.blue.bold(`  👁  READ ACCESS MODE`));
    lines.push(chalk.white(`  ${loser} will add ${winner} as a reader of ${loserRepo}`));
    lines.push(chalk.gray(`  (pull access — you can view and clone)\n`));
    const cmd = getStakeCommands(loserRepo, winner, 'collaborator');
    lines.push(chalk.yellow(`  Run this to honor the stake:`));
    lines.push(chalk.white(`  ${cmd.command}\n`));
  } else {
    lines.push(chalk.magenta.bold(`  📦 ZIP EXPORT MODE`));
    lines.push(chalk.white(`  ${loser} will export ${loserRepo} as a zip for ${winner}\n`));
    const cmd = getStakeCommands(loserRepo, winner, 'zip');
    lines.push(chalk.yellow(`  Run this to honor the stake:`));
    lines.push(chalk.white(`  ${cmd.command}\n`));
  }

  return lines.join('\n');
}

module.exports = {
  RARITY,
  evaluateRepo,
  renderRepoCard,
  renderRarityComparison,
  renderStakeResult,
  getStakeCommands,
  validateRepoName,
  validateGitHubUsername,
};
