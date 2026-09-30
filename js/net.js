'use strict';
// ===== 联机客户端(WebSocket) =====
const Net = {
  ws: null,
  open: false,
  id: null,
  room: null,
  handlers: {},
  latency: 0,
  _sendT: 0,
  _pingT: 0,
  // 好友邀请(钩子挂实例属性;handlers 会被 game.js 的 _wireNet 整体替换)
  pinv: null, // 最近收到的邀请 { from, room }
  onInvite: null,
  onInviteAck: null,
  onInviteResult: null,
  onInviteGone: null,

  connect(url, room, name) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws;
      try { ws = new WebSocket(url); } catch (e) { return reject(new Error('地址无效')); }
      this.ws = ws;
      const to = setTimeout(() => {
        if (!settled) { settled = true; try { ws.close(); } catch (e) {} reject(new Error('连接超时')); }
      }, 5000);
      ws.onopen = () => { ws.send(JSON.stringify({ t: 'join', room, name, token: this.token() })); };
      ws.onmessage = (ev) => {
        let d;
        try { d = JSON.parse(ev.data); } catch (e) { return; }
        if (d.t === 'auth') {
          settled = true;
          clearTimeout(to);
          this.clearSession();
          try { ws.close(); } catch (e) {}
          reject(new Error(d.err || '登录已失效,请重新登录'));
          return;
        }
        if (d.t === 'welcome') {
          settled = true;
          clearTimeout(to);
          this.open = true;
          this.id = d.id;
          this.room = d.room;
          this.handlers.welcome && this.handlers.welcome(d);
          resolve(d);
          return;
        }
        if (d.t === 'ivt') { // 收到对战邀请(挂实例属性而非 handlers,避免被 _wireNet 整体替换吞掉)
          this.pinv = d;
          this.onInvite && this.onInvite(d);
          return;
        }
        if (d.t === 'iack') { // 邀请发送回执
          this.onInviteAck && this.onInviteAck(d);
          return;
        }
        if (d.t === 'irs') { // 对方接受/拒绝邀请
          this.onInviteResult && this.onInviteResult(d);
          return;
        }
        const h = this.handlers[d.t];
        if (h) h(d);
      };
      ws.onerror = () => {
        if (!settled) { settled = true; clearTimeout(to); reject(new Error('无法连接服务器')); }
      };
      ws.onclose = () => {
        const was = this.open;
        this.open = false;
        this.pinv = null;
        this.onInviteGone && this.onInviteGone();
        if (!settled) { settled = true; clearTimeout(to); reject(new Error('连接已关闭')); }
        else if (was && this.handlers.close) this.handlers.close();
      };
    });
  },

  send(o) {
    if (this.open && this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o));
  },
  sendState(f, now) {
    if (now < this._sendT) return;
    this._sendT = now + 1 / CFG.NET.STATE_HZ;
    this.send({
      t: 's',
      x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10,
      vx: Math.round(f.vx), vy: Math.round(f.vy),
      a: Math.round(f.aim * 1000) / 1000, f: f.face,
      g: f.onGround ? 1 : 0, m: f.moving ? 1 : 0, r: f.reloading ? 1 : 0,
    });
  },
  sendShoot(x, y, a) {
    this.send({ t: 'shoot', x: Math.round(x * 10) / 10, y: Math.round(y), a: Math.round(a * 1000) / 1000 });
  },
  sendHit(tid, dmg, head, x, y) {
    this.send({ t: 'hit', tg: tid, dmg: Math.round(dmg), head: head ? 1 : 0, x: Math.round(x), y: Math.round(y) });
  },
  sendBarrelHit(id, dmg, x, y) {
    this.send({ t: 'bhit', id, dmg: Math.round(dmg), x: Math.round(x), y: Math.round(y) });
  },

  // ===== 好友对战邀请 =====
  sendInvite(to) { this.send({ t: 'ivt', to }); },
  answerInvite(ok) { this.send({ t: 'irs', ok: ok ? 1 : 0 }); },

  // ===== 登录会话(令牌) =====
  token() { try { return localStorage.getItem('sgf_token') || ''; } catch (e) { return ''; } },
  user() { try { return localStorage.getItem('sgf_user') || ''; } catch (e) { return ''; } },
  setSession(token, user) {
    try { localStorage.setItem('sgf_token', token); localStorage.setItem('sgf_user', user); } catch (e) {}
  },
  clearSession() {
    try { localStorage.removeItem('sgf_token'); localStorage.removeItem('sgf_user'); } catch (e) {}
  },
  logout() { this.clearSession(); this.close(); },
  // 注册 / 登录(action: 'login' | 'register';code 仅注册时的口令)
  async auth(action, name, pass, code) {
    const r = await fetch('/api/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pass, code: code || undefined }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.err || '连接失败(' + r.status + ')');
    this.setSession(d.token, d.name);
    return d;
  },
  // 校验本地令牌是否仍有效
  async checkSession() {
    if (!this.token()) return null;
    try {
      const r = await fetch('/api/profile', { headers: { 'X-SGF-Token': this.token() } });
      if (r.status === 401) { this.clearSession(); return null; }
      const d = await r.json();
      return d.ok ? d : null;
    } catch (e) { return null; }
  },

  // ===== 玩家档案(SQLite 服务器存储;无服务器时回退 localStorage) =====
  defaultProfile(name) {
    return { name, xp: 0, kills: 0, deaths: 0, matches: 0, bestStreak: 0, stage: 1, weapon: 'm249' };
  },
  _hasHttp() {
    return typeof fetch === 'function' && typeof location !== 'undefined' &&
      (location.protocol === 'http:' || location.protocol === 'https:');
  },
  async fetchProfile(name) {
    try {
      if (this._hasHttp() && this.token()) {
        const r = await fetch('/api/profile', { headers: { 'X-SGF-Token': this.token() } });
        if (r.status === 401) { this.clearSession(); return null; }
        if (r.ok) {
          const d = await r.json();
          if (d && d.ok) return d.profile;
        }
      }
    } catch (e) {}
    try {
      const s = localStorage.getItem('sgf_profile_' + name);
      if (s) return Object.assign(this.defaultProfile(name), JSON.parse(s));
    } catch (e) {}
    return this.defaultProfile(name);
  },
  async reportProfile(name, patch) {
    try {
      if (this._hasHttp() && this.token()) {
        const r = await fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-SGF-Token': this.token() },
          body: JSON.stringify(patch),
        });
        if (r.ok) {
          const d = await r.json();
          if (d && d.ok) return d.profile;
        }
      }
    } catch (e) {}
    try { // 本地合并兜底
      const p = Object.assign(this.defaultProfile(name),
        JSON.parse(localStorage.getItem('sgf_profile_' + name) || '{}'));
      p.xp += patch.addXp || 0;
      p.kills += patch.addKills || 0;
      p.deaths += patch.addDeaths || 0;
      p.bestStreak = Math.max(p.bestStreak || 0, patch.bestStreak || 0);
      if (patch.stageCleared) p.stage = Math.max(p.stage || 1, patch.stageCleared + 1);
      if (patch.weapon) p.weapon = patch.weapon;
      if (patch.matchComplete) p.matches = (p.matches || 0) + 1;
      localStorage.setItem('sgf_profile_' + name, JSON.stringify(p));
      return p;
    } catch (e) {
      return null;
    }
  },
  tickNet(now) {
    if (now > this._pingT) { this.send({ t: 'ping', ts: Date.now() }); this._pingT = now + 2; }
  },
  close() {
    try { this.ws && this.ws.close(); } catch (e) {}
    this.open = false;
  },
};
