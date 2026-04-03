# buddy-clash

> Pick a buddy. Learn skills. Battle your friends. **Loser shares a private repo.**

```bash
npx buddy-clash
```

## What it looks like

```
  ⚔  BUDDY BATTLE — Turn 3  ⚔

  ┌─ OPPONENT ─────────────────────────────────┐
  │ Wild Dragon Lv.5 (ELECTRIC)
  │ HP: ██████████████████░░ 116/130
  │         /\_
  │        / o >
  │       /  ^_/
  │      <_/| |\~
  └────────────────────────────────────────────┘

          ─── vs ───

  ┌─ YOUR BUDDY ───────────────────────────────┐
  │ Marblisk Lv.4 (WATER)
  │ HP: ████████░░░░░░░░░░░░ 52/129
  │ ATK:17 DEF:12 SPD:10
  │     ___
  │    /o o\
  │   ( =^= )
  │   /|||||\
  └────────────────────────────────────────────┘

  Your moves:
  1) ⚔ Ink Blast (water) PWR:20
  2) ⚔ DDoS Wave (electric) PWR:15
  3) 🛡 Sandbox — immune to next attack
  4) 🛡 Patch Vuln — restore 20 HP
```

## How to play

**Solo** — fight bots, earn XP, level up:
```bash
npx buddy-clash
# Pick "Practice (fight a bot)"
```

**Online** — battle a friend:
```bash
# Player 1:
npx buddy-clash
# Pick "Host a battle" → get a room code like A1B2C3

# Player 2:
npx buddy-clash
# Pick "Join a battle" → enter the room code
```

That's it. No accounts, no setup.

## The stakes

Before a battle, each player can **stake a GitHub repo**. The game evaluates your repo's rarity:

| | Tier | What it means |
|-|------|--------------|
| ⬜ | Common | Empty repo, no README |
| 🟩 | Uncommon | Active project, some structure |
| 🟦 | Rare | Has tests, CI, multiple contributors |
| 🟪 | Epic | 200+ stars, Docker, deployed |
| 🟨 | Mythic | 1000+ stars, full infra |

**Loser** adds the winner as a collaborator on their staked repo. Or they become partners and build something together.

## Buddies

| Buddy | Type | Style |
|-------|------|-------|
| 🐙 Octopus | Water | Tanky, DOT damage |
| 🦊 Fox | Fire | Fast, high attack |
| 🦉 Owl | Shadow | Debuffs, vision |
| 🐉 Dragon | Electric | Slow but devastating |
| 🐱 Cat | Glitch | Unpredictable, tricky |
| 🐧 Penguin | Ice | Defensive wall |

## Skills

20+ dev-themed skills in 3 categories:

**Attack:** SQL Inject, Fork Bomb, rm -rf /, XSS Strike, DDoS Wave, Buffer Overflow, Ice Shard, Phishing Lure

**Defend:** Firewall, Encrypt, Sandbox, Patch Vuln, Rate Limit, Backup Restore

**Utility:** sudo, Overclock, npm audit, git blame

Each buddy has a pool of 8 skills — you pick 4 for battle.

## Leveling

- Win or lose, you earn XP
- Level up = stat boosts + new skills
- Your progress saves between sessions
- Max level: 20

## Type chart

Water beats Fire. Fire beats Ice. Electric beats Water. You get the idea.

```
Water → Fire → Ice → Water
Electric → Water    Shadow → Glitch → Electric
```

## Built with Claude Code

This entire game — battle engine, multiplayer relay, leveling system, repo rarity evaluator — was built in a single Claude Code session. It works as a `/buddy-clash` slash command inside Claude Code too.

**npm:** https://www.npmjs.com/package/buddy-clash
**GitHub:** https://github.com/Moonwolf711/buddy-battle

## License

MIT
