'use strict';
// ===== 战士实体:本地玩家 / 机器人 / 远程玩家 =====
let _fighterUid = 0;

class Fighter {
  constructor(o = {}) {
    this.id = o.id || ('f' + (++_fighterUid));
    this.kind = o.kind || 'bot';
    this.name = o.name || '战士';
    this.team = o.team || 'blue';
    this.gun = CFG.WEAPONS[o.gun] || CFG.WEAPONS.m249;
    this.tier = o.tier || null;          // 敌人品类:null / grunt / elite / heavy / sniper
    this.tagColor = o.tagColor || null;  // 名牌颜色(品类色)
    this.hpMax = o.hpMax || CFG.PLAYER.MAX_HP;
    this.speedMult = o.speedMult || 1;
    this.x = o.x !== undefined ? o.x : 400;
    this.y = o.y !== undefined ? o.y : Arena.groundY;
    this.vx = 0; this.vy = 0;
    this.w = o.w || CFG.PLAYER.W; this.h = o.h || CFG.PLAYER.H;
    this.scale = o.scale || 1;   // 体型缩放(巨型 BOSS)
    this.face = o.face !== undefined ? o.face : 1;
    this.aim = 0;
    this.mx = 0;                 // 水平移动意图 -1..1
    this.wantFire = false;
    this.wantReload = false;
    this.onGround = false;
    this.groundKind = null;      // 'ground' | 'platform' | 'crate'
    this.coyote = 0;
    this.jumpBuf = 0;
    this.dropThrough = 0;
    this.legPhase = 0;
    this.animT = rand(0, 10);
    this.moving = false;
    this.hp = this.hpMax;
    this.alive = true;
    this.respawnT = 0;
    this.protect = 0;
    this.ammo = this.gun.mag;
    this.heat = 0;               // 枪管热度(影响散布)
    this.fireCd = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.muzzleT = 0;
    this.kills = 0;
    this.deaths = 0;
    this.streak = 0;
    this.lastDmgT = -99;
    this.skill = o.skill !== undefined ? o.skill : 0.8;
    // 魂斗罗式增益
    this.tempGun = null;        // 限时武器(spread/laser)
    this.tempGunT = 0;
    this.invulT = 0;            // 无敌
  }

  get color() { return this.team === 'blue' ? CFG.COLORS.BLUE : CFG.COLORS.RED; }
  get dispColor() { return this.tagColor || this.color; }
  // 当前生效武器(限时强化优先)
  effGun() { return this.tempGunT > 0 && CFG.WEAPONS[this.tempGun] ? CFG.WEAPONS[this.tempGun] : this.gun; }

  updateCommon(dt) {
    this.animT += dt;
    this.muzzleT -= dt;
    this.protect -= dt;
    this.invulT -= dt;
    if (this.tempGunT > 0) {
      this.tempGunT -= dt;
      if (this.tempGunT <= 0) { this.tempGun = null; this.tempGunT = 0; if (this.kind === 'local') Sfx.reloadEnd(); }
    }
  }

  updatePhysics(dt, game) {
    // 水平
    const target = this.mx * CFG.MOVE_SPEED * this.speedMult;
    if (this.mx !== 0) {
      this.vx = approach(this.vx, target, (this.onGround ? CFG.ACCEL_GROUND : CFG.ACCEL_AIR) * dt);
    } else if (this.onGround) {
      this.vx = approach(this.vx, 0, CFG.FRICTION_GROUND * dt);
    }
    // 跳跃(土狼时间 + 输入缓冲)
    if (this.onGround) this.coyote = CFG.COYOTE; else this.coyote -= dt;
    this.jumpBuf -= dt;
    this.dropThrough -= dt;
    if (this.jumpBuf > 0 && this.coyote > 0 && this.dropThrough <= 0) {
      this.vy = -CFG.JUMP_VEL;
      this.jumpBuf = 0;
      this.coyote = 0;
      this.onGround = false;
    }
    this.vy = Math.min(1500, this.vy + CFG.GRAVITY * dt);
    // X 轴与边界(卷轴关卡用关卡总宽)
    this.x += this.vx * dt;
    if (this.x < 14) { this.x = 14; this.vx = Math.max(0, this.vx); }
    if (this.x > Arena.levelW - 14) { this.x = Arena.levelW - 14; this.vx = Math.min(0, this.vx); }
    // Y 轴与落点
    const prevY = this.y;
    this.y += this.vy * dt;
    this.onGround = false;
    this.groundKind = null;
    if (this.y >= Arena.groundY) {
      this.y = Arena.groundY;
      if (this.vy > 0) this.vy = 0;
      this.onGround = true;
      this.groundKind = 'ground';
    } else if (this.vy >= 0 && this.dropThrough <= 0) {
      for (const p of Arena.platforms) {
        if (this.x > p.x - 10 && this.x < p.x + p.w + 10 &&
            prevY <= p.y + 0.01 && this.y >= p.y) {
          this.y = p.y;
          this.vy = 0;
          this.onGround = true;
          this.groundKind = 'platform';
          break;
        }
      }
    }
    // 实体掩体(箱子/油桶):顶面可站、底面顶头、侧面挡人
    const top = this.y - this.h;
    const hw = this.w / 2;
    for (const s of Arena.solidBoxes()) {
      if (this.x + hw <= s.x || this.x - hw >= s.x + s.w) continue;
      if (this.y <= s.y || top >= s.y + s.h) continue;
      // 装甲车:直接碾碎掩体(箱子),不减速
      if (this.ram && game && Arena.crates.indexOf(s) >= 0) {
        game.breakCrate(s);
        continue;
      }
      if (prevY <= s.y + 0.01 && this.vy >= 0) {          // 从上方落下 → 站上
        this.y = s.y;
        this.vy = 0;
        this.onGround = true;
        this.groundKind = 'crate';
      } else if (prevY - this.h >= s.y + s.h - 0.01 && this.vy < 0) { // 从下方顶头
        this.y = s.y + s.h + this.h;
        this.vy = 0;
      } else {                                            // 横向推开
        const pushLeft = (this.x + 11) - s.x;
        const pushRight = (s.x + s.w) - (this.x - 11);
        if (pushLeft < pushRight) { this.x = s.x - 11; this.vx = Math.min(0, this.vx); }
        else { this.x = s.x + s.w + 11; this.vx = Math.max(0, this.vx); }
      }
    }
    this.moving = this.onGround && Math.abs(this.vx) > 30;
    this.legPhase += Math.abs(this.vx) * dt / 26;
  }

  startReload(near) {
    if (!this.reloading && this.ammo < this.effGun().mag) {
      this.reloading = true;
      this.reloadT = this.effGun().reload;
      if (near) Sfx.reloadStart();
    }
  }

  updateWeapon(dt, game) {
    const g = this.effGun();
    this.fireCd -= dt;
    this.heat = Math.max(0, this.heat - g.spreadCool * dt);
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloading = false;
        this.ammo = g.mag;
        if (this.kind === 'local') Sfx.reloadEnd();
      }
      return;
    }
    if (this.wantReload) this.startReload(this.kind === 'local');
    if (this.wantFire && this.fireCd <= 0) {
      if (this.ammo <= 0) {
        if (this.kind === 'local') Sfx.dry();
        this.startReload(this.kind === 'local');
      } else {
        Bullets.fire(game, this);
        this.ammo--;
        // 智商降低射速(仅机器人)
        const iq = this.kind !== 'local' && this.iq ? CFG.ENEMY_IQ[this.iq] : null;
        this.fireCd = 60 / (g.rpm * (iq ? iq.rpmMult : 1));
        this.heat = Math.min(1, this.heat + g.spreadPerShot);
        this.muzzleT = 0.05;
        if (this.protect > 0) this.protect = 0; // 开火解除保护
      }
    }
  }
}

// 本地玩家:读键鼠(支持辅助瞄准 / 坦克驾驶)
class LocalPlayer extends Fighter {
  constructor(o) { super(Object.assign({ kind: 'local' }, o)); this.mountedTank = null; }
  readInput(game) {
    const m = Input.mouse;
    const sh = Stickman.shoulder(this);
    const wx = m.x + (game.camX || 0); // 鼠标屏幕坐标 → 世界坐标(含摄像机)
    let aim = Math.atan2(m.y - sh.y, wx - sh.x);

    // ---- 坦克驾驶 ----
    if (this.mountedTank) {
      const t = this.mountedTank;
      t.aim = aim;
      t.face = Math.cos(aim) >= 0 ? 1 : -1;
      t.mx = (Input.down('KeyD') || Input.down('ArrowRight') ? 1 : 0) -
             (Input.down('KeyA') || Input.down('ArrowLeft') ? 1 : 0);
      t.wantFire = Input.mouse.down;
      this.x = t.x; this.y = t.y;
      this.aim = aim; this.face = t.face;
      this.assist = null;
      if (Input.jp('KeyE')) game.dismountTank(this);
      return;
    }
    if (Input.jp('KeyE')) game.tryMountTank(this);

    // ---- 辅助瞄准(仅 PVE) ----
    this.assist = null;
    if (game && game.aimAssist > 0 && game.mode !== 'online') {
      let best = null, bd = Infinity;
      for (const f of game.fighters) {
        if (!f.alive || f === this || f.team === this.team) continue;
        if (!Arena.losClear(sh.x, sh.y, f.x, f.y - 30)) continue;
        const a = Math.atan2(f.y - 30 - sh.y, f.x - sh.x);
        const off = Math.abs(angNorm(a - aim));
        const maxOff = game.aimAssist === CFG.AIM_ASSIST.LOCK ? Math.PI : CFG.AIM_ASSIST.CONE;
        if (off <= maxOff && off < bd) { bd = off; best = { f, a }; }
      }
      if (best) {
        if (game.aimAssist === CFG.AIM_ASSIST.LOCK) aim = best.a;
        else aim = aim + angNorm(best.a - aim) * CFG.AIM_ASSIST.BLEND * (1 - (bd / CFG.AIM_ASSIST.CONE) * 0.4);
        this.assist = { target: best.f, locked: game.aimAssist === CFG.AIM_ASSIST.LOCK };
      }
    }
    this.aim = aim;
    this.face = Math.cos(this.aim) >= 0 ? 1 : -1;
    this.mx = (Input.down('KeyD') || Input.down('ArrowRight') ? 1 : 0) -
              (Input.down('KeyA') || Input.down('ArrowLeft') ? 1 : 0);
    const downHeld = Input.down('KeyS') || Input.down('ArrowDown');
    const jumpPressed = Input.jp('Space') || Input.jp('KeyW') || Input.jp('ArrowUp');
    if (jumpPressed) {
      if (downHeld && this.groundKind === 'platform') {
        this.dropThrough = 0.22;  // 下穿平台
      } else {
        this.jumpBuf = CFG.JUMP_BUFFER;
      }
    }
    this.wantFire = Input.mouse.down;
    this.wantReload = Input.jp('KeyR');
    // 对局内换枪:数字键 1~7 直选,Q 循环(驾驶载具时不可换)
    if (game && !this.mountedTank) {
      for (let i = 1; i <= 9; i++) {          // 1~9 → 前 9 把
        if (Input.jp('Digit' + i)) game.trySwitchWeapon(this, i - 1);
      }
      if (Input.jp('Digit0')) game.trySwitchWeapon(this, 9);   // 0 → 第 10 把
      if (Input.jp('Minus')) game.trySwitchWeapon(this, 10);   // - → 第 11 把
      if (Input.jp('Equal')) game.trySwitchWeapon(this, 11);   // = → 第 12 把
      if (Input.jp('KeyQ')) game.cycleWeapon(this);
    }
  }
}

// 机器人:AI 控制(见 bots.js),支持品类 tier
class Bot extends Fighter {
  constructor(o) {
    const tier = o.tier ? CFG.ENEMY_TIERS[o.tier] : null;
    const iqDef = CFG.ENEMY_IQ[clamp(o.iq || 1, 1, 3)] || CFG.ENEMY_IQ[1];
    if (tier) {
      o = Object.assign({}, o, {
        gun: tier.gun,
        hpMax: tier.hp,
        speedMult: tier.speed * iqDef.speedMult, // 品类速度 × 智商速度
        tagColor: tier.color,
        name: tier.prefix + o.name,
      });
    } else {
      o = Object.assign({}, o, { speedMult: iqDef.speedMult });
    }
    super(Object.assign({ kind: 'bot' }, o));
    this.tier = o.tier || null;
    this.iq = clamp(o.iq || 1, 1, 3);
    this.activated = o.activated !== false; // 卷轴模式的驻守敌人需激活
    this.xpValue = tier ? tier.xp : CFG.XP_PER_KILL;
    if (tier) {
      this.hp = tier.hp;
      this.skill = clamp(this.skill + tier.skillBonus, 0, 0.97);
    }
    // 闯关小兵:一枪毙命(必须放在品类赋值之后)
    if (o.oneShot) {
      this.hpMax = 1;
      this.hp = 1;
    }
  }
}

// 远程玩家:快照插值渲染
// ===== 巨型兵 BOSS(魂斗罗式大体型人形 BOSS) =====
class GiantBoss extends Bot {
  constructor(o = {}) {
    const scale = o.scale || 2.1;
    super(Object.assign({
      tier: 'grunt',
      iq: 2,
      oneShot: false,
      gun: o.gun || 'm2',        // 重机枪
      scale,
      w: 22 * scale,             // 命中框随体型放大
      h: 54 * scale,
    }, o));
    this.boss = true;
    this.w = 22 * scale;
    this.h = 54 * scale;
    this.bossName = o.bossName || '巨型兵';
    this.hpMax = o.hp || 400;    // 关卡表指定血量
    this.hp = this.hpMax;
    this.tagColor = o.tagColor || '#ff8d5d';
    this.name = this.bossName;
  }
}

// ===== 坦克(玩家载具 / 敌方 BOSS) =====
class Tank extends Fighter {
  constructor(o = {}) {
    super(Object.assign({
      kind: 'tank',
      gun: 'm2',
      w: CFG.TANK.W, h: CFG.TANK.H,
      hpMax: o.isBoss ? CFG.TANK.BOSS_HP : CFG.TANK.PLAYER_HP,
      speedMult: ((o.speed !== undefined ? o.speed : CFG.TANK.SPEED) / CFG.MOVE_SPEED),
    }, o));
    this.shellRpm = o.shellRpm || CFG.TANK.SHELL_RPM;
    this.shellDmg = o.shellDmg || CFG.TANK.SHELL_DMG;
    this.bossName = o.bossName || '';
    this.w = o.w || CFG.TANK.W;
    this.h = o.h || CFG.TANK.H;
    this.hp = this.hpMax;
    this.isBoss = !!o.isBoss;
    this.driver = null;
    this.shellCd = 0;
    this.ai = null;
  }

  get color() { return this.isBoss ? '#c9a03c' : (this.team === 'blue' ? CFG.COLORS.BLUE : '#9aa7bd'); }

  updateTank(dt, game) {
    this.updateCommon(dt);
    this.shellCd -= dt;
    if (this.driver) {
      // 玩家驾驶(readInput 已写入 mx / aim / wantFire)
      this.updatePhysics(dt, game);
      if (this.wantFire && this.shellCd <= 0) {
        this.fireShell(game);
        this.shellCd = 60 / this.shellRpm;
      }
    } else if (this.isBoss) {
      this.bossAI(game, dt);
    } else {
      this.mx = 0; // 无人停放
      this.updatePhysics(dt, game);
    }
  }

  fireShell(game) {
    const a = this.aim;
    const cx = this.x + Math.cos(a) * this.w * 0.55;
    const cy = this.y - this.h * 0.55 + Math.sin(a) * 10;
    Bullets.list.push({
      x: cx, y: cy, px: cx, py: cy,
      vx: Math.cos(a) * CFG.TANK.SHELL_SPEED, vy: Math.sin(a) * CFG.TANK.SHELL_SPEED,
      dmg: this.shellDmg, blastR: CFG.TANK.SHELL_BLAST_R,
      explosive: true, fromTank: true,
      team: this.team, owner: this, life: 2.2, visual: false,
    });
    Particles.spark(cx, cy, a, 8);
    Particles.smoke(cx, cy);
    game.shake = Math.min(14, game.shake + (this.driver ? 4 : 2));
    Sfx.shoot(cx);
  }

  draw(ctx) {
    const x = this.x, y = this.y, w = this.w, h = this.h, face = this.face || 1;
    ctx.save();
    // 履带
    ctx.fillStyle = '#20242e';
    rrPath(ctx, x - w / 2, y - h * 0.34, w, h * 0.36, 8);
    ctx.fill();
    ctx.fillStyle = '#12151d';
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(x - w / 2 + 7 + i * ((w - 14) / 6), y - h * 0.3, 6, h * 0.28);
    }
    // 车体
    ctx.fillStyle = this.isBoss ? '#8a6f2c' : '#3f4a5e';
    rrPath(ctx, x - w / 2 + 4, y - h * 0.64, w - 8, h * 0.38, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fillRect(x - w / 2 + 8, y - h * 0.62, w - 16, 3);
    // 炮塔 + 炮管
    const tX = x + face * 4, tY = y - h * 0.64;
    ctx.fillStyle = this.isBoss ? '#a08534' : '#46536b';
    ctx.beginPath(); ctx.arc(tX, tY, h * 0.3, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#20242e';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(tX, tY);
    ctx.lineTo(tX + Math.cos(this.aim || 0) * w * 0.62, tY + Math.sin(this.aim || 0) * w * 0.62);
    ctx.stroke();
    // 队伍色条
    ctx.fillStyle = this.color;
    ctx.fillRect(x - w / 2 + 8, y - h * 0.5, 14, 3);
    // 血条 + 名牌
    const pct = clamp(this.hp / this.hpMax, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    rrPath(ctx, x - w / 2, y - h - 14, w, 6, 3); ctx.fill();
    ctx.fillStyle = pct > 0.4 ? '#ffd24a' : '#ff5d5d';
    rrPath(ctx, x - w / 2 + 1, y - h - 13, Math.max(2, (w - 2) * pct), 4, 2); ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillStyle = this.isBoss ? '#ffb45d' : 'rgba(255,255,255,0.75)';
    ctx.fillText(this.isBoss ? ('🛡 ' + (this.bossName || '坦克 BOSS')) : '坦克', x, y - h - 20);
    ctx.restore();
  }

  bossAI(game, dt) {
    if (!this.ai) this.ai = { dir: 1, dirT: rand(2, 3.5), fireT: rand(1, 2) };
    const ai = this.ai;
    const player = game.local;
    const stationary = this.speedMult <= 0.05; // 炮台:原地不移动
    if (stationary) {
      this.mx = 0;
    } else {
      ai.dirT -= dt;
      if (ai.dirT <= 0 || this.x < 300 || this.x > Arena.levelW - 300) {
        ai.dir = player && this.x > player.x ? -1 : 1;
        ai.dirT = rand(2, 3.5);
      }
      this.mx = ai.dir * 0.6;
    }
    this.updatePhysics(dt);
    if (!player || !player.alive) return;
    const d = dist(this.x, this.y, player.x, player.y);
    const lead = d / CFG.TANK.SHELL_SPEED;
    const tx = player.x + player.vx * lead + (Math.random() - 0.5) * 90; // 炮击误差:给玩家闪避空间
    const ty = player.y - 30 + player.vy * lead * 0.5 + (Math.random() - 0.5) * 40;
    this.aim = Math.atan2(ty - (this.y - this.h * 0.55), tx - this.x);
    this.face = Math.cos(this.aim) >= 0 ? 1 : -1;
    ai.fireT -= dt;
    if (ai.fireT <= 0 && d < 1500) {
      this.fireShell(game);
      ai.fireT = rand(1.6, 2.6);
    }
  }
}

// ===== 我方装甲车:速度快、机炮速射、可碾碎掩体 =====
class Apc extends Tank {
  constructor(o = {}) {
    super(Object.assign({
      hpMax: CFG.TANK.APC_HP,
      w: CFG.TANK.APC_W, h: CFG.TANK.APC_H,
      speed: CFG.TANK.APC_SPEED,
      shellRpm: CFG.TANK.APC_RPM,
      shellDmg: CFG.TANK.APC_DMG,
      bossName: '装甲车',
    }, o));
    this.ram = true;                 // 可碾碎掩体
    this.vehicleName = '装甲车';
    this.blastR = CFG.TANK.APC_BLAST_R;
  }

  fireShell(game) {
    const a = this.aim;
    const cx = this.x + Math.cos(a) * this.w * 0.55;
    const cy = this.y - this.h * 0.55 + Math.sin(a) * 10;
    Bullets.list.push({
      x: cx, y: cy, px: cx, py: cy,
      vx: Math.cos(a) * CFG.TANK.APC_SPEED_SHELL, vy: Math.sin(a) * CFG.TANK.APC_SPEED_SHELL,
      dmg: this.shellDmg, blastR: CFG.TANK.APC_BLAST_R,
      explosive: true, fromTank: true,
      team: this.team, owner: this, life: 2.2, visual: false,
    });
    Particles.spark(cx, cy, a, 5);
    game.shake = Math.min(14, game.shake + 1.5);
    Sfx.shoot(cx);
  }
}

class RemotePlayer extends Fighter {
  constructor(o) {
    super(Object.assign({ kind: 'remote' }, o));
    this.snaps = [];
    this._gotSnap = false;
    this.alive = false; // 收到首个快照后现身
  }
  pushSnap(d, now) {
    this.snaps.push({ t: now, x: d.x, y: d.y, vx: d.vx || 0, vy: d.vy || 0,
      a: d.a, f: d.f, g: d.g, m: d.m, r: d.r });
    if (this.snaps.length > 30) this.snaps.shift();
    if (!this._gotSnap) {
      this._gotSnap = true;
      this.alive = true;
      this.x = d.x; this.y = d.y;
    }
  }
  updateRemote(dt, now) {
    if (!this._gotSnap) return;
    const renderT = now - CFG.NET.INTERP_DELAY;
    while (this.snaps.length > 2 && this.snaps[1].t < renderT - 0.5) this.snaps.shift();
    const s = this.snaps;
    if (s.length === 0) return;
    let px = this.x, py = this.y;
    if (s.length === 1 || renderT <= s[0].t) {
      this.x = s[0].x; this.y = s[0].y;
      this._applySnap(s[0]);
    } else {
      let i = s.length - 2;
      for (let k = 0; k < s.length - 1; k++) {
        if (s[k].t <= renderT && renderT <= s[k + 1].t) { i = k; break; }
      }
      if (renderT >= s[s.length - 1].t) {
        // 超前:外推
        const last = s[s.length - 1], prev = s[s.length - 2];
        const vt = Math.max(0.001, last.t - prev.t);
        const extra = Math.min(0.1, renderT - last.t);
        this.x = last.x + (last.x - prev.x) / vt * extra;
        this.y = last.y + (last.y - prev.y) / vt * extra;
        this._applySnap(last);
      } else {
        const A = s[i], B = s[i + 1];
        const k = clamp((renderT - A.t) / Math.max(0.001, B.t - A.t), 0, 1);
        this.x = lerp(A.x, B.x, k);
        this.y = lerp(A.y, B.y, k);
        this._applySnap(k < 0.5 ? A : B);
      }
    }
    const moved = dist(px, py, this.x, this.y) / Math.max(dt, 0.001);
    if (this.moving) this.legPhase += moved * dt / 26;
  }
  _applySnap(s) {
    this.aim = s.a;
    this.face = s.f;
    this.onGround = !!s.g;
    this.moving = !!s.m;
    this.reloading = !!s.r;
    this.vx = s.vx; this.vy = s.vy;
  }
}
