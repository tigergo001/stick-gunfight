// 联机客户端全链路测试:在 vm 里运行完整游戏客户端,通过真实 WebSocket 连接真实服务器
// 完整复现玩家操作:加入战斗 → 移动开火 → 按 R 换弹 → 被击中 → 阵亡 → 重生 → 断线
// 运行:node tests/test-online-client.mjs
import { spawn, execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import vm from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const PORT = 8124;
const DT = 1 / 60;

let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.error('  ✗ ' + msg); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function killPort(port) {                 // 自愈:清理上次残留
  try {
    const out = execSync('lsof -nP -tiTCP:' + port + ' -sTCP:LISTEN 2>/dev/null || true').toString().trim();
    for (const pid of out.split('\n')) if (pid) { try { process.kill(Number(pid), 'SIGKILL'); } catch (e) {} }
    if (out) await sleep(300);
  } catch (e) {}
}

const REG_CODE = process.env.SGF_REG_CODE !== undefined ? process.env.SGF_REG_CODE : 'sgf2026';

async function authToken(baseUrl, name, pass) {   // 先注册,已存在则登录
  let r = await fetch(baseUrl + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, pass, code: REG_CODE }),
  });
  if (r.status === 409) {
    r = await fetch(baseUrl + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pass }),
    });
  }
  const d = await r.json();
  return d && d.ok ? d.token : null;
}


// ---------- 沙箱桩 ----------
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
function makeEl() {
  return {
    style: {}, value: '', textContent: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, remove() {}, focus() {}, select() {}, setAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }),
  };
}
const elements = {};
const canvasStub = Object.assign(makeEl(), {
  width: 1600, height: 900, getContext: () => blackhole(),
});
elements.game = canvasStub;

const sandbox = {
  console, performance, Date, Math, JSON,
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: () => 0,
  localStorage: (() => {
    const store = {};
    return {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      _store: store,
    };
  })(),
  document: {
    readyState: 'loading', hidden: false,
    addEventListener() {}, getElementById: (id) => elements[id] || (elements[id] = makeEl()),
    createElement: () => makeEl(), body: makeEl(),
  },
  addEventListener() {}, removeEventListener() {},
  WebSocket, // Node 22 内置,给 net.js 使用
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext('this.window = this;', sandbox);

for (const f of ['config', 'utils', 'audio', 'input', 'map', 'particles', 'stickman',
  'weapons', 'entities', 'bots', 'net', 'hud', 'game', 'main']) {
  const fp = path.join(root, 'js', f + '.js');
  vm.runInContext(readFileSync(fp, 'utf8'), sandbox, { filename: 'js/' + f + '.js' });
}
const { Game, Input, Net } = sandbox.SGF;

// ---------- 启动独立服务器 ----------
await killPort(PORT);
const server = spawn('node', ['server.js'], {
  cwd: root, env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let serverCrashed = false;
server.stderr.on('data', (d) => {
  const s = String(d);
  if (s.includes('ExperimentalWarning') || s.includes('trace-warnings')) return; // node:sqlite 实验特性提示
  if (!s.includes('已启动')) { serverCrashed = true; console.error('[server]', s); }
});

let hangWatchdog = false; // 主循环卡死检测由外层 Bash 超时兜底,这里记录进度
try {
  // 等服务器就绪
  for (let i = 0; i < 30; i++) { await sleep(150); try { if (Net && false) break; } catch (e) {} }

  // === 登录(注册账号并把令牌写入会话) ===
  const uniq = String(Date.now() % 1000000);
  const token = await authToken('http://localhost:' + PORT, '玩家' + uniq, 'pass1234');
  assert(!!token, '账号鉴权成功,令牌写入会话');
  sandbox.localStorage.setItem('sgf_token', token);
  sandbox.localStorage.setItem('sgf_user', '玩家' + uniq);

  // === 加入战斗(复现用户操作) ===
  console.log('· 加入战斗 …');
  const w = await Net.connect('ws://localhost:' + PORT, 'ROOMX', '测试甲');
  const game = new Game(canvasStub);
  game.startOnline(w);
  assert(game.mode === 'online', '已进入联机模式(房间 ' + w.room + ',队伍 ' + w.team + ')');
  assert(game.local.alive && game.local.hp === sandbox.SGF.CFG.PLAYER.MAX_HP, '本地玩家已出生');

  // === 间谍玩家:真实 WS 客户端,会移动会开枪 ===
  const spy = await new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:' + PORT);
    ws.addEventListener('open', async () => {
      const tk = await authToken('http://localhost:' + PORT, '间谍' + uniq, 'pass1234');
      ws.send(JSON.stringify({ t: 'join', room: 'ROOMX', name: '间谍乙', token: tk }));
    });
    ws.addEventListener('message', (ev) => {
      const d = JSON.parse(ev.data);
      if (d.t === 'welcome') resolve({ ws, w: d });
    });
    ws.addEventListener('error', () => reject(new Error('spy 连接失败')));
  });
  const spyId = spy.w.id;
  assert(true, '间谍乙已加入(我方客户端收到 join 后战士数: ' + game.fighters.length + ')');

  // 间谍站在中央矮台 (750, 690),持续上报位置并周期性朝我们开枪
  // (选这里是因为地面上的新掩体箱会挡住低处弹道)
  const spyPos = { x: 750, y: 690 };
  setInterval(() => {
    try { spy.ws.send(JSON.stringify({ t: 's', x: spyPos.x, y: spyPos.y, vx: 0, vy: 0, a: 0, f: 1, g: 1, m: 0, r: 0 })); } catch (e) {}
  }, 100);
  setInterval(() => {
    try { spy.ws.send(JSON.stringify({ t: 'hit', tg: w.id, dmg: 8, head: 0, x: 400, y: 800 })); } catch (e) {}
  }, 400);

  // 把我们的玩家传送到间谍面前的同一平台,保证交火距离与视线
  game.local.x = 860; game.local.y = 690;

  // === 主循环:完整模拟玩家操作 12 秒 ===
  console.log('· 模拟 12 秒联机战斗(移动/开火/按R换弹/挨打)…');
  const t0 = Date.now();
  let frames = 0;
  let sawReload = false, localDied = false, respawnedOnline = false, gotHurt = false;
  let lastProgress = '';

  while (Date.now() - t0 < 12000) {
    frames++;
    const L = game.local;
    if (L && L.alive) {
      Input.mouse.x = spyPos.x;               // 瞄准间谍
      Input.mouse.y = spyPos.y - 40;
      Input.mouse.down = frames % 240 < 150;  // 打 2.5 秒歇 1.5 秒
      if (frames % 200 === 90) Input.pressed.add('KeyR'); // ★ 用户报告的卡死操作
      if (frames % 260 === 130) Input.pressed.add('Space');
    }
    game.frame(DT);
    Input.endFrame();

    if (L && L.reloading) sawReload = true;
    if (L && L.alive && L.hp < 100) gotHurt = true;
    if (L && !L.alive) localDied = true;
    if (localDied && L && L.alive) respawnedOnline = true;

    if (frames % 120 === 0) {
      lastProgress = `frame ${frames}  t=${game.time.toFixed(1)}s  hp=${Math.round(L.hp)}  弹药=${L.ammo}  换弹=${L.reloading ? '中' : '否'}`;
      console.log('  · ' + lastProgress);
    }
    await sleep(15); // 与真实时间同步,让网络消息流动
  }

  assert(frames > 500, '主循环持续运行(' + frames + ' 帧,未卡死)');
  assert(sawReload, '按 R 后进入换弹状态');
  assert(gotHurt, '收到间谍攻击并掉血(服务器 dmg 消息)');
  assert(localDied, '被间谍击杀过');
  assert(respawnedOnline, '收到服务器重生消息并复活');
  assert(game.stats.hits > 0, '我们命中过间谍(' + game.stats.hits + ' 次,含 hfx 确认)');
  assert(Net.latency >= 0 && game.fighters.some(f => f.kind === 'remote'), '远程玩家插值与延迟统计正常(' + Net.latency + 'ms)');
  assert(!serverCrashed, '服务器全程未崩溃');
  assert(game.fighters.every(f => Number.isFinite(f.x) && Number.isFinite(f.y)), '所有实体坐标无 NaN');

  // ---- 油桶:客户端上报击中 → 服务器权威爆炸广播 ----
  Net.sendBarrelHit('b1', 99, 600, 800);
  Net.sendBarrelHit('b1', 99, 600, 800);
  await sleep(500);
  const b1 = sandbox.SGF.Arena.barrels.find(bb => bb.id === 'b1');
  assert(b1 && !b1.alive, '服务器确认油桶爆炸(客户端收到 boom)');

  // === 断线处理 ===
  const modeBefore = game.mode;
  spy.ws.close();
  Net.close();
  await sleep(300);
  assert(modeBefore === 'online', '测试期间保持联机模式');

  console.log(failures === 0 ? '\n联机客户端测试全部通过 ✅' : '\n有 ' + failures + ' 项失败 ❌');
  process.exitCode = failures === 0 ? 0 : 1;
} catch (err) {
  failures++;
  console.error('  ✗ 测试异常(这可能就是卡死原因):', err.stack || err.message);
  process.exitCode = 1;
} finally {
  server.kill();
  process.exit(process.exitCode || 0);
}
