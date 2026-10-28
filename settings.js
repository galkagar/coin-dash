// Keep tuning separate from game behaviour so features can be developed independently.
window.COIN_DASH = {
  width: 800,
  height: 500,
  roundSeconds: 45,
  playerSpeed: 240,
  droneSpeed: 105,
  droneCount: 3,
  pushSpeed: 420, // knockback speed when one player shoves the other
  pushMs: 200, // how long a shoved player's input is ignored
  colors: { background: 0x101c31, player: 0x71e8ce, coin: 0xffd166, drone: 0xff657a,
    player2: 0xb07cff }
};
