'use strict';
// ===== 程序化音效(WebAudio,无外部资源) =====
const Sfx = {
  ac: null, master: null, noise: null, camX: 800,

  init() {
    if (this.ac) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ac.destination);
      const len = this.ac.sampleRate;
      this.noise = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { /* 无音频环境时静默 */ }
  },
  resume() {
    if (this.ac && this.ac.state === 'suspended') this.ac.resume().catch(() => {});
  },
  _pan(x) {
    if (!this.ac || !this.ac.createStereoPanner) return null;
    if (typeof x !== 'number' || !isFinite(x)) return null; // 无坐标:不做声像偏移
    const p = this.ac.createStereoPanner();
    p.pan.value = clamp((x - this.camX) / 800, -1, 1) * 0.7;
    p.connect(this.master);
    return p;
  },
  _noiseBurst(dur, freq, q, gain, x, type = 'bandpass') {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    const src = this.ac.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ac.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g);
    const p = this._pan(x);
    if (p) g.connect(p); else g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  },
  _tone(type, f0, f1, dur, gain, x, delay = 0) {
    if (!this.ac) return;
    const t = this.ac.currentTime + delay;
    const o = this.ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = this.ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    const p = this._pan(x);
    if (p) g.connect(p); else g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  },
  shoot(x) {
    this._noiseBurst(0.07, 850 + rand(-120, 120), 0.8, 0.14, x);
    this._tone('square', 150, 90, 0.06, 0.09, x);
  },
  remoteShoot(x) { this._noiseBurst(0.06, 700 + rand(-100, 100), 0.8, 0.06, x); },
  hit() { this._tone('square', 1300, 1000, 0.05, 0.08); },
  headshot() { this._tone('square', 1700, 1300, 0.08, 0.1); },
  kill() {
    this._tone('square', 600, 900, 0.09, 0.1);
    this._tone('square', 900, 1350, 0.1, 0.1, null, 0.08);
  },
  reloadStart() { this._noiseBurst(0.04, 2500, 2, 0.1, null, 'highpass'); },
  reloadEnd() {
    this._noiseBurst(0.05, 1800, 2, 0.12, null, 'highpass');
    this._tone('square', 500, 400, 0.05, 0.06);
  },
  dry() { this._tone('square', 2200, 2000, 0.03, 0.06); },
  die(x) { this._tone('sawtooth', 320, 70, 0.35, 0.12, x); },
  explosion(x) {
    this._noiseBurst(0.45, 300, 0.4, 0.5, x, 'lowpass');
    this._tone('sine', 110, 32, 0.5, 0.4, x);
    this._noiseBurst(0.12, 2400, 1, 0.16, x);
  },
  hurt() { this._noiseBurst(0.1, 300, 1, 0.16, null, 'lowpass'); },
  spawn() { this._tone('sine', 380, 760, 0.14, 0.1); },
  ui() { this._tone('sine', 700, 900, 0.06, 0.07); },
};
