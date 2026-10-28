/* global Phaser, COIN_DASH */
// Drone curses: a drone hit applies one of these to the player for a few seconds. Darkness and the runaway
// coin change the shared arena, so they affect both players.
const CURSES = {
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
    this.finished = false;
    this.deadline = this.time.now + c.roundSeconds * 1000;
    this.physics.world.setBounds(0, 44, c.width, c.height - 44);
    this.add.grid(c.width / 2, c.height / 2, c.width, c.height, 40, 40,
      c.colors.background, 1, 0x24334b, 0.45).setDepth(-2);
    this.hud = this.add.text(18, 12, '', { font: '18px monospace', color: '#ffffff' })
      .setDepth(DEPTH.hud);
    this.darkness = this.add.renderTexture(0, 0, c.width, c.height).setOrigin(0)
      .setDepth(DEPTH.darkness).setVisible(false);
    this.darkBrush = this.make.graphics({ add: false }).fillStyle(0xffffff)
      .fillCircle(0, 0, c.darknessRadius);
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
    this.coin.body.setCollideWorldBounds(true).setBounce(1, 1);
    this.placeCoin();
    this.drones = this.physics.add.group();
    for (let i = 0; i < c.droneCount; i++) {
      this.addDrone(90 + i * 270, 100, (35 + i * 105) * Math.PI / 180);
    }
    // Difficulty ramps up: an extra drone joins on a timer and for every few coins collected.
    this.time.addEvent({ delay: c.extraDroneEverySeconds * 1000, loop: true,
      callback: () => this.spawnExtraDrone() });
    for (const p of this.players) {
      this.physics.add.overlap(p, this.coin, () => {
        if (this.finished) return;
        p.score++;
        this.placeCoin();
        if (this.totalScore() % c.extraDroneEveryCoins === 0) this.spawnExtraDrone();
      });
      this.physics.add.overlap(p, this.drones, () => this.hitDrone(p));
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
    // curseEnds holds the time each curse wears off; 0 means inactive.
    Object.assign(p, { name, color, keys, score: 0, out: false, stunnedUntil: 0, floorCell: null,
      move: new Phaser.Math.Vector2(), invulnerableUntil: 0,
      curseEnds: Object.fromEntries(Object.keys(CURSES).map((k) => [k, 0])) });
    p.statusText = this.add.text(x, p.y, '', { font: 'bold 11px monospace', color: '#ff9aa8' })
      .setOrigin(0.5, 0).setDepth(DEPTH.hud);
    return p;
  }

  active() { return this.players.filter(p => !p.out); }

  totalScore() { return this.players.reduce((sum, p) => sum + p.score, 0); }

  has(p, curse) { return this.time.now < p.curseEnds[curse]; }

  // Arena-wide curses are on while any player still has them.
  anyHas(curse) { return this.players.some(p => this.has(p, curse)); }

  knockOut(p) {
    // A player who falls through the floor keeps their coins but leaves play; the round goes on for the others.
    if (this.finished || p.out) return;
    p.out = true;
    p.body.stop();
    p.body.enable = false;
    p.setAlpha(0.25);
    p.statusText.setText('');
    for (const k of Object.keys(p.curseEnds)) p.curseEnds[k] = 0;
    if (this.players.every(q => q.out)) this.finish(true);
  }

  hitDrone(p) {
    // Drones no longer knock players out: each hit applies one random drone curse instead.
    if (this.finished || p.out || this.time.now < p.invulnerableUntil) return;
    const c = COIN_DASH;
    const curse = Phaser.Utils.Array.GetRandom(Object.keys(CURSES));
    const seconds = curse === 'freeze' ? c.freezeSeconds : c.curseSeconds;
    p.curseEnds[curse] = this.time.now + seconds * 1000;
    p.invulnerableUntil = this.time.now + c.hitCooldownSeconds * 1000;
    if (curse === 'runaway') this.launchCoin();
    this.cameras.main.shake(150, 0.008);
    const label = this.add.text(p.x, p.y - 24, `${CURSES[curse]}!`,
      { font: 'bold 18px monospace', color: '#ff657a' }).setOrigin(0.5).setDepth(DEPTH.hud);
    this.tweens.add({ targets: label, y: label.y - 30, alpha: 0, duration: 900,
      onComplete: () => label.destroy() });
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
    // Spawn away from every player so a new drone never lands on top of anyone.
    let x, y;
    do {
      x = Phaser.Math.Between(30, c.width - 30);
      y = Phaser.Math.Between(75, c.height - 30);
    } while (this.active().some(p =>
      Phaser.Math.Distance.Between(x, y, p.x, p.y) < c.extraDroneSafeDistance));
    const drone = this.addDrone(x, y, Phaser.Math.FloatBetween(0, Math.PI * 2));
    // Pop in so the players notice the new threat.
    drone.setScale(0);
    this.tweens.add({ targets: drone, scale: 1, duration: 300, ease: 'Back.Out' });
    const label = this.add.text(x, y - 26, '+1 DRONE', { font: 'bold 14px monospace', color: '#ff657a' })
      .setOrigin(0.5);
    this.tweens.add({ targets: label, y: label.y - 20, alpha: 0, duration: 1000,
      onComplete: () => label.destroy() });
  }

  // Environment events change the floor physics for the players only; drones are never affected.
  createEvents() {
    const c = COIN_DASH;
    this.event = null;
    this.holes = new Map(); // 'col,row' -> { rect, open }
    this.iceOverlay = this.add.rectangle(c.width / 2, (c.height + 44) / 2, c.width, c.height - 44,
      c.colors.ice, 0.22).setDepth(-1).setVisible(false);
    this.eventHud = this.add.text(c.width - 18, 12, '', { font: '18px monospace', color: '#cdeeff' })
      .setOrigin(1, 0).setDepth(DEPTH.hud);
    this.banner = this.add.text(c.width / 2, c.height / 2 - 80, '',
      { font: 'bold 34px monospace', color: '#ffffff', stroke: '#000000', strokeThickness: 5 })
      .setOrigin(0.5).setDepth(DEPTH.hud).setVisible(false);
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
    for (const p of this.players) p.floorCell = null;
    this.time.delayedCall(COIN_DASH.events.duration, () => this.endEvent());
  }

  endEvent() {
    if (this.finished) return;
    for (const p of this.players) {
      p.body.setAcceleration(0, 0).setDrag(0, 0).setMaxVelocity(10000, 10000); // Arcade defaults
    }
    this.iceOverlay.setVisible(false);
    for (const hole of this.holes.values()) { this.tweens.killTweensOf(hole.rect); hole.rect.destroy(); }
    this.holes.clear();
    this.event = null;
    const e = COIN_DASH.events;
    this.time.delayedCall(Phaser.Math.Between(e.gapMin, e.gapMax), () => this.announceEvent());
  }

  // Normal control sets velocity directly; on ice input only accelerates and momentum carries on.
  // Slow and freeze scale the player's speed in both modes.
  steer(player) {
    const c = COIN_DASH, direction = player.move;
    let factor = 1;
    if (this.has(player, 'slow')) factor = c.slowFactor;
    if (this.has(player, 'freeze')) factor = 0;
    if (this.event && this.event.type === 'ice') {
      player.body.setMaxVelocity(c.ice.maxSpeed * factor).setDrag(c.ice.drag)
        .setAcceleration(direction.x * c.ice.acceleration, direction.y * c.ice.acceleration);
    } else {
      const speed = c.playerSpeed * factor;
      player.body.setVelocity(direction.x * speed, direction.y * speed);
    }
  }

  cellKey(x, y) { return `${Math.floor(x / 40)},${Math.floor(y / 40)}`; }

  isHole(x, y) { return this.holes.has(this.cellKey(x, y)); } // cracking cells count too

  // While the floor collapses, every cell a player leaves cracks and then opens into a hole.
  trackFloor(player) {
    if (!this.event || this.event.type !== 'collapse') return;
    const key = this.cellKey(player.x, player.y);
    const hole = this.holes.get(key);
    if (hole && hole.open) return this.knockOut(player);
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
    if (this.anyHas('runaway')) this.launchCoin();
  }

  launchCoin() {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const speed = COIN_DASH.runawayCoinSpeed;
    this.coin.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  // Drones home in on the nearest player who has the chase curse.
  chaseDrones() {
    const targets = this.active().filter(p => this.has(p, 'chase'));
    if (targets.length === 0) return;
    for (const d of this.drones.getChildren()) {
      const target = targets.reduce((best, p) =>
        Phaser.Math.Distance.Between(d.x, d.y, p.x, p.y)
          < Phaser.Math.Distance.Between(d.x, d.y, best.x, best.y) ? p : best);
      this.physics.moveToObject(d, target, COIN_DASH.droneSpeed);
    }
  }

  // Everything goes dark except a small circle around each player still in play.
  drawDarkness() {
    const dark = this.anyHas('darkness');
    this.darkness.setVisible(dark);
    if (!dark) return;
    this.darkness.clear().fill(0x000000, 0.96);
    for (const p of this.active()) this.darkness.erase(this.darkBrush, p.x, p.y);
  }

  updatePlayerLook(p) {
    const c = COIN_DASH;
    p.setScale(this.has(p, 'shrink') ? c.shrinkScale : 1);
    p.setFillStyle(this.has(p, 'freeze') ? 0x9fc6ff : p.color);
    // Blink during the grace period after a hit.
    p.setAlpha(this.time.now < p.invulnerableUntil
      ? (Math.floor(this.time.now / 100) % 2 ? 0.3 : 1) : 1);
    const active = Object.keys(CURSES).filter(k => this.has(p, k))
      .map(k => `${CURSES[k]} ${Math.ceil((p.curseEnds[k] - this.time.now) / 1000)}s`);
    p.statusText.setText(active.join('\n')).setPosition(p.x, p.y + 16);
  }

  update() {
    if (this.finished) return;
    for (const p of this.active()) {
      const k = p.keys;
      const flip = this.has(p, 'reverse') ? -1 : 1;
      p.move.set(flip * (Number(k.right.isDown) - Number(k.left.isDown)),
        flip * (Number(k.down.isDown) - Number(k.up.isDown))).normalize();
      // A shoved player keeps their knockback velocity until the stun wears off.
      if (p.stunnedUntil <= this.time.now) this.steer(p);
      this.trackFloor(p);
      if (!p.out) this.updatePlayerLook(p);
    }
    if (this.finished) return;
    if (!this.anyHas('runaway')) this.coin.body.setVelocity(0, 0);
    this.chaseDrones();
    this.drawDarkness();
    const seconds = Math.max(0, Math.ceil((this.deadline - this.time.now) / 1000));
    const [p1, p2] = this.players;
    const tag = p => `${p.score}${p.out ? ' (out)' : ''}`;
    this.hud.setText(`P1: ${tag(p1)}   P2: ${tag(p2)}`);
    this.eventHud.setText((this.event ? `${this.event.type === 'ice' ? 'ICE' : 'COLLAPSE'} `
      + `${Math.max(0, Math.ceil((this.event.ends - this.time.now) / 1000))}s   ` : '')
      + `Time: ${seconds}s`);
    if (seconds === 0) this.finish(false);
  }

  finish(allOut) {
    if (this.finished) return;
    this.finished = true;
    this.physics.pause();
    this.darkness.setVisible(false);
    const c = COIN_DASH;
    const [p1, p2] = this.players;
    // The round ends when every player is out or time runs out; the higher score wins.
    const reason = allOut ? 'Everyone is out!' : 'Time is up!';
    let result = 'It\'s a tie!';
    if (p1.score !== p2.score) {
      result = `${(p1.score > p2.score ? p1 : p2).name} wins!`;
    }
    this.add.rectangle(c.width / 2, c.height / 2, 480, 210, 0x0a1120, 0.95).setDepth(DEPTH.panel);
    this.add.text(c.width / 2, c.height / 2,
      `${reason}\nP1: ${p1.score} coins   P2: ${p2.score} coins\n${result}\nPress R to play again`,
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
