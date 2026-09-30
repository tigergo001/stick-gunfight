'use strict';
// ===== 全局配置 / 手感调参都在这里 =====
const CFG = {
  WORLD: { W: 1600, H: 900 },
  GRAVITY: 2300,
  MOVE_SPEED: 340,
  ACCEL_GROUND: 3200,
  ACCEL_AIR: 1700,
  FRICTION_GROUND: 2600,
  JUMP_VEL: 950,
  COYOTE: 0.09,          // 土狼时间:离开平台后仍可跳
  JUMP_BUFFER: 0.12,     // 跳跃缓冲:落地前按跳也生效
  PLAYER: { W: 22, H: 54, MAX_HP: 150 },
  // ===== 辅助瞄准(联机强制关闭) =====
  AIM_ASSIST: {
    OFF: 0, ASSIST: 1, LOCK: 2,
    CONE: 0.244,          // 辅助夹角 14°
    BLEND: 0.55,          // 修正比例
  },
  // ===== 敌人智商(低/中/高三档;数值大幅下调,保证闯关可通关) =====
  ENEMY_IQ: {
    1: { name: '低', stars: '★',   rpmMult: 0.35, errMult: 3.5, reactMin: 1.00, reactMax: 1.80, leadMult: 0.0, speedMult: 0.72 },
    2: { name: '中', stars: '★★',  rpmMult: 0.55, errMult: 2.2, reactMin: 0.70, reactMax: 1.20, leadMult: 0.3, speedMult: 0.84 },
    3: { name: '高', stars: '★★★', rpmMult: 0.75, errMult: 1.4, reactMin: 0.45, reactMax: 0.80, leadMult: 0.7, speedMult: 0.95 },
  },
  // ===== 枪械库(按用户等级解锁) =====
  WEAPONS: {
    m249:   { id: 'm249', name: 'M249 机枪',  minLevel: 1, rpm: 660, dmg: 9,  mag: 100, reload: 2.2, speed: 1500, range: 1500, spreadBase: 0.018, spreadMax: 0.085, spreadPerShot: 0.011, spreadCool: 0.55, recoil: 9,  headMult: 1.7, desc: '全能 · 100 发弹链' },
    uzi:    { id: 'uzi',  name: 'UZI 冲锋枪', minLevel: 2, rpm: 900, dmg: 6,  mag: 80,  reload: 1.6, speed: 1350, range: 1100, spreadBase: 0.030, spreadMax: 0.110, spreadPerShot: 0.009, spreadCool: 0.45, recoil: 6,  headMult: 1.6, desc: '极高速 · 近战泼水' },
    ak:     { id: 'ak',   name: 'AK 突击步枪', minLevel: 3, rpm: 420, dmg: 17, mag: 60,  reload: 2.0, speed: 1800, range: 1700, spreadBase: 0.008, spreadMax: 0.050, spreadPerShot: 0.014, spreadCool: 0.6, recoil: 12, headMult: 1.9, desc: '高伤精准 · 点射神器' },
    m2:     { id: 'm2',   name: 'M2 重机枪',  minLevel: 4, rpm: 300, dmg: 30, mag: 40,  reload: 3.0, speed: 1900, range: 1900, spreadBase: 0.030, spreadMax: 0.120, spreadPerShot: 0.030, spreadCool: 0.4, recoil: 22, headMult: 1.8, desc: '炮弹威力 · 火力压制' },
    sniper: { id: 'sniper', name: 'AWM 狙击枪', minLevel: 5, rpm: 55, dmg: 46, mag: 8,   reload: 2.6, speed: 2600, range: 2400, spreadBase: 0.002, spreadMax: 0.020, spreadPerShot: 0.050, spreadCool: 0.8, recoil: 30, headMult: 2.2, desc: '一击致命 · 千里之外' },
    flame:  { id: 'flame',  name: '火焰喷射器', minLevel: 13, rpm: 600, dmg: 3,  mag: 200, reload: 2.4, speed: 520,  range: 340,  spreadBase: 0.06, spreadMax: 0.14, spreadPerShot: 0, spreadCool: 1.0, recoil: 2,  headMult: 1.0, burn: { dps: 8, dur: 3 }, desc: '持续灼烧 · 火焰舔舐' },
    cryo:   { id: 'cryo',   name: '冰冻枪',     minLevel: 14, rpm: 220, dmg: 9,  mag: 40,  reload: 2.0, speed: 1600, range: 900,  spreadBase: 0.01, spreadMax: 0.05, spreadPerShot: 0.01, spreadCool: 0.8, recoil: 5,  headMult: 1.2, slow: { mult: 0.5, dur: 2 }, desc: '冰冻减速 · 控制全场' },
    homing: { id: 'homing', name: '追踪导弹',   minLevel: 15, rpm: 45,  dmg: 55, mag: 4,   reload: 3.0, speed: 600,  range: 2000, spreadBase: 0.02, spreadMax: 0.05, spreadPerShot: 0.01, spreadCool: 0.7, recoil: 14, headMult: 1.0, explosive: true, blastR: 90, blastDmg: 40, homing: true, turn: 3.2, desc: '自动追踪 · 指哪打哪' },
    sonic:  { id: 'sonic',  name: '音波炮',     minLevel: 16, rpm: 50,  dmg: 26, mag: 12,  reload: 2.2, speed: 1000, range: 800,  spreadBase: 0, spreadMax: 0, spreadPerShot: 0, spreadCool: 1.0, recoil: 10, headMult: 1.0, pierce: true, knock: 520, beam: true, desc: '音波冲击 · 击飞穿透' },
    shotgun:{ id: 'shotgun', name: '霰弹枪',   minLevel: 8, rpm: 75,  dmg: 11, mag: 6,   reload: 2.6, speed: 1300, range: 620,  spreadBase: 0.085, spreadMax: 0.16, spreadPerShot: 0.02, spreadCool: 0.9, recoil: 26, headMult: 1.3, pellets: 8, desc: '八颗弹丸 · 贴脸蒸发' },
    grenade:{ id: 'grenade', name: '榴弹发射器', minLevel: 9, rpm: 80,  dmg: 34, mag: 6,   reload: 2.8, speed: 780, range: 1200, spreadBase: 0.02, spreadMax: 0.05, spreadPerShot: 0.01, spreadCool: 0.7, recoil: 18, headMult: 1.0, explosive: true, blastR: 92, blastDmg: 46, fuse: 1.1, desc: '抛射榴弹 · 延时爆炸' },
    dualsmg:{ id: 'dualsmg', name: '双持冲锋枪', minLevel: 10, rpm: 1100, dmg: 5, mag: 160, reload: 2.2, speed: 1350, range: 900,  spreadBase: 0.045, spreadMax: 0.14, spreadPerShot: 0.008, spreadCool: 0.4, recoil: 7,  headMult: 1.5, pellets: 2, desc: '双枪齐射 · 弹幕压制' },
    tesla:  { id: 'tesla',  name: '特斯拉电枪', minLevel: 11, rpm: 300, dmg: 14, mag: 60,  reload: 2.2, speed: 3000, range: 700,  spreadBase: 0.01, spreadMax: 0.04, spreadPerShot: 0.006, spreadCool: 0.8, recoil: 4,  headMult: 1.4, beam: true, chain: 5, chainRange: 260, chainFalloff: 0.8, desc: '电弧跳跃 · 连锁五人' },
    plasma: { id: 'plasma', name: '等离子炮',  minLevel: 12, rpm: 40,  dmg: 78, mag: 4,   reload: 3.0, speed: 2400, range: 2200, spreadBase: 0.0,   spreadMax: 0.02, spreadPerShot: 0.02, spreadCool: 1.0, recoil: 34, headMult: 1.6, pierce: true, pierceArmor: true, beam: true, desc: '贯穿一切 · 破甲重炮' },
    a666:   { id: 'a666',   name: '★ 魔化火神', minLevel: 99, hidden: true, authorCode: 666,  rpm: 1320, dmg: 7,  mag: 200, reload: 1.8, speed: 1500, range: 1500, spreadBase: 0.03, spreadMax: 0.10, spreadPerShot: 0.006, spreadCool: 0.5, recoil: 6,  headMult: 1.4, pellets: 1, desc: '双管魔改 · 1320 发/分 弹雨' },
    a888:   { id: 'a888',   name: '★ 黄金狙击', minLevel: 99, hidden: true, authorCode: 888,  rpm: 60,  dmg: 200, mag: 5,   reload: 2.4, speed: 3000, range: 2600, spreadBase: 0, spreadMax: 0, spreadPerShot: 0.03, spreadCool: 1.0, recoil: 34, headMult: 2.5, desc: '黄金涂装 · 一击必杀' },
    a777:   { id: 'a777',   name: '★ 奇点棱镜', minLevel: 99, hidden: true, authorCode: 777,  rpm: 90,  dmg: 40, mag: 30,  reload: 2.2, speed: 4200, range: 1600, spreadBase: 0, spreadMax: 0, spreadPerShot: 0, spreadCool: 1.2, recoil: 5,  headMult: 1.5, beam: true, chain: 6, chainRange: 420, chainFalloff: 0.85, desc: '奇点折射 · 六连锁' },
    a9527:  { id: 'a9527',  name: '★ 湮灭炮',   minLevel: 99, hidden: true, authorCode: 9527, rpm: 40,  dmg: 90, mag: 4,   reload: 3.0, speed: 2600, range: 2400, spreadBase: 0, spreadMax: 0.02, spreadPerShot: 0.02, spreadCool: 1.0, recoil: 34, headMult: 1.6, pierce: true, pierceArmor: true, beam: true, desc: '贯穿一切 · 破甲重炮' },
    prism:  { id: 'prism',  name: '光棱枪',    minLevel: 7, rpm: 90, dmg: 34, mag: 30,  reload: 2.4, speed: 4200, range: 1400, spreadBase: 0.0,   spreadMax: 0.0,   spreadPerShot: 0.0,   spreadCool: 1.2, recoil: 6,  headMult: 1.5, beam: true, chain: 3, chainRange: 340, chainFalloff: 0.7, desc: '光棱折射 · 连锁三杀' },
    rpg:    { id: 'rpg',    name: 'RPG-7 火箭筒', minLevel: 6, rpm: 24, dmg: 65, mag: 1,   reload: 2.8, speed: 900, range: 1800, spreadBase: 0.010, spreadMax: 0.030, spreadPerShot: 0.020, spreadCool: 1.0, recoil: 46, headMult: 1.0, explosive: true, blastR: 110, blastDmg: 65, desc: '范围爆炸 · 可自伤 · 克制坦克' },
    // ---- 魂斗罗式限时强化枪(补给胶囊掉落,15 秒) ----
    spread: { id: 'spread', name: 'S 散弹枪',  minLevel: 99, rpm: 300, dmg: 8,  mag: 9999, reload: 0.1, speed: 1400, range: 900,  spreadBase: 0.005, spreadMax: 0.010, spreadPerShot: 0.002, spreadCool: 2.0, recoil: 4,  headMult: 1.3, pellets: 5, temp: true, icon: 'S', color: '#ffd24a', desc: '五向散射 · 近战收割' },
    laser:  { id: 'laser',  name: 'L 激光枪',  minLevel: 99, rpm: 55,  dmg: 60, mag: 9999, reload: 0.1, speed: 3200, range: 2400, spreadBase: 0.0,   spreadMax: 0.0,   spreadPerShot: 0.0,   spreadCool: 2.0, recoil: 2,  headMult: 1.5, pierce: true, temp: true, icon: 'L', color: '#7ce8ff', desc: '穿透激光 · 一穿到底' },
  },
  // ===== 皮肤(火柴人外观;level=等级解锁,code=作者代码解锁) =====
  SKINS: [
    { id: 'classic', name: '经典',   unlock: 0 },
    { id: 'flame',   name: '烈焰',   body: '#ff7a3c', trail: 'ember', unlock: { level: 6 } },
    { id: 'frost',   name: '冰霜',   body: '#7cd0ff', trail: 'frost', unlock: { level: 9 } },
    { id: 'volt',    name: '电光',   body: '#ffe95c', trail: 'spark', unlock: { level: 12 } },
    { id: 'neon',    name: '霓虹',   body: 'rainbow', trail: 'spark', unlock: { code: 2024 } },
    { id: 'ghost',   name: '幽灵',   body: '#cfd8e8', alpha: 0.55,    unlock: { code: 1314 } },
    { id: 'gold',    name: '黄金',   body: '#ffd24a', aura: '#ffd24a', unlock: { code: 5208 } },
    { id: 'dark',    name: '暗黑',   body: '#23232e', eye: '#ff2a2a', aura: 'rgba(255,40,40,0.22)', unlock: { code: 999 } },
  ],

  // ===== 补给胶囊(魂斗罗式掉落) =====
  POWERUPS: {
    MEDKIT: { type: 'medkit', icon: '✚', color: '#5ddc6a', label: '医疗 +50' },
    SPREAD: { type: 'gun', gun: 'spread', icon: 'S', color: '#ffd24a', label: 'S 散弹枪' },
    LASER:  { type: 'gun', gun: 'laser',  icon: 'L', color: '#7ce8ff', label: 'L 激光枪' },
    INVUL:  { type: 'invul', icon: '◈', color: '#c9a03c', label: '无敌 5s' },
    GUN_TIME: 15,          // 限时武器持续时间
    INVUL_TIME: 5,
    DROP_CHANCE: 0.28,     // 机器人死亡掉落概率
    DROP_TIME: 12,         // 胶囊存留
  },
  // ===== 坦克 =====
  TANK: {
    PLAYER_HP: 500, BOSS_HP: 200,   // BOSS 基础血量(每级 +120:200/320/440…)
    W: 96, H: 46,
    SPEED: 240,
    SHELL_RPM: 18, SHELL_DMG: 42, SHELL_SPEED: 1100, SHELL_BLAST_R: 90,
    BULLET_TAKEN: 0.3,      // 普通子弹对坦克伤害减免
    RPG_MULT: 2.5,          // RPG 对坦克
    REAR_MULT: 3,           // 尾部弱点(BOSS)
    EXPLODE_DMG: 65,        // 坦克殉爆范围伤害
    VEHICLE_VS_BOSS: 3.0,   // 载具炮弹对 BOSS 坦克(穿甲)
    BOSS_VS_VEHICLE: 1.2,   // BOSS 炮弹对我方载具(玩家友好)
    // 我方装甲车:速度快、能碾碎掩体
    APC_HP: 380, APC_W: 108, APC_H: 48, APC_SPEED: 320,
    APC_RPM: 150, APC_DMG: 12, APC_BLAST_R: 60, APC_SPEED_SHELL: 1400,
  },
  // ===== 横向卷轴闯关 =====
  SCROLL: {
    SEG_W: 1600,            // 每段宽度
    ENCOUNTERS_PER_SEG: 2,  // 每段遭遇战数
    EXIT_PAD: 150,          // 撤离点距最右距离
    CAM_SMOOTH: 8,          // 摄像机平滑
  },
  // ===== 10 个关卡场景(每关配色/氛围不同) =====
  SCENES: [
    { name: '城市废墟', sky1: '#101623', sky2: '#1a2333', ground: '#243047', plat: '#3a4a63', platTop: '#5b7196', accent: '#4da3ff' },
    { name: '丛林哨所', sky1: '#0c1a15', sky2: '#16281f', ground: '#1e2f24', plat: '#33513c', platTop: '#4f7a5c', accent: '#5ddc6a' },
    { name: '沙漠公路', sky1: '#241d12', sky2: '#3a2f1c', ground: '#4a3a24', plat: '#6b5330', platTop: '#9c7c4a', accent: '#ffd24a' },
    { name: '军事基地', sky1: '#141821', sky2: '#232c38', ground: '#2b3340', plat: '#445064', platTop: '#6b7c96', accent: '#8fa8c8' },
    { name: '港口码头', sky1: '#0f1a26', sky2: '#1b2c40', ground: '#26384c', plat: '#3a5468', platTop: '#5c7f9a', accent: '#4dc8e8' },
    { name: '雪山哨站', sky1: '#1a2233', sky2: '#2c3a52', ground: '#3b4a63', plat: '#5b6c88', platTop: '#8fa3bf', accent: '#bfe0ff' },
    { name: '熔岩矿区', sky1: '#1f0f0c', sky2: '#3a1a12', ground: '#332018', plat: '#4d3126', platTop: '#7a4a34', accent: '#ff6d4a' },
    { name: '废弃工厂', sky1: '#181a1c', sky2: '#282c30', ground: '#2e3336', plat: '#454c52', platTop: '#6b757d', accent: '#c9a03c' },
    { name: '地下实验室', sky1: '#0f1520', sky2: '#182436', ground: '#20303f', plat: '#33485c', platTop: '#527188', accent: '#7ce8ff' },
    { name: '最终堡垒', sky1: '#1a0f1c', sky2: '#2c1830', ground: '#33203a', plat: '#4c3055', platTop: '#7a4f88', accent: '#d78cff' },
  ],

  // ===== 各场景地形档案(障碍物随场景变化,不千篇一律) =====
  TERRAIN: [
    { patterns: [0, 1], crateKind: 'wood',      crateW: 60, crateH: 60, crates: [2, 3], barrels: [0, 1], stack: true },   // 城市废墟
    { patterns: [1, 4], crateKind: 'wood',      crateW: 50, crateH: 50, crates: [1, 2], barrels: [0, 1], stack: false },  // 丛林哨所
    { patterns: [2, 7], crateKind: 'metal',     crateW: 84, crateH: 48, crates: [1, 2], barrels: [1, 2], stack: false },  // 沙漠公路(废车)
    { patterns: [0, 4], crateKind: 'metal',     crateW: 70, crateH: 70, crates: [2, 3], barrels: [1, 1], stack: true },   // 军事基地
    { patterns: [5, 7], crateKind: 'container', crateW: 92, crateH: 68, crates: [2, 2], barrels: [1, 2], stack: true },   // 港口码头
    { patterns: [1, 6], crateKind: 'ice',       crateW: 70, crateH: 58, crates: [2, 3], barrels: [0, 1], stack: true },   // 雪山哨站
    { patterns: [2, 6], crateKind: 'rock',      crateW: 82, crateH: 62, crates: [1, 2], barrels: [2, 2], stack: false },  // 熔岩矿区
    { patterns: [5, 7], crateKind: 'metal',     crateW: 72, crateH: 64, crates: [2, 3], barrels: [1, 2], stack: true },   // 废弃工厂
    { patterns: [8, 4], crateKind: 'metal',     crateW: 62, crateH: 62, crates: [2, 2], barrels: [1, 1], stack: false },  // 地下实验室
    { patterns: [0, 4, 5], crateKind: 'metal',  crateW: 80, crateH: 72, crates: [3, 3], barrels: [1, 2], stack: true },   // 最终堡垒
  ],
  // ===== 10 关关卡表:每关场景与 BOSS 都不同(BOSS: tank=机动坦克 / turret=固定炮台) =====
  STAGES: [
    { scene: 0, segs: 3, boss: { name: '铁锤号',   kind: 'giant',  hp: 260, rpm: 18, dmg: 42, speed: 200, escorts: 1 } },
    { scene: 1, segs: 3, boss: { name: '荆棘炮台', kind: 'turret', hp: 170, rpm: 30, dmg: 34, speed: 0,   escorts: 1 } },
    { scene: 2, segs: 4, boss: { name: '沙暴坦克', kind: 'tank',   hp: 300, rpm: 20, dmg: 44, speed: 280, escorts: 1 } },
    { scene: 3, segs: 4, boss: { name: '哨戒炮塔', kind: 'turret', hp: 240, rpm: 34, dmg: 36, speed: 0,   escorts: 2 } },
    { scene: 4, segs: 4, boss: { name: '海啸坦克', kind: 'tank',   hp: 320, rpm: 22, dmg: 46, speed: 250, escorts: 2 } },
    { scene: 5, segs: 4, boss: { name: '冰霜炮台', kind: 'turret', hp: 300, rpm: 36, dmg: 38, speed: 0,   escorts: 2 } },
    { scene: 6, segs: 5, boss: { name: '熔岩巨人', kind: 'giant',  hp: 460, rpm: 24, dmg: 50, speed: 190, escorts: 2 } },
    { scene: 7, segs: 5, boss: { name: '粉碎炮塔', kind: 'turret', hp: 400, rpm: 40, dmg: 42, speed: 0,   escorts: 3 } },
    { scene: 8, segs: 5, boss: { name: '实验坦克', kind: 'tank',   hp: 520, rpm: 26, dmg: 52, speed: 270, escorts: 3 } },
    { scene: 9, segs: 5, boss: { name: '要塞核心', kind: 'turret', hp: 650, rpm: 44, dmg: 46, speed: 0,   escorts: 3 } },
  ],
  CAMPAIGN_TOTAL: 50,
  // 第 11~50 关由生成器扩展:一关比一关难,每关 BOSS 唯一
  STAGE_CHAPTERS: ['', 'II 战区', 'III 战区', 'IV 战区', 'V 战区'],
  // ===== 敌人品类(移动速度整体下调,配合智商更慢) =====
  ENEMY_TIERS: {
    grunt:  { name: '普通兵', prefix: '',      hp: 100, speed: 0.72, gun: 'm249',   skillBonus: 0.00, xp: 12, color: '#ff8d8d' },
    elite:  { name: '精英兵', prefix: '精英·', hp: 150, speed: 0.82, gun: 'ak',     skillBonus: 0.10, xp: 20, color: '#ffb45d' },
    heavy:  { name: '重装兵', prefix: '重装·', hp: 260, speed: 0.55, gun: 'm2',     skillBonus: 0.04, xp: 34, color: '#d78cff' },
    sniper: { name: '狙击手', prefix: '狙击·', hp: 90,  speed: 0.66, gun: 'sniper', skillBonus: 0.12, xp: 26, color: '#7ce8ff' },
  },
  // ===== 闯关模式 =====
  CAMPAIGN: {
    LIVES: 5,
    WAVES: 3,
    WAVE_REST: 2.2,        // 波次间隔
    STAGE_REST: 4,         // 通关后回菜单延时
    FAIL_REST: 3,          // 失败后回菜单延时
    WAVE_BONUS_XP: 30,     // 每波清空奖励
    STAGE_BONUS_XP: 80,    // 通关奖励
    LEASH: 420,            // 敌人驻守半径(不会追太远,保证可清场)
  },
  // ===== 经验与等级 =====
  XP_PER_KILL: 12,         // 联机/死斗击杀经验
  levelFromXp(xp) {        // 累计经验 → 等级
    let lv = 1;
    while (xp >= CFG.xpForLevel(lv + 1)) lv++;
    return lv;
  },
  xpForLevel(lv) { return 25 * lv * (lv + 1) - 50; },  // L2=100, L3=250, L4=450, L5=700
  GUN: {
    NAME: 'M249 机枪',
    RPM: 660,             // 射速:11 发/秒
    DMG: 9,
    HEAD_MULT: 1.7,       // 爆头倍率
    SPEED: 1500,          // 子弹速度 px/s
    RANGE: 1500,
    MAG: 100,
    RELOAD: 2.2,
    SPREAD_BASE: 0.018,   // 基础散布(弧度)
    SPREAD_MAX: 0.085,    // 持续射击最大散布
    SPREAD_PER_SHOT: 0.011,
    SPREAD_COOL: 0.55,    // 热度冷却速度
    RECOIL: 9,            // 后坐力(把射手往后推)
  },
  REGEN_DELAY: 3.0,       // 脱战回血延迟
  REGEN_RATE: 32,
  RESPAWN: 3.0,
  PROTECT: 1.6,           // 重生保护
  ROUND_TARGET: 15,       // 单人模式目标击杀数
  NET: { STATE_HZ: 15, INTERP_DELAY: 0.12 },
  BOT_NAMES: ['刀锋', '幽灵', '猎鹰', '毒蛇', '雷霆', '暴风', '暗影', '疾风', '铁拳', '夜莺', '孤狼', '修罗'],
  // 机器人智商档位(数值范围映射到 AI 的瞄准误差/反应速度/预判/点射纪律)
  BOT_SKILL: {
    weak: [0.15, 0.38],
    medium: [0.45, 0.68],
    strong: [0.75, 0.96],
  },
  BOT_SKILL_LABEL: { weak: '弱', medium: '中', strong: '强' },
  COLORS: {
    BLUE: '#4da3ff', RED: '#ff5d5d',
    BG_TOP: '#101623', BG_BOT: '#1a2333',
    PLATFORM: '#3a4a63', PLATFORM_TOP: '#5b7196',
    GROUND: '#243047',
  },
};

// ===== 关卡生成器:第 11~50 关(前 10 关为手工设计) =====
(function buildStageTable() {
  const BOSS_NAMES = ['铁锤', '荆棘', '沙暴', '哨戒', '海啸', '冰霜', '熔岩', '粉碎', '实验', '要塞',
    '烈焰', '暗影', '雷霆', '寒霜', '毒蝎', '金刚', '幽灵', '裂空', '深渊', '天罚'];
  const SUFFIX = ['', '·改', '·精锐', '·王牌', '·终极'];
  for (let st = 11; st <= CFG.CAMPAIGN_TOTAL; st++) {
    const chapter = Math.floor((st - 1) / 10);            // 1~4(第 II~V 战区)
    const bossName = BOSS_NAMES[(st - 1) % BOSS_NAMES.length] + SUFFIX[chapter];
    const kindCycle = ['giant', 'turret', 'tank'][st % 3]; // 三种 BOSS 轮换
    CFG.STAGES.push({
      scene: (st - 1) % CFG.SCENES.length,                // 10 套场景循环
      chapter,
      segs: 3 + Math.min(4, Math.floor((st - 1) / 10)),   // 关卡越长沙场越久
      boss: {
        name: bossName,
        kind: kindCycle,
        hp: 640 + (st - 10) * 20,                         // 660 → 1440 逐关变硬
        rpm: Math.min(32, 20 + chapter * 3),              // 射速逐战区提升
        dmg: Math.min(56, 44 + Math.round(st * 0.2)),     // 炮伤逐关提升
        speed: kindCycle === 'turret' ? 0 : (kindCycle === 'giant' ? 180 + chapter * 8 : 240 + chapter * 12),
        escorts: Math.min(4, 1 + Math.floor(st / 12)),    // 护卫逐关增多
        final: st === CFG.CAMPAIGN_TOTAL,                 // 第 50 关为最终关
      },
    });
  }
})();
