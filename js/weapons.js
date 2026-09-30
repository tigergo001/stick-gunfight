'use strict';
// ===== 机枪与子弹 =====
const GUN = CFG.GUN;

const Bullets = {
  list: [],
  beams: [],          // 光棱光束特效

  addBeam(x1, y1, x2, y2, color) {
    this.beams.push({ x1, y1, x2, y2, t: 0, life: 0.18, color: color || '#b98cff' });
  },

  // 真实开火(本地玩家 / 机器人)—— 使用当前生效武器(限时强化优先)
  fire(game, f) {
    const g = f.effGun();
    const pellets = g.pellets || 1;
    const m = Stickman.muzzle(f);
    for (let p = 0; p < pellets; p++) {
      const fan = pellets > 1 ? (p - (pellets - 1) / 2) * 0.09 : 0;
      const spread = g.spreadBase + f.heat * (g.spreadMax - g.spreadBase);
      const a = f.aim + fan + gauss() * spread;
      this.list.push({
        x: m.x, y: m.y, px: m.x, py: m.y,
        vx: Math.cos(a) * g.speed, vy: Math.sin(a) * g.speed,
        dmg: g.dmg,
        explosive: !!g.explosive, blastR: g.blastR || 0, blastDmg: g.blastDmg || 0,
        pierce: !!g.pierce, hitIds: g.pierce ? [] : null,
        chain: g.chain || 0, chainRange: g.chainRange || 0, chainFalloff: g.chainFalloff || 1,
        fuse: g.fuse || 0, pierceArmor: !!g.pierceArmor,
        burn: g.burn || null, slow: g.slow || null, knock: g.knock || 0,
        homing: !!g.homing, turn: g.turn || 0,
        color: g.id === 'laser' ? '#7ce8ff' : g.id === 'tesla' ? '#9fe8ff' : g.id === 'plasma' ? '#d9c0ff'
          : g.id === 'prism' ? '#b98cff' : g.id === 'spread' ? '#ffe28a'
          : g.id === 'grenade' ? '#c9e07a' : (g.explosive ? '#ff9636' : null),
        team: f.team, owner: f, life: g.range / g.speed, visual: false,
      });
    }
    // 后坐力
    f.vx -= Math.cos(f.aim) * g.recoil;
    f.vy -= Math.sin(f.aim) * g.recoil * 0.3;
    Particles.casing(m.x, m.y, f.face);
    if (Math.random() < 0.25) Particles.smoke(m.x, m.y);
    game.stats.shots++;
    Sfx.shoot(f.x);
    if (f.kind === 'local') Net.sendShoot(m.x, m.y, f.aim);
  },

  // 远程玩家的子弹只有表现效果,伤害由服务器结算
  spawnVisual(x, y, a) {
    this.list.push({
      x, y, px: x, py: y,
      vx: Math.cos(a) * GUN.SPEED, vy: Math.sin(a) * GUN.SPEED,
      team: null, owner: null, life: GUN.RANGE / GUN.SPEED, visual: true,
    });
  },

  update(game, dt) {
    // 光束老化
    for (let i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].t += dt;
      if (this.beams[i].t > this.beams[i].life) this.beams.splice(i, 1);
    }
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.px = b.x; b.py = b.y;
      // 追踪:朝最近的敌对目标缓慢转向
      if (b.homing && b.team !== null) {
        let best = null, bd = 900;
        for (const f of game.fighters) {
          if (!f.alive || f === b.owner || f.team === b.team) continue;
          const d = dist(b.x, b.y, f.x, f.y - 30);
          if (d < bd) { bd = d; best = f; }
        }
        if (best) {
          const cur = Math.atan2(b.vy, b.vx);
          const want = Math.atan2(best.y - 30 - b.y, best.x - b.x);
          const diff = angNorm(want - cur);
          const na = cur + clamp(diff, -b.turn * dt, b.turn * dt);
          const sp = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
          if (Math.random() < 0.5) Particles.smoke(b.x, b.y);
        }
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.life -= dt;

      let hitT = Infinity;
      let hitFn = null;
      // 命中环境
      for (const s of Arena._solids) {
        const t = segRectT(b.px, b.py, b.x, b.y, s.x, s.y, s.w, s.h);
        if (t !== null && t < hitT) {
          hitT = t;
          hitFn = () => {
            const hx = lerp(b.px, b.x, t), hy = lerp(b.py, b.y, t);
            if (b.explosive) game.explosionAt(hx, hy, b.owner, b.blastR, b.blastDmg, b.fromTank ? 'tank' : 'rpg');
            else Particles.spark(hx, hy, Math.atan2(b.vy, b.vx) + Math.PI, 4);
          };
        }
      }
      // 油桶(真实子弹才能点燃)
      if (!b.visual) {
        for (const br of Arena.barrels) {
          if (!br.alive) continue;
          const t = segRectT(b.px, b.py, b.x, b.y, br.x, br.y, br.w, br.h);
          if (t !== null && t < hitT) {
            const hx = lerp(b.px, b.x, t), hy = lerp(b.py, b.y, t);
            hitT = t;
            hitFn = () => {
              if (b.explosive) game.explosionAt(hx, hy, b.owner, b.blastR, b.blastDmg, b.fromTank ? 'tank' : 'rpg');
              else game.hitBarrel(br, b.owner, b.dmg, hx, hy);
            };
          }
        }
      }
      // 命中战士(真实子弹才结算;坦克独立判定)
      if (!b.visual) {
        for (const f of game.fighters) {
          if (!f.alive || f.team === b.team || f === b.owner) continue;
          if (f === game.local && f.mountedTank) continue; // 乘车中:命中坦克
          const isTank = f.kind === 'tank';
          const rw = f.w, rh = f.h;                 // 所有单位使用自身命中框
          const rx = f.x - rw / 2, ry = f.y - rh;
          const tb = segRectT(b.px, b.py, b.x, b.y, rx, ry, rw, rh);
          const sc = f.scale || 1;
          const th = (isTank || f.boss) ? null    // 坦克与巨型 BOSS 无爆头判定
            : segCircleT(b.px, b.py, b.x, b.y, f.x + f.face * 2, f.y - 54, 8);
          const t = Math.min(tb !== null ? tb : Infinity, th !== null ? th : Infinity);
          if (t === Infinity || t >= hitT) continue;
          if (b.explosive) {
            const tt = t;
            hitT = tt;
            hitFn = () => game.explosionAt(lerp(b.px, b.x, tt), lerp(b.py, b.y, tt),
              b.owner, b.blastR, b.blastDmg, b.fromTank ? 'tank' : 'rpg');
            continue;
          }
          const hx = lerp(b.px, b.x, t), hy = lerp(b.py, b.y, t);
          const head = th !== null && th <= (tb !== null ? tb : Infinity);
          const ang = Math.atan2(b.vy, b.vx);
          if (isTank) {
            hitT = t;
            hitFn = () => game.hitTank(f, b.owner, b.dmg, hx, b);
          } else if (b.pierce) {
            // 激光穿透:立即结算,同一目标只结算一次
            b.hitIds.push(f.id);
            game.applyHit(b.owner, f, b.dmg, head, hx, hy, ang);
            Particles.blood(hx, hy, ang, 3);
            continue; // 不截断子弹,继续找更早的目标
          } else if (b.chain > 0) {
            // 光棱枪:命中后在附近敌人之间折射连锁
            hitT = t;
            hitFn = () => {
              game.applyHit(b.owner, f, b.dmg, head, hx, hy, ang);
              this.addBeam(b.px, b.py, hx, hy, b.color || '#b98cff');
              let cur = f, dmg = b.dmg;
              const hitList = [f];
              for (let n = 1; n < b.chain; n++) {
                dmg *= b.chainFalloff;
                let next = null, nd = b.chainRange;
                for (const o of game.fighters) {
                  if (!o.alive || o.team === b.team || o === b.owner) continue;
                  if (hitList.indexOf(o) >= 0) continue;
                  const d = dist(cur.x, cur.y - 30, o.x, o.y - 30);
                  if (d < nd) { nd = d; next = o; }
                }
                if (!next) break;
                game.applyHit(b.owner, next, dmg, false, next.x, next.y - 30,
                  Math.atan2(next.y - cur.y, next.x - cur.x));
                this.addBeam(cur.x, cur.y - 30, next.x, next.y - 30, b.color || '#d9b6ff');
                hitList.push(next);
                cur = next;
              }
            };
          } else {
            hitT = t;
            hitFn = () => {
              game.applyHit(b.owner, f, b.dmg * (head ? (b.owner ? b.owner.effGun().headMult : 1.7) : 1),
                head, hx, hy, ang);
              if (b.burn) game.applyBurn(f, b.owner, b.burn.dps, b.burn.dur);
              if (b.slow) game.applySlow(f, b.slow.mult, b.slow.dur);
              if (b.knock) { // 音波击退
                const ka = Math.atan2(b.vy, b.vx);
                f.vx += Math.cos(ka) * b.knock;
                f.vy -= b.knock * 0.4;
              }
            };
          }
        }
      }
      if (hitFn) { hitFn(); list.splice(i, 1); continue; }
      if (b.life <= 0) {
        if (b.fuse && b.explosive) game.explosionAt(b.x, b.y, b.owner, b.blastR, b.blastDmg, 'rpg'); // 榴弹延时引爆
        list.splice(i, 1);
        continue;
      }
      if (b.x < -60 || b.x > Arena.levelW + 60 || b.y > Arena.H + 60) list.splice(i, 1);
    }
  },

  draw(ctx) {
    ctx.lineCap = 'round';
    // 光棱光束(外发光 + 亮芯)
    for (const bm of this.beams) {
      const k = 1 - bm.t / bm.life;
      ctx.strokeStyle = bm.color;
      ctx.globalAlpha = 0.28 * k;
      ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(bm.x1, bm.y1); ctx.lineTo(bm.x2, bm.y2); ctx.stroke();
      ctx.globalAlpha = 0.9 * k;
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(bm.x1, bm.y1); ctx.lineTo(bm.x2, bm.y2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const b of this.list) {
      const tx = b.x - b.vx * 0.016, ty = b.y - b.vy * 0.016;
      const laser = b.color === '#7ce8ff' || b.color === '#b98cff';
      ctx.strokeStyle = b.color === '#b98cff' ? 'rgba(185,140,255,0.95)' : b.color === '#7ce8ff' ? 'rgba(124,232,255,0.9)'
        : b.color === '#ffe28a' ? 'rgba(255,226,138,0.9)'
        : b.color === '#ff9636' ? 'rgba(255,150,54,0.95)'
        : 'rgba(255,215,106,0.85)';
      ctx.lineWidth = laser ? 4 : b.explosive ? 3.5 : 2.2;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lerp(tx, b.x, 0.4), lerp(ty, b.y, 0.4));
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  },
};
