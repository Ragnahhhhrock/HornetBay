// gallery.js — model gallery: the showroom floor. Every model of the current
// category on display at once, all spinning; click one (or arrows + ENTER) to
// zoom in for the close-up, ESC back to the floor. TAB switches categories:
// AIRCRAFT (planes + helicopters) and SHIPPING. New game models: register them
// in ITEMS below — the gallery is the canonical source of model screenshots.
import * as THREE from 'three';
import { buildModel, buildSub, buildRaft } from './models.js';
import { buildWarship, buildCargo, buildTanker, buildCruise, buildFishing, buildSailboat } from './ships.js';
import { Carrier } from './world.js';
import { clamp } from './util.js';

const CATS = { air: 'AIRCRAFT', ship: 'SHIPPING' };

const ITEMS = [
  // ---- aircraft (planes and helicopters) ----
  { cat: 'air', type: 'f18',   name: 'F/A-18 HORNET',              info: 'CARRIER-CAPABLE MULTIROLE STRIKE FIGHTER — THE MOUNT' },
  { cat: 'air', type: 'f14',   name: 'F-14 TOMCAT',                info: 'VF-84 JOLLY ROGERS 1978 — SWING-WING FLEET DEFENDER — PHOENIX CARRIER' },
  { cat: 'air', type: 'f16',   name: 'F-16 FIGHTING FALCON',       short: 'F-16 FALCON',       info: 'LAND-BASED AIR-DEFENCE HOT-ROD — NO TAILHOOK' },
  { cat: 'air', type: 'f15',   name: 'F-15 EAGLE',                 info: 'U.S. AIR FORCE AIR SUPERIORITY — TWIN TAILS, NO TAILHOOK' },
  { cat: 'air', type: 'a10',   name: 'A-10 THUNDERBOLT II',        short: 'A-10 WARTHOG',      info: 'U.S. AIR FORCE CLOSE AIR SUPPORT — BUILT AROUND THE GUN — NO TAILHOOK' },
  { cat: 'air', type: 'mig29', name: 'MIG-29 FULCRUM',             info: 'ENEMY BOGEY — TWIN-TAIL AGILE FIGHTER' },
  { cat: 'air', type: 'su27',  name: 'SU-27 FLANKER',              info: 'SOVIET FRONT-LINE FIGHTER — RED STARS, BLUE 38 — WATCH THE MERGE' },
  { cat: 'air', type: 'b747',  name: 'AIR FORCE ONE (VC-25A)',     short: 'AIR FORCE ONE',     info: 'BOEING 747-200B — THE 1994 PRESIDENTIAL MOUNT — MIND THE PAINT' },
  { cat: 'air', type: 'b744',  name: 'ALLIED AIRLINES 747-400',    short: 'ALLIED 747-400',   info: 'SFO HEAVY — 388 SOULS ABOARD — FRIENDLY SKIES: CHECK YOUR FIRE', livery: 0 },
  { cat: 'air', type: 'b737',  name: 'LIBERTY AIR 737-400',        short: 'LIBERTY 737-400',   info: 'SHORT-HAUL SHUTTLE — 146 SOULS ABOARD — POLISHED SILVER: CHECK YOUR FIRE', livery: 1 },
  { cat: 'air', type: 'dc10',  name: 'PACIFIC EMPRESS DC-10',      short: 'PACIFIC DC-10',     info: 'TRIJET HEAVY — 268 SOULS ABOARD — THE DEFECTOR FLEW ONE OF THESE', livery: 3 },
  { cat: 'air', type: 'md90',  name: 'CASCADE AIR MD-90',          short: 'CASCADE MD-90',     info: 'T-TAIL MAD DOG — 158 SOULS ABOARD — REAR TWINS: CHECK YOUR FIRE', livery: 2 },
  { cat: 'air', type: 'b707',  name: 'BOEING 707 INTERCONTINENTAL', short: 'BOEING 707',        info: 'THE CLASSIC LONG-HAULER — STILL WORKING THE IDENT RUNS OUT OF SFO' },
  { cat: 'air', type: 'cruise', name: 'CRUISE MISSILE',             info: 'THE MOFFETT BANDIT — LOW, FAST, AND NOT HERE TO SIGHTSEE' },
  { cat: 'air', type: 'p3',     name: 'P-3 ORION',                  info: 'U.S. NAVY SUB HUNTER — 500 FT OVER THE SEA LANES, MAD BOOM OUT' },
  { cat: 'air', type: 'seahawk', name: 'SH-60 SEAHAWK',             info: 'U.S. NAVY ROTOR — FLIES THE CRUISER\'S AFT DECK CIRCUIT AND THE BAY PADS' },
  { cat: 'air', type: 'apache',  name: 'AH-64 APACHE',              info: 'U.S. ARMY ATTACK HELICOPTER — K-MAN HOLDING THE ORBIT OVER THE CITY' },
  { cat: 'air', type: 'e2c',    name: 'E-2C HAWKEYE',               info: 'VAW-123 SCREWTOPS — THE EYES OF THE FLEET, ROTODOME TURNING AT 23,000 FT' },
  { cat: 'air', type: 'a6',     name: 'A-6E INTRUDER',              info: 'VA-52 KNIGHT RIDERS 1994 — ALL-WEATHER ATTACK — TRAPS ABOARD THE BIG E' },
  { cat: 'air', type: 'c2',     name: 'C-2A GREYHOUND',             short: 'C-2 GREYHOUND',    info: 'VRC-30 PROVIDERS 1994 — THE COD — MAIL, PARTS AND PASSENGERS ABOARD' },
  { cat: 'air', type: 's3',     name: 'S-3B VIKING',                short: 'S-3 VIKING',       info: 'VS-37 SAWBUCKS 1994 — THE HOOVER — SUB HUNTER WITH THE MAD BOOM OUT' },
  { cat: 'air', type: 'av8b',   name: 'AV-8B HARRIER II',           short: 'AV-8B HARRIER',    info: 'VMA-513 FLYING NIGHTMARES — THE JUMP JET — FOUR NOZZLES, NO AFTERBURNER' },
  { cat: 'air', type: 'balloon', name: 'SURVEILLANCE BALLOON',      short: 'SPY BALLOON',      info: 'HIGH-ALTITUDE INTRUDER — 60,000 FT AND DRIFTING THE COAST — SPLASH IT' },
  { cat: 'air', type: 'boat',   name: 'GO-FAST BOAT',               short: 'GO-FAST BOAT',     info: 'TWIN-OUTBOARD RUNABOUT — THE HIJACKERS\' RIDE — CATCH IT BEFORE IT BOARDS' },
  // ---- shipping ----
  { cat: 'ship', name: 'USS ENTERPRISE (CVN-65)', info: 'THE BIG E — NUCLEAR SUPERCARRIER — YOUR HOME PLATE',
    dist: 620, zmin: 150, zmax: 1500,
    make: (scene) => new Carrier({ scene }, new THREE.Vector3(), 0, false).group },
  { cat: 'ship', name: 'USS GETTYSBURG (CG-64)', short: 'USS GETTYSBURG', info: 'TICONDEROGA-CLASS AEGIS CRUISER — THE PICKET AHEAD OF THE BIG E',
    dist: 330, zmin: 60, zmax: 800,
    make: () => buildWarship({ len: 173, beam: 17, sup: [{ w: 12, h: 8, d: 26, z: 18, bridge: 1 }, { w: 10, h: 6, d: 18, z: -18 }], funnels: [{ z: -6 }, { z: -30 }], masts: [{ z: 30, h: 14 }, { z: -40, h: 11 }], turret: [58, 44], helo: 1 }) },
  { cat: 'ship', name: 'USS STOUT (DDG-55)', short: 'USS STOUT', info: 'GUIDED-MISSILE DESTROYER — STARBOARD BEAM; USS NICHOLSON DD-982 HOLDS PORT',
    dist: 300, zmin: 60, zmax: 700,
    make: () => buildWarship({ len: 150, beam: 16, sup: [{ w: 11, h: 7, d: 22, z: 10, bridge: 1 }], funnels: [{ z: -14 }, { z: -26 }], masts: [{ z: 22, h: 15 }], turret: [48], helo: 1 }) },
  { cat: 'ship', name: 'USS KLAKRING (FFG-42)', short: 'USS KLAKRING', info: 'OLIVER HAZARD PERRY-CLASS FRIGATE — THE ASTERN PICKET, CLEAR OF THE APPROACH',
    dist: 280, zmin: 50, zmax: 700,
    make: () => buildWarship({ len: 135, beam: 14, sup: [{ w: 10, h: 6, d: 20, z: 6, bridge: 1 }], funnels: [{ z: -18, h: 9 }], masts: [{ z: 16, h: 12 }], turret: [42], helo: 1 }) },
  { cat: 'ship', name: 'MT PETRO PACIFIC', info: '360M SUPERTANKER — GIANT OF THE LANE — 3.5 KT, BARELY TURNS',
    dist: 700, zmin: 150, zmax: 1600, make: () => buildTanker({ len: 360, beam: 54 }) },
  { cat: 'ship', name: 'MS BAY MONARCH', info: '230M CRUISE LINER — THE FAST MOVER OF THE LANE',
    dist: 450, zmin: 100, zmax: 1100, make: () => buildCruise({ len: 230, beam: 30 }) },
  { cat: 'ship', name: 'MV BAY TRADER', info: '170M CONTAINER FREIGHTER — LANE REGULAR',
    dist: 340, zmin: 70, zmax: 800, make: () => buildCargo({ len: 170, beam: 24, rows: 6 }) },
  { cat: 'ship', name: 'FISHING BOAT', info: '22M CRABBER — WORKS THE BANKS OUTSIDE THE GATE',
    dist: 55, zmin: 12, zmax: 220, make: () => buildFishing() },
  { cat: 'ship', name: 'SAILBOAT', info: '11M SLOOP — WEEKEND TRAFFIC, MIND YOUR WAKE',
    dist: 28, zmin: 7, zmax: 120, make: () => buildSailboat(true) },
  { cat: 'ship', name: 'MOTOR CRUISER', info: '11M CABIN CRUISER — WEEKEND TRAFFIC, MIND YOUR WAKE',
    dist: 28, zmin: 7, zmax: 120, make: () => buildSailboat(false) },
  { cat: 'ship', name: 'SHADOW SUB', info: 'THE SHADOW — SURFACED, AND UP TO NO GOOD IN THE LANE',
    dist: 220, zmin: 50, zmax: 600, make: () => buildSub() },
  { cat: 'ship', name: 'RESCUE RAFT', info: 'MISSION 4’S CUSTOMER — HOLDS ONE DOWNED PILOT, SNACKS NOT INCLUDED',
    dist: 12, zmin: 3, zmax: 60, make: () => buildRaft() },
];

export class Gallery {
  constructor(G, onExit) {
    this.G = G; this.onExit = onExit;
    this.flat = 0; this.cat = 'air';
    this.mode = 'grid';                    // 'grid' (the floor) | 'focus' (close-up)
    this.lastInCat = { air: 0, ship: ITEMS.findIndex(i => i.cat === 'ship') };
    this.yaw = 0.8; this.pitch = 0.15; this.dist = 40;
    this.model = null;
    this.anchor = new THREE.Vector3(-6000, 1400, -6000);   // over the ocean, bay behind
    this._e = new THREE.Euler();
    // the floor: its own little scene, one wrapper group per model
    this._gridScene = null; this._cells = []; this._sel = 0; this._gt = 0;
    this._cam = new THREE.PerspectiveCamera(40, 1, 0.1, 8000);
    this._size = new THREE.Vector2();
    this._drag = null;
    this._onDown = (e) => { this._drag = { x: e.clientX, y: e.clientY, moved: false }; };
    this._onMove = (e) => {
      if (!this._drag) return;
      const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) this._drag.moved = true;
      if (this.mode !== 'focus') { this._drag.x = e.clientX; this._drag.y = e.clientY; return; }
      this.yaw += dx * 0.006;
      this.pitch = clamp(this.pitch + dy * 0.005, -1.2, 1.2);
      this._drag.x = e.clientX; this._drag.y = e.clientY;
    };
    this._onUp = (e) => {
      const d = this._drag; this._drag = null;
      if (!d || d.moved || this.mode !== 'grid') return;
      const k = this._cellAt(e.clientX, e.clientY);
      if (k >= 0) this._show(this._cells[k].flat);
    };
    // touch: drag rotates in focus, tap selects on the floor
    this._onTStart = (e) => { if (e.touches.length === 1) this._drag = { x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false }; };
    this._onTMove = (e) => {
      if (e.touches.length !== 1 || !this._drag) return;
      e.preventDefault();
      const dx = e.touches[0].clientX - this._drag.x, dy = e.touches[0].clientY - this._drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) this._drag.moved = true;
      if (this.mode === 'focus') {
        this.yaw += dx * 0.006;
        this.pitch = clamp(this.pitch + dy * 0.005, -1.2, 1.2);
      }
      this._drag.x = e.touches[0].clientX; this._drag.y = e.touches[0].clientY;
    };
    this._onTEnd = (e) => {
      const d = this._drag; this._drag = null;
      if (!d || d.moved || this.mode !== 'grid' || !e.changedTouches.length) return;
      const k = this._cellAt(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      if (k >= 0) this._show(this._cells[k].flat);
    };
  }
  _catList(cat) { return ITEMS.map((it, i) => ({ it, i })).filter(x => x.it.cat === (cat || this.cat)); }
  enter() {
    this.G.state = 'gallery';
    // swallow the keypress that opened us — the menu's 9 mustn't jump the floor
    if (this.G.input && this.G.input.justPressed) this.G.input.justPressed.clear();
    window.addEventListener('mousedown', this._onDown);
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('mouseup', this._onUp);
    window.addEventListener('touchstart', this._onTStart);
    window.addEventListener('touchmove', this._onTMove, { passive: false });
    window.addEventListener('touchend', this._onTEnd);
    // capture hooks (?clean / ?auto=gallery&gi=) land straight in focus mode
    if (this.G.cleanShot) { this.mode = 'focus'; this._show(this.lastInCat[this.cat]); }
    else this._buildGrid();
  }
  exit() {
    window.removeEventListener('mousedown', this._onDown);
    window.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('mouseup', this._onUp);
    window.removeEventListener('touchstart', this._onTStart);
    window.removeEventListener('touchmove', this._onTMove);
    window.removeEventListener('touchend', this._onTEnd);
    this._teardownGrid();
    if (this.model) { this.G.scene.remove(this.model); this.model = null; }
    this.onExit();
  }
  _toggleCat() {
    this.cat = this.cat === 'air' ? 'ship' : 'air';
    if (this.mode === 'grid') this._buildGrid();
    else this._show(this.lastInCat[this.cat]);
  }
  _step(n) {   // next/prev within the current category (focus mode)
    const list = this._catList();
    const pos = list.findIndex(x => x.i === this.flat);
    const nxt = list[((pos + n) % list.length + list.length) % list.length];
    this._show(nxt.i);
  }
  _jump(k) {   // k-th model of the current category
    const list = this._catList();
    if (k < list.length) this._show(list[k].i);
  }
  _show(i) {   // flat index into ITEMS (capture-hook compatible)
    this._teardownGrid();
    this.mode = 'focus';
    this.flat = ((i % ITEMS.length) + ITEMS.length) % ITEMS.length;
    const it = ITEMS[this.flat];
    this.cat = it.cat;
    this.lastInCat[it.cat] = this.flat;
    if (this.model) this.G.scene.remove(this.model);
    this.model = it.make ? it.make(this.G.scene) : buildModel(it.type, it.livery || 0);
    this.model.position.copy(this.anchor);
    // aircraft default to wheels up in the showroom (G toggles them down);
    // clean captures always hide the gear
    if (this.model.userData.gear) this.model.userData.gear.visible = false;
    for (const l of this.model.userData.lights || []) l.visible = false;   // showroom: nav lights off
    this.G.scene.add(this.model);
    this.dist = it.dist || 40;
    this._zmin = it.zmin || 18; this._zmax = it.zmax || 170;
    if (this.onShow) this.onShow(it);   // deep-link sync: every asset has its own URL stub
  }
  showType(type) {   // deep link target: focus a specific asset by its type slug
    const i = ITEMS.findIndex(it => it.type === type);
    if (i < 0) return false;
    this._show(i);
    return true;
  }
  // ---------------- the floor ----------------
  _buildGrid() {
    this._teardownGrid();
    this.mode = 'grid';
    if (this.onGrid) this.onGrid();
    const sc = this._gridScene = new THREE.Scene();
    sc.background = new THREE.Color(0x0c1420);
    sc.add(new THREE.HemisphereLight(0xcfe0f0, 0x2c3a2c, 1.15));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.9); sun.position.set(3, 5, 2); sc.add(sun);
    const list = this._catList();
    const SPACING = 1000;
    this._cells = list.map(({ it, i }, k) => {
      const obj = it.make ? it.make(sc) : buildModel(it.type, it.livery || 0);
      if (obj.userData.gear) obj.userData.gear.visible = false;
      for (const l of obj.userData.lights || []) l.visible = false;
      const sph = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
      obj.position.set(-sph.center.x, -sph.center.y, -sph.center.z);
      const grp = new THREE.Group();
      grp.add(obj); grp.position.set(k * SPACING, 0, 0);
      grp.rotation.y = 0.6 + Math.random() * 2;
      sc.add(grp);
      return { it, flat: i, grp, r: Math.max(sph.radius, 4) };
    });
    this._sel = clamp(this._sel, 0, this._cells.length - 1);
  }
  _teardownGrid() {
    if (this._gridScene) this._gridScene.clear();
    this._gridScene = null; this._cells = [];
  }
  _layout(w, h) {
    const n = this._cells.length;
    const cols = n > 12 ? 5 : 4, rows = Math.ceil(n / cols);
    const top = h * 0.15;   // the title band owns the top of the screen
    return { cols, rows, top, cw: w / cols, ch: (h - top) / rows };
  }
  _cellAt(px, py) {
    const r = this.G.renderer.domElement.getBoundingClientRect();
    const L = this._layout(r.width, r.height);
    const cy = Math.floor((py - r.top - L.top) / L.ch);
    const cx = Math.floor((px - r.left) / L.cw);
    const k = cy * L.cols + cx;
    return (cy >= 0 && k >= 0 && k < this._cells.length) ? k : -1;
  }
  _renderGrid() {
    const r = this.G.renderer;
    r.getSize(this._size);
    const w = this._size.x, h = this._size.y;
    const L = this._layout(w, h);
    const cam = this._cam;
    r.setScissorTest(true);
    for (let k = 0; k < this._cells.length; k++) {
      const cell = this._cells[k];
      const cx = (k % L.cols) * L.cw, cy = L.top + Math.floor(k / L.cols) * L.ch;
      r.setViewport(cx, h - cy - L.ch, L.cw, L.ch);
      r.setScissor(cx, h - cy - L.ch, L.cw, L.ch);
      const d = cell.r * 2.9, gp = cell.grp.position;
      cam.aspect = L.cw / L.ch; cam.updateProjectionMatrix();
      cam.position.set(gp.x + d * 0.8, gp.y + d * 0.38, gp.z + d * 0.8);
      cam.up.set(0, 1, 0);
      cam.lookAt(gp.x, gp.y, gp.z);
      r.render(this._gridScene, cam);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.setScissor(0, 0, w, h);
    this.G._skipRender = true;
  }
  update(dt, I) {
    if (this.mode === 'grid') {
      this._gt += dt;
      for (const cell of this._cells) cell.grp.rotation.y += dt * 0.55;   // every model turning on the floor
      const L0 = this._layout(2, 2).cols;   // column count is size-independent
      if (I.pressed('ArrowLeft') || I.pressed('KeyA')) this._sel = (this._sel + this._cells.length - 1) % this._cells.length;
      if (I.pressed('ArrowRight') || I.pressed('KeyD')) this._sel = (this._sel + 1) % this._cells.length;
      if (I.pressed('ArrowUp') || I.pressed('KeyW')) this._sel = (this._sel + this._cells.length - L0) % this._cells.length;
      if (I.pressed('ArrowDown') || I.pressed('KeyS')) this._sel = (this._sel + L0) % this._cells.length;
      if (I.pressed('Enter') || I.pressed('Space')) { if (this._cells[this._sel]) this._show(this._cells[this._sel].flat); return; }
      if (I.pressed('Tab')) { this._toggleCat(); return; }
      for (let k = 0; k < 9; k++) if (I.pressed('Digit' + (k + 1))) { this._jump(k); return; }
      if (I.pressed('KeyQ') || I.pressed('Escape')) { this.exit(); return; }
      if (!this.G.cleanShot) this._renderGrid();
      return;
    }
    // ---------------- focus mode (the close-up) ----------------
    if (!this.G.cleanShot) this.yaw += dt * 0.35;   // idle showroom spin (off for posed captures)
    else if (this.G.forceSpin) this.yaw += dt * this.G.forceSpin;   // ?spin= capture hook: orbit in clean mode
    const R = 1.9 * dt;
    if (I.down('ArrowLeft') || I.down('KeyA')) this.yaw -= R;
    if (I.down('ArrowRight') || I.down('KeyD')) this.yaw += R;
    if (I.down('ArrowUp') || I.down('KeyW')) this.pitch = clamp(this.pitch - R * 0.7, -1.2, 1.2);
    if (I.down('ArrowDown') || I.down('KeyS')) this.pitch = clamp(this.pitch + R * 0.7, -1.2, 1.2);
    if (I.down('Minus') || I.down('NumpadSubtract')) this.dist = Math.min(this._zmax, this.dist + this._zmax * 0.5 * dt);   // - : zoom out
    if (I.down('Equal') || I.down('NumpadAdd')) this.dist = Math.max(this._zmin, this.dist - this._zmax * 0.5 * dt);         // + : zoom in
    if (I.wheel) this.dist = clamp(this.dist + I.wheel * 7, this._zmin, this._zmax);
    if (I.pressed('KeyG') && this.model && this.model.userData.gear) this.model.userData.gear.visible = !this.model.userData.gear.visible;
    if (I.pressed('Tab')) { this._toggleCat(); return; }
    if (I.pressed('BracketRight')) { this._step(1); return; }
    if (I.pressed('BracketLeft')) { this._step(-1); return; }
    for (let k = 0; k < 9; k++) if (I.pressed('Digit' + (k + 1))) { this._jump(k); return; }
    if (I.pressed('Backspace')) { this._buildGrid(); return; }
    if (I.pressed('Escape')) { this._buildGrid(); return; }
    if (I.pressed('KeyQ')) { this.exit(); return; }
    if (this.model) {
      this._e.set(this.pitch, this.yaw, this.roll || 0, 'YXZ');
      this.model.quaternion.setFromEuler(this._e);
    }
    const cam = this.G.camera, a = this.anchor;
    cam.position.set(a.x + this.dist * 0.85, a.y + this.dist * 0.28, a.z - this.dist * 0.85);
    cam.up.set(0, 1, 0);
    cam.lookAt(a.x, a.y + 2, a.z);
    if (cam.fov !== 55) { cam.fov = 55; cam.updateProjectionMatrix(); }
  }
  drawOverlay(c, w, h) {
    const s = clamp(h / 500, 0.6, 1.5);
    c.textAlign = 'center';
    if (this.mode === 'grid') {
      const L = this._layout(w, h);
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(0, h * 0.028, w, h * 0.105);
      c.fillStyle = '#9df09d';
      c.font = `bold ${17 * s}px "Courier New", monospace`;
      c.fillText(`${CATS[this.cat]} GALLERY — ${this._cells.length} MODELS ON THE FLOOR`, w / 2, h * 0.075);
      c.fillStyle = '#6a9a6a';
      c.font = `${11 * s}px "Courier New", monospace`;
      c.fillText('CLICK / ENTER — ZOOM IN     ARROWS — PICK     TAB — CATEGORY     Q — MENU', w / 2, h * 0.115);
      // a name under every spinning model
      for (let k = 0; k < this._cells.length; k++) {
        const cx = (k % L.cols) * L.cw, cy = L.top + Math.floor(k / L.cols) * L.ch;
        const hot = k === this._sel;
        if (hot) {
          c.strokeStyle = '#ffd76a'; c.lineWidth = 2;
          c.strokeRect(cx + 3, cy + 3, L.cw - 6, L.ch - 6);
        }
        c.fillStyle = hot ? '#ffd76a' : '#9df09d';
        c.font = `bold ${10 * s}px "Courier New", monospace`;
        c.fillText(this._cells[k].it.short || this._cells[k].it.name, cx + L.cw / 2, cy + L.ch - 8);
      }
      c.textAlign = 'left';
      return;
    }
    const it = ITEMS[this.flat];
    const list = this._catList(), pos = list.findIndex(x => x.i === this.flat);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(0, h * 0.055, w, h * 0.105);
    c.fillStyle = '#9df09d';
    c.font = `bold ${17 * s}px "Courier New", monospace`;
    c.fillText(`${CATS[this.cat]} GALLERY — ${pos + 1}/${list.length}`, w / 2, h * 0.10);
    c.fillStyle = '#ffd76a';
    c.font = `bold ${21 * s}px "Courier New", monospace`;
    c.fillText(it.name, w / 2, h * 0.145);
    c.fillStyle = '#9df09d';
    c.font = `${11 * s}px "Courier New", monospace`;
    c.fillText(it.info, w / 2, h * 0.90);
    c.fillStyle = '#6a9a6a';
    c.fillText('ARROWS / DRAG — ROTATE     + / - / WHEEL — ZOOM     [ ] / 1-9 — MODEL     TAB — CATEGORY     G — GEAR     ESC — THE FLOOR     Q — MENU', w / 2, h * 0.94);
    c.textAlign = 'left';
  }
}
