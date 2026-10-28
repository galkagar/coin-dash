// Keep tuning separate from game behaviour so features can be developed independently.
window.COIN_DASH = {
  width: 800,
  height: 500,
  roundSeconds: 120,
  playerSpeed: 240,
  droneSpeed: 105,
  droneCount: 3,
  // Difficulty ramp: extra drones join over time and as the players collect coins (both players' total).
  extraDroneEverySeconds: 20,
  extraDroneEveryCoins: 5,
  maxDrones: 12,
  extraDroneSafeDistance: 150,
  pushSpeed: 420, // knockback speed when one player shoves the other
  pushMs: 200, // how long a shoved player's input is ignored
  // Drone curses: each drone hit applies one random curse for a few seconds.
  curseSeconds: 3,
  freezeSeconds: 1.5,
  hitCooldownSeconds: 1.5, // grace period after a hit, so one touch counts once
  slowFactor: 0.4,
  shrinkScale: 0.5,
  runawayCoinSpeed: 170,
  darknessRadius: 80,
  // Environment events (times in ms): one at a time, warned before it starts, players only.
  events: { first: 6000, gapMin: 8000, gapMax: 12000, warning: 1000, duration: 5000 },
  ice: { acceleration: 520, drag: 90, maxSpeed: 270 },
  collapse: { crackDelay: 400 },
  colors: { background: 0x101c31, player: 0x71e8ce, coin: 0xffd166, drone: 0xff657a,
    player2: 0xb07cff, ice: 0xcdeeff, crack: 0xffa64d, hole: 0x02040a }
};
