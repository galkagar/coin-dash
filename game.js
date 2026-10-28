/* global Phaser, COIN_DASH */
class CoinDash extends Phaser.Scene {
  constructor() { super('CoinDash'); }

  create() {
    const c = COIN_DASH;
    this.finished = false;
    this.deadline = this.time.now + c.roundSeconds * 1000;
    this.physics.world.setBounds(0, 44, c.width, c.height - 44);
    this.add.grid(c.width / 2, c.height / 2, c.width, c.height, 40, 40,
      c.colors.background, 1, 0x24334b, 0.45);
    this.hud = this.add.text(18, 12, '', { font: '18px monospace', color: '#ffffff' });
    // Player 1 uses WASD, Player 2 the arrow keys; they start either side of centre.
    const cursors = this.input.keyboard.createCursorKeys();
    const wasd = this.input.keyboard.addKeys({ up: 'W', left: 'A', down: 'S', right: 'D' });
    this.players = [
      this.makePlayer('Player 1', c.width / 2 - 120, c.colors.player, wasd),
      this.makePlayer('Player 2', c.width / 2 + 120, c.colors.player2, cursors)
    ];
    this.coin = this.add.circle(100, 100, 9, c.colors.coin);
    this.physics.add.existing(this.coin);
    this.coin.body.setCircle(9);
    this.placeCoin();
    this.drones = this.physics.add.group();
    for (let i = 0; i < c.droneCount; i++) {
      const drone = this.add.rectangle(90 + i * 270, 100, 26, 26, c.colors.drone);
      this.drones.add(drone);
      drone.body.setCollideWorldBounds(true).setBounce(1, 1);
      const angle = (35 + i * 105) * Math.PI / 180;
      drone.body.setVelocity(Math.cos(angle) * c.droneSpeed, Math.sin(angle) * c.droneSpeed);
    }
    for (const p of this.players) {
      this.physics.add.overlap(p, this.coin, () => {
        if (this.finished) return;
        p.score++;
        this.placeCoin();
      });
      this.physics.add.overlap(p, this.drones, () => this.knockOut(p));
    }
    const [p1, p2] = this.players;
    this.physics.add.collider(p1, p2, () => this.shove(p1, p2));
    this.input.keyboard.addKey('R');
    this.input.keyboard.on('keydown-R', () => this.scene.restart());
  }

  makePlayer(name, x, color, keys) {
    const p = this.add.rectangle(x, COIN_DASH.height / 2, 24, 24, color);
    this.physics.add.existing(p);
    p.body.setCollideWorldBounds(true);
    Object.assign(p, { name, keys, score: 0, out: false, stunnedUntil: 0, move: new Phaser.Math.Vector2() });
    return p;
  }

  knockOut(p) {
    // A caught player keeps their coins but leaves play; the round goes on for the others.
    if (this.finished || p.out) return;
    p.out = true;
    p.body.stop();
    p.body.enable = false;
    p.setAlpha(0.25);
    if (this.players.every(q => q.out)) this.finish(true);
  }

  shove(a, b) {
    // Whoever is steering harder into the other is the pusher; the other is knocked back.
    const dir = new Phaser.Math.Vector2(b.x - a.x, b.y - a.y).normalize();
    const aPush = a.move.dot(dir), bPush = -b.move.dot(dir);
    if (Math.max(aPush, bPush) <= 0 || aPush === bPush) return;
    const [victim, away] = aPush > bPush ? [b, dir] : [a, dir.negate()];
    if (victim.stunnedUntil > this.time.now) return;
    victim.stunnedUntil = this.time.now + COIN_DASH.pushMs;
    victim.body.setVelocity(away.x * COIN_DASH.pushSpeed, away.y * COIN_DASH.pushSpeed);
  }

  placeCoin() {
    const c = COIN_DASH;
    // Avoid spawning the next coin directly underneath either player.
    let x, y;
    do {
      x = Phaser.Math.Between(25, c.width - 25);
      y = Phaser.Math.Between(70, c.height - 25);
    } while (this.players.some(p => Phaser.Math.Distance.Between(x, y, p.x, p.y) < 60));
    this.coin.setPosition(x, y);
    this.coin.body.reset(x, y);
  }

  update() {
    if (this.finished) return;
    for (const p of this.players) {
      if (p.out) continue;
      const k = p.keys;
      p.move.set(Number(k.right.isDown) - Number(k.left.isDown),
        Number(k.down.isDown) - Number(k.up.isDown)).normalize();
      // A shoved player keeps their knockback velocity until the stun wears off.
      if (p.stunnedUntil > this.time.now) continue;
      p.body.setVelocity(p.move.x * COIN_DASH.playerSpeed, p.move.y * COIN_DASH.playerSpeed);
    }
    const seconds = Math.max(0, Math.ceil((this.deadline - this.time.now) / 1000));
    const [p1, p2] = this.players;
    const tag = p => `${p.score}${p.out ? ' (out)' : ''}`;
    this.hud.setText(`P1: ${tag(p1)}   P2: ${tag(p2)}               Time: ${seconds}s`);
    if (seconds === 0) this.finish(false);
  }

  finish(allCaught) {
    if (this.finished) return;
    this.finished = true;
    this.physics.pause();
    const c = COIN_DASH;
    const [p1, p2] = this.players;
    // The round ends when every player is caught or time runs out; the higher score wins.
    const reason = allCaught ? 'The drones caught everyone!' : 'Time is up!';
    let result = 'It\'s a tie!';
    if (p1.score !== p2.score) {
      result = `${(p1.score > p2.score ? p1 : p2).name} wins!`;
    }
    this.add.rectangle(c.width / 2, c.height / 2, 480, 210, 0x0a1120, 0.95);
    this.add.text(c.width / 2, c.height / 2,
      `${reason}\nP1: ${p1.score} coins   P2: ${p2.score} coins\n${result}\nPress R to play again`,
      { font: '24px monospace', color: '#ffffff', align: 'center', lineSpacing: 12 }
    ).setOrigin(0.5);
  }
}
window.coinDashGame = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: COIN_DASH.width,
  height: COIN_DASH.height,
  backgroundColor: COIN_DASH.colors.background,
  physics: { default: 'arcade', arcade: { debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
  scene: CoinDash
});
