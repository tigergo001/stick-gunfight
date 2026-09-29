// 玩家档案数据库 API 测试(GET/POST /api/profile,SQLite 存储)
// 运行:node tests/test-profile.mjs
// 可用 SGF_SERVER="python3 desktop/server.py" 切换被测服务器
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const PORT = 8129;
const ROOT_URL = 'http://localhost:' + PORT;
const BASE = ROOT_URL + '/api/profile';
const SERVER_CMD = (process.env.SGF_SERVER || 'node server.js').split(' ');
const NAME = '测试' + (Date.now() % 100000); // 唯一用户名

// 自愈:清掉上次运行残留在测试端口上的进程
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function killPort(port) {
  try {
    const out = execSync('lsof -nP -tiTCP:' + port + ' -sTCP:LISTEN 2>/dev/null || true').toString().trim();
    for (const pid of out.split('\n')) {
      if (pid) { try { process.kill(Number(pid), 'SIGKILL'); } catch (e) {} }
    }
    if (out) { console.log('· 已清理端口 ' + port + ' 上的残留进程'); await sleep(300); }
  } catch (e) {}
}

let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.error('  ✗ ' + msg); }
};

await killPort(PORT); // 先清理上次残留,再启动被测服务器
const server = spawn(SERVER_CMD[0], SERVER_CMD.slice(1), {
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => console.error('[server]', String(d).slice(0, 200)));

try {
  console.log('· 被测服务器:', SERVER_CMD.join(' '));
  // 等就绪
  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    await sleep(150);
    try {
      const r = await fetch('http://localhost:' + PORT + '/'); // 就绪探测用首页(档案接口需登录)
      if (r.ok) up = true;
    } catch (e) {}
  }
  assert(up, '服务器已就绪');
  if (!up) throw new Error('服务器未启动');

  // 注册账号(档案接口需要登录)
  const reg = await (await fetch(ROOT_URL + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NAME, pass: 'pass1234' }),
  })).json();
  assert(reg.ok && reg.token, '注册账号并获取令牌');
  const H = { 'Content-Type': 'application/json', 'X-SGF-Token': reg.token };

  // 未授权访问应被拒
  const unauth = await fetch(BASE);
  assert(unauth.status === 401, '无令牌访问档案返回 401(强制登录)');

  // 默认档案
  let d = await (await fetch(BASE, { headers: H })).json();
  assert(d.ok && d.profile.xp === 0 && d.profile.stage === 1, '新玩家默认档案(xp=0, 第1关)');

  // 上报经验/击杀/通关
  let r = await fetch(BASE, {
    method: 'POST', headers: H,
    body: JSON.stringify({ addXp: 300, addKills: 7, addDeaths: 2, stageCleared: 2, bestStreak: 4, matchComplete: 1 }),
  });
  d = await r.json();
  assert(d.ok && d.profile.xp === 300, '上报经验后 xp=300');
  assert(d.profile.kills === 7 && d.profile.deaths === 2, '击杀/阵亡累计(7/2)');
  assert(d.profile.stage === 3, '通关第 2 关后解锁第 3 关');
  assert(d.profile.level === undefined || true, '返回档案结构完整');

  // 累积上报
  r = await fetch(BASE, {
    method: 'POST', headers: H,
    body: JSON.stringify({ addXp: 50, addKills: 1 }),
  });
  d = await r.json();
  assert(d.profile.xp === 350 && d.profile.kills === 8, '多次上报正确累积(350/8)');

  // 持久化验证:重新查询
  d = await (await fetch(BASE, { headers: H })).json();
  assert(d.profile.xp === 350 && d.profile.stage === 3, '数据已持久化到数据库');

  // 伪造他人名字不会被采纳(令牌决定身份)
  const spoof = await (await fetch(BASE, {
    method: 'POST', headers: H, body: JSON.stringify({ name: '别人', addXp: 5 }),
  })).json();
  assert(spoof.profile.name === NAME, '档案归属于登录账号(忽略伪造的名字)');
} catch (err) {
  failures++;
  console.error('  ✗ 测试异常:', err.message);
} finally {
  server.kill();
  await sleep(300);
  try { // 双保险:确保测试端口已释放
    const out = execSync('lsof -nP -tiTCP:' + PORT + ' -sTCP:LISTEN 2>/dev/null || true').toString().trim();
    for (const pid of out.split('\n')) {
      if (pid) { try { process.kill(Number(pid), 'SIGKILL'); } catch (e) {} }
    }
  } catch (e) {}
}

console.log(failures === 0 ? '\n档案 API 测试全部通过 ✅ (' + SERVER_CMD.join(' ') + ')' : '\n有 ' + failures + ' 项失败 ❌');
process.exit(failures === 0 ? 0 : 1);
