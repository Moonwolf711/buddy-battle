// Buddy species definitions — each has base stats, type, and learnable skills
const BUDDY_TYPES = {
  octopus: {
    name: 'Octopus',
    emoji: '🐙',
    type: 'water',
    baseStats: { hp: 120, atk: 14, def: 12, spd: 10 },
    ascii: [
      '    ___     ',
      '   /o o\\    ',
      '  ( =^= )   ',
      '  /|||||\\   ',
      ' / ||||| \\  ',
      '  // | \\\\   ',
    ],
    description: 'Ink-slinging tentacle master',
  },
  fox: {
    name: 'Fox',
    emoji: '🦊',
    type: 'fire',
    baseStats: { hp: 100, atk: 16, def: 8, spd: 16 },
    ascii: [
      '   /\\_/\\    ',
      '  ( o.o )   ',
      '   > ^ <    ',
      '  /|   |\\   ',
      ' (_|   |_)  ',
      '    " "     ',
    ],
    description: 'Swift and cunning code thief',
  },
  owl: {
    name: 'Owl',
    emoji: '🦉',
    type: 'shadow',
    baseStats: { hp: 110, atk: 15, def: 10, spd: 12 },
    ascii: [
      '   {o,o}    ',
      '   |)__)    ',
      '   -"-"-    ',
      '   /| |\\    ',
      '  (_| |_)   ',
      '            ',
    ],
    description: 'Wise debugger, sees all vulnerabilities',
  },
  dragon: {
    name: 'Dragon',
    emoji: '🐉',
    type: 'electric',
    baseStats: { hp: 130, atk: 18, def: 14, spd: 6 },
    ascii: [
      '    /\\_     ',
      '   / o >    ',
      '  /  ^_/    ',
      ' <_/| |\\~   ',
      '    | | \\   ',
      '    |_|_/   ',
    ],
    description: 'Raw power, slow but devastating',
  },
  cat: {
    name: 'Cat',
    emoji: '🐱',
    type: 'glitch',
    baseStats: { hp: 90, atk: 12, def: 10, spd: 18 },
    ascii: [
      '   /\\_/\\    ',
      '  ( ^.^ )   ',
      '   (\")(\")   ',
      '    | |     ',
      '   _| |_    ',
      '  |_____|   ',
    ],
    description: 'Unpredictable glitch exploiter',
  },
  penguin: {
    name: 'Penguin',
    emoji: '🐧',
    type: 'ice',
    baseStats: { hp: 115, atk: 11, def: 16, spd: 8 },
    ascii: [
      '    (o)     ',
      '   /| |\\    ',
      '  (_\\ /_)   ',
      '    | |     ',
      '   _| |_    ',
      '  |_____|   ',
    ],
    description: 'Linux-hardened defensive wall',
  },
};

// Type effectiveness chart
const TYPE_CHART = {
  water:    { fire: 2.0, electric: 0.5, ice: 0.5, water: 0.5, shadow: 1.0, glitch: 1.0 },
  fire:     { ice: 2.0, glitch: 2.0, water: 0.5, fire: 0.5, shadow: 1.0, electric: 1.0 },
  electric: { water: 2.0, shadow: 2.0, electric: 0.5, ice: 1.0, fire: 1.0, glitch: 0.5 },
  shadow:   { glitch: 2.0, ice: 2.0, fire: 0.5, shadow: 0.5, water: 1.0, electric: 0.5 },
  glitch:   { electric: 2.0, water: 2.0, shadow: 0.5, glitch: 0.5, fire: 0.5, ice: 1.0 },
  ice:      { fire: 0.5, shadow: 0.5, water: 2.0, glitch: 1.0, electric: 1.0, ice: 0.5 },
};

function getEffectiveness(attackType, defenderType) {
  return TYPE_CHART[attackType]?.[defenderType] ?? 1.0;
}

module.exports = { BUDDY_TYPES, TYPE_CHART, getEffectiveness };
