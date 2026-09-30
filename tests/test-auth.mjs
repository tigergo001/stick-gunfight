// 登录验证专项测试:注册/重复注册/错误密码/令牌鉴权/未登录联机拦截
// 运行:node tests/test-auth.mjs [node|python]
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const impl = process.argv[2] || 'node';
const PORT = impl === 'python' ? 8139 : 8138;
const SERVER_CMD = impl === 'python' ? ['python3', 'desktop/server.py'] : ['node', 'server.js'];
const BASE = 'http://localhost:' + PORT;
const USER = '账号' + (Date.now() % 100000);

let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.error('  ✗ ' + msg); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function killPort(port) {
  try {
    const out = execSync('lsof -nP -tiTCP:' + port + ' -sTCP:LISTEN 2>/dev/null || true').toString().trim();
    for (const pid of out.split('\n')) if (pid) { try { process.kill(Number(pid), 'SIGKILL'); } catch (e) {} }
    if (out) await sleep(300);
  } catch (e) {}
}

await killPort(PORT);
const server = spawn(SERVER_CMD[0], SERVER_CMD.slice(1), {
  cwd: root, env: { ...process.env, PORT: String(PORT), SGF_ROOT: root },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => console.error('[server]', String(d).slice(0, 200)));

const post = (url, body) => fetch(BASE + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

try {
  console.log('· 被测服务器:', SERVER_CMD.join(' '));
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    await sleep(200);
    try { ready = (await fetch(BASE + '/')).ok; } catch (e) {}
  }
  assert(ready, '服务器已就绪');

  // 注册校验(默认注册口令: sgf2026)
  let r, d;
  r = await post('/api/register', { name: USER, pass: 'pass1234', code: 'wrongcode' });
  assert(r.status === 403, '注册口令错误被拒绝(403)');

  r = await post('/api/register', { name: USER, pass: 'pass1234', code: 'sgf2026' });
  d = await r.json();
  assert(r.ok && d.ok && d.token && d.name === USER, '注册成功并返回令牌');
  const TOKEN = d.token;

  r = await post('/api/register', { name: USER, pass: 'pass1234', code: 'sgf2026' });
  assert(r.status === 409, '重复注册同名账号被拒绝(409)');

  r = await post('/api/register', { name: 'x', pass: 'pass1234', code: 'sgf2026' });
  assert(r.status === 400, '用户名过短被拒绝(400)');

  r = await post('/api/register', { name: USER + 'b', pass: '123', code: 'sgf2026' });
  assert(r.status === 400, '密码过短被拒绝(400)');

  // 登录校验
  r = await post('/api/login', { name: USER, pass: 'wrongpass' });
  assert(r.status === 401, '错误密码登录被拒绝(401)');

  r = await post('/api/login', { name: USER, pass: 'pass1234' });
  d = await r.json();
  assert(r.ok && d.token, '正确密码登录成功并发放令牌');

  // 档案接口鉴权
  r = await fetch(BASE + '/api/profile');
  assert(r.status === 401, '无令牌访问档案被拒(401)');

  r = await fetch(BASE + '/api/profile', { headers: { 'X-SGF-Token': 'forged-token-xxxx' } });
  assert(r.status === 401, '伪造令牌访问档案被拒(401)');

  r = await fetch(BASE + '/api/profile', { headers: { 'X-SGF-Token': TOKEN } });
  d = await r.json();
  assert(r.ok && d.profile && d.name === USER, '有效令牌可读取自己的档案');

  // 联机:未登录 / 令牌错误 均被拦截
  const wsBad = new WebSocket('ws://localhost:' + PORT);
  const authErr = await new Promise((resolve) => {
    const to = setTimeout(() => resolve(null), 3000);
    wsBad.addEventListener('open', () => wsBad.send(JSON.stringify({ t: 'join', room: 'A1', name: '匿名' })));
    wsBad.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'auth') { clearTimeout(to); resolve(m); }
    });
  });
  assert(authErr && authErr.err, '未登录加入房间被服务器拒绝');

  const wsBad2 = new WebSocket('ws://localhost:' + PORT);
  const authErr2 = await new Promise((resolve) => {
    const to = setTimeout(() => resolve(null), 3000);
    wsBad2.addEventListener('open', () => wsBad2.send(JSON.stringify({ t: 'join', room: 'A1', name: '伪造', token: 'fake' })));
    wsBad2.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'auth') { clearTimeout(to); resolve(m); }
    });
  });
  assert(authErr2 && authErr2.err, '伪造令牌加入房间被拒绝');

  // 正确令牌可进入战斗,且名字由账号决定
  const wsOk = new WebSocket('ws://localhost:' + PORT);
  const welcome = await new Promise((resolve) => {
    const to = setTimeout(() => resolve(null), 3000);
    wsOk.addEventListener('open', () => wsOk.send(JSON.stringify({ t: 'join', room: 'A1', name: '冒名顶替', token: TOKEN })));
    wsOk.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'welcome') { clearTimeout(to); resolve(m); }
    });
  });
  assert(!!welcome, '有效令牌成功进入房间');
  assert(welcome && welcome.name === USER, '房间内名字取自账号(忽略伪造的名字)');
  try { wsOk.close(); } catch (e) {}
} catch (err) {
  failures++;
  console.error('  ✗ 测试异常:', err.message);
} finally {
  server.kill();
  await sleep(300);
  await killPort(PORT);
}
console.log(failures === 0 ? '\n登录验证测试通过 ✅ (' + impl + ')' : '\n有 ' + failures + ' 项失败 ❌');
process.exit(failures === 0 ? 0 : 1);
