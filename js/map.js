'use strict';
// ===== 竞技场/关卡地图:经典单屏 + 横向卷轴两种模式 =====
const Arena = {
  W: CFG.WORLD.W,
  H: CFG.WORLD.H,
  groundY: 830,
  BARREL_HP: 30,
  BARREL_RESPAWN: 25,

  init() {
    this.buildClassic();
  },

  // ---- 经典单屏(单人练习 / 联机) ----
  buildClassic() {
    this.levelW = this.W;
    this.segCount = 1;
    this.theme = CFG.SCENES[0];
    this.segThemes = [this.theme.name];
    this.platforms = [
      { x: 610, y: 690, w: 380, h: 22 },
      { x: 130, y: 560, w: 280, h: 22 },
      { x: 1190, y: 560, w: 280, h: 22 },
      { x: 660, y: 470, w: 280, h: 22 },
      { x: 360, y: 350, w: 200, h: 22 },
      { x: 1040, y: 350, w: 200, h: 22 },
    ];
    this.crates = [
      { x: 240, y: 770, w: 60, h: 60 },
      { x: 430, y: 770, w: 60, h: 60 },
      { x: 430, y: 710, w: 60, h: 60 },
      { x: 990, y: 760, w: 70, h: 70 },
      { x: 1310, y: 770, w: 60, h: 60 },
    ];
    this.barrels = [
      { id: 'b1', x: 585, y: 784, w: 36, h: 46 },
      { id: 'b2', x: 1130, y: 784, w: 36, h: 46 },
    ];
    this.spawns = [
      { x: 80, y: 830 }, { x: 1520, y: 830 },
      { x: 270, y: 560 }, { x: 1330, y: 560 },
      { x: 800, y: 470 },
      { x: 460, y: 350 }, { x: 1140, y: 350 },
      { x: 680, y: 830 }, { x: 920, y: 830 },
    ];
    this.lamps = [345, 1255];
    this.trees = [[520, 46, 96], [665, 34, 74], [1122, 40, 84], [1440, 30, 66]];
    this.finishBuild();
  },

  // ---- 横向卷轴关卡(闯关模式):按关卡生成 3~5 段 ----
  buildScroll(stage) {
    const sdef = CFG.STAGES[clamp(stage - 1, 0, CFG.STAGES.length - 1)];
    this.theme = CFG.SCENES[sdef.scene] || CFG.SCENES[0];
    this.chapter = sdef.chapter || 0; // 战区编号(II~V 战区)
    const segCount = sdef.segs;
    this.levelW = segCount * this.W;
    this.segCount = segCount;
    this.segThemes = [];
    this.platforms = [];
    this.crates = [];
    this.barrels = [];
    this.spawns = [{ x: 80, y: 830 }];
    this.lamps = [];
    this.trees = [];
    // 确定性随机(同关卡布局一致)
    let seed = stage * 9301 + 49297;
    const rng = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let s = 0; s < segCount; s++) {
      const ox = s * this.W;
      this.segThemes.push(this.sceneLabel());
      // 按场景地形档案生成平台(样式随场景不同)
      const prof = CFG.TERRAIN[sdef.scene] || CFG.TERRAIN[0];
      const pats = [
        [{ x: 610, y: 690, w: 380, h: 22 }, { x: 660, y: 470, w: 280, h: 22 }],                                    // 0 标准
        [{ x: 130, y: 560, w: 280, h: 22 }, { x: 1190, y: 560, w: 280, h: 22 }, { x: 660, y: 400, w: 260, h: 22 }], // 1 双侧高台
        [{ x: 610, y: 660, w: 340, h: 22 }, { x: 300, y: 470, w: 220, h: 22 }, { x: 1080, y: 470, w: 220, h: 22 }], // 2 台阶式
        [{ x: 200, y: 600, w: 260, h: 22 }, { x: 660, y: 480, w: 300, h: 22 }, { x: 1140, y: 600, w: 260, h: 22 }], // 3 拱形
        [{ x: 240, y: 540, w: 120, h: 22 }, { x: 640, y: 420, w: 120, h: 22 }, { x: 1040, y: 540, w: 120, h: 22 }], // 4 立柱(窄塔)
        [{ x: 380, y: 620, w: 320, h: 26 }, { x: 980, y: 620, w: 320, h: 26 }, { x: 700, y: 400, w: 220, h: 22 }],  // 5 集装箱顶
        [{ x: 300, y: 500, w: 180, h: 22 }, { x: 760, y: 640, w: 200, h: 22 }, { x: 1120, y: 470, w: 180, h: 22 }], // 6 高低错落
        [{ x: 250, y: 640, w: 1100, h: 22 }, { x: 480, y: 430, w: 200, h: 22 }, { x: 950, y: 430, w: 200, h: 22 }], // 7 长桥
        [{ x: 420, y: 560, w: 240, h: 22 }, { x: 940, y: 560, w: 240, h: 22 }, { x: 680, y: 380, w: 240, h: 22 }],  // 8 对称
      ];
      const patList = prof.patterns;
      for (const p of pats[patList[s % patList.length]]) this.platforms.push({ x: p.x + ox, y: p.y, w: p.w, h: p.h });
      // 掩体:材质/尺寸/数量按场景档案(wood 木箱 / metal 钢铁 / container 集装箱 / ice 冰岩 / rock 岩石)
      const cCount = randi(prof.crates[0], prof.crates[1]);
      for (let ci = 0; ci < cCount; ci++) {
        const cx = ox + 200 + ci * 330 + rng() * 90;
        const cw = prof.crateW, chh = prof.crateH;
        this.crates.push({ x: cx, y: 830 - chh, w: cw, h: chh, kind: prof.crateKind });
        if (prof.stack && s > 0 && ci === 0) {
          this.crates.push({ x: cx, y: 830 - chh * 2, w: cw, h: chh, kind: prof.crateKind });
        }
      }
      // 油桶:数量按场景(熔岩/工厂多,雪山/丛林少)
      const bCount = randi(prof.barrels[0], prof.barrels[1]);
      for (let bi = 0; bi < bCount; bi++) {
        this.barrels.push({ id: 's' + s + '-' + bi, x: ox + 560 + bi * 330 + rng() * 60, y: 784, w: 36, h: 46 });
      }
      // 灯柱 / 树
      this.lamps.push(ox + 345, ox + 1255);
      this.trees.push([ox + 520 + rng() * 60, 44, 92], [ox + 1120 + rng() * 60, 38, 80]);
    }
    this.finishBuild();
  },

  finishBuild() {
    // 子弹静态实体:边界 + 地面 + 平台 + 掩体箱
    this._solids = [
      { x: -60, y: -60, w: 60, h: this.H + 120 },
      { x: this.levelW, y: -60, w: 60, h: this.H + 120 },
      { x: -60, y: -60, w: this.levelW + 120, h: 60 },
      { x: -60, y: this.groundY, w: this.levelW + 120, h: this.H - this.groundY + 60 },
      ...this.platforms,
      ...this.crates,
    ];
    this.resetBarrels();
  },

  resetBarrels() {
    for (const b of this.barrels) {
      b.hp = this.BARREL_HP;
      b.alive = true;
      b.respawnT = 0;
    }
  },

  solidBoxes() {
    const out = [];
    for (const c of this.crates) if (!c.broken) out.push(c);
    for (const b of this.barrels) if (b.alive) out.push(b);
    return out;
  },

  // 掩体被摧毁(装甲车碾压 / 爆炸波及)
  breakCrate(c) {
    if (!c || c.broken) return false;
    c.broken = true;
    this.rebuildSolids();
    return true;
  },

  rebuildSolids() {
    this._solids = [
      { x: -60, y: -60, w: 60, h: this.H + 120 },
      { x: this.levelW, y: -60, w: 60, h: this.H + 120 },
      { x: -60, y: -60, w: this.levelW + 120, h: 60 },
      { x: -60, y: this.groundY, w: this.levelW + 120, h: this.H - this.groundY + 60 },
      ...this.platforms,
      ...this.crates.filter(c => !c.broken),
    ];
  },

  losClear(x1, y1, x2, y2) {
    for (const p of this.platforms) {
      if (segRect(x1, y1, x2, y2, p.x, p.y, p.w, p.h)) return false;
    }
    for (const c of this.crates) {
      if (c.broken) continue;
      if (segRect(x1, y1, x2, y2, c.x, c.y, c.w, c.h)) return false;
    }
    for (const b of this.barrels) {
      if (b.alive && segRect(x1, y1, x2, y2, b.x, b.y, b.w, b.h)) return false;
    }
    return true;
  },

  // 场景名(含战区后缀)
  sceneLabel() {
    const ch = (this.chapter && CFG.STAGE_CHAPTERS[this.chapter]) || '';
    return this.theme.name + (ch ? ' · ' + ch : '');
  },

  sceneName(x) {
    const idx = this.segThemes.length > 1
      ? clamp(Math.floor(x / this.W), 0, this.segThemes.length - 1) : 0;
    return this.segThemes[idx] || '';
  },

  // ================= 渲染 =================
  draw(ctx, t, camX) {
    camX = camX || 0;
    const { W, H, groundY } = this;
    // ---- 天空(屏幕固定) ----
    const g = ctx.createLinearGradient(0, 0, 0, H);
    const th = this.theme || CFG.SCENES[0];
    g.addColorStop(0, th.sky1);
    g.addColorStop(1, th.sky2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 月亮
    const mg = ctx.createRadialGradient(1330, 130, 10, 1330, 130, 190);
    mg.addColorStop(0, 'rgba(190,215,255,0.16)');
    mg.addColorStop(1, 'rgba(190,215,255,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(1100, 0, 500, 340);
    ctx.fillStyle = 'rgba(210,228,255,0.75)';
    ctx.beginPath(); ctx.arc(1330, 130, 34, 0, TAU); ctx.fill();
    // 云(缓慢漂移,视差 0.1)
    for (let i = 0; i < 4; i++) {
      const cx = ((t * (7 + i * 3) + i * 520 - camX * 0.1) % (W + 420) + W + 420) % (W + 420) - 210;
      const cy = 70 + (i % 3) * 62;
      const s = 0.7 + (i % 3) * 0.25;
      ctx.fillStyle = 'rgba(200,220,250,' + (0.05 + i * 0.012) + ')';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 62 * s, 15 * s, 0, 0, TAU);
      ctx.ellipse(cx + 36 * s, cy - 9 * s, 40 * s, 12 * s, 0, 0, TAU);
      ctx.ellipse(cx - 40 * s, cy - 5 * s, 34 * s, 10 * s, 0, 0, TAU);
      ctx.fill();
    }
    // ---- 远山 / 城市 / 塔 / 树(视差平铺,两份拼接) ----
    this.drawFarLayer(ctx, t, camX, 0.28, (ox) => this.drawHills(ctx, ox, groundY));
    this.drawFarLayer(ctx, t, camX, 0.5, (ox) => { this.drawSkyline(ctx, ox, groundY); this.drawTower(ctx, ox, t); });
    this.drawFarLayer(ctx, t, camX, 0.72, (ox) => this.drawTrees(ctx, ox, groundY, t));
    // ---- 网格(世界坐标视口裁剪) ----
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gx0 = Math.floor(camX / 80) * 80;
    for (let x = gx0; x <= camX + W; x += 80) { ctx.moveTo(x, 0); ctx.lineTo(x, groundY); }
    for (let y = 0; y <= groundY; y += 80) { ctx.moveTo(camX, y); ctx.lineTo(camX + W, y); }
    ctx.stroke();
    // ---- 灯柱(世界坐标) ----
    for (const lx of this.lamps) {
      if (lx < camX - 220 || lx > camX + W + 220) continue;
      this.drawLamp(ctx, lx, groundY);
    }
    // ---- 地面 ----
    ctx.fillStyle = th.ground;
    ctx.fillRect(camX, groundY, W, H - groundY);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(camX, groundY, W, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = Math.floor(camX / 64) * 64 + 20; x < camX + W; x += 64) ctx.fillRect(x, groundY + 14, 30, 4);
    // ---- 地面细节(弹坑/井盖/水坑/草/芦苇) ----
    this.drawGroundDetail(ctx, camX, t);
    // ---- 平台 + 支架(裁剪) ----
    for (const p of this.platforms) {
      if (p.x + p.w < camX - 60 || p.x > camX + W + 60) continue;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(p.x + 16, p.y + p.h); ctx.lineTo(p.x + 30, p.y + p.h + 22);
      ctx.moveTo(p.x + p.w - 16, p.y + p.h); ctx.lineTo(p.x + p.w - 30, p.y + p.h + 22);
      ctx.stroke();
      ctx.fillStyle = th.plat;
      rrPath(ctx, p.x, p.y, p.w, p.h, 6); ctx.fill();
      ctx.fillStyle = th.platTop;
      rrPath(ctx, p.x + 2, p.y, p.w - 4, 5, 2.5); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(p.x + 10, p.y + p.h - 5, p.w - 20, 2);
    }
    // ---- 掩体箱 / 油桶(裁剪) ----
    for (const c of this.crates) {
      if (c.broken) continue;
      if (c.x + c.w < camX - 60 || c.x > camX + W + 60) continue;
      this.drawCrate(ctx, c);
    }
    for (const b of this.barrels) {
      if (b.x + b.w < camX - 60 || b.x > camX + W + 60) continue;
      if (b.alive) this.drawBarrel(ctx, b, t);
    }
    // ---- 关卡边界墙(只画最左最右) ----
    ctx.fillStyle = 'rgba(10,14,22,0.85)';
    ctx.fillRect(0, 0, 14, H);
    ctx.fillRect(this.levelW - 14, 0, 14, H);
    // 战区色调(II~V 战区叠加不同氛围色)
    if (this.chapter) {
      const tints = ['', 'rgba(60,80,160,0.06)', 'rgba(150,60,40,0.07)', 'rgba(90,40,120,0.08)', 'rgba(20,10,30,0.12)'];
      ctx.fillStyle = tints[this.chapter] || tints[4];
      ctx.fillRect(camX, 0, W, H);
    }
    // 顶部渐暗
    const vg = ctx.createLinearGradient(0, 0, 0, 120);
    vg.addColorStop(0, 'rgba(0,0,0,0.35)');
    vg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vg;
    ctx.fillRect(camX, 0, W, 120);
    // ---- 萤火虫(视差 0.9,随视线) ----
    for (let i = 0; i < 7; i++) {
      const base = camX + 200 + ((i * 211) % 1200);
      const fx = base + Math.sin(t * (0.5 + i * 0.13) + i) * 60;
      const fy = 480 + ((i * 137) % 300) + Math.cos(t * (0.4 + i * 0.11) + i * 2) * 42;
      const a = 0.22 + 0.22 * Math.sin(t * 2 + i * 1.7);
      if (a <= 0.03) continue;
      ctx.fillStyle = 'rgba(190,235,120,' + (a * 0.35) + ')';
      ctx.beginPath(); ctx.arc(fx, fy, 4.5, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(220,255,150,' + a + ')';
      ctx.beginPath(); ctx.arc(fx, fy, 1.6, 0, TAU); ctx.fill();
    }
  },

  // 视差平铺:图案以 W 为周期,绘制两份覆盖视口
  drawFarLayer(ctx, t, camX, factor, fn) {
    const off = -((camX * factor) % this.W);
    fn(off);
    fn(off + this.W);
    if (off + 2 * this.W < camX + this.W) fn(off + 2 * this.W);
  },

  drawHills(ctx, ox, groundY) {
    for (const [col, peaks, base] of [
      ['rgba(15,23,36,0.85)', [[-100, 90], [400, 150], [900, 110], [1400, 160], [1750, 100]], 0],
      ['rgba(19,29,45,0.9)', [[-100, 40], [260, 110], [750, 70], [1250, 120], [1750, 60]], 18],
    ]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(peaks[0][0] + ox, groundY - base);
      for (let i = 1; i < peaks.length; i++) {
        const [x1, h1] = peaks[i - 1], [x2, h2] = peaks[i];
        ctx.quadraticCurveTo((x1 + x2) / 2 + ox, groundY - Math.max(h1, h2) - 40, x2 + ox, groundY - h2 - base);
      }
      ctx.lineTo(1750 + ox, groundY);
      ctx.lineTo(-100 + ox, groundY);
      ctx.closePath();
      ctx.fill();
    }
  },

  drawSkyline(ctx, ox, groundY) {
    ctx.fillStyle = '#141c2c';
    const skyline = [[0,120],[90,60],[150,160],[240,40],[330,110],[430,70],[520,140],[640,50],[760,120],[860,80],[960,150],[1080,60],[1180,110],[1300,45],[1400,100],[1500,70],[1600,130]];
    for (let i = 0; i < skyline.length - 1; i++) {
      const [x1, h1] = skyline[i], [x2] = skyline[i + 1];
      ctx.fillRect(x1 + ox, groundY - h1 - 130, x2 - x1, h1 + 130);
    }
    ctx.fillStyle = 'rgba(255,214,140,0.35)';
    for (let i = 0; i < 26; i++) {
      const wx = ox + 40 + ((i * 173) % 1560);
      const bh = 60 + ((i * 97) % 140);
      ctx.fillRect(wx, groundY - bh - 126, 3, 4);
    }
  },

  drawTower(ctx, ox, t, groundYRef) {
    const groundY = groundYRef || this.groundY;
    ctx.strokeStyle = '#101827';
    ctx.fillStyle = '#101827';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(875 + ox, groundY - 130); ctx.lineTo(905 + ox, groundY - 320);
    ctx.moveTo(935 + ox, groundY - 130); ctx.lineTo(905 + ox, groundY - 320);
    ctx.moveTo(887 + ox, groundY - 210); ctx.lineTo(923 + ox, groundY - 210);
    ctx.moveTo(880 + ox, groundY - 265); ctx.lineTo(930 + ox, groundY - 265);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,90,90,' + (0.4 + 0.4 * Math.sin(t * 2.4)) + ')';
    ctx.beginPath(); ctx.arc(905 + ox, groundY - 328, 3.5, 0, TAU); ctx.fill();
    // 水塔
    ctx.strokeStyle = '#101827';
    ctx.fillStyle = '#101827';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(190 + ox, groundY - 150); ctx.lineTo(215 + ox, groundY - 265);
    ctx.moveTo(245 + ox, groundY - 150); ctx.lineTo(220 + ox, groundY - 265);
    ctx.moveTo(198 + ox, groundY - 205); ctx.lineTo(237 + ox, groundY - 205);
    ctx.stroke();
    ctx.beginPath(); ctx.ellipse(217 + ox, groundY - 290, 34, 26, 0, 0, TAU); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(180 + ox, groundY - 296); ctx.lineTo(217 + ox, groundY - 326); ctx.lineTo(254 + ox, groundY - 296);
    ctx.closePath(); ctx.fill();
  },

  drawTrees(ctx, ox, groundY, t) {
    for (const [tx, tr, th] of [[520, 46, 96], [665, 34, 74], [1122, 40, 84], [1440, 30, 66]]) {
      const sway = Math.sin(t * 0.9 + tx) * 3;
      ctx.strokeStyle = '#131b2a';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(tx + ox, groundY - 4);
      ctx.quadraticCurveTo(tx + ox + sway * 0.5, groundY - th * 0.55, tx + ox + sway, groundY - th);
      ctx.stroke();
      ctx.fillStyle = '#16202f';
      ctx.beginPath();
      ctx.arc(tx + ox + sway, groundY - th - tr * 0.55, tr, 0, TAU);
      ctx.arc(tx + ox + sway - tr * 0.62, groundY - th - tr * 0.2, tr * 0.72, 0, TAU);
      ctx.arc(tx + ox + sway + tr * 0.62, groundY - th - tr * 0.2, tr * 0.72, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(140,170,220,0.05)';
      ctx.beginPath(); ctx.arc(tx + ox + sway - tr * 0.3, groundY - th - tr * 0.75, tr * 0.4, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = '#182233';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(1352 + ox, groundY - 2);
    ctx.quadraticCurveTo(1348 + ox, groundY - 70, 1358 + ox, groundY - 118);
    ctx.moveTo(1354 + ox, groundY - 66); ctx.lineTo(1332 + ox, groundY - 104);
    ctx.moveTo(1356 + ox, groundY - 88); ctx.lineTo(1382 + ox, groundY - 128);
    ctx.moveTo(1358 + ox, groundY - 112); ctx.lineTo(1348 + ox, groundY - 148);
    ctx.stroke();
    ctx.fillStyle = 'rgba(23,40,32,0.75)';
    for (const bx of [62, 382, 748, 1096, 1560]) {
      ctx.beginPath();
      ctx.ellipse(bx + ox, groundY - 4, 26, 12, 0, 0, TAU);
      ctx.ellipse(bx + 20 + ox, groundY - 6, 18, 9, 0, 0, TAU);
      ctx.fill();
    }
  },

  drawLamp(ctx, lx, groundY) {
    const topY = groundY - 178;
    ctx.strokeStyle = '#1c2434';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(lx, groundY); ctx.lineTo(lx, topY); ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(lx, topY); ctx.lineTo(lx + 34, topY + 6); ctx.stroke();
    const cone = ctx.createLinearGradient(lx + 30, topY, lx + 30, groundY);
    cone.addColorStop(0, 'rgba(255,214,140,0.10)');
    cone.addColorStop(1, 'rgba(255,214,140,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(lx + 34, topY + 8);
    ctx.lineTo(lx + 120, groundY);
    ctx.lineTo(lx - 50, groundY);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd88a';
    ctx.beginPath(); ctx.arc(lx + 34, topY + 9, 5, 0, TAU); ctx.fill();
  },

  drawGroundDetail(ctx, camX, t) {
    const groundY = this.groundY;
    // 弹坑
    for (let k = 0; k < this.levelW; k += 520) {
      const kx = k + 385 + ((k * 13) % 90);
      if (kx < camX - 80 || kx > camX + this.W + 80) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath(); ctx.ellipse(kx, groundY + 20, 38, 8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.ellipse(kx, groundY + 20, 21, 4.5, 0, 0, TAU); ctx.fill();
    }
    // 井盖 / 水坑 / 芦苇 / 草丛(按周期散布)
    for (let k = 0; k < this.levelW; k += 640) {
      const bx = k + 300 + ((k * 7) % 200);
      if (bx > camX - 100 && bx < camX + this.W + 100) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(bx, groundY + 26, 26, 6, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(bx, groundY + 26, 18, 4, 0, 0, TAU); ctx.stroke();
      }
      const px = k + 520 + ((k * 11) % 160);
      if (px > camX - 100 && px < camX + this.W + 100) {
        ctx.fillStyle = 'rgba(110,160,215,0.10)';
        ctx.beginPath(); ctx.ellipse(px, groundY + 24, 42, 7, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(110,150,105,0.55)';
        ctx.lineWidth = 2;
        for (const rx of [px - 28, px - 14, px + 16, px + 32]) {
          const sw = Math.sin(t * 1.6 + rx) * 2.5;
          ctx.beginPath();
          ctx.moveTo(rx, groundY + 2);
          ctx.quadraticCurveTo(rx + sw * 0.5, groundY - 12, rx + sw, groundY - 22);
          ctx.stroke();
        }
      }
    }
    ctx.strokeStyle = 'rgba(90,140,90,0.5)';
    ctx.lineWidth = 2;
    for (let gx = Math.floor(camX / 150) * 150; gx < camX + this.W + 150; gx += 150) {
      const jx = gx + ((gx * 31) % 120);
      ctx.beginPath();
      ctx.moveTo(jx, groundY); ctx.lineTo(jx - 4, groundY - 9);
      ctx.moveTo(jx + 4, groundY); ctx.lineTo(jx + 4, groundY - 12);
      ctx.moveTo(jx + 8, groundY); ctx.lineTo(jx + 12, groundY - 8);
      ctx.stroke();
    }
  },

  drawCrate(ctx, c) {
    const kind = c.kind || 'wood';
    if (kind === 'wood') {
      ctx.fillStyle = '#6d5236';
      rrPath(ctx, c.x, c.y, c.w, c.h, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        const y = c.y + (c.h * i) / 3;
        ctx.moveTo(c.x + 3, y); ctx.lineTo(c.x + c.w - 3, y);
      }
      ctx.stroke();
      ctx.strokeStyle = '#4a3724'; ctx.lineWidth = 3;
      rrPath(ctx, c.x, c.y, c.w, c.h, 4); ctx.stroke();
    } else if (kind === 'container') {
      const palette = ['#7a4a34', '#3f6b7a', '#6b6b3f', '#5a4a7a'];
      ctx.fillStyle = palette[Math.abs(Math.round(c.x)) % palette.length];
      rrPath(ctx, c.x, c.y, c.w, c.h, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
      for (let i = 1; i < 6; i++) {
        const x = c.x + (c.w * i) / 6;
        ctx.beginPath(); ctx.moveTo(x, c.y + 3); ctx.lineTo(x, c.y + c.h - 3); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      rrPath(ctx, c.x, c.y, c.w, c.h, 3); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(c.x + 2, c.y + 2, c.w - 4, 4);
    } else if (kind === 'ice') {
      ctx.fillStyle = 'rgba(150,200,235,0.55)';
      rrPath(ctx, c.x, c.y, c.w, c.h, 6); ctx.fill();
      ctx.strokeStyle = 'rgba(210,240,255,0.75)'; ctx.lineWidth = 2;
      rrPath(ctx, c.x, c.y, c.w, c.h, 6); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(c.x + 6, c.y + c.h - 6); ctx.lineTo(c.x + c.w - 8, c.y + 6);
      ctx.moveTo(c.x + 6, c.y + 10); ctx.lineTo(c.x + c.w * 0.5, c.y + c.h - 8);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(c.x + 3, c.y + 2, c.w - 6, 4);
    } else if (kind === 'rock') {
      ctx.fillStyle = '#4a4340';
      ctx.beginPath();
      ctx.moveTo(c.x + 4, c.y + c.h);
      ctx.lineTo(c.x, c.y + c.h * 0.45);
      ctx.lineTo(c.x + c.w * 0.28, c.y + 2);
      ctx.lineTo(c.x + c.w * 0.72, c.y);
      ctx.lineTo(c.x + c.w, c.y + c.h * 0.5);
      ctx.lineTo(c.x + c.w - 4, c.y + c.h);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x + c.w * 0.3, c.y + 6); ctx.lineTo(c.x + c.w * 0.45, c.y + c.h - 6);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,140,80,0.12)';
      ctx.fillRect(c.x + 4, c.y + c.h - 6, c.w - 8, 4);
    } else { // metal 钢铁掩体
      ctx.fillStyle = '#49566b';
      rrPath(ctx, c.x, c.y, c.w, c.h, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y + c.h * 0.33); ctx.lineTo(c.x + c.w, c.y + c.h * 0.33);
      ctx.moveTo(c.x, c.y + c.h * 0.66); ctx.lineTo(c.x + c.w, c.y + c.h * 0.66);
      ctx.stroke();
      ctx.strokeStyle = '#2f3a49'; ctx.lineWidth = 3;
      rrPath(ctx, c.x, c.y, c.w, c.h, 3); ctx.stroke();
      ctx.fillStyle = '#2f3a49';
      for (const [dx, dy] of [[5, 5], [c.w - 5, 5], [5, c.h - 5], [c.w - 5, c.h - 5]]) {
        ctx.beginPath(); ctx.arc(c.x + dx, c.y + dy, 2.4, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(c.x + 2, c.y + 1, c.w - 4, 3);
    }
  },

  drawBarrel(ctx, b, t) {
    const cx = b.x + b.w / 2;
    if (b.hp < this.BARREL_HP) {
      const a = 0.12 + 0.1 * Math.sin(t * 9);
      ctx.fillStyle = 'rgba(255,110,60,' + a + ')';
      ctx.beginPath(); ctx.arc(cx, b.y + b.h / 2, b.w, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#b3402f';
    rrPath(ctx, b.x, b.y, b.w, b.h, 6);
    ctx.fill();
    ctx.fillStyle = '#e8b93a';
    ctx.fillRect(b.x + 2, b.y + b.h * 0.42, b.w - 4, b.h * 0.16);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(b.x + 4 + i * 12, b.y + b.h * 0.42, 6, b.h * 0.16);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(b.x + 1, b.y + 4, b.w - 2, 3);
    ctx.fillRect(b.x + 1, b.y + b.h - 7, b.w - 2, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(b.x + 4, b.y + 4, 4, b.h - 8);
    if (b.hp < this.BARREL_HP * 0.6) {
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(b.x + 8, b.y + 10); ctx.lineTo(b.x + 16, b.y + 20); ctx.lineTo(b.x + 10, b.y + 30);
      ctx.moveTo(b.x + b.w - 8, b.y + b.h - 12); ctx.lineTo(b.x + b.w - 16, b.y + b.h - 24);
      ctx.stroke();
    }
  },
};
Arena.init();
