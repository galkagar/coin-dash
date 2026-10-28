// Keep tuning separate from game behaviour so features can be developed independently.
window.COIN_DASH = {
  width: 800,
  height: 500,
  roundSeconds: 120,
  playerSpeed: 240,
  droneSpeed: 105,
  droneCount: 3,
  // Difficulty ramp: extra drones join over time and as the player collects coins.
  extraDroneEverySeconds: 20,
  extraDroneEveryCoins: 5,
  maxDrones: 12,
  extraDroneSafeDistance: 150,
  // Penalties for touching a drone: each hit applies one random penalty for a few seconds.
  penaltySeconds: 3,
  freezeSeconds: 1.5,
  hitCooldownSeconds: 1.5, // grace period after a hit, so one touch counts once
  slowFactor: 0.4,
  shrinkScale: 0.5,
  runawayCoinSpeed: 170,
  darknessRadius: 80,
  colors: { background: 0x101c31, player: 0x71e8ce, coin: 0xffd166, drone: 0xff657a }
};
