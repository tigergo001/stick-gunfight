'use strict';
// ===== 键鼠输入 =====
const Input = {
  keys: new Set(),
  pressed: new Set(),
  mouse: { x: 800, y: 450, down: false },

  init(canvas) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) { this.keys.add(e.code); this.pressed.add(e.code); }
      Sfx.init(); Sfx.resume();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });
    canvas.addEventListener('mousemove', (e) => {
      const w = View.toWorld(e.clientX, e.clientY);
      this.mouse.x = w.x; this.mouse.y = w.y;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.down = true;
      Sfx.init(); Sfx.resume();
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  },
  down(c) { return this.keys.has(c); },
  jp(c) { return this.pressed.has(c); },
  endFrame() { this.pressed.clear(); },
  clear() { this.keys.clear(); this.pressed.clear(); this.mouse.down = false; },
};
