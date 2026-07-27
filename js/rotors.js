// rotors.js — helicopters: the cruiser's Seahawk flying circuits off the aft
// deck, and shuttle birds working the helipads around the bay
import * as THREE from 'three';
import { clamp, lerp, damp, rand, wrapAngle } from './util.js';
import { groundHeight } from './world.js';
import { buildModel } from './models.js';

const _v = new THREE.Vector3();

// kinematic rotor-wing: spool, liftoff, transit, approach, land, parked
export class Helicopter {
  constructor(scene, world, opts = {}) {
    this.scene = scene; this.world = world;
    this.model = buildModel(opts.type || 'seahawk');
    scene.add(this.model);
    this.pos = this.model.position;
    this.heading = opts.heading ?? 0;
    this.speed = 0;                     // horizontal speed m/s
    this.vy = 0;
    this.rpm = opts.spun ? 1 : 0;       // rotor spool 0..1
    this.mode = 'parked';
    this.hover = 0; this.bank = 0; this.pitchA = 0;
    this.anchor = opts.anchor || null;  // {getPos(v)} moving deck spot
    this.hoverAlt = opts.hoverAlt ?? 12;
    this.cruiseAlt = opts.cruiseAlt ?? 160;
    this.cruiseSpeed = opts.cruiseSpeed ?? 48;
    this.wp = null;                     // current transit waypoint {x,y,z}
    this.target = null;                 // landing goal {x,y,z,anchor}
    this.onLand = opts.onLand || null;
    this.kind = 'heli';
    this.dead = false; this.removeMe = false;
    if (this.anchor) { this.anchor.getPos(this.pos); }
    else if (opts.pos) this.pos.copy(opts.pos);
    this._sync(0);
  }

  get vel() { return _v.set(Math.sin(this.heading) * this.speed, this.vy, -Math.cos(this.heading) * this.speed); }
  fwd(out) { return (out || new THREE.Vector3()).set(Math.sin(this.heading), 0, -Math.cos(this.heading)); }
  get len() { return 20; }

  order(op) {  // {kind:'goto', wp:{x,y,z}, land:{x,y,z,anchor}} | {kind:'launch'}
    if (op.kind === 'goto') { this.wp = op.wp; this.target = op.land || null;
      if (this.mode === 'parked') this.mode = 'spool'; else if (this.mode !== 'transit') this.mode = 'transit'; }
  }

  update(dt, G) {
    const u = this.model.userData;
    // rotor spool follows intent
    const wantRpm = this.mode === 'parked' ? 0 : 1;
    this.rpm = damp(this.rpm, wantRpm, this.rpm < wantRpm ? 0.45 : 0.3, dt);
    if (u.rotor) {
      u.rotor.rotation.y += dt * (2 + this.rpm * 26);
      const blur = this.rpm > 0.62;
      if (u.rotorDisc) u.rotorDisc.visible = blur;
      for (const h of u.rotor.children) h.visible = !blur;
      if (u.tailRotor) u.tailRotor.rotation.x += dt * (3 + this.rpm * 40);
    }
    switch (this.mode) {
      case 'parked': {
        if (this.anchor) { this.anchor.getPos(_v); this.pos.copy(_v); this.heading = damp(this.heading, this.anchor.heading ? this.anchor.heading() : this.heading, 1, dt); }
        this.speed = 0; this.vy = 0; this.bank = damp(this.bank, 0, 4, dt); this.pitchA = damp(this.pitchA, 0, 4, dt);
        break;
      }
      case 'spool': {
        if (this.anchor) { this.anchor.getPos(_v); this.pos.copy(_v); }
        if (this.rpm > 0.85) this.mode = 'liftoff';
        break;
      }
      case 'liftoff': {
        const base = this.anchor ? this.anchor.getPos(_v) : _v.set(this.pos.x, groundHeight(this.pos.x, this.pos.z), this.pos.z);
        const wantY = base.y + this.hoverAlt;
        this.vy = damp(this.vy, clamp((wantY - this.pos.y) * 0.8, 0.5, 4), 2, dt);
        this.pos.y += this.vy * dt;
        if (this.anchor) {  // rise straight off the deck, tracking it
          this.pos.x = damp(this.pos.x, base.x, 1.2, dt);
          this.pos.z = damp(this.pos.z, base.z, 1.2, dt);
        }
        if (this.pos.y >= wantY - 0.5) { this.vy = 0; this.mode = 'transit'; }
        break;
      }
      case 'transit': {
        const t = this.wp;
        if (!t) { this.mode = 'approach'; break; }
        const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
        const dist = Math.hypot(dx, dz);
        const wantHdg = Math.atan2(dx, -dz);
        const dh = wrapAngle(wantHdg - this.heading);
        const turnRate = clamp(2.2 * 9.81 / Math.max(this.speed, 20), 0.35, 1.4);
        this.heading += clamp(dh, -turnRate * dt, turnRate * dt);
        this.bank = damp(this.bank, clamp(-dh * 1.6, -0.55, 0.55), 3, dt);
        const wantSpeed = dist > 400 ? this.cruiseSpeed : clamp(dist * 0.12, 8, this.cruiseSpeed);
        this.speed = damp(this.speed, wantSpeed, 0.6, dt);
        const ty = t.y ?? this.cruiseAlt;
        this.vy = damp(this.vy, clamp((ty - this.pos.y) * 0.5, -6, 6), 1.5, dt);
        this.pitchA = damp(this.pitchA, this.speed > 10 ? -0.12 : 0, 2, dt);
        this.pos.x += Math.sin(this.heading) * this.speed * dt;
        this.pos.z += -Math.cos(this.heading) * this.speed * dt;
        this.pos.y += this.vy * dt;
        // terrain floor
        const gh = Math.max(groundHeight(this.pos.x, this.pos.z), 0) + 24;
        if (this.pos.y < gh) this.pos.y = gh;
        if (dist < 120) this.mode = this.target ? 'approach' : 'transit';
        break;
      }
      case 'approach': {
        const t = this.target;
        if (!t) { this.mode = 'transit'; break; }
        const spot = t.anchor ? t.anchor.getPos(_v) : _v.set(t.x, t.y, t.z);
        // finite-difference spot velocity (the deck steams at ~12 m/s)
        const svx = this._ps ? (spot.x - this._ps.x) / Math.max(dt, 1e-3) : 0;
        const svz = this._ps ? (spot.z - this._ps.z) / Math.max(dt, 1e-3) : 0;
        this._ps = (this._ps || new THREE.Vector3()).copy(spot);
        const dx = spot.x - this.pos.x, dz = spot.z - this.pos.z;
        const dist = Math.hypot(dx, dz);
        const above = this.pos.y - spot.y;
        // come to a hover over the spot, then settle
        const wantHdg = Math.atan2(dx, -dz);
        const dh = wrapAngle(wantHdg - this.heading);
        this.heading += clamp(dh, -1.2 * dt, 1.2 * dt);
        this.bank = damp(this.bank, clamp(-dh * 1.2, -0.4, 0.4), 3, dt);
        if (dist > 60 || above > 15) {
          // velocity-control phase: fly to a hover over the spot, with
          // feed-forward for the moving deck
          const wantSpeed = clamp(dist * 0.25 + Math.hypot(svx, svz), 0, 26);
          this.speed = damp(this.speed, wantSpeed, 0.8, dt);
          const vyWant = above > 15 ? clamp((spot.y + 12 - this.pos.y) * 0.4, -3.5, 0)
                                    : clamp(-above * 0.45, -1.5, 2.2);
          this.vy = damp(this.vy, vyWant, 1.5, dt);
          this.pos.x += Math.sin(this.heading) * this.speed * dt + svx * dt;
          this.pos.z += -Math.cos(this.heading) * this.speed * dt + svz * dt;
          this.pos.y += this.vy * dt;
        } else {
          // final settle: exponential pull onto the spot + deck feed-forward
          this.speed = damp(this.speed, 0, 1.2, dt);
          this.vy = 0;
          this.pos.x = damp(this.pos.x, spot.x, 1.4, dt) + svx * dt;
          this.pos.y = damp(this.pos.y, spot.y, 1.4, dt);
          this.pos.z = damp(this.pos.z, spot.z, 1.4, dt) + svz * dt;
        }
        this.pitchA = damp(this.pitchA, this.speed > 8 ? -0.1 : 0.05, 2, dt);
        if (dist < 7 && Math.abs(above) < 0.9) {
          this.pos.copy(spot); this.vy = 0; this.speed = 0;
          this.mode = 'parked'; this.anchor = t.anchor || null;
          if (this.onLand) this.onLand(this);
        }
        break;
      }
    }
    this._sync(dt);
  }

  _sync(dt) {
    this.hover += dt * 1.7;
    const bob = (this.mode === 'parked' || this.mode === 'spool') ? 0 : Math.sin(this.hover) * 0.25;
    this.model.rotation.set(this.pitchA, Math.PI - this.heading, this.bank, 'YXZ');
    this._bob = bob;
  }
  // visual bob applied by HeliOps after update (keeps physics pos clean)
  applyBob() { if (this._bob) this.model.position.y += this._bob; }

  dispose() { this.scene.remove(this.model); }
}

// HeliOps — drives the cruiser Seahawk's circuit and the bay shuttle birds
export class HeliOps {
  constructor(G) {
    this.G = G;
    this.helis = [];
    this.t = rand(4, 8);
    // the guided-missile cruiser's aft deck spot (world-tracked each frame)
    const cruiser = G.world.ships.escorts[0];
    const spot = new THREE.Vector3();
    const anchor = {
      getPos: (out) => cruiser.group.localToWorld(out.set(0, 6.35, -cruiser.len * 0.36)),
      heading: () => cruiser.heading,
    };
    const sh = new Helicopter(G.scene, G.world, { anchor, hoverAlt: 26, cruiseAlt: 120, cruiseSpeed: 42 });
    sh.home = anchor; sh.task = 'circuit'; sh.wait = rand(6, 14);
    sh.name = 'NAVY 701';
    this.seahawk = sh; this.helis.push(sh);
    // two shuttles working the pads
    const pads = G.world.helipads;
    for (let i = 0; i < 2; i++) {
      const pad = pads[i === 0 ? 4 : 0];
      const h = new Helicopter(G.scene, G.world, { hoverAlt: 14, cruiseAlt: 190, cruiseSpeed: 52 });
      h.pos.set(pad.x, pad.y, pad.z); h.pad = pad; pad.booked = h;
      h.task = 'shuttle'; h.wait = rand(8, 25) + i * 20;
      h.name = 'SHUTTLE ' + (i === 0 ? 'ONE' : 'TWO');
      this.helis.push(h);
    }
    // the Army's AH-64 Apache — K-MAN holding a continuous orbit over the city
    const ap = new Helicopter(G.scene, G.world, { type: 'apache', spun: true, hoverAlt: 0, cruiseAlt: 300, cruiseSpeed: 48 });
    ap.name = 'K-MAN'; ap.task = 'orbit';
    ap._orbit = { cx: 6200, cz: 8500, r: 2600, n: 12, i: 0 };
    ap.pos.set(ap._orbit.cx + ap._orbit.r, 300, ap._orbit.cz);
    ap.wp = this._orbitPoint(ap, 1); ap._orbit.i = 1;
    ap.mode = 'transit';
    this.helis.push(ap);
  }

  _orbitPoint(h, i) {
    const o = h._orbit, a = (i / o.n) * Math.PI * 2;
    return { x: o.cx + Math.cos(a) * o.r, y: h.cruiseAlt, z: o.cz + Math.sin(a) * o.r };
  }

  _circuit(sh) {
    // a lazy rectangular circuit around the cruiser group, then home
    const c = this.G.world.carrier.pos;
    const sh0 = this.G.world.ships.escorts[0];
    const p = sh0.pos;
    const f = sh0.fwd(new THREE.Vector3());
    const mk = (fx, fz, y) => ({ x: p.x + f.x * fx - f.z * fz, y, z: p.z + f.z * fx + f.x * fz });
    sh.wp = mk(700, 900, 120);
    sh._legs = [mk(0, 1400, 130), mk(-900, 600, 130), mk(-500, -700, 110)];
    sh.target = { anchor: sh.home };
    sh.mode = 'spool';
  }

  _shuttle(h) {
    const pads = this.G.world.helipads;
    const opts = pads.filter(p => p !== h.pad && (!p.booked || p.booked === h));
    if (!opts.length) { h.wait = rand(10, 20); return; }
    const next = opts[Math.floor(Math.random() * opts.length)];
    next.booked = h;
    if (h.pad) h.pad.booked = null;
    h._dest = next;
    h.wp = { x: next.x, y: h.cruiseAlt, z: next.z };
    h.target = { x: next.x, y: next.y, z: next.z };
    h.mode = 'spool';
  }

  update(dt) {
    const G = this.G;
    for (const h of this.helis) {
      h.update(dt, G);
      h.applyBob();
      if (h.mode === 'parked') {
        h.wait -= dt;
        if (h.wait <= 0 && h.rpm < 0.2) {
          if (h.task === 'circuit') this._circuit(h);
          else this._shuttle(h);
        }
      } else if (h.task === 'circuit' && h.mode === 'transit' && h._legs) {
        // walk the circuit legs: as each waypoint is reached the driver asks for
        // a new one only when the current is nearly under the disc
        const d = Math.hypot(h.wp.x - h.pos.x, h.wp.z - h.pos.z);
        if (d < 130) {
          if (h._legs.length) h.wp = h._legs.shift();
          else { h._legs = null; h.mode = 'approach'; }
        }
      } else if (h.task === 'shuttle' && h.mode === 'transit') {
        const d = Math.hypot(h.wp.x - h.pos.x, h.wp.z - h.pos.z);
        if (d < 200) h.mode = 'approach';
      } else if (h.task === 'orbit' && h.mode === 'transit') {
        // K-MAN's wheel over the city: walk the orbit vertices forever
        const d = Math.hypot(h.wp.x - h.pos.x, h.wp.z - h.pos.z);
        if (d < 260) { h._orbit.i = (h._orbit.i + 1) % h._orbit.n; h.wp = this._orbitPoint(h, h._orbit.i); }
      }
      if (h.mode === 'parked' && h._dest) { h.pad = h._dest; h._dest = null; h.wait = rand(18, 45); }
    }
    // the seahawk turns around on the deck between circuits
    if (this.seahawk.mode === 'parked' && this.seahawk.wait <= 0 && this.seahawk.rpm < 0.2) this.seahawk.wait = rand(25, 60);
  }

  dispose() { for (const h of this.helis) h.dispose(); this.helis = []; }
}
