// Battle skills — categorized as inject (attack), defend, or utility
const SKILLS = {
  // === INJECT (Attack) Skills ===
  sql_inject: {
    name: 'SQL Inject',
    type: 'glitch',
    category: 'inject',
    power: 25,
    accuracy: 90,
    description: 'DROP TABLE health; -- Devastating data attack',
    effect: null,
  },
  fork_bomb: {
    name: 'Fork Bomb',
    type: 'electric',
    category: 'inject',
    power: 35,
    accuracy: 75,
    description: ':(){ :|:& };: — Overwhelm their processes',
    effect: { stat: 'spd', change: -2, target: 'enemy' },
  },
  buffer_overflow: {
    name: 'Buffer Overflow',
    type: 'shadow',
    category: 'inject',
    power: 30,
    accuracy: 85,
    description: 'Smash the stack, corrupt their memory',
    effect: { stat: 'def', change: -1, target: 'enemy' },
  },
  ink_blast: {
    name: 'Ink Blast',
    type: 'water',
    category: 'inject',
    power: 20,
    accuracy: 100,
    description: 'Blind them with ink — never misses',
    effect: null,
  },
  flame_patch: {
    name: 'Flame Patch',
    type: 'fire',
    category: 'inject',
    power: 28,
    accuracy: 90,
    description: 'Hot-patch their runtime with fire',
    effect: { stat: 'def', change: -1, target: 'enemy' },
  },
  xss_strike: {
    name: 'XSS Strike',
    type: 'glitch',
    category: 'inject',
    power: 22,
    accuracy: 95,
    description: '<script>alert("pwned")</script>',
    effect: { stat: 'atk', change: -1, target: 'enemy' },
  },
  ice_shard: {
    name: 'Ice Shard',
    type: 'ice',
    category: 'inject',
    power: 18,
    accuracy: 100,
    description: 'Quick freeze — always strikes first',
    effect: null,
    priority: 1,
  },
  rm_rf: {
    name: 'rm -rf /',
    type: 'shadow',
    category: 'inject',
    power: 50,
    accuracy: 50,
    description: 'Nuclear option. High risk, high reward.',
    effect: null,
  },
  ddos_wave: {
    name: 'DDoS Wave',
    type: 'electric',
    category: 'inject',
    power: 15,
    accuracy: 100,
    description: 'Flood their ports — hits every turn for 3 turns',
    effect: { dot: 8, turns: 3, target: 'enemy' },
  },
  phishing_lure: {
    name: 'Phishing Lure',
    type: 'water',
    category: 'inject',
    power: 20,
    accuracy: 85,
    description: 'Trick them into revealing weaknesses',
    effect: { stat: 'def', change: -2, target: 'enemy' },
  },

  // === DEFEND Skills ===
  firewall: {
    name: 'Firewall',
    type: 'fire',
    category: 'defend',
    power: 0,
    accuracy: 100,
    description: 'Block incoming attacks this turn (+3 DEF)',
    effect: { stat: 'def', change: 3, target: 'self' },
  },
  encrypt: {
    name: 'Encrypt',
    type: 'electric',
    category: 'defend',
    power: 0,
    accuracy: 100,
    description: 'Harden your session with AES-256',
    effect: { stat: 'def', change: 2, target: 'self' },
  },
  patch_vuln: {
    name: 'Patch Vuln',
    type: 'ice',
    category: 'defend',
    power: 0,
    accuracy: 100,
    description: 'Patch a vulnerability, restore 20 HP',
    effect: { heal: 20, target: 'self' },
  },
  sandbox: {
    name: 'Sandbox',
    type: 'shadow',
    category: 'defend',
    power: 0,
    accuracy: 100,
    description: 'Isolate the threat — immune to next attack',
    effect: { shield: 1, target: 'self' },
  },
  rate_limit: {
    name: 'Rate Limit',
    type: 'water',
    category: 'defend',
    power: 0,
    accuracy: 100,
    description: 'Throttle their attacks (-3 SPD to enemy)',
    effect: { stat: 'spd', change: -3, target: 'enemy' },
  },
  backup_restore: {
    name: 'Backup Restore',
    type: 'glitch',
    category: 'defend',
    power: 0,
    accuracy: 100,
    description: 'git stash pop — restore 35 HP but -1 DEF',
    effect: { heal: 35, stat: 'def', change: -1, target: 'self' },
  },

  // === UTILITY Skills ===
  sudo: {
    name: 'sudo',
    type: 'shadow',
    category: 'utility',
    power: 0,
    accuracy: 100,
    description: 'Elevate privileges — +3 ATK for 3 turns',
    effect: { stat: 'atk', change: 3, target: 'self', duration: 3 },
  },
  overclock: {
    name: 'Overclock',
    type: 'electric',
    category: 'utility',
    power: 0,
    accuracy: 100,
    description: 'Push to the limit — +4 SPD, -1 DEF',
    effect: { stat: 'spd', change: 4, stat2: 'def', change2: -1, target: 'self' },
  },
  npm_audit: {
    name: 'npm audit',
    type: 'glitch',
    category: 'utility',
    power: 0,
    accuracy: 100,
    description: 'Scan for weaknesses — reveals enemy stats',
    effect: { reveal: true, target: 'enemy' },
  },
  git_blame: {
    name: 'git blame',
    type: 'shadow',
    category: 'utility',
    power: 10,
    accuracy: 100,
    description: 'Expose their commits — reduces all stats by 1',
    effect: { stat: 'all', change: -1, target: 'enemy' },
  },
};

// Skills available per buddy type
const BUDDY_SKILL_POOL = {
  octopus: ['ink_blast', 'phishing_lure', 'ddos_wave', 'sql_inject', 'sandbox', 'rate_limit', 'patch_vuln', 'npm_audit'],
  fox: ['flame_patch', 'xss_strike', 'fork_bomb', 'firewall', 'sudo', 'overclock', 'rm_rf', 'git_blame'],
  owl: ['buffer_overflow', 'rm_rf', 'git_blame', 'npm_audit', 'encrypt', 'sandbox', 'sudo', 'phishing_lure'],
  dragon: ['fork_bomb', 'flame_patch', 'ddos_wave', 'rm_rf', 'firewall', 'encrypt', 'overclock', 'buffer_overflow'],
  cat: ['xss_strike', 'sql_inject', 'phishing_lure', 'git_blame', 'sandbox', 'backup_restore', 'overclock', 'npm_audit'],
  penguin: ['ice_shard', 'ddos_wave', 'buffer_overflow', 'rate_limit', 'encrypt', 'patch_vuln', 'firewall', 'backup_restore'],
};

function getSkill(id) {
  return SKILLS[id] ? { id, ...SKILLS[id] } : null;
}

function getSkillPool(buddyType) {
  const pool = BUDDY_SKILL_POOL[buddyType] || [];
  return pool.map(id => getSkill(id)).filter(Boolean);
}

module.exports = { SKILLS, BUDDY_SKILL_POOL, getSkill, getSkillPool };
