# Contributing to buddy-clash

Thanks for your interest! Here's how to help.

## Adding a new buddy

1. Add the species to `src/buddies.js` — needs name, type, base stats, ASCII art
2. Add its skill pool to `src/skills.js` under `BUDDY_SKILL_POOL`
3. Test with `node src/auto-battle.js --pick <species> Name skill1,skill2,skill3,skill4 --auto`

## Adding a new skill

1. Add the skill definition to `SKILLS` in `src/skills.js`
2. Add it to at least one buddy's skill pool in `BUDDY_SKILL_POOL`
3. Skills need: name, type, category (inject/defend/utility), power, accuracy, description

## Running locally

```bash
git clone https://github.com/Moonwolf711/buddy-battle
cd buddy-battle
npm install
node src/index.js
```

## Pull requests

- Keep changes focused — one feature or fix per PR
- Test your changes with a few auto-battles
- If adding a creature or skill, make sure it's balanced against existing ones
