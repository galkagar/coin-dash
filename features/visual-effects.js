/* global Phaser, COIN_DASH */
// Visual effects: coin particles, knock-out bursts + screen shake, ambient animations
// (coin glow, player trails, drone glow), a colour-coded HUD bar and a nicer game-over panel.
// Purely cosmetic: it never changes scores, physics bodies or who gets knocked out.
(function () {
  const VFX = {
    hudBarHeight: 44,
    hudBarColor: 0x0a1120,
    hudBarAlpha: 0.85,
    timerWarnSeconds: 10,
    coinBurst: 16, // particles per collected coin
    hitBurst: 26, // particles per knock-out
    shake: { duration: 180, intensity: 0.008 }, // mild camera shake on knock-out
    trail: { frequency: 45, lifespan: 260 },
    depth: { fx: 4, hud: 6, panel: 20 },
    panel: { width: 460, height: 210 }
  };
  const hex = n => '#' + n.toString(16).padStart(6, '0');

  function makeTextures(scene) {
    const tex = scene.textures;
    if (!tex.exists('vfx-dot')) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
      g.generateTexture('vfx-dot', 8, 8);
      g.destroy();
    }
    if (!tex.exists('vfx-spark')) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1).fillRect(0, 0, 4, 4);
      g.generateTexture('vfx-spark', 4, 4);
      g.destroy();
    }
  }

  function createHud(scene, v) {
    const c = COIN_DASH;
    v.hudBar = scene.add.rectangle(c.width / 2, VFX.hudBarHeight / 2, c.width, VFX.hudBarHeight,
      VFX.hudBarColor, VFX.hudBarAlpha).setDepth(VFX.depth.hud - 1);
    v.hudLine = scene.add.rectangle(c.width / 2, VFX.hudBarHeight - 1, c.width, 2, 0x34445e, 1)
      .setDepth(VFX.depth.hud - 1);
    // scene.hud keeps the canonical "P1: x   P2: y" text (other features/tests read it); we hide
    // it and mirror it into two colour-coded texts.
    scene.hud.setAlpha(0).setDepth(VFX.depth.hud);
    const style = { font: 'bold 18px monospace', color: hex(c.colors.player), stroke: '#000000', strokeThickness: 3 };
    v.p1Text = scene.add.text(18, 12, '', style).setDepth(VFX.depth.hud);
    v.p2Text = scene.add.text(140, 12, '', Object.assign({}, style, { color: hex(c.colors.player2) }))
      .setDepth(VFX.depth.hud);
    scene.eventHud.setStyle({ font: 'bold 18px monospace', color: '#cdeeff', stroke: '#000000', strokeThickness: 3 })
      .setDepth(VFX.depth.hud);
    v.lastSeconds = null;
  }

  function syncHud(scene, v) {
    const text = String(scene.hud.text || '');
    const i = text.indexOf('P2:');
    const left = i >= 0 ? text.slice(0, i).replace(/\s+$/, '') : text;
    const right = i >= 0 ? text.slice(i) : '';
    if (v.p1Text.text !== left) v.p1Text.setText(left);
    if (v.p2Text.text !== right) v.p2Text.setText(right);
    v.p2Text.x = v.p1Text.x + v.p1Text.width + 28;
    const [p1, p2] = scene.players;
    v.p1Text.setAlpha(p1 && p1.out ? 0.55 : 1);
    v.p2Text.setAlpha(p2 && p2.out ? 0.55 : 1);
    const s = scene.secondsLeft;
    if (typeof s === 'number') {
      const warn = s <= VFX.timerWarnSeconds;
      scene.eventHud.setColor(warn ? '#ff8a9a' : '#cdeeff');
      if (warn && s !== v.lastSeconds && s > 0 && !scene.finished) {
        scene.tweens.add({ targets: scene.eventHud, scale: { from: 1.18, to: 1 }, duration: 260, ease: 'Quad.easeOut' });
      }
      v.lastSeconds = s;
    }
  }

  function createAmbient(scene, v) {
    const c = COIN_DASH;
    // Coin: a soft pulsing halo behind it (the coin itself is untouched so its hitbox never changes).
    v.coinGlow = scene.add.circle(scene.coin.x, scene.coin.y, 16, c.colors.coin, 0.28).setDepth(-0.5);
    scene.tweens.add({ targets: v.coinGlow, scale: { from: 0.8, to: 1.35 }, alpha: { from: 0.35, to: 0.08 },
      duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    v.coinRing = scene.add.ellipse(scene.coin.x, scene.coin.y, 26, 26).setStrokeStyle(2, 0xffffff, 0.55)
      .setDepth(-0.4);
    scene.tweens.add({ targets: v.coinRing, scaleX: { from: 1, to: 0.15 }, duration: 600, yoyo: true,
      repeat: -1, ease: 'Sine.easeInOut' }); // fake "spin"
    // Player trails.
    v.trails = scene.players.map(p => {
      const e = scene.add.particles(0, 0, 'vfx-dot', {
        lifespan: VFX.trail.lifespan, frequency: VFX.trail.frequency, quantity: 1,
        scale: { start: 1.6, end: 0.2 }, alpha: { start: 0.35, end: 0 },
        tint: p.fillColor, emitting: false
      }).setDepth(-0.3);
      e.startFollow(p);
      return e;
    });
    v.droneGlows = new Map();
  }

  function syncAmbient(scene, v, time) {
    if (v.coinGlow) { v.coinGlow.setPosition(scene.coin.x, scene.coin.y); v.coinRing.setPosition(scene.coin.x, scene.coin.y); }
    scene.players.forEach((p, i) => {
      const e = v.trails && v.trails[i];
      if (!e) return;
      const b = p.body;
      const moving = !p.out && b && (Math.abs(b.velocity.x) + Math.abs(b.velocity.y)) > 30;
      if (e.emitting !== moving) e.emitting = moving;
    });
    // Drone glow: follows every drone in the group, including ones other features add later.
    const drones = scene.drones && scene.drones.getChildren ? scene.drones.getChildren() : [];
    const seen = new Set();
    const pulse = 0.18 + 0.12 * Math.sin(time / 180);
    for (const d of drones) {
      seen.add(d);
      let glow = v.droneGlows.get(d);
      if (!glow) {
        glow = scene.add.rectangle(d.x, d.y, (d.width || 26) + 14, (d.height || 26) + 14,
          d.fillColor !== undefined ? d.fillColor : COIN_DASH.colors.drone, 0.25).setDepth(-0.2);
        v.droneGlows.set(d, glow);
      }
      glow.setPosition(d.x, d.y).setAlpha(d.active === false || d.visible === false ? 0 : pulse);
      glow.rotation = time / 900;
    }
    for (const [d, glow] of v.droneGlows) {
      if (!seen.has(d)) { glow.destroy(); v.droneGlows.delete(d); }
    }
  }

  function coinEffect(scene, v, player, points) {
    const c = COIN_DASH;
    const pos = v.coinPos || { x: player.x, y: player.y };
    v.coinPos = null;
    const e = scene.add.particles(pos.x, pos.y, 'vfx-dot', {
      speed: { min: 60, max: 190 }, lifespan: 420, scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 }, tint: [c.colors.coin, 0xffffff, player.fillColor], emitting: false
    }).setDepth(VFX.depth.fx);
    e.explode(VFX.coinBurst, pos.x, pos.y);
    scene.time.delayedCall(600, () => e.destroy());
    const label = scene.add.text(pos.x, pos.y - 10, `+${points}`, {
      font: 'bold 16px monospace', color: hex(player.fillColor), stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5).setDepth(VFX.depth.fx);
    scene.tweens.add({ targets: label, y: pos.y - 42, alpha: 0, duration: 650, ease: 'Quad.easeOut',
      onComplete: () => label.destroy() });
    // Halo pops at the new coin spot.
    if (v.coinGlow) scene.tweens.add({ targets: v.coinRing, alpha: { from: 0, to: 1 }, duration: 200 });
  }

  function knockOutEffect(scene, v, player, source) {
    const c = COIN_DASH;
    v.knocked.add(player);
    const x = player.x, y = player.y;
    const e = scene.add.particles(x, y, 'vfx-spark', {
      speed: { min: 90, max: 280 }, lifespan: 600, scale: { start: 1.6, end: 0 },
      alpha: { start: 1, end: 0 }, rotate: { min: 0, max: 360 },
      tint: [player.fillColor, source === 'hole' ? 0x02040a : c.colors.drone, 0xffffff], emitting: false
    }).setDepth(VFX.depth.fx);
    e.explode(VFX.hitBurst, x, y);
    scene.time.delayedCall(800, () => e.destroy());
    const flash = scene.add.circle(x, y, 18, 0xffffff, 0.85).setDepth(VFX.depth.fx);
    scene.tweens.add({ targets: flash, scale: 3, alpha: 0, duration: 280, ease: 'Quad.easeOut',
      onComplete: () => flash.destroy() });
    const ring = scene.add.circle(x, y, 20).setStrokeStyle(3, player.fillColor, 1).setDepth(VFX.depth.fx);
    scene.tweens.add({ targets: ring, scale: 2.6, alpha: 0, duration: 450, ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy() });
    // The player rectangle has no live body any more (knockOut disables it), so scaling is safe.
    if (source === 'hole') scene.tweens.add({ targets: player, scale: 0.45, angle: 160, duration: 420 });
    else scene.tweens.add({ targets: player, angle: 45, duration: 200 });
    if (scene.cameras && scene.cameras.main) scene.cameras.main.shake(VFX.shake.duration, VFX.shake.intensity);
  }

  function hideBasePanel(scene) {
    const c = COIN_DASH;
    for (const obj of scene.children.list.slice()) {
      if (obj.type === 'Rectangle' && obj.width === 480 && obj.height === 210
        && obj.x === c.width / 2 && obj.y === c.height / 2) obj.setVisible(false);
      if (obj.type === 'Text' && typeof obj.text === 'string' && obj.text.includes('Press R to play again')
        && obj !== scene.vfx.panelHint) obj.setVisible(false);
    }
  }

  function drawPanel(scene, v, result) {
    const c = COIN_DASH, W = VFX.panel.width, H = VFX.panel.height;
    const cx = c.width / 2, cy = c.height / 2;
    const [p1, p2] = scene.players;
    const winner = result.winner || null;
    const accent = winner ? winner.fillColor : c.colors.coin;
    const box = scene.make.graphics({ x: 0, y: 0 }, false);
    box.fillStyle(0x000000, 0.35).fillRoundedRect(-W / 2 + 4, -H / 2 + 6, W, H, 16);
    box.fillStyle(0x0a1120, 0.98).fillRoundedRect(-W / 2, -H / 2, W, H, 16);
    box.lineStyle(3, accent, 1).strokeRoundedRect(-W / 2, -H / 2, W, H, 16);
    const items = [box];
    const txt = (x, y, s, style) => {
      const t = scene.add.text(x, y, s, Object.assign({ font: '20px monospace', color: '#ffffff', align: 'center' }, style))
        .setOrigin(0.5);
      items.push(t);
      return t;
    };
    txt(0, -H / 2 + 28, result.reason || 'Round over', { font: 'bold 24px monospace', color: '#e5edf7' });
    const col = (p, label, x) => {
      const isWin = winner === p;
      const colour = hex(p.fillColor);
      txt(x, -24, `${label}${isWin ? ' ★' : ''}`, { font: 'bold 18px monospace', color: colour });
      txt(x, 8, `${p.score}`, { font: `bold ${isWin ? 38 : 30}px monospace`, color: isWin ? colour : '#c9d4e3' });
      txt(x, 36, `coin${p.score === 1 ? '' : 's'}${p.out ? ' · out' : ''}`, { font: '14px monospace', color: '#8a9bb5' });
    };
    if (p1) col(p1, 'P1', -110);
    if (p2) col(p2, 'P2', 110);
    txt(0, 8, 'vs', { font: '16px monospace', color: '#5d6f8c' });
    txt(0, H / 2 - 50, winner ? `${winner.name} wins!` : 'It\'s a tie!',
      { font: 'bold 22px monospace', color: hex(accent) });
    const hint = txt(0, H / 2 - 20, 'Press R to play again', { font: '16px monospace', color: '#cdeeff' });
    v.panelHint = hint;
    v.panel = scene.add.container(cx, cy, items).setDepth(VFX.depth.panel);
    v.panel.setScale(0.85).setAlpha(0);
    scene.tweens.add({ targets: v.panel, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });
    scene.tweens.add({ targets: hint, alpha: { from: 1, to: 0.35 }, duration: 700, yoyo: true, repeat: -1, delay: 300 });
  }

  const feature = {
    name: 'visual-effects',
    settings: VFX,

    create(scene) {
      const v = scene.vfx = { knocked: new Set(), pending: new Set(), coinPos: null, panel: null, panelHint: null };
      makeTextures(scene);
      createHud(scene, v);
      createAmbient(scene, v);
      syncHud(scene, v);
    },

    update(scene, time) {
      const v = scene.vfx;
      if (!v) return;
      syncHud(scene, v);
      syncAmbient(scene, v, time);
      // Catch knock-outs that bypass playerHit (shouldn't happen, but stay consistent).
      for (const p of scene.players) if (p.out && !v.knocked.has(p) && !v.pending.has(p)) knockOutEffect(scene, v, p, null);
    },

    // Not changing the value: just remember where the coin was before it is re-placed.
    coinPoints(scene, player, points) {
      if (scene.vfx && scene.coin) scene.vfx.coinPos = { x: scene.coin.x, y: scene.coin.y };
      return points;
    },

    coinCollected(scene, player, points) {
      if (scene.vfx) coinEffect(scene, scene.vfx, player, points);
    },

    // Another feature may cancel the hit (shield), so only show the effect once the player is
    // really out, checked right after knockOut has finished.
    playerHit(scene, player, source) {
      const v = scene.vfx;
      if (!v || v.knocked.has(player) || v.pending.has(player)) return;
      v.pending.add(player);
      scene.time.delayedCall(0, () => {
        v.pending.delete(player);
        if (player.out && !v.knocked.has(player)) knockOutEffect(scene, v, player, source);
      });
    },

    finished(scene, result) {
      const v = scene.vfx;
      if (!v) return;
      try { syncHud(scene, v); } catch (e) { /* HUD sync is cosmetic */ }
      (v.trails || []).forEach(e => { e.emitting = false; });
      hideBasePanel(scene);
      drawPanel(scene, v, result || {});
    }
  };

  (window.COIN_DASH_FEATURES = window.COIN_DASH_FEATURES || []).push(feature);
})();
