// High scores and achievements: persistent bests (localStorage), end-of-round stats, achievement toasts.
// Two-player bests: the best single-player score ever (with the player slot that set it) and the best
// round total (P1 + P2). Achievements are shared by both players; the toast names who unlocked it.
(function () {
  const HS = {
    storageKey: 'coinDash.highscores.v1',
    toast: { ms: 2200, gap: 30, bottomMargin: 26, font: 'bold 16px monospace', depth: 20 },
    panel: { y: 426, width: 600, height: 132, font: '14px monospace', depth: 10 },
    achievements: [
      { id: 'firstCoin', title: 'First Coin', desc: 'Pick up a coin' },
      { id: 'coins10', title: 'Coin Hoarder', desc: '10 coins in one round' },
      { id: 'coins20', title: 'Coin Magnate', desc: '20 coins in one round' },
      { id: 'survive20', title: 'Still Standing', desc: 'Survive 20 seconds' },
      { id: 'surviveFull', title: 'Iron Runner', desc: 'Survive the full round' },
      { id: 'surviveEvent', title: 'Weathered It', desc: 'Survive an environment event' }
    ]
  };
  const byId = Object.fromEntries(HS.achievements.map(a => [a.id, a]));

  // ---- persistence (never throws; falls back to an in-memory copy if storage is unavailable) ----
  let memory = null;
  const blank = () => ({ bestPlayer: null, bestTotal: null, achievements: {}, rounds: 0 });
  function sanitize(d) {
    const out = blank();
    if (!d || typeof d !== 'object') return out;
    if (d.bestPlayer && typeof d.bestPlayer.score === 'number') out.bestPlayer = d.bestPlayer;
    if (typeof d.bestTotal === 'number') out.bestTotal = d.bestTotal;
    if (d.achievements && typeof d.achievements === 'object') out.achievements = d.achievements;
    if (typeof d.rounds === 'number') out.rounds = d.rounds;
    return out;
  }
  function storage() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }
  function load() {
    try {
      const s = storage();
      const raw = s && s.getItem(HS.storageKey);
      if (raw) { memory = sanitize(JSON.parse(raw)); return clone(memory); }
    } catch (e) { /* fall through to memory */ }
    return clone(memory || blank());
  }
  function save(data) {
    memory = clone(data);
    try { const s = storage(); if (s) s.setItem(HS.storageKey, JSON.stringify(data)); return true; } catch (e) { return false; }
  }
  function clone(d) { return JSON.parse(JSON.stringify(d)); }

  // ---- pure helpers (exposed for tests) ----
  const now = scene => (scene.time && typeof scene.time.now === 'number' ? scene.time.now : Date.now());
  function survivalSeconds(scene, p) {
    const st = scene.hsState, full = (window.COIN_DASH && COIN_DASH.roundSeconds) || 45;
    const t = p.out && st.outAt.has(p) ? st.outAt.get(p) : (scene.finished && st.endAt != null ? st.endAt : now(scene));
    return Math.min(full, Math.max(0, (t - st.start) / 1000));
  }
  // Returns { player: bool, total: bool } for which records were beaten; mutates data.
  function updateBests(data, players) {
    const res = { player: false, total: false };
    players.forEach((p, i) => {
      if (p.score > 0 && (!data.bestPlayer || p.score > data.bestPlayer.score)) {
        data.bestPlayer = { score: p.score, slot: i + 1, name: p.name };
        res.player = true;
      }
    });
    const total = players.reduce((n, p) => n + p.score, 0);
    if (total > 0 && (data.bestTotal == null || total > data.bestTotal)) { data.bestTotal = total; res.total = true; }
    data.rounds = (data.rounds || 0) + 1;
    return res;
  }

  // ---- runtime ----
  function unlock(scene, id, p) {
    const st = scene.hsState;
    if (!byId[id] || st.data.achievements[id]) return false;
    st.data.achievements[id] = { at: Date.now(), by: p ? p.name : null };
    st.newThisRound.push(id);
    save(st.data);
    if (!scene.finished) toast(scene, `${byId[id].title}! ${p ? '(' + p.name + ')' : ''}`.trim());
    return true;
  }

  // Toasts sit bottom-centre (HUDs are top-left/top-right, the event banner is centre at y≈170).
  function toast(scene, msg) {
    const c = window.COIN_DASH || { width: 800, height: 500 };
    const st = scene.hsState, t = HS.toast;
    if (!scene.add || !scene.add.text) return;
    const slot = st.toasts.length;
    const txt = scene.add.text(c.width / 2, c.height - t.bottomMargin - slot * t.gap, 'ACHIEVEMENT: ' + msg,
      { font: t.font, color: '#ffd166', backgroundColor: '#0a1120', padding: { x: 10, y: 4 } })
      .setOrigin(0.5).setDepth(t.depth);
    st.toasts.push(txt);
    const remove = () => {
      const i = st.toasts.indexOf(txt);
      if (i >= 0) st.toasts.splice(i, 1);
      if (txt.destroy) txt.destroy();
    };
    if (scene.tweens && scene.tweens.add) {
      scene.tweens.add({ targets: txt, alpha: 0, delay: t.ms, duration: 300, onComplete: remove });
    } else if (scene.time && scene.time.delayedCall) {
      scene.time.delayedCall(t.ms, remove);
    }
  }

  function noteKnockouts(scene) {
    const st = scene.hsState;
    for (const p of scene.players || []) {
      if (p.out && !st.outAt.has(p)) {
        st.outAt.set(p, now(scene));
        st.outBy.set(p, st.lastHit.get(p) || 'unknown');
      }
    }
  }

  function checkSurvival(scene) {
    const st = scene.hsState;
    for (const p of scene.players || []) {
      if (!p.out && survivalSeconds(scene, p) >= 20) unlock(scene, 'survive20', p);
    }
  }

  function outLabel(scene, p) {
    if (!p.out) return 'survived';
    const src = scene.hsState.outBy.get(p);
    return src === 'hole' ? 'hole' : src === 'drone' ? 'drone' : String(src || 'out');
  }

  function statsText(scene, bests) {
    const st = scene.hsState, d = st.data;
    const pad = (s, n) => String(s).padStart(n);
    const lines = ['            Score  Coins  Survived  Out by'];
    for (const p of scene.players) {
      lines.push(`${String(p.name).padEnd(10)}${pad(p.score, 7)}${pad(p.coins, 7)}`
        + `${pad(survivalSeconds(scene, p).toFixed(1) + 's', 10)}  ${outLabel(scene, p)}`);
    }
    const bp = d.bestPlayer ? `${d.bestPlayer.score} (P${d.bestPlayer.slot})` : '-';
    lines.push(`Best player: ${bp}${bests.player ? ' NEW BEST!' : ''}   `
      + `Best total: ${d.bestTotal == null ? '-' : d.bestTotal}${bests.total ? ' NEW BEST!' : ''}`);
    const got = Object.keys(d.achievements).filter(k => byId[k]).length;
    lines.push(st.newThisRound.length
      ? `New: ${st.newThisRound.map(id => byId[id].title).join(', ')}`
      : `Achievements: ${got}/${HS.achievements.length}`);
    return lines.join('\n');
  }

  const feature = {
    name: 'highscores',
    create(scene) {
      scene.hsState = {
        data: load(), start: now(scene), endAt: null, outAt: new Map(), outBy: new Map(),
        lastHit: new Map(), eventStartActive: null, newThisRound: [], toasts: [], bests: null
      };
    },
    playerHit(scene, p, source) {
      // Only record the source; another feature (e.g. a shield) may still cancel the knock-out.
      if (!scene.hsState) return;
      scene.hsState.lastHit.set(p, source === 'hole' ? 'hole' : 'drone');
    },
    coinCollected(scene, p) {
      if (!scene.hsState) return;
      if (p.coins >= 1) unlock(scene, 'firstCoin', p);
      if (p.coins >= 10) unlock(scene, 'coins10', p);
      if (p.coins >= 20) unlock(scene, 'coins20', p);
    },
    update(scene) {
      if (!scene.hsState) return;
      noteKnockouts(scene);
      checkSurvival(scene);
    },
    eventStarted(scene) {
      if (!scene.hsState) return;
      noteKnockouts(scene);
      scene.hsState.eventStartActive = new Set((scene.players || []).filter(p => !p.out));
    },
    eventEnded(scene) {
      const st = scene.hsState;
      if (!st) return;
      noteKnockouts(scene);
      for (const p of st.eventStartActive || []) if (!p.out) unlock(scene, 'surviveEvent', p);
      st.eventStartActive = null;
    },
    finished(scene, result) {
      const st = scene.hsState;
      if (!st || st.bests) return;
      noteKnockouts(scene);
      st.endAt = now(scene);
      if (!result || !result.allOut) {
        for (const p of scene.players) if (!p.out) unlock(scene, 'surviveFull', p);
      }
      checkSurvival(scene);
      st.bests = updateBests(st.data, scene.players);
      save(st.data);
      for (const t of st.toasts.slice()) if (t.destroy) t.destroy();
      st.toasts.length = 0;
      // Compact stats panel below the centre game-over panel (which spans y≈145..355).
      const c = window.COIN_DASH || { width: 800, height: 500 }, pn = HS.panel;
      if (!scene.add) return;
      scene.add.rectangle(c.width / 2, pn.y, pn.width, pn.height, 0x0a1120, 0.92).setDepth(pn.depth);
      st.panelText = scene.add.text(c.width / 2, pn.y, statsText(scene, st.bests),
        { font: pn.font, color: '#ffffff', align: 'left', lineSpacing: 6 }).setOrigin(0.5).setDepth(pn.depth + 1);
    },
    // Exposed for tests / debugging.
    _internals: { HS, load, save, updateBests, survivalSeconds, statsText, unlock,
      resetMemory() { memory = null; } }
  };
  (window.COIN_DASH_FEATURES = window.COIN_DASH_FEATURES || []).push(feature);
})();
