# Coin Dash — Lab 3 starter

Two players race for coins and dodge drones in a 45-second round. Player 1 (teal) moves with WASD,
Player 2 (purple) with the arrow keys; run into your rival to shove them. Press R to restart. This is deliberately small so you can add features during the lab.

**Play it here:** https://www.avivz.net/coin-dash/

## Run it locally

Clone the repository and open `index.html` in a browser. Everything is in the repository;
there is no package to install, no build step, no backend, and nothing is fetched from the network.
If your agent prefers a local server, let it serve this folder, for example with
`python3 -m http.server 8000`, and open `http://localhost:8000`.

## Use it in the lab

This is a template repository. One partner creates the pair's own repository from it
(the **Use this template** button, or `gh repo create <name> --template avivz/coin-dash --public --clone`)
and adds the other partner as a collaborator. Both clone it and open `index.html`.

## Lab report

The repository includes a `lab-report` skill: use `/lab-report` in Claude Code or `$lab-report`
in Codex, for the pre-lab practice run and at the end of the lab. Give it your name, a unique
laptop label, and the session's start and end times with timezone. If it is not listed, ask
your agent to read `.claude/skills/lab-report/SKILL.md` and follow it.

The skill writes a JSON export and a report page under `reports/`, which Git ignores.
Open that page, load your JSON, and check the result. For the final pair report, load both
laptops' JSON files together and save the combined HTML. Use the same time window on both laptops.

## Files

- `.claude/skills/lab-report/`: reporting skill and offline HTML page.
- `.agents/skills/lab-report`: link to the same skill for Codex.
- `.gitignore`: keeps generated reports out of Git.
- `index.html`: page and script loading.
- `style.css`: page appearance.
- `settings.js`: round duration, speeds, colours and dimensions.
- `game.js`: scene, input, collisions, score and end-of-round behaviour.
- `vendor/phaser-3.90.0.min.js`: the pinned Phaser runtime, byte for byte the file published at
  `https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js`; `vendor/LICENSE.phaser.txt` is its MIT licence.

The game draws its own shapes; there are no image or audio assets. The authored files are under the
MIT licence in LICENSE.txt. Phaser documentation:
https://docs.phaser.io/phaser/getting-started/making-your-first-phaser-game
