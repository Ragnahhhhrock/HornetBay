// main.js — boot, game state machine, loop, cameras, targeting, menus
import * as THREE from 'three';
import { clamp, lerp, damp, KTS, FT, NM, wrapAngle, flightQuat, rand } from './util.js';
import { World, groundHeight } from './world.js';
import { Player, PLANES, Chute } from './flight.js';
import { AirWing } from './airwing.js';
import { AIAircraft } from './ai.js';
import { FXPool, Missile, GunSystem, Bomb } from './weapons.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { setupTouch } from './touch.js';
import { AudioEngine } from './audio.js';
import { MISSIONS, DIFFICULTY, MISSION_TAGS, MISSION_HOOKS, SCHOOL_ORDER } from './missions.js';
import { Intro, FF_SPOTS } from './intro.js';
import { MapView } from './mapview.js';
import { HeliOps } from './rotors.js';
import { P3Patrol } from './patrol.js';
import { AswOps, EscortWeapons } from './asw.js';
import { Awacs } from './awacs.js';
import { Wingman, ORDERS } from './wingman.js';
import { buildModel } from './models.js';
import { DemoDirector } from './attract.js';
import { Traffic } from './traffic.js';
import { stats } from './stats.js';

const $ = (id) => document.getElementById(id);

// ---- guard-band safety: clamp off-screen clip coordinates ----------------
// In low grazing views the ground cells that straddle the camera's w=0 plane
// are clipped into triangles hundreds of viewports wide; some rasterizers
// (incl. software WebGL) overflow their guard band on them, smearing terrain
// and sea across the sky and punching holes beside the runways. Clamping every
// projected vertex to ±4 viewports keeps rasterizer coordinates sane; the
// frustum clip still produces the identical on-screen image.
if (!new URLSearchParams(location.search).has('nogb'))
THREE.ShaderChunk.project_vertex = `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
{
	float _gb = abs( gl_Position.w ) * 64.0 + 1e-4;
	gl_Position.xy = clamp( gl_Position.xy, -vec2( _gb ), vec2( _gb ) );
}`;

// ---------------- error overlay (helps debugging) ----------------
window.addEventListener('error', (e) => { $('errbox').textContent += `\n${e.message}`; });

// ---------------- renderer ----------------
// logarithmic depth buffer: kills ocean/terrain z-fighting at map altitude and
// giant-triangle depth artifacts near the camera (standard depth can't span 1.5m..320km)
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: false, logarithmicDepthBuffer: !new URLSearchParams(location.search).has('nologz') });
// Amiga-authentic chunky pixels: render small, upscale with nearest-neighbor
const RETRO_SCALE = 0.36;
renderer.setPixelRatio(1);
renderer.setSize(Math.floor(window.innerWidth * RETRO_SCALE), Math.floor(window.innerHeight * RETRO_SCALE), false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1.5, 320000);
// showroom squadron pinned to the camera — a slow turntable on the home menu,
// cycling through the flyable roster so the homepage shows off the whole air wing
scene.add(camera);
const HERO_TYPES = ['f18', 'f14', 'f16', 'f15', 'a10', 'su27', 'mig29'];
const heroes = HERO_TYPES.map((tp, i) => {
  const m = buildModel(tp);
  m.scale.setScalar(0.28);
  m.position.set(2.25, -0.15, -6);
  m.rotation.order = 'YXZ';
  m.rotation.x = 0.16;
  if (m.userData.gear) m.userData.gear.visible = false;   // clean in-flight look
  m.visible = i === 0;
  camera.add(m);
  return m;
});
let hero = heroes[0];
// soft showroom spot so the star stays lit after dark (short range: only the hero)
const heroLight = new THREE.PointLight(0xcfe0ff, 0, 16, 1.6);
heroLight.position.set(3.5, 2.5, -3);
camera.add(heroLight);
// Resize is debounced and rotation-safe: iOS fires a storm of resize events
// mid-rotation with stale geometry, and re-allocating the GL canvas on every
// one has repeatedly crashed WebKit builds (GPU process kills the page).
// Wait for the geometry to settle, skip degenerate sizes, resize once.
let resizeT = 0;
function applyResize() {
  // sideways mode (rotation-lock workaround): the body is laid out swapped
  // and spun 90 degrees, so the game gets landscape dims in a portrait viewport
  const fake = document.documentElement.classList.contains('fakeland') ||
               document.documentElement.classList.contains('fakeland-ccw');
  const w = fake ? window.innerHeight : window.innerWidth;
  const h = fake ? window.innerWidth : window.innerHeight;
  if (!w || !h) return;                        // degenerate mid-rotation geometry
  renderer.setSize(Math.floor(w * RETRO_SCALE), Math.floor(h * RETRO_SCALE), false);
  camera.aspect = clamp(w / h, 0.2, 5);        // never feed Infinity/NaN to the frustum
  camera.updateProjectionMatrix();
  hud.resize(w, h);
}
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(applyResize, 180);
});
window.addEventListener('orientationchange', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(applyResize, 450);      // iOS final geometry lands late
});

// GL context loss: iOS can take the GPU away on rotation or backgrounding.
// Without a handler the canvas just dies and the page looks crashed. Ask the
// browser to restore; if it doesn't within a few seconds, reload cleanly.
const glLostBox = $('gllost');
let ctxLostT = 0;
$('gl').addEventListener('webglcontextlost', (e) => {
  e.preventDefault();                          // opt in to context restore
  if (glLostBox) glLostBox.classList.remove('hidden');
  clearTimeout(ctxLostT);
  ctxLostT = setTimeout(() => location.reload(), 4000);
});
$('gl').addEventListener('webglcontextrestored', () => {
  clearTimeout(ctxLostT);
  if (glLostBox) glLostBox.classList.add('hidden');
});

// screen wake lock: a display dozing off mid-final is a crash (iOS 16.4+)
let wakeLockRef = null;
async function wakeLockTry() {
  try {
    if (navigator.wakeLock && !wakeLockRef) wakeLockRef = await navigator.wakeLock.request('screen');
    if (wakeLockRef) wakeLockRef.addEventListener('release', () => { wakeLockRef = null; });
  } catch (e) { /* unsupported or denied — cosmetic */ }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && G.state === 'flying') wakeLockTry();
});

// ---------------- game context ----------------
const G = {
  scene, camera, renderer,
  state: 'menu',            // menu | briefing | flying | dead | debrief | paused
  time: 0, score: 0, kills: 0, gunHits: 0, shotsFired: 0,
  player: null, world: null, fx: null, hud: null, audio: null, input: null,
  bandits: [], missiles: [], radarContacts: [], messages: [],
  playerTarget: null, lockLevel: 0, locked: false,
  waypoint: null, radarRange: 40 * NM, radarRangeNM: 40,   // original powers up on the 40 MI scope
  mission: null, over: false, view: 'cockpit',
  trappedThisSortie: false, landedThisSortie: false,
  missileWarning: false, podDropRequested: false,
  freeFlightStart: 'carrier',
  orbit: { yaw: 0, pitch: 0.25, dist: 55, manual: false },
  shakeT: 0, smokeTrail: false,
  xmag: 1.0, towerName: '',
  timeScale: 1,           // Z cycles 1/2/4/8/16 (SHIFT+Z back down) — the whole simulation runs faster
  msg(text, kind = 'info') {
    this.messages.unshift({ text, kind, t: this.time });
    if (this.messages.length > 6) this.messages.pop();
    // every flashed notification keys the net: a squelch crackle stands in
    // for the chatter — the call comes over the radio even when it's text
    if (this.audio) this.audio.radioCrackle();
  },
  radio(text) { this.msg(text, 'radio'); },
  // ambient world chatter — airline movements, patrol work, the ASW hunt,
  // carrier cyclic ops, AWACS small talk — stays off the net. The cockpit
  // only hears what concerns the mission or the player. Ambient systems
  // still call this so the policy lives in one place; it drops the call.
  chatter(text, kind = 'info') { /* the net stays quiet */ },
  addScore(n) { this.score += n; },
};
window.G = G; // debug hook
G.applyResize = applyResize;   // touch.js flips sideways mode, then re-lays out

G.audio = new AudioEngine();
// browsers gate audio behind a gesture: the first touch or key anywhere
// wakes the context so the menu reel's engines/guns play without a menu click
for (const ev of ['pointerdown', 'keydown']) {
  window.addEventListener(ev, function wake() {
    G.audio.ensure();
    window.removeEventListener(ev, wake);
  }, { passive: true });
}
G.input = new Input();
G.touch = setupTouch(G);   // mobile: thumb stick + button deck (no-op on desktop)
G.intro = new Intro(G);
const hud = new HUD($('hud'));
G.hud = hud;
G.mapview = new MapView();   // N toggles the live tactical map

// world is heavy — build lazily on first load but before menu demo
G.world = new World(scene);
G.world.G = G;   // the deck crew reads the game through the world
G.fx = new FXPool(scene);
G.player = new Player(scene, G.world);
G.player.isPlayer = true;
const gun = new GunSystem(G);

// ---------------- persistence ----------------
const SAVE_KEY = 'hornet-bay-v1';
let save = { qualified: false, done: {}, best: 0, kills: 0 };
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) {}
function persist() { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
G.save = save;                                  // intro screens read unlock flags (e.g. the Tomcat)
// day/night and weather are straight switches now — no MISSION DEFAULT stop.
// Untouched, a mission keeps its authored time (e.g. the night Bear intercept);
// the moment the pilot toggles, the choice becomes an explicit override.
G.dayNightSel = save.dayNight === 'night' ? 'night' : 'day';   // T toggles DAY/NIGHT
G.weatherSel = ['clouds', 'rain', 'storm'].includes(save.weather) ? save.weather : 'clear';   // R cycles CLEAR/CLOUDS/RAIN/STORM
// migrate pre-switch saves: an old day/night pick was already an override
if (save.dayNightForced == null) save.dayNightForced = (save.dayNight === 'day' || save.dayNight === 'night');

// ---------------- menu (original 1-8 structure) ----------------
const MISSION_ORDER = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14', 'm15', 'm16', 'm17', 'm18', 'm19'];
let menuMode = 'main';
// every menu screen carries a URL stub (#missions, #m1 …) so any
// item is a shareable link. setHash stays silent until the boot router has
// read the incoming hash — otherwise showMenu() would clobber the link you
// arrived on before routeHash() gets to see it
let hashRouting = false;
function setHash(h) {
  if (!hashRouting) return;
  const url = h ? '#' + h : location.pathname + location.search;
  if (location.hash !== '#' + h) history.replaceState(null, '', url);
}
// difficulty is a number out of 100, banded green to red like the old badges
const diffBadge = (id) => {
  const n = DIFFICULTY[id] ?? 50;
  const band = n < 35 ? 'easy' : n < 55 ? 'medium' : n < 75 ? 'hard' : 'expert';
  return `<span class="diff d-${band}">${n}/100</span>`;
};
// the campaign is for graduates — every school sortie passed, in order
const schoolGrad = () => SCHOOL_ORDER.every(id => save.done[id]);
function buildMenu(mode = 'main') {
  menuMode = mode;
  setHash(mode === 'missions' ? 'missions' : mode === 'log' ? 'log' : 'menu');
  const list = $('menu-list');
  list.innerHTML = '';
  const addBtn = (num, label, tag, cb) => {
    const b = document.createElement('button');
    b.className = 'mbtn';
    // every row wears its key: what you see is what you press, on every menu
    const showKey = num && num !== 'ESC';
    b.innerHTML = `${showKey ? `<span class="mnum">${num}</span>` : ''}${label}${tag ? `<span class="tag">${tag}</span>` : ''}`;
    b.dataset.key = num || '';
    if (cb) b.onclick = () => { G.audio.ensure(); cb(); };
    else b.classList.add('locked');
    list.appendChild(b);
  };
  // every sortie on the school/mission boards wears a portrait of its objective
  const mthumb = (id) => `<img class="mthumb" src="/shots/thumbs/${id}.jpg" alt="" loading="lazy">`;
  // every sub-menu: RETURN TO MAIN MENU pinned to the top of the list
  const addTopReturn = () => {
    addBtn('ESC', 'RETURN TO MAIN MENU', '', () => buildMenu('main'));
    list.lastChild.classList.add('mtop');
  };
  if (mode === 'missions') {
    $('menu-title').textContent = 'SELECTABLE MISSIONS';
    addTopReturn();
    // the fleet does not send students to war: the campaign board stays
    // locked until every flight school sortie is in the logbook
    const grad = schoolGrad();
    const allAccess = !!save.allAccess;
    if (allAccess) {
      const d = document.createElement('div');
      d.className = 'msub';
      d.textContent = 'ALL ACCESS GRANTED — EVERY SORTIE ON THE BOARD';
      list.appendChild(d);
    } else if (!grad) {
      const d = document.createElement('div');
      d.className = 'msub';
      d.textContent = 'GRADUATE FLIGHT SCHOOL TO UNLOCK THE CAMPAIGN';
      list.appendChild(d);
    }
    MISSION_ORDER.forEach((id, i) => {
      const def = MISSIONS.find(m => m.id === id);
      // campaign progression: school first, then each mission flown unlocks the
      // next — the all-access code signs the whole board off at once
      const locked = !allAccess && (!grad || (i > 0 && !save.done[MISSION_ORDER[i - 1]]));
      // every sortie carries its difficulty rating on the board, plus
      // type/maneuver chips — carrier launch, intercept, visual ID, and so on
      const diff = diffBadge(id);
      const chips = `<span class="chips">${(MISSION_TAGS[id] || []).map(t => `<span class="chip">${t}</span>`).join('')}</span>`;
      const hook = `<span class="hook">${MISSION_HOOKS[id] || ''}</span>`;
      // keys every keyboard actually has: 1-9, 0, then A-F for the back six —
      // F1-F12 stay bound as silent aliases for pilots who learned the board
      const key = '1234567890ABCDEF'[i];
      if (locked) addBtn(key, mthumb(id) + def.title + diff + chips + hook, 'LOCKED', null);
      else addBtn(key, mthumb(id) + def.title + diff + chips + hook, save.done[id] ? 'COMPLETE' : '', () => startBriefing(id));
      if (i < 12) list.lastChild.dataset.fkey = `F${i + 1}`;
    });
    addBtn('U', 'ENTER UNLOCK CODE', save.allAccess ? 'ALL ACCESS ACTIVE' : 'SKIP THE SYLLABUS', openAllAccessUnlock);
    addBtn('ESC', 'RETURN TO MAIN MENU', '', () => buildMenu('main'));
    return;
  }
  // flight school — the training program, three courses of two sorties each;
  // open to every pilot from the first day, no campaign progress required
  if (mode === 'school') {
    $('menu-title').textContent = 'FLIGHT SCHOOL';
    // a way back to the barn right at the top of the syllabus, before the courses
    addTopReturn();
    const addHead = (text, sub) => {
      const d = document.createElement('div');
      d.className = sub ? 'msub' : 'mhead';
      d.textContent = text;
      $('menu-list').appendChild(d);
    };
    addHead('EARN YOUR WINGS — COMPLETE EACH SORTIE TO UNLOCK THE NEXT', true);
    const row = (key, id) => {
      const def = MISSIONS.find(m => m.id === id);
      // progressive syllabus: each sortie passed chalks the lock off the next
      const i = SCHOOL_ORDER.indexOf(id);
      const locked = !save.allAccess && i > 0 && !save.done[SCHOOL_ORDER[i - 1]];
      const diff = diffBadge(id);
      const chips = `<span class="chips">${(MISSION_TAGS[id] || []).map(t => `<span class="chip">${t}</span>`).join('')}</span>`;
      const hook = `<span class="hook">${MISSION_HOOKS[id] || ''}</span>`;
      if (locked) addBtn(key, mthumb(id) + def.title + diff + chips + hook, 'LOCKED', null);
      else addBtn(key, mthumb(id) + def.title + diff + chips + hook, save.done[id] ? 'COMPLETE' : '', () => startBriefing(id));
    };
    addHead('BASIC FLIGHT MANEUVERS');
    row('1', 't1'); row('2', 't2');
    addHead('ADVANCED FLIGHT MANEUVERS');
    row('3', 't3'); row('4', 't4'); row('5', 't7');
    addHead('AERIAL COMBAT');
    row('6', 't5'); row('7', 't6');
    addHead('STRIKE WEAPONS');
    row('8', 't8');
    addBtn('ESC', 'RETURN TO MAIN MENU', '', () => buildMenu('main'));
    return;
  }
  if (mode === 'log') {
    $('menu-title').textContent = 'YOUR CURRENT FLIGHT LOG STATISTICS';
    addTopReturn();
    const done = MISSION_ORDER.filter(id => save.done[id]).length;
    for (const ln of [
      `CALLSIGN ......... ${save.callsign || 'ROOKIE'}`,
      `QUALIFIED ........ ${save.qualified ? 'YES' : 'NO'}`,
      `MISSIONS DONE .... ${done} OF ${MISSION_ORDER.length}`,
      `KILLS ............ ${save.kills}`,
      `BEST SCORE ....... ${save.best}`,
      `CARRIER TRAPS .... ${save.traps || 0}`,
    ]) {
      const d = document.createElement('div'); d.className = 'logline'; d.textContent = ln; list.appendChild(d);
    }
    addBtn('C', 'CHANGE CALLSIGN', '', () => {
      const n = prompt('ENTER YOUR CALLSIGN:', save.callsign || 'ROOKIE');
      if (n) { save.callsign = n.toUpperCase().slice(0, 12); persist(); buildMenu('log'); }
    });
    addBtn('ESC', 'RETURN TO MAIN MENU', '', () => buildMenu('main'));
    return;
  }
  $('menu-title').textContent = '';   // main mode: the logo block above says it
  if (G._menuResume) addBtn('Q', 'RESUME FLIGHT', 'BACK IN THE COCKPIT', () => resumeFlight());
  // bailed out of a brief with ESC: one button (or M) returns to that mission's brief
  if (G._backToMission && !G._menuResume) {
    const bdef = MISSIONS.find(m => m.id === G._backToMission);
    if (bdef) addBtn('M', 'BACK TO MISSION', bdef.title, () => startBriefing(bdef.id));
  }
  // the career shows up on the front door: new pilots get steered to T-1,
  // students see the school hole, graduates see the campaign tally
  const schoolDone = SCHOOL_ORDER.filter(id => save.done[id]).length;
  addBtn('1', 'FLIGHT SCHOOL', !save.qualified ? 'NEW PILOTS START HERE' :
    (schoolGrad() ? 'GRADUATED — WINGS EARNED' : `${schoolDone} OF ${SCHOOL_ORDER.length} SORTIES IN THE LOGBOOK`), () => buildMenu('school'));
  addBtn('2', 'FREE FLIGHT, NO ENEMY CONFRONTATION', '', () => startFreeFlightMap());
  addBtn('3', 'MISSIONS', (schoolGrad() || save.allAccess) ? (save.allAccess && !schoolGrad() ? 'ALL ACCESS' :
    `${MISSION_ORDER.filter(id => save.done[id]).length} OF ${MISSION_ORDER.length} DOWN`) : 'GRADUATE FLIGHT SCHOOL FIRST', () => buildMenu('missions'));
  addBtn('4', 'YOUR CURRENT FLIGHT LOG STATISTICS', '', () => buildMenu('log'));
  addBtn('B', 'BLOG', '↗', () => window.open('/blog', '_blank'));
  addBtn('S', 'HORNET BAY STORE', '↗', () => window.open('/store', '_blank'));
  addBtn('P', '3D PRINT BAY', '↗', () => window.open('/print', '_blank'));
  addBtn('T', 'TOGGLE DAY or NIGHT FLIGHT', `NOW: ${{ day: 'DAY', night: 'NIGHT' }[G.dayNightSel]}`, () => cycleMenuDayNight());
  addBtn('R', 'TOGGLE WEATHER', `NOW: ${{ clear: 'CLEAR', clouds: 'CLOUDS', rain: 'RAIN', storm: 'STORM' }[G.weatherSel]}`, () => cycleMenuWeather());
  addBtn('H', 'FLIGHT MANUAL / CONTROLS', '', () => { G.openManual(); });
  $('pilot-record').textContent =
    `PILOT LOG — ${save.callsign || 'ROOKIE'} · MISSIONS FLOWN: ${Object.keys(save.done).length} · KILLS: ${save.kills} · BEST SCORE: ${save.best}`;
}
// number keys drive the menu like the original (plus T for the time-of-day row)
window.addEventListener('keydown', (e) => {
  if (G.state !== 'menu') return;
  if (allAccessOverlayOpen()) return;
  if (e.code === 'Escape' && menuMode !== 'main') { buildMenu('main'); return; }
  const km = e.code.match(/^Key([A-Z])$/);
  const d = e.code.startsWith('Digit') ? e.code.slice(5) : /^F\d{1,2}$/.test(e.code) ? e.code : km ? km[1] : null;
  if (!d) return;
  const btn = [...document.querySelectorAll('#menu-list .mbtn')].find(b => b.dataset.key === d || b.dataset.fkey === d);
  // swallow the keypress whole: the button click may change G.state (menu ->
  // mapselect), and the intro router further down the listener list would
  // otherwise see the SAME event as a start-point pick
  if (btn && btn.onclick) { e.stopImmediatePropagation(); G.audio.ensure(); btn.onclick(); }
});

// T on the main menu: switch DAY/NIGHT — the change is applied to the
// demo scenery behind the menu immediately and saved as an explicit override
function cycleMenuDayNight() {
  G.dayNightSel = G.dayNightSel === 'day' ? 'night' : 'day';
  save.dayNight = G.dayNightSel;
  save.dayNightForced = true;
  persist();
  G.audio.radioClick();
  applyMenuTimeOfDay();
  buildMenu();   // refresh the row label
}
function applyMenuTimeOfDay() {
  G.world.setTimeOfDay(G.dayNightSel);
}
// R on the main menu: cycle CLEAR/CLOUDS/RAIN/STORM — the menu
// backdrop gets the weather immediately and the choice is saved
const WX_CYCLE = { clear: 'clouds', clouds: 'rain', rain: 'storm', storm: 'clear' };
function cycleMenuWeather() {
  G.weatherSel = WX_CYCLE[G.weatherSel] || 'clear';
  save.weather = G.weatherSel;
  persist();
  G.audio.radioClick();
  applyMenuWeather();
  buildMenu();   // refresh the row label
}
function applyMenuWeather() {
  G.world.setWeather(G.weatherSel);
}

// mobile pilots get the centre-screen notice; CONTINUE ANYWAY lets them peek at the menu
let _mwWired = false;
function mobileWarnCheck() {
  if (_mwWired) return;
  _mwWired = true;
  if (document.documentElement.classList.contains('touch')) $('mobile-warn').classList.remove('hidden');
  $('mw-dismiss').onclick = () => $('mobile-warn').classList.add('hidden');
}

function showMenu() {
  G.state = 'menu';
  mobileWarnCheck();
  if (window.HBAnthem) window.HBAnthem.show();   // the anthem belongs to the menu and the site, not the cockpit
  if (G.chute) { G.chute.dispose(); G.chute = null; }
  G.audio.endChute();
  $('menu').classList.remove('hidden');
  $('briefing').classList.add('hidden');
  $('debrief').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('obj-card').classList.add('hidden');
  buildMenu();
  startDemo();
  // NOTE: no applyMenuTimeOfDay() here — the DemoDirector's scenes set their
  // own time of day per shot (night cat launch, dusk trap, day furball...)
  applyMenuWeather();     // ...and the selected weather
}

// ---------------- briefing / debrief (map + typed text + zoom, like the original)
let pendingMission = null;
function startBriefing(id) {
  const def = MISSIONS.find(m => m.id === id);
  pendingMission = def;
  // remember the way back: bailing out of the brief (ESC) leaves a BACK TO
  // MISSION button on the main menu until the sortie actually launches
  G._backToMission = id;
  setHash(id);
  $('menu').classList.add('hidden');
  stopDemo();
  G.intro.briefing(def, () => enterPlaneSelect(def));
}
function enterPlaneSelect(def) {
  pendingMission = def;
  // the F-16 has no tailhook — carrier starts are Hornet-only
  G.intro.carrierStart = def.id === 'free' ? G.freeFlightStart === 'carrier' : def.id !== 'm1';
  G.intro.planeSelect();
}
function startFreeFlightMap() {
  setHash('freeflight');
  $('menu').classList.add('hidden');
  stopDemo();
  G.intro.mapSelect();
}
function launchWithZoom(def) {
  launchMission(def, { zoom: true });
}
// ---- F-14 Tomcat unlock (squadron purchase) --------------------------------
const TOMCAT_HASHES = new Set([
  '8fed8dde9c9e5e971ab14782a5baf076ab2c654023a5adb1b164cc74e4b98f77',   // squadron purchase code
  '0f4a124e2e2c3c4da4ea5f3999cce2b074840cf3a7eff4d53ec6a4031712b2e9',   // 'maverick'
]);
async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s.trim().toUpperCase()));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function openTomcatUnlock() {
  document.getElementById('tomcat-unlock').classList.remove('hidden');
  document.getElementById('tc-error').classList.add('hidden');
  G.audio.radioClick();
  const inp = document.getElementById('tc-input');
  inp.value = '';
  setTimeout(() => inp.focus(), 50);
}
function closeTomcatUnlock() { document.getElementById('tomcat-unlock').classList.add('hidden'); }
async function submitTomcatCode() {
  const inp = document.getElementById('tc-input');
  if (!inp.value.trim()) return;
  if (!TOMCAT_HASHES.has(await sha256hex(inp.value))) {
    document.getElementById('tc-error').classList.remove('hidden');
    return;
  }
  save.tomcat = true; persist();
  closeTomcatUnlock();
  G.msg('TOMCAT UNLOCKED — WELCOME TO THE JOLLY ROGERS', 'good');
  if (G.state === 'planesel' && pendingMission) { G.player.type = 'f14'; stats.planeSelect('f14'); launchWithZoom(pendingMission); }
}
{
  const tcInp = document.getElementById('tc-input');
  tcInp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.code === 'Enter') submitTomcatCode();
    else if (e.code === 'Escape') closeTomcatUnlock();
  });
}
// owner shortcut: ?tomcat=CODE unlocks without the overlay
{ const tcc = new URLSearchParams(location.search).get('tomcat'); if (tcc) sha256hex(tcc).then(h => { if (TOMCAT_HASHES.has(h)) { save.tomcat = true; persist(); } }); }
const tomcatOverlayOpen = () => !document.getElementById('tomcat-unlock').classList.contains('hidden');

// ---- all access: one code signs the whole board — every campaign mission
// and every school sortie open without the syllabus or the progression ----
const ALLACCESS_HASHES = new Set([
  '406ea3496b5ef1dab2605a02551202f651adf738771f083cd42d05e74de45d35',   // 'airboss'
  '81612559ce9ef9340d858e823399705cac6c89024d5aaac6d8b95e834968385e',   // 'malcolmsonly'
]);
function openAllAccessUnlock() {
  document.getElementById('allaccess-unlock').classList.remove('hidden');
  document.getElementById('aa-error').classList.add('hidden');
  G.audio.radioClick();
  const inp = document.getElementById('aa-input');
  inp.value = '';
  setTimeout(() => inp.focus(), 50);
}
function closeAllAccessUnlock() { document.getElementById('allaccess-unlock').classList.add('hidden'); }
async function submitAllAccessCode() {
  const inp = document.getElementById('aa-input');
  if (!inp.value.trim()) return;
  if (!ALLACCESS_HASHES.has(await sha256hex(inp.value))) {
    document.getElementById('aa-error').classList.remove('hidden');
    return;
  }
  if (save.allAccess) { closeAllAccessUnlock(); G.msg('ALL ACCESS ALREADY ACTIVE', 'good'); return; }
  save.allAccess = true; persist();
  closeAllAccessUnlock();
  G.msg('ALL ACCESS GRANTED — THE AIR BOSS SIGNS YOUR CARD', 'good');
  if (G.state === 'menu') buildMenu(menuMode);
}
{
  const aaInp = document.getElementById('aa-input');
  aaInp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.code === 'Enter') submitAllAccessCode();
    else if (e.code === 'Escape') closeAllAccessUnlock();
  });
}
// owner shortcut: ?allaccess=CODE unlocks without the overlay
{ const aac = new URLSearchParams(location.search).get('allaccess'); if (aac) sha256hex(aac).then(h => { if (ALLACCESS_HASHES.has(h)) { save.allAccess = true; persist(); } }); }
const allAccessOverlayOpen = () => !document.getElementById('allaccess-unlock').classList.contains('hidden');

// ---- wingman orders card (comma key, like the classic comms menu) ----
const wingOrdersOpen = () => !document.getElementById('wingman-orders').classList.contains('hidden');
function openWingOrders() {
  if (!G.wingman || !G.wingman.alive) { G.msg(G.wingman && G.wingman.state === 'DEAD' ? 'VIPER TWO IS GONE, LEAD' : 'NO WINGMAN ABOARD THIS SORTIE', 'warn'); return; }
  const el = $('wingman-orders');
  // highlight the current order
  const cur = G.wingman.order;
  for (const row of el.querySelectorAll('.wo-row')) row.classList.toggle('current', ORDERS[+row.dataset.o] === cur);
  el.classList.remove('hidden');
  G.audio.radioClick();
}
function closeWingOrders() { $('wingman-orders').classList.add('hidden'); }

// plane select + map select + briefing keys
window.addEventListener('keydown', (e) => {
  if (tomcatOverlayOpen()) return;   // the unlock card owns the keyboard
  if (wingOrdersOpen()) {            // the orders card owns digits while it's up
    if (e.code === 'Backquote' || e.code === 'Escape') closeWingOrders();
    else if (/^Digit[1-4]$/.test(e.code)) {
      const o = ORDERS[+e.code.slice(5) - 1];
      closeWingOrders();
      G.audio.radioClick();
      G.wingman.issueOrder(o);
    }
    return;
  }
  if (e.code === 'Backquote' && G.state === 'flying' && !G.player.dead) { openWingOrders(); return; }
  if (G.state === 'planesel') {
    if (e.code === 'Escape') {
      // step back one level: free flight returns to the start-point map,
      // a mission sortie returns to the menu (BACK TO MISSION waits there)
      if (pendingMission && pendingMission.id === 'free') { G.intro.mapSelect(); }
      else showMenu();
    }
    else if (e.code === 'KeyT') {
      G.dayNightSel = G.dayNightSel === 'day' ? 'night' : 'day';
      save.dayNight = G.dayNightSel; save.dayNightForced = true; persist();
      G.audio.radioClick();
    }
    else if (e.code === 'KeyR') {
      G.weatherSel = WX_CYCLE[G.weatherSel] || 'clear';
      save.weather = G.weatherSel; persist();
      G.audio.radioClick();
    }
    else if (e.code === 'Digit1') { G.player.type = 'f18'; stats.planeSelect('f18'); launchWithZoom(pendingMission); }
    else if (e.code === 'Digit2') {
      // the F-16 has no tailhook and can't take off from or land on the carrier
      const carrierStart = pendingMission.id === 'free' ? G.freeFlightStart === 'carrier' : pendingMission.id !== 'm1';
      if (carrierStart) { G.intro.blockMsg = 'F-16 CANNOT OPERATE FROM THE CARRIER'; G.intro.blockT = G.time; G.audio.radioClick(); }
      else { G.player.type = 'f16'; stats.planeSelect('f16'); launchWithZoom(pendingMission); }
    }
    else if (e.code === 'Digit3') {
      // the Tomcat is a squadron purchase: unlock code first, flight line after
      if (save.tomcat) { G.player.type = 'f14'; stats.planeSelect('f14'); launchWithZoom(pendingMission); }
      else { openTomcatUnlock(); }
    }
    else if (e.code === 'Digit4' || e.code === 'Digit5') {
      // the USAF jets: F-15 (4) and A-10 (5) — no tailhooks, no boat
      const t = e.code === 'Digit4' ? 'f15' : 'a10';
      const carrierStart = pendingMission.id === 'free' ? G.freeFlightStart === 'carrier' : pendingMission.id !== 'm1';
      if (carrierStart) { G.intro.blockMsg = PLANES[t].label + ' CANNOT OPERATE FROM THE CARRIER'; G.intro.blockT = G.time; G.audio.radioClick(); }
      else { G.player.type = t; stats.planeSelect(t); launchWithZoom(pendingMission); }
    }
  } else if (G.state === 'mapselect') {
    if (e.code === 'Escape') { showMenu(); return; }
    const spot = FF_SPOTS.find(s => s.key === (e.code.startsWith('Digit') ? e.code.slice(5) : ''));
    if (spot) { G.freeFlightStart = spot.id; stats.startPoint(spot.id); enterPlaneSelect(MISSIONS.find(m => m.id === 'free')); }
  } else if (G.state === 'briefing') {
    if (e.code === 'Enter' || e.code === 'Space') {
      const intro = G.intro, total = (intro.briefLines || []).join('\n').length;
      if (intro.typed < total) intro.typed = total;     // first key: finish the teletype
      else if (intro.afterBrief) { const f = intro.afterBrief; intro.afterBrief = null; f(); }
    }
    if (e.code === 'Escape') showMenu();
  } else if (G.state === 'debrief') {
    // any of the usual confirm/escape keys gets you back into the cockpit
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape') {
      $('debrief').classList.add('hidden'); G.state = 'flying';
    }
  }
});
$('debrief-menu').onclick = () => { $('debrief').classList.add('hidden'); showMenu(); };
// RESUME FLIGHT: back into the cockpit and keep flying the world you just
// saved (the mission is scored and over; what's left is free flight)
$('debrief-next').onclick = () => { $('debrief').classList.add('hidden'); G.state = 'flying'; };

// ---------------- sortie feedback poll ----------------
// GOES LIVE IN TWO MINUTES: create a free form at https://formspree.io (or
// web3forms.com) with maverick@hornetbay.com as the recipient, paste the
// endpoint below — ratings land in that dashboard and every submission
// emails the tower. Empty endpoint keeps the poll hidden; put #fbtest in
// the URL to fly it in test mode (payload goes to the console, nothing sent).
const FEEDBACK_ENDPOINT = '';
const FB = { ctx: null };
const fbActive = () => !!FEEDBACK_ENDPOINT || location.search.indexOf('fbtest') >= 0 || location.hash.indexOf('fbtest') >= 0;
function fbBind(prefix) {
  const P = {
    stars: 0, sent: false,
    starBtns: document.querySelectorAll('#' + prefix + '-stars button'),
    text: $(prefix + '-text'), submit: $(prefix + '-submit'), status: $(prefix + '-status')
  };
  P.paint = () => { for (const b of P.starBtns) b.classList.toggle('on', +b.dataset.star <= P.stars); };
  for (const b of P.starBtns) b.addEventListener('click', () => { P.stars = +b.dataset.star; P.paint(); b.blur(); });
  P.submit.addEventListener('click', () => fbSend(P));
  P.text.addEventListener('keydown', (e) => e.stopPropagation());   // typing isn't flying
  P.reset = () => {
    P.stars = 0; P.sent = false;
    P.text.value = ''; P.submit.disabled = false;
    P.status.textContent = FEEDBACK_ENDPOINT ? '' : 'TEST MODE — WIRE FEEDBACK_ENDPOINT TO GO LIVE';
    P.paint();
  };
  return P;
}
const fbDebrief = fbBind('fb');
const fbCrash = fbBind('fb2');
async function fbSend(P) {
  if (P.sent) return;
  if (!P.stars) { P.status.textContent = 'PICK 1–5 STARS FIRST'; return; }
  const payload = {
    stars: P.stars,
    feedback: P.text.value.trim(),
    mission: FB.ctx ? FB.ctx.mission : (G.missionDef ? G.missionDef.id : ''),
    result: FB.ctx ? FB.ctx.result : '',
    score: G.score, kills: G.kills,
    when: new Date().toISOString(),
    ua: navigator.userAgent,
    page: location.href
  };
  if (!FEEDBACK_ENDPOINT) {   // test mode: log it, call it good
    console.log('[feedback:test]', payload);
    P.sent = true; P.submit.disabled = true;
    P.status.textContent = 'TEST MODE — PAYLOAD LOGGED TO CONSOLE';
    return;
  }
  P.submit.disabled = true;
  P.status.textContent = 'SENDING…';
  try {
    const r = await fetch(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    P.sent = true;
    P.status.textContent = 'LOGGED — THANKS, PILOT';
  } catch (e) {
    P.submit.disabled = false;
    P.status.textContent = 'SEND FAILED — TRY AGAIN';
  }
}
// the crash poll flies solo: SKIP (or a finished submit) heads back to base
$('fb2-skip').onclick = () => { $('feedback-poll').classList.add('hidden'); quitToMenu(); };
function fbOfferCrash() {
  FB.ctx = { mission: G.missionDef ? G.missionDef.id : '', result: 'CRASHED — ' + (G.crashReason || 'AIRCRAFT DOWN') };
  fbCrash.reset();
  $('fb2-skip').textContent = 'SKIP';
  $('feedback-poll').classList.remove('hidden');
}
// flight manual on demand — corner button or ? key; auto-pauses the sim while open
G._manualPaused = false;
G.openManual = () => {
  if (G.state === 'flying') { togglePause(); G._manualPaused = true; }
  setHash('manual');
  $('controls').classList.remove('hidden');
  $('pause').classList.add('hidden');          // manual reads above the PAUSED card
};
G.closeManual = () => {
  $('controls').classList.add('hidden');
  if (G._manualPaused && G.state === 'paused') togglePause();
  G._manualPaused = false;
  if (G.state === 'paused') $('pause').classList.remove('hidden');
};
$('controls-back').onclick = () => G.closeManual();
$('manual-btn').addEventListener('mousedown', (e) => e.stopPropagation());  // don't fire the gun
$('manual-btn').addEventListener('click', (e) => { e.stopPropagation(); G.openManual(); });
// mouse / trackpad stick: click the screen to capture the cursor (pointer lock),
// then relative movement flies the jet — the Amiga way, and playable on a trackpad
$('gl').addEventListener('click', () => {
  if (G.input.mouseStick && G.state === 'flying' && !document.pointerLockElement) $('gl').requestPointerLock();
});
$('controls').addEventListener('click', (e) => { if (e.target.id === 'controls') G.closeManual(); });
$('pause-resume').onclick = () => togglePause();
$('pause-restart').onclick = () => { $('pause').classList.add('hidden'); launchMission(G.missionDef); };
// KEYS / CONTROLS rides the manual's own open/close path, so closing the keys
// card drops you right back on the PAUSED screen
$('pause-keys').onclick = () => G.openManual();
$('pause-quit').onclick = () => { $('pause').classList.add('hidden'); showMenu(); };

// ---------------- mission lifecycle ----------------
function launchMission(def, opts = {}) {
  if (window.HBAnthem) { window.HBAnthem.mute(); window.HBAnthem.hide(); }   // the sim owns the soundscape now
  G.missionDef = def;
  stats.flushGA();   // report anything left pending from the previous sortie
  if (def.id !== 'free') stats.missionFlown(def.id);
  G._menuResume = false;   // a fresh sortie replaces the one the menu remembered
  G._backToMission = null;   // and the brief is behind us — no way-back button for it
  wakeLockTry();   // keep the screen awake for the sortie
  // safety net: noBoat types never go to the boat, whatever path got us here
  if (PLANES[G.player.type] && PLANES[G.player.type].noBoat) {
    const carrierStart = def.id === 'free' ? G.freeFlightStart === 'carrier' : def.id !== 'm1';
    if (carrierStart) G.player.type = 'f18';
  }
  $('menu').classList.add('hidden');
  $('briefing').classList.add('hidden');
  $('debrief').classList.add('hidden');
  $('debrief-feedback').classList.add('hidden');
  $('feedback-poll').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('obj-card').classList.add('hidden');
  stopDemo();
  // clear entities
  if (G.chute) { G.chute.dispose(); G.chute = null; }
  G._chuteCamSnap = false;
  G.audio.endChute();
  for (const b of G.bandits) b.dispose();
  G.bandits = [];
  G.traffic = new Traffic(G);   // SFO keeps its schedules whatever the sortie
  if (G.heliOps) G.heliOps.dispose();
  G.heliOps = new HeliOps(G);   // the cruiser flies its Seahawk, shuttles work the pads
  if (G.p3) G.p3.dispose();
  G.p3 = new P3Patrol(G);       // the Orion holds its oval west of the group
  if (G.asw) G.asw.dispose();
  G.asw = new AswOps(G);        // buoys, torps and the prowler west of the Gate
  G.shipWeapons = new EscortWeapons(G);   // Klakring's SM-1s and Harpoons
  if (G.awacs) G.awacs.dispose();
  G.awacs = new Awacs(G);       // VAW-123 keeps the big picture from on high
  G.airWing = new AirWing(G);   // VA-52 / VS-37 / VRC-30 work the deck cycle
  if (G.wingman) { G.wingman.dispose(); G.wingman = null; }
  if (def.id !== 'free') G.wingman = new Wingman(G);   // VIPER TWO rides every mission
  for (const m of G.missiles) m._die();
  G.missiles = [];
  G.time = 0; G.score = 0; G.kills = 0; G.gunHits = 0; G.shotsFired = 0;
  G.messages = []; G.playerTarget = null; G.lockLevel = 0; G.waypoint = null;
  G.trappedThisSortie = false; G.landedThisSortie = false; G.over = false; G.trapCount = 0;
  G.missileWarning = false; G.podDropRequested = false;
  G.crashHandled = false;                        // arm the crash handler again
  G.fx.clearDebris();
  G.world.enemySub.group.visible = false;   // m6 spawns its own destructible sub entity
  const _bnr = G.world.carrier.group.getObjectByName('m9banner');   // m9 dresses the island for one sortie only
  if (_bnr) G.world.carrier.group.remove(_bnr);
  for (const v of G.world.ships.all) { v._held = false; v.missionUnit = false; }   // m11 seizes the Bay Monarch for one sortie only
  G.world.setTimeOfDay(def.time || 'day');
  G.mission = Object.assign({}, def);
  G._castFlag = true;                          // everything the script raises from here is mission cast
  try { G.mission.setup(G); } finally { G._castFlag = false; }
  // point of origin: a sortie only counts when you bring her back to where
  // it began. Other decks and fields still rearm & refuel — they just don't
  // end the mission. Free flight has no origin and no paperwork.
  G.rtb = null; G._rtbNudge = -99;
  const _og = G.player.onGround;
  G.missionOrigin = (def.id === 'free' || !_og) ? null
    : _og.type === 'carrier' ? { kind: 'carrier', label: 'THE ENTERPRISE' }
    : { kind: 'runway', ap: _og.rw.name.replace(/\s+\S+$/, ''), label: _og.rw.name.replace(/\s+\S+$/, ''), pos: new THREE.Vector3(_og.rw.x, 0, _og.rw.z) };
  // day/night: the authored time stands unless the pilot explicitly switched
  // (no more MISSION DEFAULT stop — DAY or NIGHT is an override once toggled)
  if (save.dayNightForced) G.world.setTimeOfDay(G.dayNightSel);
  // weather selection from the menu (missions are authored clear)
  G.world.setWeather(G.weatherSel || 'clear');
  scriptT = 0; runScript._gear = false;
  runScript._init = runScript._through = runScript._joined = runScript._bogey = false;
  runScript._phase = 0; runScript._pt = 0;
  G.msg(def.title, 'info');
  G.audio.ensure();
  if (opts.zoom) {
    G.intro.zoomToAircraft(() => { G.view = 'cockpit'; G.state = 'flying'; snapCamera(); showQuickstart(); });
  } else {
    G.state = 'flying';
    snapCamera();
    showQuickstart();
  }
}

// ---------------- quick-start card ----------------
// the handful of keys that get a new pilot airborne; shows at every launch
// until they tick "don't show again"
let qsTimer = 0;
function showQuickstart() {
  if (localStorage.getItem('hb-qs-hide') === '1') return;
  const touch = document.documentElement.classList.contains('touch');
  $('qs-grid').innerHTML = touch
    ? `<div><b>THR</b></div><div>drag the lever to full</div>
       <div><b>BRK</b></div><div>brakes off</div>
       <div><b>STICK BACK</b></div><div>pull at 150 KT &mdash; you&#39;re flying</div>
       <div><b>GEAR</b></div><div>gear up when climbing</div>
       <div><b>? MANUAL</b></div><div>top-right &mdash; the full flight manual</div>`
    : `<div><b>W</b></div><div>hold &mdash; throttle to full (S slows down)</div>
       <div><b>B</b></div><div>brakes off</div>
       <div><b>&darr;</b></div><div>pull back at 150 KT &mdash; you&#39;re flying</div>
       <div><b>G</b></div><div>gear up when climbing</div>
       <div><b>Y</b></div><div>mouse / trackpad stick &mdash; then click the screen to capture the cursor</div>
       <div><b>?</b></div><div>the full flight manual</div>`;
  const cb = $('qs-never-cb');
  cb.checked = false;
  cb.onchange = () => localStorage.setItem('hb-qs-hide', cb.checked ? '1' : '0');
  $('quickstart').classList.remove('hidden');
  qsTimer = 14;
}
function hideQuickstart() { $('quickstart').classList.add('hidden'); qsTimer = 0; }
$('quickstart').addEventListener('click', (e) => {
  if (e.target.closest('.qs-never')) return;   // ticking the checkbox doesn't close
  hideQuickstart();
});

G.spawnAI = (type, opts) => {
  const a = new AIAircraft(scene, G.world, type, opts);
  a.label = opts.label || opts.name || type;
  if (G._castFlag) a.missionUnit = true;   // spawned by the mission script itself — earns a seat on the K ring
  G.bandits.push(a);
  return a;
};
G.setPlayerStart = (cfg) => {
  cfg.plane = G.player.type;
  G.player.reset(cfg);
};
G.explode = (pos, scale = 1) => {
  G.fx.explosion(pos, scale);
  G.audio.explosion(camera.position.distanceTo(pos));
  flash(0.35 * scale);
};
G.fireEnemyMissile = (owner, target, type) => {
  type = type || (Math.random() < 0.5 ? 'r27' : 'r73');
  G.missiles.push(new Missile(G, owner, type, target));
  G.audio.enemyMissile();
  if (target === G.player) G.msg('!! MISSILE LAUNCH — BREAK !!', 'bad');
};
G.onAircraftDown = (unit, byPlayer) => {
  if (unit === G.player) return;
  if (unit.kind === 'bandit' || unit.kind === 'stolen') {
    if (byPlayer) {
      G.kills++; save.kills++; persist();
      G.addScore(1000);
      G.msg(`SPLASH! ${unit.label} DOWN  +1000`, 'good');
      G.audio.kill();
      if (unit.type === 'mig29') stats.migKill();
    } else {
      G.msg(`${unit.label} DESTROYED`, 'info');
    }
  }
  if (unit.type === 'cruise') { G.msg('CRUISE MISSILE DESTROYED', 'good'); }
  if (unit.type === 'sub') { G.msg('SHADOW SUB DESTROYED!', 'good'); }
  if (unit.kind === 'airliner') {
    // player weapons can no longer touch civil traffic — no lock, no bullet,
    // no warhead, and with the trigger gone the court martial goes with it.
    // An airliner only falls now if the world itself takes it down.
    G.msg(`${unit.label} CRASHED — ALL SOULS LOST`, 'bad');
  }
};
G.onPlayerHit = (dmg, byWhom) => {
  if (G.player.dead || G.player.ejected) return;
  G.player.damage += dmg;
  G.audio.explosion(50);
  flash(0.5);
  if (G.player.damage >= 100) {
    G.player.dead = true;
    G.msg('FIRE! YOU\'RE GOING DOWN — EJECT (SHIFT+E)!', 'bad');
    G.audio.fail();
  } else {
    G.msg(`HIT! DAMAGE ${Math.round(G.player.damage)}%`, 'warn');
  }
};
G.onCrashed = (reason) => {
  if (G.player.dead && G.crashHandled) return;
  if (G.crashHandled) return;
  G.crashHandled = true;
  G.player.dead = true;
  stats.playerDeath(reason || 'crash', G.missionDef ? G.missionDef.id : 'free');   // one death per sortie; ejections counted apart
  G.explode(G.player.pos, 1.4);
  G.fx.shatter(G.player.pos, G.player.vel, 1.3);   // the jet breaks apart on impact
  G.player.model.visible = false;
  if (G.state === 'flying') {
    G.state = 'dead'; G.deadT = 0; G.crashReason = reason;
  }
};
G.onEmptyPlaneDown = () => { G.explode(G.player.pos, 1.2); G.fx.shatter(G.player.pos, G.player.vel, 1.1); G.player.model.visible = false; };
G.onTrapped = () => {
  G.trappedThisSortie = true;
  G.trapCount = (G.trapCount || 0) + 1;   // the school counts arrested landings
  G.addScore(500);
  G.msg('TRAPPED! +500 — DECK CREW: REARMING', 'good');
  G.audio.trap();
  // rearm & refuel
  const P = G.player;
  P.fuel = P.cfg.fuel;
  P.stores.aim9 = 2; P.stores.gun = P.type === 'f14' ? 675 : P.type === 'a10' ? 1150 : 500;
  if (P.type === 'f14') { P.stores.aim54 = 2; P.stores.aim7 = 4; } else if (P.type !== 'a10') P.stores.aim120 = 4;
  if (G.missionDef && G.missionDef.mk83) P.stores.mk83 = G.missionDef.mk83;   // strike missions reload the bomb racks too
  P.stores.chaff = 14; P.stores.flares = 14; P.damage = Math.min(P.damage, 20);
};
// sonic boom: crossing Mach 1 shakes the world and cracks the air
G.onMachCross = (supersonic) => {
  const P = G.player;
  G.shakeT = Math.max(G.shakeT, 1.4);
  G.audio.sonicBoom();
  if (supersonic) G.msg('MACH 1', 'info');
  // vapor cone puffs shedding off the airframe
  for (let i = 0; i < 10; i++) {
    const p = P.pos.clone().addScaledVector(P.fwd, 2 - i * 1.8);
    p.y += (Math.random() - 0.5) * 1.5;
    G.fx.smoke(p, 0.55, 1.3, 0xf4f8ff);
  }
  G.fx.flash(P.pos.clone(), 12, 0xffffff, 0.14);
};
// objective done ≠ mission done. The mission is complete only when the pilot
// returns to the point of origin and puts the jet on that deck or runway.
// Until then the debrief waits in G.rtb and the waypoint points home.
G.completeMission = (title, text) => {
  if (G.over) return;
  const o = G.missionOrigin;
  if (o) {
    const og = G.player.onGround;
    const atHome = og && ((o.kind === 'carrier' && og.type === 'carrier') ||
                          (o.kind === 'runway' && og.type === 'runway' && og.rw.name.replace(/\s+\S+$/, '') === o.ap));
    if (!atHome) {
      if (!G.rtb) {   // missions re-call every frame — announce once, keep the first debrief
        G.rtb = { title, text };
        G.msg(`OBJECTIVE DONE — RTB: LAND AT ${o.label} TO FINISH THE SORTIE`, 'good');
        G.radio(o.kind === 'carrier'
          ? 'FLEET COM: GOOD WORK, VIPER — BUT THE SORTIE DOESN\'T COUNT TILL YOU\'RE DECKED. BRING HER HOME.'
          : `FLEET COM: GOOD WORK, VIPER — NOW RTB. SHE ONLY COUNTS WHEN SHE\'S DOWN AT ${o.label}.`);
      }
      return;
    }
  }
  G.rtb = null;
  G._finishMission(title, text);
};
G._finishMission = (title, text) => {
  if (G.over) return;
  G.over = true;
  stats.flushGA();
  const id = G.missionDef.id;
  stats.missionComplete(id, G.score);   // funnel: flown -> complete, per mission
  if (id === 'qual' || id === 't1') { save.qualified = true; save.done[id] = true; }
  else if (id !== 'free') { save.done[id] = true; }
  save.best = Math.max(save.best, G.score);
  persist();
  setTimeout(() => {
    if (G.state === 'menu') return;   // player bailed to the menu first
    $('debrief-title').textContent = title;
    $('debrief-title').className = 'good';
    $('debrief-body').textContent = text + `\n\nFINAL SCORE: ${G.score} · KILLS: ${G.kills}`;
    $('debrief').classList.remove('hidden');
    $('obj-card').classList.add('hidden');
    G.state = 'debrief';
    if (fbActive()) { FB.ctx = { mission: id, result: 'MISSION COMPLETE' }; fbDebrief.reset(); $('debrief-feedback').classList.remove('hidden'); }
  }, 2500);
  G.msg('MISSION COMPLETE', 'good');
  G.audio.kill();
};
G.failMission = (title, text) => {
  if (G.over) return;
  G.over = true;
  stats.flushGA();
  stats.missionFailed(G.missionDef ? G.missionDef.id : 'free');
  save.best = Math.max(save.best, G.score); persist();
  setTimeout(() => {
    if (G.state === 'menu') return;   // player bailed to the menu first
    $('debrief-title').textContent = title;
    $('debrief-title').className = 'bad';
    $('debrief-body').textContent = text + `\n\nSCORE: ${G.score}`;
    $('debrief').classList.remove('hidden');
    $('obj-card').classList.add('hidden');
    G.state = 'debrief';
    if (fbActive()) { FB.ctx = { mission: G.missionDef ? G.missionDef.id : '', result: 'MISSION FAILED' }; fbDebrief.reset(); $('debrief-feedback').classList.remove('hidden'); }
  }, 2200);
  G.msg('MISSION FAILED', 'bad');
  G.audio.fail();
};

function snapCamera() {
  const P = G.player;
  const f = P.fwd.clone();
  camPos.copy(P.pos).addScaledVector(f, -30).add(new THREE.Vector3(0, 8, 0));
  camUp.set(0, 1, 0);
}

function flash(op) {
  const f = $('flash');
  f.style.opacity = Math.min(op, 0.8);
  setTimeout(() => f.style.opacity = 0, 120);
}
G.flashCut = (op) => flash(op);   // attract-mode scene cuts punch through the same flash

// ---------------- demo flight behind menu ----------------
let demoDir = null;
let attract = false;   // DEMO menu item: full-screen attract loop, any key returns
function startDemo(attractMode) {
  if (!demoDir) { demoDir = new DemoDirector(G, scene); G.demoDir = demoDir; }   // the cinematic reel: cat shots, furballs, traps
  if (attractMode && !attract) {
    attract = true;
    $('menu').classList.add('hidden');
    $('attract-hint').classList.remove('hidden');
    const bail = (e) => {
      if (e && e.cancelable) e.preventDefault();
      window.removeEventListener('keydown', bail, true);
      window.removeEventListener('mousedown', bail, true);
      window.removeEventListener('touchstart', bail, true);
      if (!attract) return;
      attract = false;
      $('attract-hint').classList.add('hidden');
      // the exit gesture leaks a compat mousedown/mouseup/click sequence that
      // retargets whatever is on screen when it finally lands — swallow the
      // whole sequence (until the click arrives, 3s backstop), then re-show
      if (e && e.type !== 'keydown') {
        const off = () => { for (const t of ['mousedown', 'mouseup', 'click']) window.removeEventListener(t, swallow, true); };
        const swallow = (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          if (ev.type === 'click') { off(); clearTimeout(to); }
        };
        for (const t of ['mousedown', 'mouseup', 'click']) window.addEventListener(t, swallow, true);
        var to = setTimeout(off, 3000);
      }
      setTimeout(() => { if (G.state === 'menu') showMenu(); }, 350);
    };
    window.addEventListener('keydown', bail, true);
    window.addEventListener('mousedown', bail, true);
    window.addEventListener('touchstart', bail, true);
  }
}
function stopDemo() {
  if (demoDir) { demoDir.dispose(); demoDir = null; }
}

// ---------------- pause ----------------
function togglePause() {
  if (G.state === 'flying') { G.state = 'paused'; $('pause').classList.remove('hidden'); G.audio.pause(true); }
  else if (G.state === 'paused') { G.state = 'flying'; $('pause').classList.add('hidden'); G.audio.pause(false); }
}
// Q — bail straight back to the main menu from flying / paused / dead
function quitToMenu() {
  stats.flushGA();   // sortie's over (or suspended) — report pending batched metrics
  // Q from the cockpit: the sortie survives the menu — Q again takes you back
  G._menuResume = (G.state === 'flying' || G.state === 'paused');
  if (G._menuResume) {
    // remember the sortie's sky: the menu restyles the world to its own
    // backdrop, so resumeFlight() has to put the mission's time/weather back
    G._resumeEnv = { tod: G.world.mode || 'day', wx: G.world.weatherMode || (G.world.weatherTarget ? 'rain' : 'clear') };
    G.audio.updateFlight(0, false, 0);   // engines fall to idle while the menu is up
  }
  G.audio.pause(true);   // the pause chirp, whether or not the sortie survives
  G._manualPaused = false;
  $('controls').classList.add('hidden');
  $('pause').classList.add('hidden');
  showMenu();
}

// Q pressed on the menu with a live sortie behind it: fold the menu away and
// hand the jet back. The player object never moved — only the attract demo
// borrowed the camera, so stopDemo() is all the cleanup we need.
function resumeFlight() {
  if (!G._menuResume) return;
  G._menuResume = false;
  stopDemo();
  // the menu dressed the world in its own backdrop — put the sortie's sky back
  if (G._resumeEnv) {
    G.world.setTimeOfDay(G._resumeEnv.tod);
    G.world.setWeather(G._resumeEnv.wx);
    G._resumeEnv = null;
  }
  $('menu').classList.add('hidden');
  $('pause').classList.add('hidden');
  G.state = 'flying';
  G.audio.pause(false);   // released — back in the cockpit
}

// ---------------- cameras ----------------
const camPos = new THREE.Vector3(-24000, 900, 14000);
const camUp = new THREE.Vector3(0, 1, 0);

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _fwd = new THREE.Vector3();
// plane models fly nose = local +Z, but a three.js camera looks down its
// local -Z — rotate the cockpit cam 180° about Y so it faces the nose
const _qy180 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

function updateCamera(dt) {
  if (G.intro.active) return; // intro drives the camera in map/briefing/zoom states
  const P = G.player;
  if (G.state === 'menu' && demoDir) {
    demoDir.driveCamera(dt, camPos, camera);   // the reel directs its own shots
    return;
  }
  if (!P) return;
  // ejected: a slow orbit around the pilot floating down under the canopy
  if (G.chute) {
    if (P.model) P.model.visible = true;   // watch the empty jet fall away
    const c = G.chute.group.position;
    const a = G.time * 0.1;
    _v.set(c.x - 26 * Math.cos(a), c.y + 6, c.z - 26 * Math.sin(a));
    if (!G._chuteCamSnap) { camPos.copy(_v); G._chuteCamSnap = true; }  // cut to the chute cam
    else {
      camPos.x = damp(camPos.x, _v.x, 3.0, dt);
      camPos.y = damp(camPos.y, Math.max(_v.y, 4), 3.0, dt);
      camPos.z = damp(camPos.z, _v.z, 3.0, dt);
    }
    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(c.x, c.y + 2, c.z);
    camera.fov = damp(camera.fov, 55, 2, dt); camera.updateProjectionMatrix();
    return;
  }
  // spectate camera: ride another aircraft (J cycles). overrides the player views.
  const spec = G.specTarget && !G.specTarget.dead && !G.specTarget.removeMe ? G.specTarget : null;
  if (spec) {
    if (P.model) P.model.visible = false;   // no own jet / cockpit while spectating
    const I = G.input;
    // pan & zoom around the spectated aircraft: SHIFT+arrows or right-drag to
    // orbit, wheel or [ ] for distance, 0 to reframe. Plain arrows still fly
    // your own jet — the modifier is what talks to the camera.
    const o = G.specOrbit || (G.specOrbit = { yaw: 0, pitch: 0.1, dist: 1 });
    const cdt = dt / (G.timeScale || 1);   // camera controls run at hand speed, not sim speed
    if (I.down('ShiftLeft') || I.down('ShiftRight')) {
      o.yaw += ((I.down('ArrowRight') ? 1 : 0) - (I.down('ArrowLeft') ? 1 : 0)) * cdt * 1.7;
      o.pitch = clamp(o.pitch + ((I.down('ArrowDown') ? 1 : 0) - (I.down('ArrowUp') ? 1 : 0)) * cdt * 1.1, -0.85, 1.25);
    }
    if (I.rdx || I.rdy) { o.yaw += I.rdx * 0.006; o.pitch = clamp(o.pitch + I.rdy * 0.004, -0.85, 1.25); }
    // numeric keypad mirrors the arrows: 4/6 pan, 8/2 tilt, +/- (or 9/3) zoom, 0 reframes
    if (I.down('Numpad4')) o.yaw -= cdt * 1.7;
    if (I.down('Numpad6')) o.yaw += cdt * 1.7;
    if (I.down('Numpad8')) o.pitch = clamp(o.pitch + cdt * 1.1, -0.85, 1.25);
    if (I.down('Numpad2')) o.pitch = clamp(o.pitch - cdt * 1.1, -0.85, 1.25);
    if (I.wheel) o.dist = clamp(o.dist + I.wheel * 0.9, 0.35, 5);
    if (I.down('BracketRight') || I.down('NumpadAdd') || I.down('Numpad9')) o.dist = clamp(o.dist * (1 - cdt * 1.4), 0.35, 5);   // ] / KP+ : close in
    if (I.down('BracketLeft') || I.down('NumpadSubtract') || I.down('Numpad3')) o.dist = clamp(o.dist * (1 + cdt * 1.4), 0.35, 5);    // [ / KP- : back off
    if (I.pressed('Digit0') || I.pressed('Numpad0')) { o.yaw = 0; o.pitch = 0.1; o.dist = 1; }
    const sf = spec.fwd(_v2);
    const big = spec.cfg ? 0.85 : spec.len ? Math.max(2, spec.len / 45) : /^(b744|b747|b737|dc10|md90)$/.test(spec.type) ? 3.2 : 1.0;
    const base = (24 + (spec.speed || 120) * 0.03) * big * o.dist;
    // orbit offset in the target's frame: start behind it, swing by yaw, lift by pitch
    const bx = -sf.x, bz = -sf.z;
    const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw);
    const rx = bx * cy + bz * sy, rz = bz * cy - bx * sy;
    const horiz = Math.cos(o.pitch) * base;
    _v.set(spec.pos.x + rx * horiz,
           Math.max(spec.pos.y + 7 * big * o.dist + Math.sin(o.pitch) * base, 2.5),
           spec.pos.z + rz * horiz);
    if (G._specSnap) {   // scripted cutaway (AF1's tarmac shot): no cross-bay camera flight
      G._specSnap = false; camPos.set(_v.x, _v.y, _v.z);
    }
    camPos.x = damp(camPos.x, _v.x, 4.5, dt);
    camPos.y = damp(camPos.y, _v.y, 4.5, dt);
    camPos.z = damp(camPos.z, _v.z, 4.5, dt);
    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(spec.pos.x, spec.pos.y + 4 * big, spec.pos.z);
    camera.fov = damp(camera.fov, 55 / G.xmag, 3, dt); camera.updateProjectionMatrix();
    return;
  }
  // own jet must not block the cockpit view
  if (P.model) P.model.visible = G.view !== 'cockpit' && G.view !== 'cockpitoff';
  if (G.view === 'chase') {
    const f = P.fwd.clone();
    const dist = window.__camdist > 0 ? window.__camdist : 24 + P.speed * 0.03;
    _v.copy(P.pos).addScaledVector(f, -dist).add(_v2.set(0, 7 + P.speed * 0.004, 0));
    const k = P.onGround ? 8 : 4.5;
    camPos.x = damp(camPos.x, _v.x, k, dt);
    camPos.y = damp(camPos.y, Math.max(_v.y, 2.5), k, dt);
    camPos.z = damp(camPos.z, _v.z, k, dt);
    camera.position.copy(camPos);
    // up vector follows bank gently
    const up = _v2.set(0, 1, 0).applyQuaternion(P.quat);
    camUp.x = damp(camUp.x, up.x * 0.55, 3, dt);
    camUp.y = damp(camUp.y, Math.max(up.y, 0.25), 3, dt);
    camUp.z = damp(camUp.z, up.z * 0.55, 3, dt);
    camera.up.copy(camUp).normalize();
    camera.lookAt(_v2.copy(P.pos).addScaledVector(f, 60));
    camera.fov = damp(camera.fov, (55 + P.speed * 0.045) / G.xmag, 3, dt);
    camera.updateProjectionMatrix();
  } else if (G.view === 'cockpit' || G.view === 'cockpitoff') {
    const f = P.fwd.clone();
    camera.position.copy(P.pos).addScaledVector(f, 1.6).add(_v.set(0, 1.55, 0).applyQuaternion(P.quat));
    camera.quaternion.copy(P.quat).multiply(_qy180); // face the nose, not the tail
    camera.fov = damp(camera.fov, 68 / G.xmag, 4, dt); camera.updateProjectionMatrix();
  } else if (G.view === 'tower') {
    // watch the jet from the nearest control tower cab (runways or the carrier island)
    let best = null, bestD = Infinity;
    for (const tv of G.world.towerViews || []) {
      const d = tv.pos.distanceToSquared(P.pos);
      if (d < bestD) { bestD = d; best = tv; }
    }
    G.world.carrierTowerPos(_v2);
    let name = best ? best.name : 'TOWER';
    if (_v2.distanceToSquared(P.pos) < bestD) { _v.copy(_v2); name = 'ENTERPRISE TOWER'; }
    else if (best) _v.copy(best.pos);
    G.towerName = name;
    camera.position.copy(_v);
    camera.up.set(0, 1, 0);
    camera.lookAt(P.pos);
    camera.fov = damp(camera.fov, 55 / G.xmag, 5, dt); camera.updateProjectionMatrix();
  } else { // orbit — original keypad POV: yaw/pitch/distance
    const orb = G.orbit;
    if (!orb.manual) orb.yaw += dt * 0.35;
    const cp = Math.cos(orb.pitch);
    _v.set(
      P.pos.x + Math.sin(orb.yaw) * cp * orb.dist,
      Math.max(P.pos.y + Math.sin(orb.pitch) * orb.dist, 2.5),
      P.pos.z + Math.cos(orb.yaw) * cp * orb.dist);
    camera.position.copy(_v);
    camera.up.set(0, 1, 0);
    camera.lookAt(P.pos);
    camera.fov = damp(camera.fov, 45 / G.xmag, 3, dt); camera.updateProjectionMatrix();
  }
  // camera shake (sonic boom, heavy damage, hard knocks)
  if (G.shakeT > 0.01) {
    const mag = G.shakeT * (G.view === 'cockpit' || G.view === 'cockpitoff' ? 0.22 : 0.5);
    camera.position.x += (Math.random() - 0.5) * mag;
    camera.position.y += (Math.random() - 0.5) * mag;
    camera.position.z += (Math.random() - 0.5) * mag;
  }
}

// ---------------- targeting & weapons ----------------
function updateTargeting(dt) {
  const P = G.player;
  // build target list — hostiles only. Civil traffic and friendlies still paint
  // the scope as contacts, but the weapon system refuses them: no T-cycle, no
  // lock, no shot. Civilian lives are not in the target set, full stop.
  // air-to-air only: surface contacts (the sub, the raft) can be seen, never locked.
  const targets = G.bandits.filter(b => !b.dead && !b.removeMe && !b.surface && (b.kind === 'bandit' || b.kind === 'stolen'));
  if (G.playerTarget && (G.playerTarget.dead || G.playerTarget.removeMe)) { G.playerTarget = null; G.lockLevel = 0; }
  if (G.input.pressed('KeyT')) {
    if (!targets.length) { G.playerTarget = null; }
    else {
      const idx = targets.indexOf(G.playerTarget);
      G.playerTarget = targets[(idx + 1) % targets.length];
      G.lockLevel = 0;
      G.audio.radioClick();
    }
  }
  if (!G.playerTarget && targets.length === 1) G.playerTarget = targets[0];
  // lock
  const wpn = P.weapon;
  let canLock = false, rngMax = 0;
  if (G.playerTarget && wpn !== 'gun' && wpn !== 'mk83') {   // dumb bombs never lock — the CCIP does the aiming
    const t = G.playerTarget;
    const dist = P.pos.distanceTo(t.pos);
    _v.copy(t.pos).sub(P.pos).normalize();
    const ang = P.fwd.angleTo(_v);
    if (wpn === 'aim9') { rngMax = 8500; canLock = dist > 400 && dist < rngMax && ang < 0.6; }
    else if (wpn === 'aim54') { rngMax = 90000; canLock = dist > 1200 && dist < rngMax && ang < 0.9; }   // Phoenix: the AWG-9 reaches out
    else if (wpn === 'aim7') { rngMax = 26000; canLock = dist > 1000 && dist < rngMax && ang < 0.9; }   // Sparrow: the Tomcat's medium stick
    else { rngMax = 30000; canLock = dist > 900 && dist < rngMax && ang < 0.9; }
  }
  if (canLock) G.lockLevel = Math.min(1, G.lockLevel + dt / 1.1);
  else G.lockLevel = Math.max(0, G.lockLevel - dt * 1.6);
  G.locked = G.lockLevel >= 1;
  G.audio.setLock(canLock ? G.lockLevel : 0, G.locked);
  // fire missile — lock or no lock, on the deck or in the air; with no
  // lock the round just motors straight ahead like the original's did.
  // SPACE only: ENTER is the weapon selector, exactly like the Amiga original
  if (G.input.pressed('Space') && G.state === 'flying' && !P.dead && !P.ejected) {
    if (wpn === 'gun') { /* gun fires continuously while SPACE is held — handled below */ }
    else if (wpn === 'mk83') {
      if (P.onGround) G.msg('WEAPONS HOLD — ON THE DECK', 'warn');
      else if (P.stores.mk83 <= 0) G.msg('NO BOMBS LEFT', 'warn');
      else {
        P.stores.mk83--;
        G.missiles.push(new Bomb(G, P, 'mk83'));
        G.audio.missileFire();
        G.shotsFired++;
        G.msg('BOMBS AWAY', 'good');
      }
    }
    else if (wpn === 'aim9' || wpn === 'aim120' || wpn === 'aim54' || wpn === 'aim7') {
      if (P.stores[wpn] <= 0) G.msg(wpn === 'aim9' ? 'NO SIDEWINDERS LEFT' : wpn === 'aim54' ? 'NO PHOENIX LEFT' : wpn === 'aim7' ? 'NO SPARROWS LEFT' : 'NO AMRAAMS LEFT', 'warn');
      else {
        P.stores[wpn]--;
        const tgt = (G.locked && G.playerTarget) ? G.playerTarget : null;
        G.missiles.push(new Missile(G, P, wpn, tgt));
        G.audio.missileFire();
        G.shotsFired++;
        stats.missileFired(wpn);
        G.msg(wpn === 'aim9' ? 'FOX 2!' : wpn === 'aim54' ? 'FOX 3 — PHOENIX AWAY!' : wpn === 'aim7' ? 'FOX 1 — SPARROW AWAY, KEEP THE LOCK!' : 'FOX 3!', 'good');
        P._syncVisual(0, {});
      }
    }
  }
  // gun trigger — the Vulcan doesn't ask for a lock either; mouse button or
  // holding SPACE with the gun selected, or the mouse trigger, both work
  const wantGatling = (G.input.trigger || G.input.down('Space')) && P.weapon === 'gun' && G.state === 'flying' && !P.dead && !P.ejected && P.stores.gun > 0;
  if (wantGatling) {
    gun.fire(dt, P, G.bandits);
    if (G.shotsFired === 0) G.shotsFired = 1;
  }
  G.audio.setGatling(wantGatling);
}

// ---------------- radar contacts ----------------
function updateRadarContacts() {
  const c = G.radarContacts;
  c.length = 0;
  for (const b of G.bandits) {
    if (b.dead || b.removeMe) continue;
    c.push({ pos: b.pos, kind: b.kind || 'bandit', identified: b.identified });
  }
  c.push({ pos: G.world.carrier.pos, kind: 'carrier' });
  // large hulls on the scope: warships, freighters, tankers, container ships,
  // the cruise liner — yachts and fishing boats are below the radar's notice
  for (const s of (G.world.ships ? G.world.ships.all : [])) {
    if ((s.len || 0) >= 100) c.push({ pos: s.pos, kind: 'ship' });
  }
  for (const m of G.missiles) if (!m.dead && m.target === G.player) c.push({ pos: m.pos, kind: 'missile' });
}

// ---------------- per-frame input handling ----------------
function handleDiscreteInput(dt) {
  const I = G.input, P = G.player;
  // N toggles the live map — works from the cockpit and the pause card
  if (I.pressed('KeyN') && (G.state === 'flying' || G.state === 'paused')) {
    G.msg(G.mapview.toggle() ? 'MAP ON' : 'MAP OFF', 'info');
  }
  // I toggles the mission objectives card — the typed brief, recallable mid-flight
  if (I.pressed('KeyI') && (G.state === 'flying' || G.state === 'paused')) {
    const card = $('obj-card');
    if (card.classList.contains('hidden')) {
      const def = G.missionDef || {};
      $('obj-title').textContent = (def.code ? def.code + ' — ' : '') + (def.title || 'FREE FLIGHT');
      $('obj-body').textContent = (def.brief && def.brief.length) ? def.brief.join('\n') : 'NO TASKING — THE SKY IS YOURS.';
      card.classList.remove('hidden');
    } else card.classList.add('hidden');
  }
  // map pan/zoom: drag the chart, wheel to zoom — the gun stays quiet while
  // the drag is on the chart
  if (G.mapview.on && (G.state === 'flying' || G.state === 'paused')) {
    G.mapview.interact(I);
    if (G.mapview.grabbing) I.trigger = false;
  }
  if (G.state !== 'flying') {
    G.audio.setGatling(false);   // cut the burst on pause/death/quit
    if (I.pressed('Slash')) { $('controls').classList.contains('hidden') ? G.openManual() : G.closeManual(); }
    else if ((I.pressed('Escape') || I.pressed('KeyP')) && G.state === 'paused') {
      if (!$('controls').classList.contains('hidden')) G.closeManual();   // ESC closes the manual first
      else togglePause();
    }
    // Q on the menu with a live sortie behind it: back into the cockpit.
    // polled here (not in the keydown router) so the same keypress can't be
    // seen twice and bounce straight back out to the menu
    else if (I.pressed('KeyQ') && G.state === 'menu' && G._menuResume) resumeFlight();
    else if (I.pressed('KeyQ') && (G.state === 'paused' || G.state === 'dead')) quitToMenu();
    return;
  }
  if (I.pressed('KeyQ')) { quitToMenu(); return; }
  if (I.pressed('Escape')) {
    // original behavior: ESC re-positions on the catapult during school / free flight
    if ((G.missionDef.id === 'qual' || G.missionDef.id === 'free' || G.missionDef.id[0] === 't') && !I.ab) {
      const id = G.missionDef.id, s = G.freeFlightStart;
      if (id === 'qual' || id[0] === 't' || s === 'carrier' || !s) G.setPlayerStart({ onCarrier: true });
      else if (s === 'sfo') G.setPlayerStart({ runway: G.world.runwayById('sfo') });
      else if (s === 'oakland') G.setPlayerStart({ runway: G.world.runwayById('oakland') });
      else if (s === 'moffett') G.setPlayerStart({ runway: G.world.runwayById('moffett') });
      else if (s === 'alameda') G.setPlayerStart({ runway: G.world.runwayById('alameda') });
      G.msg('RE-POSITIONED', 'info');
      return;
    }
    togglePause(); return;
  }
  if (I.pressed('KeyP') && !I.ab) { togglePause(); return; }
  if (I.pressed('KeyP') && I.ab) G.podDropRequested = true;
  // weapon select: ENTER cycles — the Amiga original's one key, one press per
  // weapon, no shortcuts; the voice callout says what's live
  const selW = (w) => { if (P.weapon !== w) { P.weapon = w; G.lockLevel = 0; G.audio.weaponSelect(P.weapon); } };
  // cycle order skips anything the jet doesn't carry (the A-10 has no AMRAAM)
  const wOrder = (P.type === 'f14' ? ['aim54', 'aim7', 'aim9', 'gun'] : ['aim120', 'aim9', 'gun'])
    .concat((P.stores.mk83 || 0) > 0 ? ['mk83'] : [])   // bombs ride the ring only when a mission loads them
    .filter(w => w === 'gun' || w === 'mk83' || (P.stores[w] || 0) > 0);
  if (I.pressed('Enter')) selW(wOrder[(wOrder.indexOf(P.weapon) + 1) % wOrder.length]);
  // S — swing the Tomcat's wings (spread <-> swept); noop for fixed wings
  if (I.pressed('KeyS') && P.type === 'f14') {
    P.sweepTarget = P.sweepTarget ? 0 : 1;
    G.msg(P.sweepTarget ? 'WINGS SWEPT — 68°' : 'WINGS SPREAD — 20°', 'info');
    G.audio.wingSweep();
  }
  if (I.pressed('KeyR')) {
    // longest to shortest, like a real scope stepping down — the Tomcat's
    // AWG-9 reaches a hundred miles; everyone else tops out at 40
    const ranges = P.type === 'f14'
      ? [[100, 100 * NM], [40, 40 * NM], [10, 10 * NM], [2, 2 * NM]]
      : [[40, 40 * NM], [10, 10 * NM], [2, 2 * NM]];
    const i = ranges.findIndex(r => r[0] === G.radarRangeNM);
    const [nm, m] = ranges[(i + 1) % ranges.length];
    G.radarRangeNM = nm; G.radarRange = m;
    G.msg(`RADAR RANGE — ${nm} MI`, 'info');
  }
  // original key set: G gear, H hook, B brake, Shift+E eject
  if (I.pressed('KeyG') || I.pressed('KeyL')) {
    if (P.gearDown && P.onGround) {
      G.msg('WEIGHT ON WHEELS — GEAR STAYS DOWN', 'warn');   // no belly drops
    } else {
      P.gearDown = !P.gearDown; G.audio.gear();
      if (P.gearDown && P.speedKts > 300) G.msg('GEAR OVERSPEED!', 'warn');
    }
  }
  if (I.pressed('KeyH') || I.pressed('KeyA')) {
    if (P.cfg.noBoat) G.msg('THE ' + P.cfg.label + ' HAS NO TAILHOOK', 'warn');
    else { P.hookDown = !P.hookDown; G.audio.hook(); }
  }
  if (I.pressed('KeyB')) { P.brakes = !P.brakes; }
  if (I.pressed('KeyY')) G.msg(I.mouseStick ? 'MOUSE STICK — CLICK THE SCREEN TO CAPTURE THE CURSOR, ESC RELEASES' : 'MOUSE STICK OFF', 'info');
  if (I.pressed('KeyM')) { P.ecm = !P.ecm; G.msg(P.ecm ? 'ECM ON — THEY SEE YOU TOO' : 'ECM OFF', 'info'); }
  if (I.pressed('KeyC') && P.stores.chaff > 0) { P.stores.chaff--; P.chaffT = G.time; G.audio.chaff(); for (let i = 0; i < 8; i++) G.fx.smoke(P.pos, 0.8, 3, 0xaaaaaa); }
  if (I.pressed('KeyF') && P.stores.flares > 0) { P.stores.flares--; P.flareT = G.time; G.audio.chaff(); for (let i = 0; i < 6; i++) G.fx.fire(_v.copy(P.pos).addScaledVector(P.vel, -0.03 * i), 0.6, 4); }
  if (I.pressed('KeyV')) {
    const order = ['cockpit', 'cockpitoff', 'chase', 'orbit', 'tower'];
    G.view = order[(order.indexOf(G.view) + 1) % order.length];
    G.specTarget = null; G.specOrbit = null; G.specMission = false;   // leaving spectate
  }
  // X — straight back to the cockpit from any view, no cycling
  if (I.pressed('KeyX') && (G.view !== 'cockpit' || G.specTarget)) { G.view = 'cockpit'; G.specTarget = null; G.specMission = false; G.msg('COCKPIT VIEW', 'info'); }
  // Z — time acceleration: 2x, 4x, 8x, 16x, then back to normal.
  // SHIFT+Z steps back down: 16x > 8x > 4x > 2x — same ring, both directions.
  if (I.pressed('KeyZ') && (G.state === 'flying' || G.state === 'dead')) {
    const _ts = [1, 2, 4, 8, 16];
    const _dir = (I.down('ShiftLeft') || I.down('ShiftRight')) ? -1 : 1;
    const _i = _ts.indexOf(G.timeScale);
    G.timeScale = _ts[(_i < 0 ? 0 : _i + _dir + _ts.length) % _ts.length];
    G.msg(G.timeScale > 1 ? `TIME ACCEL ${G.timeScale}X` : 'TIME ACCEL OFF', 'info');
  }
  // J — spectate: ride along with every other aircraft in the area, in turn.
  // airliners, MiGs, the defector, the wingman — everything on the scope.
  // J rides the next contact, SHIFT+J rides back to the previous one —
  // same ring, both directions, your own cockpit at the seam
  const cycleSpectate = (dir) => {
    // every rideable contact: bandits, traffic, and every hull in the bay —
    // nearest first, your own cockpit at the end of the cycle
    if (G.world && G.world.carrier && !G._carrierSpec) {
      const wc = G.world.carrier;
      G._carrierSpec = {
        get pos() { return wc.group.position; },
        fwd(out) { return out.set(Math.sin(wc.heading || 0), 0, -Math.cos(wc.heading || 0)); },
        get speed() { return wc.speed || 0; },
        name: 'USS ENTERPRISE', len: 342,
        get dead() { return false; }, get removeMe() { return false; },
      };
    }
    const others = [
      ...G.bandits.filter(b => !b.dead && !b.removeMe),
      ...(G.world && G.world.ships ? G.world.ships.all : []),
      ...(G.heliOps ? G.heliOps.helis : []),
      ...(G._carrierSpec ? [G._carrierSpec] : []),
    ].sort((a, b) => a.pos.distanceTo(P.pos) - b.pos.distanceTo(P.pos));
    if (!others.length) { G.specTarget = null; G.specMission = false; G.msg('NO CONTACTS IN THE AREA', 'info'); }
    else {
      const ring = others.length + 1;                       // contacts + your own cockpit
      const n = (others.indexOf(G.specTarget) + dir + ring) % ring;
      G.specTarget = n === others.length ? null : others[n];
      G.specMission = false;                                // J rides everyone — not a mission-cast ride
      if (!G.specTarget) G.specOrbit = null;   // back in your own cockpit — orbit resets
      G.msg(G.specTarget ? 'SPECTATING \u2014 ' + (G.specTarget.name || G.specTarget.vtype || G.specTarget.type || 'CONTACT').toUpperCase() + '  (J NEXT · SHIFT+J PREV)' : 'BACK IN YOUR OWN COCKPIT', 'info');
    }
  };
  if (I.pressed('KeyJ')) cycleSpectate((I.down('ShiftLeft') || I.down('ShiftRight')) ? -1 : 1);
  // K — mission spectate: the same ride-along camera as J, but the ring only
  // holds the cast of the sortie you're flying — your wingman, whatever the
  // brief sent up, and anything they launch (the Bear's Kh-55s board the ring
  // as they leave the rails). Airliners, the air wing and the rest of the
  // bay's ambient life stay out of the cycle. K next, SHIFT+K previous,
  // your own cockpit at the seam — same as J.
  const cycleMissionSpectate = (dir) => {
    if (!G.missionDef || G.missionDef.id === 'free') { G.msg('FREE FLIGHT — NO MISSION CAST. J RIDES EVERYONE', 'info'); return; }
    const cast = [
      ...G.bandits.filter(b => b.missionUnit && !b.dead && !b.removeMe),
      ...(G.world && G.world.ships ? G.world.ships.all.filter(v => v.missionUnit) : []),
    ].sort((a, b) => a.pos.distanceTo(P.pos) - b.pos.distanceTo(P.pos));
    if (!cast.length) { G.specTarget = null; G.specOrbit = null; G.specMission = false; G.msg('MISSION CAST IS GONE — BACK IN YOUR COCKPIT', 'info'); }
    else {
      const ring = cast.length + 1;                       // cast + your own cockpit
      const n = (cast.indexOf(G.specTarget) + dir + ring) % ring;
      G.specTarget = n === cast.length ? null : cast[n];
      G.specMission = !!G.specTarget;
      if (!G.specTarget) G.specOrbit = null;   // back in your own cockpit — orbit resets
      G.msg(G.specTarget ? 'MISSION SPECTATE — ' + (G.specTarget.name || G.specTarget.vtype || G.specTarget.type || 'CONTACT').toUpperCase() + '  (K NEXT · SHIFT+K PREV)' : 'BACK IN YOUR OWN COCKPIT', 'info');
    }
  };
  if (I.pressed('KeyK')) cycleMissionSpectate((I.down('ShiftLeft') || I.down('ShiftRight')) ? -1 : 1);
  // O — missile view: ride the newest round in flight, with the full spectate
  // camera (SHIFT+arrows / right-drag pan, wheel / [ ] zoom, 0 reframe). O
  // again cycles the rounds in the air, then hands you back your cockpit.
  if (I.pressed('KeyO')) {
    const live = (G.missiles || []).filter(m => !m.dead);
    if (!live.length) {
      if (G.specTarget && G.specTarget.cfg) { G.specTarget = null; G.specOrbit = null; G.specMission = false; G.msg('BACK IN YOUR OWN COCKPIT', 'info'); }
      else G.msg('NO MISSILES IN FLIGHT', 'info');
    } else {
      const cur = live.indexOf(G.specTarget);
      const n = (cur + 1) % (live.length + 1);
      G.specTarget = n === live.length ? null : live[n];
      G.specMission = false;
      G.msg(G.specTarget ? 'MISSILE VIEW — ' + G.specTarget.name + '  (O FOR NEXT / COCKPIT)' : 'BACK IN YOUR OWN COCKPIT', 'info');
    }
  }
  // U — HUD on/off, for clean screens and footage
  if (I.pressed('KeyU')) {
    G.hudOff = !G.hudOff;
    $('hud').style.display = G.hudOff ? 'none' : '';
    if (!G.hudOff) G.msg('HUD ON', 'info');
  }
  // spectated contact went down or left the area — back to your own jet
  if (G.specTarget && (G.specTarget.dead || G.specTarget.removeMe)) {
    G.specTarget = null; G.specOrbit = null; G.specMission = false; G.msg('CONTACT LOST — BACK IN YOUR COCKPIT', 'info');
  }
  // view magnification (the original's XMAG) — works in every view
  const XSTEPS = [1, 1.5, 2, 3, 4, 6, 8];
  if (I.pressed('Equal') || I.pressed('Minus')) {
    const i = XSTEPS.findIndex(x => x >= G.xmag - 0.01);
    G.xmag = XSTEPS[clamp(i + (I.pressed('Equal') ? 1 : -1), 0, XSTEPS.length - 1)];
    G.msg(`${G.xmag.toFixed(1)} XMAG`, 'info');
  }

  if (I.pressed('Slash')) { $('controls').classList.contains('hidden') ? G.openManual() : G.closeManual(); }
  // original: F10 twice at max throttle lights the burner
  if (I.pressed('F10') && P.throttle >= 0.99 && !P.abLatch) {
    P.abLatch = true; G.msg('AFTERBURNER', 'warn'); G.audio.radioClick();
  }
  // smoke trail (the original's training aid — S is throttle-down here, so D it is)
  if (I.pressed('KeyD')) { G.smokeTrail = !G.smokeTrail; G.msg(G.smokeTrail ? 'SMOKE TRAIL ON' : 'SMOKE TRAIL OFF', 'info'); }
  // original: keypad changes point of view / distance
  const povKeys = ['Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9', 'NumpadAdd', 'NumpadSubtract'];
  // while spectating the keypad talks to the spectate camera instead (updateCamera)
  if (!G.specTarget && povKeys.some(k => I.pressed(k))) G.view = 'orbit';
  // eject is Shift+E — plain E is safe to fat-finger; works parked on the
  // deck too — the seat catapult still throws the pilot clear of the jet
  if (I.pressed('KeyE') && (I.down('ShiftLeft') || I.down('ShiftRight')) && !P.ejected && G.state === 'flying') {
    P.ejected = true; P.dead = false;
    stats.ejection();
    P.stores.gun = 0;
    const cv = P.vel.clone();
    let deckY;
    if (P.onGround) {
      P._parkedEject = true;                     // the empty jet stays where it sits
      const og = P.onGround;
      if (og.type === 'carrier') {
        cv.copy(G.world.carrier.deckVelWorld(new THREE.Vector3()));
        cv.addScaledVector(_v.set(Math.sin(P.heading), 0, -Math.cos(P.heading)), og.speedRel);
        P._deckRide = P.deckLocal.clone();       // and keeps riding the ship
        deckY = P.pos.y - 2.2;
      } else {
        cv.set(Math.sin(P.heading) * og.speedRel, 0, -Math.cos(P.heading) * og.speedRel);
      }
      cv.y += 26;                                // seat charge lob
    }
    G.chute = new Chute(scene, P.pos, cv, deckY);   // the pilot floats down under a canopy
    G.audio.eject();                            // engine cuts to the sound of rushing air
    G.msg('EJECTED! THE JET IS GONE.', 'warn');
    // whatever the sortie, the pilot walks (or swims) home via the main menu
    G.state = 'dead'; G.deadT = 0; G.crashReason = 'EJECTED OVER HOSTILE WATERS';
  }
  if (I.throttleSet >= 0) P.throttle = I.throttleSet === 0 ? 1 : I.throttleSet;
  // original: keypad steers the external point of view (held keys move smoothly)
  if (G.view === 'orbit') {
    const orb = G.orbit;
    if (I.down('Numpad4')) { orb.yaw -= 1.6 * dt; orb.manual = true; }
    if (I.down('Numpad6')) { orb.yaw += 1.6 * dt; orb.manual = true; }
    if (I.down('Numpad8')) { orb.pitch = clamp(orb.pitch + 1.1 * dt, -0.05, 1.35); orb.manual = true; }
    if (I.down('Numpad2')) { orb.pitch = clamp(orb.pitch - 1.1 * dt, -0.05, 1.35); orb.manual = true; }
    if (I.down('NumpadAdd') || I.down('Numpad9')) { orb.dist = Math.max(18, orb.dist - 45 * dt); orb.manual = true; }
    if (I.down('NumpadSubtract') || I.down('Numpad3')) { orb.dist = Math.min(240, orb.dist + 45 * dt); orb.manual = true; }
  }
  // original training aid: continuous white smoke trail
  if (G.smokeTrail && !P.onGround && !P.dead) {
    G._smokeT = (G._smokeT || 0) - dt;
    if (G._smokeT <= 0) {
      G._smokeT = 0.05;
      for (const sgn of [-1, 1]) {
        _v.set(sgn * 4.3, 0.25, -1.2).applyQuaternion(P.quat).add(P.pos);
        G.fx.smoke(_v, 2.2, 1.6, 0xf0f0f0);
      }
    }
  }
}

// ---------------- scripted input (headless testing / attract mode) ----------------
let SCRIPT = null, scriptT = 0;
function runScript(dt) {
  if (G.state !== 'flying') return;   // wait out the intro zoom — the clock and
                                      // the teleports only run once airborne
  scriptT += dt;
  const _wlogEnd = window.__wlog ? (tag) => {
    if (window.__wlog.length < 4000) {
      const P = G.player;
      const f = P.fwd;
      window.__wlog.push([+G.time.toFixed(2), tag, Math.round(P.pos.x), Math.round(P.pos.y), Math.round(P.pos.z), P.onGround ? 'og' : 'air', Math.round(P.speed), +G.input.pitch.toFixed(2), +G.input.roll.toFixed(2), Math.round(P.vel.y), +f.x.toFixed(2), +f.y.toFixed(2), +f.z.toFixed(2)]);
    }
  } : null;
  const I = G.input, P = G.player;
  const _right = new THREE.Vector3(1, 0, 0).applyQuaternion(P.quat);
  const _upY = new THREE.Vector3(0, 1, 0).applyQuaternion(P.quat).y;
  const bankNow = Math.atan2(-_right.y, _upY);
  // plant sign: +I.roll = RIGHT bank = bankNow DECREASES, so the wings-level
  // loop needs (desBank + bankNow) to close negative feedback — with the plain
  // difference the controller rolled the jet through inverted on every approach
  const rollTo = (desBank) => clamp((desBank + bankNow) * 1.6 - P.rollRate * 0.5, -0.55, 0.55);
  if (SCRIPT === 'takeoff') {
    if (scriptT < 0.5) return;
    I.keys.add('KeyW');                       // full power
    if (scriptT > 1.0 && P.brakes) I.justPressed.add('KeyB');
    if (scriptT > 1.2) I.keys.add('ShiftLeft'); // burner
    if (P.onGround && P.onGround.speedRel > 70) I.pitch = 0.85; // rotate
    if (!P.onGround) {
      I.keys.delete('ShiftLeft');
      const gamma = Math.asin(clamp(P.vel.y / Math.max(P.speed, 1), -1, 1));
      I.pitch = clamp((0.17 - gamma) * 3.5, -0.4, 0.8);  // hold ~10 deg climb
      if (P.gearDown && P.pos.y > 40 && !runScript._gear) { runScript._gear = true; I.justPressed.add('KeyL'); }
      if (scriptT > 30) I.roll = rollTo(0.5);  // gentle turn back
    }
  } else if (SCRIPT === 'trap' || SCRIPT === 'land') {
    // precision approach autopilot: PD-steer onto a 3.5° glideslope to the
    // wires (carrier) or the numbers (runway), used for the tutorial reels
    const isTrap = SCRIPT === 'trap';
    const NMg = 1852;
    const glideTan = Math.tan(3.5 * Math.PI / 180);
    let aimX, aimY, aimZ, ax, az, headDeg;
    if (isTrap) {
      const C = G.world.carrier;
      const ch = Math.cos(C.heading), sh = Math.sin(C.heading);
      aimX = C.group.position.x - ch * C.ols.aim.x + sh * C.ols.aim.z;
      aimY = C.group.position.y + C.deckY;
      aimZ = C.group.position.z - sh * C.ols.aim.x - ch * C.ols.aim.z;
      ax = -ch * C.ols.ax + sh * C.ols.az; az = -sh * C.ols.ax - ch * C.ols.az;
    } else {
      const rw = G.world.runways.find(r => r.id === 'sfo');
      ax = Math.sin(rw.hdg); az = -Math.cos(rw.hdg);
      aimX = rw.x - ax * (rw.len / 2 - 300); aimY = rw.elev + 2; aimZ = rw.z - az * (rw.len / 2 - 300);
    }
    const relX = P.pos.x - aimX, relZ = P.pos.z - aimZ;
    const along = relX * ax + relZ * az;            // - = behind the aim point
    const range = Math.max(1, -along);
    if (!runScript._init) {
      runScript._init = true;
      // teleport onto final, configured, on speed — above the 95 m/s stall,
      // slow enough that deck-relative speed stays under the 105 trap limit
      const r0 = isTrap ? 3400 : 4200;
      const spd0 = isTrap ? 106 : 104;
      G.setPlayerStart({
        pos: new THREE.Vector3(aimX - ax * r0, aimY + glideTan * r0 + 2, aimZ - az * r0),
        heading: Math.atan2(ax, -az), speed: spd0,
      });
      P.vel.y = -spd0 * glideTan;
      P.gearDown = true; if (isTrap) P.hookDown = true;
      I.keys.delete('ShiftLeft');
    }
    if (P.onGround) {   // trapped or rolling out: hands off, ride it out
      I.pitch = 0; I.roll = 0; I.keys.delete('KeyW'); I.keys.delete('ShiftLeft');
      if (!P.onGround.trapped && !isTrap) { P.brakes = true; P.throttle = 0; }
      if (isTrap && !P.onGround.trapped) {   // bolter — go around and re-enter
        I.keys.add('KeyW'); I.keys.add('ShiftLeft'); P.brakes = false;
        if (!P.onGround) runScript._init = false;
      }
      return;
    }
    if (isTrap && along > 50) { runScript._init = false; return; }   // over the ramp untrapped — wave off and re-enter final
    // steer at a point 900 m ahead on the corridor, on the glidepath
    const lead = Math.max(0, range - 900);
    const tx = aimX - ax * lead, ty = aimY + glideTan * lead, tz = aimZ - az * lead;
    const d = new THREE.Vector3(tx - P.pos.x, 0, tz - P.pos.z);
    const f = P.fwd;
    const desiredH = Math.atan2(d.x, -d.z), curH = Math.atan2(f.x, -f.z);
    const dh = wrapAngle(desiredH - curH);
    I.roll = rollTo(clamp(dh * 1.3, -0.5, 0.5));
    // vertical channel: glidepath error from the CURRENT position + sink-rate
    // feedforward (the old lead-point bias let altitude error accumulate — the
    // jet crossed the ramp 27 m high on every pass). Carrier: no flare, fly
    // the ball into the wires; runway: flare to a gentle 1.2 m/s kiss.
    // anchor the path one gear-height above the wires: pos.y is the jet's
    // center, so an unraised path touches down gearH/glideTan (~25-50 m)
    // SHORT of the aim point every time — a guaranteed bolter
    const yErr = (aimY + 3.0 + glideTan * range) - P.pos.y;   // + = low, - = high
    let vyDes = clamp(-glideTan * Math.max(P.speed, 60) + yErr * 0.25, -10, 5);
    if (!isTrap && range < 500) vyDes = -1.2;
    let pi = clamp(dh * 0.6, -0.3, 0.3) + clamp((vyDes - P.vel.y) * 0.09, -0.5, 0.55);
    I.pitch = clamp(pi, -0.5, 0.6);
    // on-speed with direct throttle nudges
    const spdDes = isTrap ? 106 : 104;
    P.throttle = clamp(P.throttle + (spdDes - P.speed) * 0.006, 0.25, 1);
  } else if (SCRIPT === 'bridge') {
    // low pass under the Golden Gate center span
    if (!runScript._init) {
      runScript._init = true;
      G.setPlayerStart({ pos: new THREE.Vector3(4500, 72, 0), heading: Math.PI * 1.5, speed: 180 });
      P.throttle = 0.5;
      I.keys.add('KeyW'); I.keys.delete('ShiftLeft');
    }
    if (P.pos.x > 250) {   // inbound: hold 45 m over the water, centered on z 0
      const zErr = 0 - P.pos.z;
      I.roll = rollTo(clamp(-zErr * 0.004, -0.35, 0.35));
      const vyDes = clamp((45 - P.pos.y) * 0.25, -8, 8);
      I.pitch = clamp((vyDes - P.vel.y) * 0.09, -0.4, 0.4);
      if (P.pos.x < 600) runScript._minY = Math.min(runScript._minY || 9999, P.pos.y);
    } else if (!runScript._through) {   // through the span — victory pull
      runScript._through = true;
    }
    if (runScript._through) {
      I.pitch = 0.55; I.roll = rollTo(0);
      if (P.pos.y > 400) {
        const gamma2 = Math.asin(clamp(P.vel.y / Math.max(P.speed, 1), -1, 1));
        I.pitch = clamp((0.05 - gamma2) * 3, -0.4, 0.5);
      }
    }
  } else if (SCRIPT === 'intercept') {
    // scramble against a heavy bogey: find it, join up, form on the wing
    if (!runScript._init) {
      runScript._init = true;
      G.setPlayerStart({ pos: new THREE.Vector3(10000, 1500, 24000), heading: Math.PI * 0.5, speed: 260 });
      P.throttle = 0.8;
      const bg = G.spawnAI('b744', {
        pos: new THREE.Vector3(20000, 1700, 24000), heading: Math.PI * 0.5, speed: 220,
        name: 'ALLIED 412', label: 'ALLIED', livery: 0, mode: 'route', noEvade: true,
        waypoints: [new THREE.Vector3(80000, 1700, 24000)],   // eastbound, away from us
      });
      bg.kind = 'airliner'; bg.identified = false; runScript._bogey = bg;
      G.playerTarget = bg; G.lockLevel = 0;
    }
    const bg = runScript._bogey;
    if (!bg || bg.dead) { I.pitch = 0; I.roll = 0; return; }
    // station: 140 m abeam the bogey's right wing, slightly back
    const st = new THREE.Vector3(140, 0, 40).applyQuaternion(bg.quat).add(bg.pos);
    const d = st.clone().sub(P.pos);
    const dist = d.length();
    if (dist > 900) {   // convert: lead-pursuit like the combat script
      const aim = bg.pos.clone().addScaledVector(bg.vel, clamp(dist / 300, 0, 8));
      const dd = aim.sub(P.pos); dd.normalize();
      const f = P.fwd;
      const desiredH = Math.atan2(dd.x, -dd.z), curH = Math.atan2(f.x, -f.z);
      const dh = wrapAngle(desiredH - curH);
      const gamma = Math.asin(clamp(P.vel.y / Math.max(P.speed, 1), -1, 1));
      I.roll = rollTo(clamp(dh * 1.5, -0.7, 0.7));
      const gammaDes = clamp(Math.asin(clamp(dd.y, -1, 1)), -0.3, 0.3);
      I.pitch = clamp(dh * 0.8, -0.35, 0.35) + clamp((gammaDes - gamma) * 1.2, -0.3, 0.3);
      if (P.speed < 320) { I.keys.add('KeyW'); I.keys.delete('KeyS'); } else { I.keys.delete('KeyW'); }
      if (dist > 6000 && P.speed < 340) I.keys.add('ShiftLeft'); else I.keys.delete('ShiftLeft');
    } else {   // in close: slide onto the wing and match speed
      d.normalize();
      const f = P.fwd;
      const desiredH = Math.atan2(d.x, -d.z), curH = Math.atan2(f.x, -f.z);
      const dh = wrapAngle(desiredH - curH);
      const gamma = Math.asin(clamp(P.vel.y / Math.max(P.speed, 1), -1, 1));
      I.roll = rollTo(clamp(dh * 1.1, -0.4, 0.4));
      const gammaDes = clamp(Math.asin(clamp(d.y, -1, 1)), -0.2, 0.2);
      I.pitch = clamp(dh * 0.7, -0.25, 0.25) + clamp((gammaDes - gamma) * 1.4, -0.25, 0.25);
      I.keys.delete('ShiftLeft');
      const spdErr = bg.speed - P.speed;
      if (spdErr > 3) { I.keys.add('KeyW'); I.keys.delete('KeyS'); }
      else if (spdErr < -3) { I.keys.add('KeyS'); I.keys.delete('KeyW'); }
      else { I.keys.delete('KeyW'); I.keys.delete('KeyS'); }
      if (dist < 60 && !runScript._joined) { runScript._joined = G.time; }
    }
  } else if (SCRIPT === 'acro') {
    // airshow over the bay: loop, aileron roll, Immelmann — deterministic
    // clock, closed on the nose vector (gamma lies at low speed) with the
    // roll integrated — bankNow wraps at ±π so it can never time a figure
    runScript._pt += dt;
    if (!runScript._init) {
      runScript._init = true; runScript._phase = 0; runScript._pt = 0; runScript._rollAcc = 0;
      G.setPlayerStart({ pos: new THREE.Vector3(9000, 1300, 6000), heading: Math.PI * 1.5, speed: 320 });
      P.throttle = 1;
      I.keys.add('KeyW'); I.keys.add('ShiftLeft');
    }
    const ph = runScript._phase, t = runScript._pt;
    const fwY = P.fwd.y;
    runScript._rollAcc = (runScript._rollAcc || 0) + P.rollRate * dt;
    const next = () => { runScript._phase++; runScript._pt = 0; runScript._rollAcc = 0; };
    if (ph === 0) { I.pitch = 0; I.roll = 0; if (t > 2) next(); }                                         // show pass
    else if (ph === 1) { I.pitch = 0.7; if (fwY > 0.95 || t > 5) next(); }                                // loop: up over vertical
    else if (ph === 2) { I.pitch = 0.55; if (fwY < -0.75 || t > 14) next(); }                             // through the top, down the hill
    else if (ph === 3) { I.pitch = clamp((0.05 - fwY) * 1.6, -0.35, 0.45); I.roll = 0; if (Math.abs(fwY) < 0.1 || t > 8) next(); }  // level out
    else if (ph === 4) { I.pitch = 0.1; I.roll = 0.9; if (Math.abs(runScript._rollAcc) > 5.8 || t > 4) next(); }                  // aileron roll
    else if (ph === 5) { I.roll = 0; I.pitch = clamp((0.08 - fwY) * 1.2, -0.3, 0.6); if (t > 2) next(); }                         // wings level
    else if (ph === 6) { I.pitch = 0.7; if (fwY > 0.9 || t > 4) next(); }                                 // Immelmann up
    else if (ph === 7) { I.pitch = 0.15; I.roll = 0.9; if (Math.abs(runScript._rollAcc) > 2.8 || t > 2.5) next(); }               // half-roll out on top
    else { I.roll = 0; I.pitch = clamp((0.1 - fwY) * 1.2, -0.3, 0.6); I.keys.delete('ShiftLeft'); }                             // cruise off
    if (P.pos.y < 250 && P.vel.y < 0) { I.pitch = 0.55; I.roll = rollTo(0); }                             // floor
  } else if (SCRIPT === 'combat') {
    if (P.onGround) { // do the takeoff first
      if (scriptT < 0.5) return;
      I.keys.add('KeyW');
      if (scriptT > 1.0 && P.brakes) I.justPressed.add('KeyB');
      if (scriptT > 1.2) I.keys.add('ShiftLeft');
      if (P.onGround && P.onGround.speedRel > 70) I.pitch = 0.85;
      return;
    }
    const gamma = Math.asin(clamp(P.vel.y / Math.max(P.speed, 1), -1, 1));
    if (!G.playerTarget && !runScript._sel) { runScript._sel = true; I.justPressed.add('KeyT'); }
    const t = G.playerTarget;
    if (t && !t.dead) {
      // lead pursuit: aim ahead of the target so the geometry collapses
      // instead of trailing a maneuvering bandit forever
      const aim = t.pos.clone().addScaledVector(t.vel, clamp(t.pos.distanceTo(P.pos) / 300, 0, 8));
      const d = aim.sub(P.pos);
      const dist = d.length(); d.normalize();
      const f = P.fwd;
      const desiredH = Math.atan2(d.x, -d.z), curH = Math.atan2(f.x, -f.z);
      const dh = wrapAngle(desiredH - curH);
      // energy management: this flight model turns fastest near corner speed
      // (~130-160 m/s), so slow down to fight, burn to close distance
      const cornering = Math.abs(dh) > 0.7;
      if (cornering) {
        I.keys.delete('ShiftLeft'); I.keys.add('KeyS');
        if ((P.speed > 165) !== P.brakes) I.justPressed.add('KeyB');
      } else {
        I.keys.add('KeyW');
        if (P.brakes) I.justPressed.add('KeyB');
        if (dist > 4000 || P.speed < 160) I.keys.add('ShiftLeft'); else I.keys.delete('ShiftLeft');
      }
      // when the target is off the nose, pull UNCONDITIONALLY — any gamma
      // trim applied here creates a feedback equilibrium that parks the turn
      I.roll = rollTo(clamp(dh * 1.5, -0.75, 0.75));
      let pi;
      if (cornering) {
        pi = 0.55;
        if (gamma > 0.7) pi = 0.2;        // bound the loop, keep turning
        else if (gamma < -0.7) pi = 0.35;
      } else {
        const gammaDes = clamp(Math.asin(clamp(d.y, -1, 1)), -0.4, 0.3);
        pi = clamp(dh * 0.9, -0.4, 0.4) + clamp((gammaDes - gamma) * 0.8, -0.15, 0.15);
        if (gamma > 0.35) pi -= (gamma - 0.35) * 2.0;
        if (gamma < -0.6) pi = Math.max(pi, 0.25);
      }
      if (P.pos.y < 350 && gamma < 0) pi = 0.5;       // ground floor
      if (P.speed < 120) pi = clamp(pi, -0.2, 0.15);  // stall guard
      I.pitch = clamp(pi, -0.7, 0.7);
      if (G.locked && scriptT > 4) { I.justPressed.add('Space'); scriptT = 3.0; }
    } else {
      I.pitch = clamp((0.05 - gamma) * 3.5, -0.5, 0.5);
      I.roll = rollTo(0);
      I.keys.add('KeyW'); I.keys.delete('ShiftLeft');
      runScript._sel = false;
    }
  }
  if (_wlogEnd) _wlogEnd(SCRIPT);
}

// ---------------- main loop ----------------
const clock = new THREE.Clock();
let acc = 0;

let FIXDT = 0;
function frame() {
  requestAnimationFrame(frame);
  const rawDt = FIXDT > 0 ? FIXDT : Math.min(clock.getDelta(), 0.05);
  const dt = G.state === 'paused' ? 0 : rawDt;

  if (FIXDT > 0 && !window.__warped) {
    // headless warp handled at boot; nothing here
  }
  stepGame(dt);
  // lightning struck this frame: flash already painted — now the thunder
  if (G.world.thunderDist) { G.audio.thunder(G.world.thunderDist); G.world.thunderDist = 0; }
  updateCamera(dt * ((G.state === 'flying' || G.state === 'dead') ? G.timeScale : 1));
  if (!G._skipRender) renderer.render(scene, camera);
  G._skipRender = false;
  G.input.postUpdate();
  if (qsTimer > 0) {
    qsTimer -= rawDt;
    if (qsTimer <= 0 || G.state !== 'flying') hideQuickstart();
  }
  if (window.__probeFrames !== undefined && --window.__probeFrames <= 0) {
    delete window.__probeFrames;
    const rc = new THREE.Raycaster(), hits = [];
    for (const ny of [-0.2, -0.4, -0.6]) {
      rc.setFromCamera(new THREE.Vector2(0, ny), camera);
      hits.push({ ny, list: rc.intersectObjects(scene.children, true).slice(0, 3).map(h2 => ({ d: Math.round(h2.distance), y: Math.round(h2.point.y), t: h2.object.geometry ? h2.object.geometry.type : h2.object.type, col: h2.object.material && h2.object.material.color ? h2.object.material.color.getHexString() : null })) });
    }
    // depth-buffer capture: render with a depth-override material, read back
    // and decode true fragment depths at probe pixels
    let depth = null;
    try {
      const W2 = 320, H2 = 180;
      const rt = new THREE.WebGLRenderTarget(W2, H2);
      const prev = scene.overrideMaterial;
      scene.overrideMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      renderer.setRenderTarget(rt); renderer.render(scene, camera);
      const buf = new Uint8Array(W2 * H2 * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, W2, H2, buf);
      renderer.setRenderTarget(null); scene.overrideMaterial = prev; rt.dispose();
      const n = camera.near, f = camera.far;
      depth = [];
      for (const [fx, fy] of [[0.5, 0.30], [0.5, 0.46], [0.5, 0.52], [0.5, 0.60], [0.5, 0.68], [0.2, 0.60], [0.8, 0.60]]) {
        const px = Math.floor(fx * W2), py = Math.floor((1 - fy) * H2), i = (py * W2 + px) * 4;
        const r = buf[i] / 255, g = buf[i + 1] / 255, b2 = buf[i + 2] / 255, a = buf[i + 3] / 255;
        const z01 = r + g / 255 + b2 / 65025 + a / 16581375;
        const zndc = 2 * z01 - 1;
        const dist = (2 * n * f) / (f + n - zndc * (f - n));
        depth.push({ at: [fx, fy], z01: Math.round(z01 * 10000) / 10000, m: Math.round(dist) });
      }
    } catch (e) { depth = String(e); }
    const objs = [];
    scene.traverse(o => {
      if (!o.isMesh && !o.isSprite) return;
      const m = o.material || {};
      objs.push({ n: o.name || '', t: o.geometry ? o.geometry.type : o.type, vis: o.visible, ro: o.renderOrder,
        p: o.getWorldPosition(new THREE.Vector3()).toArray().map(v => Math.round(v)),
        s: o.scale.toArray().map(v => Math.round(v * 100) / 100),
        col: m.color ? m.color.getHexString() : null, op: m.opacity, tr: !!m.transparent, dw: m.depthWrite !== false, dt: m.depthTest !== false,
        fog: m.fog !== false, vc: !!m.vertexColors, side: m.side, po: m.polygonOffset || false });
    });
    // live material uniform state for the ocean (the actual uploaded fog values)
    let oceanU = null;
    try {
      const wm = G.world.waterMat;
      const props = renderer.properties.get(wm);
      oceanU = { fog: wm.fog, color: wm.color.getHexString(),
        fogNear: props.uniforms && props.uniforms.fogNear ? props.uniforms.fogNear.value : null,
        fogFar: props.uniforms && props.uniforms.fogFar ? props.uniforms.fogFar.value : null,
        fogColor: props.uniforms && props.uniforms.fogColor ? props.uniforms.fogColor.value : null,
        version: wm.version, hasProgram: !!props.currentProgram };
    } catch (e) { oceanU = String(e); }
    const d = document.createElement('div'); d.id = 'probe'; d.style.display = 'none';
    d.textContent = JSON.stringify({ cam: { pos: camera.position.toArray().map(v => Math.round(v)), near: camera.near, far: camera.far }, fog: { c: scene.fog.color.getHexString(), n: scene.fog.near, f: scene.fog.far }, info: renderer.info.render, oceanU, depth, hits, objs });
    document.body.appendChild(d);
  }
  // the MANUAL button is only offered while flying (or paused), manual closed
  $('manual-btn').classList.toggle('hidden',
    !((G.state === 'flying' || G.state === 'paused') && $('controls').classList.contains('hidden')));
  if (FIXDT > 0) {
    const Pf = G.player.fwd;
    const hdg = Math.round(((Math.atan2(Pf.x, -Pf.z)) * 180 / Math.PI + 360) % 360);
    const rr = new THREE.Vector3(1, 0, 0).applyQuaternion(G.player.quat);
    const tgts = G.bandits.filter(b => !b.dead && (b.kind === 'bandit' || b.kind === 'stolen')).length;
    const _gm = Math.asin(clamp(G.player.vel.y / Math.max(G.player.speed, 1), -1, 1)) * 57.3;
    let _ly = 0, _lz = 0, _bk = 0, _tn = '-', _dy = 0, _ds = 0, _ty = 0;
    if (G.playerTarget) {
      const _dw = G.playerTarget.pos.clone().sub(G.player.pos);
      _ds = _dw.length(); _dy = _dw.y; _ty = G.playerTarget.pos.y;
      _tn = (G.playerTarget.label || G.playerTarget.name || '?').slice(0, 6);
      const _d = _dw.normalize().applyQuaternion(G.player.quat.clone().invert());
      _ly = _d.y; _lz = _d.z;
      const _r = new THREE.Vector3(1, 0, 0).applyQuaternion(G.player.quat);
      const _uy = new THREE.Vector3(0, 1, 0).applyQuaternion(G.player.quat).y;
      _bk = Math.atan2(-_r.y, _uy) * 57.3;
    }
    document.title = `T${G.time.toFixed(1)} SPD${Math.round(G.player.speedKts)} HDG${hdg} Y${Math.round(G.player.pos.y)} GM${_gm.toFixed(0)} PI${G.input.pitch.toFixed(2)} RI${G.input.roll.toFixed(2)} RR${G.player.rollRate.toFixed(2)} LY${_ly.toFixed(2)} LZ${_lz.toFixed(2)} BK${_bk.toFixed(0)} TG${_tn} DY${Math.round(_dy)} DS${Math.round(_ds)} TY${Math.round(_ty)} K${G.kills} L${G.lockLevel.toFixed(2)} ${G.state}`;
  }
}

// spectate audio: what engine does the ridden contact have?
function specSoundKind(s) {
  if (s.kind === 'heli') return 'prop';         // rotor whirr (checked first — helos carry a len for the camera)
  const ty = s.type || (s.def && s.def.type) || '';   // air-wing frames keep it on .def
  if (/^(e2c|c2|p3)$/.test(ty)) return 'prop';
  // airliners, the S-3 and the A-10 (twin TF34s) sing the turbofan whine
  if (s.kind === 'airliner' || /^(b747|b744|b737|dc10|md90|b707|cruise|s3|a10)$/.test(ty)) return 'turbofan';
  if (s.cfg) return null;                       // missiles
  if (s.len && !s.model) return null;           // vessels & the carrier (aircraft all carry a model)
  return 'jet';
}
function specSoundRpm(s) {
  const ref = s.kind === 'heli' ? 55 : s.kind === 'airliner' ? 240 : 260;
  return clamp((s.speed || 0) / ref, 0.18, 1);
}

function stepGame(dt) {
  G.input.poll();
  if (SCRIPT) runScript(dt);
  handleDiscreteInput(dt);
  // the pinned showroom hero stays hidden while the reel runs — the scenes
  // themselves rotate the cast (F-14, F-16, A-10, MiG-29, carrier, bridge)
  for (let i = 0; i < heroes.length; i++) heroes[i].visible = false;

  if (G.state === 'menu' && demoDir) {
    heroLight.intensity = 60 * (G.world.night01 || 0);   // lit after dark
    if (!G._menuResume) {
      G.time += dt;
      demoDir.update(dt);
      G.world.update(dt, camera.position, G.player ? G.player.pos.y : camera.position.y);
      G.fx.update(dt);
    }
    // else: PAUSED BEHIND THE MENU — a live sortie is waiting on the Q key,
    // so the whole simulation freezes: no game clock, no world drift (the
    // carrier stays exactly where the approach left it), no demo flight.
  } else if (G.intro.active) {
    // satellite map / briefing / plane select / zoom intro states — suppress
    // the weather here so rain and murk never blot out the planning map
    G.time += dt;
    if (G.state === 'zoom' && G.player) {
      G.player.update(dt, G.input, G);
      for (const b of G.bandits) b.update(dt, G);
    }
    G.intro.update(dt);
    G.world.update(dt, camera.position, G.player ? G.player.pos.y : camera.position.y, null, true);
    G.fx.update(dt);
    hud.draw(G, dt);
  } else if (false) {
    hud.draw(G, dt);
  } else if (G.state === 'flying' || G.state === 'dead') {
    // time acceleration: the flying world steps G.timeScale times per frame
    // (discrete input already ran once at the top of stepGame)
    if (G.state === 'flying') stats.addFlight(dt);   // wall-clock seconds, once per frame — never scaled
    for (let _sub = 0, _subs = (G.timeScale > 1 ? G.timeScale : 1); _sub < _subs; _sub++) {
    G.time += dt;
    G.shakeT = Math.max(0, G.shakeT - dt * 1.3);
    const P = G.player;
    if (G.state === 'flying') {
      P.update(dt, G.input, G);
      P.groundH = groundHeight(P.pos.x, P.pos.z);
      // runway landing detection -> landed flag
      if (P.onGround && P.onGround.type === 'runway' && P.onGround.speedRel === 0 && !G.landedThisSortie) G.landedThisSortie = true;
      updateTargeting(dt);
      if (G.mission && G.mission.update && !G.over) {
        G._castFlag = true;                  // mid-sortie spawns (the Bear's Kh-55s…) join the cast too
        try { G.mission.update(G, dt); } finally { G._castFlag = false; }
      }
      // RTB watch: parked (full stop) at the point of origin closes the sortie;
      // down anywhere else is a hot pit, not a victory — say so now and then
      if (G.rtb && !G.over) {
        const o = G.missionOrigin;
        G.waypoint = o.kind === 'carrier' ? G.world.carrier.pos : o.pos;
        const og = P.onGround;
        if (og && og.speedRel === 0) {
          const home = (o.kind === 'carrier' && og.type === 'carrier') ||
                       (o.kind === 'runway' && og.type === 'runway' && og.rw.name.replace(/\s+\S+$/, '') === o.ap);
          if (home) {
            const r = G.rtb; G.rtb = null;
            G.msg('BACK WHERE SHE BEGAN — SORTIE COUNTS', 'good');
            G._finishMission(r.title, r.text);
          } else if (G.time - G._rtbNudge > 25) {
            G._rtbNudge = G.time;
            G.msg(`DOWN SAFE — BUT ${o.label} IS WHERE THIS SORTIE ENDS`, 'warn');
          }
        }
      }
      // mission pod flag consumed by mission update
    } else {
      // dead: let the wreck fall
      if (P.dead && !G.crashHandled) P._updateDead(dt, G);
      else if (P.ejected) P._updateBallistic(dt, G);
      G.deadT += dt;
      if (G.deadT > (G.chute ? 9 : 3) && !G.over) {   // let the wreck / chute ride play out
        // then it's straight back to the menu — no paperwork, no debrief…
        // …but the tower would still like a word: quick poll on the way out
        save.best = Math.max(save.best, G.score); persist();
        if (fbActive()) { G.over = true; fbOfferCrash(); }   // over=true: offer once, don't stomp the pilot's answer
        else quitToMenu();
      }
    }
    // entities
    if (G.chute) G.chute.update(dt, G);
    for (let i = G.bandits.length - 1; i >= 0; i--) {
      const b = G.bandits[i];
      b.update(dt, G);
      if (b.removeMe) { b.dispose(); G.bandits.splice(i, 1); }
    }
    if (G.traffic) G.traffic.update(dt);   // SFO airline movements, 24/7
    if (G.heliOps) G.heliOps.update(dt);
    if (G.p3) G.p3.update(dt);
    if (G.asw) G.asw.update(dt);        // the sub hunt: buoys, torps, dips
    if (G.shipWeapons) G.shipWeapons.update(dt);   // the frigate's missiles
    if (G.awacs) G.awacs.update(dt);
    if (G.wingman) {
      const wm = G.wingman;
      if (wm.state === 'PREFLIGHT' && G.state === 'flying' && !P.onGround && !P.dead && P.pos.y > 30) wm.launch();
      wm.update(dt);
    }
    for (let i = G.missiles.length - 1; i >= 0; i--) {
      const m = G.missiles[i];
      m.update(dt);
      if (m.dead) G.missiles.splice(i, 1);
    }
    gun.update(dt);
    // missile warning
    G.missileWarning = G.missiles.some(m => !m.dead && m.target === G.player);
    G.audio.setMissileWarn(G.missileWarning);
    G.audio.setStall(P.stalled && G.state === 'flying');
    // effects: damage smoke, contrails
    if ((P.damage > 55 || P.dead) && !P.ejected && Math.random() < 0.5) G.fx.smoke(P.pos, 1.1, 2.4, 0x2c2c2c);
    if (!P.onGround && !P.dead && (P.gForce > 5.5 || (P.ab && P.pos.y > 5000))) {
      P.contrailT -= dt;
      if (P.contrailT <= 0) {
        P.contrailT = 0.05;
        const r = _v.set(1, 0, 0).applyQuaternion(P.quat);
        G.fx.trail(_v2.copy(P.pos).addScaledVector(r, 6), 1.1, 0xffffff, 1.2);
        G.fx.trail(_v2.copy(P.pos).addScaledVector(r, -6), 1.1, 0xffffff, 1.2);
      }
    }
    G.world.update(dt, camera.position, G.player ? G.player.pos.y : camera.position.y, G.player ? G.player.vel : null);
    G.fx.update(dt);
    updateRadarContacts();
    // audio — once the pilot is out, the jet's engine stays silent for good
    G.audio.updateFlight(P.ejected ? 0 : P.throttle, !P.ejected && P.ab, P.ejected ? 0 : P.speed);
    if (_sub === _subs - 1) {
      hud.draw(G, dt);
      // spectate voice: play the engine of the aircraft the camera rides —
      // jets reuse the recorded loops, airliners a turbofan whine, E-2/C-2/
      // P-3 and the helos a prop whirr; ships and missiles stay silent
      const sp = G.specTarget && !G.specTarget.dead && !G.specTarget.removeMe ? G.specTarget : null;
      G.audio.specTick(sp ? specSoundKind(sp) : null, sp ? specSoundRpm(sp) : 0);
    }
    }
  } else if (G.state === 'paused') {
    hud.draw(G, 0);
  }
  syncNavLights(dt);
  if (G.world.carrier && G.world.carrier.ols) G.world.carrier.updateOLS(dt, G.player);
}

// navigation lights come on at night on every aircraft in the world — red and
// green position lights burn steady, the white tail strobe double-flashes and
// the red anti-collision beacon blinks, like the real jets
let navT = 0;
function syncNavLights(dt) {
  navT += dt;
  const night = G.world.night01 > 0.5;
  const set = (sp) => {
    sp.visible = night;
    if (!night) return;
    const role = sp.userData.role, ph = sp.userData.phase || 0, base = sp.userData.base || 3;
    if (role === 'strobe') {           // aviation double-flash: two 50 ms pops per second
      const c = (navT + ph) % 1;
      sp.scale.setScalar((c < 0.05 || (c > 0.12 && c < 0.17)) ? base : 0.001);
    } else if (role === 'beacon') {    // slower red blink
      const c = (navT * 0.9 + ph) % 1;
      sp.scale.setScalar(c < 0.09 ? base : 0.001);
    } else {
      sp.scale.setScalar(base);
    }
  };
  for (const e of [G.player, ...G.bandits, ...(demoDir ? demoDir.navJets() : [])]) {
    const nav = e && e.model && e.model.userData.nav;
    if (nav) for (const sp of nav) set(sp);
  }
}

// ---------------- URL stubs: every menu item is a link ----------------
// #menu #freeflight #missions #m1..#m7 #log #manual #resume
// #day #night #clear #clouds #rain #storm #blog #store #print
function routeHash() {
  const h = location.hash.replace(/^#\/?/, '').toLowerCase();
  if (!h) return;
  const atMenu = G.state === 'menu';
  if (h === 'menu') { if (!atMenu) quitToMenu(); else buildMenu('main'); return; }
  if (!atMenu) return;   // mid-sortie: don't yank the controls for a link click
  if (h === 'freeflight') startFreeFlightMap();
  else if (h === 'missions') buildMenu('missions');
  else if (/^m([1-9]|1[0-6])$/.test(h)) {
    // deep links respect the school gate and the campaign chain
    const i = MISSION_ORDER.indexOf(h);
    if (!schoolGrad() || (i > 0 && !save.done[MISSION_ORDER[i - 1]])) buildMenu('missions');
    else startBriefing(h);
  }
  else if (h === 'log') buildMenu('log');
  else if (h === 'school') buildMenu('school');
  else if (h === 'qual') startBriefing('t1');          // legacy link — the old qual is school T-1 now
  else if (/^t[1-7]$/.test(h)) {
    // deep links honour the syllabus too — locked sortie links land on the board
    const i = SCHOOL_ORDER.indexOf(h);
    if (i > 0 && !save.done[SCHOOL_ORDER[i - 1]]) buildMenu('school');
    else startBriefing(h);
  }
  else if (h === 'manual') G.openManual();
  else if (h === 'resume') { if (G._menuResume) resumeFlight(); }
  else if (h === 'day' || h === 'night') { G.dayNightSel = h; save.dayNight = h; save.dayNightForced = true; persist(); applyMenuTimeOfDay(); buildMenu('main'); }
  else if (['clear', 'clouds', 'rain', 'storm'].includes(h)) { G.weatherSel = h; save.weather = h; persist(); applyMenuWeather(); buildMenu('main'); }
  else if (['blog', 'store', 'print'].includes(h)) location.href = '/' + h;
}

// ---------------- URL params for direct launch (testing) ----------------
const params = new URLSearchParams(location.search);
FIXDT = parseFloat(params.get('fixdt') || '0');
SCRIPT = params.get('script');
if (params.get('wlog')) window.__wlog = [];   // warp instrumentation hook
if (params.get('night')) { G.dayNightSel = 'night'; save.dayNightForced = true; }   // test hook: force night
if (params.get('rain')) G.weatherSel = 'rain';      // test hook: force rain
if (params.get('storm')) G.weatherSel = 'storm';    // test hook: force storm
if (params.get('clouds')) G.weatherSel = 'clouds';  // test hook: force clouds
if (params.get('clean')) G.cleanShot = true;        // test hook: HUD-free captures
if (params.get('day')) { G.dayNightSel = 'day'; save.dayNightForced = true; }
showMenu();
const auto = params.get('auto');
const viewP = params.get('view');
if (viewP) G.view = viewP;
// intro-flow test hooks: ?auto=menu | map | brief:<id> | planesel:<id> | zoom:<id>
if (auto === 'menu') { /* stay on menu */ }
else if (auto === 'demo') { startDemo(true); }   // attract mode
else if (auto === 'map') { startFreeFlightMap(); }
else if (auto && auto.startsWith('brief:')) { startBriefing(auto.slice(6)); }
else if (auto && auto.startsWith('planesel:')) {
  const def = MISSIONS.find(m => m.id === auto.slice(9));
  pendingMission = def; $('menu').classList.add('hidden'); stopDemo(); G.intro.briefing(def, () => {});
  G.intro.typed = 1e9; G.intro.afterBrief = null; enterPlaneSelect(def);
}
else if (auto && auto.startsWith('zoom:')) {
  let zid = auto.slice(5);
  if (zid === 'qual') zid = 't1';   // the old qualification sortie is now school T-1
  const def = MISSIONS.find(m => m.id === zid);
  pendingMission = def; $('menu').classList.add('hidden'); stopDemo();
  // start the dive from the satellite-map camera, like the real menu flow
  G.camera.position.set(6000, 95000, 4000 + 95000 * 0.28);
  launchMission(def, { zoom: true });
}
else if (auto) {
  const plane = params.get('plane');
  if (plane) G.player.type = plane;
  const start = params.get('start');
  if (start) G.freeFlightStart = start;
  if (params.get('unlock') === '1') { save.qualified = true; save.done = { m1: true, m2: true, m3: true, m4: true, m5: true }; }
  launchMission(MISSIONS.find(m => m.id === auto) || MISSIONS[0]);
  const ppos = params.get('ppos');           // test teleport: ppos=x,z[,h]
  if (ppos) {
    const [px, pz, ph] = ppos.split(',').map(Number);
    G.setPlayerStart({ pos: new THREE.Vector3(px, ph || 800, pz), heading: params.get('phdg') ? Number(params.get('phdg')) * Math.PI / 180 : Math.PI / 2, speed: 180 });
  }
  const wpn0 = params.get('wpn');            // test hook: preselect weapon (must be on the jet's ring)
  if (wpn0 && G.player) {
    const ring = (G.player.type === 'f14' ? ['aim54', 'aim7', 'aim9', 'gun'] : ['aim120', 'aim9', 'gun'])
      .concat((G.player.stores.mk83 || 0) > 0 ? ['mk83'] : []);
    if (ring.includes(wpn0)) G.player.weapon = wpn0;
  }
  if (params.get('xray') === '1') {
    G.player.model.traverse(o => { if (o.material) { o.material = new THREE.MeshBasicMaterial({ color: 0xff0044 }); } });
    G.player.model.scale.setScalar(4);
  }
}
// arm the URL stubs: from here on the address bar tracks the menu, an
// incoming #link routes now (test ?auto hooks win over it), and live edits
// of the hash route on hashchange
hashRouting = true;
if (!auto) routeHash();
else setHash('menu');
window.addEventListener('hashchange', routeHash);
// ---- tutorial caption tracks: big step cards burned into rec= footage ----
// timed against scriptT (the warp clock) so captions always match the flying
const CAPTIONS = {
  takeoff: [
    { t0: 0.5, t1: 5, step: 'STEP 1 OF 4', lines: ['SPAWN ON THE CAT — SHUTTLE LOCKED, BRAKES ON'] },
    { t0: 5, t1: 10.5, step: 'STEP 2 OF 4', lines: ['FULL POWER: HOLD W — THEN SHIFT FOR BURNER'] },
    { t0: 10.5, t1: 15.5, step: 'STEP 3 OF 4', lines: ['BRAKES OFF (B) — THE CAT THROWS YOU AT 150+ KT'] },
    { t0: 15.5, t1: 22, step: 'STEP 4 OF 4', lines: ['ROTATE OFF THE DECK EDGE, GEAR UP (L), CLIMB AWAY'] },
  ],
  trap: [
    { t0: 0.5, t1: 6, step: 'STEP 1 OF 5', lines: ['THE PATTERN: 3 MILES BEHIND THE BOAT, 700 FT, ~150 KT'] },
    { t0: 6, t1: 13, step: 'STEP 2 OF 5', lines: ['CONFIGURE: GEAR DOWN (G), HOOK DOWN (H), FLAPS OF SPEED'] },
    { t0: 13, t1: 21, step: 'STEP 3 OF 5', lines: ['FLY THE MEATBALL — KEEP THE BALL ON THE 3.5° GLIDESLOPE'] },
    { t0: 21, t1: 30, step: 'STEP 4 OF 5', lines: ['AIM FOR THE WIRES — NEVER FLARE, NEVER CHOP THE POWER'] },
    { t0: 30, t1: 38, step: 'STEP 5 OF 5', lines: ['TRAP! WIRE CAUGHT — THROTTLE IDLE, WELCOME ABOARD'] },
  ],
  'runway-takeoff': [
    { t0: 0.5, t1: 5, step: 'STEP 1 OF 4', lines: ['LINE UP ON THE CENTERLINE — BRAKES HELD'] },
    { t0: 5, t1: 10, step: 'STEP 2 OF 4', lines: ['THROTTLE TO FULL (W), BURNER IF YOU LIKE — BRAKES OFF (B)'] },
    { t0: 10, t1: 15, step: 'STEP 3 OF 4', lines: ['AT 140 KT: GENTLE BACK STICK — FLY, DON\'T YANK'] },
    { t0: 15, t1: 21, step: 'STEP 4 OF 4', lines: ['POSITIVE CLIMB: GEAR UP (L), HOLD 10° NOSE-UP'] },
  ],
  land: [
    { t0: 0.5, t1: 6, step: 'STEP 1 OF 5', lines: ['SET UP 5 MILES OUT: 400 KT → 150 KT, WINGS LEVEL'] },
    { t0: 6, t1: 12, step: 'STEP 2 OF 5', lines: ['GEAR DOWN (G) — PICTURE: RUNWAY GROWS STEADILY, NO ZOOM'] },
    { t0: 12, t1: 19, step: 'STEP 3 OF 5', lines: ['HOLD 3.5° DOWN — SMALL THROTTLE NUDGES, NOT SAWING'] },
    { t0: 19, t1: 26, step: 'STEP 4 OF 5', lines: ['OVER THE NUMBERS: THROTTLE IDLE, FLARE — KISS THE TARMAC'] },
    { t0: 26, t1: 34, step: 'STEP 5 OF 5', lines: ['ROLLOUT: BRAKES (B), STAY ON THE CENTERLINE'] },
  ],
  combat: [
    { t0: 0.5, t1: 6, step: 'STEP 1 OF 5', lines: ['T PICKS THE NEAREST BOGEY — WATCH THE RADAR CONTACT'] },
    { t0: 6, t1: 13, step: 'STEP 2 OF 5', lines: ['CLOSE FAST: BURNER IN, THEN SPEEDBRAKE (B) TO THE FIGHT'] },
    { t0: 13, t1: 22, step: 'STEP 3 OF 5', lines: ['FIGHT AT CORNER SPEED ~300 KT — TURNS ARE WON HERE'] },
    { t0: 22, t1: 33, step: 'STEP 4 OF 5', lines: ['PULL LEAD, GROW THE LOCK TONE — FOX TWO ON THE MERGE'] },
    { t0: 33, t1: 48, step: 'STEP 5 OF 5', lines: ['SPLASH — CHECK SIX, RE-ENGAGE. NEVER FOLLOW A FIREBALL DOWN'] },
  ],
  bridge: [
    { t0: 0.5, t1: 5, step: 'STEP 1 OF 4', lines: ['LINE UP EAST OF THE GATE, CENTERED ON THE SPAN'] },
    { t0: 5, t1: 11, step: 'STEP 2 OF 4', lines: ['DOWN LOW: 150 FT OVER THE WATER, WINGS LEVEL'] },
    { t0: 11, t1: 18, step: 'STEP 3 OF 4', lines: ['STEADY THROTTLE — AIM BETWEEN THE TOWERS, NO RUDDER'] },
    { t0: 18, t1: 26, step: 'STEP 4 OF 4', lines: ['UNDER THE DECK! THEN PULL UP HARD AND OWN THE SKY'] },
  ],
  intercept: [
    { t0: 0.5, t1: 6, step: 'STEP 1 OF 5', lines: ['BOGEY ON THE SCOPE: T LOCKS THE NEAREST CONTACT'] },
    { t0: 6, t1: 14, step: 'STEP 2 OF 5', lines: ['CONVERT: BURNER TO CUT THE CORNER INSIDE HIS TURN'] },
    { t0: 14, t1: 24, step: 'STEP 3 OF 5', lines: ['EYES OUT THE HUD — CLOSE TO VISUAL RANGE, NO RADAR TRAIL'] },
    { t0: 24, t1: 34, step: 'STEP 4 OF 5', lines: ['JOIN THE WING: MATCH HIS SPEED, SLIDE IN GENTLY'] },
    { t0: 34, t1: 44, step: 'STEP 5 OF 5', lines: ['ON STATION — THIS IS AN AIRLINER. CHECK FIRE, ALWAYS'] },
  ],
  acro: [
    { t0: 0.5, t1: 5, step: 'FIGURE 1 — THE LOOP', lines: ['FULL POWER, THEN PULL 4G SMOOTHLY OVER THE TOP'] },
    { t0: 10, t1: 15, step: 'FIGURE 1 — THE LOOP', lines: ['IDLE DOWN THE BACK, RECOVER LEVEL AT YOUR ENTRY HEIGHT'] },
    { t0: 17, t1: 23, step: 'FIGURE 2 — AILERON ROLL', lines: ['NOSE 10° UP, FULL STICK — ROLL AROUND THE NOSE'] },
    { t0: 25, t1: 31, step: 'FIGURE 3 — IMMELMANN', lines: ['HALF LOOP UP, ROLL OUT ON TOP — TRADE SPEED FOR HEIGHT'] },
    { t0: 31, t1: 38, step: 'RECOVERY', lines: ['WINGS LEVEL, POWER BACK — THAT\'S THE WHOLE AIRSHOW'] },
  ],
};
function drawRecCaptions(ctx, t) {
  const track = CAPTIONS[params.get('captions') || SCRIPT];
  if (!track) return;
  const cur = track.find(c => t >= c.t0 && t < c.t1);
  // persistent corner bug on every frame
  ctx.save();
  ctx.textAlign = 'right'; ctx.font = 'bold 22px "Courier New", monospace';
  ctx.fillStyle = 'rgba(255,183,55,0.55)';
  ctx.fillText('HORNETBAY.COM', 1252, 700);
  ctx.restore();
  if (!cur) return;
  const W = 1280, H = 720;
  const lines = cur.lines, lh = 54, hasStep = !!cur.step;
  const bh = lh * lines.length + (hasStep ? 84 : 44);
  const y0 = H - bh - 34;
  ctx.save();
  ctx.fillStyle = 'rgba(3,12,32,0.84)';
  ctx.fillRect(0, y0, W, bh);
  ctx.fillStyle = '#ffb737'; ctx.fillRect(0, y0, 12, bh);
  ctx.fillRect(0, y0, W, 3);
  let ty = y0 + 42;
  if (hasStep) {
    ctx.textAlign = 'left'; ctx.font = 'bold 27px "Courier New", monospace';
    ctx.fillStyle = '#96beeb';
    ctx.fillText(cur.step, 44, ty); ty += 16;
  }
  ctx.font = 'bold 42px "Courier New", monospace';
  ctx.fillStyle = '#ffb737';
  for (const ln of lines) { ty += lh; ctx.fillText(ln, 44, ty); }
  ctx.restore();
}

// shared headless warp: works for mission AND intro-flow states
if (params.get('hold') === '1') G.intro.hold = true;
const xm = params.get('xmag');
if (xm) G.xmag = parseFloat(xm);
const warpT = parseFloat(params.get('t') || '0');
if (auto && warpT > 0) {
  const step = 1 / 60;
  const burn = params.has('burn');   // test hook: firewalled throttle + rotate pitch during warp
  // test hook: hold keys (e.g. keys=ArrowRight@10 starts 10 s into the warp;
  // separate timed batches with ';', e.g. keys=KeyP@0.5;KeyQ@1.5)
  const holdKeys = params.get('keys');
  const keySegs = holdKeys ? holdKeys.split(';').map(seg => {
    const [kl, atd] = seg.split('@');
    const [at, dur] = (atd || '0').split('+');   // keys=K@2+0.5 holds K for 0.5 s then releases
    return { list: kl.split(','), at: parseFloat(at || '0'), dur: dur !== undefined ? parseFloat(dur) : Infinity };
  }) : [];
  const warpStartState = G.state;   // allow warps that START in the menu to run
  // rec=N: composite gl+hud to a 1280x720 jpeg every Nth warp step and POST the
  // batch to /rec-upload — deterministic 60/N fps footage for promo recording
  const recN = parseInt(params.get('rec') || '0');
  let recCtx = null, recBuf = [], recIdx = 0;
  const recPost = (batch) => {
    for (let a = 0; a < 4; a++) {
      try {
        const x = new XMLHttpRequest();
        x.open('POST', '/rec-upload', false);   // synchronous: in-order, retried, no loss
        x.setRequestHeader('Content-Type', 'application/json');
        x.send(JSON.stringify(batch));
        if (x.status === 200) return;
      } catch (e) { /* retry */ }
    }
  };
  for (let i = 0; i < warpT * 60; i++) {
    try {
    if (burn && G.player) {
      G.player.throttle = 1; G.player.abLatch = true; G.player.brakes = false;
    }
    for (const seg of keySegs) {
      const on = i * step >= seg.at && i * step < seg.at + seg.dur;
      for (const k of seg.list) {
        if (on) { if (!G.input.keys.has(k)) G.input.justPressed.add(k); G.input.keys.add(k); }
        else if (seg.dur !== Infinity) G.input.keys.delete(k);
      }
    }
    stepGame(step);
    G.input.postUpdate();   // mirror the real frame loop, or justPressed sticks
    if (recN > 0 && i % recN === 0) {
      updateCamera(step * recN);   // cover every sim step, or damps run at half rate
      renderer.render(scene, camera);
      if (!recCtx) { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; recCtx = c.getContext('2d'); }
      recCtx.drawImage($('gl'), 0, 0, 1280, 720);
      recCtx.drawImage($('hud'), 0, 0, 1280, 720);
      drawRecCaptions(recCtx, scriptT);
      recBuf.push({ i: recIdx++, d: recCtx.canvas.toDataURL('image/jpeg', 0.75) });
      if (recBuf.length >= 10) { recPost(recBuf); recBuf = []; }
    }
    if (G.state !== warpStartState && (G.state === 'debrief' || G.state === 'menu')) break;
    } catch (e) {
      window.__werr = e.message + ' || ' + (e.stack || '').split('\n').slice(1, 3).join(' || ');
      break;
    }
  }
  if (recN > 0) { if (recBuf.length) recPost(recBuf); document.title = 'REC-DONE'; }
  window.__warped = true;
  if (G.state === 'flying') snapCamera();
  if (params.has('manual')) G.openManual();   // test hook: open the flight manual
  if (params.has('noocean') && G.world.oceanMesh) G.world.oceanMesh.visible = false;  // layer-isolation probe
  // layer-isolation probes: hide=sky|terrain|ocean (comma-separated), plus a
  // raycast dump of what geometry below-horizon rays actually hit
  for (const h of (params.get('hide') || '').split(',')) {
    if (h === 'sky' && G.world.skyMesh) G.world.skyMesh.visible = false;
    if (h === 'ocean' && G.world.oceanMesh) G.world.oceanMesh.visible = false;
    if (h === 'terrain') G.scene.traverse(o => { if (o.geometry && o.geometry.attributes.position && o.geometry.attributes.position.count > 200000) o.visible = false; });
    if (h === 'model' && G.player) G.player.model.visible = false;
    if (h === 'rwy') G.scene.traverse(o => { if (o.geometry && o.geometry.type === 'PlaneGeometry' && o.material && o.material.map) o.visible = false; });
    if (h === 'wcaps') G.scene.traverse(o => { if (o.isPoints) o.visible = false; });
    if (h === 'city') G.scene.traverse(o => { if (o.geometry && (o.geometry.type === 'BoxGeometry' || o.geometry.type === 'CylinderGeometry' || o.geometry.type === 'ConeGeometry') && o.getWorldPosition(new THREE.Vector3()).distanceTo(G.camera.position) > 100) o.visible = false; });
  }
  if (params.has('wfnofog') && G.world.waterMat) { G.world.waterMat.fog = false; G.world.waterMat.needsUpdate = true; }  // probe: defog the sea
  if (params.has('planesel')) G.intro.planeSelect();   // test: jump to the start-spot map view
  if (params.has('only')) {   // bisect: keep only terrain/ocean/sky/runways
    const keep = new Set();
    G.scene.traverse(o => {
      if (o === G.world.oceanMesh || o === G.world.skyMesh) keep.add(o);
      if (o.geometry && o.geometry.attributes.position && o.geometry.attributes.position.count > 200000) keep.add(o);
      if (o.geometry && o.geometry.type === 'PlaneGeometry' && o.material && o.material.map) keep.add(o);
    });
    G.scene.traverse(o => { if ((o.isMesh || o.isPoints || o.isSprite || o.isLine) && !keep.has(o)) o.visible = false; });
  }
  if (params.has('seay') && G.world.oceanMesh) G.world.oceanMesh.position.y = parseFloat(params.get('seay'));  // probe: move the sea
  if (params.has('nan') && G.scene) {   // probe: NaN audit of all vertex buffers
    let bad = 0, tot = 0;
    G.scene.traverse(o => {
      if (!o.geometry || !o.geometry.attributes.position) return;
      const a = o.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i++) { tot++; if (!Number.isFinite(a[i])) bad++; }
    });
    const d = document.createElement('div'); d.id = 'nanprobe'; d.style.display = 'none';
    d.textContent = JSON.stringify({ bad, tot }); document.body.appendChild(d);
  }
  if (params.has('depthviz')) {   // probe: log-depth visualization override
    G.scene.overrideMaterial = new THREE.ShaderMaterial({
      vertexShader: 'varying float vZ; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vZ; void main(){ float d = clamp(log(max(vZ,1.5)/1.5)/log(320000.0/1.5), 0.0, 1.0); gl_FragColor = vec4(d, fract(d*6.0)*0.6, 1.0-d, 1.0); }'
    });
  }
  if (params.has('probe')) window.__probeFrames = 5;   // run after 5 real frames (matrices fresh)
  if (params.has('cnear')) { camera.near = parseFloat(params.get('cnear')); camera.updateProjectionMatrix(); }   // probe: near-plane sweep
  if (params.has('tlift')) {   // debug: lift the terrain mesh by N metres
    const lift = parseFloat(params.get('tlift'));
    G.scene.traverse(o => { if (o.geometry && o.geometry.attributes.position && o.geometry.attributes.position.count > 200000 && o.material.vertexColors) o.position.y = lift; });
  }
  if (params.has('tdye')) {   // debug: dye terrain verts within 6 km of the player red
    G.scene.traverse(o => {
      if (o.geometry && o.geometry.attributes.position && o.geometry.attributes.position.count > 200000) {
        const p = o.geometry.attributes.position, c = o.geometry.attributes.color;
        const px = G.player.pos.x, pz = G.player.pos.z;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i) + 5000, z = p.getZ(i) + 8000;
          if (Math.hypot(x - px, z - pz) < 6000) c.setXYZ(i, 1, 0, 0);
        }
        c.needsUpdate = true;
      }
    });
  }
  const dye = params.get('dye');   // test hook: paint the Nth textured plane red
  if (dye !== null) {
    let di = 0;
    G.scene.traverse(o => {
      if (o.geometry && o.geometry.type === 'PlaneGeometry' && o.material && o.material.map) {
        if (String(di) === dye) { o.material = new THREE.MeshBasicMaterial({ color: 0xff0000, fog: false, side: THREE.DoubleSide }); o.material.needsUpdate = true; }
        di++;
      }
    });
    window.__dyeCount = di;
  }
  if (params.has('gh') && G.player) {         // test hook: terrain height probe around the player
    const P = G.player, gh = (dx, dz) => groundHeight(P.pos.x + dx, P.pos.z + dz).toFixed(1);
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:34px;left:8px;color:#0f0;font:18px monospace;z-index:99;text-shadow:1px 1px 0 #000';
    let grid = '';
    for (let dz = -1200; dz <= 1200; dz += 400) {
      const row = [];
      for (let dx = -1200; dx <= 1200; dx += 400) row.push(gh(dx, dz).padStart(6));
      grid += `z${dz >= 0 ? '+' : ''}${dz}:${row.join('')}\n`;
    }
    d.style.whiteSpace = 'pre';
    d.textContent = grid;
    document.body.appendChild(d);
  }
  if (params.has('dbgroll') && G.player) {   // numeric bank readout for sign tests
    const xr = new THREE.Vector3(1, 0, 0).applyQuaternion(G.player.quat);
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:8px;left:8px;color:#0f0;font:22px monospace;z-index:99;text-shadow:1px 1px 0 #000';
    d.textContent = `localX.y=${xr.y.toFixed(3)}  hdg=${G.player.headingDeg().toFixed(1)}  vel.y=${G.player.vel.y.toFixed(1)}`;
    document.body.appendChild(d);
  }
  // deterministic orbit camera for tests: oyaw/opitch in degrees, odist in m
  if (params.has('oyaw') || params.has('opitch') || params.has('odist')) {
    G.orbit.manual = true;
    if (params.has('oyaw')) G.orbit.yaw = parseFloat(params.get('oyaw')) * Math.PI / 180;
    if (params.has('opitch')) G.orbit.pitch = parseFloat(params.get('opitch')) * Math.PI / 180;
    if (params.has('odist')) G.orbit.dist = parseFloat(params.get('odist'));
    snapCamera();
  }
}
window.__camdist = parseFloat(params.get('camdist') || '0');
frame();
