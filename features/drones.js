// drones feature: new drone types (chaser, patrol, zigzag) that join scene.drones over the round,
// so the base game's overlap/knockOut logic applies to them. Registers in window.COIN_DASH_FEATURES.
(function () {
  const S = {
    firstSpawnSec: 4, // no extra drones before this (the round starts with exactly the 3 originals)
    spawnEverySec: 4.5, // one more extra drone allowed every N seconds after firstSpawnSec
    maxExtra: 8, // cap on extra drones alive in one round
    maxChasers: 2, // chasers are the most dangerous, keep them few
    order: ['patrol', 'zigzag', 'chaser', 'patrol', 'zigzag', 'chaser', 'zigzag', 'patrol'],
    speedRampSec: 40, // speed scale grows linearly to maxSpeedScale over this many seconds
    maxSpeedScale: 1.5,
    minSpawnDistance: 170, // never spawn closer than this to any player
    warnMs: 700, // a pulsing ring telegraphs each spawn
    margin: 30, // keep spawns/paths this far inside the world bounds
    chaser: { speed: 75, maxSpeed: 120, turn: 2.2, radius: 12, color: 0xff9a2e, outline: 0xffffff },
    patrol: { speed: 95, maxSpeed: 150, length: 220, w: 34, h: 14, color: 0x3fa9ff, outline: 0xe6f4ff },
    zigzag: { speed: 85, maxSpeed: 135, amplitude: 110, frequency: 3.2, size: 26, color: 0xff3fd2,
      outline: 0x2a0022 },
    warnColor: 0xffffff
  };

  // ---- Pure logic (unit-tested in tests/drones.test.js) ----

  function difficulty(elapsedSec) {
    const t = Math.max(0, elapsedSec);
    const extra = t < S.firstSpawnSec ? 0
      : Math.min(S.maxExtra, 1 + Math.floor((t - S.firstSpawnSec) / S.spawnEverySec));
    const speedScale = 1 + (S.maxSpeedScale - 1) * Math.min(1, t / S.speedRampSec);
    return { extra, speedScale };
  }

  function nearestActive(players, x, y) {
    let best = null, bestD = Infinity;
    for (const p of players || []) {
      if (!p || p.out) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  function farEnough(players, x, y, minDist) {
    return (players || []).every(p => (p.x - x) ** 2 + (p.y - y) ** 2 >= minDist * minDist);
  }

  // bounds: { x, y, width, height }. Returns null if no safe spot is found.
  function pickSpawn(players, bounds, rng, minDist) {
    const m = S.margin, md = minDist == null ? S.minSpawnDistance : minDist;
    for (let i = 0; i < 60; i++) {
      const x = bounds.x + m + rng() * (bounds.width - 2 * m);
      const y = bounds.y + m + rng() * (bounds.height - 2 * m);
      if (farEnough(players, x, y, md)) return { x, y };
    }
    return null;
  }

  function nextType(spawnedTypes) {
    const chasers = spawnedTypes.filter(t => t === 'chaser').length;
    let type = S.order[spawnedTypes.length % S.order.length];
    if (type === 'chaser' && chasers >= S.maxChasers) type = 'zigzag';
    return type;
  }

  // Patrol path through (x, y), clipped to bounds: horizontal line, vertical line or rectangle loop.
  function patrolPath(kind, x, y, bounds) {
    const m = S.margin, half = S.patrol.length / 2;
    const cx = v => Math.max(bounds.x + m, Math.min(bounds.x + bounds.width - m, v));
    const cy = v => Math.max(bounds.y + m, Math.min(bounds.y + bounds.height - m, v));
    if (kind === 'h') return [{ x: cx(x - half), y }, { x: cx(x + half), y }];
    if (kind === 'v') return [{ x, y: cy(y - half) }, { x, y: cy(y + half) }];
    const x0 = cx(x - half / 1.5), x1 = cx(x + half / 1.5), y0 = cy(y - half / 2), y1 = cy(y + half / 2);
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  }

  // Desired chaser velocity this frame: turn toward target, capped speed.
  function chaserVelocity(vx, vy, fromX, fromY, target, speed, turn, dt) {
    let dx = 0, dy = 0;
    if (target) {
      const len = Math.hypot(target.x - fromX, target.y - fromY) || 1;
      dx = (target.x - fromX) / len * speed;
      dy = (target.y - fromY) / len * speed;
    }
    const k = Math.min(1, turn * dt);
    let nx = vx + (dx - vx) * k, ny = vy + (dy - vy) * k;
    const mag = Math.hypot(nx, ny);
    if (mag > speed) { nx = nx / mag * speed; ny = ny / mag * speed; }
    return { x: nx, y: ny };
  }

  // ---- Scene integration ----

  function bounds(scene) {
    const b = scene.physics.world.bounds;
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }

  function elapsedSec(scene) {
    const total = window.COIN_DASH.roundSeconds * 1000;
    return (total - (scene.deadline - scene.time.now)) / 1000;
  }

  function makeDrone(scene, type, x, y) {
    let d;
    if (type === 'chaser') {
      const c = S.chaser;
      d = scene.add.circle(x, y, c.radius, c.color).setStrokeStyle(3, c.outline);
      scene.drones.add(d);
      d.body.setCircle(c.radius);
    } else if (type === 'patrol') {
      const c = S.patrol, kind = ['h', 'v', 'loop'][Math.floor(Math.random() * 3)];
      const [w, h] = kind === 'v' ? [c.h, c.w] : [c.w, c.h];
      d = scene.add.rectangle(x, y, w, h, c.color).setStrokeStyle(2, c.outline);
      scene.drones.add(d);
      d.path = patrolPath(kind, x, y, bounds(scene));
      d.waypoint = 1;
      d.pathLine = scene.add.graphics().setDepth(-1);
      d.pathLine.lineStyle(2, c.color, 0.25);
      d.pathLine.strokePoints(d.path.map(p => ({ x: p.x, y: p.y })), kind === 'loop');
    } else {
      const c = S.zigzag, s = c.size;
      d = scene.add.triangle(x, y, 0, s, s / 2, 0, s, s, c.color).setStrokeStyle(2, c.outline);
      scene.drones.add(d);
      const a = Math.random() * Math.PI * 2;
      d.forward = { x: Math.cos(a), y: Math.sin(a) };
      d.phase = 0;
    }
    d.droneType = type;
    d.body.setCollideWorldBounds(true);
    d.body.setBounce(type === 'chaser' ? 0 : 1, type === 'chaser' ? 0 : 1);
    return d;
  }

  function moveDrone(scene, d, scale, dt) {
    const b = d.body;
    if (d.droneType === 'chaser') {
      const c = S.chaser, speed = Math.min(c.maxSpeed, c.speed * scale);
      const v = chaserVelocity(b.velocity.x, b.velocity.y, d.x, d.y,
        nearestActive(scene.players, d.x, d.y), speed, c.turn, dt);
      b.setVelocity(v.x, v.y);
    } else if (d.droneType === 'patrol') {
      const c = S.patrol, speed = Math.min(c.maxSpeed, c.speed * scale);
      let wp = d.path[d.waypoint];
      if (Math.hypot(wp.x - d.x, wp.y - d.y) < Math.max(4, speed * dt * 1.5)) {
        d.waypoint = (d.waypoint + 1) % d.path.length;
        wp = d.path[d.waypoint];
      }
      const len = Math.hypot(wp.x - d.x, wp.y - d.y) || 1;
      b.setVelocity((wp.x - d.x) / len * speed, (wp.y - d.y) / len * speed);
    } else {
      const c = S.zigzag, speed = Math.min(c.maxSpeed, c.speed * scale), bb = bounds(scene);
      const h = c.size / 2 + 1, f = d.forward;
      // Bounce the travel direction off the world bounds.
      if ((d.x <= bb.x + h && f.x < 0) || (d.x >= bb.x + bb.width - h && f.x > 0)) f.x = -f.x;
      if ((d.y <= bb.y + h && f.y < 0) || (d.y >= bb.y + bb.height - h && f.y > 0)) f.y = -f.y;
      d.phase += dt * c.frequency;
      const side = Math.cos(d.phase) * c.amplitude * Math.min(1, scale);
      b.setVelocity(f.x * speed - f.y * side, f.y * speed + f.x * side);
      d.rotation = Math.atan2(b.velocity.y, b.velocity.x) + Math.PI / 2;
    }
  }

  function startWarning(scene, st) {
    const spot = pickSpawn(scene.players, bounds(scene), Math.random);
    if (!spot) return;
    const ring = scene.add.circle(spot.x, spot.y, 18).setStrokeStyle(2, S.warnColor).setDepth(1);
    scene.tweens.add({ targets: ring, scale: 0.4, alpha: 0.3, duration: S.warnMs / 2, yoyo: true });
    st.pending = { x: spot.x, y: spot.y, at: scene.time.now + S.warnMs, ring };
  }

  function updateSpawning(scene, st, extraAllowed) {
    const pend = st.pending;
    if (pend) {
      if (scene.time.now < pend.at) return;
      pend.ring.destroy();
      st.pending = null;
      // A player walked onto the warning spot: try somewhere else instead.
      if (!farEnough(scene.players, pend.x, pend.y, S.minSpawnDistance)) return;
      const type = nextType(st.spawnedTypes);
      st.spawnedTypes.push(type);
      st.extra.push(makeDrone(scene, type, pend.x, pend.y));
      return;
    }
    if (st.extra.length < extraAllowed) startWarning(scene, st);
  }

  const feature = {
    name: 'drones',
    settings: S,
    logic: { difficulty, nearestActive, farEnough, pickSpawn, nextType, patrolPath, chaserVelocity },
    create(scene) {
      // create runs again on restart; the old scene objects are already gone, so just reset state.
      scene.droneFeature = { extra: [], spawnedTypes: [], pending: null };
    },
    update(scene, time, delta) {
      const st = scene.droneFeature;
      if (!st || scene.finished) return;
      const diff = difficulty(elapsedSec(scene));
      st.speedScale = diff.speedScale;
      updateSpawning(scene, st, diff.extra);
      const dt = Math.min(0.05, delta / 1000);
      for (const d of st.extra) if (d.active && d.body) moveDrone(scene, d, diff.speedScale, dt);
    }
  };

  (window.COIN_DASH_FEATURES = window.COIN_DASH_FEATURES || []).push(feature);
  if (typeof module !== 'undefined' && module.exports) module.exports = feature;
}());
