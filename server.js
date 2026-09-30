'use strict';
// ===== 火柴人机枪大战 · 联机服务器 =====
// 零依赖:静态文件服务 + 手写 WebSocket(RFC6455)
// 运行:node server.js   然后浏览器打开 http://localhost:8080

const http = require('http');

const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const MAX_ROOM_PLAYERS = 10;

// 与 js/map.js 保持一致的出生点
const SPAWNS = [
  { x: 80, y: 830 }, { x: 1520, y: 830 },
  { x: 270, y: 560 }, { x: 1330, y: 560 },
  { x: 800, y: 470 },
  { x: 460, y: 350 }, { x: 1140, y: 350 },
  { x: 520, y: 830 }, { x: 1080, y: 830 },
];

// 与 js/config.js 保持一致的数值
const MAX_HP = 150, REGEN_DELAY = 3500, REGEN_RATE = 26, RESPAWN_MS = 3000, PROTECT_MS = 1600;

// 与 js/map.js 保持一致的油桶布设
const BARRELS = [
  { id: 'b1', x: 585, y: 784, w: 36, h: 46 },
  { id: 'b2', x: 1130, y: 784, w: 36, h: 46 },
];
const BARREL = { HP: 30, RESPAWN_MS: 25000, RADIUS: 110, MAX_DMG: 55, CHAIN_DMG: 40 };

// ===== 玩家档案数据库(SQLite 开源嵌入式数据库;不可用时自动回退 JSON 文件) =====
const DATA_DIR = path.join(ROOT, 'data');
let db = null;
try {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, 'sgf.db'));
  db.exec(`CREATE TABLE IF NOT EXISTS players (
    name TEXT PRIMARY KEY,
    xp INTEGER DEFAULT 0, kills INTEGER DEFAULT 0, deaths INTEGER DEFAULT 0,
    matches INTEGER DEFAULT 0, best_streak INTEGER DEFAULT 0,
    stage INTEGER DEFAULT 1, weapon TEXT DEFAULT 'm249',
    updated REAL DEFAULT 0)`);
} catch (e) {
  db = null;
  console.log('ℹ️ node:sqlite 不可用,玩家档案回退为 JSON 文件存储');
}
const JSON_DB = path.join(DATA_DIR, 'profiles.json');

// ===== 账号体系(用户名 + 密码,scrypt 加盐哈希;会话令牌) =====

const crypto = require('crypto');
const tokens = new Map();                      // token -> { name, exp }
const TOKEN_TTL = 1000 * 60 * 60 * 12;         // 12 小时
// 注册口令:注册时必须填写(SGF_REG_CODE 环境变量可覆盖;设为空串则关闭校验)
const REG_CODE = process.env.SGF_REG_CODE !== undefined ? String(process.env.SGF_REG_CODE) : 'sgf2026';
function hashPass(pass, salt) {
  return crypto.scryptSync(String(pass), String(salt), 32).toString('hex');
}
function ensureUsers() {
  if (db) {
    db.exec(`CREATE TABLE IF NOT EXISTS users (
      name TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, created REAL DEFAULT 0)`);
  }
}
try { ensureUsers(); } catch (e) {}
const USERS_JSON = path.join(DATA_DIR, 'users.json');
function readUsersJson() {
  try { return JSON.parse(fs.readFileSync(USERS_JSON, 'utf8')); } catch (e) { return {}; }
}
function writeUsersJson(all) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USERS_JSON, JSON.stringify(all));
  } catch (e) {}
}
function getUser(name) {
  if (db) {
    const row = db.prepare('SELECT * FROM users WHERE name = ?').get(name);
    return row || null;
  }
  return readUsersJson()[name] || null;   // JSON 回退:{ name: { salt, hash, created } }
}
function createUser(name, pass) {
  const salt = crypto.randomBytes(12).toString('hex');
  const hash = hashPass(pass, salt);
  if (db) {
    db.prepare('INSERT INTO users (name, salt, hash, created) VALUES (?,?,?,?)')
      .run(name, salt, hash, Date.now());
    return;
  }
  const all = readUsersJson();
  all[name] = { salt, hash, created: Date.now() };
  writeUsersJson(all);
}
function verifyUser(name, pass) {
  const u = getUser(name);
  if (!u) return false;
  const h = Buffer.from(hashPass(pass, u.salt), 'hex');
  const cur = Buffer.from(u.hash, 'hex');
  return h.length === cur.length && crypto.timingSafeEqual(h, cur);
}
function tokenName(tk) {
  if (!tk) return null;
  const rec = tokens.get(tk);
  if (!rec || rec.exp < Date.now()) { tokens.delete(tk); return null; }
  return rec.name;
}
function issueToken(name) {
  const tk = crypto.randomBytes(24).toString('hex');
  tokens.set(tk, { name, exp: Date.now() + TOKEN_TTL });
  return tk;
}
function authUser(req) {
  const tk = req.headers['x-sgf-token'];
  if (!tk) return null;
  const rec = tokens.get(tk);
  if (!rec || rec.exp < Date.now()) { tokens.delete(tk); return null; }
  return rec.name;
}
function defaultProfile(name) {
  return { name, xp: 0, kills: 0, deaths: 0, matches: 0, bestStreak: 0, stage: 1, weapon: 'm249' };
}
function getProfile(name) {
  if (db) {
    const row = db.prepare('SELECT * FROM players WHERE name = ?').get(name);
    if (!row) return defaultProfile(name);
    return { name: row.name, xp: row.xp, kills: row.kills, deaths: row.deaths,
      matches: row.matches, bestStreak: row.best_streak, stage: row.stage, weapon: row.weapon };
  }
  try {
    const all = JSON.parse(fs.readFileSync(JSON_DB, 'utf8'));
    return Object.assign(defaultProfile(name), all[name] || {});
  } catch (e) { return defaultProfile(name); }
}
function updateProfile(name, b) {
  const p = getProfile(name);
  p.name = name;
  p.xp += Math.max(0, b.addXp | 0);
  p.kills += Math.max(0, b.addKills | 0);
  p.deaths += Math.max(0, b.addDeaths | 0);
  p.bestStreak = Math.max(p.bestStreak || 0, b.bestStreak | 0);
  if (b.stageCleared) p.stage = Math.max(p.stage || 1, (b.stageCleared | 0) + 1);
  if (b.weapon && typeof b.weapon === 'string') p.weapon = b.weapon.slice(0, 12);
  if (b.matchComplete) p.matches = (p.matches || 0) + 1;
  if (db) {
    db.prepare(`INSERT INTO players (name,xp,kills,deaths,matches,best_streak,stage,weapon,updated)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(name) DO UPDATE SET xp=excluded.xp, kills=excluded.kills, deaths=excluded.deaths,
        matches=excluded.matches, best_streak=excluded.best_streak, stage=excluded.stage,
        weapon=excluded.weapon, updated=excluded.updated`)
      .run(name, p.xp, p.kills, p.deaths, p.matches, p.bestStreak, p.stage, p.weapon, Date.now());
  } else {
    let all = {};
    try { all = JSON.parse(fs.readFileSync(JSON_DB, 'utf8')); } catch (e) {}
    all[name] = p;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(JSON_DB, JSON.stringify(all, null, 1));
    } catch (e) {}
  }
  return p;
}
function handleAuthApi(req, res, action) {
  const json = (code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(body);
  };
  if (req.method !== 'POST') return json(405, { ok: false, err: 'method not allowed' });
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
  req.on('end', () => {
    let b = {};
    try { b = JSON.parse(body || '{}'); } catch (e) { return json(400, { ok: false, err: 'bad json' }); }
    const name = String(b.name || '').trim().slice(0, 12);
    const pass = String(b.pass || '');
    if (name.length < 2) return json(400, { ok: false, err: '用户名至少 2 个字符' });
    if (pass.length < 4) return json(400, { ok: false, err: '密码至少 4 位' });
    if (action === 'register') {
      if (REG_CODE && String(b.code || '') !== REG_CODE) return json(403, { ok: false, err: '注册口令错误' });
      if (getUser(name)) return json(409, { ok: false, err: '用户名已被注册' });
      createUser(name, pass);
      return json(200, { ok: true, name, token: issueToken(name), profile: getProfile(name) });
    }
    // login
    if (!verifyUser(name, pass)) return json(401, { ok: false, err: '用户名或密码错误' });
    return json(200, { ok: true, name, token: issueToken(name), profile: getProfile(name) });
  });
}

function handleProfileApi(req, res) {
  const json = (code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(body);
  };
  const user = authUser(req);
  if (!user) return json(401, { ok: false, err: '未登录' });
  if (req.method === 'GET') {
    return json(200, { ok: true, profile: getProfile(user), name: user });
  }
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      try {
        const b = JSON.parse(body || '{}');
        return json(200, { ok: true, profile: updateProfile(user, b) });
      } catch (e) { return json(400, { ok: false, err: 'bad json' }); }
    });
    return;
  }
  json(405, { ok: false, err: 'method not allowed' });
}

function handleHealthApi(res) {
  let ok = false;
  try {
    if (db) {
      db.prepare('SELECT 1').get();
      ok = true;
    }
  } catch (e) {}
  const body = JSON.stringify({ ok, uptime: Math.round(process.uptime()) });
  res.writeHead(ok ? 200 : 503, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

// ---------------- 静态文件 ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
};
function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/healthz') return handleHealthApi(res);
  if (urlPath === '/api/profile') return handleProfileApi(req, res);
  if (urlPath === '/api/register') return handleAuthApi(req, res, 'register');
  if (urlPath === '/api/login') return handleAuthApi(req, res, 'login');
  if (urlPath === '/') urlPath = '/index.html';
  const fp = path.normalize(path.join(ROOT, urlPath));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

// ---------------- WebSocket 基础 ----------------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptConnection(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  socket.setNoDelay(true);

  const conn = { socket, buf: Buffer.alloc(0), player: null, closed: false };
  socket.on('data', (chunk) => {
    conn.buf = Buffer.concat([conn.buf, chunk]);
    try { parseFrames(conn); } catch (e) { dropConn(conn); }
  });
  socket.on('close', () => dropConn(conn));
  socket.on('error', () => dropConn(conn));
  return conn;
}

function parseFrames(conn) {
  for (;;) {
    const b = conn.buf;
    if (b.length < 2) return;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return;
      len = b.readUInt16BE(2); off = 4;
    } else if (len === 127) {
      if (b.length < 10) return;
      const big = b.readBigUInt64BE(2);
      if (big > 1000000n) return dropConn(conn);
      len = Number(big); off = 10;
    }
    if (len > 1000000) return dropConn(conn);
    let mask = null;
    if (masked) {
      if (b.length < off + 4) return;
      mask = b.slice(off, off + 4);
      off += 4;
    }
    if (b.length < off + len) return;
    let payload = b.slice(off, off + len);
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    conn.buf = b.slice(off + len);

    if (opcode === 0x8) return dropConn(conn);        // close
    if (opcode === 0x9) sendFrame(conn, 0xA, payload); // ping → pong
    else if (opcode === 0x1) onText(conn, payload.toString('utf8'));
    // 其他 opcode(心跳确认 / 二进制)忽略
  }
}

function sendFrame(conn, opcode, data) {
  if (conn.closed) return;
  const p = Buffer.isBuffer(data) ? data : Buffer.from(data);
  let h;
  if (p.length < 126) {
    h = Buffer.from([0x80 | opcode, p.length]);
  } else if (p.length < 65536) {
    h = Buffer.alloc(4);
    h[0] = 0x80 | opcode; h[1] = 126;
    h.writeUInt16BE(p.length, 2);
  } else {
    h = Buffer.alloc(10);
    h[0] = 0x80 | opcode; h[1] = 127;
    h.writeBigUInt64BE(BigInt(p.length), 2);
  }
  try { conn.socket.write(Buffer.concat([h, p])); } catch (e) { dropConn(conn); }
}
const send = (conn, obj) => sendFrame(conn, 0x1, JSON.stringify(obj));

function dropConn(conn) {
  if (conn.closed) return;
  conn.closed = true;
  try { conn.socket.end(); } catch (e) {}
  try { conn.socket.destroy(); } catch (e) {}
  if (conn.player) removeFromRoom(conn.player);
  // 清理在线表(守卫:同名旧连接掉线时不误删新登记)
  if (conn.uname && onlineConns.get(conn.uname) === conn) onlineConns.delete(conn.uname);
}

// ---------------- 房间 / 玩家 ----------------
const rooms = new Map(); // code -> { players: Map<id, player> }
const onlineConns = new Map(); // 完整用户名 -> 已加入房间的连接(好友邀请用)
let uid = 0;

function roomBalancedTeam(room) {
  let blue = 0, red = 0;
  for (const p of room.players.values()) p.team === 'blue' ? blue++ : red++;
  return blue <= red ? 'blue' : 'red';
}
function broadcast(room, obj, exceptId) {
  for (const p of room.players.values()) {
    if (exceptId && p.id === exceptId) continue;
    send(p.conn, obj);
  }
}
function roster(room) {
  const arr = [];
  for (const p of room.players.values()) {
    arr.push({ i: p.id, n: p.name, tm: p.team, k: p.kills, d: p.deaths });
  }
  return arr;
}
function teamScores(room) {
  let blue = 0, red = 0;
  for (const p of room.players.values()) {
    if (p.team === 'blue') blue += p.kills; else red += p.kills;
  }
  return { blue, red };
}
function broadcastScore(room) {
  const s = teamScores(room);
  broadcast(room, { t: 'score', b: s.blue, r: s.red, ps: roster(room) });
}
function pickSpawn(room, player) {
  let best = SPAWNS[0], bestScore = -1;
  for (const s of SPAWNS) {
    let minD = Infinity;
    for (const o of room.players.values()) {
      if (o !== player && o.alive && o.team !== player.team && o.x !== undefined) {
        minD = Math.min(minD, Math.hypot(s.x - o.x, s.y - o.y));
      }
    }
    const score = (minD === Infinity ? 800 : minD) + Math.random() * 120;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}
function removeFromRoom(player) {
  const room = rooms.get(player.roomCode);
  if (!room) return;
  room.players.delete(player.id);
  broadcast(room, { t: 'leave', p: player.id });
  if (room.players.size === 0) rooms.delete(player.roomCode);
  player.conn.player = null;
  if (room.players.size > 0) broadcastScore(room);
}

// ---------------- 消息处理 ----------------
function onText(conn, str) {
  let msg;
  try { msg = JSON.parse(str); } catch (e) { return; }
  if (!msg || typeof msg.t !== 'string') return;

  // ---- 加入 ----
  if (msg.t === 'join') {
    if (conn.player) return;
    const uname = tokenName(msg.token);
    if (!uname) {                       // 未登录/令牌失效:拒绝进入战斗
      send(conn, { t: 'auth', err: '登录已失效,请重新登录' });
      try { conn.socket.end(); } catch (e) {}
      return;
    }
    const code = String(msg.room || 'ROOM1').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'ROOM1';
    let room = rooms.get(code);
    if (!room) {
      room = {
        players: new Map(),
        barrels: BARRELS.map(b => Object.assign({}, b, { hp: BARREL.HP, alive: true })),
      };
      rooms.set(code, room);
    }
    if (room.players.size >= MAX_ROOM_PLAYERS) {
      return send(conn, { t: 'full' });
    }
    const team = roomBalancedTeam(room);
    const spawn = pickSpawn(room, { team, alive: false });
    const player = {
      id: 'p' + (++uid),
      name: uname.slice(0, 10),
      team, roomCode: code, conn,
      hp: MAX_HP, alive: true, kills: 0, deaths: 0,
      lastDmg: 0, protectUntil: Date.now() + PROTECT_MS,
      x: spawn.x, y: spawn.y,
      respawnTO: null,
    };
    conn.player = player;
    // 登记在线表(uname 是完整用户名;player.name 是展示名 slice(0,10))
    conn.uname = uname;
    conn.ivt = null; // 每连接一个待答复邀请槽位
    onlineConns.set(uname, conn);
    room.players.set(player.id, player);
    send(conn, {
      t: 'welcome', id: player.id, name: player.name, team: player.team,
      room: code, x: spawn.x, y: spawn.y,
      players: roster(room), ...teamScores(room),
    });
    broadcast(room, { t: 'join', p: { i: player.id, n: player.name, tm: player.team } }, player.id);
    return;
  }

  // ---- 好友对战邀请(需已入房;受邀者收到后用 irs 答复) ----
  if (msg.t === 'ivt') {
    if (!conn.player || !conn.uname) return send(conn, { t: 'iack', ok: 0, err: '请先加入房间再发送邀请' });
    const to = String(msg.to || '').trim().slice(0, 16);
    if (!to || to === conn.uname) return send(conn, { t: 'iack', ok: 0, err: to ? '不能邀请自己' : '请填写对方用户名' });
    // 限频挂在 conn 上:10 秒窗口最多 5 条 + 同目标 5 秒冷却
    const now = Date.now();
    conn.ivtWin = (conn.ivtWin || []).filter(ts => now - ts < 10000);
    if (conn.ivtWin.length >= 5) return send(conn, { t: 'iack', ok: 0, err: '发送太频繁,请稍后再试' });
    if (conn.lastTo === to && now - (conn.lastToTs || 0) < 5000) return send(conn, { t: 'iack', ok: 0, err: '邀请已发送,请等待对方回应' });
    const tc = onlineConns.get(to);
    if (!tc || tc.closed) return send(conn, { t: 'iack', ok: 0, err: '对方不在线(需已加入联机房间)' });
    conn.ivtWin.push(now);
    conn.lastTo = to; conn.lastToTs = now;
    tc.ivt = { from: conn.uname, room: conn.player.roomCode, exp: now + 60000 }; // 新邀请覆盖旧槽
    send(tc, { t: 'ivt', from: conn.player.name, room: conn.player.roomCode });
    return send(conn, { t: 'iack', ok: 1 });
  }

  // ---- 邀请答复(不要求已入房;先取后清,天然防重放) ----
  if (msg.t === 'irs') {
    const iv = conn.ivt;
    conn.ivt = null;
    if (!iv || Date.now() > iv.exp) return; // 无邀请/已过期:静默丢弃
    const ic = onlineConns.get(iv.from);
    if (!ic || ic.closed) return; // 邀请人已掉线
    const ok = msg.ok ? 1 : 0;
    send(ic, ok ? { t: 'irs', from: iv.from, ok: 1, room: iv.room } : { t: 'irs', from: iv.from, ok: 0 });
    return;
  }

  const player = conn.player;
  if (!player) return;
  const room = rooms.get(player.roomCode);
  if (!room) return;

  switch (msg.t) {
    case 's': { // 位置状态:记录并转发
      if (typeof msg.x === 'number' && typeof msg.y === 'number') {
        player.x = msg.x; player.y = msg.y;
      }
      broadcast(room, {
        t: 's', p: player.id,
        x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy,
        a: msg.a, f: msg.f, g: msg.g, m: msg.m, r: msg.r,
      }, player.id);
      break;
    }
    case 'shoot': { // 开火:解除保护并转发(伤害各端只做表现)
      player.protectUntil = 0;
      broadcast(room, { t: 'shoot', p: player.id, x: msg.x, y: msg.y, a: msg.a }, player.id);
      break;
    }
    case 'hit': { // 命中上报:服务器结算伤害
      const target = room.players.get(msg.tg);
      if (!target || !target.alive || target.team === player.team) break;
      if (Date.now() < target.protectUntil) {
        broadcast(room, { t: 'hfx', tr: player.id, tg: target.id, x: msg.x, y: msg.y, prot: 1 });
        break;
      }
      const dmg = Math.max(1, Math.min(110, Math.round(msg.dmg) || 1));
      target.hp -= dmg;
      target.lastDmg = Date.now();
      broadcast(room, {
        t: 'hfx', tr: player.id, tg: target.id,
        x: msg.x, y: msg.y, head: msg.head ? 1 : 0,
      });
      send(target.conn, { t: 'dmg', p: target.id, hp: Math.max(0, target.hp), from: player.id, x: msg.x, y: msg.y });
      if (target.hp <= 0) doKill(room, target, player, msg);
      break;
    }
    case 'ping':
      send(conn, { t: 'pong', ts: msg.ts });
      break;
    case 'bhit': { // 击中油桶:服务器权威结算爆炸
      const barrel = room.barrels.find(bb => bb.id === msg.id);
      if (!barrel || !barrel.alive) break;
      const dmg = Math.max(1, Math.min(110, Math.round(msg.dmg) || 1));
      barrel.hp -= dmg;
      broadcast(room, { t: 'bfx', id: barrel.id, x: msg.x, y: msg.y });
      if (barrel.hp <= 0) explodeBarrel(room, barrel, player);
      break;
    }
  }
}

function explodeBarrel(room, barrel, shooter) {
  if (!barrel.alive) return;
  barrel.alive = false;
  const cx = barrel.x + barrel.w / 2, cy = barrel.y + barrel.h / 2;
  broadcast(room, { t: 'boom', id: barrel.id, x: cx, y: cy });
  const now = Date.now();
  for (const p of room.players.values()) {
    if (!p.alive || now < p.protectUntil) continue;
    const d = Math.hypot(p.x - cx, (p.y - 27) - cy);
    if (d >= BARREL.RADIUS) continue;
    const dmg = Math.max(1, Math.round(BARREL.MAX_DMG * (1 - (d / BARREL.RADIUS) * 0.6)));
    p.hp -= dmg;
    p.lastDmg = now;
    send(p.conn, { t: 'dmg', p: p.id, hp: Math.max(0, p.hp), from: shooter ? shooter.id : null, x: Math.round(cx), y: Math.round(cy) });
    if (p.hp <= 0) doKill(room, p, shooter, null);
  }
  // 连环殉爆
  for (const b of room.barrels) {
    if (!b.alive || b === barrel) continue;
    if (Math.hypot(b.x - cx, b.y - cy) < BARREL.RADIUS + 40) explodeBarrel(room, b, shooter);
  }
  // 定时重生
  setTimeout(() => {
    if (barrel.alive) return;
    barrel.alive = true;
    barrel.hp = BARREL.HP;
    broadcast(room, { t: 'bspawn', id: barrel.id });
  }, BARREL.RESPAWN_MS);
}

function doKill(room, victim, killer, hitMsg) {
  victim.alive = false;
  victim.deaths++;
  if (killer && killer !== victim) killer.kills++;
  broadcast(room, {
    t: 'die', v: victim.id, k: killer ? killer.id : null,
    x: victim.x, y: victim.y,
  });
  broadcastScore(room);
  const to = setTimeout(() => {
    if (!rooms.has(victim.roomCode)) return;
    const cur = rooms.get(victim.roomCode).players.get(victim.id);
    if (!cur) return;
    const spawn = pickSpawn(rooms.get(victim.roomCode), cur);
    cur.x = spawn.x; cur.y = spawn.y;
    cur.hp = MAX_HP;
    cur.alive = true;
    cur.protectUntil = Date.now() + PROTECT_MS;
    broadcast(rooms.get(victim.roomCode), { t: 'respawn', p: cur.id, x: spawn.x, y: spawn.y });
  }, RESPAWN_MS);
  if (victim.respawnTO) clearTimeout(victim.respawnTO);
  victim.respawnTO = to;
}

// 脱战回血
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const p of room.players.values()) {
      if (p.alive && p.hp < MAX_HP && now - p.lastDmg > REGEN_DELAY) {
        p.hp = Math.min(MAX_HP, p.hp + REGEN_RATE * 0.1);
        send(p.conn, { t: 'dmg', p: p.id, hp: Math.round(p.hp), regen: 1 });
      }
    }
  }
}, 100);

// ---------------- 启动 ----------------
const server = http.createServer(serveStatic);
server.on('upgrade', (req, socket) => {
  try { acceptConnection(req, socket); } catch (e) { socket.destroy(); }
});
server.listen(PORT, () => {
  console.log('========================================');
  console.log('  🔥 火柴人机枪大战 服务器已启动');
  console.log('  本机游戏:  http://localhost:' + PORT);
  console.log('  局域网联机: http://<你的局域网IP>:' + PORT);
  console.log('  默认房间:   ROOM1 (加入时输入相同房间号)');
  console.log('========================================');
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('✗ 端口 ' + PORT + ' 被占用,换个端口: PORT=9090 node server.js');
    process.exit(1);
  }
  throw err;
});


let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('收到 ' + signal + ',正在停止服务器…');
  const force = setTimeout(() => process.exit(1), 5000);
  force.unref();
  server.close(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
