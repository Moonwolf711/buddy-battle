// Battle engine — handles turn resolution, damage calc, effects
const { getEffectiveness } = require('./buddies');

class BattleEngine {
  constructor(player1, player2) {
    // player: { name, buddy: { species, nickname, type, stats: {hp,atk,def,spd}, maxHp, skills: [...] } }
    this.players = [player1, player2];
    this.turn = 0;
    this.log = [];
    this.effects = [
      { shield: 0, dot: [], statChanges: {} },
      { shield: 0, dot: [], statChanges: {} },
    ];
    this.winner = null;
  }

  getState(playerIndex) {
    const me = this.players[playerIndex];
    const them = this.players[1 - playerIndex];
    return {
      turn: this.turn,
      you: {
        name: me.name,
        buddy: me.buddy.nickname || me.buddy.species,
        species: me.buddy.species,
        type: me.buddy.type,
        level: me.buddy.level || 1,
        hp: me.buddy.stats.hp,
        maxHp: me.buddy.maxHp,
        atk: me.buddy.stats.atk,
        def: me.buddy.stats.def,
        spd: me.buddy.stats.spd,
        skills: me.buddy.skills,
        effects: this.effects[playerIndex],
      },
      enemy: {
        name: them.name,
        buddy: them.buddy.nickname || them.buddy.species,
        species: them.buddy.species,
        type: them.buddy.type,
        level: them.buddy.level || 1,
        hp: them.buddy.stats.hp,
        maxHp: them.buddy.maxHp,
        // Don't reveal exact stats unless npm_audit was used
      },
      log: this.log.slice(-6),
      winner: this.winner,
    };
  }

  resolveTurn(action1, action2) {
    this.turn++;
    const actions = [action1, action2];
    const messages = [];

    // Determine turn order by speed (higher goes first)
    const spd0 = this.players[0].buddy.stats.spd;
    const spd1 = this.players[1].buddy.stats.spd;

    // Check for priority moves
    const pri0 = action1.skill?.priority || 0;
    const pri1 = action2.skill?.priority || 0;

    let order;
    if (pri0 !== pri1) {
      order = pri0 > pri1 ? [0, 1] : [1, 0];
    } else if (spd0 !== spd1) {
      order = spd0 > spd1 ? [0, 1] : [1, 0];
    } else {
      order = Math.random() > 0.5 ? [0, 1] : [1, 0];
    }

    // Process DOT effects
    for (let i = 0; i < 2; i++) {
      const dots = this.effects[i].dot;
      for (let d = dots.length - 1; d >= 0; d--) {
        this.players[i].buddy.stats.hp -= dots[d].damage;
        messages.push(`${this.players[i].buddy.nickname} takes ${dots[d].damage} DOT damage!`);
        dots[d].turns--;
        if (dots[d].turns <= 0) dots.splice(d, 1);
      }
    }

    // Execute moves in order
    for (const idx of order) {
      if (this.winner) break;
      const attacker = idx;
      const defender = 1 - idx;
      const action = actions[idx];

      if (!action.skillId) {
        messages.push(`${this.players[attacker].name} does nothing!`);
        continue;
      }

      const skill = action.skill;
      const atkBuddy = this.players[attacker].buddy;
      const defBuddy = this.players[defender].buddy;

      // Accuracy check
      const roll = Math.random() * 100;
      if (roll > skill.accuracy) {
        messages.push(`${atkBuddy.nickname} used ${skill.name}... but it missed!`);
        continue;
      }

      messages.push(`${atkBuddy.nickname} used ${skill.name}!`);

      // Damage calculation
      if (skill.power > 0) {
        // Check shield
        if (this.effects[defender].shield > 0) {
          this.effects[defender].shield--;
          messages.push(`${defBuddy.nickname}'s Sandbox blocked the attack!`);
        } else {
          const effectiveness = getEffectiveness(skill.type, defBuddy.type);
          const stab = skill.type === atkBuddy.type ? 1.3 : 1.0;
          const atkStat = Math.max(1, atkBuddy.stats.atk);
          const defStat = Math.max(1, defBuddy.stats.def);
          const variance = 0.85 + Math.random() * 0.15;
          // Level advantage: each level difference gives ~2% bonus/penalty
          const atkLevel = atkBuddy.level || 1;
          const defLevel = defBuddy.level || 1;
          const levelBonus = 1 + (atkLevel - defLevel) * 0.02;
          const damage = Math.floor(skill.power * (atkStat / defStat) * effectiveness * stab * variance * Math.max(0.5, levelBonus));

          defBuddy.stats.hp = Math.max(0, defBuddy.stats.hp - damage);

          let msg = `  → ${damage} damage!`;
          if (effectiveness > 1) msg += ' Super effective!';
          if (effectiveness < 1) msg += ' Not very effective...';
          if (stab > 1) msg += ' (STAB)';
          messages.push(msg);
        }
      }

      // Apply effects
      if (skill.effect) {
        const eff = skill.effect;
        const target = eff.target === 'self' ? attacker : defender;
        const targetBuddy = this.players[target].buddy;

        if (eff.heal) {
          const healed = Math.min(eff.heal, targetBuddy.maxHp - targetBuddy.stats.hp);
          targetBuddy.stats.hp += healed;
          messages.push(`  → ${targetBuddy.nickname} restored ${healed} HP!`);
        }

        if (eff.stat && eff.stat !== 'all') {
          targetBuddy.stats[eff.stat] = Math.max(1, targetBuddy.stats[eff.stat] + eff.change);
          const dir = eff.change > 0 ? 'rose' : 'fell';
          messages.push(`  → ${targetBuddy.nickname}'s ${eff.stat.toUpperCase()} ${dir} by ${Math.abs(eff.change)}!`);
        }

        if (eff.stat === 'all') {
          for (const s of ['atk', 'def', 'spd']) {
            targetBuddy.stats[s] = Math.max(1, targetBuddy.stats[s] + eff.change);
          }
          const dir = eff.change > 0 ? 'rose' : 'fell';
          messages.push(`  → ${targetBuddy.nickname}'s stats all ${dir}!`);
        }

        if (eff.stat2) {
          targetBuddy.stats[eff.stat2] = Math.max(1, targetBuddy.stats[eff.stat2] + eff.change2);
        }

        if (eff.shield) {
          this.effects[target].shield += eff.shield;
          messages.push(`  → ${targetBuddy.nickname} is protected!`);
        }

        if (eff.dot) {
          this.effects[target].dot.push({ damage: eff.dot, turns: eff.turns });
          messages.push(`  → ${targetBuddy.nickname} is taking damage over time!`);
        }

        if (eff.reveal) {
          messages.push(`  → Revealed: ATK:${targetBuddy.stats.atk} DEF:${targetBuddy.stats.def} SPD:${targetBuddy.stats.spd}`);
        }
      }

      // Check KO
      if (defBuddy.stats.hp <= 0) {
        this.winner = attacker;
        messages.push(`${defBuddy.nickname} fainted! ${this.players[attacker].name} wins!`);
        break;
      }
    }

    this.log.push(...messages);
    return { messages, winner: this.winner };
  }
}

module.exports = { BattleEngine };
