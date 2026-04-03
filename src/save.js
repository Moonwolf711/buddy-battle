// Save/load system — persists buddy data to ~/.buddy-battle/save.json
const fs = require('fs');
const path = require('path');
const os = require('os');

const { BUDDY_TYPES } = require('./buddies');

const SAVE_DIR = path.join(os.homedir(), '.buddy-battle');

// Quick lookup for base HP by species
const BUDDY_TYPES_HP = {};
for (const [key, val] of Object.entries(BUDDY_TYPES)) {
  BUDDY_TYPES_HP[key] = val.baseStats.hp;
}
const SAVE_FILE = path.join(SAVE_DIR, 'save.json');

function ensureSaveDir() {
  if (!fs.existsSync(SAVE_DIR)) {
    fs.mkdirSync(SAVE_DIR, { recursive: true });
  }
}

function loadSave() {
  try {
    ensureSaveDir();
    if (!fs.existsSync(SAVE_FILE)) return null;
    const raw = fs.readFileSync(SAVE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeSave(data) {
  ensureSaveDir();
  fs.writeFileSync(SAVE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Save buddy progress after a battle
// buddy: { species, nickname, level, xp, stats, unlockedSkills }
// won: boolean
function saveBuddyProgress(buddy, won) {
  const existing = loadSave() || {};
  const record = existing.record || { wins: 0, losses: 0 };

  if (won) {
    record.wins++;
  } else {
    record.losses++;
  }

  // NEVER save debuffed stats — always reset to base + level bonuses
  const base = BUDDY_TYPES[buddy.species]?.baseStats || { hp: 120, atk: 14, def: 12, spd: 10 };
  const lvl = buddy.level || 1;
  const savedStats = {
    hp: Math.max(buddy.stats.hp, base.hp + (lvl - 1) * 3),
    atk: Math.max(buddy.stats.atk, base.atk),
    def: Math.max(buddy.stats.def, base.def),
    spd: Math.max(buddy.stats.spd, base.spd),
  };

  const saveData = {
    species: buddy.species,
    nickname: buddy.nickname,
    level: buddy.level || 1,
    xp: buddy.xp || 0,
    stats: savedStats,
    unlockedSkills: (buddy.unlockedSkills || []).map(s => typeof s === 'string' ? s : s.id),
    record,
    lastPlayed: new Date().toISOString(),
  };

  writeSave(saveData);
  return saveData;
}

function deleteSave() {
  try {
    if (fs.existsSync(SAVE_FILE)) {
      fs.unlinkSync(SAVE_FILE);
    }
  } catch {
    // ignore
  }
}

module.exports = { loadSave, writeSave, saveBuddyProgress, deleteSave, SAVE_DIR, SAVE_FILE };
