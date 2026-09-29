'use strict';
// ===== 游戏主控 =====
class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = 'menu';
    this.paused = false;
    this.time = 0;
    this.fighters = [];
    this.local = null;
    this.stats = { shots: 0, hits: 0, kills: 0 };
    this.scores = { blue: 0, red: 0 };
    this.killfeed = [];
    this.announce = { who: '', text: '', color: '#fff', t: 0 };
    this.shake = 0;
    this.hitT = 0;
    this.hitHead = false;
    this.dmgFlash = 0;
    this.lastKiller = '';
    this.roundEndT = 0;
    this.roundTarget = CFG.ROUND_TARGET;
    this.campaign = null;                                   // 闯关状态
    this.profile = null;                                    // 玩家档案(来自服务器/本地)
    this.session = { kills: 0, deaths: 0, xp: 0, bestStreak: 0, stageCleared: 0 };
    this.camX = 0;                                          // 横向卷轴摄像机
    this.aimAssist = 1;                                     // 辅助瞄准 0/1/2
    this.pickups = [];                                      // 补给胶囊
    this.ui = null; // 菜单回调(main.js 注入)
  }

  // ---------- 开局 ----------
  reset() {
    this.fighters = [];
    Bullets.list.length = 0;
    Particles.list.length = 0;
    Corpses.list.length = 0;
    FloatTexts.list.length = 0;
    Arena.resetBarrels();
    this.camX = 0;
    this.pickups = [];
    this.killfeed = [];
    this.scores = { blue: 0, red: 0 };
    this.shake = 0;
    this.hitT = 0;
    this.dmgFlash = 0;
    this.lastKiller = '';
    this.roundEndT = 0;
    this.paused = false;
    this.stats = { shots: 0, hits: 0, kills: 0 };
    this.announce = { who: '', text: '', color: '#fff', t: 0 };
  }

  startSolo(opts) {
    this.reset();
    this.mode = 'solo';
    this.profile = opts.profile || null;
    Arena.buildClassic();
    const usedNames = new Set();
    const botName = () => {
      let n;
      do { n = pick(CFG.BOT_NAMES); } while (usedNames.has(n));
      usedNames.add(n);
      return n;
    };
    // 机器人智商档位:weak / medium / strong(默认 medium)
    const diff = CFG.BOT_SKILL[opts.difficulty] ? opts.difficulty : 'medium';
    const range = CFG.BOT_SKILL[diff];
    const skill = () => rand(range[0], range[1]);
    // 难度 → 智商:弱=新兵,中=老兵,强=精英
    const diffIq = { weak: 1, medium: 2, strong: 3 }[diff];
    // 本地玩家(蓝队,自选武器)
    this.local = new LocalPlayer({ name: opts.name || '你', team: 'blue', gun: opts.weapon });
    this.placeAtSpawn(this.local);
    this.fighters.push(this.local);
    // 队友机器人
    for (let i = 0; i < (opts.allies || 0); i++) {
      const b = new Bot({ name: botName(), team: 'blue', tier: 'grunt', skill: skill(), iq: diffIq });
      this.placeAtSpawn(b);
      this.fighters.push(b);
    }
    // 敌人机器人(普通兵品类)
    for (let i = 0; i < (opts.enemies || 2); i++) {
      const b = new Bot({ name: botName(), team: 'red', tier: 'grunt', skill: skill(), iq: diffIq });
      this.placeAtSpawn(b);
      this.fighters.push(b);
    }
    this.say('战斗开始!机器人智商:' + CFG.BOT_SKILL_LABEL[diff], '', '#7cff9c');
  }

  // ---------- 闯关模式 ----------
  startCampaign(stage, opts) {
    this.reset();
    this.mode = 'campaign';
    this.profile = opts.profile || null;
    this.campaign = {
      stage, lives: CFG.CAMPAIGN.LIVES,
      overlay: null, summary: null,          // 魂斗罗式结算界面:'clear' | 'fail'
      weapon: opts.weapon || 'm249',
      baseKills: this.session.kills, baseDeaths: this.session.deaths, baseXp: this.session.xp,
      bossStage: true,                       // 现在每一关都有专属 BOSS
      final: stage >= CFG.CAMPAIGN_TOTAL,    // 最终关
      bossX: 0, bossSpawned: false, bossDown: false,
      exitX: 0, levelW: 0,
      encounters: [], gates: [], scene: '',
    };
    this.local = new LocalPlayer({ name: opts.name || '你', team: 'blue', gun: opts.weapon });
    this.buildScrollLevel(stage);
    this.fighters.push(this.local);
    // 战场停放载具(第 3/6/9…关坦克,第 2/5/8…关装甲车),E 登载
    if (stage % 3 === 0) {
      this.fighters.push(new Tank({ x: Arena.W + 640, y: 830, team: 'blue', face: 1 }));
    } else if (stage % 3 === 2) {
      const apc = new Apc({ x: Arena.W + 640, y: 830, team: 'blue', face: 1 });
      this.fighters.push(apc);
    }
    this.say('第 ' + stage + ' 关 · ' + (this.campaign.scene || '推进!') , '', '#7cff9c');
  }

  // 生成横向卷轴关卡:分段地形 + 遭遇战 + 补给 + BOSS/撤离点
  buildScrollLevel(stage) {
    Arena.buildScroll(stage);
    const c = this.campaign;
    c.levelW = Arena.levelW;
    c.scene = Arena.sceneName(Arena.W * 0.5);
    c.exitX = Arena.levelW - CFG.SCROLL.EXIT_PAD;
    c.encounters = [];
    c.gates = [];
    this.pickups = [];
    const iq = stage <= 10 ? 1 : stage <= 30 ? 2 : 3; // 低/中/高:50 关分段爬坡
    const skill = clamp(0.3 + stage * 0.05, 0, 0.95);
    const mkDefs = () => {
      const n = Math.min(2 + Math.floor(stage / 12), 5); // 关卡越靠后敌人越多
      const arr = [];
      for (let i = 0; i < n; i++) {
        let tier = 'grunt';
        const roll = Math.random() + stage * 0.05;
        if (stage >= 9 && i === 0) tier = "heavy";
        else if (stage >= 4 && roll > 0.7) tier = 'elite';
        else if (stage >= 8 && roll > 0.72) tier = "sniper";
        arr.push({ tier, dx: rand(-260, 260), iq: clamp(iq + (Math.random() < 0.3 ? -1 : 0), 1, 3) });
      }
      return arr;
    };
    for (let s = 1; s < Arena.segCount; s++) {
      for (let k = 0; k < CFG.SCROLL.ENCOUNTERS_PER_SEG; k++) {
        const x = s * Arena.W + (k === 0 ? 520 : 1060) + rand(-70, 70);
        const enc = { x, defs: mkDefs(), spawned: false, open: false, ids: [] };
        enc.gate = { x: x - 90, active: false };
        c.gates.push(enc.gate);
        c.encounters.push(enc);
      }
    }
    // 沿途补给箱
    for (let s = 0; s < Arena.segCount; s++) {
      for (let k = 0; k < 3; k++) {
        const x = s * Arena.W + 320 + k * 460 + rand(-50, 50);
        const roll = Math.random();
        const def = roll < 0.45 ? { type: 'medkit' }
          : roll < 0.75 ? { type: 'ammo' }
          : { type: 'gun', gun: stage >= 3 ? 'laser' : 'spread' };
        this.pickups.push(Object.assign({ x, y: 806, taken: false, placed: true, bob: rand(0, 6) }, def));
      }
    }
    // 关底 BOSS + 战前补给
    if (c.bossStage) {
      c.bossX = c.levelW - 900;
      // BOSS 前补给点
      this.pickups.push({ x: c.bossX - 620, y: 806, taken: false, placed: true, bob: 1, type: "medkit" });
      this.pickups.push({ x: c.bossX - 520, y: 806, taken: false, placed: true, bob: 3, type: "ammo" });
      // BOSS 特供:RPG 胶囊(专克坦克;第 III 战区起给两枚)
      this.pickups.push({ x: c.bossX - 420, y: 806, taken: false, dropped: true, t: 0, vy: 0, type: "gun", gun: "rpg", icon: "R", color: "#ff9636" });
      if (stage >= 21) {
        this.pickups.push({ x: c.bossX - 330, y: 806, taken: false, dropped: true, t: 0, vy: 0, type: "gun", gun: "rpg", icon: "R", color: "#ff9636" });
      }
    }
  }

  spawnEncounter(e) {
    e.spawned = true;
    if (e.gate) e.gate.active = true;
    const c = this.campaign;
    const iq = c.stage <= 10 ? 1 : c.stage <= 30 ? 2 : 3;
    const skill = clamp(0.3 + c.stage * 0.05, 0, 0.95);
    for (const d of e.defs) {
      const b = new Bot({
        name: pick(CFG.BOT_NAMES), team: 'red', tier: d.tier, skill,
        iq: clamp(d.iq, 1, 3), activated: true,
        oneShot: true, // 闯关小兵:一枪毙命
      });
      b.x = e.x + d.dx;
      b.y = 830;
      b.leashX = e.x + d.dx; // 驻守点:不会追出太远
      this.fighters.push(b);
      e.ids.push(b.id);
    }
    this.say('⚠ 遭遇战!', '', '#ff8d5d');
    this.shake = Math.min(14, this.shake + 3);
  }

  // 魂斗罗式关卡结算界面:原地显示,等待玩家确认
  showStageOverlay(type) {
    const c = this.campaign;
    if (!c || c.overlay) return;
    c.overlay = type;
    c.summary = {
      kills: this.session.kills - c.baseKills,
      deaths: this.session.deaths - c.baseDeaths,
      xp: this.session.xp - c.baseXp,
      lives: c.lives,
      stage: c.stage,
    };
    // 立刻落库:通关进度保存 / 失败也保留已获得经验
    if (type === 'clear') {
      this.session.stageCleared = Math.max(this.session.stageCleared, c.stage);
    }
    this.flushProfile();
  }

  handleOverlay() {
    const c = this.campaign;
    const confirm = Input.jp('Space') || Input.jp('Enter');
    if (confirm) {
      const name = this.local ? this.local.name : '你';
      if (c.overlay === 'clear' && c.final) {
        this.leaveToMenu(); // 全部通关
      } else if (c.overlay === 'clear') {
        // 进入下一关(保留武器/经验/档案)
        this.startCampaign(c.stage + 1, { weapon: c.weapon, name, profile: this.profile });
      } else {
        // 失败重试本关
        this.startCampaign(c.stage, { weapon: c.weapon, name, profile: this.profile });
      }
      Sfx.ui();
    } else if (Input.jp('Escape')) {
      this.leaveToMenu();
    }
  }

  // 经验与档案
  awardXp(n) {
    if (!this.local) return;
    this.local.matchXp = (this.local.matchXp || 0) + n;
    this.session.xp += n;
  }
  localXp() {
    return (this.profile ? this.profile.xp : 0) + (this.local ? (this.local.matchXp || 0) : 0);
  }
  localLevel() {
    return CFG.levelFromXp(this.localXp());
  }
  flushProfile() {
    const s = this.session;
    if (!this.local) return;
    if (!s.kills && !s.deaths && !s.xp && !s.stageCleared) return;
    const name = this.local.name;
    Net.reportProfile(name, {
      addKills: s.kills, addDeaths: s.deaths, addXp: s.xp,
      bestStreak: s.bestStreak, stageCleared: s.stageCleared,
      weapon: this.local.gun.id, matchComplete: 1,
    }).then((p) => { if (p) this.profile = p; }).catch(() => {});
    this.session = { kills: 0, deaths: 0, xp: 0, bestStreak: 0, stageCleared: 0 };
  }

  startOnline(w, weapon) {
    this.reset();
    this.mode = 'online';
    Arena.buildClassic();
    this.local = new LocalPlayer({ id: w.id, name: w.name, team: w.team, gun: weapon });
    this.local.x = w.x; this.local.y = w.y;
    this.fighters.push(this.local);
    for (const p of w.players || []) {
      if (p.i === w.id) continue;
      this.fighters.push(new RemotePlayer({ id: p.i, name: p.n, team: p.tm }));
    }
    this.scores = { blue: w.blue || 0, red: w.red || 0 };
    this.sbPlayers = w.players || [];
    this.say('已加入房间 ' + w.room, '', '#7cff9c');
    this._wireNet();
  }

  leaveToMenu() {
    if (this.mode !== 'menu') this.flushProfile();
    if (this.mode === 'online') { Net.close(); Net.handlers = {}; }
    this.mode = 'menu';
    this.paused = false;
    this.local = null;
    this.campaign = null;
    this.camX = 0;
    this.pickups = [];
    Arena.buildClassic(); // 菜单背景恢复经典竞技场
    this.reset();
    Input.clear();
    if (this.ui) this.ui.showMenu(); // 任何退出路径都必须把菜单界面带回来
  }

  placeAtSpawn(f) {
    // 选离敌人最远、且不与队友堆叠的出生点
    let best = Arena.spawns[0], bestScore = -Infinity;
    for (const s of Arena.spawns) {
      let enemyD = Infinity, crowdD = Infinity;
      for (const o of this.fighters) {
        if (o === f || !o.alive) continue;
        const d = dist(s.x, s.y, o.x, o.y);
        if (o.team !== f.team) enemyD = Math.min(enemyD, d);
        else crowdD = Math.min(crowdD, d);
      }
      const score = (enemyD === Infinity ? 800 : enemyD) + rand(0, 120) +
                    (crowdD < 140 ? -600 : 0); // 有人占着就换点
      if (score > bestScore) { bestScore = score; best = s; }
    }
    f.x = best.x; f.y = best.y;
    f.face = best.x < Arena.W / 2 ? 1 : -1;
  }

  respawn(f) {
    this.placeAtSpawn(f);
    f.hp = f.hpMax;
    f.alive = true;
    f.protect = this.mode === "campaign" ? 2.5 : CFG.PROTECT;
    f.vx = 0; f.vy = 0;
    f.ammo = GUN.MAG;
    f.heat = 0;
    f.reloading = false;
    if (f === this.local) { Sfx.spawn(); this.dmgFlash = 0; }
  }

  // ---------- 帧驱动 ----------
  frame(dt) {
    this.update(dt);
    this.draw();
  }

  update(dt) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - this.shake * 8 * dt - 2 * dt);
    this.hitT -= dt;
    this.dmgFlash = Math.max(0, this.dmgFlash - 2.2 * dt);
    if (this.announce.t > 0) this.announce.t -= dt;
    // 击杀播报老化
    for (let i = this.killfeed.length - 1; i >= 0; i--) {
      this.killfeed[i].t += dt;
      if (this.killfeed[i].t > 4.5) this.killfeed.splice(i, 1);
    }
    // 氛围浮尘
    if (Math.random() < 0.05 && Particles.list.length < 80) Particles.dust();
    Particles.update(dt);
    Corpses.update(dt);
    FloatTexts.update(dt);

    if (this.mode === 'menu' || this.paused) return;

    // 关卡结算界面:冻结世界,只处理确认按键
    if (this.mode === 'campaign' && this.campaign && this.campaign.overlay) {
      this.handleOverlay();
      return;
    }

    const L = this.local;
    if (L && L.alive) L.readInput(this);

    // 摄像机(横向卷轴)
    if (this.mode === 'campaign' && Arena.levelW > Arena.W && L) {
      const target = clamp(L.x - Arena.W * 0.4, 0, Arena.levelW - Arena.W);
      this.camX += (target - this.camX) * Math.min(1, CFG.SCROLL.CAM_SMOOTH * dt);
    } else {
      this.camX = 0;
    }

    for (const f of this.fighters) {
      f.updateCommon(dt);
      if (f.kind === 'bot') updateBot(this, f, dt);
      if (f.kind === 'tank') {
        if (f.alive) f.updateTank(dt, this);
        continue;
      }
      if (f.kind === 'remote') {
        f.updateRemote(dt, this.time);
        continue;
      }
      if (f === L && f.mountedTank && f.alive) { // 乘车中:本体躲进坦克
        f.x = f.mountedTank.x; f.y = f.mountedTank.y;
        continue;
      }
      if (f.alive) {
        f.updatePhysics(dt, this);
        f.updateWeapon(dt, this);
      } else {
        f.respawnT -= dt;
        const canRespawn = this.mode === 'solo' ||
          (this.mode === 'campaign' && this.campaign &&
           this.campaign.lives > 0 && !this.campaign.overlay);
        if (f.respawnT <= 0 && canRespawn) this.respawn(f);
      }
      // 脱战回血(单人本地判定;联机由服务器结算)
      if (this.mode === 'solo' && f.alive && f.hp < f.hpMax &&
          this.time - f.lastDmgT > CFG.REGEN_DELAY) {
        f.hp = Math.min(f.hpMax, f.hp + CFG.REGEN_RATE * dt);
      }
    }

    // 补给胶囊
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (p.taken) { this.pickups.splice(i, 1); continue; }
      p.t = (p.t || 0) + dt;
      if (p.dropped) {
        p.vy = (p.vy || 0) + 1400 * dt;
        p.y += p.vy * dt;
        if (p.y > 806) { p.y = 806; p.vy = 0; }
        if (p.t > CFG.POWERUPS.DROP_TIME) { this.pickups.splice(i, 1); continue; }
      }
      if (L && L.alive && !L.mountedTank && dist(p.x, p.y, L.x, L.y - 24) < 38) {
        this.applyPickup(p);
        this.pickups.splice(i, 1);
      }
    }

    Bullets.update(this, dt);

    // 闯关流程(横向卷轴):遭遇战 / BOSS / 撤离通关 / 失败
    if (this.mode === 'campaign' && this.campaign) {
      const c = this.campaign;
      // 油桶重生
      for (const b of Arena.barrels) {
        if (!b.alive) {
          b.respawnT -= dt;
          if (b.respawnT <= 0) {
            b.alive = true;
            b.hp = Arena.BARREL_HP;
            Particles.shieldSpark(b.x + b.w / 2, b.y + b.h / 2);
          }
        }
      }
      if (c.overlay) {
        // 结算界面:世界冻结,等待玩家确认(见 handleOverlay)
      } else {
        // 触发遭遇战
        for (const e of c.encounters) {
          if (!e.spawned && L && L.alive && L.x > e.x - 720) this.spawnEncounter(e);
        }
        // 遭遇清空 → 开闸放行
        for (const e of c.encounters) {
          if (!e.spawned || e.open) continue;
          const anyAlive = e.ids.some(id => {
            const f = this.fighters.find(x => x.id === id);
            return f && f.alive;
          });
          if (!anyAlive) {
            e.open = true;
            e.gate.active = false;
            const bonus = 20 + c.stage * 4;
            this.awardXp(bonus);
            // 清区补给:回血 +40
            if (this.local && this.local.alive) {
              this.local.hp = Math.min(this.local.hpMax, this.local.hp + 80);
              FloatTexts.add('+80 生命', this.local.x, this.local.y - 80, { color: '#7cff7c', size: 15 });
            }
            this.say('区域清空!经验 +' + bonus + ' · 继续推进 →', '', '#7cff9c');
            this.fighters = this.fighters.filter(f => f.alive || f === this.local || f.kind === 'tank');
          }
        }
        // BOSS 出现:每关专属 BOSS(坦克型 / 固定炮台型)
        if (c.bossStage && !c.bossSpawned && L && L.alive && L.x > c.bossX - 1050) {
          c.bossSpawned = true;
          const bd = CFG.STAGES[clamp(c.stage - 1, 0, CFG.STAGES.length - 1)].boss;
          let boss;
          if (bd.kind === 'giant') {
            // 魂斗罗式巨型兵:体型 2.2 倍、重机枪压制
            boss = new GiantBoss({
              x: c.bossX, y: 830, team: 'red', face: -1,
              scale: 2.2, hp: bd.hp, bossName: bd.name, gun: 'm2', iq: 2,
              speedMult: Math.max(0.35, (bd.speed || 190) / CFG.MOVE_SPEED),
            });
            boss.leashX = c.bossX;   // 驻守 BOSS 区
            boss.activated = true;
            boss.tagColor = '#ff8d5d';
          } else {
            // 坦克 / 固定炮台:体型加大(120×56)
            boss = new Tank({
              x: c.bossX, y: 830, team: 'red', isBoss: true, face: -1, w: 120, h: 56,
              hpMax: bd.hp, shellRpm: bd.rpm, shellDmg: bd.dmg, speed: bd.speed, bossName: bd.name,
            });
          }
          this.fighters.push(boss);
          const defs = [];
          for (let k = 0; k < bd.escorts; k++) defs.push({ tier: k === 0 ? 'elite' : 'grunt', dx: -80 + k * 90, iq: 2 });
          this.spawnEncounter({ x: c.bossX + 260, defs, gate: null, ids: [] });
          this.say('⚠ BOSS「' + bd.name + '」出现!(' + ({ giant: '巨型兵', tank: '机动坦克', turret: '固定炮台' }[bd.kind] || 'BOSS') + ')', '', '#ff8d5d');
        }
        // 撤离点通关 → 原地弹出结算界面(不跳页面)
        const exitReady = !c.bossStage || c.bossDown;
        if (L && L.alive && L.x >= c.exitX && exitReady) {
          this.awardXp(CFG.CAMPAIGN.STAGE_BONUS_XP);
          this.showStageOverlay('clear');
          this.say('🚁 撤离成功!', '', '#7cff9c');
        }
      }
    }

    // 单人回合结束(目标击杀数)
    if (this.mode === 'solo') {
      // 油桶重生(联机由服务器广播 bspawn)
      for (const b of Arena.barrels) {
        if (!b.alive) {
          b.respawnT -= dt;
          if (b.respawnT <= 0) {
            b.alive = true;
            b.hp = Arena.BARREL_HP;
            Particles.shieldSpark(b.x + b.w / 2, b.y + b.h / 2);
          }
        }
      }
      this.recalcScores();
      if (this.roundEndT > 0) {
        this.roundEndT -= dt;
        if (this.roundEndT <= 0) {
          for (const f of this.fighters) { f.kills = 0; f.deaths = 0; this.respawn(f); }
          this.scores = { blue: 0, red: 0 };
          this.say('新回合开始!', '', '#7cff9c');
        }
      } else if (this.scores.blue >= this.roundTarget || this.scores.red >= this.roundTarget) {
        const blueWin = this.scores.blue >= this.roundTarget;
        this.roundEndT = 4;
        this.say(blueWin ? '蓝队获胜!' : '红队获胜!', '', blueWin ? CFG.COLORS.BLUE : CFG.COLORS.RED);
      }
    }

    // 联机:上报状态 + 心跳
    if (this.mode === 'online' && Net.open) {
      if (L && L.alive) Net.sendState(L, this.time);
      Net.tickNet(this.time);
    }
  }

  draw() {
    const ctx = this.ctx;
    const camX = this.camX || 0;
    // 清屏(黑边区域)
    ctx.setTransform(View.dpr, 0, 0, View.dpr, 0, 0);
    ctx.fillStyle = '#070a10';
    ctx.fillRect(0, 0, View.cssW, View.cssH);
    // 世界变换 + 屏幕震动 + 摄像机
    const sx = (Math.random() * 2 - 1) * this.shake;
    const sy = (Math.random() * 2 - 1) * this.shake;
    ctx.setTransform(View.dpr * View.scale, 0, 0, View.dpr * View.scale,
      View.dpr * ((View.ox + sx * View.scale) - camX * View.scale), View.dpr * (View.oy + sy * View.scale));
    ctx.save();
    ctx.beginPath();
    ctx.rect(camX, 0, Arena.W, Arena.H);
    ctx.clip();

    Arena.draw(ctx, this.time, camX);
    // 卷轴:闸门 / 补给箱 / 撤离点(世界坐标)
    if (this.mode === 'campaign' && this.campaign) {
      const c = this.campaign;
      for (const g of c.gates) {
        if (!g.active || g.x + 40 < camX - 60 || g.x > camX + Arena.W + 60) continue;
        const grad = ctx.createLinearGradient(g.x, 0, g.x + 34, 0);
        grad.addColorStop(0, 'rgba(255,70,70,0.32)');
        grad.addColorStop(1, 'rgba(255,70,70,0.06)');
        ctx.fillStyle = grad;
        ctx.fillRect(g.x, 0, 34, Arena.groundY);
        ctx.strokeStyle = 'rgba(255,120,120,0.7)';
        ctx.lineWidth = 2;
        ctx.strokeRect(g.x, 0, 34, Arena.groundY);
      }
      for (const p of this.pickups) {
        if (p.x < camX - 60 || p.x > camX + Arena.W + 60) continue;
        const bob = Math.sin(this.time * 3 + (p.bob || 0)) * 3;
        const py = p.y - 14 + bob;
        if (p.placed) { // 补给箱
          ctx.fillStyle = '#56503c';
          rrPath(ctx, p.x - 15, p.y - 22, 30, 24, 4); ctx.fill();
          ctx.strokeStyle = '#3a3524'; ctx.lineWidth = 2;
          rrPath(ctx, p.x - 15, p.y - 22, 30, 24, 4); ctx.stroke();
          ctx.fillStyle = p.type === 'medkit' ? '#ff6d6d' : p.type === 'gun' ? '#ffd24a' : '#ffd24a';
          if (p.type === 'medkit') ctx.fillRect(p.x - 8, p.y - 17, 16, 5), ctx.fillRect(p.x - 2.5, p.y - 22, 5, 16);
          else { ctx.fillRect(p.x - 7, p.y - 14, 14, 4); ctx.fillRect(p.x - 2, p.y - 19, 4, 14); }
        } else { // 掉落胶囊
          const a = p.t > CFG.POWERUPS.DROP_TIME - 2 ? (0.4 + 0.6 * Math.abs(Math.sin(this.time * 8))) : 1;
          ctx.globalAlpha = a;
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.beginPath(); ctx.arc(p.x + 1, py + 1, 13, 0, TAU); ctx.fill();
          ctx.fillStyle = p.color || '#fff';
          ctx.beginPath(); ctx.arc(p.x, py, 12, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.beginPath(); ctx.arc(p.x - 4, py - 4, 5, 0, TAU); ctx.fill();
          ctx.fillStyle = '#141a24';
          ctx.font = 'bold 14px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(p.icon || '?', p.x, py + 5);
          ctx.globalAlpha = 1;
        }
      }
      // 撤离点(直升机)
      if (c.exitX && (!c.bossStage || c.bossDown)) {
        const ex = c.exitX + 40;
        ctx.font = '30px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time * 3);
        ctx.fillText('🚁', ex, Arena.groundY - 60 + Math.sin(this.time * 2) * 6);
        ctx.globalAlpha = 1;
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(124,232,141,0.8)';
        ctx.fillText('撤离点', ex, Arena.groundY - 22);
      }
    }
    Corpses.draw(ctx);
    for (const f of this.fighters) {
      if (!f.alive) continue;
      if (f.kind === 'tank') { f.draw(ctx); continue; }
      if (f === this.local && f.mountedTank) continue; // 乘车中隐藏本体
      Stickman.draw(ctx, f);
      if (f !== this.local) Stickman.drawTag(ctx, f);
    }
    Bullets.draw(ctx);
    Particles.draw(ctx);
    FloatTexts.draw(ctx);
    ctx.restore();

    // HUD(不受震动影响)
    ctx.setTransform(View.dpr * View.scale, 0, 0, View.dpr * View.scale,
      View.dpr * View.ox, View.dpr * View.oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, Arena.W, Arena.H);
    ctx.clip();
    drawHUD(ctx, this);
    ctx.restore();
  }

  // ---------- 战斗结算 ----------
  applyHit(shooter, target, dmg, head, hx, hy, ang) {
    this.stats.hits++;
    if (target.protect > 0) { // 重生护盾
      Particles.shieldSpark(hx, hy);
      if (shooter === this.local) { this.hitT = 0.18; this.hitHead = false; }
      return;
    }
    // 闯关 PVE 平衡:机器人对玩家的伤害减半
    let d = dmg;
    if (this.mode === 'campaign' && target === this.local && shooter && shooter.kind === 'bot') {
      d = dmg * 0.35;
    }
    if (shooter === this.local) {
      this.hitT = 0.18;
      this.hitHead = head;
      head ? Sfx.headshot() : Sfx.hit();
      FloatTexts.add('-' + Math.round(dmg), hx, hy - 10,
        { color: head ? '#ff8d5d' : '#ffd76a', size: head ? 15 : 12, life: 0.55 });
    }
    if (this.mode === 'online') {
      // 联机:伤害由服务器结算,这里只做表现预测
      Net.sendHit(target.id, dmg, head, Math.round(hx), Math.round(hy));
    } else {
      Particles.blood(hx, hy, ang, 7);
      this.damage(target, d, shooter); // d:含闯关 PVE 减伤
    }
  }

  damage(target, dmg, killer) {
    if (!target.alive || target.invulT > 0) return; // 无敌护盾
    target.hp -= dmg;
    target.lastDmgT = this.time;
    if (target === this.local) {
      this.dmgFlash = Math.min(1, this.dmgFlash + dmg / 60 + 0.25);
      this.shake = Math.min(14, this.shake + 4);
      Sfx.hurt();
    }
    if (target.hp <= 0) this.kill(target, killer);
  }

  kill(victim, killer) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.deaths++;
    victim.streak = 0;
    victim.respawnT = CFG.RESPAWN;
    // 魂斗罗式掉落(死亡清空增益)
    if (victim.kind === 'bot' && this.mode !== 'online' && Math.random() < CFG.POWERUPS.DROP_CHANCE) {
      this.spawnDrop(victim.x, victim.y - 30);
    }
    if (victim === this.local) {
      victim.tempGun = null;
      victim.tempGunT = 0;
      victim.invulT = 0;
    }
    if (victim.mountedTank) this.dismountTank(victim); // 驾驶员阵亡 → 自动下车
    victim.reloading = false;
    victim.heat = 0;
    victim.wantFire = false;
    const dir = killer ? (Math.sign(victim.x - killer.x) || -victim.face) : -victim.face;
    Corpses.add(victim, dir);
    Particles.blood(victim.x, victim.y - 40, dir > 0 ? 0.5 : Math.PI - 0.5, 26);
    this.shake = Math.min(14, this.shake + (victim === this.local ? 9 : 3));
    Sfx.die(victim.x);
    if (killer && killer !== victim) {
      killer.kills++;
      killer.streak++;
      this.stats.kills++;
      Sfx.kill();
      this.addFeed(killer, victim, false);
      const s = killer.streak;
      if (s === 2) this.say('双杀!', killer.name, CFG.COLORS.BLUE);
      else if (s === 3) this.say('三连杀!!', killer.name, CFG.COLORS.RED);
      else if (s >= 4) this.say(s + ' 连杀 · 势不可挡!!', killer.name, '#ffd24a');
      if (killer === this.local) {
        // 击杀经验(品类越高越多)
        const xv = victim.xpValue || CFG.XP_PER_KILL;
        this.awardXp(xv);
        this.session.kills++;
        if (killer.streak > this.session.bestStreak) this.session.bestStreak = killer.streak;
        FloatTexts.add('+' + xv + ' XP', victim.x, victim.y - 96,
          { color: '#ffd24a', size: 13, life: 1 });
        FloatTexts.add('击杀 ' + victim.name, this.local.x, this.local.y - 92,
          { color: '#7cff7c', size: 16, life: 1 });
      }
    } else {
      this.addFeed(null, victim, false);
    }
    if (victim.boss && this.campaign && this.mode === 'campaign') {
      this.campaign.bossDown = true;
      this.awardXp(120);
      this.say('🛡 BOSS「' + (victim.bossName || victim.name) + '」被消灭!前往撤离点', '', '#7cff9c');
    }
    if (victim === this.local) {
      this.dmgFlash = 1;
      this.lastKiller = killer && killer !== victim ? killer.name : '';
      this.session.deaths++;
      // 闯关:扣生命,耗尽则弹出失败结算(原地重试/返回)
      if (this.mode === 'campaign' && this.campaign) {
        this.campaign.lives--;
        if (this.campaign.lives <= 0) {
          this.showStageOverlay('fail');
          this.say('关卡失败…', '', '#ff5d5d');
        }
      }
    }
  }

  // ---------- 油桶 / 爆炸 / 坦克 ----------
  hitBarrel(barrel, shooter, dmg, x, y) {
    Particles.spark(x, y, rand(0, TAU), 3);
    barrel.hp -= dmg;
    if (this.mode === 'online') {
      // 联机:是否爆炸由服务器 boom 广播决定
      Net.sendBarrelHit(barrel.id, dmg, x, y);
    } else if (barrel.hp <= 0) {
      this.explodeBarrel(barrel, shooter);
    }
  }

  boomFx(x, y) {
    Particles.explosion(x, y);
    this.shake = Math.min(14, this.shake + 10);
    Sfx.explosion(x);
  }

  // 统一爆炸:范围伤害(有掩体遮挡免伤)+ 油桶连锁 + 坦克减伤
  explosionAt(x, y, killer, r = 110, maxDmg = 55, src = 'rpg') {
    this.boomFx(x, y);
    for (const f of this.fighters) {
      if (!f.alive) continue;
      if (f.mountedTank) continue; // 车内玩家受车体保护(伤害打在装甲上)
      const d = dist(x, y, f.x, f.y - f.h / 2);
      if (d >= r) continue;
      if (!Arena.losClear(x, y, f.x, f.y - 20)) continue;
      let dmg = Math.round(maxDmg * (1 - (d / r) * 0.6));
      if (f.kind === 'tank') {
        // 载具对轰走穿甲倍率(否则机炮打不动 BOSS 坦克)
        let mult;
        if (src === 'rpg') mult = CFG.TANK.RPG_MULT;
        else if (src === 'tank') mult = f.isBoss ? CFG.TANK.VEHICLE_VS_BOSS : CFG.TANK.BOSS_VS_VEHICLE;
        else mult = CFG.TANK.BULLET_TAKEN;
        dmg = Math.max(1, Math.round(dmg * mult));
        f.hp -= dmg;
        if (killer === this.local) { this.hitT = 0.18; this.hitHead = false; }
        if (f.hp <= 0) this.tankDestroyed(f, killer);
      } else {
        this.damage(f, dmg, killer);
      }
    }
    for (const b of Arena.barrels) {
      if (!b.alive) continue;
      if (dist(x, y, b.x + b.w / 2, b.y + b.h / 2) < r + 40) this.explodeBarrel(b, killer);
    }
    // 爆炸可炸毁掩体(装甲车/RPG/炮弹)
    for (const c of Arena.crates) {
      if (c.broken) continue;
      if (dist(x, y, c.x + c.w / 2, c.y + c.h / 2) < r + c.w * 0.4) this.breakCrate(c);
    }
  }

  explodeBarrel(barrel, killer) { // 单人/本地权威
    if (!barrel.alive) return;
    barrel.alive = false;
    barrel.respawnT = Arena.BARREL_RESPAWN;
    this.explosionAt(barrel.x + barrel.w / 2, barrel.y + barrel.h / 2, killer, 110, 55, 'barrel');
  }

  // ---------- 对局内换枪 ----------
  weaponOrder() {   // 全部可选武器,按解锁等级排序(对应数字键顺序)
    return Object.keys(CFG.WEAPONS)
      .filter(id => !CFG.WEAPONS[id].temp)
      .sort((a, b) => CFG.WEAPONS[a].minLevel - CFG.WEAPONS[b].minLevel);
  }

  unlockedWeapons() {
    const lvl = this.localLevel();
    return this.weaponOrder().filter(id => CFG.WEAPONS[id].minLevel <= lvl);
  }

  setWeapon(f, id) {
    if (!f || !CFG.WEAPONS[id] || f.gun.id === id) return false;
    const g = CFG.WEAPONS[id];
    f.gun = g;
    f.ammo = g.mag;
    f.reloading = false;
    f.reloadT = 0;
    f.heat = 0;
    f.fireCd = Math.max(f.fireCd, 0.35);   // 换枪硬直
    if (f === this.local) {
      Sfx.reloadEnd();
      FloatTexts.add(g.name, f.x, f.y - 78, { color: '#7cc0ff', size: 14, life: 0.9 });
    }
    return true;
  }

  trySwitchWeapon(f, idx) {
    const list = this.unlockedWeapons();
    const id = list[idx];
    if (!id) {
      if (f === this.local) {
        Sfx.dry();
        FloatTexts.add('未解锁', f.x, f.y - 78, { color: '#ff8d8d', size: 12, life: 0.7 });
      }
      return false;
    }
    return this.setWeapon(f, id);
  }

  cycleWeapon(f) {
    const list = this.unlockedWeapons();
    if (!list.length) return false;
    const i = list.indexOf(f.gun.id);
    const next = list[(i + 1) % list.length];
    return this.setWeapon(f, next);
  }

  // ---------- 掩体摧毁(装甲车碾压 / 爆炸波及) ----------
  breakCrate(crate) {
    if (!Arena.breakCrate(crate)) return;
    const cx = crate.x + crate.w / 2, cy = crate.y + crate.h / 2;
    for (let i = 0; i < 8; i++) {
      const a = rand(-Math.PI, 0);
      Particles.spawn({
        type: 'chunk', x: cx + rand(-crate.w / 2, crate.w / 2), y: cy + rand(-crate.h / 2, crate.h / 2),
        vx: Math.cos(a) * rand(60, 260), vy: rand(-320, -80),
        g: 1300, size: rand(2, 4.5), spin: rand(-2, 2),
        color: crate.kind === 'ice' ? '#bfe0ff' : crate.kind === 'container' ? '#7a4a34' : '#6d5236',
        life: rand(0.5, 1),
      });
    }
    for (let i = 0; i < 4; i++) {
      Particles.spawn({ type: 'smoke', x: cx + rand(-14, 14), y: cy, vx: rand(-40, 40), vy: rand(-60, -20), size: rand(3, 6), life: rand(0.4, 0.8) });
    }
    this.shake = Math.min(14, this.shake + 4);
    Sfx.explosion(cx);
  }

  // ---------- 坦克 ----------
  hitTank(tank, shooter, dmg, hx, bullet) {
    let mult = CFG.TANK.BULLET_TAKEN;
    const gid = shooter && shooter.effGun ? shooter.effGun().id : '';
    if (bullet && bullet.pierceArmor) mult = 1.2;   // 等离子:破甲
    if (bullet && (bullet.explosive || gid === 'rpg')) mult = CFG.TANK.RPG_MULT;
    // 尾部油箱弱点:位于车尾(朝向的反方向)时 ×3
    if (tank.isBoss && (hx - tank.x) * tank.face < -tank.w * 0.15) mult = CFG.TANK.REAR_MULT;
    tank.hp -= Math.max(1, Math.round(dmg * mult));
    Particles.spark(hx, tank.y - tank.h / 2, Math.PI, 3);
    if (shooter === this.local) { this.hitT = 0.18; this.hitHead = false; Sfx.hit(); }
    if (tank.hp <= 0) this.tankDestroyed(tank, shooter);
  }

  tankDestroyed(tank, killer) {
    if (!tank.alive) return;
    tank.alive = false;
    this.explosionAt(tank.x, tank.y - 20, killer, 130, CFG.TANK.EXPLODE_DMG, 'tank');
    if (tank.driver) { // 玩家弹出
      const d = tank.driver;
      d.mountedTank = null;
      d.x = tank.x; d.y = tank.y;
      d.protect = 1;
      tank.driver = null;
    }
    if (tank.isBoss) {
      this.awardXp(120);
      if (this.campaign) this.campaign.bossDown = true;
      this.say('🛡 坦克 BOSS 被摧毁!前往撤离点', '', '#7cff9c');
    }
  }

  tryMountTank(local) {
    if (this.mode !== 'campaign' || local.mountedTank) return;
    const t = this.fighters.find(f =>
      f.kind === 'tank' && f.alive && !f.driver && !f.isBoss &&
      dist(local.x, local.y, f.x, f.y) < 85);
    if (t) {
      t.driver = local;
      t.team = 'blue';
      local.mountedTank = t;
      this.say('已登载' + (t.vehicleName || '坦克') + ' · 主炮左键 · E 下车', '', '#7cff9c');
      Sfx.spawn();
    }
  }

  dismountTank(local) {
    const t = local.mountedTank;
    if (!t) return;
    t.driver = null;
    t.mx = 0;
    t.wantFire = false;
    local.mountedTank = null;
    local.x = t.x; local.y = t.y;
  }

  // ---------- 补给胶囊(魂斗罗式) ----------
  spawnDrop(x, y) {
    const roll = Math.random();
    let def;
    if (roll < 0.4) def = CFG.POWERUPS.MEDKIT;
    else if (roll < 0.65) def = CFG.POWERUPS.SPREAD;
    else if (roll < 0.8) def = CFG.POWERUPS.LASER;
    else def = CFG.POWERUPS.INVUL;
    this.pickups.push({
      x, y: y - 10, vy: -170, taken: false, dropped: true, t: 0,
      type: def.type, gun: def.gun || null, icon: def.icon, color: def.color,
    });
  }

  applyPickup(p) {
    const L = this.local;
    if (!L) return;
    if (p.type === 'medkit') {
      L.hp = Math.min(L.hpMax, L.hp + 50);
      FloatTexts.add('+50 生命', L.x, L.y - 80, { color: '#7cff7c', size: 14 });
    } else if (p.type === 'ammo') {
      L.ammo = L.effGun().mag;
      L.reloading = false;
      FloatTexts.add('弹药补给', L.x, L.y - 80, { color: '#ffd24a', size: 14 });
    } else if (p.type === 'gun' && p.gun) {
      L.tempGun = p.gun;
      L.tempGunT = CFG.POWERUPS.GUN_TIME;
      const g = CFG.WEAPONS[p.gun];
      FloatTexts.add(g.icon + ' ' + g.name + '!', L.x, L.y - 80, { color: g.color, size: 16 });
    } else if (p.type === 'invul') {
      L.invulT = CFG.POWERUPS.INVUL_TIME;
      FloatTexts.add('◈ 无敌 ' + CFG.POWERUPS.INVUL_TIME + 's', L.x, L.y - 80, { color: '#c9a03c', size: 16 });
    }
    Sfx.spawn();
  }

  addFeed(killer, victim, head) {
    this.killfeed.push({
      k: killer ? killer.name : null,
      kc: killer ? (killer.dispColor || killer.color) : '#999',
      v: victim.name, vc: victim.dispColor || victim.color, head, t: 0,
    });
    if (this.killfeed.length > 6) this.killfeed.shift();
  }

  say(text, who, color) {
    this.announce = { who: who || '', text, color: color || '#fff', t: 1.6 };
  }

  recalcScores() {
    let b = 0, r = 0;
    for (const f of this.fighters) {
      if (f.team === 'blue') b += f.kills; else r += f.kills;
    }
    this.scores.blue = b;
    this.scores.red = r;
  }

  // 计分板行
  scoreRows() {
    if (this.mode === 'online') {
      return (this.sbPlayers || []).map(p => ({
        name: p.n, k: p.k, d: p.d,
        color: p.tm === 'blue' ? CFG.COLORS.BLUE : CFG.COLORS.RED,
        ping: p.i === Net.id ? Net.latency + 'ms' : '—',
        me: p.i === Net.id,
      })).sort((a, b) => b.k - a.k);
    }
    return this.fighters.map(f => ({
      name: f.name, k: f.kills, d: f.deaths, color: f.dispColor || f.color,
      ping: '—', me: f === this.local,
    })).sort((a, b) => b.k - a.k);
  }

  // ---------- 联机消息处理 ----------
  _wireNet() {
    const find = (id) => this.fighters.find(f => f.id === id);
    Net.handlers = {
      join: (d) => {
        if (find(d.p.i)) return;
        this.fighters.push(new RemotePlayer({ id: d.p.i, name: d.p.n, team: d.p.tm }));
        this.addFeedRaw(d.p.n + ' 加入战场', '#9ef2a6');
      },
      leave: (d) => {
        const i = this.fighters.findIndex(f => f.id === d.p);
        if (i >= 0) {
          this.addFeedRaw(this.fighters[i].name + ' 离开了', '#ffb08f');
          this.fighters.splice(i, 1);
        }
      },
      s: (d) => {
        const f = find(d.p);
        if (f && f.kind === 'remote') f.pushSnap(d, this.time);
      },
      shoot: (d) => {
        Bullets.spawnVisual(d.x, d.y, d.a);
        Sfx.remoteShoot(d.x);
      },
      hfx: (d) => { // 服务器确认的命中特效(所有客户端)
        if (d.prot) {
          Particles.shieldSpark(d.x, d.y);
        } else {
          Particles.blood(d.x, d.y, rand(0, TAU), 6);
        }
        if (d.tr === Net.id && !d.prot) {
          this.hitT = 0.18;
          this.hitHead = !!d.head;
          d.head ? Sfx.headshot() : Sfx.hit();
        }
      },
      dmg: (d) => { // 我被击中:服务器权威血量
        if (d.p === Net.id && this.local) {
          this.local.hp = d.hp;
          this.local.lastDmgT = this.time;
          this.dmgFlash = Math.min(1, this.dmgFlash + 0.45);
          this.shake = Math.min(14, this.shake + 4);
          Sfx.hurt();
        }
      },
      die: (d) => {
        const victim = find(d.v);
        if (!victim) return;
        const killer = d.k ? find(d.k) : null;
        this.kill(victim, killer);
      },
      respawn: (d) => {
        const f = find(d.p);
        if (!f) return;
        f.x = d.x; f.y = d.y;
        f.hp = CFG.PLAYER.MAX_HP;
        f.alive = true;
        f.protect = this.mode === "campaign" ? 2.5 : CFG.PROTECT;
        f.vx = 0; f.vy = 0;
        f.ammo = GUN.MAG;
        f.heat = 0;
        f.reloading = false;
        if (f === this.local) { Sfx.spawn(); this.dmgFlash = 0; }
      },
      score: (d) => {
        this.scores = { blue: d.b, red: d.r };
        this.sbPlayers = d.ps || [];
      },
      pong: (d) => { Net.latency = Date.now() - d.ts; },
      bfx: (d) => { // 有人打中油桶(火花反馈)
        Particles.spark(d.x, d.y, rand(0, TAU), 4);
      },
      boom: (d) => { // 服务器确认油桶爆炸
        const b = Arena.barrels.find(bb => bb.id === d.id);
        if (b) { b.alive = false; b.hp = 0; }
        this.boomFx(d.x, d.y);
      },
      bspawn: (d) => { // 油桶重生
        const b = Arena.barrels.find(bb => bb.id === d.id);
        if (b) {
          b.alive = true;
          b.hp = Arena.BARREL_HP;
          Particles.shieldSpark(b.x + b.w / 2, b.y + b.h / 2);
        }
      },
      close: () => {
        if (this.mode === 'online') {
          this.leaveToMenu();
          if (this.ui) { this.ui.showMenu(); this.ui.status('与服务器断开连接', true); }
        }
      },
    };
  }

  addFeedRaw(text, color) {
    this.killfeed.push({ k: text, kc: color, v: '', vc: color, head: false, t: 0, raw: true });
    if (this.killfeed.length > 6) this.killfeed.shift();
  }
}
