/* global Phaser, COIN_DASH */
class CoinDash extends Phaser.Scene {
  constructor() { super('CoinDash'); }

  create() {
    const c = COIN_DASH;
    this.score = 0;
    this.finished = false;
    this.deadline = this.time.now + c.roundSeconds * 1000;
    this.physics.world.setBounds(0, 44, c.width, c.height - 44);
    this.add.grid(c.width / 2, c.height / 2, c.width, c.height, 40, 40,
      c.colors.background, 1, 0x24334b, 0.45).setDepth(-2);
    this.hud = this.add.text(18, 12, '', { font: '18px monospace', color: '#ffffff' });
    this.createEvents();
    this.player = this.add.rectangle(c.width / 2, c.height / 2, 24, 24, c.colors.player);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
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
    this.physics.add.overlap(this.player, this.coin, () => {
      if (this.finished) return;
      this.score++;
      this.placeCoin();
    });
    this.physics.add.overlap(this.player, this.drones, () => this.finish('A drone caught you!'));
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,R');
    this.input.keyboard.on('keydown-R', () => this.scene.restart());
  }

  // Environment events change the floor physics for the player only; drones are never affected.
  createEvents() {
    const c = COIN_DASH;
    this.event = null;
    this.holes = new Map(); // 'col,row' -> { rect, open }
    this.iceOverlay = this.add.rectangle(c.width / 2, (c.height + 44) / 2, c.width, c.height - 44,
      c.colors.ice, 0.22).setDepth(-1).setVisible(false);
    this.eventHud = this.add.text(c.width - 18, 12, '', { font: '18px monospace', color: '#cdeeff' })
      .setOrigin(1, 0);
    this.banner = this.add.text(c.width / 2, c.height / 2 - 80, '',
      { font: 'bold 34px monospace', color: '#ffffff', stroke: '#000000', strokeThickness: 5 })
      .setOrigin(0.5).setDepth(2).setVisible(false);
    this.time.delayedCall(c.events.first, () => this.announceEvent());
  }

  announceEvent() {
    if (this.finished) return;
    const type = Phaser.Utils.Array.GetRandom(['ice', 'collapse']);
    this.banner.setText(type === 'ice' ? 'ICE!' : 'FLOOR COLLAPSING!').setVisible(true);
    this.time.delayedCall(COIN_DASH.events.warning, () => {
      this.banner.setVisible(false);
      this.startEvent(type);
    });
  }

  startEvent(type) {
    if (this.finished) return;
    this.event = { type, ends: this.time.now + COIN_DASH.events.duration };
    this.iceOverlay.setVisible(type === 'ice');
    this.player.floorCell = null;
    this.time.delayedCall(COIN_DASH.events.duration, () => this.endEvent());
  }

  endEvent() {
    if (this.finished) return;
    const body = this.player.body;
    body.setAcceleration(0, 0).setDrag(0, 0).setMaxVelocity(10000, 10000); // Arcade defaults
    this.iceOverlay.setVisible(false);
    for (const hole of this.holes.values()) { this.tweens.killTweensOf(hole.rect); hole.rect.destroy(); }
    this.holes.clear();
    this.event = null;
    const e = COIN_DASH.events;
    this.time.delayedCall(Phaser.Math.Between(e.gapMin, e.gapMax), () => this.announceEvent());
  }

  // Normal control sets velocity directly; on ice input only accelerates and momentum carries on.
  steer(player, dx, dy) {
    const c = COIN_DASH;
    const direction = new Phaser.Math.Vector2(dx, dy).normalize();
    if (this.event && this.event.type === 'ice') {
      player.body.setMaxVelocity(c.ice.maxSpeed).setDrag(c.ice.drag)
        .setAcceleration(direction.x * c.ice.acceleration, direction.y * c.ice.acceleration);
    } else {
      player.body.setVelocity(direction.x * c.playerSpeed, direction.y * c.playerSpeed);
    }
  }

  cellKey(x, y) { return `${Math.floor(x / 40)},${Math.floor(y / 40)}`; }

  isHole(x, y) { return this.holes.has(this.cellKey(x, y)); } // cracking cells count too

  // While the floor collapses, every cell the player leaves cracks and then opens into a hole.
  trackFloor(player) {
    if (!this.event || this.event.type !== 'collapse') return;
    const key = this.cellKey(player.x, player.y);
    const hole = this.holes.get(key);
    if (hole && hole.open) return this.finish('You fell through the floor!');
    if (player.floorCell && player.floorCell !== key) this.crackCell(player.floorCell);
    player.floorCell = key;
  }

  crackCell(key) {
    if (this.holes.has(key)) return;
    const c = COIN_DASH;
    const [col, row] = key.split(',').map(Number);
    const rect = this.add.rectangle(col * 40 + 20, row * 40 + 20, 40, 40, c.colors.crack, 0.8)
      .setDepth(-1);
    const hole = { rect, open: false };
    this.holes.set(key, hole);
    this.tweens.add({ targets: rect, alpha: 0.25, duration: c.collapse.crackDelay / 4, yoyo: true, repeat: 1 });
    const open = () => {
      if (this.finished || this.holes.get(key) !== hole) return;
      // Never open a hole right under the player: wait until they have stepped off.
      if (this.cellKey(this.player.x, this.player.y) === key) {
        return this.time.delayedCall(c.collapse.crackDelay, open);
      }
      this.tweens.killTweensOf(rect);
      rect.setFillStyle(c.colors.hole, 1).setAlpha(1);
      hole.open = true;
      if (this.cellKey(this.coin.x, this.coin.y) === key) this.placeCoin();
    };
    this.time.delayedCall(c.collapse.crackDelay, open);
  }

  placeCoin() {
    const c = COIN_DASH;
    // Avoid spawning the next coin directly underneath the player.
    let x, y;
    do {
      x = Phaser.Math.Between(25, c.width - 25);
      y = Phaser.Math.Between(70, c.height - 25);
    } while (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < 60
      || this.isHole(x, y));
    this.coin.setPosition(x, y);
    this.coin.body.reset(x, y);
  }

  update() {
    if (this.finished) return;
    const dx = Number(this.cursors.right.isDown || this.keys.D.isDown)
      - Number(this.cursors.left.isDown || this.keys.A.isDown);
    const dy = Number(this.cursors.down.isDown || this.keys.S.isDown)
      - Number(this.cursors.up.isDown || this.keys.W.isDown);
    this.steer(this.player, dx, dy);
    this.trackFloor(this.player);
    if (this.finished) return;
    const seconds = Math.max(0, Math.ceil((this.deadline - this.time.now) / 1000));
    this.hud.setText(`Coins: ${this.score}                       Time: ${seconds}s`);
    this.eventHud.setText(this.event ? `${this.event.type === 'ice' ? 'ICE' : 'COLLAPSE'} `
      + `${Math.max(0, Math.ceil((this.event.ends - this.time.now) / 1000))}s` : '');
    if (seconds === 0) this.finish('Time is up!');
  }

  finish(reason) {
    if (this.finished) return;
    this.finished = true;
    this.physics.pause();
    const c = COIN_DASH;
    this.add.rectangle(c.width / 2, c.height / 2, 460, 150, 0x0a1120, 0.95);
    this.add.text(c.width / 2, c.height / 2,
      `${reason}\n${this.score} coins collected\nPress R to try again`,
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
