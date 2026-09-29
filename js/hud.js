'use strict';
// ===== HUD:准星 / 血量弹药 / 比分 / 击杀播报 / 计分板 =====
function drawHUD(ctx, game) {
  if (game.mode === 'menu') return;
  const W = Arena.W, H = Arena.H;
  const L = game.local;
  const t = game.time;

  // ---- 顶部比分 ----
  const bw = 220, bx = W / 2 - bw / 2, by = 12, bh = 42;
  ctx.fillStyle = 'rgba(8,12,20,0.6)';
  rrPath(ctx, bx, by, bw, bh, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  rrPath(ctx, bx, by, bw, bh, 10); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillStyle = CFG.COLORS.BLUE;
  ctx.fillText(String(game.scores.blue), bx + bw * 0.22, by + 31);
  ctx.fillStyle = CFG.COLORS.RED;
  ctx.fillText(String(game.scores.red), bx + bw * 0.78, by + 31);
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('VS', bx + bw / 2, by + 27);
  if (game.mode === 'solo') {
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('目标 ' + game.roundTarget + ' 杀', bx + bw / 2, by + bh + 14);
  }

  // ---- 闯关信息面板(左上) + Mario 式进度条 ----
  if (game.mode === 'campaign' && game.campaign) {
    const c = game.campaign;
    const aliveEnemies = game.fighters.filter(f => (f.kind === 'bot' || (f.kind === 'tank' && f.isBoss)) && f.alive).length;
    ctx.textAlign = 'left';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillStyle = '#ffd24a';
    const bd = (CFG.STAGES[c.stage - 1] || {}).boss;
    ctx.fillText('第 ' + c.stage + '/' + CFG.CAMPAIGN_TOTAL + ' 关 · ' +
      ((CFG.SCENES[c.stage - 1] || {}).name || ''), 20, 48);
    if (bd) {
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,180,93,0.85)';
      ctx.fillText('BOSS:' + bd.name + ' · ' + ({ giant: '巨型兵', tank: '机动坦克', turret: '固定炮台' }[bd.kind] || 'BOSS'), 20, 88);
      ctx.font = 'bold 15px system-ui, sans-serif';
    }
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('残敌 ' + aliveEnemies + '   生命 ' + '❤'.repeat(Math.max(0, c.lives)) + '♡'.repeat(Math.max(0, CFG.CAMPAIGN.LIVES - c.lives)), 20, 70);
    // 进度条
    const bw = 340, bx = W / 2 - bw / 2, by = 66;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    rrPath(ctx, bx, by, bw, 10, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    rrPath(ctx, bx, by, bw, 10, 5); ctx.stroke();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const e of c.encounters) {
      const px2 = bx + clamp(e.x / c.levelW, 0, 1) * bw;
      ctx.fillStyle = e.open ? 'rgba(124,232,141,0.8)' : 'rgba(255,120,120,0.9)';
      ctx.fillText('⚔', px2, by + 9);
    }
    if (c.bossStage) {
      ctx.fillStyle = '#ffb45d';
      ctx.fillText('🛡', bx + clamp(c.bossX / c.levelW, 0, 1) * bw, by + 9);
    }
    ctx.fillStyle = '#7ce8ff';
    ctx.fillText('🚁', bx + bw + 2, by + 9);
    if (L) {
      const px3 = bx + clamp(L.x / c.levelW, 0, 1) * bw;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(px3, by - 3); ctx.lineTo(px3 - 5, by - 11); ctx.lineTo(px3 + 5, by - 11);
      ctx.closePath(); ctx.fill();
    }
    ctx.textAlign = 'left';
  }

  // ---- BOSS 血条(魂斗罗式顶部横条) ----
  const bossF = game.fighters.find(f => (f.boss || (f.kind === 'tank' && f.isBoss)) && f.alive);
  if (bossF && (game.mode === 'campaign' || game.mode === 'solo')) {
    const bw2 = 620, bx2 = W / 2 - bw2 / 2, by2 = 100;
    const pctB = clamp(bossF.hp / bossF.hpMax, 0, 1);
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillStyle = '#ffb45d';
    ctx.fillText('☠ ' + (bossF.bossName || 'BOSS'), W / 2, by2 - 6);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    rrPath(ctx, bx2, by2, bw2, 14, 7); ctx.fill();
    const gB = ctx.createLinearGradient(bx2, 0, bx2 + bw2, 0);
    gB.addColorStop(0, '#ff5d5d');
    gB.addColorStop(1, '#ffb45d');
    ctx.fillStyle = gB;
    if (pctB > 0) { rrPath(ctx, bx2 + 2, by2 + 2, Math.max(4, (bw2 - 4) * pctB), 10, 5); ctx.fill(); }
    ctx.strokeStyle = 'rgba(255,180,93,0.5)';
    ctx.lineWidth = 1.5;
    rrPath(ctx, bx2, by2, bw2, 14, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText(Math.ceil(bossF.hp) + ' / ' + bossF.hpMax, W / 2, by2 + 11);
  }

  // ---- 在线状态(左上) ----
  if (game.mode === 'online') {
    ctx.textAlign = 'left';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('房间 ' + Net.room + ' · ' + game.fighters.length + ' 人 · ' + Net.latency + 'ms', 20, 26);
  }

  // ---- 击杀播报 ----
  ctx.font = 'bold 14px system-ui, sans-serif';
  for (let i = 0; i < game.killfeed.length; i++) {
    const k = game.killfeed[i];
    const alpha = k.t > 3.5 ? clamp(1 - (k.t - 3.5) / 1, 0, 1) : 1;
    if (alpha <= 0) continue;
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'right';
    const y = 78 + i * 24;
    const vTxt = k.v + (k.head ? ' ◎' : '');
    const arrow = '  ▸  ';
    // 从右往左:受害者 / 箭头 / 击杀者
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(vTxt, W - 20, y + 1);
    ctx.fillStyle = k.vc;
    ctx.fillText(vTxt, W - 21, y);
    const wV = ctx.measureText(vTxt).width + ctx.measureText(arrow).width;
    const kTxt = k.k || '?';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(kTxt, W - 21 - wV + 1, y + 1);
    ctx.fillStyle = k.kc;
    ctx.fillText(kTxt, W - 21 - wV, y);
    ctx.globalAlpha = 1;
  }

  if (!L) return;

  // ---- 血量(坦克驾驶时显示装甲) ----
  const hpY = H - 46;
  const mounted = L.mountedTank && L.mountedTank.alive ? L.mountedTank : null;
  const hpMax = mounted ? mounted.hpMax : CFG.PLAYER.MAX_HP;
  const hpVal = mounted ? mounted.hp : L.hp;
  ctx.textAlign = 'left';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(mounted ? '🛡 装甲' : '生命', 28, hpY - 22);
  const hpw = 240;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  rrPath(ctx, 28, hpY - 14, hpw, 16, 8); ctx.fill();
  const pct = clamp(hpVal / hpMax, 0, 1);
  const regen = !mounted && L.alive && L.hp < CFG.PLAYER.MAX_HP && t - L.lastDmgT > CFG.REGEN_DELAY;
  if (pct > 0) {
    let col = pct > 0.5 ? '#5ddc6a' : pct > 0.25 ? '#ffd24a' : '#ff5d5d';
    if (regen) col = '#9ef2a6';
    if (mounted) col = pct > 0.4 ? '#c9a03c' : '#ff8d5d';
    ctx.fillStyle = col;
    rrPath(ctx, 30, hpY - 12, Math.max(4, (hpw - 4) * pct), 12, 6); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  rrPath(ctx, 28, hpY - 14, hpw, 16, 8); ctx.stroke();
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(String(Math.ceil(hpVal)), 28 + hpw + 12, hpY);
  // 经验条 + 等级
  const lvl = game.localLevel();
  const curXp = game.localXp();
  const lvBase = CFG.xpForLevel(lvl), lvNext = CFG.xpForLevel(lvl + 1);
  const xpPct = clamp((curXp - lvBase) / Math.max(1, lvNext - lvBase), 0, 1);
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,210,74,0.9)';
  ctx.fillText('Lv.' + lvl, 28, hpY - 26);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  rrPath(ctx, 56, hpY - 33, 120, 7, 3.5); ctx.fill();
  ctx.fillStyle = '#ffd24a';
  rrPath(ctx, 57, hpY - 32, Math.max(2, 118 * xpPct), 5, 2.5); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText((curXp - lvBase) + ' / ' + (lvNext - lvBase) + ' XP', 182, hpY - 26);
  if (L.protect > 0 && L.alive) {
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(140,205,255,0.9)';
    ctx.fillText('护盾 ' + L.protect.toFixed(1) + 's', 28, hpY - 30);
  }

  // ---- 弹药(限时强化优先显示) ----
  const eg = L.effGun ? L.effGun() : L.gun;
  const infinite = eg.mag >= 9999;
  ctx.textAlign = 'right';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = L.tempGunT > 0 ? eg.color : 'rgba(255,255,255,0.45)';
  ctx.fillText(eg.name + (L.tempGunT > 0 ? ' · ' + L.tempGunT.toFixed(1) + 's' : ''), W - 28, hpY - 40);
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillStyle = L.reloading ? 'rgba(255,255,255,0.35)' : (!infinite && L.ammo <= 20 ? '#ff6d5d' : '#fff');
  ctx.fillText(infinite ? '∞' : String(L.ammo), W - 80, hpY - 4);
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('/ ' + (infinite ? '∞' : eg.mag), W - 28, hpY - 6);
  if (L.reloading) {
    const p = 1 - L.reloadT / eg.reload;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    rrPath(ctx, W - 178, hpY + 2, 150, 7, 3.5); ctx.fill();
    ctx.fillStyle = '#ffd24a';
    rrPath(ctx, W - 176, hpY + 4, Math.max(3, 146 * p), 3, 1.5); ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,210,74,' + (0.5 + Math.sin(t * 8) * 0.3) + ')';
    ctx.fillText('装填中…', W - 103, hpY + 22);
  }

  // ---- 对局内换枪栏(数字键直选 / Q 循环) ----
  if (L.alive && !mounted) {
    const list = game.unlockedWeapons();
    const allIds = game.weaponOrder();
    const chipH = 14, chipGap = 3;
    let cx = W - 28, cy = hpY - 92;
    for (let i = allIds.length - 1; i >= 0; i--) {
      const id = allIds[i];
      const w = CFG.WEAPONS[id];
      const unlocked = list.indexOf(id) >= 0;
      const cur = L.gun.id === id;
      const key = i < 9 ? String(i + 1) : i === 9 ? '0' : i === 10 ? '-' : i === 11 ? '=' : '·';
      const label = key + ' ' + w.name.replace(/ ?(机枪|冲锋枪|突击步枪|狙击枪|火箭筒|枪|发射器|炮|电枪)/, '');
      ctx.font = (cur ? 'bold ' : '') + '10.5px system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 12;
      const bx = cx - tw;
      ctx.fillStyle = cur ? 'rgba(53,132,227,0.85)' : (unlocked ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)');
      rrPath(ctx, bx, cy, tw, chipH, 4); ctx.fill();
      if (cur) {
        ctx.strokeStyle = 'rgba(124,192,255,0.9)';
        ctx.lineWidth = 1;
        rrPath(ctx, bx, cy, tw, chipH, 4); ctx.stroke();
      }
      ctx.fillStyle = cur ? '#fff' : (unlocked ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.22)');
      ctx.textAlign = 'right';
      ctx.fillText(unlocked ? label : ('🔒 ' + label), cx - 6, cy + 10.5);
      cy -= chipH + chipGap;
    }
    ctx.textAlign = 'right';
    ctx.font = '10.5px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillText('换枪 1-9 / 0 · Q 循环 · 共 ' + allIds.length + ' 把', W - 28, cy + chipH - 3);
  }

  // ---- 增益状态(魂斗罗式) ----
  if (L.invulT > 0) {
    ctx.textAlign = 'right';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(220,180,80,' + (0.55 + 0.45 * Math.abs(Math.sin(t * 8))) + ')';
    ctx.fillText('◈ 无敌 ' + L.invulT.toFixed(1) + 's', W - 28, hpY - 60);
  }
  if (L.tempGunT > 0) {
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    rrPath(ctx, W - 158, hpY - 58, 130, 6, 3); ctx.fill();
    ctx.fillStyle = eg.color;
    rrPath(ctx, W - 157, hpY - 57, Math.max(2, 128 * (L.tempGunT / CFG.POWERUPS.GUN_TIME)), 4, 2); ctx.fill();
  }

  // ---- 操作提示 ----
  ctx.textAlign = 'center';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillText('WASD 移动 · 空格 跳 · S+空格 下落 · 鼠标射击 · R 换弹 · Tab 战绩 · Esc 菜单', W / 2, H - 14);

  // ---- 连杀公告 ----
  if (game.announce.t > 0) {
    ctx.globalAlpha = clamp(game.announce.t / 0.3, 0, 1);
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillStyle = game.announce.color;
    if (game.announce.who) ctx.fillText(game.announce.who, W / 2, 188);
    ctx.font = 'bold 42px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(game.announce.text, W / 2, 232);
    ctx.globalAlpha = 1;
  }

  // ---- 阵亡覆盖 ----
  if (!L.alive) {
    ctx.fillStyle = 'rgba(20,4,4,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 36px system-ui, sans-serif';
    ctx.fillStyle = '#ff5d5d';
    ctx.fillText('你阵亡了', W / 2, H / 2 - 44);
    if (game.lastKiller) {
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText('被 「' + game.lastKiller + '」 击杀', W / 2, H / 2 - 14);
    }
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(Math.max(0, L.respawnT).toFixed(1) + ' s', W / 2, H / 2 + 40);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('重生中…', W / 2, H / 2 + 66);
  }

  // ---- 受伤边缘 + 低血量 ----
  let vig = game.dmgFlash * 0.55;
  if (L.alive && L.hp < 30) vig = Math.max(vig, 0.18 + Math.sin(t * 6) * 0.08);
  if (vig > 0.01) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, 'rgba(255,30,30,0)');
    g.addColorStop(1, 'rgba(255,30,30,' + clamp(vig, 0, 0.8) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ---- 命中标记 ----
  if (game.hitT > 0 && L.alive) {
    const m = Input.mouse;
    ctx.strokeStyle = game.hitHead ? 'rgba(255,93,93,' : 'rgba(255,255,255,';
    ctx.strokeStyle += clamp(game.hitT / 0.18, 0, 1) + ')';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(m.x + sx * 5, m.y + sy * 5);
      ctx.lineTo(m.x + sx * 12, m.y + sy * 12);
      ctx.stroke();
    }
  }

  // ---- 准星(含辅助瞄准反馈) ----
  if (L.alive && !game.paused) {
    const m = Input.mouse;
    const gap = 6 + L.heat * 15;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3.5;
    crossLines(ctx, m, gap, 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.8;
    crossLines(ctx, m, gap, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(m.x, m.y, 1.4, 0, TAU); ctx.fill();
    // 辅助瞄准:金色外圈 / 锁定:红色四角框 + 虚线
    if (L.assist) {
      if (L.assist.locked && L.assist.target && L.assist.target.alive) {
        const tg = L.assist.target;
        const tx = tg.x - (game.camX || 0), ty = tg.y - 30; // 世界坐标 → HUD 屏幕坐标
        ctx.strokeStyle = 'rgba(255,93,93,0.9)';
        ctx.lineWidth = 2.5;
        const s = 20, c = 8;
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          ctx.beginPath();
          ctx.moveTo(tx + dx * s, ty + dy * s - dy * c);
          ctx.lineTo(tx + dx * s, ty + dy * s);
          ctx.lineTo(tx + dx * s - dx * c, ty + dy * s);
          ctx.stroke();
        }
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = 'rgba(255,93,93,0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = 'rgba(255,210,74,0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(m.x, m.y, gap + 9, -0.6, 2.2);
        ctx.stroke();
      }
    }
  }

  // ---- 计分板(Tab) ----
  if (Input.down('Tab')) {
    const pw = 460, ph = 64 + game.scoreRows().length * 30 + 16;
    const px = W / 2 - pw / 2, py = H / 2 - ph / 2;
    ctx.fillStyle = 'rgba(8,12,20,0.88)';
    rrPath(ctx, px, py, pw, ph, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    rrPath(ctx, px, py, pw, ph, 12); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText('战 绩 榜', W / 2, py + 34);
    // 表头
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'left';
    ctx.fillText('玩家', px + 40, py + 62);
    ctx.fillText('击杀', px + 280, py + 62);
    ctx.fillText('阵亡', px + 345, py + 62);
    ctx.fillText('延迟', px + 405, py + 62);
    // 行
    const rows = game.scoreRows();
    rows.forEach((r, i) => {
      const ry = py + 88 + i * 30;
      if (r.me) {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        rrPath(ctx, px + 14, ry - 19, pw - 28, 26, 6); ctx.fill();
      }
      ctx.font = (r.me ? 'bold ' : '') + '14px system-ui, sans-serif';
      ctx.fillStyle = r.color;
      ctx.fillText(r.name, px + 40, ry);
      ctx.fillStyle = '#fff';
      ctx.fillText(String(r.k), px + 288, ry);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(String(r.d), px + 350, ry);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText(r.ping, px + 405, ry);
    });
  }

  // ---- 关卡结算界面(魂斗罗式:原地显示,等待确认) ----
  if (game.mode === 'campaign' && game.campaign && game.campaign.overlay) {
    drawStageOverlay(ctx, game, W, H);
  }

  // ---- 暂停 ----
  if (game.paused) {
    ctx.fillStyle = 'rgba(5,8,14,0.5)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText('已暂停', W / 2, H / 2 - 10);
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(game.mode === 'online' ? '(联机战斗不会停止)按 Esc 返回战场' : '按 Esc 或点击「返回战场」继续', W / 2, H / 2 + 22);
  }
}

// ===== 关卡结算界面(魂斗罗式) =====
function drawStageOverlay(ctx, game, W, H) {
  const c = game.campaign;
  const s = c.summary || { kills: 0, deaths: 0, xp: 0, lives: c.lives, stage: c.stage };
  const cleared = c.overlay === 'clear';
  const t = game.time;
  ctx.fillStyle = 'rgba(5,8,14,0.72)';
  ctx.fillRect(0, 0, W, H);

  const pw = 560, ph = 330, px = W / 2 - pw / 2, py = H / 2 - ph / 2 - 20;
  ctx.fillStyle = 'rgba(13,18,28,0.96)';
  rrPath(ctx, px, py, pw, ph, 16); ctx.fill();
  ctx.strokeStyle = cleared ? 'rgba(124,232,141,0.55)' : 'rgba(255,93,93,0.55)';
  ctx.lineWidth = 2;
  rrPath(ctx, px, py, pw, ph, 16); ctx.stroke();

  ctx.textAlign = 'center';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.fillStyle = cleared ? '#7cff9c' : '#ff5d5d';
  const sceneName = (CFG.SCENES[c.stage - 1] || {}).name || '';
  const isFinal = !!c.final;
  ctx.fillText(cleared
    ? (isFinal ? '🏆 全部 10 关通关!' : '🎉 第 ' + s.stage + ' 关 完成!')
    : '💀 第 ' + s.stage + ' 关 失败', W / 2, py + 62);
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('场景:' + sceneName, W / 2, py + 86);

  // 战绩
  ctx.font = 'bold 16px system-ui, sans-serif';
  const rows = [
    ['本关击杀', s.kills + ' 人', '#ffd24a'],
    ['本关阵亡', s.deaths + ' 次', '#ff8d8d'],
    ['本关经验', '+' + s.xp + ' XP', '#7ce8ff'],
    ['剩余生命', '❤'.repeat(Math.max(0, s.lives)) + '♡'.repeat(Math.max(0, CFG.CAMPAIGN.LIVES - s.lives)), '#7cff7c'],
  ];
  rows.forEach((r, i) => {
    const ry = py + 108 + i * 34;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(r[0], px + 90, ry);
    ctx.textAlign = 'right';
    ctx.fillStyle = r[2];
    ctx.fillText(r[1], px + pw - 90, ry);
  });

  // 等级经验进度
  const lvl = game.localLevel();
  const curXp = game.localXp();
  const base = CFG.xpForLevel(lvl), next = CFG.xpForLevel(lvl + 1);
  const pct = clamp((curXp - base) / Math.max(1, next - base), 0, 1);
  ctx.textAlign = 'left';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.fillStyle = '#ffd24a';
  ctx.fillText('Lv.' + lvl, px + 90, py + 258);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  rrPath(ctx, px + 132, py + 246, 250, 12, 6); ctx.fill();
  ctx.fillStyle = '#ffd24a';
  rrPath(ctx, px + 134, py + 248, Math.max(3, 246 * pct), 8, 4); ctx.fill();
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText((curXp - base) + ' / ' + (next - base) + ' XP', px + pw - 90, py + 258);

  // 提示(闪烁)
  ctx.textAlign = 'center';
  const blink = 0.55 + 0.45 * Math.abs(Math.sin(t * 4));
  ctx.globalAlpha = blink;
  ctx.font = 'bold 17px system-ui, sans-serif';
  ctx.fillStyle = cleared ? '#7cff9c' : '#ffd24a';
  const nextStage = Math.min(s.stage + 1, CFG.CAMPAIGN_TOTAL);
  const nextScene = (CFG.SCENES[nextStage - 1] || {}).name || '';
  const nextBoss = (CFG.STAGES[nextStage - 1] || {}).boss;
  ctx.fillText(cleared
    ? (isFinal ? '空格 / 回车 → 返回主菜单'
      : '空格 / 回车 → 第 ' + nextStage + ' 关「' + nextScene + '」· BOSS「' + (nextBoss ? nextBoss.name : '?') + '」')
    : '空格 / 回车 → 重试第 ' + s.stage + ' 关', W / 2, py + ph - 34);
  ctx.globalAlpha = 1;
  ctx.font = '12.5px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('Esc → 返回主菜单', W / 2, py + ph - 12);
}

function crossLines(ctx, m, gap, len) {  ctx.beginPath();
  ctx.moveTo(m.x - gap - len, m.y); ctx.lineTo(m.x - gap, m.y);
  ctx.moveTo(m.x + gap, m.y); ctx.lineTo(m.x + gap + len, m.y);
  ctx.moveTo(m.x, m.y - gap - len); ctx.lineTo(m.x, m.y - gap);
  ctx.moveTo(m.x, m.y + gap); ctx.lineTo(m.x, m.y + gap + len);
  ctx.stroke();
}
