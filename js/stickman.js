'use strict';
// ===== 火柴人渲染 =====
const Stickman = {
  // 肩膀位置(武器挂点,与开火枪口计算保持一致;支持体型缩放 scale)
  shoulder(f) {
    const sc = f.scale || 1;
    const lean = clamp((f.vx || 0) / 700, -0.6, 0.6);
    return { x: f.x + (lean * 8 + f.face * 1.5) * sc, y: f.y - 45 * sc };
  },
  // 枪口世界坐标
  muzzle(f) {
    const sc = f.scale || 1;
    const s = this.shoulder(f);
    const c = Math.cos(f.aim), si = Math.sin(f.aim);
    return { x: s.x + c * 42 * sc, y: s.y + si * 42 * sc };
  },

  // 两段式肢体 IK:ax,ay 起点 / bx,by 终点,bend 弯曲方向
  limb(ctx, ax, ay, bx, by, bend, l1, l2) {
    let dx = bx - ax, dy = by - ay;
    let d = Math.hypot(dx, dy);
    const maxL = l1 + l2 - 0.5;
    if (d > maxL) { const s = maxL / d; dx *= s; dy *= s; bx = ax + dx; by = ay + dy; d = maxL; }
    d = Math.max(d, Math.abs(l1 - l2) + 0.5);
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const mx = ax + dx * (a / d), my = ay + dy * (a / d);
    const nx = -dy / d, ny = dx / d;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(mx + nx * h * bend, my + ny * h * bend);
    ctx.lineTo(bx, by);
    ctx.stroke();
    return { x: bx, y: by };
  },

  draw(ctx, f) {
    const x = f.x, y = f.y, face = f.face || 1;
    const main = f.color || f.teamColor || CFG.COLORS.BLUE;
    const dark = 'rgba(0,0,0,0.55)';
    const aim = f.aim || 0;

    ctx.save();
    ctx.globalAlpha = (f.alpha !== undefined ? f.alpha : 1);
    // 体型缩放(巨型 BOSS)
    const sc = f.scale || 1;
    if (sc !== 1) {
      ctx.translate(x, y);
      ctx.scale(sc, sc);
      ctx.translate(-x, -y);
    }
    // 死亡:整体向后倒下
    if (f.dead) {
      ctx.translate(x, y);
      ctx.rotate(-face * Math.min(1, f.deadT * 2.6) * 1.45);
      ctx.translate(-x, -y);
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // ---- 腿 ----
    const hipY = y - 26;
    let fA, fB;
    if (f.dead) {
      fA = { x: x - face * 11, y: y - 2 };
      fB = { x: x + face * 8, y: y - 5 };
    } else if (!f.onGround) {
      fA = { x: x + face * 10, y: y - 11 };
      fB = { x: x - face * 6, y: y - 3 };
    } else if (f.moving) {
      const ph = f.legPhase || 0;
      const sA = Math.sin(ph), sB = Math.sin(ph + Math.PI);
      fA = { x: x + face * sA * 12, y: y - Math.max(0, Math.sin(ph + Math.PI / 2)) * 5 };
      fB = { x: x + face * sB * 12, y: y - Math.max(0, Math.sin(ph + 3 * Math.PI / 2)) * 5 };
    } else {
      fA = { x: x + 6, y: y };
      fB = { x: x - 6, y: y };
    }
    ctx.strokeStyle = main;
    ctx.lineWidth = 4.5;
    this.limb(ctx, x, hipY, fA.x, fA.y, -face, 15, 15);
    this.limb(ctx, x, hipY, fB.x, fB.y, -face, 15, 15);

    // ---- 躯干 ----
    const sh = this.shoulder(f);
    ctx.strokeStyle = main;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, hipY);
    ctx.lineTo(sh.x, sh.y);
    ctx.stroke();

    // ---- 头 ----
    const hx = sh.x + face * 2, hy = sh.y - 9;
    ctx.beginPath();
    ctx.arc(hx, hy, 7.5, 0, TAU);
    ctx.fillStyle = '#151a24';
    ctx.fill();
    ctx.strokeStyle = main;
    ctx.lineWidth = 3;
    ctx.stroke();
    // 眼睛
    ctx.fillStyle = '#e8f0ff';
    ctx.beginPath();
    ctx.arc(hx + face * 3.2, hy - 1, 1.6, 0, TAU);
    ctx.fill();

    // ---- 枪 + 手臂 ----
    const reloadTilt = f.reloading ? 0.55 + Math.sin(f.animT * 18) * 0.07 : 0;
    const ga = aim + reloadTilt;
    const g0x = sh.x + Math.cos(ga) * 8, g0y = sh.y + Math.sin(ga) * 8;
    ctx.save();
    ctx.translate(g0x, g0y);
    ctx.rotate(ga);
    // 枪身
    ctx.fillStyle = '#232833';
    ctx.fillRect(-11, -3, 9, 6);                 // 枪托
    ctx.fillStyle = '#2e3442';
    rrPath(ctx, -2, -4, 23, 7, 2); ctx.fill();   // 机匣
    ctx.fillStyle = '#20242e';
    ctx.fillRect(20, -2.5, 14, 4);               // 枪管
    ctx.fillStyle = '#262c39';
    ctx.fillRect(6, 2, 7, 9);                    // 弹匣
    ctx.fillStyle = main;
    ctx.globalAlpha *= 0.9;
    ctx.fillRect(-2, -4, 23, 2);                 // 队伍色条
    ctx.globalAlpha = (f.alpha !== undefined ? f.alpha : 1);
    ctx.restore();
    // 双手握枪
    const hand1 = { x: g0x + Math.cos(ga) * 13 - Math.sin(ga) * 1, y: g0y + Math.sin(ga) * 13 + Math.cos(ga) * 1 };
    const hand2 = { x: g0x + Math.cos(ga) * 2 + Math.sin(ga) * 1, y: g0y + Math.sin(ga) * 2 - Math.cos(ga) * 1 };
    ctx.strokeStyle = dark;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(hand1.x, hand1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(hand2.x, hand2.y); ctx.stroke();

    // ---- 枪口火光 ----
    if (f.muzzleT > 0) {
      const m = { x: g0x + Math.cos(ga) * 36, y: g0y + Math.sin(ga) * 36 };
      ctx.fillStyle = 'rgba(255,210,110,0.3)';
      ctx.beginPath(); ctx.arc(m.x, m.y, 20, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffe9a3';
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(rand(0, TAU));
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? rand(10, 15) : rand(3, 5);
        const a = (i / 8) * TAU;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // ---- 重生护盾 / 无敌增益 ----
    if ((f.protect > 0 || f.invulT > 0) && !f.dead) {
      const pl = 0.5 + Math.sin(f.animT * 10) * 0.2;
      const col = f.invulT > 0 ? '255,200,80' : '130,205,255';
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.35 * pl + 0.25) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y - 30, 30 + Math.sin(f.animT * 6) * 2, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = f.invulT > 0 ? 'rgba(255,200,80,0.08)' : 'rgba(130,205,255,0.06)';
      ctx.fill();
    }

    ctx.restore();
  },

  // 头顶名字 + 小血条(非自己);智商星标
  drawTag(ctx, f) {
    const x = f.x, y = f.y;
    const sc = f.scale || 1;
    const tagY = y - 66 * sc;
    const stars = f.iq && CFG.ENEMY_IQ[f.iq] ? CFG.ENEMY_IQ[f.iq].stars + ' ' : '';
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(stars + f.name, x + 1, tagY + 1);
    ctx.fillStyle = f.dispColor || f.color || f.teamColor || CFG.COLORS.BLUE;
    ctx.fillText(stars + f.name, x, tagY);
    // 血条
    const bw = 36 * sc, bh = 4 * sc, bx = x - bw / 2, by = y - 60 * sc;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    rrPath(ctx, bx - 1, by - 1, bw + 2, bh + 2, 2); ctx.fill();
    const hpMax = f.hpMax || CFG.PLAYER.MAX_HP;
    if (hpMax <= 1) { ctx.restore(); return; } // 一击必杀的小兵不画血条
    const pct = clamp(f.hp / hpMax, 0, 1);
    ctx.fillStyle = pct > 0.5 ? '#5ddc6a' : pct > 0.25 ? '#ffd24a' : '#ff5d5d';
    if (pct > 0) { rrPath(ctx, bx, by, bw * pct, bh, 2); ctx.fill(); }
    ctx.restore();
  },
};
