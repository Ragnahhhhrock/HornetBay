/* anthem.js — The Hornet Bay Anthem, the full studio recording, looping
   seamlessly (the file is trimmed to the music — no silence at the seam — and
   looped sample-accurate through WebAudio, so the last bar falls straight back
   into the first).
   Plays in the background on every non-game page (homepage menu, blog, store,
   print bay, assets). Browsers gate audio behind a user gesture: the first
   click or key anywhere on the page wakes the band. A small player is pinned
   top-right with PLAY / PAUSE / STOP; STOP is remembered across visits.
   In-game, main.js calls HBAnthem.hide() + HBAnthem.stop() so the sim owns
   the soundscape; back at the menu, show() brings the player back.          */
(function () {
  'use strict';
  var SRC = '/audio/hornet-bay-anthem.mp3';

  var ctx = null, master = null;
  var buf = null, bufP = null;              // decoded audio + its load promise
  var src = null;                           // the live BufferSource (one-shot)
  var playing = false, paused = false, visible = true, wantPlay = false;
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

  function load() {
    if (bufP) return bufP;
    bufP = fetch(SRC)
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return ctx.decodeAudioData(ab); })
      .then(function (b) {
        buf = b;
        if (wantPlay && !playing) startEngine();   // arrived after the gesture
        return b;
      })
      .catch(function () { bufP = null; });        // let a later play() retry
    return bufP;
  }

  function startEngine() {
    if (!ensure()) return false;
    wantPlay = true;
    if (!buf) { load(); syncUI(); return true; }   // first fetch: start when ready
    if (src) { try { src.stop(); } catch (e) {} }
    src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;                               // sample-accurate, no gap at the seam
    src.connect(master);
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
    src.start();
    paused = false; playing = true;
    syncUI();
    return true;
  }

  function silence() {
    wantPlay = false;
    if (src) { try { src.stop(); } catch (e) {} src = null; }
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
      if (paused) { paused = false; if (ctx) ctx.resume(); }
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
    _debug: function () { return { playing: playing, paused: paused, loaded: !!buf, dur: buf ? buf.duration : 0, ctx: ctx ? ctx.state : 'none', pref: prefOn() }; }
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
