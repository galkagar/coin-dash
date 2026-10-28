/* global COIN_DASH */
// Combo feature (per player).
// Rule: a coin collected within COMBO.windowMs of the same player's previous coin raises that
// player's multiplier by 1 (x1 -> x2 -> ... capped at x5). A coin after the window has expired
// starts again at x1. The combo expires COMBO.windowMs after the player's last coin and resets
// when the player is knocked out. The multiplier is applied in coinPoints by multiplying the
// incoming points, so it composes with other features' coinPoints.
(function () {
  const COMBO = {
    windowMs: 3000,
    maxMultiplier: 5,
    floatRise: 40, // px the "+N xM" text rises
    floatMs: 900,
    barWidth: 34,
    barHeight: 4,
    labelOffset: 26, // px above the player centre for the multiplier label
    depth: 3
  };

  const toCss = n => '#' + n.toString(16).padStart(6, '0');
  const now = scene => scene.time.now;

  function playerColor(scene, p) {
    const c = (typeof COIN_DASH !== 'undefined' && COIN_DASH.colors) || {};
    const i = scene.players ? scene.players.indexOf(p) : 0;
    const n = i === 1 ? c.player2 : c.player;
    return typeof n === 'number' ? n : 0xffffff;
  }

  function state(scene, p) {
    if (!scene.combos) scene.combos = new Map();
    let s = scene.combos.get(p);
    if (!s) {
      s = { multiplier: 0, lastAt: -Infinity, pending: null, label: null, bar: null, barBg: null };
      scene.combos.set(p, s);
    }
    return s;
  }

  function active(scene, s) {
    return s.multiplier > 0 && now(scene) - s.lastAt < COMBO.windowMs;
  }

  function reset(s) {
    s.multiplier = 0;
    s.lastAt = -Infinity;
    s.pending = null;
  }

  function makeUi(scene, p, s) {
    const color = playerColor(scene, p);
    s.label = scene.add.text(p.x, p.y - COMBO.labelOffset, '',
      { font: 'bold 13px monospace', color: toCss(color), stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5, 1).setDepth(COMBO.depth).setVisible(false);
    s.barBg = scene.add.rectangle(p.x, p.y - COMBO.labelOffset + 4, COMBO.barWidth, COMBO.barHeight,
      0x000000, 0.6).setOrigin(0.5, 0.5).setDepth(COMBO.depth).setVisible(false);
    s.bar = scene.add.rectangle(p.x - COMBO.barWidth / 2, p.y - COMBO.labelOffset + 4, COMBO.barWidth,
      COMBO.barHeight, color, 1).setOrigin(0, 0.5).setDepth(COMBO.depth).setVisible(false);
  }

  function updateUi(scene, p, s) {
    if (!s.label) return;
    const show = !p.out && active(scene, s);
    s.label.setVisible(show);
    s.barBg.setVisible(show);
    s.bar.setVisible(show);
    if (!show) return;
    const left = Math.max(0, COMBO.windowMs - (now(scene) - s.lastAt));
    const y = p.y - COMBO.labelOffset;
    s.label.setText(`x${s.multiplier} ${(left / 1000).toFixed(1)}s`).setPosition(p.x, y);
    s.barBg.setPosition(p.x, y + 4);
    s.bar.setPosition(p.x - COMBO.barWidth / 2, y + 4);
    s.bar.setScale(left / COMBO.windowMs, 1); // origin is the left edge, so it shrinks to the left
  }

  function floatText(scene, p, x, y, points, multiplier) {
    const msg = multiplier > 1 ? `+${points} x${multiplier}` : `+${points}`;
    const t = scene.add.text(x, y, msg,
      { font: 'bold 16px monospace', color: toCss(playerColor(scene, p)), stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5).setDepth(COMBO.depth);
    scene.tweens.add({ targets: t, y: y - COMBO.floatRise, alpha: 0, duration: COMBO.floatMs,
      ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  const feature = {
    name: 'combos',
    settings: COMBO,

    create(scene) {
      // create runs again on restart, so state starts fresh every round.
      scene.combos = new Map();
      for (const p of scene.players || []) makeUi(scene, p, state(scene, p));
    },

    // Works out the next multiplier and multiplies the incoming points; committed in coinCollected.
    coinPoints(scene, p, points) {
      if (scene.finished || p.out) return points;
      const s = state(scene, p);
      const next = active(scene, s) ? Math.min(COMBO.maxMultiplier, s.multiplier + 1) : 1;
      // The coin has not been moved yet, so this is where it was collected.
      const at = scene.coin ? { x: scene.coin.x, y: scene.coin.y } : { x: p.x, y: p.y };
      s.pending = { multiplier: next, x: at.x, y: at.y };
      return points * next;
    },

    coinCollected(scene, p, points) {
      const s = state(scene, p);
      const pend = s.pending || { multiplier: 1, x: p.x, y: p.y };
      s.pending = null;
      s.multiplier = pend.multiplier;
      s.lastAt = now(scene);
      if (scene.add && scene.tweens) floatText(scene, p, pend.x, pend.y, points, pend.multiplier);
    },

    // Only called while the round runs (game.js skips features once finished), so UI freezes.
    update(scene) {
      if (scene.finished) return;
      for (const p of scene.players || []) {
        const s = state(scene, p);
        if (p.out) reset(s); // knocked out (after any shield had its chance to cancel)
        else if (s.multiplier > 0 && !active(scene, s)) reset(s); // window expired
        updateUi(scene, p, s);
      }
    },

    // Read-only helpers (used by tests / other features).
    multiplier(scene, p) {
      const s = state(scene, p);
      return !p.out && active(scene, s) ? s.multiplier : 0;
    }
  };

  (window.COIN_DASH_FEATURES = window.COIN_DASH_FEATURES || []).push(feature);
})();
