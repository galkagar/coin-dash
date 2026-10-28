/* global Phaser, COIN_DASH */
// Features register here (see features/README.md). Each is an object with optional hooks:
//   create(scene)                          after the base round is set up
//   update(scene, time, delta)             every frame while the round is running
//   coinPoints(scene, player, points)      return the points this coin is worth to player
//   coinCollected(scene, player, points)   after player scored a coin
//   playerHit(scene, player, source)       return false to cancel a knock-out (source: drone or 'hole')
//   eventStarted(scene, type) / eventEnded(scene, type)   environment events, including your own
//   finished(scene, result)                once; result is { reason, allOut, winner } (winner null on a tie)
window.COIN_DASH_FEATURES = window.COIN_DASH_FEATURES || [];
const features = () => window.COIN_DASH_FEATURES;

class CoinDash extends Phaser.Scene {
  constructor() { super('CoinDash'); }

  create() {
    const c = COIN_DASH;
    this.finished = false;
    this.deadline = this.time.now + c.roundSeconds * 1000;
    this.physics.world.setBounds(0, 44, c.width, c.height - 44);
    this.add.grid(c.width / 2, c.height / 2, c.width, c.height, 40, 40,
      c.colors.background, 1, 0x24334b, 0.45).setDepth(-2);
    this.hud = this.add.text(18, 12, '', { font: '18px monospace', color: '#ffffff' });
    this.createEvents();
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
      this.physics.add.overlap(p, this.coin, () => this.collectCoin(p));
      this.physics.add.overlap(p, this.drones, (player, drone) => this.knockOut(p, drone));
    }
    const [p1, p2] = this.players;
    this.physics.add.collider(p1, p2, () => this.shove(p1, p2));
    this.input.keyboard.addKey('R');
    this.input.keyboard.on('keydown-R', () => this.scene.restart());
    features().forEach(f => f.create && f.create(this));
  }

  makePlayer(name, x, color, keys) {
    const p = this.add.rectangle(x, COIN_DASH.height / 2, 24, 24, color);
    this.physics.add.existing(p);
    p.body.setCollideWorldBounds(true);
    Object.assign(p, { name, keys, score: 0, coins: 0, out: false, stunnedUntil: 0, floorCell: null,
      speedScale: 1, move: new Phaser.Math.Vector2() });
    return p;
  }

  active() { return this.players.filter(p => !p.out); }

  collectCoin(p) {
    if (this.finished || p.out) return;
    const points = features().reduce((n, f) => (f.coinPoints ? f.coinPoints(this, p, n) : n), 1);
    p.score += points;
    p.coins++;
    this.placeCoin();
    features().forEach(f => f.coinCollected && f.coinCollected(this, p, points));
  }

  knockOut(p, source) {
    // A caught or fallen player keeps their coins but leaves play; the round goes on for the others.
    if (this.finished || p.out) return;
    if (features().some(f => f.playerHit && f.playerHit(this, p, source) === false)) return;
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

  // Environment events change the floor physics for the players only; drones are never affected.
  createEvents() {
    const c = COIN_DASH;
    this.event = null;
    // Features may add their own event types: push to eventTypes, name the banner and HUD label,
    // and react in eventStarted/eventEnded. Only one event runs at a time.
    this.eventTypes = ['ice', 'collapse'];
    this.eventBanners = { ice: 'ICE!', collapse: 'FLOOR COLLAPSING!' };
    this.eventLabels = { ice: 'ICE', collapse: 'COLLAPSE' };
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
    const type = Phaser.Utils.Array.GetRandom(this.eventTypes);
    this.banner.setText(this.eventBanners[type] || type.toUpperCase()).setVisible(true);
    this.time.delayedCall(COIN_DASH.events.warning, () => {
      this.banner.setVisible(false);
      this.startEvent(type);
    });
  }

  startEvent(type) {
    if (this.finished) return;
    this.event = { type, ends: this.time.now + COIN_DASH.events.duration };
    this.iceOverlay.setVisible(type === 'ice');
    for (const p of this.players) p.floorCell = null;
    this.time.delayedCall(COIN_DASH.events.duration, () => this.endEvent());
    features().forEach(f => f.eventStarted && f.eventStarted(this, type));
  }

  endEvent() {
    if (this.finished) return;
    for (const p of this.players) {
      p.body.setAcceleration(0, 0).setDrag(0, 0).setMaxVelocity(10000, 10000); // Arcade defaults
    }
    this.iceOverlay.setVisible(false);
    for (const hole of this.holes.values()) { this.tweens.killTweensOf(hole.rect); hole.rect.destroy(); }
    this.holes.clear();
    const type = this.event.type;
    this.event = null;
    features().forEach(f => f.eventEnded && f.eventEnded(this, type));
    const e = COIN_DASH.events;
    this.time.delayedCall(Phaser.Math.Between(e.gapMin, e.gapMax), () => this.announceEvent());
  }

  // Normal control sets velocity directly; on ice input only accelerates and momentum carries on.
  steer(player) {
    const c = COIN_DASH, direction = player.move, k = player.speedScale;
    if (this.event && this.event.type === 'ice') {
      player.body.setMaxVelocity(c.ice.maxSpeed * k).setDrag(c.ice.drag)
        .setAcceleration(direction.x * c.ice.acceleration * k, direction.y * c.ice.acceleration * k);
    } else {
      player.body.setVelocity(direction.x * c.playerSpeed * k, direction.y * c.playerSpeed * k);
    }
  }

  cellKey(x, y) { return `${Math.floor(x / 40)},${Math.floor(y / 40)}`; }

  isHole(x, y) { return this.holes.has(this.cellKey(x, y)); } // cracking cells count too

  // While the floor collapses, every cell a player leaves cracks and then opens into a hole.
  trackFloor(player) {
    if (!this.event || this.event.type !== 'collapse') return;
    const key = this.cellKey(player.x, player.y);
    const hole = this.holes.get(key);
    if (hole && hole.open) return this.knockOut(player, 'hole');
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
      // Never open a hole right under a player: wait until everyone has stepped off.
      if (this.active().some(p => this.cellKey(p.x, p.y) === key)) {
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
    // Avoid spawning the next coin directly underneath either player, or in a hole.
    let x, y;
    do {
      x = Phaser.Math.Between(25, c.width - 25);
      y = Phaser.Math.Between(70, c.height - 25);
    } while (this.players.some(p => Phaser.Math.Distance.Between(x, y, p.x, p.y) < 60)
      || this.isHole(x, y));
    this.coin.setPosition(x, y);
    this.coin.body.reset(x, y);
  }

  update(time, delta) {
    if (this.finished) return;
    for (const p of this.active()) {
      const k = p.keys;
      p.move.set(Number(k.right.isDown) - Number(k.left.isDown),
        Number(k.down.isDown) - Number(k.up.isDown)).normalize();
      // A shoved player keeps their knockback velocity until the stun wears off.
      if (p.stunnedUntil <= this.time.now) this.steer(p);
      this.trackFloor(p);
    }
    if (this.finished) return;
    const seconds = Math.max(0, Math.ceil((this.deadline - this.time.now) / 1000));
    this.secondsLeft = seconds;
    const [p1, p2] = this.players;
    const tag = p => `${p.score}${p.out ? ' (out)' : ''}`;
    this.hud.setText(`P1: ${tag(p1)}   P2: ${tag(p2)}`);
    this.eventHud.setText((this.event ? `${this.eventLabels[this.event.type] || this.event.type.toUpperCase()} `
      + `${Math.max(0, Math.ceil((this.event.ends - this.time.now) / 1000))}s   ` : '')
      + `Time: ${seconds}s`);
    features().forEach(f => f.update && f.update(this, time, delta));
    if (this.finished) return;
    if (seconds === 0) this.finish(false);
  }

  finish(allOut) {
    if (this.finished) return;
    this.finished = true;
    this.physics.pause();
    const c = COIN_DASH;
    const [p1, p2] = this.players;
    // The round ends when every player is out or time runs out; the higher score wins.
    const reason = allOut ? 'Everyone is out!' : 'Time is up!';
    let result = 'It\'s a tie!';
    const winner = p1.score === p2.score ? null : (p1.score > p2.score ? p1 : p2);
    if (winner) result = `${winner.name} wins!`;
    this.add.rectangle(c.width / 2, c.height / 2, 480, 210, 0x0a1120, 0.95);
    this.add.text(c.width / 2, c.height / 2,
      `${reason}\nP1: ${p1.score} coins   P2: ${p2.score} coins\n${result}\nPress R to play again`,
      { font: '24px monospace', color: '#ffffff', align: 'center', lineSpacing: 12 }
    ).setOrigin(0.5);
    features().forEach(f => f.finished && f.finished(this, { reason, allOut, winner }));
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
