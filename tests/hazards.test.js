// Node logic test for features/hazards.js (no browser, no Phaser). Run: node tests/hazards.test.js
const assert = require('assert');
const path = require('path');

global.window = { COIN_DASH_FEATURES: [] };
global.COIN_DASH = { width: 800, height: 500, roundSeconds: 45, events: { duration: 5000 } };
const feature = require(path.join(__dirname, '..', 'features', 'hazards.js'));
const L = feature.logic, S = feature.settings;
assert.strictEqual(window.COIN_DASH_FEATURES[0], feature, 'registers in COIN_DASH_FEATURES');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const seeded = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const arena = L.arenaOf(COIN_DASH);
const randomPlayers = rng => [0, 1].map(() => ({ x: 20 + rng() * 760, y: 64 + rng() * 416 }));

// Flood fill on an 8px grid: area reachable from the player without ever touching a lethal region.
function reachableSafe(lethal, start) {
  const step = 8, cols = Math.floor(arena.w / step), rows = Math.floor(arena.h / step);
  const idx = (c, r) => r * cols + c, seen = new Uint8Array(cols * rows);
  const safe = (c, r) => !lethal(arena.x + c * step + step / 2, arena.y + r * step + step / 2);
  const sc = Math.min(cols - 1, Math.floor((start.x - arena.x) / step));
  const sr = Math.min(rows - 1, Math.floor((start.y - arena.y) / step));
  if (!safe(sc, sr)) return 0;
  const stack = [[sc, sr]]; seen[idx(sc, sr)] = 1; let n = 0;
  while (stack.length) {
    const [c, r] = stack.pop(); n++;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = c + dc, b = r + dr;
      if (a < 0 || b < 0 || a >= cols || b >= rows || seen[idx(a, b)] || !safe(a, b)) continue;
      seen[idx(a, b)] = 1; stack.push([a, b]);
    }
  }
  return n * step * step;
}

test('intensity schedule rises with the round and is capped', () => {
  assert.strictEqual(L.levelFor(0), 0);
  assert.strictEqual(L.levelFor(1), S.maxLevel);
  assert.strictEqual(L.levelFor(5), S.maxLevel);
  assert.strictEqual(L.levelFor(-1), 0);
  let prev = null;
  for (let p = 0; p <= 1.0001; p += 0.05) {
    const it = L.intensity(L.levelFor(p));
    assert.ok(it.laserCount <= S.lasers.maxCount && it.zoneCount <= S.zones.maxCount);
    assert.ok(it.weight <= S.maxWeight && it.warnMs >= S.minWarnMs);
    if (prev) {
      assert.ok(it.laserCount >= prev.laserCount && it.zoneCount >= prev.zoneCount && it.weight >= prev.weight);
      assert.ok(it.sweepAmp >= prev.sweepAmp && it.warnMs <= prev.warnMs);
    }
    prev = it;
  }
  assert.ok(L.intensity(S.maxLevel).laserCount > L.intensity(0).laserCount, 'gets harder');
  assert.deepStrictEqual(L.intensity(99), L.intensity(S.maxLevel), 'level clamps');
});

test('hazard types get picked more often later, capped', () => {
  const scene = { eventTypes: ['ice', 'collapse', 'lasers', 'zones'] };
  L.applyWeights(scene, 0);
  assert.strictEqual(scene.eventTypes.length, 4);
  for (let i = 0; i < 5; i++) L.applyWeights(scene, S.maxLevel);
  const count = t => scene.eventTypes.filter(x => x === t).length;
  assert.strictEqual(count('lasers'), S.maxWeight);
  assert.strictEqual(count('zones'), S.maxWeight);
  assert.strictEqual(count('ice'), 1);
});

test('laser layouts leave reachable safe space, gaps, and avoid players', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const rng = seeded(seed), players = randomPlayers(rng), level = seed % (S.maxLevel + 1);
    const beams = L.layoutLasers(rng, arena, players, level);
    assert.ok(beams.length <= L.intensity(level).laserCount);
    assert.ok(L.laserCover(beams, arena) <= S.lasers.maxCover + 1e-9, 'cover cap');
    for (const a of beams) for (const b of beams) {
      if (a !== b && a.axis === b.axis) {
        assert.ok(Math.abs(a.pos - b.pos) - L.bandHalf(a) - L.bandHalf(b) >= S.lasers.minGap, 'gap between beams');
      }
    }
    // Anywhere a beam can ever be (whole sweep band) counts as lethal.
    const lethal = (x, y) => beams.some(b => Math.abs((b.axis === 'h' ? y : x) - b.pos) < L.bandHalf(b) + S.playerHalf);
    for (const p of players) {
      assert.ok(!lethal(p.x, p.y), `player not under a beam band (seed ${seed})`);
      assert.ok(reachableSafe(lethal, p) >= 48 * 48, `player has room to stand (seed ${seed})`);
    }
  }
  const counts = [1, 2, 3, 4].map(s => L.layoutLasers(seeded(s), arena, [{ x: 280, y: 250 }, { x: 520, y: 250 }], S.maxLevel).length);
  assert.ok(Math.max(...counts) >= 3, 'late round actually places several beams: ' + counts);
});

test('zone layouts leave reachable safe space, gaps, and avoid players', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const rng = seeded(seed), players = randomPlayers(rng), level = seed % (S.maxLevel + 1);
    const zones = L.layoutZones(rng, arena, players, level);
    assert.ok(zones.length <= L.intensity(level).zoneCount);
    assert.ok(L.zoneCover(zones, arena) <= S.zones.maxCover + 1e-9, 'cover cap');
    for (const z of zones) {
      assert.ok(z.x >= arena.x && z.y >= arena.y && z.x + z.w <= arena.x + arena.w && z.y + z.h <= arena.y + arena.h, 'inside arena');
      for (const o of zones) {
        if (o === z) continue;
        const g = S.zones.gapCells * S.zones.cell;
        const apart = z.x >= o.x + o.w + g || o.x >= z.x + z.w + g || z.y >= o.y + o.h + g || o.y >= z.y + z.h + g;
        assert.ok(apart, 'gap between zones');
      }
    }
    const lethal = (x, y) => zones.some(z => L.zoneHits(z, x, y));
    for (const p of players) {
      const r = S.playerHalf;
      assert.ok(!zones.some(z => p.x + r > z.x && p.x - r < z.x + z.w && p.y + r > z.y && p.y - r < z.y + z.h), 'not under player');
      assert.ok(reachableSafe(lethal, p) >= arena.w * arena.h * 0.5, `most of the floor reachable (seed ${seed})`);
    }
  }
});

test('hit geometry', () => {
  const beam = { axis: 'h', pos: 200, amp: 0, thickness: 12, phase: 0 };
  const reach = 6 + S.playerHalf - S.lasers.hitLeniency;
  assert.ok(L.beamHits(beam, 200, 400, 200));
  assert.ok(L.beamHits(beam, 200, 0, 200 + reach - 1));
  assert.ok(!L.beamHits(beam, 200, 400, 200 + reach + 1));
  const v = { axis: 'v', pos: 300, amp: 0, thickness: 12, phase: 0 };
  assert.ok(L.beamHits(v, 300, 305, 480) && !L.beamHits(v, 300, 330, 480));
  const sweep = { axis: 'h', pos: 200, amp: 40, thickness: 12, phase: 1 };
  for (let t = 0; t < 6000; t += 37) {
    const y = L.beamPos(sweep, t);
    assert.ok(y >= 160 - 1e-9 && y <= 240 + 1e-9, 'sweep stays inside its band');
  }
  const zone = { x: 80, y: 120, w: 80, h: 80 };
  assert.ok(L.zoneHits(zone, 120, 160));
  assert.ok(!L.zoneHits(zone, 81, 160), 'edge leniency');
  assert.ok(!L.zoneHits(zone, 60, 160) && !L.zoneHits(zone, 120, 205));
});

// Stub scene to run the hooks end-to-end.
function makeScene() {
  const objects = [];
  const obj = () => {
    const o = { visible: true, alpha: 1, destroyed: false, x: 0, y: 0 };
    for (const m of ['setStrokeStyle', 'setFillStyle', 'setDepth']) o[m] = () => o;
    o.setVisible = v => { o.visible = v; return o; };
    o.setAlpha = a => { o.alpha = a; return o; };
    o.setX = x => { o.x = x; return o; };
    o.setY = y => { o.y = y; return o; };
    o.destroy = () => { o.destroyed = true; };
    objects.push(o); return o;
  };
  const scene = {
    objects, finished: false, knocked: [], shield: false,
    time: { now: 0 }, deadline: 45000,
    eventTypes: ['ice', 'collapse'], eventBanners: {}, eventLabels: {},
    add: { rectangle: (x, y) => Object.assign(obj(), { x, y }) },
    tweens: { add() {}, killTweensOf() {} },
    players: [{ name: 'Player 1', x: 280, y: 250, out: false }, { name: 'Player 2', x: 520, y: 250, out: false }],
    active() { return this.players.filter(p => !p.out); },
    knockOut(p, src) { this.knocked.push([p.name, src]); if (!this.shield) p.out = true; }
  };
  feature.create(scene);
  return scene;
}

test('create registers event types, banners and labels', () => {
  const s = makeScene();
  assert.ok(s.eventTypes.includes('lasers') && s.eventTypes.includes('zones'));
  assert.ok(s.eventBanners.lasers && s.eventBanners.zones && s.eventLabels.lasers && s.eventLabels.zones);
  feature.create(s); // restart: create runs again on a fresh scene state
  assert.strictEqual(s.eventTypes.filter(t => t === 'lasers').length, 1);
});

for (const type of ['lasers', 'zones']) {
  test(`${type}: warning precedes activation, then lethal, cleaned up on end`, () => {
    const s = makeScene();
    s.time.now = 40000; // late round: max intensity
    feature.eventStarted(s, type);
    const items = s.hazardState.items;
    assert.ok(items.length > 0);
    for (const it of items) assert.ok(it.liveAt - it.warnAt >= S.minWarnMs, 'warning lasts long enough');
    assert.ok(items.every(it => it.liveAt - 40000 < COIN_DASH.events.duration), 'goes live before the event ends');
    // Park player 1 on the first hazard; warnings must be harmless.
    const target = items[0], p = s.players[0];
    if (type === 'lasers') { p.x = 400; p.y = 250; if (target.axis === 'h') p.y = target.pos; else p.x = target.pos; }
    else { p.x = target.x + target.w / 2; p.y = target.y + target.h / 2; }
    feature.update(s);
    assert.strictEqual(target.state, 'warning');
    assert.ok(target.rect ? target.rect.visible : target.band.visible, 'warning outline visible');
    s.time.now = target.liveAt - 1; feature.update(s);
    assert.strictEqual(s.knocked.length, 0, 'warning is harmless');
    s.time.now = target.liveAt; feature.update(s);
    assert.strictEqual(target.state, 'live');
    assert.deepStrictEqual(s.knocked[0], ['Player 1', type === 'lasers' ? 'laser' : 'electric']);
    assert.ok(p.out);
    feature.eventEnded(s, type);
    assert.ok(s.objects.length > 0 && s.objects.every(o => o.destroyed), 'visuals destroyed');
    assert.strictEqual(s.hazardState.items.length, 0);
    s.time.now += 100; feature.update(s); // no crash after cleanup
  });
}

test('cancelled knock-out (shield) gives a grace period instead of re-hitting every frame', () => {
  const s = makeScene(); s.shield = true; s.time.now = 1000;
  feature.eventStarted(s, 'zones');
  const z = s.hazardState.items[0], p = s.players[0];
  p.x = z.x + z.w / 2; p.y = z.y + z.h / 2;
  s.time.now = z.liveAt; feature.update(s);
  s.time.now += 16; feature.update(s);
  assert.strictEqual(s.knocked.length, 1);
  s.time.now += S.graceMs; feature.update(s);
  assert.strictEqual(s.knocked.length, 2);
});

test('other event types and finish are handled cleanly', () => {
  const s = makeScene();
  feature.eventStarted(s, 'ice');
  assert.strictEqual(s.hazardState.items.length, 0);
  feature.eventStarted(s, 'lasers');
  s.finished = true; feature.finished(s, {});
  assert.ok(s.objects.every(o => o.destroyed));
  feature.eventEnded(s, 'ice');
});

console.log(`\n${passed} tests passed`);
