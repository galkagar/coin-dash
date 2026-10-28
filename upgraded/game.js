/* global Phaser, COIN_DASH */
const PENALTIES = {
  slow: 'SLOWED',
  freeze: 'FROZEN',
  shrink: 'SHRUNK',
  runaway: 'COIN ESCAPING',
  darkness: 'DARKNESS',
  chase: 'DRONES CHASING',
  reverse: 'REVERSED'
};
// Draw order: the darkness overlay covers the arena but not the HUD or messages.
const DEPTH = { darkness: 10, hud: 20, panel: 30 };

class CoinDash extends Phaser.Scene {
  constructor() { super('CoinDash'); }

  create() {
    const c = COIN_DASH;
    this.score = 0;
    this.finished = false;
    this.deadline = this.time.now + c.roundSeconds * 1000;
    // Time at which each penalty wears off; 0 means inactive.
    this.penaltyEnds = Object.fromEntries(Object.keys(PENALTIES).map((p) => [p, 0]));
    this.invulnerableUntil = 0;
    this.physics.world.setBounds(0, 44, c.width, c.height - 44);
    this.add.grid(c.width / 2, c.height / 2, c.width, c.height, 40, 40,
      c.colors.background, 1, 0x24334b, 0.45);
    this.hud = this.add.text(18, 12, '', { font: '18px monospace', color: '#ffffff' })
      .setDepth(DEPTH.hud);
    this.timeText = this.add.text(c.width - 18, 12, '', { font: '18px monospace', color: '#ffffff' })
      .setOrigin(1, 0).setDepth(DEPTH.hud);
    this.status = this.add.text(c.width / 2, 12, '', { font: '18px monospace', color: '#ff657a' })
      .setOrigin(0.5, 0).setDepth(DEPTH.hud);
    this.darkness = this.add.graphics().setDepth(DEPTH.darkness);
    this.player = this.add.rectangle(c.width / 2, c.height / 2, 24, 24, c.colors.player);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.coin = this.add.circle(100, 100, 9, c.colors.coin);
    this.physics.add.existing(this.coin);
    this.coin.body.setCircle(9);
    this.coin.body.setCollideWorldBounds(true).setBounce(1, 1);
    this.placeCoin();
    this.drones = this.physics.add.group();
    for (let i = 0; i < c.droneCount; i++) {
      this.addDrone(90 + i * 270, 100, (35 + i * 105) * Math.PI / 180);
    }
    // Difficulty ramps up: an extra drone joins on a timer and for every few coins collected.
    this.time.addEvent({ delay: c.extraDroneEverySeconds * 1000, loop: true,
      callback: () => this.spawnExtraDrone() });
    this.physics.add.overlap(this.player, this.coin, () => {
      if (this.finished) return;
      this.score++;
      this.placeCoin();
      if (this.score % c.extraDroneEveryCoins === 0) this.spawnExtraDrone();
    });
    this.physics.add.overlap(this.player, this.drones, () => this.hitDrone());
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,R');
    this.input.keyboard.on('keydown-R', () => this.scene.restart());
  }

  addDrone(x, y, angle) {
    const c = COIN_DASH;
    const drone = this.add.rectangle(x, y, 26, 26, c.colors.drone);
    this.drones.add(drone);
    drone.body.setCollideWorldBounds(true).setBounce(1, 1);
    drone.body.setVelocity(Math.cos(angle) * c.droneSpeed, Math.sin(angle) * c.droneSpeed);
    return drone;
  }

  spawnExtraDrone() {
    const c = COIN_DASH;
    if (this.finished || this.drones.getLength() >= c.maxDrones) return;
    // Spawn away from the player so a new drone never lands on top of them.
    let x, y;
    do {
      x = Phaser.Math.Between(30, c.width - 30);
      y = Phaser.Math.Between(75, c.height - 30);
    } while (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < c.extraDroneSafeDistance);
    const drone = this.addDrone(x, y, Phaser.Math.FloatBetween(0, Math.PI * 2));
    // Pop in so the player notices the new threat.
    drone.setScale(0);
    this.tweens.add({ targets: drone, scale: 1, duration: 300, ease: 'Back.Out' });
    const label = this.add.text(x, y - 26, '+1 DRONE', { font: 'bold 14px monospace', color: '#ff657a' })
      .setOrigin(0.5);
    this.tweens.add({ targets: label, y: label.y - 20, alpha: 0, duration: 1000,
      onComplete: () => label.destroy() });
  }

  placeCoin() {
    const c = COIN_DASH;
    // Avoid spawning the next coin directly underneath the player.
    let x, y;
    do {
      x = Phaser.Math.Between(25, c.width - 25);
      y = Phaser.Math.Between(70, c.height - 25);
    } while (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < 60);
    this.coin.setPosition(x, y);
    this.coin.body.reset(x, y);
    if (this.isActive('runaway')) this.launchCoin();
  }

  launchCoin() {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const speed = COIN_DASH.runawayCoinSpeed;
    this.coin.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  isActive(penalty) {
    return this.time.now < this.penaltyEnds[penalty];
  }

  hitDrone() {
    if (this.finished || this.time.now < this.invulnerableUntil) return;
    const c = COIN_DASH;
    const penalty = Phaser.Utils.Array.GetRandom(Object.keys(PENALTIES));
    const seconds = penalty === 'freeze' ? c.freezeSeconds : c.penaltySeconds;
    this.penaltyEnds[penalty] = this.time.now + seconds * 1000;
    this.invulnerableUntil = this.time.now + c.hitCooldownSeconds * 1000;
    if (penalty === 'runaway') this.launchCoin();
    this.cameras.main.shake(150, 0.008);
    const label = this.add.text(this.player.x, this.player.y - 24, `${PENALTIES[penalty]}!`,
      { font: 'bold 18px monospace', color: '#ff657a' }).setOrigin(0.5).setDepth(DEPTH.hud);
    this.tweens.add({ targets: label, y: label.y - 30, alpha: 0, duration: 900,
      onComplete: () => label.destroy() });
  }

  update() {
    if (this.finished) return;
    const c = COIN_DASH;
    let dx = Number(this.cursors.right.isDown || this.keys.D.isDown)
      - Number(this.cursors.left.isDown || this.keys.A.isDown);
    let dy = Number(this.cursors.down.isDown || this.keys.S.isDown)
      - Number(this.cursors.up.isDown || this.keys.W.isDown);
    if (this.isActive('reverse')) { dx = -dx; dy = -dy; }
    let speed = c.playerSpeed;
    if (this.isActive('slow')) speed *= c.slowFactor;
    if (this.isActive('freeze')) speed = 0;
    const direction = new Phaser.Math.Vector2(dx, dy).normalize().scale(speed);
    this.player.body.setVelocity(direction.x, direction.y);
    this.player.setScale(this.isActive('shrink') ? c.shrinkScale : 1);
    this.player.setFillStyle(this.isActive('freeze') ? 0x9fc6ff : c.colors.player);
    // Blink during the grace period after a hit.
    this.player.setAlpha(this.time.now < this.invulnerableUntil
      ? (Math.floor(this.time.now / 100) % 2 ? 0.3 : 1) : 1);
    if (!this.isActive('runaway')) this.coin.body.setVelocity(0, 0);
    if (this.isActive('chase')) {
      this.drones.getChildren().forEach((d) => this.physics.moveToObject(d, this.player, c.droneSpeed));
    }
    this.drawDarkness();

    const active = Object.keys(PENALTIES).filter((p) => this.isActive(p))
      .map((p) => `${PENALTIES[p]} ${Math.ceil((this.penaltyEnds[p] - this.time.now) / 1000)}s`);
    this.status.setText(active.join('  '));
    const seconds = Math.max(0, Math.ceil((this.deadline - this.time.now) / 1000));
    this.hud.setText(`Coins: ${this.score}`);
    this.timeText.setText(`Time: ${seconds}s`);
    if (seconds === 0) this.finish('Time is up!');
  }

  drawDarkness() {
    const c = COIN_DASH;
    this.darkness.clear();
    if (!this.isActive('darkness')) return;
    // A very thick ring around the player: everything outside the inner radius goes dark.
    const thickness = c.width + c.height;
    this.darkness.lineStyle(thickness, 0x000000, 0.96);
    this.darkness.strokeCircle(this.player.x, this.player.y, c.darknessRadius + thickness / 2);
  }

  finish(reason) {
    if (this.finished) return;
    this.finished = true;
    this.physics.pause();
    this.darkness.clear();
    const c = COIN_DASH;
    this.add.rectangle(c.width / 2, c.height / 2, 460, 150, 0x0a1120, 0.95).setDepth(DEPTH.panel);
    this.add.text(c.width / 2, c.height / 2,
      `${reason}\n${this.score} coins collected\nPress R to try again`,
      { font: '24px monospace', color: '#ffffff', align: 'center', lineSpacing: 12 }
    ).setOrigin(0.5).setDepth(DEPTH.panel);
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
