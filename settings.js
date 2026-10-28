// Keep tuning separate from game behaviour so features can be developed independently.
window.COIN_DASH = {
  width: 800,
  height: 500,
  roundSeconds: 45,
  playerSpeed: 240,
  droneSpeed: 105,
  droneCount: 3,
  // Environment events (times in ms): one at a time, warned before it starts, player-only.
  events: { first: 6000, gapMin: 8000, gapMax: 12000, warning: 1000, duration: 5000 },
  ice: { acceleration: 520, drag: 90, maxSpeed: 270 },
  collapse: { crackDelay: 400 },
  colors: { background: 0x101c31, player: 0x71e8ce, coin: 0xffd166, drone: 0xff657a,
    ice: 0xcdeeff, crack: 0xffa64d, hole: 0x02040a }
};
