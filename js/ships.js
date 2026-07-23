// ships.js — carrier battle group escorts + bay maritime traffic.
// The Enterprise never sails alone: four station-keeping escorts in a picket
// ring, plus cargo ships, fishing boats and pleasure craft plying the lanes
// between the Bay and the Pacific through the Golden Gate.
// Conventions match models.js: nose = +Z, up = +Y, right = +X, flat-shaded
// Lambert low-poly. Ocean surface sits at y = -2.5; ship groups ride at y = 0.
import * as THREE from 'three';

function M(color) { return new THREE.MeshLambertMaterial({ color, flatShading: true }); }
function box(w, h, d, color) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(color)); }
function cylY(r1, r2, len, color, segs = 8) {   // axis along Y (masts, funnels)
  return new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, segs), M(color));
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapPi = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

// hull planform extruded to a height: pointed bow at +Z, transom stern at -Z
function hullGeo(len, beam, hullH, waterline = -4) {
  const L2 = len / 2, B2 = beam / 2;
  const sh = new THREE.Shape();
  sh.moveTo(0, L2);
  sh.lineTo(B2 * 0.6, L2 * 0.5);
  sh.lineTo(B2, L2 * 0.05);
  sh.lineTo(B2, -L2);
  sh.lineTo(-B2, -L2);
  sh.lineTo(-B2, L2 * 0.05);
  sh.lineTo(-B2 * 0.6, L2 * 0.5);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: hullH, bevelEnabled: false });
  g.rotateX(Math.PI / 2);                      // -> planform in XZ, height in Y
  g.translate(0, hullH / 2 + waterline, 0);
  return g;
}

// ---------------- night running lights ----------------
let _glowTex = null;
function glowTex() {
  if (!_glowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    _glowTex = new THREE.CanvasTexture(c);
  }
  return _glowTex;
}
function lightSprite(color, scale = 2.2) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex(), color, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending }));
  sp.scale.setScalar(scale); sp.visible = false;
  return sp;
}

function makeWake(beam, len, opacity = 0.18) {
  const w = new THREE.Mesh(new THREE.PlaneGeometry(beam * 2.1, len),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false }));
  w.rotation.x = -Math.PI / 2;
  return w;
}

// ---------------- ship models ----------------
const NAVY   = 0x757e88, NAVY_D = 0x626a74, SUPER = 0x8a929c, DECK = 0x3c4148;
const RUST   = 0x6e3a2e, CARGO_HULL = 0x2e3438, WHITE = 0xdfe3e6;

function buildWarship(opt) {
  const { len, beam } = opt;
  const g = new THREE.Group();
  const hull = new THREE.Mesh(hullGeo(len, beam, 9), M(NAVY));
  g.add(hull);
  const deckY = 5;
  const deck = box(beam * 0.92, 0.8, len * 0.86, DECK); deck.position.set(0, deckY + 0.2, -len * 0.04); g.add(deck);
  for (const s of opt.sup) {   // superstructure blocks {w,h,d,z}
    const b = box(s.w, s.h, s.d, SUPER); b.position.set(0, deckY + s.h / 2, s.z); g.add(b);
    if (s.bridge) { const br = box(s.w * 1.1, s.h * 0.35, s.d * 0.5, NAVY_D); br.position.set(0, deckY + s.h + s.h * 0.18, s.z + s.d * 0.1); g.add(br); }
  }
  for (const f of opt.funnels || []) {
    const fn = cylY(1.6, 2.0, f.h || 7, NAVY_D, 8); fn.position.set(f.x || 0, deckY + (f.base || 4) + (f.h || 7) / 2, f.z); g.add(fn);
  }
  for (const mst of opt.masts || []) {
    const m = cylY(0.25, 0.5, mst.h, SUPER, 6); m.position.set(mst.x || 0, deckY + (mst.base || 4) + mst.h / 2, mst.z); g.add(m);
    const yard = box(3.2, 0.3, 0.3, SUPER); yard.position.set(mst.x || 0, deckY + (mst.base || 4) + mst.h * 0.82, mst.z); g.add(yard);
  }
  if (opt.turret) {  // gun turret(s) on the foredeck
    for (const tz of opt.turret) {
      const t = box(4.2, 1.8, 5.2, NAVY_D); t.position.set(0, deckY + 1.2, tz); g.add(t);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 7, 6), M(NAVY_D));
      barrel.rotation.x = Math.PI / 2 - 0.12; barrel.position.set(0, deckY + 1.8, tz + 5.2); g.add(barrel);
    }
  }
  if (opt.helo) {  // aft helo pad: lighter deck patch + circle
    const pad = box(beam * 0.8, 0.3, len * 0.2, 0x4a5058); pad.position.set(0, deckY + 0.5, -len * 0.36); g.add(pad);
  }
  // running lights: masthead white, port red, starboard green
  const topZ = opt.sup.length ? opt.sup[0].z : 0;
  const mh = lightSprite(0xffffff, 2.6); mh.position.set(0, deckY + 18, topZ); g.add(mh);
  const pt = lightSprite(0xff2828, 1.8); pt.position.set(-beam * 0.6, deckY + 6, topZ); g.add(pt);
  const sb = lightSprite(0x28ff40, 1.8); sb.position.set(beam * 0.6, deckY + 6, topZ); g.add(sb);
  g.userData.lights = [mh, pt, sb];
  return g;
}

function buildCargo(opt) {
  const { len, beam } = opt;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(hullGeo(len, beam, 11), M(CARGO_HULL)));
  const boot = new THREE.Mesh(hullGeo(len * 0.995, beam * 0.995, 2.4), M(RUST)); // boot-top stripe
  boot.position.y = -1.2; g.add(boot);
  const deckY = 6.5;
  // castle aft: white accommodation block + funnel
  const castle = box(beam * 0.8, 12, len * 0.12, WHITE); castle.position.set(0, deckY + 6, -len * 0.38); g.add(castle);
  const fun = cylY(1.8, 2.3, 6, 0xc8ccd0, 8); fun.position.set(0, deckY + 15, -len * 0.42); g.add(fun);
  const funnelCap = cylY(1.9, 1.9, 1.2, 0xb3302a, 8); funnelCap.position.set(0, deckY + 18, -len * 0.42); g.add(funnelCap);
  // container stacks amidships in muted boxcar colors
  const cols = [0x7a4a3a, 0x3a5a7a, 0x4a6a4a, 0x8a7a3a, 0x5a5a62];
  let ci = 0;
  for (let row = 0; row < opt.rows; row++) {
    for (let col = -1; col <= 1; col++) {
      const h = 2 + ((row * 3 + col + 4) % 3);
      const c = box(beam * 0.26, h * 2.2, len * 0.09, cols[ci++ % cols.length]);
      c.position.set(col * beam * 0.3, deckY + h * 1.1, len * 0.28 - row * len * 0.115);
      g.add(c);
    }
  }
  const mh = lightSprite(0xffffff, 2.6); mh.position.set(0, deckY + 16, -len * 0.38); g.add(mh);
  const pt = lightSprite(0xff2828, 1.8); pt.position.set(-beam * 0.5, deckY + 10, -len * 0.38); g.add(pt);
  const sb = lightSprite(0x28ff40, 1.8); sb.position.set(beam * 0.5, deckY + 10, -len * 0.38); g.add(sb);
  g.userData.lights = [mh, pt, sb];
  return g;
}

function buildFishing() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(hullGeo(22, 7, 4), M(WHITE)));
  const cab = box(4.2, 3, 6, 0x3a5a7a); cab.position.set(0, 2.5, -2); g.add(cab);
  const mast = cylY(0.15, 0.25, 8, 0x8a8a80, 6); mast.position.set(0, 6, 2); g.add(mast);
  const boom = cylY(0.1, 0.12, 7, 0x8a8a80, 6); boom.rotation.x = 1.1; boom.position.set(0, 5.4, -1); g.add(boom);
  const mh = lightSprite(0xffffff, 1.8); mh.position.set(0, 10, 2); g.add(mh);
  g.userData.lights = [mh];
  return g;
}

function buildSailboat(withSail) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(hullGeo(11, 3.6, 2.2), M(WHITE)));
  if (withSail) {
    const mast = cylY(0.09, 0.14, 13, 0xb8b8b0, 6); mast.position.set(0, 6, 0.5); g.add(mast);
    const sailSh = new THREE.Shape();
    sailSh.moveTo(0, 0); sailSh.lineTo(4.6, 0.3); sailSh.lineTo(0.2, 10.5); sailSh.closePath();
    const sail = new THREE.Mesh(new THREE.ExtrudeGeometry(sailSh, { depth: 0.12, bevelEnabled: false }), M(0xf0f0ea));
    sail.position.set(0.1, 1.6, -0.4); g.add(sail);
  } else {  // little motor cruiser
    const cab = box(2.4, 1.6, 3.4, 0xcfd4d8); cab.position.set(0, 1.6, -0.6); g.add(cab);
  }
  const mh = lightSprite(0xffffff, 1.4); mh.position.set(0, withSail ? 12.5 : 3.4, 0); g.add(mh);
  g.userData.lights = [mh];
  return g;
}

// ---------------- vessels ----------------
class Vessel {
  constructor(world, group, speed, turnRate) {
    this.world = world; this.group = group;
    this.speed = speed; this.turnRate = turnRate;
    this.heading = 0;
    world.scene.add(group);
  }
  get pos() { return this.group.position; }
  steer(dt, tx, tz, arriveHdg = null, arriveDist = 120) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const dist = Math.hypot(dx, dz);
    let want = (arriveHdg !== null && dist < arriveDist) ? arriveHdg : Math.atan2(dx, -dz);
    const dh = wrapPi(want - this.heading);
    this.heading += clamp(dh, -this.turnRate * dt, this.turnRate * dt);
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += -Math.cos(this.heading) * this.speed * dt;
    this.group.rotation.y = Math.PI - this.heading;
    return dist;
  }
  setNight(n) { for (const l of this.group.userData.lights || []) l.visible = n; }
}

class Escort extends Vessel {
  // station-keeping in the carrier's heading frame: lx abeam (+ starboard),
  // lz along (+ ahead of the bow)
  constructor(world, group, station, maxSpeed = 12) {
    super(world, group, world.carrier.speed, 0.22);
    this.station = station; this.maxSpeed = maxSpeed;
    const t = this._stationWorld();
    this.pos.set(t.x, 0, t.z);
    this.heading = world.carrier.heading;
    this.group.rotation.y = Math.PI - this.heading;
  }
  _stationWorld() {
    const c = this.world.carrier;
    const ch = Math.cos(c.heading), sh = Math.sin(c.heading);
    return {
      x: c.pos.x + (-ch * this.station.x + sh * this.station.z),
      z: c.pos.z + (-sh * this.station.x - ch * this.station.z),
    };
  }
  update(dt) {
    const c = this.world.carrier;
    const t = this._stationWorld();
    const dist = Math.hypot(t.x - this.pos.x, t.z - this.pos.z);
    // sprint when far off station, fall into formation speed when close
    this.speed = dist > 500 ? this.maxSpeed
               : dist > 80 ? c.speed + Math.min(3.5, (dist - 80) / 100)
               : c.speed;
    this.steer(dt, t.x, t.z, c.heading, 150);
  }
}

class TrafficShip extends Vessel {
  constructor(world, group, route, speed, turnRate, loop = true) {
    super(world, group, speed, turnRate);
    this.route = route; this.idx = 0; this.loop = loop;
    this.pos.set(route[0][0], 0, route[0][1]);
    const n = route[1];
    this.heading = Math.atan2(n[0] - route[0][0], -(n[1] - route[0][1]));
    this.group.rotation.y = Math.PI - this.heading;
  }
  update(dt) {
    const wp = this.route[this.idx];
    const dist = this.steer(dt, wp[0], wp[1]);
    if (dist < 240) {
      this.idx++;
      if (this.idx >= this.route.length) {
        if (this.loop) this.idx = 0;
        else { this.pos.set(this.route[0][0], 0, this.route[0][1]); this.idx = 1; }
      }
    }
  }
}

// ---------------- manager ----------------
export class Ships {
  constructor(world) {
    this.world = world;
    this.all = [];

    // --- the battle group: guided-missile cruiser ahead, two destroyers on
    // the beams, frigate astern (far enough back to keep the approach clear)
    const escortDefs = [
      { station: { x: 0, z: 2400 },     len: 173, beam: 17, model: buildWarship({ len: 173, beam: 17, sup: [{ w: 12, h: 8, d: 26, z: 18, bridge: 1 }, { w: 10, h: 6, d: 18, z: -18 }], funnels: [{ z: -6 }, { z: -30 }], masts: [{ z: 30, h: 14 }, { z: -40, h: 11 }], turret: [58, 44], helo: 1 }) },
      { station: { x: -1500, z: 300 },  len: 150, beam: 16, model: buildWarship({ len: 150, beam: 16, sup: [{ w: 11, h: 7, d: 22, z: 10, bridge: 1 }], funnels: [{ z: -14 }, { z: -26 }], masts: [{ z: 22, h: 15 }], turret: [48], helo: 1 }) },
      { station: { x: 1500, z: 300 },   len: 150, beam: 16, model: buildWarship({ len: 150, beam: 16, sup: [{ w: 11, h: 7, d: 22, z: 10, bridge: 1 }], funnels: [{ z: -14 }, { z: -26 }], masts: [{ z: 22, h: 15 }], turret: [48], helo: 1 }) },
      { station: { x: 0, z: -2800 },    len: 135, beam: 14, model: buildWarship({ len: 135, beam: 14, sup: [{ w: 10, h: 6, d: 20, z: 6, bridge: 1 }], funnels: [{ z: -18, h: 9 }], masts: [{ z: 16, h: 12 }], turret: [42], helo: 1 }) },
    ];
    this.escorts = escortDefs.map(d => {
      const e = new Escort(world, d.model, d.station);
      const wakeLen = d.len * 2.4;
      const wake = makeWake(d.beam, wakeLen, 0.16);
      wake.position.set(0, 0.65, -d.len / 2 - wakeLen / 2 + 12);
      e.group.add(wake); e.wake = wake;
      this.all.push(e); return e;
    });

    // --- maritime traffic between the Bay and the Pacific ---
    // shipping lane through the Golden Gate (inbound leg south, outbound leg
    // north, both clear of Alcatraz), looped out-and-back
    // validated against the game's groundHeight: every leg keeps 500m+ off
    // land (including Alcatraz), passing under the Golden Gate twice per loop
    const lane = [
      [-26000, -1200], [-7000, -600], [2000, -500], [6000, -1500], [10000, -2200],
      [14000, -1200], [17000, 1500],   // turn basin in the central bay
      [13500, 0], [11000, -1400], [8000, -1300], [5000, -900], [2000, 300],
      [-2000, 600], [-9000, 1400], [-24000, 1800],
    ];
    const lane2 = lane.map(([x, z]) => [x + 700, z - 500]);   // second freighter, offset
    const trafficDefs = [
      { len: 170, beam: 24, model: buildCargo({ len: 170, beam: 24, rows: 6 }), route: lane,  speed: 5.5, turn: 0.07 },
      { len: 145, beam: 21, model: buildCargo({ len: 145, beam: 21, rows: 4 }), route: lane2.slice(5).concat(lane2.slice(0, 5)), speed: 5.0, turn: 0.07 },
      { len: 22, beam: 7, model: buildFishing(), route: [[-12000, -4000], [-5500, -3000], [-5000, -6500], [-8000, -7000]], speed: 3.5, turn: 0.25 },
      { len: 22, beam: 7, model: buildFishing(), route: [[11500, -1600], [14000, -800], [15500, 1000], [12500, -2200]], speed: 3.2, turn: 0.25 },
      { len: 22, beam: 7, model: buildFishing(), route: [[2500, -1200], [5000, -1800], [7500, -1000], [5000, -300]], speed: 3.0, turn: 0.25 },
      { len: 11, beam: 3.6, model: buildSailboat(true),  route: [[4500, -800], [7500, -1400], [10500, -1600], [8000, -2200], [5000, -1800]], speed: 3.0, turn: 0.3 },
      { len: 11, beam: 3.6, model: buildSailboat(true),  route: [[12000, -600], [15000, 500], [16500, 2200], [13500, -1500]], speed: 2.8, turn: 0.3 },
      { len: 11, beam: 3.6, model: buildSailboat(false), route: [[3000, -1500], [6000, -2200], [10500, -2300], [9500, -1500], [5500, -300]], speed: 4.0, turn: 0.3 },
    ];
    this.traffic = trafficDefs.map(d => {
      const t = new TrafficShip(world, d.model, d.route, d.speed, d.turn);
      const wakeLen = d.len * (1.2 + d.speed * 0.15);
      const wake = makeWake(d.beam, wakeLen, 0.15);
      wake.position.set(0, 0.65, -d.len / 2 - wakeLen / 2 + 6);
      t.group.add(wake);
      this.all.push(t); return t;
    });
    this._night = false;
  }

  update(dt) {
    for (const e of this.escorts) e.update(dt);
    for (const t of this.traffic) t.update(dt);
    const night = (this.world.night01 || 0) > 0.5;
    if (night !== this._night) { this._night = night; for (const v of this.all) v.setNight(night); }
  }
}
