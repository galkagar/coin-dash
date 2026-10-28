/* global COIN_DASH */
// Arena hazards: two extra environment event types in the normal event rotation.
//   'lasers' — horizontal/vertical beams; each one flashes as a harmless outline first, then switches
//              on (and, later in the round, sweeps inside its outlined band). Touching a live beam = out.
//   'zones'  — electric floor zones; flashing outline first, then live. Standing in a live zone = out.
// Hazards get stronger as the round goes on (more beams/zones, sweeping beams, chosen more often),
// with caps. Layouts never cover more than a fraction of the arena, keep gaps between beams/zones and
// are never placed under a player, so there is always safe floor and every hazard is warned first.
// Hit tests are plain geometry against player centres (no physics colliders); drones are unaffected.
(function () {
  const S = {
    hudTop: 44, // the arena floor starts below the HUD strip (matches physics world bounds in game.js)
    playerHalf: 12, // players are 24x24
    maxLevel: 3, // intensity levels 0..3, reached as the round progresses
    warnMs: [1500, 1400, 1300, 1200], // harmless warning time before a hazard turns lethal, per level
    minWarnMs: 1000,
    weights: [1, 1, 2, 3], // copies of each hazard type in scene.eventTypes (more copies = chosen more often)
    maxWeight: 3,
    graceMs: 1000, // after a cancelled knock-out (e.g. shield), the player has this long to escape
    lasers: {
      counts: [1, 2, 3, 4], maxCount: 4,
      sweepAmp: [0, 20, 25, 30], // px each side of the beam's home line; 0 = static beam
      sweepPeriodMs: 2600,
      thickness: 12,
      hitLeniency: 3, // px of forgiveness on each side of the beam
      staggerMs: 350, // beams switch on one after another
      minGap: 80, // free px between parallel beam bands
      wallGap: 50, // free px between a band and the arena edge
      playerClear: 28, // free px between a band and any player when the layout is chosen
      maxCover: 0.45, // max fraction of the arena any beam can ever reach (whole sweep bands)
      color: 0xff3355, warnColor: 0xff8899
    },
    zones: {
      cell: 40, minCells: 2, maxCells: 3,
      counts: [3, 4, 5, 6], maxCount: 6,
      gapCells: 1, // free cells between zones
      playerClear: 30, // free px between a zone and any player's box when the layout is chosen
      hitLeniency: 4, // player centre must be this far inside a zone to count as standing in it
      maxCover: 0.3,
      color: 0x5cc8ff, warnColor: 0xfff176
    }
  };
  const TYPES = ['lasers', 'zones'];

  // ---- pure logic (exported for tests) ----
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function arenaOf(c) { return { x: 0, y: S.hudTop, w: c.width, h: c.height - S.hudTop }; }

  function progressOf(elapsedMs, roundMs) { return roundMs > 0 ? clamp(elapsedMs / roundMs, 0, 1) : 0; }

  function levelFor(progress) {
    return clamp(Math.floor(clamp(progress, 0, 1) * (S.maxLevel + 1)), 0, S.maxLevel);
  }

  function intensity(level) {
    const l = clamp(level | 0, 0, S.maxLevel);
    return {
      level: l,
      warnMs: Math.max(S.minWarnMs, S.warnMs[l]),
      weight: Math.min(S.maxWeight, S.weights[l]),
      laserCount: Math.min(S.lasers.maxCount, S.lasers.counts[l]),
      sweepAmp: S.lasers.sweepAmp[l],
      zoneCount: Math.min(S.zones.maxCount, S.zones.counts[l])
    };
  }

  const bandHalf = b => b.thickness / 2 + b.amp;

  // Fraction of the arena that some beam can reach. Same-axis bands never overlap (minGap), so the
  // union is H*w + V*h - H*V where H/V are the summed band sizes per axis.
  function laserCover(beams, arena) {
    let H = 0, V = 0;
    for (const b of beams) (b.axis === 'h' ? (H += 2 * bandHalf(b)) : (V += 2 * bandHalf(b)));
    return (H * arena.w + V * arena.h - H * V) / (arena.w * arena.h);
  }

  function beamFits(beam, beams, arena, players) {
    const L = S.lasers, half = bandHalf(beam);
    for (const p of players) {
      const d = Math.abs((beam.axis === 'h' ? p.y : p.x) - beam.pos);
      if (d < half + S.playerHalf + L.playerClear) return false;
    }
    for (const b of beams) {
      if (b.axis === beam.axis && Math.abs(b.pos - beam.pos) - half - bandHalf(b) < L.minGap) return false;
    }
    return laserCover(beams.concat(beam), arena) <= L.maxCover;
  }

  function layoutLasers(rng, arena, players, level) {
    const L = S.lasers, it = intensity(level), beams = [];
    for (let i = 0; i < it.laserCount; i++) {
      for (let attempt = 0; attempt < 60; attempt++) {
        const axis = rng() < 0.5 ? 'h' : 'v';
        const beam = { axis, pos: 0, amp: it.sweepAmp, thickness: L.thickness,
          phase: rng() * Math.PI * 2, index: beams.length };
        const start = axis === 'h' ? arena.y : arena.x, size = axis === 'h' ? arena.h : arena.w;
        const lo = start + L.wallGap + bandHalf(beam), hi = start + size - L.wallGap - bandHalf(beam);
        if (hi <= lo) continue;
        beam.pos = lo + rng() * (hi - lo);
        if (beamFits(beam, beams, arena, players)) { beams.push(beam); break; }
      }
    }
    return beams; // may hold fewer beams than asked when no safe spot exists: safety beats intensity
  }

  // Where the beam line is at time `t` (ms since it went live); it stays inside its band.
  function beamPos(beam, t) {
    if (!beam.amp || t <= 0) return beam.pos;
    return beam.pos + beam.amp * Math.sin(beam.phase + 2 * Math.PI * t / S.lasers.sweepPeriodMs);
  }

  function beamHits(beam, linePos, x, y) {
    const d = Math.abs((beam.axis === 'h' ? y : x) - linePos);
    return d < beam.thickness / 2 + S.playerHalf - S.lasers.hitLeniency;
  }

  const zoneArea = z => z.w * z.h;
  function zoneCover(zones, arena) { return zones.reduce((n, z) => n + zoneArea(z), 0) / (arena.w * arena.h); }

  function zoneFits(zone, zones, arena, players) {
    const Z = S.zones, g = Z.gapCells * Z.cell;
    for (const p of players) {
      const r = S.playerHalf + Z.playerClear;
      if (p.x + r > zone.x && p.x - r < zone.x + zone.w && p.y + r > zone.y && p.y - r < zone.y + zone.h) return false;
    }
    for (const z of zones) {
      if (zone.x < z.x + z.w + g && zone.x + zone.w + g > z.x && zone.y < z.y + z.h + g && zone.y + zone.h + g > z.y) {
        return false;
      }
    }
    return zoneCover(zones.concat(zone), arena) <= Z.maxCover;
  }

  function layoutZones(rng, arena, players, level) {
    const Z = S.zones, it = intensity(level), zones = [], cell = Z.cell;
    const colMin = Math.ceil(arena.x / cell), colMax = Math.floor((arena.x + arena.w) / cell) - 1;
    const rowMin = Math.ceil(arena.y / cell), rowMax = Math.floor((arena.y + arena.h) / cell) - 1;
    const span = () => Z.minCells + Math.floor(rng() * (Z.maxCells - Z.minCells + 1));
    for (let i = 0; i < it.zoneCount; i++) {
      for (let attempt = 0; attempt < 80; attempt++) {
        const cw = span(), ch = span();
        const maxCol = colMax - cw + 1, maxRow = rowMax - ch + 1;
        if (maxCol < colMin || maxRow < rowMin) continue;
        const col = colMin + Math.floor(rng() * (maxCol - colMin + 1));
        const row = rowMin + Math.floor(rng() * (maxRow - rowMin + 1));
        const zone = { col, row, cw, ch, x: col * cell, y: row * cell, w: cw * cell, h: ch * cell, index: zones.length };
        if (zoneFits(zone, zones, arena, players)) { zones.push(zone); break; }
      }
    }
    return zones;
  }

  function zoneHits(zone, x, y) {
    const k = S.zones.hitLeniency;
    return x > zone.x + k && x < zone.x + zone.w - k && y > zone.y + k && y < zone.y + zone.h - k;
  }

  // Timeline relative to the event start: each hazard warns first, then turns lethal warnMs later.
  function schedule(type, items, startMs, warnMs) {
    items.forEach((item, i) => {
      item.warnAt = startMs + (type === 'lasers' ? i * S.lasers.staggerMs : 0);
      item.liveAt = item.warnAt + warnMs;
    });
    return items;
  }

  // ---- scene glue ----
  function state(scene) { return scene.hazardState; }

  function roundLevel(scene) {
    const roundMs = COIN_DASH.roundSeconds * 1000;
    const startedAt = scene.deadline - roundMs;
    return levelFor(progressOf(scene.time.now - startedAt, roundMs));
  }

  // Later in the round the hazard types get extra copies in eventTypes, so they are picked more often.
  function applyWeights(scene, level) {
    const want = intensity(level).weight;
    for (const type of TYPES) {
      let have = scene.eventTypes.filter(t => t === type).length;
      while (have < want) { scene.eventTypes.push(type); have++; }
    }
  }

  function cleanup(scene) {
    const st = state(scene);
    if (!st) return;
    for (const obj of st.objects) {
      if (scene.tweens) scene.tweens.killTweensOf(obj);
      if (obj.destroy) obj.destroy();
    }
    st.objects = [];
    st.items = [];
    st.type = null;
  }

  function track(scene, obj) { state(scene).objects.push(obj); return obj; }

  function flash(scene, obj) {
    scene.tweens.add({ targets: obj, alpha: 0.2, duration: 160, yoyo: true, repeat: -1 });
  }

  function buildLaserVisuals(scene, beam, arena) {
    const L = S.lasers, h = beam.axis === 'h';
    const band = 2 * bandHalf(beam);
    const cx = h ? arena.x + arena.w / 2 : beam.pos, cy = h ? beam.pos : arena.y + arena.h / 2;
    beam.band = track(scene, scene.add.rectangle(cx, cy, h ? arena.w : band, h ? band : arena.h, L.warnColor, 0.1)
      .setStrokeStyle(2, L.warnColor, 0.9).setDepth(1).setVisible(false));
    beam.core = track(scene, scene.add.rectangle(cx, cy, h ? arena.w : L.thickness, h ? L.thickness : arena.h,
      L.color, 0.35).setDepth(1).setVisible(false));
  }

  function buildZoneVisuals(scene, zone) {
    const Z = S.zones;
    zone.rect = track(scene, scene.add.rectangle(zone.x + zone.w / 2, zone.y + zone.h / 2, zone.w, zone.h,
      Z.warnColor, 0.12).setStrokeStyle(3, Z.warnColor, 1).setDepth(-1).setVisible(false));
  }

  function showWarning(scene, item) {
    for (const obj of item.type === 'lasers' ? [item.band, item.core] : [item.rect]) obj.setVisible(true);
    flash(scene, item.type === 'lasers' ? item.band : item.rect);
  }

  function goLive(scene, item) {
    if (item.type === 'lasers') {
      scene.tweens.killTweensOf(item.band);
      item.band.setAlpha(1).setFillStyle(S.lasers.color, 0.08).setStrokeStyle(1, S.lasers.color, 0.5);
      item.core.setFillStyle(S.lasers.color, 1).setAlpha(1);
    } else {
      scene.tweens.killTweensOf(item.rect);
      item.rect.setAlpha(1).setFillStyle(S.zones.color, 0.55).setStrokeStyle(3, 0xffffff, 0.9);
      scene.tweens.add({ targets: item.rect, alpha: 0.7, duration: 70, yoyo: true, repeat: -1 });
    }
  }

  function hit(scene, player, source) {
    const st = state(scene), now = scene.time.now;
    if ((st.grace.get(player) || 0) > now) return;
    scene.knockOut(player, source);
    if (!player.out) st.grace.set(player, now + S.graceMs); // knock-out was cancelled (e.g. shield)
  }

  const feature = {
    name: 'hazards',
    settings: S,

    create(scene) {
      scene.hazardState = { type: null, items: [], objects: [], grace: new Map(), level: 0 };
      for (const type of TYPES) if (!scene.eventTypes.includes(type)) scene.eventTypes.push(type);
      Object.assign(scene.eventBanners, { lasers: 'LASERS!', zones: 'ELECTRIC FLOOR!' });
      Object.assign(scene.eventLabels, { lasers: 'LASERS', zones: 'ELECTRIC' });
    },

    eventStarted(scene, type) {
      if (!TYPES.includes(type)) return;
      cleanup(scene);
      const st = state(scene), arena = arenaOf(COIN_DASH), level = roundLevel(scene);
      const players = scene.active();
      const items = type === 'lasers'
        ? layoutLasers(Math.random, arena, players, level)
        : layoutZones(Math.random, arena, players, level);
      schedule(type, items, scene.time.now, intensity(level).warnMs);
      for (const item of items) {
        item.type = type;
        item.state = 'idle';
        if (type === 'lasers') buildLaserVisuals(scene, item, arena); else buildZoneVisuals(scene, item);
      }
      Object.assign(st, { type, items, level });
    },

    update(scene) {
      const st = state(scene);
      if (!st || scene.finished) return;
      applyWeights(scene, roundLevel(scene));
      if (!st.type) return;
      const now = scene.time.now;
      for (const item of st.items) {
        if (item.state === 'idle' && now >= item.warnAt) { item.state = 'warning'; showWarning(scene, item); }
        if (item.state === 'warning' && now >= item.liveAt) { item.state = 'live'; goLive(scene, item); }
        if (item.state !== 'live') continue;
        if (item.type === 'lasers') {
          const line = beamPos(item, now - item.liveAt);
          if (item.axis === 'h') item.core.setY(line); else item.core.setX(line);
          for (const p of scene.active()) if (beamHits(item, line, p.x, p.y)) hit(scene, p, 'laser');
        } else {
          for (const p of scene.active()) if (zoneHits(item, p.x, p.y)) hit(scene, p, 'electric');
        }
        if (scene.finished) return;
      }
    },

    eventEnded(scene, type) { if (TYPES.includes(type)) cleanup(scene); },

    finished(scene) { cleanup(scene); },

    // Exposed for tests and other features.
    logic: { arenaOf, progressOf, levelFor, intensity, laserCover, layoutLasers, beamPos, beamHits,
      zoneCover, layoutZones, zoneHits, schedule, applyWeights, bandHalf }
  };

  (window.COIN_DASH_FEATURES = window.COIN_DASH_FEATURES || []).push(feature);
  if (typeof module !== 'undefined' && module.exports) module.exports = feature;
})();
