// Node logic test for features/combos.js with a stubbed window/scene (no Phaser, no browser).
// Run: node tests/combos.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'features', 'combos.js'), 'utf8');

function loadFeatures(pre = []) {
  const window = { COIN_DASH_FEATURES: pre.slice() };
  const ctx = { window, COIN_DASH: { colors: { player: 0x71e8ce, player2: 0xb07cff } } };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return window.COIN_DASH_FEATURES;
}

function stubObj() {
  const o = { visible: true, text: '', x: 0, y: 0, scaleX: 1, destroyed: false };
  for (const m of ['setOrigin', 'setDepth', 'setVisible', 'setText', 'setPosition', 'setScale']) {
    o[m] = (...a) => {
      if (m === 'setVisible') o.visible = a[0];
      if (m === 'setText') o.text = a[0];
      if (m === 'setPosition') { o.x = a[0]; o.y = a[1]; }
      if (m === 'setScale') o.scaleX = a[0];
      return o;
    };
  }
  o.destroy = () => { o.destroyed = true; };
  return o;
}

function makeScene() {
  const texts = [];
  const scene = {
    finished: false,
    time: { now: 0 },
    coin: { x: 100, y: 120 },
    players: [
      { name: 'Player 1', score: 0, coins: 0, out: false, x: 50, y: 50 },
      { name: 'Player 2', score: 0, coins: 0, out: false, x: 300, y: 300 }
    ],
    add: {
      text: (x, y, msg, style) => { const t = stubObj(); Object.assign(t, { x, y, text: msg, style }); texts.push(t); return t; },
      rectangle: () => stubObj()
    },
    tweens: { add: cfg => { scene.lastTween = cfg; } },
    texts
  };
  return scene;
}

// Mirrors game.js collectCoin.
function collect(features, scene, p) {
  if (scene.finished || p.out) return 0;
  const points = features.reduce((n, f) => (f.coinPoints ? f.coinPoints(scene, p, n) : n), 1);
  p.score += points;
  p.coins++;
  features.forEach(f => f.coinCollected && f.coinCollected(scene, p, points));
  return points;
}
const tick = (features, scene, ms) => {
  scene.time.now += ms;
  features.forEach(f => f.update && f.update(scene, scene.time.now, ms));
};

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok -', name); }

test('multiplier progression x1..x5 and cap at x5', () => {
  const fs_ = loadFeatures(); const scene = makeScene(); fs_.forEach(f => f.create && f.create(scene));
  const p = scene.players[0];
  const got = [];
  for (let i = 0; i < 7; i++) { got.push(collect(fs_, scene, p)); tick(fs_, scene, 1000); }
  assert.deepStrictEqual(got, [1, 2, 3, 4, 5, 5, 5]);
  assert.strictEqual(p.score, 25);
  assert.strictEqual(p.coins, 7);
});

test('combo expires 3 s after the last coin', () => {
  const fs_ = loadFeatures(); const scene = makeScene(); fs_.forEach(f => f.create && f.create(scene));
  const combo = fs_.find(f => f.name === 'combos');
  const p = scene.players[0];
  collect(fs_, scene, p); tick(fs_, scene, 2999);
  assert.strictEqual(collect(fs_, scene, p), 2, 'within window builds');
  tick(fs_, scene, 2999);
  assert.strictEqual(combo.multiplier(scene, p), 2);
  tick(fs_, scene, 1);
  assert.strictEqual(combo.multiplier(scene, p), 0, 'expired at 3 s');
  assert.strictEqual(collect(fs_, scene, p), 1, 'restart at x1');
});

test('players have independent combos', () => {
  const fs_ = loadFeatures(); const scene = makeScene(); fs_.forEach(f => f.create && f.create(scene));
  const [p1, p2] = scene.players;
  collect(fs_, scene, p1); tick(fs_, scene, 500);
  collect(fs_, scene, p1); tick(fs_, scene, 500);
  assert.strictEqual(collect(fs_, scene, p2), 1);
  assert.strictEqual(collect(fs_, scene, p1), 3);
});

test('reset on knock-out', () => {
  const fs_ = loadFeatures(); const scene = makeScene(); fs_.forEach(f => f.create && f.create(scene));
  const combo = fs_.find(f => f.name === 'combos');
  const p = scene.players[0];
  collect(fs_, scene, p); tick(fs_, scene, 100); collect(fs_, scene, p);
  assert.strictEqual(combo.multiplier(scene, p), 2);
  p.out = true; tick(fs_, scene, 16);
  assert.strictEqual(combo.multiplier(scene, p), 0);
  assert.strictEqual(scene.combos.get(p).multiplier, 0, 'internal state cleared');
  p.out = false; // e.g. hypothetical revive: must start fresh
  assert.strictEqual(collect(fs_, scene, p), 1);
});

test('coinPoints multiplies its input (composes with other features)', () => {
  const doubler = { name: 'doubler', coinPoints: (s, p, n) => n * 2 };
  const plusTen = { name: 'plusTen', coinPoints: (s, p, n) => n + 10 };
  const fs_ = loadFeatures([doubler]); fs_.push(plusTen);
  const scene = makeScene(); fs_.forEach(f => f.create && f.create(scene));
  const combo = fs_.find(f => f.name === 'combos');
  const p = scene.players[0];
  assert.strictEqual(combo.coinPoints(scene, p, 7), 7, 'x1 passes through');
  assert.strictEqual(collect(fs_, scene, p), 1 * 2 * 1 + 10);
  tick(fs_, scene, 100);
  assert.strictEqual(collect(fs_, scene, p), 1 * 2 * 2 + 10);
  tick(fs_, scene, 100);
  assert.strictEqual(combo.coinPoints(scene, p, 4), 12, 'next multiplier x3 applied to input 4');
});

test('floating text shows "+N xM" at the coin position, coloured per player', () => {
  const fs_ = loadFeatures(); const scene = makeScene(); fs_.forEach(f => f.create && f.create(scene));
  const [p1, p2] = scene.players;
  collect(fs_, scene, p1); tick(fs_, scene, 100);
  scene.coin = { x: 222, y: 333 };
  collect(fs_, scene, p1);
  const t = scene.texts[scene.texts.length - 1];
  assert.strictEqual(t.text, '+2 x2');
  assert.strictEqual(t.x, 222); assert.strictEqual(t.y, 333);
  assert.strictEqual(t.style.color, '#71e8ce');
  assert.ok(scene.lastTween.alpha === 0 && scene.lastTween.y < 333, 'rises and fades');
  collect(fs_, scene, p2);
  const t2 = scene.texts[scene.texts.length - 1];
  assert.strictEqual(t2.text, '+1');
  assert.strictEqual(t2.style.color, '#b07cff');
});

test('timer UI shows multiplier and shrinking bar; hidden when idle', () => {
  const fs_ = loadFeatures(); const scene = makeScene(); fs_.forEach(f => f.create && f.create(scene));
  const p = scene.players[0];
  const s = () => scene.combos.get(p);
  tick(fs_, scene, 16);
  assert.strictEqual(s().label.visible, false);
  collect(fs_, scene, p); tick(fs_, scene, 1500);
  assert.strictEqual(s().label.visible, true);
  assert.strictEqual(s().label.text, 'x1 1.5s');
  assert.ok(Math.abs(s().bar.scaleX - 0.5) < 1e-9);
  tick(fs_, scene, 1500);
  assert.strictEqual(s().label.visible, false);
});

test('restart (create again) resets; finished freezes', () => {
  const fs_ = loadFeatures(); const scene = makeScene(); fs_.forEach(f => f.create && f.create(scene));
  const combo = fs_.find(f => f.name === 'combos');
  const p = scene.players[0];
  collect(fs_, scene, p); collect(fs_, scene, p);
  scene.finished = true;
  const before = scene.combos.get(p).label.text;
  tick(fs_, scene, 10000); // update is a no-op while finished
  assert.strictEqual(scene.combos.get(p).multiplier, 2);
  assert.strictEqual(scene.combos.get(p).label.text, before);
  assert.strictEqual(combo.coinPoints(scene, p, 3), 3, 'no multiplier after finish');
  const scene2 = makeScene(); fs_.forEach(f => f.create && f.create(scene2));
  assert.strictEqual(collect(fs_, scene2, scene2.players[0]), 1);
});

console.log(`\n${passed} tests passed`);
