// Logic tests for features/drones.js. Run: node tests/drones.test.js
const assert = require('assert');
const path = require('path');
global.window = { COIN_DASH: { roundSeconds: 45 }, COIN_DASH_FEATURES: [] };
const feature = require(path.join(__dirname, '..', 'features', 'drones.js'));
const L = feature.logic, S = feature.settings;
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

test('registers in window.COIN_DASH_FEATURES', () => {
  assert.strictEqual(window.COIN_DASH_FEATURES[0], feature);
  assert.strictEqual(feature.name, 'drones');
});

test('chaser targets the nearest player that is not out', () => {
  const players = [{ x: 100, y: 100, out: false }, { x: 300, y: 100, out: false }];
  assert.strictEqual(L.nearestActive(players, 120, 100), players[0]);
  players[0].out = true;
  assert.strictEqual(L.nearestActive(players, 120, 100), players[1]);
  players[1].out = true;
  assert.strictEqual(L.nearestActive(players, 120, 100), null);
});

test('chaser velocity heads toward the target and is speed-capped', () => {
  let v = { x: 0, y: 0 };
  for (let i = 0; i < 200; i++) v = L.chaserVelocity(v.x, v.y, 0, 0, { x: 100, y: 0 }, 80, 2.2, 1 / 60);
  assert.ok(v.x > 79 && v.x <= 80 + 1e-9 && Math.abs(v.y) < 1e-6);
  const big = L.chaserVelocity(500, 500, 0, 0, { x: 0, y: 100 }, 80, 2.2, 1 / 60);
  assert.ok(Math.hypot(big.x, big.y) <= 80 + 1e-9);
});

test('difficulty: no extras in the first seconds, grows, then caps', () => {
  assert.strictEqual(L.difficulty(0).extra, 0);
  assert.strictEqual(L.difficulty(1.5).extra, 0);
  assert.strictEqual(L.difficulty(S.firstSpawnSec - 0.01).extra, 0);
  assert.strictEqual(L.difficulty(S.firstSpawnSec).extra, 1);
  let last = 0;
  for (let t = 0; t <= 45; t += 0.5) {
    const d = L.difficulty(t);
    assert.ok(d.extra >= last && d.extra <= S.maxExtra);
    assert.ok(d.speedScale >= 1 && d.speedScale <= S.maxSpeedScale);
    last = d.extra;
  }
  assert.strictEqual(L.difficulty(45).extra, S.maxExtra);
  assert.strictEqual(L.difficulty(1000).speedScale, S.maxSpeedScale);
  for (const k of ['chaser', 'patrol', 'zigzag']) {
    assert.ok(Math.min(S[k].maxSpeed, S[k].speed * S.maxSpeedScale) < 240 * 0.65, k + ' escapable');
  }
});

test('type order caps chasers', () => {
  const types = [];
  for (let i = 0; i < 30; i++) types.push(L.nextType(types));
  assert.ok(types.filter(t => t === 'chaser').length <= S.maxChasers);
  assert.ok(types.includes('patrol') && types.includes('zigzag') && types.includes('chaser'));
});

test('spawn points keep distance from every player and stay inside bounds', () => {
  const b = { x: 0, y: 44, width: 800, height: 456 };
  let seed = 7; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const players = [{ x: 280, y: 250, out: false }, { x: 520, y: 250, out: true }];
  for (let i = 0; i < 500; i++) {
    const s = L.pickSpawn(players, b, rng);
    assert.ok(s);
    for (const p of players) assert.ok(Math.hypot(s.x - p.x, s.y - p.y) >= S.minSpawnDistance);
    assert.ok(s.x >= S.margin && s.x <= 800 - S.margin && s.y >= 44 + S.margin && s.y <= 500 - S.margin);
  }
  assert.strictEqual(L.pickSpawn([{ x: 400, y: 270 }], b, rng, 5000), null);
});

test('patrol paths stay inside bounds', () => {
  const b = { x: 0, y: 44, width: 800, height: 456 };
  for (const kind of ['h', 'v', 'loop']) {
    for (const [x, y] of [[40, 80], [760, 470], [400, 270]]) {
      const pts = L.patrolPath(kind, x, y, b);
      assert.ok(pts.length >= 2);
      for (const p of pts) assert.ok(p.x >= S.margin && p.x <= 800 - S.margin
        && p.y >= 44 + S.margin && p.y <= 500 - S.margin);
    }
  }
});

// ---- Integration with a stubbed scene ----
function stubScene() {
  const obj = () => {
    const o = { active: true, x: 0, y: 0, rotation: 0,
      setStrokeStyle() { return o; }, setDepth() { return o; }, destroy() { o.active = false; },
      lineStyle() {}, strokePoints() {} };
    return o;
  };
  const shape = (x, y) => Object.assign(obj(), { x, y });
  const scene = {
    time: { now: 0 }, finished: false,
    physics: { world: { bounds: { x: 0, y: 44, width: 800, height: 456 } } },
    players: [{ x: 280, y: 250, out: false }, { x: 520, y: 250, out: false }],
    tweens: { add() {} },
    add: { circle: shape, rectangle: shape, triangle: shape, graphics: () => obj() },
    drones: { children: [], add(d) {
      d.body = { velocity: { x: 0, y: 0 },
        setVelocity(x, y) { this.velocity.x = x; this.velocity.y = y; },
        setCircle() {}, setCollideWorldBounds() {}, setBounce() {} };
      this.children.push(d);
    } }
  };
  scene.deadline = 45000;
  return scene;
}

function run(scene, seconds) {
  const dt = 1000 / 60;
  for (let t = 0; t < seconds * 1000; t += dt) {
    scene.time.now += dt;
    feature.update(scene, scene.time.now, dt);
    // integrate positions roughly like arcade physics would
    for (const d of scene.drones.children) { d.x += d.body.velocity.x * dt / 1000; d.y += d.body.velocity.y * dt / 1000; }
  }
}

test('no extra drones in the first seconds; then they spawn away from players', () => {
  const scene = stubScene();
  feature.create(scene);
  run(scene, 2);
  assert.strictEqual(scene.drones.children.length, 0);
  run(scene, 43);
  const n = scene.drones.children.length;
  assert.ok(n > 0 && n <= S.maxExtra, 'spawned ' + n);
  assert.ok(scene.drones.children.every(d => d.droneType && d.body));
});

test('create resets state; finished stops updates', () => {
  const scene = stubScene();
  feature.create(scene);
  run(scene, 20);
  const n = scene.drones.children.length;
  scene.finished = true;
  const vel = scene.drones.children.map(d => ({ ...d.body.velocity }));
  run(scene, 10);
  assert.strictEqual(scene.drones.children.length, n);
  scene.drones.children.forEach((d, i) => assert.deepStrictEqual(d.body.velocity, vel[i]));
  feature.create(scene);
  assert.strictEqual(scene.droneFeature.extra.length, 0);
});

test('chaser in scene steers toward the nearest active player', () => {
  const scene = stubScene();
  feature.create(scene);
  scene.droneFeature.spawnedTypes = ['patrol', 'zigzag']; // next spawn is a chaser
  scene.droneFeature.pending = { x: 700, y: 250, at: 0, ring: { destroy() {} } };
  feature.update(scene, 0, 16);
  const c = scene.droneFeature.extra[0];
  assert.strictEqual(c.droneType, 'chaser');
  run(scene, 0.5);
  assert.ok(c.body.velocity.x < 0, 'moves toward Player 2 (left)');
  scene.players[1].out = true;
  scene.players[0].x = 280; scene.players[0].y = 450;
  run(scene, 1);
  assert.ok(c.body.velocity.y > 0, 'retargets Player 1 below');
});

console.log(`\n${passed} tests passed`);
