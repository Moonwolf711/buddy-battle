// Leveling & XP system — progression, stat scaling, skill unlocks
const { getSkillPool } = require('./skills');

const MAX_LEVEL = 20;

// XP needed to reach a given level: level * 25
function xpForLevel(level) {
  return level * 25;
}

// Total XP needed from level 1 to reach target level
function totalXpForLevel(level) {
  let total = 0;
  for (let l = 2; l <= level; l++) {
    total += xpForLevel(l);
  }
  return total;
}

// XP remaining to reach next level from current xp at current level
function xpToNextLevel(level, currentXp) {
  if (level >= MAX_LEVEL) return 0;
  const needed = xpForLevel(level + 1);
  return Math.max(0, needed - currentXp);
}

// Calculate XP reward from a battle
// win: true/false, enemyLevel: opponent's level
function calcXpReward(won, enemyLevel) {
  if (won) {
    return 30 + (enemyLevel * 5);
  }
  return 10 + (enemyLevel * 2);
}

// Skills unlocked at milestone levels
const LEVEL_SKILL_MILESTONES = [5, 10, 15, 20];

// Get a new skill at a milestone level (picks from species pool, skipping already known)
function getNewSkillForLevel(level, species, knownSkillIds) {
  if (!LEVEL_SKILL_MILESTONES.includes(level)) return null;
  const pool = getSkillPool(species);
  const available = pool.filter(s => !knownSkillIds.includes(s.id));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// Apply level-up stat boosts
// +2 to a random stat (HP gets +5 instead)
// Every 3 levels: +1 to highest stat
function applyLevelUpBoosts(stats) {
  const statKeys = ['hp', 'atk', 'def', 'spd'];
  const boosted = { ...stats };

  // +2 to a random stat (HP gets +5)
  const randomStat = statKeys[Math.floor(Math.random() * statKeys.length)];
  if (randomStat === 'hp') {
    boosted.hp += 5;
  } else {
    boosted[randomStat] += 2;
  }

  return { boosted, randomStat };
}

function applyMilestoneBoost(stats, level) {
  // Every 3 levels: +1 to highest non-HP stat
  if (level % 3 === 0) {
    const boosted = { ...stats };
    let highestStat = 'atk';
    let highestVal = 0;
    for (const s of ['atk', 'def', 'spd']) {
      if (boosted[s] > highestVal) {
        highestVal = boosted[s];
        highestStat = s;
      }
    }
    boosted[highestStat] += 1;
    return { boosted, milestoneStat: highestStat };
  }
  return { boosted: stats, milestoneStat: null };
}

// Main XP award function
// buddy: { level, xp, stats: {hp, atk, def, spd}, species?, unlockedSkills? }
// won: boolean, enemyLevel: number
// Returns: { xpGained, levelsGained, newLevel, newXp, newStats, levelUps: [...], newSkill }
function awardXP(buddy, won, enemyLevel) {
  const xpGained = calcXpReward(won, enemyLevel);
  let currentXp = (buddy.xp || 0) + xpGained;
  let currentLevel = buddy.level || 1;
  let stats = { ...buddy.stats };
  const levelUps = [];
  let newSkill = null;

  // Process level ups
  while (currentLevel < MAX_LEVEL) {
    const needed = xpForLevel(currentLevel + 1);
    if (currentXp >= needed) {
      currentXp -= needed;
      currentLevel++;

      // Apply stat boosts
      const { boosted, randomStat } = applyLevelUpBoosts(stats);
      stats = boosted;

      const { boosted: boosted2, milestoneStat } = applyMilestoneBoost(stats, currentLevel);
      stats = boosted2;

      const levelUp = {
        level: currentLevel,
        statBoosted: randomStat,
        amount: randomStat === 'hp' ? 5 : 2,
        milestoneStat,
      };

      // Check for new skill unlock
      if (buddy.species && LEVEL_SKILL_MILESTONES.includes(currentLevel)) {
        const knownIds = (buddy.unlockedSkills || []).map(s => typeof s === 'string' ? s : s.id);
        const skill = getNewSkillForLevel(currentLevel, buddy.species, knownIds);
        if (skill) {
          levelUp.newSkill = skill;
          newSkill = skill;
        }
      }

      levelUps.push(levelUp);
    } else {
      break;
    }
  }

  return {
    xpGained,
    levelsGained: levelUps.length,
    newLevel: currentLevel,
    newXp: currentXp,
    newStats: stats,
    levelUps,
    newSkill,
  };
}

module.exports = {
  MAX_LEVEL,
  xpForLevel,
  totalXpForLevel,
  xpToNextLevel,
  calcXpReward,
  awardXP,
  LEVEL_SKILL_MILESTONES,
};
