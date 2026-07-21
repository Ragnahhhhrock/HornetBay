// audio.js — engine/SFX built around samples captured from the original Amiga
// game (eng_idle/eng_mil loops, gear servo, missile whoosh, explosion boom).
// No music: the original plays its theme only on the title screens, and the
// user asked for none here. Warning tones are synthesized to match.
import { clamp, lerp } from './util.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this._lockLvl = 0; this._locked = false; this._stall = false; this._missileWarn = false;
    this.buf = {}; // decoded samples
  }
  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain(); this.sfx.gain.value = 1; this.sfx.connect(this.master);
      this._loadSamples();
      this._buildWind();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  setMusicOn() { /* music removed at user request */ }

  async _loadSamples() {
    const files = ['eng_idle', 'eng_mil', 'gear', 'whoosh', 'boom'];
    await Promise.all(files.map(async n => {
      try {
        let ab;
        if (window.__SFX_B64 && window.__SFX_B64[n]) {
          // standalone single-file build: samples embedded as base64
          const bin = atob(window.__SFX_B64[n]);
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          ab = u8.buffer;
        } else {
          const r = await fetch(`sfx/${n}.wav`);
          ab = await r.arrayBuffer();
        }
        this.buf[n] = await this.ctx.decodeAudioData(ab);
      } catch (e) { /* sample missing — synth fallbacks still work */ }
    }));
    this._buildEngineLoop();
  }

  // ---------- continuous engine: two recorded loops crossfaded by thrust ----------
  _buildEngineLoop() {
    if (!this.buf.eng_idle || !this.buf.eng_mil) return;
    const c = this.ctx;
    const mk = (b) => {
      const s = c.createBufferSource(); s.buffer = b; s.loop = true;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(g); g.connect(this.sfx); s.start();
      return { s, g };
    };
    this.engA = mk(this.buf.eng_idle);   // 7% idle loop
    this.engB = mk(this.buf.eng_mil);    // full mil loop
    this._rpm = 0;
  }
  _buildWind() {
    const c = this.ctx;
    this.windSrc = c.createBufferSource(); this.windSrc.buffer = this._noiseBuffer(2); this.windSrc.loop = true;
    this.windFilter = c.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 500; this.windFilter.Q.value = 0.6;
    this.windGain = c.createGain(); this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.sfx);
    this.windSrc.start();
  }
  _noiseBuffer(sec) {
    const c = this.ctx, buf = c.createBuffer(1, c.sampleRate * sec, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  // rpm 0..1.1, ab bool, speed m/s
  updateFlight(rpm, ab, speed) {
    if (!this.ctx) return;
    if (this._chute) return;   // pilot is out: the chute's own rush owns the air
    const t = this.ctx.currentTime;
    if (this.engA) {
      const r = clamp(rpm, 0, 1);
      // recorded loops: idle fades out as mil fades in; pitch follows thrust
      this.engA.g.gain.setTargetAtTime(0.34 * (1 - r), t, 0.12);
      this.engB.g.gain.setTargetAtTime(0.12 + 0.30 * r, t, 0.12);
      const rate = 0.92 + r * 0.24;
      this.engA.s.playbackRate.setTargetAtTime(rate, t, 0.12);
      this.engB.s.playbackRate.setTargetAtTime(rate, t, 0.12);
    }
    const w = clamp(speed / 350, 0, 1);
    this.windGain.gain.setTargetAtTime(w * w * 0.20 + (ab ? 0.10 : 0), t, 0.2);
    this.windFilter.frequency.setTargetAtTime(300 + speed * 3, t, 0.2);
    // stall horn: the original's ~600 Hz harmonic horn, pulsed
    if (this._stall && t > (this._beepTimer || 0)) { this._tone(600, 0.13, 0.16, 'square'); this._beepTimer = t + 0.24; }
    if (this._missileWarn && t > (this._mwTimer || 0)) { this._tone(1400, 0.06, 0.14, 'square'); this._mwTimer = t + 0.13; }
    if (this._lockLvl > 0.03) {
      if (this._locked) { if (t > (this._lkTimer || 0)) { this._tone(1180, 0.05, 0.08, 'sine'); this._lkTimer = t + 0.09; } }
      else if (t > (this._lkTimer || 0)) { this._tone(760, 0.05, 0.07, 'sine'); this._lkTimer = t + lerp(0.5, 0.12, this._lockLvl); }
    }
  }
  setStall(b) { this._stall = b; }
  setMissileWarn(b) { this._missileWarn = b; }
  setLock(lvl, locked) { this._lockLvl = lvl; this._locked = locked; }

  // ejection: the cockpit goes silent — engine loops and warning tones cut,
  // replaced by the sound of rushing air as the pilot drifts back to earth
  eject() {
    this._chute = true;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._stall = this._missileWarn = this._locked = false; this._lockLvl = 0;
    if (this.engA) {
      this.engA.g.gain.setTargetAtTime(0, t, 0.25);
      this.engB.g.gain.setTargetAtTime(0, t, 0.25);
    }
    this._noiseHit(0.5, 0.5, 1800, 0.7, 500);   // canopy pyro + first blast of freefall
    this.windGain.gain.setTargetAtTime(0.30, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(900, t, 0.1);
  }
  // every frame while the chute rides: a steady rush that follows the descent rate
  updateChute(vy) {
    if (!this.ctx || !this._chute) return;
    const t = this.ctx.currentTime, w = clamp(Math.abs(vy) / 30, 0, 1);
    this.windGain.gain.setTargetAtTime(0.10 + w * 0.12, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(600 + Math.abs(vy) * 25, t, 0.3);
  }
  chuteLand() {
    if (!this.ctx) return;
    this._noiseHit(0.35, 0.4, 500, 0.8, 120);   // soft thump / splash
    this.endChute();
  }
  endChute() {
    if (!this._chute) return;
    this._chute = false;
    if (!this.ctx) return;
    this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
  }

  _play(name, vol = 1, rate = 1) {
    if (!this.ctx || !this.buf[name]) return;
    const c = this.ctx, s = c.createBufferSource(), g = c.createGain();
    s.buffer = this.buf[name]; s.playbackRate.value = rate;
    g.gain.value = vol;
    s.connect(g); g.connect(this.sfx); s.start();
  }
  _tone(freq, dur, vol, type = 'sine', slideTo = null) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.02);
  }
  _noiseHit(dur, vol, freq, q = 1, slideTo = null) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this._noiseBuffer(dur + 0.1);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx); s.start(t); s.stop(t + dur + 0.05);
  }
  gun() { this._noiseHit(0.07, 0.5, 2600, 0.7, 500); }
  gunHit() { this._noiseHit(0.06, 0.25, 4000, 1, 1200); }
  missileFire() { this._play('whoosh', 0.9); this._noiseHit(0.9, 0.3, 3200, 0.6, 300); }
  sonicBoom() {
    // pressure crack, then the classic double N-wave thump
    this._noiseHit(0.45, 0.85, 600, 0.7, 140);
    this._tone(58, 0.4, 0.9, 'sine', 38);
    setTimeout(() => { this._tone(50, 0.55, 0.75, 'sine', 32); this._noiseHit(0.3, 0.45, 420, 0.7, 120); }, 140);
  }
  enemyMissile() { this._tone(1600, 0.5, 0.2, 'square', 500); }
  explosion(dist = 0) {
    const v = clamp(1 - dist / 6000, 0.08, 1);
    this._play('boom', 0.9 * v);
    this._tone(90, 1.1, 0.5 * v, 'sine', 28);
  }
  chaff() { this._noiseHit(0.3, 0.25, 6000, 2, 2000); }
  gear() { this._play('gear', 0.8); }
  hook() { this._tone(160, 0.25, 0.25, 'square', 80); }
  trap() { this._noiseHit(0.7, 0.6, 800, 0.8, 100); this._tone(120, 0.5, 0.4, 'sawtooth', 45); }
  radioClick() { this._noiseHit(0.04, 0.18, 3500, 3); }
  // air rushing past during the satellite-map dive down to the cockpit —
  // a noise swell that climbs with the dive, then settles as you arrive
  zoomRush(dur = 4.5) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this._noiseBuffer(dur + 0.6);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.55;
    f.frequency.setValueAtTime(280, t);
    f.frequency.exponentialRampToValueAtTime(1500, t + dur * 0.7);   // dive whistle builds
    f.frequency.exponentialRampToValueAtTime(450, t + dur + 0.25);   // flare as you arrive
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.10, t + dur * 0.15);
    g.gain.exponentialRampToValueAtTime(0.42, t + dur * 0.65);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.3);
    s.connect(f); f.connect(g); g.connect(this.sfx);
    s.start(t); s.stop(t + dur + 0.45);
    this._zr = { s, g };   // handle so a skipped zoom can cut the rush short
  }
  stopZoomRush() {
    if (!this._zr || !this.ctx) return;
    const { s, g } = this._zr, t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(g.gain.value, 0.001), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    try { s.stop(t + 0.15); } catch (e) { /* already stopped */ }
    this._zr = null;
  }
  // one click per printed character — the original's briefing teletype chatter
  teletype() {
    if (!this.ctx) return;
    const c = this.ctx;
    if (!this._clickBuf) {   // cached 20 ms decaying tick, reused per char
      const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.02), c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (d.length * 0.16));
      this._clickBuf = buf;
    }
    const s = c.createBufferSource(); s.buffer = this._clickBuf;
    s.playbackRate.value = 0.85 + Math.random() * 0.4;          // printer-head pitch wander
    const f = c.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = 3000 + Math.random() * 900; f.Q.value = 1.1;
    const g = c.createGain(); g.gain.value = 0.17;
    s.connect(f); f.connect(g); g.connect(this.sfx); s.start();
  }
  kill() { this._tone(520, 0.12, 0.25, 'square'); setTimeout(() => this._tone(780, 0.18, 0.25, 'square'), 120); }
  fail() { this._tone(300, 0.5, 0.3, 'sawtooth', 90); }
  podDrop() { this._tone(500, 0.3, 0.2, 'sine', 200); }
}
