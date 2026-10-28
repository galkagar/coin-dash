// Node logic test for features/powerups.js with a stubbed window/scene (no Phaser rendering).
// Run: node tests/powerups.test.js
const assert = require('assert');
const path = require('path');

global.window = {};
global.COIN_DASH = { width: 800, height: 500 };
const feature = require(path.join(__dirname, '..', 'features', 'powerups.js'));
assert.strictEqual(window.COIN_DASH_FEATURES[0], feature, 'registers itself');
const S = feature.settings;

// Chainable stub for any display object.
function stubObj(x = 0, y = 0) {
  const o = { x, y, alpha: 1, visible: true, text: '', destroyed: false };
  const chain = ['setStrokeStyle', 'setDepth', 'setOrigin', 'setAngle', 'setFillStyle'];
  chain.forEach(m => { o[m] = () => o; });
  o.setPosition = (nx, ny) => { o.x = nx; o.y = ny; return o; };
  o.setVisible = v => { o.visible = v; return o; };
  o.setText = t => { o.text = t; return o; };
  o.setAlpha = a => { o.alpha = a; return o; };
  o.destroy = () => { o.destroyed = true; };
  return o;
}
function makePlayer(name, x, y) {
  const p = stubObj(x, y);
  Object.assign(p, { name, out: false, speedScale: 1, stunnedUntil: 0, floorCell: null });
  p.body = { vx: 0, vy: 0, setVelocity(vx, vy) { this.vx = vx; this.vy = vy; return this; },
    reset(nx, ny) { p.x = nx; p.y = ny; } };
  return p;
}
function makeScene() {
  const scene = {
    time: { now: 0 }, finished: false, holes: new Map(),
    cellKey(x, y) { return `${Math.floor(x / 40)},${Math.floor(y / 40)}`; },
    isHole(x, y) { return this.holes.has(this.cellKey(x, y)); },
    add: { circle: (x, y) => stubObj(x, y), triangle: (x, y) => stubObj(x, y),
      rectangle: (x, y) => stubObj(x, y), text: (x, y) => stubObj(x, y) },
    tweens: { add() {}, killTweensOf() {} },
    players: [makePlayer('Player 1', 280, 250), makePlayer('Player 2', 520, 250)],
  };
  scene.coin = stubObj(100, 100);
  scene.coin.body = { reset(nx, ny) { scene.coin.x = nx; scene.coin.y = ny; } };
  feature.create(scene);
  return scene;
}
const step = (scene, ms) => { scene.time.now += ms; feature.update(scene, scene.time.now, ms); };
// Mimics game.js knockOut.
function knockOut(scene, p, source) {
  if (scene.finished || p.out) return;
  if (window.COIN_DASH_FEATURES.some(f => f.playerHit && f.playerHit(scene, p, source) === false)) return;
  p.out = true;
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok -', name); }

test('no power-up before first spawn time; then at most maxOnField, away from players/holes', () => {
  const scene = makeScene();
  step(scene, S.firstSpawnMs - 100);
  assert.strictEqual(scene.powerupState.items.length, 0);
  // Fill half the arena with holes to check avoidance.
  for (let c = 0; c < 10; c++) for (let r = 1; r < 13; r++) scene.holes.set(`${c},${r}`, { open: true });
  for (let i = 0; i < 20; i++) step(scene, S.spawnMaxMs);
  const items = scene.powerupState.items;
  assert.ok(items.length >= 1 && items.length <= S.maxOnField, `count ${items.length}`);
  for (let i = 0; i < 300; i++) {
    const sc = makeScene();
    for (let c = 0; c < 10; c++) for (let r = 1; r < 13; r++) sc.holes.set(`${c},${r}`, { open: true });
    const it = feature._internal.spawn(sc);
    if (!it) continue;
    assert.ok(!sc.isHole(it.x, it.y), 'not in a hole');
    for (const p of sc.players) assert.ok(Math.hypot(p.x - it.x, p.y - it.y) >= S.minPlayerDistance);
    assert.ok(it.y >= 44 && it.x > 0 && it.x < 800 && it.y < 500);
  }
});

test('touching a power-up gives it to that player and removes it', () => {
  const scene = makeScene();
  const it = feature._internal.spawn(scene, 'shield');
  const p2 = scene.players[1];
  p2.x = it.x + 5; p2.y = it.y;
  step(scene, 16);
  assert.strictEqual(scene.powerupState.items.length, 0);
  assert.ok(it.shape.destroyed && it.text.destroyed);
  assert.strictEqual(p2.powerups.shield, true);
  assert.strictEqual(scene.players[0].powerups.shield, false);
});

test('uncollected power-up expires', () => {
  const scene = makeScene();
  scene.powerupState.nextSpawn = Infinity;
  feature._internal.spawn(scene, 'speed');
  step(scene, S.lifetimeMs + 1);
  assert.strictEqual(scene.powerupState.items.length, 0);
});

test('shield cancels exactly one drone hit, shoves, then 1 s invulnerability, then hits land', () => {
  const scene = makeScene();
  scene.powerupState.nextSpawn = Infinity;
  const p = scene.players[0];
  feature._internal.apply(scene, p, 'shield');
  const drone = { x: p.x + 10, y: p.y };
  knockOut(scene, p, drone);
  assert.strictEqual(p.out, false, 'shield saved the player');
  assert.strictEqual(p.powerups.shield, false, 'shield consumed');
  assert.ok(p.body.vx < 0, 'shoved away from drone');
  step(scene, 500);
  knockOut(scene, p, drone);
  assert.strictEqual(p.out, false, 'still invulnerable');
  step(scene, S.shieldInvulnMs);
  assert.strictEqual(p.alpha, 1, 'flicker ends at full alpha');
  knockOut(scene, p, drone);
  assert.strictEqual(p.out, true, 'second hit after invulnerability knocks out');
});

test('no shield: hit goes through', () => {
  const scene = makeScene();
  knockOut(scene, scene.players[1], 'hole');
  assert.strictEqual(scene.players[1].out, true);
});

test('shield on a hole nudges player onto solid floor', () => {
  const scene = makeScene();
  const p = scene.players[0];
  p.x = 300; p.y = 260; // cell 7,6
  scene.holes.set('7,6', { open: true });
  feature._internal.apply(scene, p, 'shield');
  knockOut(scene, p, 'hole');
  assert.strictEqual(p.out, false);
  assert.ok(!scene.isHole(p.x, p.y), 'moved off the hole');
  assert.strictEqual(p.floorCell, scene.cellKey(p.x, p.y));
});

test('speed boost multiplies speedScale, refreshes without stacking, restores after 5 s', () => {
  const scene = makeScene();
  scene.powerupState.nextSpawn = Infinity;
  const p = scene.players[0];
  p.speedScale = 0.5; // another feature already slowed this player
  feature._internal.apply(scene, p, 'speed');
  assert.ok(Math.abs(p.speedScale - 0.5 * S.speedMultiplier) < 1e-9);
  step(scene, 3000);
  feature._internal.apply(scene, p, 'speed'); // refresh
  assert.ok(Math.abs(p.speedScale - 0.5 * S.speedMultiplier) < 1e-9, 'no stacking');
  step(scene, S.speedMs - 100);
  assert.ok(p.speedScale > 0.5, 'still boosted (timer refreshed)');
  assert.ok(/SPD 1s/.test(p.powerups.label.text), `label shows timer: ${p.powerups.label.text}`);
  step(scene, 200);
  assert.ok(Math.abs(p.speedScale - 0.5) < 1e-9, 'restored to pre-boost scale');
  assert.strictEqual(p.powerups.ringSpeed.visible, false);
});

test('magnet pulls coin toward holder for 7 s, then stops', () => {
  const scene = makeScene();
  scene.powerupState.nextSpawn = Infinity;
  const p = scene.players[0];
  scene.coin.x = p.x + 300; scene.coin.y = p.y;
  feature._internal.apply(scene, p, 'magnet');
  const d0 = Math.hypot(scene.coin.x - p.x, scene.coin.y - p.y);
  step(scene, 100);
  const d1 = Math.hypot(scene.coin.x - p.x, scene.coin.y - p.y);
  assert.ok(d1 < d0 - 20, `coin moved closer (${d0} -> ${d1})`);
  assert.strictEqual(p.powerups.ringMagnet.visible, true);
  step(scene, S.magnetMs);
  scene.coin.x = p.x + 300;
  const before = scene.coin.x;
  step(scene, 100);
  assert.strictEqual(scene.coin.x, before, 'magnet expired');
});

test('restart (create again) resets state; finished clears field and restores speed', () => {
  const scene = makeScene();
  const p = scene.players[0];
  feature._internal.apply(scene, p, 'speed');
  feature._internal.apply(scene, p, 'shield');
  feature._internal.spawn(scene, 'magnet');
  scene.finished = true;
  feature.finished(scene, {});
  assert.strictEqual(scene.powerupState.items.length, 0);
  assert.strictEqual(p.speedScale, 1);
  assert.strictEqual(p.powerups.shield, false);
  const n = scene.powerupState.items.length;
  step(scene, 60000); // update is a no-op once finished
  assert.strictEqual(scene.powerupState.items.length, n);
  scene.finished = false;
  scene.players = [makePlayer('Player 1', 280, 250), makePlayer('Player 2', 520, 250)];
  scene.time.now = 0;
  feature.create(scene);
  assert.strictEqual(scene.powerupState.items.length, 0);
  assert.strictEqual(scene.players[0].powerups.shield, false);
});

test('an out player loses active effects', () => {
  const scene = makeScene();
  scene.powerupState.nextSpawn = Infinity;
  const p = scene.players[1];
  feature._internal.apply(scene, p, 'speed');
  feature._internal.apply(scene, p, 'magnet');
  p.out = true;
  step(scene, 16);
  assert.strictEqual(p.speedScale, 1);
  assert.strictEqual(p.powerups.magnetUntil, 0);
  assert.strictEqual(p.powerups.label.visible, false);
});

console.log(`\n${passed} tests passed`);
