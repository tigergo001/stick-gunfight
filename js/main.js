'use strict';
// ===== 视口 / 主循环 / 菜单 =====
const View = {
  scale: 1, ox: 0, oy: 0, dpr: 1, cssW: 1600, cssH: 900,
  rect: { left: 0, top: 0 },
  resize(canvas) {
    this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.cssW = window.innerWidth;
    this.cssH = window.innerHeight;
    canvas.width = Math.round(this.cssW * this.dpr);
    canvas.height = Math.round(this.cssH * this.dpr);
    canvas.style.width = this.cssW + 'px';
    canvas.style.height = this.cssH + 'px';
    const r = canvas.getBoundingClientRect();
    this.rect = { left: r.left, top: r.top };
    this.scale = Math.min(this.cssW / Arena.W, this.cssH / Arena.H);
    this.ox = (this.cssW - Arena.W * this.scale) / 2;
    this.oy = (this.cssH - Arena.H * this.scale) / 2;
  },
  toWorld(cx, cy) {
    return {
      x: (cx - this.rect.left - this.ox) / this.scale,
      y: (cy - this.rect.top - this.oy) / this.scale,
    };
  },
};

function defaultServerUrl() {
  try {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      const wsProtocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
      return wsProtocol + location.host;
    }
  } catch (e) {}
  return 'ws://localhost:8080';
}

function init() {
  const canvas = document.getElementById('game');
  View.resize(canvas);
  window.addEventListener('resize', () => View.resize(canvas));
  Input.init(canvas);

  const game = new Game(canvas);
  window.__game = game;

  // ---- 菜单元素 ----
  const $ = (id) => document.getElementById(id);
  const menu = $('menu');
  const nameInput = $('nameInput');
  const srvInput = $('srvInput');
  const roomInput = $('roomInput');
  const netStatus = $('netStatus');
  const btnResume = $('btnResume');
  let enemyN = 2, allyN = 1;

  try { nameInput.value = localStorage.getItem('sgf_name') || ''; } catch (e) {}
  srvInput.value = defaultServerUrl();

  // ===== 登录验证 =====
  const loginEl = $('login');
  const loginName = $('loginName');
  const loginPass = $('loginPass');
  const loginStatus = $('loginStatus');
  const setLoginStatus = (msg, isErr) => {
    loginStatus.textContent = msg || '';
    loginStatus.className = msg ? (isErr ? 'err' : 'ok') : '';
  };
  const showLogin = (msg) => {
    loginEl.classList.remove('hidden');
    menu.classList.add('hidden');
    document.body.classList.remove('playing');
    setLoginStatus(msg || '');
    setTimeout(() => { try { loginName.focus(); } catch (e) {} }, 50);
  };
  const hideLogin = () => loginEl.classList.add('hidden');
  const doAuth = async (action) => {
    const name = (loginName.value || '').trim();
    const pass = loginPass.value || '';
    if (name.length < 2) return setLoginStatus('用户名至少 2 个字符', true);
    if (pass.length < 4) return setLoginStatus('密码至少 4 位', true);
    setLoginStatus(action === 'register' ? '注册中…' : '登录中…');
    try {
      const d = await Net.auth(action, name, pass);
      nameInput.value = d.name;
      hideLogin();
      showMenu();
      loadProfile();
      setLoginStatus('');
      Sfx.init(); Sfx.resume(); Sfx.ui();
    } catch (e) {
      setLoginStatus('✗ ' + e.message, true);
    }
  };
  $('btnLogin').addEventListener('click', () => doAuth('login'));
  $('btnRegister').addEventListener('click', () => doAuth('register'));
  loginPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth('login'); });
  loginName.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginPass.focus(); });
  $('btnLogout').addEventListener('click', () => {
    Net.logout();
    game.leaveToMenu();
    showLogin('已退出登录');
  });

  const showMenu = () => {
    if (!Net.token()) { showLogin(); return; }  // 未登录不允许进菜单
    hideLogin();
    menu.classList.remove('hidden');
    document.body.classList.remove('playing');
    btnResume.classList.add('hidden');   // 回主菜单时隐藏对局中的按钮
    $('btnQuit').classList.add('hidden');
    loadProfile();                        // 刷新等级/经验/闯关进度徽章
  };
  const hideMenu = () => { menu.classList.add('hidden'); document.body.classList.add('playing'); };
  const status = (msg, isErr) => {
    netStatus.textContent = msg || '';
    netStatus.classList.toggle('err', !!isErr);
    netStatus.classList.toggle('ok', !isErr && !!msg);
  };
  game.ui = { showMenu, hideMenu, status };

  const playerName = () => (Net.user() || (nameInput.value || '').trim() || '无名火柴人').slice(0, 10);

  // 单人(游戏逻辑优先,音效失败绝不阻断开局)
  $('btnSolo').addEventListener('click', () => {
    game.startSolo({ enemies: enemyN, allies: allyN, difficulty, weapon: weaponId, name: playerName(), profile });
    hideMenu();
    Input.clear();
    try { Sfx.init(); Sfx.resume(); Sfx.ui(); } catch (e) {}
  });
  const bindStep = (minusId, plusId, get, set) => {
    $(minusId).addEventListener('click', () => { set(Math.max(get() - 1, 0)); Sfx.ui(); });
    $(plusId).addEventListener('click', () => { set(Math.min(get() + 1, 9)); Sfx.ui(); });
  };
  const refreshCounts = () => {
    $('enemyCount').textContent = String(enemyN);
    $('allyCount').textContent = String(allyN);
  };
  bindStep('enemyMinus', 'enemyPlus', () => enemyN, (v) => { enemyN = Math.max(v, 1); refreshCounts(); });
  bindStep('allyMinus', 'allyPlus', () => allyN, (v) => { allyN = v; refreshCounts(); });
  refreshCounts();

  // 机器人智商:弱 / 中 / 强
  let difficulty = 'medium';
  const setDiff = (d) => {
    difficulty = d;
    $('diffWeak').classList.toggle('active', d === 'weak');
    $('diffMedium').classList.toggle('active', d === 'medium');
    $('diffStrong').classList.toggle('active', d === 'strong');
  };
  $('diffWeak').addEventListener('click', () => { setDiff('weak'); Sfx.ui(); });
  $('diffMedium').addEventListener('click', () => { setDiff('medium'); Sfx.ui(); });
  $('diffStrong').addEventListener('click', () => { setDiff('strong'); Sfx.ui(); });
  setDiff('medium');

  // 辅助瞄准:关 / 辅助 / 锁定(持久保存;联机强制关闭)
  const setAim = (mode, save) => {
    game.aimAssist = mode;
    $('aimOff').classList.toggle('active', mode === 0);
    $('aimAssistBtn').classList.toggle('active', mode === 1);
    $('aimLockBtn').classList.toggle('active', mode === 2);
    if (save) { try { localStorage.setItem('sgf_aim', String(mode)); } catch (e) {} }
  };
  $('aimOff').addEventListener('click', () => { setAim(0, true); Sfx.ui(); });
  $('aimAssistBtn').addEventListener('click', () => { setAim(1, true); Sfx.ui(); });
  $('aimLockBtn').addEventListener('click', () => { setAim(2, true); Sfx.ui(); });
  let savedAim = 1;
  try { const s = localStorage.getItem('sgf_aim'); if (s !== null) savedAim = clamp(parseInt(s, 10) || 0, 0, 2); } catch (e) {}
  setAim(savedAim, false);

  // ===== 玩家档案 / 武器库 / 闯关 =====
  let weaponId = 'm249';
  let campStage = 1;
  let profile = null;

  const statBar = (label, pct) => {
    pct = clamp(pct, 0.06, 1);
    return '<div class="stat"><span>' + label + '</span>' +
      '<div class="sbar"><div class="sfill" style="width:' + Math.round(pct * 100) + '%"></div></div></div>';
  };
  const renderWeapons = () => {
    const lvl = profile ? CFG.levelFromXp(profile.xp) : 1;
    const list = $('weaponList');
    list.innerHTML = '';
    for (const id of Object.keys(CFG.WEAPONS)) {
      const w = CFG.WEAPONS[id];
      if (w.temp) continue; // 限时强化枪不进入武器库(靠补给掉落)
      const locked = lvl < w.minLevel;
      const el = document.createElement('div');
      el.className = 'wcard' + (id === weaponId ? ' selected' : '') + (locked ? ' locked' : '');
      el.innerHTML =
        '<div class="wname">' + w.name + '</div>' +
        '<div class="wdesc">' + (locked ? '🔒 Lv.' + w.minLevel + ' 解锁' : w.desc) + '</div>' +
        '<div class="wstats">' + statBar('伤害', w.dmg / 50) + statBar('射速', w.rpm / 900) + '</div>';
      el.addEventListener('click', () => {
        if (locked) {
          el.classList.add('shake');
          setTimeout(() => el.classList.remove('shake'), 450);
          return;
        }
        weaponId = id;
        renderWeapons();
        try { Sfx.ui(); } catch (e) {}
      });
      list.appendChild(el);
    }
  };
  const refreshProfileUI = () => {
    const lvl = profile ? CFG.levelFromXp(profile.xp) : 1;
    $('pLevel').textContent = String(lvl);
    $('pNameTitle').textContent = (nameInput.value || '').trim() || '无名火柴人';
    const base = CFG.xpForLevel(lvl), next = CFG.xpForLevel(lvl + 1);
    const cur = profile ? profile.xp : 0;
    $('pXpFill').style.width = Math.round(clamp((cur - base) / Math.max(1, next - base), 0, 1) * 100) + '%';
    $('pXpText').textContent = Math.max(0, cur - base) + ' / ' + (next - base) + ' XP · 击杀 ' + (profile ? profile.kills : 0);
    $('campBest').textContent = '进度:第 ' + Math.min(profile ? profile.stage : 1, CFG.CAMPAIGN_TOTAL) + ' / ' + CFG.CAMPAIGN_TOTAL + ' 关';
    campStage = clamp(campStage, 1, Math.min(profile ? profile.stage : 1, CFG.CAMPAIGN_TOTAL));
    $('campStage').textContent = String(campStage);
    renderWeapons();
  };
  const loadProfile = async () => {
    profile = await Net.fetchProfile(playerName());
    if (!profile) {          // 令牌失效
      profile = Net.defaultProfile(playerName());
      if (Net._hasHttp()) { showLogin('登录已失效,请重新登录'); return; }
    }
    refreshProfileUI();
  };
  $('campMinus').addEventListener('click', () => { campStage = clamp(campStage - 1, 1, profile ? profile.stage : 1); refreshProfileUI(); Sfx.ui(); });
  $('campPlus').addEventListener('click', () => { campStage = clamp(campStage + 1, 1, Math.min(profile ? profile.stage : 1, CFG.CAMPAIGN_TOTAL)); refreshProfileUI(); Sfx.ui(); });
  $('btnCampaign').addEventListener('click', () => {
    Sfx.init(); Sfx.resume(); Sfx.ui();
    game.startCampaign(campStage, { weapon: weaponId, name: playerName(), profile });
    hideMenu();
    Input.clear();
  });
  nameInput.addEventListener('change', () => { loadProfile(); });

  // 联机
  $('btnOnline').addEventListener('click', () => {
    $('onlineOpts').classList.toggle('hidden');
    Sfx.ui();
  });
  const joinOnline = () => {
    const url = (srvInput.value || '').trim() || defaultServerUrl();
    const room = (roomInput.value || '').trim().toUpperCase() || 'ROOM1';
    status('连接中 ' + url + ' …');
    try { Sfx.init(); Sfx.resume(); } catch (e) {}
    Net.connect(url, room, playerName()).then((w) => {
      game.startOnline(w, weaponId);
      game.profile = profile;
      hideMenu();
      Input.clear();
      status('');
    }).catch((e) => {
      status('✗ ' + e.message + '(请确认已运行 node server.js)', true);
    });
  };
  $('btnJoin').addEventListener('click', joinOnline);
  roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinOnline(); });

  // Esc 菜单 / 返回
  btnResume.addEventListener('click', () => {
    if (game.mode !== 'menu') {
      game.paused = false;
      hideMenu();
      $('btnQuit').classList.add('hidden');
    }
    Sfx.ui();
  });
  $('btnQuit').addEventListener('click', () => {
    game.leaveToMenu();
    showMenu();
    btnResume.classList.add('hidden');
    $('btnQuit').classList.add('hidden');
    status('');
    Sfx.ui();
  });

  // URL 参数自动开局(便于测试): ?solo=敌人数量&ally=队友数量
  // ?autoclick=btnSolo 可模拟真实点击按钮(用于回归测试按钮链路)
  try {
    const q = new URLSearchParams(location.search);
    if (q.has('solo') || q.has('camp')) {
      // 调试/QA 直达:自动创建演示账号(仍走服务器注册,不绕过账号体系)
      (async () => {
        if (!Net.token()) {
          const u = '演示' + (Math.floor(Math.random() * 9000) + 1000);
          try { await Net.auth('register', u, 'demo1234'); } catch (e) {}
        }
        if (!Net.token()) return;
        nameInput.value = Net.user();
        hideLogin();
        showMenu();
        loadProfile();
        const wp = q.get('weapon');
        const wid = CFG.WEAPONS[wp] ? wp : 'm249';
        if (q.has('solo')) {
          const d = q.get('diff');
          game.startSolo({
            enemies: parseInt(q.get('solo'), 10) || 2,
            allies: parseInt(q.get('ally'), 10) || 0,
            difficulty: (d === 'weak' || d === 'medium' || d === 'strong') ? d : 'medium',
            weapon: wid, name: Net.user(), profile: null,
          });
        } else {
          game.startCampaign(parseInt(q.get('camp'), 10) || 1, { weapon: wid, name: Net.user() });
        }
        hideMenu();
        if (q.has('car')) {   // 调试:传送到停放的载具旁
          const veh = game.fighters.find(f => f.kind === 'tank' && !f.isBoss);
          if (veh) {
            game.local.x = veh.x - 60;
            game.camX = clamp(game.local.x - Arena.W * 0.4, 0, Arena.levelW - Arena.W);
          }
        }
        if (q.has('boss') && game.campaign) {
          game.local.x = game.campaign.bossX - 260;
          game.camX = clamp(game.local.x - Arena.W * 0.4, 0, Arena.levelW - Arena.W);
        }
      })();
    }
    if (q.has('autoclick')) {
      const target = q.get('autoclick') || 'btnSolo';
      setTimeout(() => {
        const el = document.getElementById(target);
        if (el) el.click();
      }, 300);
    }
    if (q.has('play')) {
      // 自动游玩:合成键鼠事件模拟真实玩家(回归测试用)
      const cv = document.getElementById('game');
      let phase = 0;
      setInterval(() => {
        const g = window.__game;
        if (!g || g.mode === 'menu' || !g.local) return;
        phase++;
        if (phase % 5 === 0) {
          console.log('[play] t=' + g.time.toFixed(1) + 's hp=' + Math.round(g.local.hp) +
            ' ammo=' + g.local.ammo + ' alive=' + g.local.alive + ' mode=' + g.mode);
        }
        let e = null, bd = Infinity;
        for (const f of g.fighters) {
          if (f !== g.local && f.alive) {
            const d = Math.hypot(f.x - g.local.x, f.y - g.local.y);
            if (d < bd) { bd = d; e = f; }
          }
        }
        if (e) {
          cv.dispatchEvent(new MouseEvent('mousemove', { clientX: e.x, clientY: e.y - 40 }));
          if (phase % 3 !== 0) cv.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
          else cv.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
        }
        window.dispatchEvent(new KeyboardEvent('keydown', { code: phase % 8 < 4 ? 'KeyD' : 'KeyA' }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: phase % 8 < 4 ? 'KeyA' : 'KeyD' }));
        if (phase % 6 === 2) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }));
        if (phase % 9 === 4) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      }, 300);
    }
  } catch (e) {}

  // 启动:校验登录态(无令牌则显示登录页)
  (async () => {
    if (!Net._hasHttp()) { showLogin('请通过服务器访问(node server.sh / server.js)后登录'); return; }
    if (!Net.token()) { showLogin('请登录后开始游戏'); return; }
    const ok = await Net.checkSession();
    if (!ok) { showLogin('登录已失效,请重新登录'); return; }
    nameInput.value = Net.user();
    showMenu();
    loadProfile();
  })();

  // 主循环
  let last = performance.now();
  function loop(now) {    const dt = Math.min(0.05, (now - last) / 1000) || 0.016;
    last = now;
    // Esc 切换菜单
    if (Input.jp('Escape')) {
      if (game.campaign && game.campaign.overlay) {
        // 关卡结算界面:Esc 由游戏内部处理(返回主菜单)
      } else if (game.mode !== 'menu') {
        game.paused = !game.paused;
        if (game.paused) {
          showMenu();
          btnResume.classList.remove('hidden');
          $('btnQuit').classList.remove('hidden');
        } else {
          hideMenu();
          btnResume.classList.add('hidden');
          $('btnQuit').classList.add('hidden');
        }
        Sfx.ui();
      }
    }
    // 单帧异常不再杀死渲染循环(防止任何未知 bug 导致整页"卡死")
    try {
      game.frame(dt);
    } catch (err) {
      console.error('[game] 帧异常(已跳过):', err);
    }
    Input.endFrame();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

// 供调试 / 自动化测试使用
if (typeof window !== 'undefined') {
  window.SGF = { Game, Input, Net, CFG, Arena, Bullets, Particles, Corpses, FloatTexts, Sfx, View, Bot, LocalPlayer, Tank, GiantBoss, Apc };
}
