// Power-ups feature: shield, speed boost and coin magnet, picked up per player.
// Registers itself in window.COIN_DASH_FEATURES (see features/README.md). Settings live here.
(function () {
  const SETTINGS = {
    maxOnField: 2, // never more than this many power-ups waiting on the arena
    firstSpawnMs: 3000,
    spawnMinMs: 4000, // gap between spawn attempts
    spawnMaxMs: 7000,
    lifetimeMs: 9000, // an uncollected power-up disappears after this long
    pickupRadius: 22,
    minPlayerDistance: 70, // never spawn this close to a player
    minCoinDistance: 40,
    minPowerupDistance: 60,
    shieldInvulnMs: 1000, // grace period after a shield breaks
    shieldShoveSpeed: 360, // push away from the drone that broke the shield
    shieldShoveMs: 180,
    speedMs: 5000,
    speedMultiplier: 1.6,
    magnetMs: 7000,
    magnetPull: 260, // px per second the coin moves toward the magnet holder
    magnetMinDistance: 4,
    types: {
      shield: { label: 'S', color: 0x4fc3ff, hud: 'SHIELD' },
      speed: { label: '>', color: 0x7dff6a, hud: 'SPD' },
      magnet: { label: 'M', color: 0xff5fd2, hud: 'MAG' }
    }
  };
  const TYPES = Object.keys(SETTINGS.types);
  const cfg = () => (typeof COIN_DASH !== 'undefined' ? COIN_DASH : (window.COIN_DASH || {}));
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const holeOpen = (scene, x, y) => {
    if (!scene.holes || !scene.cellKey) return false;
    const h = scene.holes.get(scene.cellKey(x, y));
    return Boolean(h && h.open);
  };
  const isHole = (scene, x, y) => (scene.isHole ? scene.isHole(x, y) : false);
  const safeDestroy = obj => { if (obj && obj.destroy) obj.destroy(); };

  // Per-player power-up state lives on the player so it is reset with the scene on restart.
  function stateOf(p) {
    if (!p.powerups) {
      p.powerups = { shield: false, invulnUntil: 0, speedUntil: 0, speedApplied: 1, magnetUntil: 0,
        ringShield: null, ringSpeed: null, ringMagnet: null, label: null };
    }
    return p.powerups;
  }

  function makeVisual(scene, type, x, y) {
    const t = SETTINGS.types[type];
    let shape;
    if (type === 'shield') {
      shape = scene.add.circle(x, y, 11, t.color, 0.9).setStrokeStyle(2, 0xffffff);
    } else if (type === 'speed') {
      shape = scene.add.triangle(x, y, 0, 22, 11, 0, 22, 22, t.color, 0.95).setStrokeStyle(2, 0xffffff);
    } else {
      shape = scene.add.rectangle(x, y, 16, 16, t.color, 0.95).setStrokeStyle(2, 0xffffff).setAngle(45);
    }
    shape.setDepth(0.5);
    const text = scene.add.text(x, y, t.label, { font: 'bold 12px monospace', color: '#0a1120' })
      .setOrigin(0.5).setDepth(0.6);
    if (scene.tweens && scene.tweens.add) {
      scene.tweens.add({ targets: shape, scale: 1.2, duration: 450, yoyo: true, repeat: -1 });
    }
    return { shape, text };
  }

  function findSpot(scene) {
    const c = cfg();
    const w = c.width || 800, h = c.height || 500;
    const pu = scene.powerupState;
    for (let tries = 0; tries < 40; tries++) {
      const x = Math.round(rand(30, w - 30)), y = Math.round(rand(74, h - 30));
      if (isHole(scene, x, y)) continue;
      if ((scene.players || []).some(p => dist(x, y, p.x, p.y) < SETTINGS.minPlayerDistance)) continue;
      if (scene.coin && dist(x, y, scene.coin.x, scene.coin.y) < SETTINGS.minCoinDistance) continue;
      if (pu.items.some(it => dist(x, y, it.x, it.y) < SETTINGS.minPowerupDistance)) continue;
      return { x, y };
    }
    return null; // arena too crowded this time; try again at the next spawn tick
  }

  function spawn(scene, type) {
    const pu = scene.powerupState;
    if (pu.items.length >= SETTINGS.maxOnField) return null;
    const spot = findSpot(scene);
    if (!spot) return null;
    type = type || TYPES[Math.floor(Math.random() * TYPES.length)];
    const item = { type, x: spot.x, y: spot.y, expires: scene.time.now + SETTINGS.lifetimeMs };
    Object.assign(item, makeVisual(scene, type, spot.x, spot.y));
    pu.items.push(item);
    return item;
  }

  function removeItem(scene, item) {
    const pu = scene.powerupState;
    const i = pu.items.indexOf(item);
    if (i >= 0) pu.items.splice(i, 1);
    if (scene.tweens && scene.tweens.killTweensOf) scene.tweens.killTweensOf(item.shape);
    safeDestroy(item.shape);
    safeDestroy(item.text);
  }

  function setSpeed(p, s, factor) {
    // Multiply/divide so other features that also scale speed are not clobbered.
    const scale = typeof p.speedScale === 'number' ? p.speedScale : 1;
    p.speedScale = scale * factor / s.speedApplied;
    s.speedApplied = factor;
  }

  function apply(scene, p, type) {
    const s = stateOf(p), now = scene.time.now;
    if (type === 'shield') s.shield = true;
    else if (type === 'speed') {
      if (s.speedApplied === 1) setSpeed(p, s, SETTINGS.speedMultiplier); // refresh, never stack
      s.speedUntil = now + SETTINGS.speedMs;
    } else if (type === 'magnet') s.magnetUntil = now + SETTINGS.magnetMs;
  }

  function clearEffects(p) {
    const s = stateOf(p);
    s.shield = false;
    s.invulnUntil = 0;
    s.magnetUntil = 0;
    s.speedUntil = 0;
    if (s.speedApplied !== 1) setSpeed(p, s, 1);
  }

  // After a shield breaks on a hole, step the player onto the nearest neighbouring solid cell.
  function nudgeOffHole(scene, p) {
    if (!holeOpen(scene, p.x, p.y)) return;
    const c = cfg(), w = c.width || 800, h = c.height || 500;
    const col = Math.floor(p.x / 40), row = Math.floor(p.y / 40);
    let best = null;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        const x = (col + dc) * 40 + 20, y = (row + dr) * 40 + 20;
        if (x < 12 || x > w - 12 || y < 44 + 12 || y > h - 12) continue;
        if (isHole(scene, x, y)) continue;
        const d = dist(p.x, p.y, x, y);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    if (!best) return; // surrounded: the invulnerability window still lets them walk out
    p.x = best.x; p.y = best.y;
    if (p.setPosition) p.setPosition(best.x, best.y);
    if (p.body && p.body.reset) p.body.reset(best.x, best.y);
    p.floorCell = scene.cellKey ? scene.cellKey(best.x, best.y) : p.floorCell;
  }

  function shoveFromDrone(scene, p, drone) {
    if (!drone || typeof drone.x !== 'number' || !p.body || !p.body.setVelocity) return;
    let dx = p.x - drone.x, dy = p.y - drone.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    p.stunnedUntil = scene.time.now + SETTINGS.shieldShoveMs;
    p.body.setVelocity(dx * SETTINGS.shieldShoveSpeed, dy * SETTINGS.shieldShoveSpeed);
  }

  function updateMagnet(scene, dt) {
    const coin = scene.coin;
    if (!coin) return;
    const now = scene.time.now;
    const holders = scene.players.filter(p => !p.out && stateOf(p).magnetUntil > now);
    if (!holders.length) return;
    // With two magnets the nearer holder wins the pull.
    holders.sort((a, b) => dist(a.x, a.y, coin.x, coin.y) - dist(b.x, b.y, coin.x, coin.y));
    const p = holders[0];
    const d = dist(p.x, p.y, coin.x, coin.y);
    if (d < SETTINGS.magnetMinDistance) return;
    const step = Math.min(d, SETTINGS.magnetPull * dt / 1000);
    const nx = coin.x + (p.x - coin.x) / d * step, ny = coin.y + (p.y - coin.y) / d * step;
    if (holeOpen(scene, nx, ny)) return; // don't drag the coin into a hole
    coin.x = nx; coin.y = ny;
    if (coin.setPosition) coin.setPosition(nx, ny);
    if (coin.body && coin.body.reset) coin.body.reset(nx, ny);
  }

  function updateIndicators(scene, p) {
    const s = stateOf(p), now = scene.time.now, alive = !p.out && !scene.finished;
    if (!s.ringShield && scene.add) {
      s.ringShield = scene.add.circle(p.x, p.y, 19).setStrokeStyle(3, SETTINGS.types.shield.color).setDepth(1);
      s.ringSpeed = scene.add.circle(p.x, p.y, 23).setStrokeStyle(2, SETTINGS.types.speed.color).setDepth(1);
      s.ringMagnet = scene.add.circle(p.x, p.y, 27).setStrokeStyle(2, SETTINGS.types.magnet.color).setDepth(1);
      s.label = scene.add.text(p.x, p.y + 22, '', { font: '11px monospace', color: '#ffffff',
        stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(1);
    }
    const show = {
      ringShield: alive && s.shield,
      ringSpeed: alive && s.speedUntil > now,
      ringMagnet: alive && s.magnetUntil > now
    };
    for (const key of Object.keys(show)) {
      if (s[key]) s[key].setPosition(p.x, p.y).setVisible(show[key]);
    }
    const parts = [];
    const secs = until => Math.max(0, Math.ceil((until - now) / 1000));
    if (show.ringShield) parts.push(SETTINGS.types.shield.hud);
    if (show.ringSpeed) parts.push(`${SETTINGS.types.speed.hud} ${secs(s.speedUntil)}s`);
    if (show.ringMagnet) parts.push(`${SETTINGS.types.magnet.hud} ${secs(s.magnetUntil)}s`);
    if (s.label) s.label.setPosition(p.x, p.y + 22).setText(parts.join(' ')).setVisible(alive && parts.length > 0);
    // Flicker while invulnerable after a shield broke.
    if (alive && p.setAlpha) {
      if (s.invulnUntil > now) p.setAlpha(Math.floor(now / 80) % 2 ? 0.35 : 1);
      else if (s.flickering) p.setAlpha(1);
      s.flickering = s.invulnUntil > now;
    }
  }

  const feature = {
    name: 'powerups',
    settings: SETTINGS,

    create(scene) {
      // create() runs again on restart, so all state is rebuilt from scratch here.
      scene.powerupState = { items: [], nextSpawn: scene.time.now + SETTINGS.firstSpawnMs };
      for (const p of scene.players || []) { p.powerups = null; stateOf(p); }
    },

    update(scene, time, delta) {
      const pu = scene.powerupState;
      if (!pu || scene.finished) return;
      const now = scene.time.now;
      if (now >= pu.nextSpawn) {
        spawn(scene);
        pu.nextSpawn = now + rand(SETTINGS.spawnMinMs, SETTINGS.spawnMaxMs);
      }
      for (const item of pu.items.slice()) {
        if (now >= item.expires || holeOpen(scene, item.x, item.y)) { removeItem(scene, item); continue; }
        const taker = scene.players.find(p => !p.out
          && dist(p.x, p.y, item.x, item.y) < SETTINGS.pickupRadius);
        if (taker) { apply(scene, taker, item.type); removeItem(scene, item); }
      }
      for (const p of scene.players) {
        const s = stateOf(p);
        if (p.out) { if (s.shield || s.speedUntil || s.magnetUntil) clearEffects(p); }
        else if (s.speedApplied !== 1 && now >= s.speedUntil) { setSpeed(p, s, 1); s.speedUntil = 0; }
      }
      updateMagnet(scene, delta || 0);
      for (const p of scene.players) updateIndicators(scene, p);
    },

    playerHit(scene, p, source) {
      const s = stateOf(p), now = scene.time.now;
      if (s.invulnUntil > now) {
        if (source === 'hole') nudgeOffHole(scene, p);
        return false;
      }
      if (!s.shield) return undefined;
      s.shield = false;
      s.invulnUntil = now + SETTINGS.shieldInvulnMs;
      if (source === 'hole') nudgeOffHole(scene, p);
      else shoveFromDrone(scene, p, source);
      return false;
    },

    finished(scene) {
      // Freeze: hide waiting power-ups and markers; restore speed so nothing leaks into results.
      const pu = scene.powerupState;
      if (pu) for (const item of pu.items.slice()) removeItem(scene, item);
      for (const p of scene.players || []) {
        clearEffects(p);
        updateIndicators(scene, p);
        if (!p.out && p.setAlpha) p.setAlpha(1);
      }
    },

    // Exposed for tests.
    _internal: { spawn, apply, stateOf, removeItem }
  };

  (window.COIN_DASH_FEATURES = window.COIN_DASH_FEATURES || []).push(feature);
  if (typeof module !== 'undefined' && module.exports) module.exports = feature;
})();
