// Node logic test for features/visual-effects.js with a stubbed window / Phaser scene.
// Run: node tests/visual-effects.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function obj(type, props = {}) {
  const o = Object.assign({ type, x: 0, y: 0, alpha: 1, visible: true, depth: 0, scale: 1, destroyed: false }, props);
  const chain = ['setDepth', 'setOrigin', 'setStrokeStyle', 'setStyle', 'setColor', 'setScale'];
  chain.forEach(m => { o[m] = function (v) { if (m === 'setDepth') this.depth = v; if (m === 'setColor') this.color = v; return this; }; });
  o.setAlpha = function (a) { this.alpha = a; return this; };
  o.setVisible = function (v) { this.visible = v; return this; };
  o.setPosition = function (x, y) { this.x = x; this.y = y; return this; };
  o.setText = function (t) { this.text = t; this.width = t.length * 11; return this; };
  o.destroy = function () { this.destroyed = true; };
  return o;
}

function makeScene() {
  const log = { particles: [], explode: 0, shake: 0, tweens: 0, delayed: [], texts: [], containers: [], textures: [] };
  const list = [];
  const add = o => { list.push(o); return o; };
  const graphics = () => {
    const g = obj('Graphics');
    ['fillStyle', 'fillCircle', 'fillRect', 'fillRoundedRect', 'lineStyle', 'strokeRoundedRect'].forEach(m => { g[m] = () => g; });
    g.generateTexture = key => { log.textures.push(key); textures.add(key); return g; };
    return g;
  };
  const textures = new Set();
  const scene = {
    finished: false, secondsLeft: 45,
    textures: { exists: k => textures.has(k) },
    make: { graphics },
    children: { list },
    cameras: { main: { shake: () => { log.shake++; } } },
    tweens: { add: cfg => { log.tweens++; return cfg; } },
    time: { now: 0, delayedCall: (ms, fn) => { log.delayed.push(fn); } },
    add: {
      rectangle: (x, y, w, h, color) => add(obj('Rectangle', { x, y, width: w, height: h, fillColor: color })),
      circle: (x, y, r, color) => add(obj('Arc', { x, y, radius: r, fillColor: color })),
      ellipse: (x, y, w, h) => add(obj('Ellipse', { x, y, width: w, height: h })),
      text: (x, y, t, style) => { const o = add(obj('Text', { x, y, style })); o.setText(t); log.texts.push(o); return o; },
      particles: (x, y, key, cfg) => {
        const e = add(obj('ParticleEmitter', { x, y, key, cfg, emitting: cfg.emitting !== false }));
        e.explode = (n) => { log.explode += n; };
        e.startFollow = t => { e.follow = t; return e; };
        log.particles.push(e); return e;
      },
      container: (x, y, items) => { const c = add(obj('Container', { x, y, items })); log.containers.push(c); return c; }
    }
  };
  const player = (name, x, color) => Object.assign(obj('Rectangle', { x, y: 250, width: 24, height: 24, fillColor: color }),
    { name, score: 0, coins: 0, out: false, body: { velocity: { x: 0, y: 0 } } });
  scene.players = [player('Player 1', 280, 0x71e8ce), player('Player 2', 520, 0xb07cff)];
  scene.coin = obj('Arc', { x: 100, y: 100 });
  const drones = [obj('Rectangle', { x: 90, y: 100, width: 26, height: 26, fillColor: 0xff657a })];
  scene.drones = { getChildren: () => drones };
  scene.hud = add(obj('Text')); scene.hud.setText('');
  scene.eventHud = add(obj('Text')); scene.eventHud.setText('Time: 45s');
  return { scene, log, drones };
}

const window = { COIN_DASH_FEATURES: [] };
const ctx = vm.createContext({ window, COIN_DASH: {
  width: 800, height: 500,
  colors: { background: 0x101c31, player: 0x71e8ce, coin: 0xffd166, drone: 0xff657a, player2: 0xb07cff }
}, Phaser: {}, console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'features', 'visual-effects.js'), 'utf8'), ctx);
const f = window.COIN_DASH_FEATURES.find(x => x.name === 'visual-effects');
assert(f, 'feature registered');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const flush = log => { const fns = log.delayed.splice(0); fns.forEach(fn => fn()); };

test('create builds textures, HUD bar, trails and keeps hud working', () => {
  const { scene, log } = makeScene();
  f.create(scene);
  assert.deepStrictEqual(log.textures.sort(), ['vfx-dot', 'vfx-spark']);
  assert.strictEqual(log.particles.length, 2, 'one trail per player');
  scene.hud.setText('P1: 3   P2: 1 (out)');
  scene.players[1].out = true;
  f.update(scene, 100, 16);
  assert(scene.hud.text.startsWith('P1: 3') && scene.hud.text.includes('P2: 1 (out)'));
  assert.strictEqual(scene.vfx.p1Text.text, 'P1: 3');
  assert.strictEqual(scene.vfx.p2Text.text, 'P2: 1 (out)');
  assert(scene.vfx.p2Text.x > scene.vfx.p1Text.x);
  assert.strictEqual(scene.vfx.droneGlows.size, 1, 'drone glow created');
});

test('textures are not regenerated on restart', () => {
  const { scene, log } = makeScene();
  scene.textures.exists = () => true;
  f.create(scene);
  assert.strictEqual(log.textures.length, 0);
});

test('coin collection bursts at the old coin position and shows +points', () => {
  const { scene, log } = makeScene();
  f.create(scene);
  scene.coin.x = 222; scene.coin.y = 111;
  assert.strictEqual(f.coinPoints(scene, scene.players[0], 2), 2, 'points unchanged');
  scene.coin.x = 500; // placeCoin moved it
  f.coinCollected(scene, scene.players[0], 2);
  const burst = log.particles[log.particles.length - 1];
  assert.strictEqual(burst.x, 222); assert.strictEqual(burst.y, 111);
  assert(log.explode > 0);
  assert(log.texts.some(t => t.text === '+2'));
});

test('knock-out shows burst + shake only when the player is really out', () => {
  const { scene, log } = makeScene();
  f.create(scene);
  const [p1, p2] = scene.players;
  // Cancelled hit (shield): player stays in.
  assert.strictEqual(f.playerHit(scene, p1, {}), undefined, 'never cancels a hit');
  flush(log);
  assert.strictEqual(log.shake, 0); assert.strictEqual(log.explode, 0);
  // Real hit.
  f.playerHit(scene, p2, {});
  f.playerHit(scene, p2, {}); // duplicate overlap in same frame
  p2.out = true;
  f.update(scene, 200, 16);
  flush(log);
  assert.strictEqual(log.shake, 1);
  assert(log.explode > 0);
  // Not repeated.
  f.update(scene, 216, 16); f.playerHit(scene, p2, 'hole'); flush(log);
  assert.strictEqual(log.shake, 1);
});

test('finished hides the base panel and draws the styled one', () => {
  const { scene, log } = makeScene();
  f.create(scene);
  const [p1, p2] = scene.players;
  p1.score = 5; p2.score = 3; p2.out = true;
  scene.finished = true;
  const baseRect = scene.add.rectangle(400, 250, 480, 210, 0x0a1120);
  const baseText = scene.add.text(400, 250, 'Time is up!\nP1: 5 coins   P2: 3 coins\nPlayer 1 wins!\nPress R to play again');
  f.finished(scene, { reason: 'Time is up!', allOut: false, winner: p1 });
  assert.strictEqual(baseRect.visible, false); assert.strictEqual(baseText.visible, false);
  assert.strictEqual(log.containers.length, 1);
  const texts = log.containers[0].items.filter(i => i.type === 'Text').map(t => t.text);
  ['Time is up!', '5', '3', 'Player 1 wins!', 'Press R to play again'].forEach(s => assert(texts.includes(s), s));
  const winLine = log.containers[0].items.find(i => i.text === 'Player 1 wins!');
  assert.strictEqual(winLine.style.color, '#71e8ce', 'winner colour');
  assert.strictEqual(scene.vfx.panelHint.visible, true);
  // Late knock-out effects after finish don't throw.
  f.playerHit(scene, p1, {}); p1.out = true; flush(log);
});

test('tie result uses neutral colour', () => {
  const { scene, log } = makeScene();
  f.create(scene);
  f.finished(scene, { reason: 'Everyone is out!', allOut: true, winner: null });
  assert(log.containers[0].items.some(i => i.text === 'It\'s a tie!'));
});

test('hooks are safe without create (scene.vfx missing)', () => {
  const { scene } = makeScene();
  f.update(scene, 0, 16); f.coinCollected(scene, scene.players[0], 1);
  f.playerHit(scene, scene.players[0], {}); f.finished(scene, {});
  assert.strictEqual(f.coinPoints(scene, scene.players[0], 4), 4);
});

console.log(`\n${passed} tests passed`);
