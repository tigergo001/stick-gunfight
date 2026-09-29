'use strict';
// ===== 机器人 AI =====
function updateBot(game, b, dt) {
  if (!b.alive) return;
  const iq = CFG.ENEMY_IQ[b.iq] || CFG.ENEMY_IQ[1];
  // 驻守态(卷轴模式):未被激活时不索敌不移动
  if (!b.activated) {
    b.mx = 0;
    b.wantFire = false;
    b.aim = Math.atan2(0, b.face);
    return;
  }
  if (!b.ai) {
    b.ai = {
      target: null, targetId: null, think: 0,
      strafe: 1, strafeT: 0,
      burst: 0, pause: rand(0.2, 0.6), react: 0,
      errA: 0, jumpCd: 0, stuckT: 0, lastX: b.x,
      wanderX: rand(120, Arena.W - 120), wanderT: 0,
    };
  }
  const ai = b.ai;
  ai.think -= dt; ai.strafeT -= dt; ai.jumpCd -= dt;

  // ---- 选目标 ----
  if (ai.think <= 0 || !ai.target || !ai.target.alive) {
    ai.think = rand(0.3, 0.6);
    let best = null, bd = Infinity;
    for (const f of game.fighters) {
      if (!f.alive || f.team === b.team) continue;
      const d = dist(b.x, b.y, f.x, f.y);
      if (d < bd) { bd = d; best = f; }
    }
    if (best && best.id !== ai.targetId) {
      ai.react = rand(iq.reactMin, iq.reactMax); // 智商决定反应时间
      ai.targetId = best.id;
    }
    ai.target = best;
  }

  b.wantFire = false;
  b.wantReload = false;
  const isSniper = b.gun.id === 'sniper';
  const engageRange = isSniper ? 1400 : 900;
  const band = isSniper ? 520 : 300;

  // ---- 无目标:游荡 ----
  if (!ai.target) {
    ai.wanderT -= dt;
    if (ai.wanderT <= 0 || Math.abs(b.x - ai.wanderX) < 30) {
      ai.wanderX = rand(120, Arena.W - 120);
      ai.wanderT = rand(2, 4);
    }
    b.mx = clamp(Math.sign(ai.wanderX - b.x) * 0.6, -1, 1);
    b.aim = Math.atan2(0, b.mx);
    b.face = b.mx >= 0 ? 1 : -1;
    if (b.onGround && Math.random() < 0.004) b.jumpBuf = CFG.JUMP_BUFFER;
    if (b.ammo < b.gun.mag * 0.5) b.wantReload = true;
    return;
  }

  const t = ai.target;
  // 驻守范围:离出生点/驻守点太远则回撤(防止残敌跑远导致遭遇战无法清场)
  if (b.leashX !== undefined && Math.abs(b.x - b.leashX) > CFG.CAMPAIGN.LEASH) {
    b.mx = Math.sign(b.leashX - b.x);
    b.wantFire = false;
    b.aim = Math.atan2(0, b.mx);
    b.face = b.mx >= 0 ? 1 : -1;
    if (b.onGround && Math.random() < 0.06) b.jumpBuf = CFG.JUMP_BUFFER;
    return;
  }
  const dx = t.x - b.x;
  const dy = (t.y - 38) - (b.y - 38);
  const d = Math.hypot(dx, dy);
  const los = Arena.losClear(b.x, b.y - 42, t.x, t.y - 40);

  // ---- 移动:保持距离 + 走位 ----
  if (ai.strafeT <= 0) {
    ai.strafe = Math.random() < 0.5 ? -1 : 1;
    ai.strafeT = rand(0.6, 1.5);
  }
  let mv = 0;
  if (d > band + 70) mv = Math.sign(dx);
  else if (d < band - 70) mv = -Math.sign(dx);
  b.mx = clamp(mv * 0.9 + ai.strafe * 0.75, -1, 1);

  // 平台机动
  if (b.onGround && ai.jumpCd <= 0) {
    if (dy < -70 && Math.abs(dx) < 150 && Math.random() < 0.5) {
      b.jumpBuf = CFG.JUMP_BUFFER; ai.jumpCd = 0.7;      // 目标在上方 → 跳
    } else if (Math.random() < 0.08) {
      b.jumpBuf = CFG.JUMP_BUFFER; ai.jumpCd = rand(0.5, 1.1); // 走位跳
    }
  }
  if (dy > 70 && b.groundKind === 'platform' && Math.random() < 0.03) {
    b.dropThrough = 0.22;                                // 目标在下方 → 落下
  }
  // 卡住检测
  if (Math.abs(b.x - ai.lastX) < 2 && Math.abs(b.mx) > 0.1) {
    ai.stuckT += dt;
    if (ai.stuckT > 0.6 && b.onGround) { b.jumpBuf = CFG.JUMP_BUFFER; ai.stuckT = 0; }
  } else ai.stuckT = 0;
  ai.lastX = b.x;

  // ---- 瞄准(智商决定预判与误差;狙击手更冷静) ----
  const lead = (d / b.gun.speed) * (0.4 + b.skill * 0.6) * iq.leadMult;
  const px = t.x + t.vx * lead;
  const py = t.y - 38 + t.vy * lead * 0.5;
  const want = Math.atan2(py - (b.y - 42), px - b.x);
  ai.react -= dt;
  if (ai.react <= 0) {
    const errScale = (isSniper ? 0.45 : 1) * iq.errMult;
    ai.errA = lerp(ai.errA, gauss() * (1 - b.skill) * 0.22 * errScale * Math.min(1, d / 500), 0.12);
  }
  b.aim = want + ai.errA;
  b.face = Math.cos(b.aim) >= 0 ? 1 : -1;

  // ---- 点射开火 ----
  const aimOff = Math.abs(angNorm(want - b.aim));
  if (los && ai.react <= 0 && d < engageRange) {
    if (ai.burst > 0) {
      ai.burst -= dt;
      b.wantFire = isSniper ? aimOff < 0.08 : aimOff < 0.3;
      if (ai.burst <= 0) ai.pause = (isSniper ? rand(0.8, 1.6) : rand(0.25, 0.7) * (1.4 - b.skill)) * (1 + (3 - b.iq) * 0.35);
    } else {
      ai.pause -= dt;
      if (ai.pause <= 0) ai.burst = isSniper ? rand(0.12, 0.3) : rand(0.25, 0.7);
    }
  }
  // 安全换弹
  if ((!los || d > engageRange - 100) && b.ammo < b.gun.mag * 0.35) b.wantReload = true;
}
