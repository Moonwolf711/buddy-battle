# buddy-clash

**Pokemon-style CLI battler for Claude Code companions. Stake GitHub repos.**

```bash
npx buddy-clash
```

## What is this?

Turn your Claude Code companion into a battle creature. Pick a buddy, choose skills, fight bots or battle friends online. **Loser stakes a private GitHub repo.**

Built in a single Claude Code session.

## Features

- **6 creatures** — Octopus, Fox, Owl, Dragon, Cat, Penguin — each with unique type, stats, and ASCII art
- **20+ skills** in 3 categories:
  - **Inject** (attack): SQL Inject, Fork Bomb, rm -rf, XSS Strike, DDoS Wave, Buffer Overflow
  - **Defend**: Firewall, Encrypt, Sandbox, Patch Vuln, Rate Limit, Backup Restore
  - **Utility**: sudo, Overclock, npm audit, git blame
- **Type effectiveness** — Water > Fire > Ice > Water, Electric > Water, Shadow > Glitch, etc.
- **Online multiplayer** — WebSocket relay, no IPs needed, just share a room code
- **Leveling system** — XP on win/loss, stat boosts, skill unlocks at milestones
- **Repo stakes** — Bet private repos on battles. Repos are rated **Common → Uncommon → Rare → Epic → Mythic** based on stars, CI, tests, contributors, and activity via the GitHub API
- **Claude Code native** — Works as a `/buddy-clash` slash command, no TTY required

## Quick Start

```bash
# Interactive mode (real terminal)
npx buddy-clash

# Solo practice (works in Claude Code)
node src/auto-battle.js --pick octopus Marblisk ink_blast,sql_inject,sandbox,patch_vuln --auto

# Online multiplayer
node src/online-battle.js host --stake Moonwolf711/my-repo
node src/online-battle.js join A1B2C3 --stake friend/their-repo

# Evaluate a repo's rarity
node src/online-battle.js evaluate facebook/react
```

## Type Chart

| Type | Strong vs | Weak vs |
|------|-----------|---------|
| Water | Fire | Electric, Glitch, Ice |
| Fire | Ice, Glitch | Water |
| Electric | Water, Shadow | Glitch |
| Shadow | Glitch, Ice | Fire, Electric |
| Glitch | Electric, Water | Shadow, Fire |
| Ice | Water | Fire, Shadow |

## Repo Rarity Tiers

| Tier | Score | What qualifies |
|------|-------|---------------|
| ⬜ Common | 0-14 | Empty/abandoned, no README |
| 🟩 Uncommon | 15-34 | Active project, basic structure |
| 🟦 Rare | 35-59 | Tests + CI, multiple contributors |
| 🟪 Epic | 60-84 | 200+ stars, Docker, deployed |
| 🟨 Mythic | 85+ | 1000+ stars, org-level, full infra |

## Stake Modes

| Mode | Access level | Command |
|------|-------------|---------|
| `--mode collaborator` | Read (pull) | Default — "show me your code" |
| `--mode partner` | Write (push) | "Let's work together" |
| `--mode zip` | Snapshot | "Send me a copy" |

## Architecture

```
src/
├── buddies.js        # 6 species, type chart, base stats
├── skills.js         # 20+ skills (inject/defend/utility)
├── battle.js         # Turn resolution, damage calc, effects
├── leveling.js       # XP curve, stat boosts, skill unlocks
├── save.js           # Persistent progress (~/.buddy-battle/)
├── repo-rarity.js    # GitHub API repo evaluation
├── relay-server.js   # WebSocket relay (Railway)
├── online-battle.js  # Non-interactive multiplayer
├── auto-battle.js    # Claude Code compatible
├── ui.js             # ASCII art, health bars, rendering
├── client.js         # Interactive terminal client
├── server.js         # Direct P2P server
└── index.js          # Main entry / interactive menu
```

## Claude Code Integration

Add as a slash command — see `.claude/commands/buddy-battle.md` for the skill definition.

```
/buddy-battle              # Solo practice
/buddy-battle --host       # Host online room
/buddy-battle --join CODE  # Join room
/buddy-battle --evaluate owner/repo  # Check rarity
```

## Links

- **npm:** https://www.npmjs.com/package/buddy-clash
- **Feature request:** https://github.com/anthropics/claude-code/issues/43155

## License

MIT
