// audio.js — engine/SFX built around samples captured from the original Amiga
// game (eng_idle/eng_mil loops, gear servo, missile whoosh, explosion boom).
// No music in the cockpit — the anthem lives on the site pages and the menu
// (js/anthem.js); the sim keeps the soundscape to itself. Warning tones are
// synthesized to match.
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
    const files = ['eng_idle', 'eng_mil', 'gear', 'whoosh', 'boom', 'gatling', 'sweep', 'voice_gun', 'voice_sidewinder', 'voice_amraam', 'voice_phoenix', 'voice_sparrow', 'voice_mk83'];
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
    // voices built before the decode finished lack the recorded jet pair —
    // fade whatever is live and let specTick rebuild with full buffers
    if (this._spec) {
      const t = this.ctx.currentTime;
      for (const k of Object.keys(this._spec.v)) this._spec.v[k].out.gain.setTargetAtTime(0, t, 0.1);
      this._spec = null;
    }
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
  // storm thunder: a crack that decays into a low rumble, delayed by distance
  // (343 m/s) — the lightning strike reports how far away it landed
  thunder(dist = 1500) {
    if (!this.ctx) return;
    const vol = Math.min(0.85, Math.max(0.12, 1400 / (dist + 400)));
    setTimeout(() => {
      this._noiseHit(0.16, vol * 0.8, 1600, 0.5, 260);          // crack
      this._noiseHit(2.4, vol, 210, 0.8, 55);                   // rumble
    }, (dist / 343) * 1000);
  }
  gun() {
    // when the gatling loop is running the burst sample does all the talking
    if (this._gatling && this._gatling !== 'synth') return;
    this._noiseHit(0.07, 0.5, 2600, 0.7, 500);
  }
  gunHit() { this._noiseHit(0.06, 0.25, 4000, 1, 1200); }
  // the M61 Vulcan: an A-10-style sustained BRRRT loop for as long as the
  // trigger is held — call every frame with the trigger state
  setGatling(on) {
    if (!this.ctx) { if (on) this.ensure(); else return; }
    if (on && !this._gatling) {
      if (this.buf.gatling) {
        const c = this.ctx, s = c.createBufferSource(), g = c.createGain();
        s.buffer = this.buf.gatling; s.loop = true;
        g.gain.value = 0.95;
        s.connect(g); g.connect(this.sfx); s.start();
        this._gatling = { s, g };
      } else this._gatling = 'synth';   // sample missing — per-shot pops carry on
    } else if (!on && this._gatling) {
      if (this._gatling !== 'synth') {
        const { s, g } = this._gatling;
        g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        s.stop(this.ctx.currentTime + 0.2);
      }
      this._gatling = null;
    }
  }
  // spoken weapon callout on ENTER — the stores panel talks back:
  // GUNS / SIDEWINDER / AMRAAM / PHOENIX / SPARROW / MK 83. The 1988 beep
  // stays as the fallback while samples stream in (or if one is missing).
  weaponSelect(w) {
    const n = { gun: 'voice_gun', aim9: 'voice_sidewinder', aim120: 'voice_amraam', aim54: 'voice_phoenix', aim7: 'voice_sparrow', mk83: 'voice_mk83' }[w];
    if (n && this.buf[n]) this._play(n, 1.0);
    else { this._tone(990, 0.07, 0.22, 'square'); this._tone(1980, 0.045, 0.08, 'square'); }
  }
  // receiver squelch around a radio call: key-up tick, two static pops
  radioCrackle() {
    this._noiseHit(0.03, 0.20, 4200, 2.5);
    setTimeout(() => this._noiseHit(0.05, 0.13, 2600, 2), 50);
    setTimeout(() => this._noiseHit(0.035, 0.09, 3400, 2), 115);
  }
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
  // something heavy hits the sea: the white-noise column of the splash
  // collapsing, over a low whoomph — torpedoes, buoys, ditched airframes
  splash(vol = 1) {
    this._noiseHit(0.65, 0.5 * vol, 1100, 0.7, 160);
    this._tone(110, 0.35, 0.22 * vol, 'sine', 45);
  }
  gear() { this._play('gear', 0.8); }
  // the Tomcat's swing wing: hydraulics and steel tracks as the gloves move
  wingSweep() { this._play('sweep', 0.9); }
  hook() { this._tone(160, 0.25, 0.25, 'square', 80); }
  trap() { this._noiseHit(0.7, 0.6, 800, 0.8, 100); this._tone(120, 0.5, 0.4, 'sawtooth', 45); }
  radioClick() { this._noiseHit(0.04, 0.18, 3500, 3); }
  // console-style pause chirp: falling two notes = held, rising = released.
  // HOLD actually silences the sim: the whole audio graph suspends once the
  // chirp has played out, so engines, lock tones, gatling, rain — everything —
  // stops while paused. RELEASE resumes the context before its chirp.
  pause(on = true) {
    if (!this.ctx) return;
    clearTimeout(this._pauseSuspendT);   // a quick unpause beats the pending suspend
    if (on) {
      this._tone(620, 0.08, 0.2, 'square');
      setTimeout(() => this._tone(410, 0.14, 0.2, 'square'), 85);
      this._pauseSuspendT = setTimeout(() => { if (this.ctx.state === 'running') this.ctx.suspend(); }, 260);
    } else {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this._tone(410, 0.08, 0.2, 'square');
      setTimeout(() => this._tone(620, 0.14, 0.2, 'square'), 85);
    }
  }
  // C-13 steam catapult: a rising white-steam roar for the length of the stroke
  catapult() { this._noiseHit(1.7, 0.55, 1400, 0.5, 220); }
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
  // ---------- spectate voice: the engine of the aircraft the camera rides ----------
  // three voices crossfaded by type: jets reuse the recorded Amiga loops,
  // airliners get a synthesized turbofan whine, prop planes (E-2/C-2/P-3,
  // and the helicopters' rotor whirr) get a blade-pass whirr
  _buildSpec() {
    const c = this.ctx, sp = this._spec = { kind: undefined, v: {} };
    const voice = () => { const out = c.createGain(); out.gain.value = 0; out.connect(this.sfx); return out; };
    // jets: a second crossfade pair off the recorded idle/mil loops
    if (this.buf.eng_idle && this.buf.eng_mil) {
      const out = voice();
      const mk = (b) => {
        const s = c.createBufferSource(); s.buffer = b; s.loop = true;
        const g = c.createGain(); g.gain.value = 0;
        s.connect(g); g.connect(out); s.start();
        return { s, g };
      };
      const a = mk(this.buf.eng_idle), b = mk(this.buf.eng_mil);
      sp.v.jet = { out, set: (r, t) => {
        const rr = clamp(r, 0, 1);
        a.g.gain.setTargetAtTime(0.30 * (1 - rr), t, 0.15);
        b.g.gain.setTargetAtTime(0.10 + 0.28 * rr, t, 0.15);
        const rate = 0.92 + rr * 0.24;
        a.s.playbackRate.setTargetAtTime(rate, t, 0.15);
        b.s.playbackRate.setTargetAtTime(rate, t, 0.15);
      } };
    }
    // airliners: turbofan whine — two detuned high sines over compressor hiss
    {
      const out = voice();
      const n = c.createBufferSource(); n.buffer = this._noiseBuffer(2); n.loop = true;
      const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 950; nf.Q.value = 1.2;
      const ng = c.createGain(); ng.gain.value = 0;
      n.connect(nf); nf.connect(ng); ng.connect(out); n.start();
      const mk = (f) => {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g = c.createGain(); g.gain.value = 0;
        o.connect(g); g.connect(out); o.start();
        return { o, g };
      };
      const w1 = mk(2350), w2 = mk(3120);
      sp.v.turbofan = { out, set: (r, t) => {
        const rr = clamp(r, 0, 1);
        ng.gain.setTargetAtTime(0.05 + 0.10 * rr, t, 0.2);
        nf.frequency.setTargetAtTime(700 + 900 * rr, t, 0.2);
        w1.o.frequency.setTargetAtTime(1900 + 900 * rr, t, 0.25);
        w2.o.frequency.setTargetAtTime(2500 + 1200 * rr, t, 0.25);
        w1.g.gain.setTargetAtTime(0.016 + 0.030 * rr, t, 0.2);
        w2.g.gain.setTargetAtTime(0.012 + 0.024 * rr, t, 0.2);
      } };
    }
    // props: blade-pass whirr — beating low twins (two engines) + first
    // harmonic over low-passed noise
    {
      const out = voice();
      const n = c.createBufferSource(); n.buffer = this._noiseBuffer(2); n.loop = true;
      const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 620; nf.Q.value = 0.7;
      const ng = c.createGain(); ng.gain.value = 0;
      n.connect(nf); nf.connect(ng); ng.connect(out); n.start();
      const mk = (type, f) => {
        const o = c.createOscillator(); o.type = type; o.frequency.value = f;
        const g = c.createGain(); g.gain.value = 0;
        o.connect(g); g.connect(out); o.start();
        return { o, g };
      };
      const p1 = mk('sawtooth', 76), p2 = mk('sawtooth', 78.5), p3 = mk('square', 154);
      sp.v.prop = { out, set: (r, t) => {
        const rr = clamp(r, 0, 1);
        ng.gain.setTargetAtTime(0.05 + 0.08 * rr, t, 0.2);
        const bf = 62 + 26 * rr;   // blade-pass frequency follows speed
        p1.o.frequency.setTargetAtTime(bf, t, 0.25);
        p2.o.frequency.setTargetAtTime(bf * 1.03, t, 0.25);   // twin-engine beat
        p3.o.frequency.setTargetAtTime(bf * 2.02, t, 0.25);
        p1.g.gain.setTargetAtTime(0.030 + 0.040 * rr, t, 0.2);
        p2.g.gain.setTargetAtTime(0.024 + 0.034 * rr, t, 0.2);
        p3.g.gain.setTargetAtTime(0.010 + 0.016 * rr, t, 0.2);
      } };
    }
  }
  // call every frame: kind = 'jet' | 'turbofan' | 'prop' | null (not spectating)
  specTick(kind, rpm = 0.6) {
    if (!this.ctx) return;
    if (!this._spec) this._buildSpec();
    const sp = this._spec, t = this.ctx.currentTime;
    if (sp.kind !== kind) {
      sp.kind = kind;
      for (const k of Object.keys(sp.v)) sp.v[k].out.gain.setTargetAtTime(k === kind ? 1 : 0, t, 0.25);
    }
    if (kind && sp.v[kind]) sp.v[kind].set(rpm, t);
  }

  kill() { this._tone(520, 0.12, 0.25, 'square'); setTimeout(() => this._tone(780, 0.18, 0.25, 'square'), 120); }
  fail() { this._tone(300, 0.5, 0.3, 'sawtooth', 90); }
  podDrop() { this._tone(500, 0.3, 0.2, 'sine', 200); }
}
