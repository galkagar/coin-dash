# Features

Each feature lives in its own file here and registers an object in `window.COIN_DASH_FEATURES`
(hooks are listed at the top of `game.js`). Feature files load before `game.js`, so register with
`(window.COIN_DASH_FEATURES = window.COIN_DASH_FEATURES || []).push({ name: 'x', ... })`.
Keep feature settings inside the feature file, so features stay independent and merge cleanly.

Coin Dash is a two-player game. Useful scene state:
- `scene.players`: each player `p` has `name`, `score`, `coins`, `out`, `speedScale` (speed multiplier), `body`.
- `scene.active()`: players still in play. `scene.coin`, `scene.drones` (physics group).
- `scene.secondsLeft`, `scene.finished`, `scene.hud`, `scene.eventHud`, `scene.event` (`{ type, ends }` or null).
- `scene.knockOut(player, source)`: use for anything that takes a player out, so a shield can cancel it.
- Environment events: push a new type to `scene.eventTypes` in `create`, set `scene.eventBanners[type]`
  and `scene.eventLabels[type]`, and run it in `eventStarted` / `eventEnded`. One event at a time.
