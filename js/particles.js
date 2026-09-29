'use strict';
// ===== 粒子 / 尸体 / 飘字 =====
const Particles = {
  list: [],
  MAX: 700,

  spawn(o) {
    if (this.list.length >= this.MAX) this.list.shift();
    this.list.push(Object.assign({
      t: 0, life: 1, x: 0, y: 0, vx: 0, vy: 0, g: 0,
      size: 3, color: '#fff', type: 'dot', drag: 0,
      stain: false, stuck: false, spin: 0,
    }, o));
  },
  blood(x, y, dir, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = dir + rand(-0.7, 0.7);
      const sp = rand(80, 420);
      this.spawn({
        type: 'dot', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rand(0, 120),
        g: 1400, size: rand(1.5, 3.5),
        color: pick(['#c22222', '#a11111', '#e03333']),
        life: rand(0.5, 0.9), stain: true,
      });
    }
  },
  spark(x, y, dir, n = 5) {
    for (let i = 0; i < n; i++) {
      const a = dir + rand(-0.9, 0.9);
      const sp = rand(120, 380);
      this.spawn({
        type: 'line', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        drag: 6, size: rand(1, 2), color: pick(['#ffd76a', '#fff2c0', '#ff9d4a']),
        life: rand(0.12, 0.3),
      });
    }
  },
  shieldSpark(x, y) {
    for (let i = 0; i < 6; i++) {
      const a = rand(0, TAU);
      this.spawn({
        type: 'line', x, y,
        vx: Math.cos(a) * rand(60, 200), vy: Math.sin(a) * rand(60, 200),
        drag: 5, size: 1.5, color: '#8fd0ff', life: rand(0.15, 0.35),
      });
    }
  },
  casing(x, y, face) {
    this.spawn({
      type: 'casing', x, y,
      vx: -face * rand(60, 170), vy: -rand(150, 320),
      g: 1600, size: 3.2, color: '#d8b24a',
      spin: rand(-14, 14), life: rand(0.9, 1.5),
    });
  },
  smoke(x, y) {
    this.spawn({
      type: 'smoke', x, y,
      vx: rand(-14, 14), vy: rand(-40, -12),
      size: rand(2.5, 4.5), life: rand(0.4, 0.8),
    });
  },
  dust() { // 氛围浮尘
    this.spawn({
      type: 'dust', x: rand(0, Arena.W), y: rand(80, Arena.groundY),
      vx: rand(-7, 7), vy: -rand(4, 12),
      size: rand(1, 2.2), life: rand(4, 7),
    });
  },
  explosion(x, y) { // 油桶爆炸:闪光 + 冲击波 + 火花 + 碎片 + 烟 + 焦痕
    this.spawn({ type: 'flash', x, y, life: 0.18, size: 26 });
    this.spawn({ type: 'ring', x, y, life: 0.4, size: 10 });
    this.spark(x, y, rand(0, TAU), 18);
    for (let i = 0; i < 12; i++) {
      const a = rand(0, TAU), sp = rand(120, 480);
      this.spawn({
        type: 'chunk', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rand(60, 240),
        g: 1300, size: rand(2, 4.5), spin: rand(-2, 2),
        color: pick(['#3a3a3a', '#ff9d4a', '#ffd76a', '#6d5236']),
        life: rand(0.5, 1.1),
      });
    }
    for (let i = 0; i < 8; i++) {
      this.spawn({
        type: 'smoke', x: x + rand(-14, 14), y: y + rand(-14, 14),
        vx: rand(-30, 30), vy: rand(-90, -30),
        size: rand(5, 9), life: rand(0.6, 1.2),
      });
    }
    this.spawn({ type: 'scorch', x, y: Math.min(y + 40, Arena.groundY + 2), life: 9, size: rand(20, 30) });
  },

  update(dt) {
    const gy = Arena.groundY;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      if (p.t > p.life) { this.list.splice(i, 1); continue; }
      if (p.stuck) continue;
      p.vy += p.g * dt;
      if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // 落到地面或平台顶部
      if (p.vy > 0) {
        let land = -1;
        if (p.y >= gy) land = gy;
        else for (const pl of Arena.platforms) {
          if (p.x > pl.x && p.x < pl.x + pl.w && p.y >= pl.y) { land = pl.y; break; }
        }
        if (land >= 0) {
          if ((p.type === 'casing' || p.type === 'chunk') && Math.abs(p.vy) > 60) { // 弹壳/碎片弹跳
            p.y = land; p.vy *= -rand(0.3, 0.5); p.vx *= 0.7; p.spin *= 0.6;
          } else if (p.stain) { // 血渍留在地面
            p.stuck = true; p.y = land; p.vx = 0; p.vy = 0; p.g = 0;
            p.size *= 2.2; p.life = Math.min(p.life + rand(2, 4), 5);
          } else { p.y = land; p.vy = 0; p.vx *= 0.6; }
        }
      }
    }
  },
  draw(ctx) {
    for (const p of this.list) {
      const lr = 1 - p.t / p.life; // 剩余寿命比例
      ctx.globalAlpha = clamp(lr, 0, 1);
      if (p.type === 'dot') {
        ctx.fillStyle = p.color;
        if (p.stuck) {
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.size * 1.2, p.size * 0.45, 0, 0, TAU);
          ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
        }
      } else if (p.type === 'line') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
        ctx.stroke();
      } else if (p.type === 'casing') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin * p.t);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size, -p.size / 3, p.size * 2, p.size * 0.66);
        ctx.restore();
      } else if (p.type === 'chunk') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin * p.t * 6);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size, -p.size / 2, p.size * 2, p.size);
        ctx.restore();
      } else if (p.type === 'flash') {
        const k = p.t / p.life;
        ctx.fillStyle = 'rgba(255,' + ((190 - 90 * k) | 0) + ',80,' + (0.85 * (1 - k)) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + k * 4), 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,220,' + (0.9 * (1 - k)) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.5 * (1 + k * 2), 0, TAU); ctx.fill();
      } else if (p.type === 'ring') {
        const k = p.t / p.life;
        ctx.strokeStyle = 'rgba(255,230,180,' + (0.7 * (1 - k)) + ')';
        ctx.lineWidth = 3 * (1 - k) + 0.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size + k * 120, 0, TAU); ctx.stroke();
      } else if (p.type === 'scorch') {
        ctx.fillStyle = 'rgba(15,15,18,' + (0.4 * clamp((p.life - p.t) / 3, 0, 1)) + ')';
        ctx.beginPath(); ctx.ellipse(p.x, p.y, p.size, p.size * 0.35, 0, 0, TAU); ctx.fill();
      } else if (p.type === 'smoke') {
        ctx.fillStyle = 'rgba(170,175,190,0.22)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + p.t * 3), 0, TAU);
        ctx.fill();
      } else if (p.type === 'dust') {
        ctx.fillStyle = 'rgba(160,190,230,0.15)';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  },
};

// 尸体(死亡瞬间快照,倒地渐隐)
const Corpses = {
  list: [],
  add(f, dir) {
    if (this.list.length >= 12) this.list.shift();
    this.list.push({
      x: f.x, y: f.y, face: dir || f.face, aim: f.aim,
      teamColor: f.color, animT: f.animT, scale: f.scale || 1, t: 0, life: 3.5,
    });
  },
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      this.list[i].t += dt;
      if (this.list[i].t > this.list[i].life) this.list.splice(i, 1);
    }
  },
  draw(ctx) {
    for (const c of this.list) {
      ctx.save();
      ctx.globalAlpha = clamp((c.life - c.t) / 0.8, 0, 1);
      // 血泊
      const pool = Math.min(1, c.t * 1.6);
      ctx.fillStyle = 'rgba(140,20,20,0.35)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + 2, 14 + 16 * pool, 4 + 4 * pool, 0, 0, TAU);
      ctx.fill();
      Stickman.draw(ctx, {
        x: c.x, y: c.y, face: c.face, aim: c.aim, vx: 0, legPhase: 0,
        onGround: true, moving: false, teamColor: c.teamColor, scale: c.scale || 1,
        dead: true, deadT: c.t, animT: c.animT,
      });
      ctx.restore();
    }
  },
};

// 漂浮文字(伤害数字 / 击杀提示)
const FloatTexts = {
  list: [],
  add(text, x, y, opts = {}) {
    if (this.list.length >= 40) this.list.shift();
    this.list.push(Object.assign({
      text, x, y, vx: rand(-10, 10), vy: -55, life: 0.8, t: 0,
      size: 13, color: '#fff', bold: true,
    }, opts));
  },
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.t += dt;
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.vy *= 1 - 1.5 * dt;
      if (f.t > f.life) this.list.splice(i, 1);
    }
  },
  draw(ctx) {
    ctx.textAlign = 'center';
    for (const f of this.list) {
      ctx.globalAlpha = clamp(1.6 * (1 - f.t / f.life), 0, 1);
      ctx.font = (f.bold ? 'bold ' : '') + f.size + 'px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(f.text, f.x + 1, f.y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  },
};
