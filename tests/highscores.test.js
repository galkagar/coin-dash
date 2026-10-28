// Node logic test for features/highscores.js (no browser). Run: node tests/highscores.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'features', 'highscores.js'), 'utf8');

function memStorage() {
  const m = {};
  return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, _m: m };
}
function loadFeature(storageImpl) {
  const window = { COIN_DASH_FEATURES: [] };
  if (storageImpl === 'throwing-getter') {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
  } else window.localStorage = storageImpl;
  const ctx = { window, COIN_DASH: { width: 800, height: 500, roundSeconds: 45 }, Date, JSON, Math, Object, String, Map, Set };
  window.COIN_DASH = ctx.COIN_DASH;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return window.COIN_DASH_FEATURES.find(f => f.name === 'highscores');
}
function obj() {
  const o = { destroyed: false };
  for (const m of ['setOrigin', 'setDepth', 'setText', 'setVisible']) o[m] = () => o;
  o.destroy = () => { o.destroyed = true; };
  return o;
}
function makeScene() {
  const texts = [];
  const scene = {
    finished: false,
    time: { now: 1000, delayedCall() {} },
    tweens: { add() {} },
    add: {
      text(x, y, t) { const o = obj(); Object.assign(o, { x, y, text: t }); texts.push(o); return o; },
      rectangle(x, y, w, h) { const o = obj(); Object.assign(o, { x, y, w, h }); return o; }
    },
    players: [
      { name: 'Player 1', score: 0, coins: 0, out: false },
      { name: 'Player 2', score: 0, coins: 0, out: false }
    ],
    texts
  };
  return scene;
}
// Mimics game.js knockOut: playerHit hooks, then out.
function knock(f, scene, p, source) {
  if (f.playerHit(scene, p, source) === false) return;
  p.out = true;
}
function coin(f, scene, p, pts = 1) { p.score += pts; p.coins++; f.coinCollected(scene, p, pts); }

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok -', name); }

test('coin achievements unlock at 1, 10, 20 coins and toast once', () => {
  const f = loadFeature(memStorage()), s = makeScene(); f.create(s);
  const [p1] = s.players;
  coin(f, s, p1);
  assert.ok(s.hsState.data.achievements.firstCoin);
  assert.ok(!s.hsState.data.achievements.coins10);
  for (let i = 0; i < 9; i++) coin(f, s, p1);
  assert.ok(s.hsState.data.achievements.coins10);
  assert.ok(!s.hsState.data.achievements.coins20);
  for (let i = 0; i < 10; i++) coin(f, s, p1);
  assert.ok(s.hsState.data.achievements.coins20);
  const toasts = s.texts.filter(t => /ACHIEVEMENT/.test(t.text));
  assert.strictEqual(toasts.length, 3);
  // Toasts stay out of the HUD rows (y<44) and the event banner (y≈170).
  for (const t of toasts) assert.ok(t.y > 400, 'toast y ' + t.y);
});

test('survival time, out source and survive-20 / full-round achievements', () => {
  const f = loadFeature(memStorage()), s = makeScene(); f.create(s);
  const [p1, p2] = s.players;
  s.time.now = 1000 + 12500; knock(f, s, p2, 'hole'); f.update(s);
  s.time.now = 1000 + 19000; f.update(s);
  assert.ok(!s.hsState.data.achievements.survive20);
  s.time.now = 1000 + 20000; f.update(s);
  assert.strictEqual(s.hsState.data.achievements.survive20.by, 'Player 1');
  s.time.now = 1000 + 45200; s.finished = true;
  f.finished(s, { reason: 'Time is up!', allOut: false, winner: null });
  const sv = f._internals.survivalSeconds;
  assert.strictEqual(sv(s, p2), 12.5);
  assert.strictEqual(sv(s, p1), 45); // capped at round length
  assert.strictEqual(s.hsState.outBy.get(p2), 'hole');
  assert.ok(s.hsState.data.achievements.surviveFull);
  const panel = s.hsState.panelText.text;
  assert.ok(/Player 2 .*12\.5s +hole/.test(panel), panel);
  assert.ok(/Player 1 .*45\.0s +survived/.test(panel), panel);
});

test('drone knock-out recorded; cancelled hit (shield) does not count', () => {
  const f = loadFeature(memStorage()), s = makeScene(); f.create(s);
  const [p1, p2] = s.players;
  s.time.now = 3000; f.playerHit(s, p1, { type: 'drone' }); // cancelled by another feature: p1 stays in
  f.update(s);
  assert.ok(!s.hsState.outAt.has(p1));
  s.time.now = 6000; knock(f, s, p1, {}); knock(f, s, p2, {});
  s.finished = true; f.finished(s, { allOut: true, winner: null });
  assert.strictEqual(s.hsState.outBy.get(p1), 'drone');
  assert.strictEqual(f._internals.survivalSeconds(s, p1), 5);
  assert.ok(!s.hsState.data.achievements.surviveFull);
});

test('survive an environment event', () => {
  const f = loadFeature(memStorage()), s = makeScene(); f.create(s);
  const [p1, p2] = s.players;
  f.eventStarted(s, 'collapse');
  knock(f, s, p2, 'hole');
  f.eventEnded(s, 'collapse');
  assert.strictEqual(s.hsState.data.achievements.surviveEvent.by, 'Player 1');
});

test('best scores persist across rounds and NEW BEST shows only when beaten', () => {
  const store = memStorage();
  let f = loadFeature(store), s = makeScene(); f.create(s);
  s.players[0].score = 7; s.players[1].score = 5; s.finished = true;
  f.finished(s, { allOut: true, winner: s.players[0] });
  assert.deepStrictEqual({ ...s.hsState.bests }, { player: true, total: true });
  assert.ok(/NEW BEST!/.test(s.hsState.panelText.text));
  const saved = JSON.parse(store.getItem('coinDash.highscores.v1'));
  assert.strictEqual(saved.bestPlayer.score, 7); assert.strictEqual(saved.bestPlayer.slot, 1);
  assert.strictEqual(saved.bestTotal, 12);
  // Fresh load (simulates reload): P2 beats single best, total not beaten.
  f = loadFeature(store); s = makeScene(); f.create(s);
  s.players[0].score = 1; s.players[1].score = 9; s.finished = true;
  f.finished(s, { allOut: true, winner: s.players[1] });
  assert.deepStrictEqual({ ...s.hsState.bests }, { player: true, total: false });
  const d = JSON.parse(store.getItem('coinDash.highscores.v1'));
  assert.deepStrictEqual([d.bestPlayer.score, d.bestPlayer.slot, d.bestTotal, d.rounds], [9, 2, 12, 2]);
  // Third round beats nothing.
  f = loadFeature(store); s = makeScene(); f.create(s);
  s.players[0].score = 2; s.finished = true; f.finished(s, { allOut: true });
  assert.ok(!/NEW BEST!/.test(s.hsState.panelText.text));
});

test('achievements persist and do not re-unlock; restart resets per-round state', () => {
  const store = memStorage();
  let f = loadFeature(store), s = makeScene(); f.create(s);
  coin(f, s, s.players[0]);
  f = loadFeature(store); s = makeScene(); f.create(s);
  coin(f, s, s.players[1]);
  assert.strictEqual(s.hsState.newThisRound.length, 0);
  assert.strictEqual(s.texts.length, 0);
  // Restart in same scene: create runs again and per-round tracking is fresh.
  s.time.now = 9000; s.players[0].out = true; f.update(s);
  assert.ok(s.hsState.outAt.size === 1);
  s.players[0].out = false; f.create(s);
  assert.strictEqual(s.hsState.outAt.size, 0);
  assert.strictEqual(s.hsState.start, 9000);
});

test('throwing / missing localStorage never crashes', () => {
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  for (const st of [throwing, 'throwing-getter', undefined, { getItem: () => '{not json', setItem() {} }]) {
    const f = loadFeature(st), s = makeScene();
    f.create(s);
    coin(f, s, s.players[0]);
    s.time.now = 30000; f.update(s);
    s.finished = true; f.finished(s, { allOut: false, winner: s.players[0] });
    assert.ok(s.hsState.data.achievements.firstCoin);
    assert.ok(s.hsState.panelText);
    // Within the session, the in-memory fallback still remembers achievements.
    const s2 = makeScene(); f.create(s2); coin(f, s2, s2.players[0]);
    assert.strictEqual(s2.hsState.newThisRound.length, 0);
  }
});

console.log(`\n${passed} tests passed`);
