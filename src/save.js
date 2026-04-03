// Save/load system — persists buddy data to ~/.buddy-battle/save.json
const fs = require('fs');
const path = require('path');
const os = require('os');

const SAVE_DIR = path.join(os.homedir(), '.buddy-battle');
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

  const saveData = {
    species: buddy.species,
    nickname: buddy.nickname,
    level: buddy.level || 1,
    xp: buddy.xp || 0,
    stats: { ...buddy.stats },
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
