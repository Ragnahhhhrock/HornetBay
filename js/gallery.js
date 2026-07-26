// gallery.js — model gallery: examine every aircraft and ship in the game up
// close. Two categories (TAB switches): AIRCRAFT and SHIPS. Rotate with
// arrows / A D W S (or drag), zoom with +/- or the wheel, [ ] or 1-9 to pick
// a model, Q or ESC to leave. New game models: register them in ITEMS below —
// the gallery is the canonical source of model screenshots.
import * as THREE from 'three';
import { buildModel, buildSub, buildRaft } from './models.js';
import { buildWarship, buildCargo, buildTanker, buildCruise, buildFishing, buildSailboat } from './ships.js';
import { Carrier } from './world.js';
import { clamp } from './util.js';

const CATS = { air: 'AIRCRAFT', ship: 'SHIPS' };

const ITEMS = [
  // ---- aircraft ----
  { cat: 'air', type: 'f18',   name: 'F/A-18 HORNET',              info: 'CARRIER-CAPABLE MULTIROLE STRIKE FIGHTER — THE MOUNT' },
  { cat: 'air', type: 'f16',   name: 'F-16 FIGHTING FALCON',       info: 'LAND-BASED AIR-DEFENCE HOT-ROD — NO TAILHOOK' },
  { cat: 'air', type: 'b747',  name: 'AIR FORCE ONE (VC-25A)',     info: 'BOEING 747-200B — THE 1994 PRESIDENTIAL MOUNT — MIND THE PAINT' },
  { cat: 'air', type: 'mig29', name: 'MIG-29 FULCRUM',             info: 'ENEMY BOGEY — TWIN-TAIL AGILE FIGHTER' },
  { cat: 'air', type: 'b744',  name: 'ALLIED AIRLINES 747-400',    info: 'SFO HEAVY — 388 SOULS ABOARD — FRIENDLY SKIES: CHECK YOUR FIRE', livery: 0 },
  { cat: 'air', type: 'b737',  name: 'LIBERTY AIR 737-400',        info: 'SHORT-HAUL SHUTTLE — 146 SOULS ABOARD — POLISHED SILVER: CHECK YOUR FIRE', livery: 1 },
  { cat: 'air', type: 'dc10',  name: 'PACIFIC EMPRESS DC-10',      info: 'TRIJET HEAVY — 268 SOULS ABOARD — THE DEFECTOR FLEW ONE OF THESE', livery: 3 },
  { cat: 'air', type: 'md90',  name: 'CASCADE AIR MD-90',          info: 'T-TAIL MAD DOG — 158 SOULS ABOARD — REAR TWINS: CHECK YOUR FIRE', livery: 2 },
  { cat: 'air', type: 'b707',  name: 'BOEING 707 INTERCONTINENTAL', info: 'THE CLASSIC LONG-HAULER — STILL WORKING THE IDENT RUNS OUT OF SFO' },
  { cat: 'air', type: 'cruise', name: 'CRUISE MISSILE',             info: 'THE MOFFETT BANDIT — LOW, FAST, AND NOT HERE TO SIGHTSEE' },
  // ---- ships ----
  { cat: 'ship', name: 'USS ENTERPRISE (CVN-65)', info: 'THE BIG E — NUCLEAR SUPERCARRIER — YOUR HOME PLATE',
    dist: 620, zmin: 150, zmax: 1500,
    make: (scene) => new Carrier({ scene }, new THREE.Vector3(), 0, false).group },
  { cat: 'ship', name: 'GUIDED-MISSILE CRUISER', info: '173M — THE PICKET AHEAD OF THE BIG E',
    dist: 330, zmin: 60, zmax: 800,
    make: () => buildWarship({ len: 173, beam: 17, sup: [{ w: 12, h: 8, d: 26, z: 18, bridge: 1 }, { w: 10, h: 6, d: 18, z: -18 }], funnels: [{ z: -6 }, { z: -30 }], masts: [{ z: 30, h: 14 }, { z: -40, h: 11 }], turret: [58, 44], helo: 1 }) },
  { cat: 'ship', name: 'DESTROYER', info: '150M — BEAM ESCORT, PORT AND STARBOARD STATIONS',
    dist: 300, zmin: 60, zmax: 700,
    make: () => buildWarship({ len: 150, beam: 16, sup: [{ w: 11, h: 7, d: 22, z: 10, bridge: 1 }], funnels: [{ z: -14 }, { z: -26 }], masts: [{ z: 22, h: 15 }], turret: [48], helo: 1 }) },
  { cat: 'ship', name: 'FRIGATE', info: '135M — THE ASTERN PICKET, CLEAR OF THE APPROACH',
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
    this.lastInCat = { air: 0, ship: ITEMS.findIndex(i => i.cat === 'ship') };
    this.yaw = 0.8; this.pitch = 0.15; this.dist = 40;
    this.model = null;
    this.anchor = new THREE.Vector3(-6000, 1400, -6000);   // over the ocean, bay behind
    this._e = new THREE.Euler();
    this._drag = null;
    this._onDown = (e) => { this._drag = { x: e.clientX, y: e.clientY }; };
    this._onMove = (e) => {
      if (!this._drag) return;
      this.yaw += (e.clientX - this._drag.x) * 0.006;
      this.pitch = clamp(this.pitch + (e.clientY - this._drag.y) * 0.005, -1.2, 1.2);
      this._drag = { x: e.clientX, y: e.clientY };
    };
    this._onUp = () => { this._drag = null; };
    // touch drag rotates the same way (mobile)
    this._onTStart = (e) => { if (e.touches.length === 1) this._drag = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
    this._onTMove = (e) => {
      if (e.touches.length !== 1 || !this._drag) return;
      e.preventDefault();
      this.yaw += (e.touches[0].clientX - this._drag.x) * 0.006;
      this.pitch = clamp(this.pitch + (e.touches[0].clientY - this._drag.y) * 0.005, -1.2, 1.2);
      this._drag = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    this._onTEnd = () => { this._drag = null; };
  }
  _catList(cat) { return ITEMS.map((it, i) => ({ it, i })).filter(x => x.it.cat === (cat || this.cat)); }
  enter() {
    this.G.state = 'gallery';
    window.addEventListener('mousedown', this._onDown);
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('mouseup', this._onUp);
    window.addEventListener('touchstart', this._onTStart);
    window.addEventListener('touchmove', this._onTMove, { passive: false });
    window.addEventListener('touchend', this._onTEnd);
    this._show(this.lastInCat[this.cat]);
  }
  exit() {
    window.removeEventListener('mousedown', this._onDown);
    window.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('mouseup', this._onUp);
    window.removeEventListener('touchstart', this._onTStart);
    window.removeEventListener('touchmove', this._onTMove);
    window.removeEventListener('touchend', this._onTEnd);
    if (this.model) { this.G.scene.remove(this.model); this.model = null; }
    this.onExit();
  }
  _toggleCat() {
    this.cat = this.cat === 'air' ? 'ship' : 'air';
    this._show(this.lastInCat[this.cat]);
  }
  _step(n) {   // next/prev within the current category
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
  }
  update(dt, I) {
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
    if (I.pressed('Tab')) this._toggleCat();
    if (I.pressed('BracketRight')) this._step(1);
    if (I.pressed('BracketLeft')) this._step(-1);
    for (let k = 0; k < 9; k++) if (I.pressed('Digit' + (k + 1))) this._jump(k);
    if (I.pressed('KeyQ') || I.pressed('Escape')) { this.exit(); return; }
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
    const s = clamp(h / 500, 0.6, 1.5), it = ITEMS[this.flat];
    const list = this._catList(), pos = list.findIndex(x => x.i === this.flat);
    c.textAlign = 'center';
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
    c.fillText('ARROWS / DRAG — ROTATE     + / - / WHEEL — ZOOM     [ ] / 1-9 — MODEL     TAB — CATEGORY     G — GEAR     Q — MENU', w / 2, h * 0.94);
    c.textAlign = 'left';
  }
}
