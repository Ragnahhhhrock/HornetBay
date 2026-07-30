/* anthem.js — The Star-Spangled Banner as an Amiga-flavoured chiptune loop.
   Plays in the background on every non-game page (homepage menu, blog, store,
   print bay, assets). Browsers gate audio behind a user gesture: the first
   click or key anywhere on the page wakes the band. A small player is pinned
   top-right with PLAY / PAUSE / STOP; STOP is remembered across visits.
   In-game, main.js calls HBAnthem.hide() + HBAnthem.stop() so the sim owns
   the soundscape; back at the menu, show() brings the player back.          */
(function () {
  'use strict';
  var N2S = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  function freq(n) {
    var m = /^([A-G][#b]?)(\d)$/.exec(n);
    return 440 * Math.pow(2, (N2S[m[1]] + (parseInt(m[2], 10) + 1) * 12 - 69) / 12);
  }
  var BPM = 88, SPB = 60 / BPM;
  // the first verse, [note, beats] — Francis Scott Key, 1814
  var MEL = [
    ['G4', .75], ['E4', .25], ['C4', 1], ['E4', 1], ['G4', 1], ['C5', 2],
    ['E5', 1.5], ['D5', .5], ['C5', 1], ['E4', .5], ['F#4', .5], ['G4', 2],
    ['G4', .75], ['G4', .25], ['E5', 1], ['D5', 1], ['C5', 1], ['B4', 2],
    ['A4', .75], ['B4', .25], ['C5', 1], ['C5', 1], ['G4', 1], ['E4', 1], ['C4', 1],
    ['E4', .75], ['G4', .25], ['C5', 1], ['E4', 1], ['G4', 1], ['C5', 2],
    ['E5', 1.5], ['D5', .5], ['C5', .5], ['E4', .25], ['F#4', .25], ['G4', 2.5],
    ['G4', .75], ['G4', .25], ['E5', 1], ['D5', 1], ['C5', 1], ['B4', 2],
    ['A4', .75], ['B4', .25], ['C5', 1], ['C5', .5], ['G4', .5], ['E4', 1], ['C4', 2],
    ['E5', .75], ['E5', .25], ['E5', 1], ['F5', 1], ['G5', 3],
    ['F5', .75], ['E5', .25], ['D5', 1], ['E5', .5], ['F5', .5], ['F5', 3],
    ['F5', .75], ['E5', .25], ['D5', 1], ['C5', 1], ['B4', 3],
    ['A4', .75], ['B4', .25], ['C5', 1], ['E4', 1], ['F#4', 1], ['G4', 2],
    ['G4', .75], ['C5', .25], ['C5', 1], ['C5', .5], ['B4', .5], ['A4', 1],
    ['A4', .5], ['D5', .5], ['F5', .5], ['E5', 1], ['D5', .5], ['E5', .25], ['C5', .25], ['B4', 1.5],
    ['G4', .75], ['G4', .25], ['C5', .5], ['D5', .5], ['E5', 1], ['F#5', 1], ['G5', 2],
    ['C5', 1], ['E5', 1], ['E5', .5], ['F5', .5], ['D5', 1], ['C5', 2]
  ];
  // oom-pah bass: one chord root per 3-beat measure
  var CHORDS = ['C', 'C', 'C', 'G', 'C', 'G', 'F', 'C', 'C', 'C', 'C', 'G', 'C', 'G', 'F', 'C',
                'C', 'G', 'F', 'F', 'F', 'G', 'C', 'D', 'C', 'F', 'G', 'C', 'D', 'C', 'C'];
  var ROOT = { C: 'C3', F: 'F2', G: 'G2', D: 'D3' };
  var REST = 3;                                  // beats of silence between loops
  var LOOP_B = 0, i;
  for (i = 0; i < MEL.length; i++) LOOP_B += MEL[i][1];

  // flatten to timed events: {t (beats), f, d (beats), bass}
  var EV = [];
  var tb = 0;
  for (i = 0; i < MEL.length; i++) {
    EV.push({ t: tb, f: freq(MEL[i][0]), d: MEL[i][1], bass: false });
    tb += MEL[i][1];
  }
  for (i = 0; i < CHORDS.length; i++) {
    var r = freq(ROOT[CHORDS[i]]);
    EV.push({ t: i * 3, f: r, d: 1.1, bass: true });
    EV.push({ t: i * 3 + 1, f: r * 1.4983, d: 0.9, bass: true });
    EV.push({ t: i * 3 + 2, f: r * 1.4983, d: 0.9, bass: true });
  }
  EV.sort(function (a, b) { return a.t - b.t; });

  var ctx = null, master = null, timer = null;
  var playing = false, paused = false, visible = true;
  var evIdx = 0, loopT0 = 0;
  var PREF = 'hb-anthem';
  function prefOn() { try { return localStorage.getItem(PREF) !== 'off'; } catch (e) { return true; } }
  function setPref(v) { try { localStorage.setItem(PREF, v); } catch (e) {} }

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function note(f, t, d, bass) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = bass ? 'triangle' : 'square';
    o.frequency.value = f;
    var peak = bass ? 0.05 : 0.15;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.014);
    g.gain.setValueAtTime(peak, t + Math.max(0.02, d - 0.07));
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + d + 0.02);
    if (!bass) {   // a hair of detuned chorus fattens the lead, Amiga-style
      var o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o2.type = 'square';
      o2.frequency.value = f * 1.004;
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.linearRampToValueAtTime(0.05, t + 0.014);
      g2.gain.setValueAtTime(0.05, t + Math.max(0.02, d - 0.07));
      g2.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o2.connect(g2); g2.connect(master);
      o2.start(t); o2.stop(t + d + 0.02);
    }
  }

  function tick() {
    if (!playing || paused || !ctx || ctx.state !== 'running') return;
    var ahead = ctx.currentTime + 0.35;
    for (;;) {
      var ev = EV[evIdx];
      var t = loopT0 + ev.t * SPB;
      if (t >= ahead) break;
      note(ev.f, t, ev.d * SPB * (ev.bass ? 0.95 : 0.9), ev.bass);
      evIdx++;
      if (evIdx >= EV.length) {
        evIdx = 0;
        loopT0 += (LOOP_B + REST) * SPB;
      }
    }
  }

  function startEngine() {
    if (!ensure()) return false;
    if (timer) clearInterval(timer);
    evIdx = 0;
    loopT0 = ctx.currentTime + 0.08;
    paused = false; playing = true;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
    timer = setInterval(tick, 100);
    syncUI();
    return true;
  }

  function silence() {
    if (timer) { clearInterval(timer); timer = null; }
    if (ctx && master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    playing = false; paused = false;
    syncUI();
  }

  // ---- the little player, pinned top-right ------------------------------
  var el = null, bPlay = null, bPause = null, bStop = null;
  function buildUI() {
    if (el || !document.body) return;
    el = document.createElement('div');
    el.id = 'hb-anthem';
    el.innerHTML =
      '<span class="hb-a-label">&#9834; ANTHEM</span>' +
      '<button type="button" data-a="play" aria-label="Play anthem">&#9654;</button>' +
      '<button type="button" data-a="pause" aria-label="Pause anthem">&#10073;&#10073;</button>' +
      '<button type="button" data-a="stop" aria-label="Stop anthem">&#9632;</button>';
    var st = document.createElement('style');
    st.textContent =
      '#hb-anthem{position:fixed;top:10px;right:10px;z-index:99999;display:flex;align-items:center;gap:6px;' +
      'background:rgba(8,18,40,.88);border:1px solid rgba(255,176,80,.55);padding:5px 8px;' +
      'font:600 11px/1 "Courier New",monospace;letter-spacing:.12em;color:#ffb050;user-select:none}' +
      '#hb-anthem .hb-a-label{margin-right:2px;text-shadow:0 0 6px rgba(255,176,80,.7)}' +
      '#hb-anthem button{background:#12264e;border:1px solid rgba(120,160,255,.4);color:#cfe0ff;' +
      'font:700 10px/1 "Courier New",monospace;padding:4px 7px;cursor:pointer;letter-spacing:.05em}' +
      '#hb-anthem button:hover{border-color:#ffb050;color:#ffb050}' +
      '#hb-anthem button.on{background:#ffb050;color:#0a1526;border-color:#ffb050}';
    document.head.appendChild(st);
    document.body.appendChild(el);
    var btns = el.querySelectorAll('button');
    bPlay = btns[0]; bPause = btns[1]; bStop = btns[2];
    bPlay.addEventListener('click', function () { HBAnthem.play(); });
    bPause.addEventListener('click', function () { HBAnthem.pause(); });
    bStop.addEventListener('click', function () { HBAnthem.stop(); });
    syncUI();
  }
  function syncUI() {
    if (!el) return;
    bPlay.classList.toggle('on', playing && !paused);
    bPause.classList.toggle('on', playing && paused);
    bStop.classList.toggle('on', !playing);
    el.style.display = visible ? 'flex' : 'none';
  }

  // first gesture anywhere wakes the band (browser autoplay rule)
  var armed = false;
  function armGesture() {
    if (armed) return;
    armed = true;
    var wake = function () {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      if (prefOn() && !playing) startEngine();
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
  }

  var HBAnthem = {
    play: function () { setPref('on'); if (!playing || paused) startEngine(); },
    pause: function () {
      if (!playing) return;
      if (paused) { paused = false; if (ctx) ctx.resume(); loopT0 = Math.max(loopT0, ctx.currentTime + 0.05); }
      else { paused = true; if (ctx) ctx.suspend(); }
      syncUI();
    },
    stop: function () { setPref('off'); silence(); },
    mute: function () { silence(); },          // in-game: quiet now, but the preference stands
    show: function () {
      visible = true; syncUI();
      if (prefOn() && !playing) startEngine();   // back at the menu the band strikes up again
    },
    hide: function () { visible = false; syncUI(); },
    get playing() { return playing && !paused; },
    _debug: function () { return { playing: playing, paused: paused, evIdx: evIdx, ctx: ctx ? ctx.state : 'none', pref: prefOn() }; }
  };
  window.HBAnthem = HBAnthem;

  function boot() {
    buildUI();
    if (prefOn()) {
      // try to start cold; if the browser still blocks, the first gesture takes it
      if (startEngine() && ctx.state !== 'running') { silence(); playing = false; armGesture(); syncUI(); }
      else if (!ctx) armGesture();
    } else syncUI();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
