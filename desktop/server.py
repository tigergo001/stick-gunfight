#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
火柴人机枪大战 · 零依赖服务器(Python 标准库实现)
与 Node 版 server.js / 网页客户端协议完全一致:
HTTP 静态托管 + WebSocket 房间联机(位置转发/伤害结算/油桶爆炸/重生/回血)

运行:  python3 desktop/server.py        (默认端口 8081,可用 PORT=xxxx 覆盖)
依赖:  无(仅 Python 标准库,支持 macOS / Windows / Linux)
"""
import base64
import hashlib
import hmac
import secrets
import io
import json
import os
import random
import socketserver
import sqlite3
import sys
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

# 兼容旧版 Python 的管道输出编码(避免 emoji 打印崩溃)
try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
except Exception:
    pass

# 兼容 Python 3.6(无内置 ThreadingHTTPServer)
class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True

PORT = int(os.environ.get('PORT', '8081'))
ROOT = os.environ.get('SGF_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_PLAYERS = 10
WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

# ---- 与 js 客户端保持一致的数值 ----
SPAWNS = [
    {'x': 80, 'y': 830}, {'x': 1520, 'y': 830},
    {'x': 270, 'y': 560}, {'x': 1330, 'y': 560},
    {'x': 800, 'y': 470},
    {'x': 460, 'y': 350}, {'x': 1140, 'y': 350},
    {'x': 680, 'y': 830}, {'x': 920, 'y': 830},
]
BARRELS_DEF = [
    {'id': 'b1', 'x': 585, 'y': 784, 'w': 36, 'h': 46},
    {'id': 'b2', 'x': 1130, 'y': 784, 'w': 36, 'h': 46},
]
BARREL = {'HP': 30, 'RESPAWN': 25.0, 'RADIUS': 110, 'MAX_DMG': 55, 'CHAIN': 40}
MAX_HP, REGEN_DELAY, REGEN_RATE, RESPAWN_S, PROTECT_S = 150, 3.5, 26, 3.0, 1.6

MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.md': 'text/markdown; charset=utf-8',
}

# ===== 账号体系(用户名 + 密码:PBKDF2 加盐哈希;会话令牌) =====
TOKENS = {}                              # token -> {'name','exp'}
TOKEN_TTL = 12 * 3600


def _conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute('CREATE TABLE IF NOT EXISTS users ('
                 'name TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, created REAL DEFAULT 0)')
    return conn


def hash_pass(pw, salt):
    return hashlib.pbkdf2_hmac('sha256', str(pw).encode('utf-8'), str(salt).encode('utf-8'), 100000).hex()


def create_user(name, pw):
    salt = secrets.token_hex(12)
    conn = _conn()
    conn.execute('INSERT INTO users (name, salt, hash, created) VALUES (?,?,?,?)',
                 (name, salt, hash_pass(pw, salt), time.time()))
    conn.commit()
    conn.close()


def verify_user(name, pw):
    conn = _conn()
    row = conn.execute('SELECT salt, hash FROM users WHERE name=?', (name,)).fetchone()
    conn.close()
    if not row:
        return False
    return hmac.compare_digest(hash_pass(pw, row[0]), row[1])


def issue_token(name):
    tk = secrets.token_hex(24)
    TOKENS[tk] = {'name': name, 'exp': time.time() + TOKEN_TTL}
    return tk


def token_name(tk):
    rec = TOKENS.get(tk or '')
    if not rec or rec['exp'] < time.time():
        TOKENS.pop(tk, None)
        return None
    return rec['name']


# ===== 玩家档案数据库(SQLite,Python 标准库) =====
DB_PATH = os.path.join(ROOT, 'data', 'sgf.db')


def get_profile(name):
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute('CREATE TABLE IF NOT EXISTS players ('
                 'name TEXT PRIMARY KEY, xp INTEGER DEFAULT 0, kills INTEGER DEFAULT 0, '
                 'deaths INTEGER DEFAULT 0, matches INTEGER DEFAULT 0, '
                 'best_streak INTEGER DEFAULT 0, stage INTEGER DEFAULT 1, '
                 "weapon TEXT DEFAULT 'm249', updated REAL DEFAULT 0)")
    row = conn.execute('SELECT name,xp,kills,deaths,matches,best_streak,stage,weapon '
                       'FROM players WHERE name=?', (name,)).fetchone()
    conn.close()
    if not row:
        return {'name': name, 'xp': 0, 'kills': 0, 'deaths': 0, 'matches': 0,
                'bestStreak': 0, 'stage': 1, 'weapon': 'm249'}
    return {'name': row[0], 'xp': row[1], 'kills': row[2], 'deaths': row[3],
            'matches': row[4], 'bestStreak': row[5], 'stage': row[6], 'weapon': row[7]}


def update_profile(name, b):
    p = get_profile(name)
    p['xp'] += max(0, int(b.get('addXp', 0) or 0))
    p['kills'] += max(0, int(b.get('addKills', 0) or 0))
    p['deaths'] += max(0, int(b.get('addDeaths', 0) or 0))
    p['bestStreak'] = max(p.get('bestStreak', 0), int(b.get('bestStreak', 0) or 0))
    if b.get('stageCleared'):
        p['stage'] = max(p.get('stage', 1), int(b['stageCleared']) + 1)
    if b.get('weapon'):
        p['weapon'] = str(b['weapon'])[:12]
    if b.get('matchComplete'):
        p['matches'] = p.get('matches', 0) + 1
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute('INSERT OR REPLACE INTO players (name,xp,kills,deaths,matches,'
                 'best_streak,stage,weapon,updated) VALUES (?,?,?,?,?,?,?,?,?)',
                 (name, p['xp'], p['kills'], p['deaths'], p['matches'],
                  p['bestStreak'], p['stage'], p['weapon'], time.time()))
    conn.commit()
    conn.close()
    return p

rooms = {}          # code -> {'players': {id: P}, 'barrels': [...]}
uid = [0]
lock = threading.RLock()


class Conn(object):
    def __init__(self, sock, rfile):
        self.sock = sock
        self.rfile = rfile
        self.player = None
        self.closed = False

    def send(self, obj):
        send_frame(self, 0x1, json.dumps(obj).encode('utf-8'))


def send_frame(conn, opcode, data):
    if conn.closed:
        return
    p = data if isinstance(data, (bytes, bytearray)) else bytes(data)
    if len(p) < 126:
        head = bytes([0x80 | opcode, len(p)])
    elif len(p) < 65536:
        head = bytes([0x80 | opcode, 126]) + len(p).to_bytes(2, 'big')
    else:
        head = bytes([0x80 | opcode, 127]) + len(p).to_bytes(8, 'big')
    try:
        conn.sock.sendall(head + p)
    except Exception:
        drop(conn)


def recv_exact(conn, n):
    try:
        d = conn.rfile.read(n)
    except Exception:
        return None
    if d is None or len(d) < n:
        return None
    return d


def drop(conn):
    if conn.closed:
        return
    conn.closed = True
    try:
        conn.sock.close()
    except Exception:
        pass
    if conn.player is not None:
        with lock:
            remove_from_room(conn.player)
            conn.player = None


# ---------------- 房间逻辑 ----------------
def balanced_team(room):
    blue = sum(1 for p in room['players'].values() if p['team'] == 'blue')
    red = sum(1 for p in room['players'].values() if p['team'] == 'red')
    return 'blue' if blue <= red else 'red'


def roster(room):
    return [{'i': p['id'], 'n': p['name'], 'tm': p['team'], 'k': p['kills'], 'd': p['deaths']}
            for p in room['players'].values()]


def team_scores(room):
    blue = sum(p['kills'] for p in room['players'].values() if p['team'] == 'blue')
    red = sum(p['kills'] for p in room['players'].values() if p['team'] == 'red')
    return blue, red


def broadcast_score(room):
    b, r = team_scores(room)
    broadcast(room, {'t': 'score', 'b': b, 'r': r, 'ps': roster(room)})


def broadcast(room, obj, except_id=None):
    for p in list(room['players'].values()):
        if except_id and p['id'] == except_id:
            continue
        p['conn'].send(obj)


def pick_spawn(room, team):
    best, best_score = SPAWNS[0], -1.0
    for s in SPAWNS:
        min_d = float('inf')
        for o in room['players'].values():
            if o['alive'] and o['team'] != team and o.get('x') is not None:
                d = ((s['x'] - o['x']) ** 2 + (s['y'] - o['y']) ** 2) ** 0.5
                min_d = min(min_d, d)
        score = (800 if min_d == float('inf') else min_d) + random.random() * 120
        if score > best_score:
            best_score, best = score, s
    return best


def remove_from_room(player):
    room = rooms.get(player['room'])
    if not room:
        return
    room['players'].pop(player['id'], None)
    broadcast(room, {'t': 'leave', 'p': player['id']})
    if not room['players']:
        rooms.pop(player['room'], None)
    else:
        broadcast_score(room)


def do_kill(room, victim, killer):
    victim['alive'] = False
    victim['deaths'] += 1
    if killer is not None and killer is not victim:
        killer['kills'] += 1
    broadcast(room, {'t': 'die', 'v': victim['id'], 'k': killer['id'] if killer else None,
                     'x': victim.get('x', 0), 'y': victim.get('y', 0)})
    broadcast_score(room)

    def respawn():
        with lock:
            if victim['alive'] or victim['id'] not in room['players']:
                return
            s = pick_spawn(room, victim['team'])
            victim.update(x=s['x'], y=s['y'], hp=MAX_HP, alive=True,
                          protect_until=time.time() + PROTECT_S)
            broadcast(room, {'t': 'respawn', 'p': victim['id'], 'x': s['x'], 'y': s['y']})
    t = threading.Timer(RESPAWN_S, respawn)
    t.daemon = True
    t.start()


def explode_barrel(room, barrel, shooter):
    if not barrel['alive']:
        return
    barrel['alive'] = False
    cx, cy = barrel['x'] + barrel['w'] / 2, barrel['y'] + barrel['h'] / 2
    broadcast(room, {'t': 'boom', 'id': barrel['id'], 'x': cx, 'y': cy})
    now = time.time()
    for p in list(room['players'].values()):
        if not p['alive'] or now < p['protect_until']:
            continue
        d = ((p['x'] - cx) ** 2 + (p['y'] - 27 - cy) ** 2) ** 0.5
        if d >= BARREL['RADIUS']:
            continue
        dmg = max(1, round(BARREL['MAX_DMG'] * (1 - (d / BARREL['RADIUS']) * 0.6)))
        p['hp'] -= dmg
        p['last_dmg'] = now
        p['conn'].send({'t': 'dmg', 'p': p['id'], 'hp': max(0, p['hp']),
                        'from': shooter['id'] if shooter else None,
                        'x': round(cx), 'y': round(cy)})
        if p['hp'] <= 0:
            do_kill(room, p, shooter)
    # 连环殉爆
    for b in room['barrels']:
        if not b['alive'] or b is barrel:
            continue
        if ((b['x'] - cx) ** 2 + (b['y'] - cy) ** 2) ** 0.5 < BARREL['RADIUS'] + 40:
            explode_barrel(room, b, shooter)
    # 定时重生
    def respawn_barrel():
        with lock:
            if barrel['alive']:
                return
            barrel['alive'] = True
            barrel['hp'] = BARREL['HP']
            broadcast(room, {'t': 'bspawn', 'id': barrel['id']})
    t = threading.Timer(BARREL['RESPAWN'], respawn_barrel)
    t.daemon = True
    t.start()


def on_text(conn, text):
    try:
        msg = json.loads(text)
    except Exception:
        return
    if not isinstance(msg, dict) or not isinstance(msg.get('t'), str):
        return

    with lock:
        # ---- 加入 ----
        if msg['t'] == 'join':
            if conn.player is not None:
                return
            uname = token_name(msg.get('token'))
            if not uname:
                conn.send({'t': 'auth', 'err': '登录已失效,请重新登录'})
                try:
                    conn.sock.shutdown(2)
                except Exception:
                    pass
                return drop(conn)
            code = ''.join(ch for ch in str(msg.get('room', 'ROOM1')).upper()
                           if ch.isalnum())[:8] or 'ROOM1'
            room = rooms.get(code)
            if room is None:
                room = {
                    'players': {},
                    'barrels': [dict(b, hp=BARREL['HP'], alive=True) for b in BARRELS_DEF],
                }
                rooms[code] = room
            if len(room['players']) >= MAX_PLAYERS:
                conn.send({'t': 'full'})
                return
            uid[0] += 1
            team = balanced_team(room)
            spawn = pick_spawn(room, team)
            player = {
                'id': 'p%d' % uid[0],
                'name': uname[:10],
                'team': team, 'room': code, 'conn': conn,
                'hp': MAX_HP, 'alive': True, 'kills': 0, 'deaths': 0,
                'last_dmg': 0.0, 'protect_until': time.time() + PROTECT_S,
                'x': spawn['x'], 'y': spawn['y'],
            }
            conn.player = player
            room['players'][player['id']] = player
            conn.send({
                't': 'welcome', 'id': player['id'], 'name': player['name'],
                'team': team, 'room': code, 'x': spawn['x'], 'y': spawn['y'],
                'players': roster(room),
                'blue': team_scores(room)[0], 'red': team_scores(room)[1],
            })
            broadcast(room, {'t': 'join', 'p': {'i': player['id'], 'n': player['name'],
                                               'tm': player['team']}}, player['id'])
            return

        player = conn.player
        if player is None:
            return
        room = rooms.get(player['room'])
        if room is None:
            return
        t = msg['t']

        if t == 's':  # 位置状态:记录并转发
            if isinstance(msg.get('x'), (int, float)) and isinstance(msg.get('y'), (int, float)):
                player['x'] = msg['x']
                player['y'] = msg['y']
            broadcast(room, {'t': 's', 'p': player['id'], 'x': msg.get('x'), 'y': msg.get('y'),
                             'vx': msg.get('vx'), 'vy': msg.get('vy'), 'a': msg.get('a'),
                             'f': msg.get('f'), 'g': msg.get('g'), 'm': msg.get('m'),
                             'r': msg.get('r')}, player['id'])

        elif t == 'shoot':  # 开火:解除保护并转发
            player['protect_until'] = 0
            broadcast(room, {'t': 'shoot', 'p': player['id'], 'x': msg.get('x'),
                             'y': msg.get('y'), 'a': msg.get('a')}, player['id'])

        elif t == 'hit':  # 命中:服务器结算伤害
            target = room['players'].get(msg.get('tg'))
            if not target or not target['alive'] or target['team'] == player['team']:
                return
            if time.time() < target['protect_until']:
                broadcast(room, {'t': 'hfx', 'tr': player['id'], 'tg': target['id'],
                                 'x': msg.get('x'), 'y': msg.get('y'), 'prot': 1})
                return
            dmg = max(1, min(110, round(msg.get("dmg") or 1)))
            target['hp'] -= dmg
            target['last_dmg'] = time.time()
            broadcast(room, {'t': 'hfx', 'tr': player['id'], 'tg': target['id'],
                             'x': msg.get('x'), 'y': msg.get('y'),
                             'head': 1 if msg.get('head') else 0})
            target['conn'].send({'t': 'dmg', 'p': target['id'], 'hp': max(0, target['hp']),
                                 'from': player['id'], 'x': msg.get('x'), 'y': msg.get('y')})
            if target['hp'] <= 0:
                do_kill(room, target, player)

        elif t == 'bhit':  # 击中油桶:服务器权威爆炸
            barrel = next((b for b in room['barrels'] if b['id'] == msg.get('id')), None)
            if not barrel or not barrel['alive']:
                return
            dmg = max(1, min(110, round(msg.get("dmg") or 1)))
            barrel['hp'] -= dmg
            broadcast(room, {'t': 'bfx', 'id': barrel['id'], 'x': msg.get('x'), 'y': msg.get('y')})
            if barrel['hp'] <= 0:
                explode_barrel(room, barrel, player)

        elif t == 'ping':
            conn.send({'t': 'pong', 'ts': msg.get('ts')})


def ws_loop(conn):
    while not conn.closed:
        head = recv_exact(conn, 2)
        if head is None:
            return drop(conn)
        opcode = head[0] & 0x0F
        masked = head[1] & 0x80
        ln = head[1] & 0x7F
        if ln == 126:
            ext = recv_exact(conn, 2)
            if ext is None:
                return drop(conn)
            ln = int.from_bytes(ext, 'big')
        elif ln == 127:
            ext = recv_exact(conn, 8)
            if ext is None:
                return drop(conn)
            ln = int.from_bytes(ext, 'big')
        if ln > 1000000:
            return drop(conn)
        mask = b''
        if masked:
            mask = recv_exact(conn, 4)
            if mask is None:
                return drop(conn)
        payload = recv_exact(conn, ln)
        if payload is None:
            return drop(conn)
        if mask:
            payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
        if opcode == 0x8:
            return drop(conn)
        if opcode == 0x9:
            send_frame(conn, 0xA, payload)  # ping → pong
        elif opcode == 0x1:
            try:
                on_text(conn, payload.decode('utf-8', 'ignore'))
            except Exception:
                traceback.print_exc()


def regen_loop():
    """脱战回血(与 Node 版一致)"""
    while True:
        time.sleep(0.1)
        try:
            with lock:
                now = time.time()
                for room in list(rooms.values()):
                    for p in list(room['players'].values()):
                        if p['alive'] and 0 < p['hp'] < MAX_HP and now - p['last_dmg'] > REGEN_DELAY:
                            p['hp'] = min(MAX_HP, p['hp'] + REGEN_RATE * 0.1)
                            ihp = int(p['hp'])
                            if ihp != p.get('sent_hp'):
                                p['sent_hp'] = ihp
                                p['conn'].send({'t': 'dmg', 'p': p['id'], 'hp': ihp, 'regen': 1})
        except Exception:
            traceback.print_exc()


MIME_BY_EXT = MIME


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def _json(self, code, obj):
        data = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path_only = self.path.split('?')[0]
        if path_only == '/api/profile':  # 玩家档案查询(需登录)
            user = token_name(self.headers.get('X-SGF-Token'))
            if not user:
                return self._json(401, {'ok': False, 'err': '未登录'})
            with lock:
                p = get_profile(user)
            return self._json(200, {'ok': True, 'profile': p, 'name': user})
        key = self.headers.get('Sec-WebSocket-Key')
        upgrade = (self.headers.get('Upgrade') or '').lower()
        if key and upgrade == 'websocket':
            accept = base64.b64encode(
                hashlib.sha1((key + WS_GUID).encode('utf-8')).digest()).decode('ascii')
            self.connection.sendall(
                ('HTTP/1.1 101 Switching Protocols\r\n'
                 'Upgrade: websocket\r\n'
                 'Connection: Upgrade\r\n'
                 'Sec-WebSocket-Accept: %s\r\n\r\n' % accept).encode('ascii'))
            self.close_connection = True
            ws_loop(Conn(self.connection, self.rfile))
            return
        path = self.path.split('?')[0]
        if path == '/':
            path = '/index.html'
        fp = os.path.normpath(os.path.join(ROOT, path.lstrip('/')))
        if not fp.startswith(ROOT):
            self.send_error(403)
            return
        try:
            with open(fp, 'rb') as f:
                data = f.read()
        except OSError:
            self.send_error(404)
            return
        ext = os.path.splitext(fp)[1].lower()
        self.send_response(200)
        self.send_header('Content-Type', MIME_BY_EXT.get(ext, 'application/octet-stream'))
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path_only = self.path.split('?')[0]
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            body = json.loads(self.rfile.read(length).decode('utf-8') or '{}') if length else {}
        except Exception:
            return self._json(400, {'ok': False, 'err': 'bad json'})

        if path_only in ('/api/register', '/api/login'):
            name = str(body.get('name', '')).strip()[:12]
            pw = str(body.get('pass', ''))
            if len(name) < 2:
                return self._json(400, {'ok': False, 'err': '用户名至少 2 个字符'})
            if len(pw) < 4:
                return self._json(400, {'ok': False, 'err': '密码至少 4 位'})
            with lock:
                if path_only == '/api/register':
                    conn = _conn()
                    exists = conn.execute('SELECT 1 FROM users WHERE name=?', (name,)).fetchone()
                    conn.close()
                    if exists:
                        return self._json(409, {'ok': False, 'err': '用户名已被注册'})
                    create_user(name, pw)
                elif not verify_user(name, pw):
                    return self._json(401, {'ok': False, 'err': '用户名或密码错误'})
                tk = issue_token(name)
                p = get_profile(name)
            return self._json(200, {'ok': True, 'name': name, 'token': tk, 'profile': p})

        if path_only != '/api/profile':
            return self.send_error(404)
        user = token_name(self.headers.get('X-SGF-Token'))
        if not user:
            return self._json(401, {'ok': False, 'err': '未登录'})
        with lock:
            p = update_profile(user, body)
        return self._json(200, {'ok': True, 'profile': p})

    def log_message(self, fmt, *args):  # 静默访问日志
        pass


def make_server(port=PORT):
    httpd = ThreadingHTTPServer(('', port), Handler)
    httpd.daemon_threads = True
    t = threading.Thread(target=regen_loop, daemon=True)
    t.start()
    return httpd


if __name__ == '__main__':
    httpd = make_server(PORT)
    print('========================================')
    print('  🔥 火柴人机枪大战 · Python 服务器已启动')
    print('  本机游戏:  http://localhost:%d' % PORT)
    print('  局域网联机: http://<你的局域网IP>:%d' % PORT)
    print('========================================')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
