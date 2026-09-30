// 联机服务器端到端测试:两个客户端完整走一遍 加入/状态/开火/伤害/击杀/重生
// 运行:node tests/test-net.mjs(自动拉起独立端口的 server.js)
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const PORT = 8123;
const PROTECT_WAIT_MS = 1900; // 略大于服务器的 1.6s 重生保护
// 可用环境变量切换被测服务器实现:SGF_SERVER="python3 desktop/server.py"
const SERVER_CMD = (process.env.SGF_SERVER || 'node server.js').split(' ');

let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.error('  ✗ ' + msg); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const server = spawn(SERVER_CMD[0], SERVER_CMD.slice(1), {
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
console.log('· 被测服务器:', SERVER_CMD.join(' '));
server.stdout.on('data', () => {});
server.stderr.on('data', (d) => console.error('[server]', String(d)));

function waitMsg(ws, type, predicate = () => true, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => {
      ws.removeEventListener('message', onMsg);
      reject(new Error('等待消息 ' + type + ' 超时'));
    }, timeout);
    const onMsg = (ev) => {
      let d;
      try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (d.t === type && predicate(d)) {
        clearTimeout(to);
        ws.removeEventListener('message', onMsg);
        resolve(d);
      }
    };
    ws.addEventListener('message', onMsg);
  });
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

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error('连接失败')));
  });
}

try {
  // 等服务器起来
  let ws1 = null;
  for (let i = 0; i < 30 && !ws1; i++) {
    await sleep(150);
    try { ws1 = await connect('ws://localhost:' + PORT); } catch (e) { /* 重试 */ }
  }
  assert(!!ws1, '服务器已启动并接受 WebSocket 连接');
  if (!ws1) throw new Error('无法连接被测服务器(' + SERVER_CMD.join(' ') + '),请检查其启动日志');

  // 未登录加入应被拒绝
  const badWs = await connect('ws://localhost:' + PORT);
  badWs.send(JSON.stringify({ t: 'join', room: 'T1', name: '匿名' }));
  const authMsg = await waitMsg(badWs, 'auth');
  assert(!!authMsg.err, '未登录加入被服务器拒绝(需先登录)');
  badWs.close();

  // 账号登录(唯一名,先注册后登录均可)
  const uniq = String(Date.now() % 1000000);
  const TOKEN1 = await authToken('http://localhost:' + PORT, '甲' + uniq, 'pass1234');
  assert(!!TOKEN1, '账号鉴权成功并拿到令牌');

  // P1 加入
  ws1.send(JSON.stringify({ t: 'join', room: 'T1', name: '甲', token: TOKEN1 }));
  const w1 = await waitMsg(ws1, 'welcome');
  assert(!!w1.id && w1.team === 'blue', 'P1 收到 welcome(蓝队 ' + w1.id + ')');

  // P2 加入
  const ws2 = await connect('ws://localhost:' + PORT);
  const TOKEN2 = await authToken('http://localhost:' + PORT, '乙' + uniq, 'pass1234');
  ws2.send(JSON.stringify({ t: 'join', room: 'T1', name: '乙', token: TOKEN2 }));
  const w2 = await waitMsg(ws2, 'welcome');
  assert(w2.team === 'red', 'P2 自动平衡到红队');
  const j2 = await waitMsg(ws1, 'join');
  assert(j2.p.i === w2.id, 'P1 收到 P2 的加入广播');

  // 状态同步
  ws1.send(JSON.stringify({ t: 's', x: 100, y: 830, vx: 0, vy: 0, a: 0, f: 1, g: 1, m: 0, r: 0 }));
  const s2 = await waitMsg(ws2, 's', (d) => d.p === w1.id);
  assert(s2.x === 100, 'P2 收到 P1 的位置快照');

  // 开火广播
  ws1.send(JSON.stringify({ t: 'shoot', x: 142, y: 788, a: 0 }));
  const sh2 = await waitMsg(ws2, 'shoot');
  assert(sh2.a === 0, 'P2 收到 P1 的开火事件');

  // 刚加入有重生保护:先验证护盾拦截
  const protPromise = waitMsg(ws1, 'hfx', (d) => d.tg === w2.id && d.prot === 1);
  ws1.send(JSON.stringify({ t: 'hit', tg: w2.id, dmg: 20, head: 0, x: 300, y: 700 }));
  await protPromise;
  assert(true, '重生保护期内伤害被服务器拦截(仅特效)');
  await sleep(PROTECT_WAIT_MS);

  // P1 打 P2 一梭子 → 服务器结算伤害与击杀
  const dmgPromise = waitMsg(ws2, 'dmg');
  const diePromise = waitMsg(ws2, 'die', (d) => d.v === w2.id);
  const hfxPromise = waitMsg(ws1, 'hfx', (d) => d.tg === w2.id && !d.prot);
  const scorePromise = waitMsg(ws1, 'score', (d) => d.b >= 1);
  for (let i = 0; i < 9; i++) {
    ws1.send(JSON.stringify({ t: 'hit', tg: w2.id, dmg: 20, head: 0, x: 300, y: 700 }));
    await sleep(20);
  }
  const dmg = await dmgPromise;
  assert(dmg.hp === 130, 'P2 收到服务器权威血量(首击后 ' + dmg.hp + ')');
  const hfx = await hfxPromise;
  assert(hfx.tr === w1.id, 'P1 收到命中特效确认');
  const die = await diePromise;
  assert(die.k === w1.id, 'P2 阵亡广播,击杀者为 P1');
  await scorePromise;
  assert(true, '比分广播正常');

  // 重生
  const rp = await waitMsg(ws2, 'respawn', (d) => d.p === w2.id, 5000);
  assert(typeof rp.x === 'number', '3 秒后 P2 收到重生位置');

  // P2 断线 → P1 收到 leave
  const leavePromise = waitMsg(ws1, 'leave', (d) => d.p === w2.id);
  ws2.close();
  await leavePromise;
  assert(true, '断线后广播离开');

  ws1.close();
} catch (err) {
  failures++;
  console.error('  ✗ 测试异常:', err.message);
} finally {
  server.kill();
}

console.log(failures === 0 ? '\n联机测试全部通过 ✅' : '\n有 ' + failures + ' 项失败 ❌');
process.exit(failures === 0 ? 0 : 1);
