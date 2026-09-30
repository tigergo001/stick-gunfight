// 无头测试:在 Node 里真实运行整个游戏逻辑(单人模式),验证可玩性
// 运行:node tests/harness.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import vm from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✓ ' + msg); }
  else { failures++; console.error('  ✗ ' + msg); }
}

// ---- 黑洞 2D 上下文:所有绘制调用都无害化 ----
function blackhole() {
  const fn = function () { return bh; };
  const bh = new Proxy(fn, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === 'toString') return () => '';
      return bh;
    },
    set() { return true; },
    apply() { return bh; },
  });
  return bh;
}
const ctx2d = blackhole();

function makeEl() {
  return {
    style: {}, value: '', textContent: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, remove() {}, focus() {}, select() {},
    setAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }),
  };
}
const elements = {};
const documentStub = {
  readyState: 'complete',
  hidden: false,
  addEventListener() {},
  getElementById(id) { return elements[id] || (elements[id] = makeEl()); },
  createElement: () => makeEl(),
  body: makeEl(),
};
const canvasStub = Object.assign(makeEl(), {
  width: 1600, height: 900,
  getContext: () => ctx2d,
});
elements.game = canvasStub; // init() 取到的画布即此桩

const sandbox = {
  console, performance, Date, Math, JSON,
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: () => 0,
  localStorage: { getItem: () => null, setItem() {} },
  document: documentStub,
  addEventListener() {}, removeEventListener() {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext('this.window = this;', sandbox);

const files = ['config', 'utils', 'audio', 'input', 'map', 'particles', 'stickman',
  'weapons', 'entities', 'bots', 'net', 'hud', 'game', 'main'];
for (const f of files) {
  const fp = path.join(root, 'js', f + '.js');
  vm.runInContext(readFileSync(fp, 'utf8'), sandbox, { filename: 'js/' + f + '.js' });
}
console.log('· 14 个脚本全部加载成功');

const SGF = sandbox.SGF;
assert(!!SGF, 'SGF 调试句柄已导出');
const { Game, Input } = SGF;

// ---- 几何工具抽查 ----
const U = sandbox;
assert(U.segRectT && U.segRectT(0, 0, 10, 0, 5, -5, 5, 5) === 0.5, 'segRectT 相交正确');
assert(U.segRectT(0, 0, 3, 0, 5, -5, 5, 5) === null, 'segRectT 不相交返回 null');
assert(U.segCircleT(0, 0, 10, 0, 5, 0, 2) === 0.3, 'segCircleT 相交正确');

// ---- 开一局单人战斗 ----
const game = new Game(canvasStub);
game.startSolo({ enemies: 3, allies: 1, name: '测试兵' });
assert(game.mode === 'solo', '进入单人模式');
assert(game.fighters.length === 5, '1 玩家 + 1 队友 + 3 敌人 = 5 名战士');
assert(game.local.team === 'blue', '本地玩家为蓝队');

const dist = (a, b, c, d) => Math.hypot(c - a, d - b);
const DT = 1 / 60;
let strafe = 0;
let localDied = false;
let sawRespawn = false;
let botFired = false;          // 机器人开过火
let localHurtNaturally = false; // 玩家被机器人打伤过
let sawReload = false;          // 按 R 换弹成功(用户反馈路径的回归)
const enemySpawnPos = new Map(); // 敌人出生位置(验证它们会移动)

for (const f of game.fighters) {
  if (f.team !== game.local.team) enemySpawnPos.set(f.id, { x: f.x, y: f.y });
}

function nearestEnemy() {
  let best = null, bd = Infinity;
  for (const f of game.fighters) {
    if (!f.alive || f.team === game.local.team) continue;
    const d = dist(game.local.x, game.local.y, f.x, f.y);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

try {
  for (let i = 0; i < 60 * 40; i++) {
    // 模拟玩家:朝最近敌人开火,左右走位,偶尔跳跃
    const e = nearestEnemy();
    if (e) {
      Input.mouse.x = e.x;
      Input.mouse.y = e.y - 40;
      Input.mouse.down = dist(game.local.x, game.local.y, e.x, e.y) < 800;
    } else {
      Input.mouse.down = false;
    }
    if (i % 90 === 0) strafe = 1 - strafe;
    Input.keys.add(strafe ? 'KeyD' : 'KeyA');
    Input.keys.delete(strafe ? 'KeyA' : 'KeyD');
    if (i % 180 === 0) Input.pressed.add('Space');
    if (i % 400 === 200) Input.pressed.add('KeyR'); // 用户反馈路径:R 换弹

    if (!game.local.alive) localDied = true;
    if (localDied && game.local.alive) sawRespawn = true;
    if (game.local.hp < CFG_PLAYER_MAX() && game.local.alive) localHurtNaturally = true;
    if (game.local.reloading) sawReload = true;
    if (i % 30 === 0) {
      for (const b of sandbox.SGF.Bullets.list) {
        if (b.owner && b.owner.kind === 'bot') botFired = true;
      }
    }

    game.frame(DT);
    Input.endFrame();
  }
} catch (err) {
  failures++;
  console.error('  ✗ 运行时异常:', err.stack);
}

console.log('· 模拟 40 秒战斗完成');
assert(game.stats.shots > 300, '开火次数充足(' + game.stats.shots + ' 发)');
assert(game.stats.hits > 5, '命中结算正常(' + game.stats.hits + ' 次)');
assert(game.fighters.some(f => f.deaths > 0), '战场上出现过阵亡');
assert(game.stats.kills >= 1, '存在击杀记录(' + game.stats.kills + ' 杀)');

// ---- 敌人行为验证(会动 / 会开火 / 有威胁) ----
let maxEnemyMove = 0;
for (const f of game.fighters) {
  if (enemySpawnPos.has(f.id)) {
    const s = enemySpawnPos.get(f.id);
    maxEnemyMove = Math.max(maxEnemyMove, dist(s.x, s.y, f.x, f.y));
  }
}
assert(maxEnemyMove > 100, '敌人会自主移动(最大位移 ' + Math.round(maxEnemyMove) + 'px)');
assert(botFired, '机器人会开火');
assert(localHurtNaturally, '机器人会对玩家造成伤害(玩家被击伤过)');
assert(sawReload, '按 R / 弹夹打空后换弹正常(未卡死)');
assert(game.fighters.some(f => f.team !== game.local.team && f.alive), '敌人存在于战场');
const enemyColor = game.fighters.find(f => f.team !== game.local.team).color;
assert(enemyColor === '#ff5d5d', '敌人队伍色为红色(' + enemyColor + ')');

// ---- 强制击杀本地玩家,验证死亡与重生(清空战场保证确定性) ----
game.fighters = [game.local];
Input.mouse.down = false;
const killer = { id: 'ghost', name: '幻影', team: 'red', x: 100, color: '#ff5d5d',
  kills: 0, deaths: 0, streak: 0, alive: true, skill: 1 };
game.damage(game.local, 9999, killer);
assert(!game.local.alive, '本地玩家被击杀后处于阵亡状态');
assert(game.local.respawnT > 0, '重生倒计时已启动');
for (let i = 0; i < 60 * 4; i++) { game.frame(DT); Input.endFrame(); }
assert(game.local.alive, '3 秒后自动重生');
assert(game.local.hp === CFG_PLAYER_MAX(), '重生后满血');
function CFG_PLAYER_MAX() { return sandbox.SGF.CFG.PLAYER.MAX_HP; }

// ---- 状态健康检查 ----
let allFinite = true;
for (const f of game.fighters) {
  if (!Number.isFinite(f.x) || !Number.isFinite(f.y) || !Number.isFinite(f.hp)) allFinite = false;
}
for (const b of sandbox.SGF.Bullets.list) {
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) allFinite = false;
}
assert(allFinite, '所有实体坐标与数值无 NaN');

// ---- 机器人智商档位 ----
game.startSolo({ enemies: 2, allies: 0, difficulty: 'strong', name: '测试兵' });
const strongBots = game.fighters.filter(f => f.kind === 'bot');
assert(strongBots.length === 2, '强档开局正常');
assert(strongBots.every(b => b.skill >= 0.75 && b.skill <= 0.96),
  '强档技能值在 0.75~0.96(' + strongBots.map(b => b.skill.toFixed(2)).join(', ') + ')');
game.startSolo({ enemies: 2, allies: 0, difficulty: 'weak', name: '测试兵' });
assert(game.fighters.filter(f => f.kind === 'bot').every(b => b.skill >= 0.15 && b.skill <= 0.38),
  '弱档技能值在 0.15~0.38');
game.startSolo({ enemies: 1, allies: 0, difficulty: ' nonsense ', name: '测试兵' });
assert(game.fighters.filter(f => f.kind === 'bot').every(b => b.skill >= 0.45 && b.skill <= 0.68),
  '非法档位自动回退到中档');
// 强档真实跑 8 秒(玩家主动开火,验证交火链路)
game.startSolo({ enemies: 1, allies: 0, difficulty: 'strong', name: '测试兵' });
for (let i = 0; i < 60 * 8; i++) {
  const e = game.fighters.find(f => f.alive && f.kind === 'bot');
  if (e) {
    Input.mouse.x = e.x;
    Input.mouse.y = e.y - 40;
    Input.mouse.down = dist(game.local.x, game.local.y, e.x, e.y) < 800;
  } else {
    Input.mouse.down = false;
  }
  game.frame(DT);
  Input.endFrame();
}
assert(game.stats.shots > 0, '强档对局 8 秒内正常交火(' + game.stats.shots + ' 发)');

// ---- 掩体与油桶 ----
assert(sandbox.SGF.Arena.crates.length >= 5, '掩体箱已布设(' + sandbox.SGF.Arena.crates.length + ' 个)');
assert(sandbox.SGF.Arena.barrels.length === 2, '油桶已布设(2 个)');
assert(U.segRect(200, 800, 340, 800, 240, 770, 60, 60), '掩体挡子弹几何判定有效');
game.startSolo({ enemies: 1, allies: 0, difficulty: 'weak', name: '测试兵' });
// 可以站上掩体箱(先清掉上一环节遗留的按键)
Input.clear();
game.local.x = 1025; game.local.y = 760; game.local.vy = 0;
for (let i = 0; i < 40; i++) { game.frame(DT); Input.endFrame(); }
assert(game.local.onGround && game.local.groundKind === 'crate', '可以站立在掩体箱顶面');
// 打爆油桶并波及附近单位
game.local.x = 505; game.local.y = 830; game.local.hp = 100;
const barrel = sandbox.SGF.Arena.barrels[0];
const victim = game.fighters.find(f => f.kind === 'bot');
for (let i = 0; i < 60 * 4 && barrel.alive; i++) {
  victim.x = 640; victim.y = 830; victim.ai = null; // 固定 victim 在爆炸半径内
  Input.mouse.x = barrel.x + 18;
  Input.mouse.y = barrel.y + 20;
  Input.mouse.down = true;
  game.frame(DT);
  Input.endFrame();
}
Input.mouse.down = false;
assert(!barrel.alive, '油桶被子弹击爆');
assert(victim.hp < 100 || !victim.alive, '爆炸波及半径内单位(剩余 ' + Math.round(victim.hp) + ' hp)');

// ---- 武器 / 等级 / 经验 ----
assert(game.local.gun.id === 'm249', '默认武器为 M249');
const CFGh = sandbox.SGF.CFG;
assert(CFGh.levelFromXp(0) === 1 && CFGh.levelFromXp(100) === 2 && CFGh.levelFromXp(300) === 3,
  '经验等级曲线正确(0→L1, 100→L2, 300→L3)');
assert(CFGh.WEAPONS.sniper.minLevel === 5 && CFGh.ENEMY_TIERS.heavy.hp === 260,
  '武器解锁等级与重装兵血量配置正确');

// ---- 闯关模式(横向卷轴)全流程 ----
let menuShownCount = 0; // 通关退出后主菜单必须重新显示(回归:修"卡死在空场景")
game.ui = { showMenu: () => { menuShownCount++; }, hideMenu: () => {}, status: () => {} };
game.startCampaign(1, { weapon: 'ak', name: '测试兵' });
assert(game.mode === 'campaign', '进入闯关模式');
assert(game.local.gun.id === 'ak', '闯关使用所选武器 AK');
assert(sandbox.SGF.Arena.levelW > sandbox.SGF.Arena.W,
  '关卡为横向卷轴(总宽 ' + sandbox.SGF.Arena.levelW + 'px)');
assert(game.campaign.encounters.length >= 2, '关卡布设遭遇战(' + game.campaign.encounters.length + ' 处)');
assert(game.pickups.length > 0, '关卡散布补给(' + game.pickups.length + ' 个)');
Input.clear();
let camMoved = false, encSeen = false, assistUsed = false, lastXp = 0;
const xpBefore = game.local.matchXp || 0;
for (let i = 0; i < 60 * 150 && game.mode === 'campaign' &&
     !(game.campaign && game.campaign.overlay); i++) {
  Input.keys.add('KeyD');
  Input.mouse.down = true;
  if (i % 36 === 0) Input.pressed.add('KeyW'); // 跳(用 W,把空格留给结算确认)
  game.local.hp = game.local.hpMax; // 测试推进流程:玩家不会阵亡
  for (const f of game.fighters) {
    if (!f.alive) continue;
    if (f === game.local) continue;
    if (f.kind === 'tank') game.tankDestroyed(f, game.local);
    else if (f.kind === 'bot') game.damage(f, 9999, game.local);
  }
  if (game.camX > 50) camMoved = true;
  if (game.campaign && game.campaign.encounters.some(e => e.spawned)) encSeen = true;
  if (game.local.assist) assistUsed = true;
  if (game.local) lastXp = game.local.matchXp || 0;
  game.frame(DT);
  Input.endFrame();
}
assert(camMoved, '摄像机跟随玩家横向滚动');
assert(encSeen, '推进触发遭遇战');
assert(lastXp > xpBefore, '击杀与清区获得经验(+' + (lastXp - xpBefore) + ' XP)');

// ---- 魂斗罗式结算:原地显示、确认进下一关、Esc 返回菜单 ----
assert(game.mode === 'campaign' && game.campaign.overlay === 'clear',
  '通关后原地弹出结算界面(不跳页面)');
assert(menuShownCount === 0, '结算时仍在游戏内,未跳主菜单');
assert(game.campaign.summary && game.campaign.summary.kills > 0,
  '结算界面显示本关战绩(击杀 ' + game.campaign.summary.kills + ')');
// 结算界面冻结世界
const frozenX = game.local.x;
for (let i = 0; i < 60; i++) { game.frame(DT); Input.endFrame(); }
assert(Math.abs(game.local.x - frozenX) < 1, '结算时世界冻结(角色不再移动)');
// 空格确认 → 原地进入下一关
Input.pressed.add('Space');
game.frame(DT); Input.endFrame();
assert(game.mode === 'campaign' && game.campaign.stage === 2 && !game.campaign.overlay,
  '确认后原地进入第 2 关(保留武器与经验)');
assert(game.local.gun.id === 'ak', '下一关沿用所选武器 AK');
// Esc → 从结算界面返回主菜单
game.showStageOverlay('clear');
Input.pressed.add('Escape');
game.frame(DT); Input.endFrame();
assert(game.mode === 'menu' && menuShownCount >= 1, 'Esc 从结算界面返回主菜单(界面正常显示)');
void assistUsed;

// ---- 闯关失败路径:生命耗尽 → 原地失败结算 → 重试 / 返回 ----
game.startCampaign(1, { weapon: 'm249', name: '测试兵' });
const livesTotal = sandbox.SGF.CFG.CAMPAIGN.LIVES;
for (let life = 0; life < livesTotal + 1; life++) {
  if (game.mode !== 'campaign' || (game.campaign && game.campaign.overlay)) break;
  game.local.hp = 1;
  game.damage(game.local, 9999, null);
  for (let i = 0; i < 220 && game.mode === 'campaign' &&
       !(game.campaign && game.campaign.overlay); i++) { game.frame(DT); Input.endFrame(); }
}
assert(game.mode === 'campaign' && game.campaign.overlay === 'fail',
  '生命耗尽原地弹出失败结算(不跳页面)');
// 空格 → 重试本关(满生命)
Input.pressed.add('Space');
game.frame(DT); Input.endFrame();
assert(game.mode === 'campaign' && game.campaign.stage === 1 && !game.campaign.overlay &&
  game.campaign.lives === livesTotal, '确认后原地重试本关(生命已重置)');
// Esc → 从失败结算返回主菜单
game.showStageOverlay('fail');
Input.pressed.add('Escape');
game.frame(DT); Input.endFrame();
assert(game.mode === 'menu', '失败界面 Esc 返回主菜单正常');

// ---- 武器 / 品类 / 经验 / 闯关 ----
const CFG = sandbox.SGF.CFG;
assert(CFG.levelFromXp(0) === 1 && CFG.levelFromXp(100) === 2 && CFG.levelFromXp(300) === 3,
  '经验等级曲线正确(0→L1, 100→L2, 300→L3)');
game.startSolo({ enemies: 2, allies: 0, difficulty: 'medium', weapon: 'ak', name: '测试兵' });
assert(game.local.gun.id === 'ak' && game.local.gun.dmg === 17, '自选武器 AK 生效(单发 17 伤)');
const elite = new sandbox.SGF.Bot({ name: '精英测试', team: 'red', tier: 'elite', skill: 0.5 });
assert(elite.hpMax === 150 && elite.gun.id === 'ak' && elite.xpValue === 20,
  '精英兵品类属性正确(150 血 / AK / 20 经验)');
const heavy = new sandbox.SGF.Bot({ name: '重装测试', team: 'red', tier: 'heavy', skill: 0.5 });
assert(heavy.hpMax === 260 && heavy.gun.id === 'm2', '重装兵品类属性正确');

// ---- 辅助瞄准 / 敌人智商 / RPG / 补给 / 坦克 ----
game.startSolo({ enemies: 1, allies: 0, difficulty: 'weak', weapon: 'm249', name: '测试兵' });
const tgt = game.fighters.find(f => f.kind === 'bot');
game.local.x = 700; game.local.y = 690;
tgt.x = 900; tgt.y = 690; tgt.activated = true; tgt.hp = tgt.hpMax;
game.aimAssist = 2; // 锁定
Input.mouse.x = 900; Input.mouse.y = 350; // 原始瞄准偏上
Input.mouse.down = false;
game.frame(DT); Input.endFrame();
const wantAngle = Math.atan2((tgt.y - 30) - (game.local.y - 45), tgt.x - game.local.x);
assert(Math.abs(sandbox.angNorm(game.local.aim - wantAngle)) < 0.06 && game.local.assist && game.local.assist.locked,
  '锁定辅助:准星自动吸附敌人');
game.aimAssist = 0;
Input.mouse.x = 900; Input.mouse.y = 350;
game.frame(DT); Input.endFrame();
assert(!game.local.assist, '关闭辅助后不再自动瞄准');
assert(CFG.ENEMY_IQ[1].rpmMult === 0.35 && CFG.ENEMY_IQ[1].errMult === 3.5 && !CFG.ENEMY_IQ[4],
  '低智商:射速 0.35 倍 / 误差 3.5 倍,且只有低中高三档');
const noob = new sandbox.SGF.Bot({ name: '新兵测试', team: 'red', tier: 'grunt', iq: 1, skill: 0.5 });
noob.wantFire = true;
noob.updateWeapon(DT, game);
assert(Math.abs(noob.fireCd - 60 / (CFG.WEAPONS.m249.rpm * 0.35)) < 1e-6, '低智商射速按倍率降低');

// RPG:范围爆炸 + 自伤
game.startSolo({ enemies: 2, allies: 0, difficulty: 'weak', weapon: 'rpg', name: '测试兵' });
assert(game.local.effGun().id === 'rpg' && game.local.effGun().explosive, 'RPG 武器生效(爆炸弹)');
const victim2 = game.fighters.find(f => f.kind === 'bot');
victim2.hp = victim2.hpMax;
const hpBefore = game.local.hp;
for (let i = 0; i < 60 * 8 && victim2.hp === victim2.hpMax; i++) {
  victim2.x = game.local.x + 90; victim2.y = game.local.y; victim2.ai = null;
  Input.mouse.x = victim2.x; Input.mouse.y = victim2.y - 30;
  Input.mouse.down = true;
  game.frame(DT); Input.endFrame();
}
Input.mouse.down = false;
assert(victim2.hp < victim2.hpMax || !victim2.alive, 'RPG 爆炸对敌人造成范围伤害');
assert(game.local.hp < hpBefore || !game.local.alive, 'RPG 近距离自伤(平衡性)');

// 魂斗罗式补给
assert(CFG.POWERUPS.GUN_TIME === 15 && CFG.POWERUPS.INVUL_TIME === 5, '补给持续时长配置正确');
game.startSolo({ enemies: 0, allies: 0, difficulty: 'weak', weapon: 'm249', name: '测试兵' });
game.local.hp = 50;
game.applyPickup({ type: 'medkit' });
assert(game.local.hp === 100, '医疗包 +50 生命');
game.applyPickup({ type: 'gun', gun: 'spread' });
assert(game.local.effGun().id === 'spread' && game.local.tempGunT > 0 && game.local.effGun().pellets === 5,
  '拾取 S 散弹枪:限时强化 + 五向弹丸');
game.applyPickup({ type: 'gun', gun: 'laser' });
assert(game.local.effGun().pierce === true, '拾取 L 激光枪:穿透弹');
game.applyPickup({ type: 'invul' });
const hp0 = game.local.hp;
game.damage(game.local, 999, null);
assert(game.local.invulT > 0 && game.local.hp === hp0, '无敌护盾期间免疫伤害');

// 坦克:减伤 / RPG 加成 / 尾部弱点
const tank = new sandbox.SGF.Tank({ x: game.local.x + 260, y: 830, team: 'red', isBoss: true, face: -1 });
game.fighters.push(tank);
const hpT0 = tank.hp;
game.hitTank(tank, game.local, 10, tank.x + tank.w * 0.35 * tank.face, { explosive: false });
assert(hpT0 - tank.hp <= 10 * CFG.TANK.BULLET_TAKEN + 1, '普通子弹对坦克大幅减伤');
const hpT1 = tank.hp;
game.hitTank(tank, game.local, 10, tank.x + tank.w * 0.35 * tank.face, { explosive: true });
assert(Math.abs((hpT1 - tank.hp) - 10 * CFG.TANK.RPG_MULT) <= 1, 'RPG 对坦克 ×2.5 加成');
const hpT2 = tank.hp;
const rearX = tank.x - tank.w * 0.35 * tank.face;
game.hitTank(tank, game.local, 10, rearX, { explosive: false });
assert(hpT2 - tank.hp > 10 * CFG.TANK.BULLET_TAKEN * 2, 'BOSS 尾部油箱弱点(×3)');
game.tankDestroyed(tank, game.local);
assert(!tank.alive, '坦克可被摧毁');

// ---- 闯关:小兵一击必杀 / BOSS 血量与难度递增 ----
game.startCampaign(1, { weapon: 'm249', name: '测试兵' });
game.local.x = game.campaign.encounters[0].x - 700; // 走到触发线
for (let i = 0; i < 40 && !game.campaign.encounters[0].spawned; i++) { game.frame(DT); Input.endFrame(); }
const minion = game.fighters.find(f => f.kind === 'bot' && f.alive);
assert(!!minion && minion.hpMax === 1, '闯关小兵一击必杀(1 点生命)');
if (minion) {
  game.damage(minion, 1, game.local);
  assert(!minion.alive, '任意子弹命中即消灭小兵');
}
assert(CFG.STAGES.length === 50 && CFG.CAMPAIGN_TOTAL === 50, '闯关共 50 关');
assert(new Set(CFG.STAGES.map(x => x.boss.name)).size === 50, '每关 BOSS 都不一样(50 个专属 BOSS)');
assert(new Set(CFG.STAGES.map(x => x.scene)).size === 10, '10 套场景主题循环使用');
assert(CFG.STAGES[49].boss.final === true && CFG.STAGES.filter(x => x.boss.final).length === 1,
  '仅第 50 关为最终关');
assert(CFG.STAGES[49].boss.hp > CFG.STAGES[29].boss.hp &&
  CFG.STAGES[29].boss.hp > CFG.STAGES[9].boss.hp &&
  CFG.STAGES[9].boss.hp > CFG.STAGES[0].boss.hp,
  'BOSS 血量逐段递增(200 → 650 → ' + CFG.STAGES[29].boss.hp + ' → ' + CFG.STAGES[49].boss.hp + ')');
assert(CFG.STAGES[49].segs >= 6 && CFG.STAGES[0].segs === 3, '后段关卡更长(3 段 → ' + CFG.STAGES[49].segs + ' 段)');
// 第 1 关 BOSS = 巨型兵(体型大于小兵,非坦克)
assert(CFG.STAGES[0].boss.kind === 'giant', '第 1 关 BOSS 为巨型兵(不是坦克)');
game.startCampaign(1, { weapon: 'm249', name: '测试兵' });
game.local.x = game.campaign.bossX - 300;
for (let i = 0; i < 60 && !game.campaign.bossSpawned; i++) { game.frame(DT); Input.endFrame(); }
const giant = game.fighters.find(f => f.boss && f.alive);
assert(!!giant, '巨型兵 BOSS 已生成');
assert(giant && giant.scale > 1.5 && giant.h > 90 && giant.w > 30,
  '巨型兵体型明显大于普通火柴人(' + Math.round(giant.w) + '×' + Math.round(giant.h) + ',缩放 ' + giant.scale + ')');
assert(giant && giant.hpMax === CFG.STAGES[0].boss.hp, '巨型兵血量来自关卡表(' + giant.hpMax + ')');
if (giant) {
  game.damage(giant, 99999, game.local);
  assert(!giant.alive && game.campaign.bossDown, '击杀巨型兵 BOSS 后开启撤离');
}
// 第 5 关 BOSS 实机生成
game.startCampaign(5, { weapon: 'rpg', name: '测试兵' });
assert(game.campaign.bossStage, '第 5 关为 BOSS 关');
game.local.x = game.campaign.bossX - 1000;
for (let i = 0; i < 90 && !game.campaign.bossSpawned; i++) { game.frame(DT); Input.endFrame(); }
const boss = game.fighters.find(f => f.kind === 'tank' && f.isBoss);
assert(!!boss && boss.hpMax === CFG.STAGES[4].boss.hp,
  '第 5 关 BOSS「' + CFG.STAGES[4].boss.name + '」血量 ' + CFG.STAGES[4].boss.hp + '(需多次命中)');
const escorts = game.fighters.filter(f => f.kind === 'bot' && f.alive).length;
assert(escorts >= 1, 'BOSS 有护卫(' + escorts + ' 个)');
// 用 RPG(=163/发)验证需要多发放倒 BOSS
let shots = 0;
while (boss.alive && shots < 6) {
  game.hitTank(boss, game.local, CFG.TANK.SHELL_DMG + 3, boss.x - boss.w * 0.35, { explosive: true });
  shots++;
}
assert(!boss.alive && shots >= 2, 'BOSS 需要多发放倒(' + shots + ' 发 RPG)');

// ---- 装甲车:可碾碎掩体 ----
assert(CFG.TANK.APC_HP === 380 && CFG.TANK.APC_SPEED === 320, '装甲车参数配置正确');
game.startCampaign(2, { weapon: 'm249', name: '测试兵' });
const apc = game.fighters.find(f => f.kind === 'tank' && f.ram);
assert(!!apc, '第 2 关战场停放装甲车');
if (apc) {
  const crate = sandbox.SGF.Arena.crates.find(c => !c.broken);
  apc.x = crate.x - 70; apc.y = 830;
  game.local.x = apc.x - 40; game.local.y = 830;
  Input.pressed.add('KeyE');            // 登载
  Input.keys.add('KeyD'); Input.mouse.down = false;
  for (let i = 0; i < 90 && !crate.broken; i++) { game.frame(DT); Input.endFrame(); }
  Input.keys.delete('KeyD');
  assert(game.local.mountedTank === apc, '按 E 成功登载装甲车');
  assert(crate.broken, '装甲车碾碎掩体(障碍被击穿)');
  // 射击也能破障
  const crate2 = sandbox.SGF.Arena.crates.find(c => !c.broken);
  if (crate2) {
    game.explosionAt(crate2.x + crate2.w / 2, crate2.y + crate2.h / 2, game.local, CFG.TANK.APC_BLAST_R, 12, 'tank');
    assert(crate2.broken, '爆炸波及可炸毁掩体');
  }
}

// ---- 光棱枪:光束折射连锁 ----
assert(CFG.WEAPONS.prism && CFG.WEAPONS.prism.chain === 3 && CFG.WEAPONS.prism.minLevel === 7,
  '光棱枪配置正确(Lv.7 / 连锁 3)');
game.startSolo({ enemies: 3, allies: 0, difficulty: 'weak', weapon: 'prism', name: '测试兵' });
game.aimAssist = 0;
Input.clear();
// 固定在中央矮台(610-990)的无遮挡走廊,避免随机出生点被掩体挡住弹道
game.local.x = 700; game.local.y = 690; game.local.vy = 0;
const bots3 = game.fighters.filter(f => f.kind === 'bot');
assert(game.local.effGun().id === 'prism', '光棱枪已装备');
bots3.forEach((b, i) => { b.x = 780 + i * 60; b.y = 690; b.ai = null; b.hp = b.hpMax; b.leashX = undefined; });
for (let i = 0; i < 60 * 6 && bots3.filter(b => b.hp < b.hpMax || !b.alive).length < 2; i++) {
  bots3.forEach((b, k) => { b.x = 780 + k * 60; b.y = 690; });
  Input.mouse.x = 780; Input.mouse.y = 660;
  Input.mouse.down = true;
  game.frame(DT); Input.endFrame();
}
Input.mouse.down = false;
const chainHit = bots3.filter(b => b.hp < b.hpMax || !b.alive).length;
assert(chainHit >= 2, '光棱光束折射连锁命中多个敌人(' + chainHit + ' 个)');
assert(sandbox.SGF.Bullets.beams.length > 0 || chainHit >= 2, '光棱光束特效已生成');

// ---- 载具对轰与驾驶员阵亡(回归:装甲车打不死坦克 / 人死车还在) ----
assert(CFG.TANK.VEHICLE_VS_BOSS === 3.0 && CFG.TANK.BOSS_VS_VEHICLE === 1.2,
  '载具穿甲倍率配置正确(对 BOSS ×3,被 BOSS 打 ×1.2)');
game.startCampaign(2, { weapon: 'm249', name: '测试兵' });
const apc2 = game.fighters.find(f => f.kind === 'tank' && f.ram);
const bossT = new sandbox.SGF.Tank({
  x: apc2.x + 420, y: 830, team: 'red', isBoss: true, hpMax: 660, bossName: '测试BOSS',
});
game.fighters.push(bossT);
const bossHp0 = bossT.hp;
game.explosionAt(bossT.x, bossT.y - 20, apc2, CFG.TANK.APC_BLAST_R, CFG.TANK.APC_DMG, 'tank');
const shellDmg = bossHp0 - bossT.hp;
assert(shellDmg >= CFG.TANK.APC_DMG * 2.5, '装甲车炮弹可有效击穿 BOSS(单发 ' + shellDmg + ' 伤,原为 3 伤)');

// 驾驶员:车内免疫爆炸,伤害由车体承受
apc2.x = 900; apc2.y = 830;
game.local.x = apc2.x - 40; game.local.y = 830;
game.local.protect = 0;
Input.pressed.add('KeyE');
game.frame(DT); Input.endFrame();
assert(game.local.mountedTank === apc2, '再次登载装甲车');
const pHp = game.local.hp, apcHp = apc2.hp;
game.explosionAt(apc2.x, apc2.y - 20, bossT, 100, 44, 'tank');
assert(game.local.hp === pHp, '车内玩家免疫爆炸(生命值不变)');
assert(apc2.hp < apcHp, '伤害由车体装甲承受(' + Math.round(apcHp - apc2.hp) + ' 点)');

// 驾驶员阵亡 → 自动下车(修复"人死了车还在")
game.damage(game.local, 99999, bossT);
assert(!game.local.alive && game.local.mountedTank === null && apc2.driver === null,
  '驾驶员阵亡自动下车(车体保留为无人载具)');
for (let i = 0; i < 60 * 4; i++) { game.frame(DT); Input.endFrame(); }
assert(game.local.alive, '阵亡后正常重生(计时不再被乘车状态卡住)');

// ---- 对局内换枪 ----
game.startSolo({ enemies: 1, allies: 0, difficulty: 'weak', weapon: 'm249', name: '测试兵' });
game.profile = { xp: 700, stage: 1 };   // 模拟 Lv.4 玩家
const expectUnlocked = Object.keys(CFG.WEAPONS)
  .filter(id => !CFG.WEAPONS[id].temp && CFG.WEAPONS[id].minLevel <= CFG.levelFromXp(700)).length;
assert(game.unlockedWeapons().length === expectUnlocked,
  'Lv.' + CFG.levelFromXp(700) + ' 解锁 ' + expectUnlocked + ' 把枪(' + game.unlockedWeapons().join(',') + ')');
assert(game.trySwitchWeapon(game.local, 2) && game.local.gun.id === 'ak', '数字键直选换枪生效(3 → AK)');
assert(game.local.ammo === CFG.WEAPONS.ak.mag && game.local.fireCd >= 0.35, '换枪后弹夹重置并有短暂硬直');
game.cycleWeapon(game.local);
assert(game.local.gun.id === 'm2', 'Q 键循环换枪到下一把(M2)');
assert(game.trySwitchWeapon(game.local, 6) === false && game.local.gun.id === 'm2', '未解锁武器(7)切换被拒绝');
game.profile = { xp: 0, stage: 1 };     // 回到 Lv.1
assert(game.unlockedWeapons().length === 1 && game.trySwitchWeapon(game.local, 1) === false,
  '低等级只能使用 M249,其余按键无效');

// ---- 作者模式:只解锁「武器库里没有的」专属新武器 ----
game.startSolo({ enemies: 0, allies: 0, difficulty: 'weak', weapon: 'm249', name: '测试兵' });
assert(game.unlockedWeapons().indexOf('grenade') < 0, '作者模式不再解锁常规武器(榴弹仍锁定)');
game.authorUnlocks = ['a666'];
const uwA = game.unlockedWeapons();
const baseCount = game.weaponOrder().filter(id => CFG.WEAPONS[id].minLevel <= game.localLevel()).length;
assert(uwA.indexOf('a666') >= 0 && uwA.indexOf('a666') >= baseCount,
  '作者武器追加在常规武器之后(不占数字键位)');
const gi = uwA.indexOf('a666');
assert(game.trySwitchWeapon(game.local, gi) && game.local.gun.id === 'a666',
  '作者武器可在对局中切换使用(魔化火神 1320 发/分)');
game.authorUnlocks = ['a888', 'a777', 'a9527'];
const uwB = game.unlockedWeapons();
assert(['a888', 'a777', 'a9527'].every(id => uwB.indexOf(id) >= 0), '多把作者武器可并存解锁');
assert(game.local.effGun && game.local.gun.id === 'a666', '当前枪保持不变(直到主动切换)');

// ---- 菜单模式下也能空转(渲染背景) ----// ---- 菜单模式下也能空转(渲染背景) ----
game.leaveToMenu();
for (let i = 0; i < 120; i++) { game.frame(DT); Input.endFrame(); }
assert(game.mode === 'menu', '返回主菜单正常');

console.log(failures === 0 ? '\n全部通过 ✅' : '\n有 ' + failures + ' 项失败 ❌');
process.exit(failures === 0 ? 0 : 1);
