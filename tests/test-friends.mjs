// 好友对战邀请端到端测试:发送/接收/接受闭环/拒绝/限频/防伪
// 运行:node tests/test-friends.mjs(自动拉起独立端口的 server.js;
//      可用 SGF_SERVER="python3 desktop/server.py" 切换被测实现)
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const IS_PY = !!(process.env.SGF_SERVER || '').includes('server.py');
const PORT = IS_PY ? 8131 : 8130;
// 可用环境变量切换被测服务器实现:SGF_SERVER="python3 desktop/server.py"
const SERVER_CMD = (process.env.SGF_SERVER || 'node server.js').split(' ');

let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.error('  ✗ ' + msg); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 清理残留的测试服务器进程(自愈,防上次异常退出占端口)
try {
  execSync(`lsof -ti tcp:${PORT} | xargs kill -9 2>/dev/null || true`, { shell: '/bin/zsh' });
} catch (e) { /* 端口本来就空闲 */ }

const server = spawn(SERVER_CMD[0], SERVER_CMD.slice(1), {
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
console.log('· 被测服务器:', SERVER_CMD.join(' '), '(端口 ' + PORT + ')');
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
  let wsA = null;
  for (let i = 0; i < 30 && !wsA; i++) {
    await sleep(150);
    try { wsA = await connect('ws://localhost:' + PORT); } catch (e) { /* 重试 */ }
  }
  assert(!!wsA, '服务器已启动并接受 WebSocket 连接');
  if (!wsA) throw new Error('无法连接被测服务器(' + SERVER_CMD.join(' ') + ')');

  // 1. 裸连接(未 join)发邀请应被拒
  wsA.send(JSON.stringify({ t: 'ivt', to: '某人' }));
  const ack0 = await waitMsg(wsA, 'iack');
  assert(ack0.ok === 0 && !!ack0.err, '未入房发邀请被拒:' + ack0.err);

  // 注册账号
  const uniq = String(Date.now() % 1000000);
  const TOKEN_A = await authToken('http://localhost:' + PORT, '甲' + uniq, 'pass1234');
  const TOKEN_B = await authToken('http://localhost:' + PORT, '乙' + uniq, 'pass1234');
  const TOKEN_C = await authToken('http://localhost:' + PORT, '丙' + uniq, 'pass1234');
  const TOKEN_D = await authToken('http://localhost:' + PORT, '丁' + uniq, 'pass1234');
  assert(!!TOKEN_A && !!TOKEN_B && !!TOKEN_C && !!TOKEN_D, '四个测试账号鉴权成功');

  // 甲加入房间 IA
  wsA.send(JSON.stringify({ t: 'join', room: 'IA', name: '甲', token: TOKEN_A }));
  const wA = await waitMsg(wsA, 'welcome');
  assert(wA.room === 'IA', '甲已进入房间 IA');

  // 2. 邀请不存在的用户名
  wsA.send(JSON.stringify({ t: 'ivt', to: '不存在' + uniq }));
  const ack1 = await waitMsg(wsA, 'iack');
  assert(ack1.ok === 0 && /不在线/.test(ack1.err || ''), '邀请不在线用户被拒:' + ack1.err);

  // 3. 甲邀请乙(乙在另一个房间 IB)→ 乙收到 ivt,甲收到 ok 回执
  const wsB = await connect('ws://localhost:' + PORT);
  wsB.send(JSON.stringify({ t: 'join', room: 'IB', name: '乙', token: TOKEN_B }));
  await waitMsg(wsB, 'welcome');
  wsA.send(JSON.stringify({ t: 'ivt', to: '乙' + uniq }));
  const invB = await waitMsg(wsB, 'ivt');
  assert(invB.from === '甲' + uniq && invB.room === 'IA', '乙收到甲的邀请(房间 ' + invB.room + ')');
  const ack2 = await waitMsg(wsA, 'iack', (d) => d.ok === 1);
  assert(ack2.ok === 1, '甲收到发送成功回执');

  // 4. 乙接受 → 甲收到带房间号的 irs;乙用新连接 join IA 闭环(服务器同一连接不可二次 join)
  wsB.send(JSON.stringify({ t: 'irs', ok: 1 }));
  const resA = await waitMsg(wsA, 'irs', (d) => d.ok === 1);
  assert(resA.room === 'IA', '甲收到乙接受邀请(房间 ' + resA.room + ')');
  const wsB2 = await connect('ws://localhost:' + PORT);
  const jBPromise = waitMsg(wsA, 'join', (d) => d.p.n === '乙' + uniq); // 先挂监听再 join,避免漏掉广播
  wsB2.send(JSON.stringify({ t: 'join', room: 'IA', name: '乙', token: TOKEN_B }));
  const wB = await waitMsg(wsB2, 'welcome');
  assert(wB.room === 'IA', '乙成功加入甲的房间 IA');
  const jB = await jBPromise;
  assert(!!jB.p.i, '甲收到乙的加入广播(闭环)');

  // 5. 甲邀请丙,丙拒绝
  const wsC = await connect('ws://localhost:' + PORT);
  wsC.send(JSON.stringify({ t: 'join', room: 'IC', name: '丙', token: TOKEN_C }));
  await waitMsg(wsC, 'welcome');
  wsA.send(JSON.stringify({ t: 'ivt', to: '丙' + uniq }));
  await waitMsg(wsC, 'ivt');
  await waitMsg(wsA, 'iack', (d) => d.ok === 1);
  wsC.send(JSON.stringify({ t: 'irs', ok: 0 }));
  const rejA = await waitMsg(wsA, 'irs', (d) => d.ok === 0);
  assert(rejA.ok === 0, '甲收到丙的拒绝回执');

  // 6. 限频:丙向两个目标交替连发 6 条(绕开同目标 5s 冷却),第 6 条应触发 10s/5 条窗口限频
  let limited = false;
  const onAcks = (ev) => {
    try { const d = JSON.parse(ev.data); if (d.t === 'iack' && d.ok === 0 && /频繁/.test(d.err || '')) limited = true; } catch (e) {}
  };
  wsC.addEventListener('message', onAcks); // 先挂监听再发送,避免回执先到被漏掉
  for (let i = 0; i < 6; i++) {
    wsC.send(JSON.stringify({ t: 'ivt', to: (i % 2 === 0 ? '甲' : '乙') + uniq }));
    await sleep(30);
  }
  await sleep(500);
  wsC.removeEventListener('message', onAcks);
  assert(limited, '交替连发 6 条邀请触发窗口限频');

  // 7. 防伪:丁(未收到过 ivt)伪造 irs,甲不应收到新的 irs
  const wsD = await connect('ws://localhost:' + PORT);
  wsD.send(JSON.stringify({ t: 'join', room: 'ID', name: '丁', token: TOKEN_D }));
  await waitMsg(wsD, 'welcome');
  wsD.send(JSON.stringify({ t: 'irs', ok: 1 }));
  let forged = false;
  const onIrs = () => { forged = true; };
  wsA.addEventListener('message', onIrs);
  await sleep(800);
  wsA.removeEventListener('message', onIrs);
  assert(!forged, '伪造的 irs 未被转发(防伪生效)');

  [wsA, wsB, wsB2, wsC, wsD].forEach(ws => ws.close());
} catch (err) {
  failures++;
  console.error('  ✗ 测试异常:', err.message);
} finally {
  server.kill();
}

console.log(failures === 0 ? '\n好友邀请测试全部通过 ✅' : '\n有 ' + failures + ' 项失败 ❌');
process.exit(failures === 0 ? 0 : 1);
