// airwing.js — the Enterprise's resident squadrons working the deck around the
// clock: an A-6E (VA-52 Knight Riders), an S-3B (VS-37 Sawbucks) and the C-2
// COD (VRC-30 Providers) cycling park -> cat 2 -> pattern -> trap -> park.
// Kinematic fixed-wing, carrier-relative: deck phases are tracked in
// deck-local coordinates so a turning ship carries the jets with it.
import * as THREE from 'three';
import { clamp, damp, wrapAngle, rand } from './util.js';
import { buildModel } from './models.js';
import { carrierLocalToWorld } from './flight.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3();

// deck-local layout (carrierLocalToWorld frame: +z toward the bow, +x to port)
const CAT2 = { x: 11, z: 30 };          // the starboard bow cat — Cat 1 stays the player's
const CAT_END_Z = 150;                  // shuttle run's end
const AIM = { x: -6, z: -85 };          // touchdown aim between the wires, on the angle
const ANG_A = { x: -14, z: -160 }, ANG_B = { x: 27, z: 112 };   // angle deck line (world.js)
const ANG = (() => { const dx = ANG_B.x - ANG_A.x, dz = ANG_B.z - ANG_A.z, l = Math.hypot(dx, dz); return { x: dx / l, z: dz / l }; })();
const PARK = [
  { x: -26, z: 100 },   // port row, aft
  { x: -26, z: 72 },
  { x: -26, z: 44 },
  { x: -26, z: 16 },
  { x: -16, z: 128 },   // bow park
];

// the 1994 Pacific air wing (see the squadron histories: all three flew that
// summer's WestPac — VA-52 and VS-37 in CVW-15, VRC-30 Det 1 aboard)
const FLEET = [
  { type: 'a6', name: 'KNIGHT 501', spot: 2, wait: [6, 14], patternLaps: 2 },
  { type: 's3', name: 'SAWBUCK 700', spot: 1, wait: [70, 110], patternLaps: 2 },
  { type: 'c2', name: 'PROVIDER 30', spot: 3, wait: [120, 170], patternLaps: 1, startAirborne: true },
];

class Airframe {
  constructor(scene, world, def) {
    this.scene = scene; this.world = world;
    this.def = def;
    this.model = buildModel(def.type);
    scene.add(this.model);
    this.pos = this.model.position;
    this.heading = 0; this.localHdg = 0;   // localHdg: deck-relative heading while on deck
    this.speed = 0; this.vy = 0;
    this.bank = 0; this.pitchA = 0;
    this.dl = { x: 0, z: 0 };              // deck-local position while on deck
    this.mode = 'parked';
    this.wait = rand(def.wait[0], def.wait[1]);
    this.laps = 0; this.wpIndex = 0;
    this.onDeck = true;
    this._t = 0; this._callT = -99;
    this.kind = 'patrol'; this.identified = true;   // friendly blue on the scope, not lockable
    this.name = def.name; this.label = def.name;
    this.dead = false; this.removeMe = false; this.hp = 100;
    this.spot = PARK[def.spot];
    this.dl.x = this.spot.x; this.dl.z = this.spot.z;
    this.localHdg = 0;
    if (def.startAirborne) {
      // join the pattern already flying: mid downwind leg
      this.onDeck = false; this.mode = 'pattern'; this.laps = 0; this.wpIndex = 1;
      const c = world.carrier, h = c.heading;
      const f = _v.set(Math.sin(h), 0, -Math.cos(h)), p = _v2.set(-Math.cos(h), 0, -Math.sin(h));
      this.pos.set(c.group.position.x + p.x * 2400, 260, c.group.position.z + p.z * 2400);
      this.heading = wrapAngle(h + Math.PI);
      this.speed = 80;
      this._gear(false); this._hook(true);
      this._syncAir(0);
    } else {
      this._gear(true); this._hook(false);
      this._syncDeck(0);
    }
  }

  get len() { return ({ a6: 17, c2: 18, s3: 16 })[this.def.type] || 17; }
  fwd(out) { return out.set(Math.sin(this.heading), 0, -Math.cos(this.heading)); }

  _gear(down) { const u = this.model.userData; if (u.gear) u.gear.visible = down; }
  _hook(down) { const u = this.model.userData; if (u.hook) u.hook.visible = down; }

  // deck-local <-> world helpers ------------------------------------------
  _deckWorld(out) { return carrierLocalToWorld(this.world.carrier, this.dl.x, 2.2, this.dl.z, out); }
  _worldToDeck(pos) {
    const c = this.world.carrier, ch = Math.cos(c.heading), sh = Math.sin(c.heading);
    const dx = pos.x - c.group.position.x, dz = pos.z - c.group.position.z;
    return { x: -(dx * ch + dz * sh), z: dx * sh - dz * ch };
  }
  _localDirWorld(dx, dz, out) {
    const c = this.world.carrier, ch = Math.cos(c.heading), sh = Math.sin(c.heading);
    return out.set(-dx * ch + dz * sh, 0, -dx * sh - dz * ch);
  }
  // carrier-relative air point: fwd metres ahead of the ship, port metres to port
  _relPoint(fwd, port, alt, out) {
    const c = this.world.carrier, h = c.heading;
    const fx = Math.sin(h), fz = -Math.cos(h), px = -Math.cos(h), pz = -Math.sin(h);
    return out.set(c.group.position.x + fx * fwd + px * port, alt, c.group.position.z + fz * fwd + pz * port);
  }
  // the angle-deck approach course as a world unit vector (recomputed — the ship turns)
  _courseWorld(out) { return this._localDirWorld(ANG.x, ANG.z, out).normalize(); }
  _aimWorld(out) { return carrierLocalToWorld(this.world.carrier, AIM.x, 2.2, AIM.z, out); }

  // player on short final? hold the pattern — the air wing is polite
  _playerOnFinal(G) {
    const P = G.player;
    if (!P || P.dead || P.onGround || !G.world.carrier) return false;
    const c = G.world.carrier, ch = Math.cos(c.heading), sh = Math.sin(c.heading);
    const dx = P.pos.x - c.group.position.x, dz = P.pos.z - c.group.position.z;
    const lz = dx * sh - dz * ch, lx = -(dx * ch + dz * sh);
    return lz < -400 && lz > -10000 && Math.abs(lx) < 4500 && P.pos.y < 800;
  }

  _radio(G, text) {
    // deck chatter only when the player is near enough to care
    if (G.time - this._callT < 20) return;
    if (this.pos.distanceTo(G.player.pos) > 26000) return;
    this._callT = G.time;
    G.radio(text);
  }

  update(dt, G) {
    const u = this.model.userData;
    for (const p of u.props || []) p.rotation.z += dt * 55;
    switch (this.mode) {
      case 'parked': {
        this.wait -= dt;
        if (this.wait <= 0) { this.mode = 'taxiCat'; }
        break;
      }
      case 'taxiCat': case 'taxiPark': {
        // taxi in legs along a safe lane: cross the deck at z=8 — ahead of the
        // player's Cat 1 spot and clear of the rollout, never through the wires
        if (!this._path) {
          this._path = this.mode === 'taxiCat'
            ? [{ x: this.spot.x, z: 8 }, { x: CAT2.x, z: 8 }, { x: CAT2.x, z: CAT2.z }]
            : [{ x: -26, z: 8 }, { x: this.spot.x, z: this.spot.z }];
        }
        const tgt = this._path[0];
        const dx = tgt.x - this.dl.x, dz = tgt.z - this.dl.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.2) {
          this._path.shift();
          if (this._path.length) break;
          this._path = null;
          if (this.mode === 'taxiCat') { this.mode = 'hold'; this._t = 2.6; }
          else { this.mode = 'parked'; this.wait = rand(this.def.wait[0], this.def.wait[1]) + 25; }
          break;
        }
        const spd = Math.min(3.6, 0.8 + dist * 0.25);
        const step = Math.min(dist, spd * dt);
        this.dl.x += dx / dist * step; this.dl.z += dz / dist * step;
        // face along the taxi path, in deck-local heading
        const w = this._localDirWorld(dx / dist, dz / dist, _v);
        const want = Math.atan2(w.x, -w.z);
        this.localHdg = wrapAngle(want - this.world.carrier.heading);
        this.speed = spd;
        break;
      }
      case 'hold': {
        // holdback bar engaged, then the cat fires
        this._t -= dt;
        this.localHdg = damp(this.localHdg, 0, 6, dt);
        if (this._t <= 0) { this.mode = 'launch'; this._radio(G, 'TOWER: ' + this.name + ', CAT 2 — YOU\'RE AWAY.'); }
        break;
      }
      case 'launch': {
        // steam stroke: ~28 m/s² down the track to 72 m/s at the bow
        this.speed = Math.min(74, this.speed + 28 * dt);
        this.dl.z += this.speed * dt;
        this.localHdg = damp(this.localHdg, 0, 8, dt);
        if (this.dl.z >= CAT_END_Z) {
          // off the bow: convert deck-relative run to airborne flight
          const c = this.world.carrier;
          this._deckWorld(this.pos);
          this.heading = c.heading + this.localHdg;
          this.speed += c.speed * 0.9;      // wind over deck helps
          this.vy = 0; this.pitchA = -0.1;
          this.onDeck = false; this.mode = 'climbout'; this._t = 0;
        }
        break;
      }
      case 'climbout': {
        this._t += dt;
        this.speed = damp(this.speed, 82, 0.5, dt);
        this.vy = damp(this.vy, 26, 1.2, dt);
        this.pitchA = damp(this.pitchA, -0.28, 2, dt);
        this._fly(dt);
        if (this._t > 6) this._gear(false);
        if (this._t > 14) {
          this.mode = 'pattern'; this.wpIndex = 0; this._hook(true);
          if (G.airWing._onFinal === this) G.airWing._onFinal = null;   // bolter gave the groove back
        }
        break;
      }
      case 'pattern': {
        // left-hand carrier pattern, waypoints rebuilt off the moving ship:
        // break over the bow, port downwind at 260 m, base, then the final gate
        const wps = this._patternWps();
        const wp = wps[this.wpIndex];
        const dist = Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z);
        this._steerTo(wp.x, wp.y, wp.z, 80, dt);
        if (dist < 520) {
          if (this.wpIndex < wps.length - 1) this.wpIndex++;
          else if (this._playerOnFinal(G)) { this.wpIndex = 1; }   // wave off a lap — player's on final
          else if (G.airWing._onFinal && G.airWing._onFinal !== this && G.time - (G.airWing._onFinalT || 0) < 240) { this.wpIndex = 1; }   // groove's occupied — go around
          else if (this.laps < this.def.patternLaps - 1) { this.laps++; this.wpIndex = 0; }
          else { this.mode = 'recover'; this._gear(true); G.airWing._onFinal = this; G.airWing._onFinalT = G.time; }
        }
        break;
      }
      case 'recover': {
        // intercept the angle-deck course: aim for a gate 1.3 km astern of the
        // wires on the extended centreline, then run it down the 3.5° slope
        const aim = this._aimWorld(_v);
        const course = this._courseWorld(_v2);
        _d.subVectors(this.pos, aim);
        const along = _d.dot(course);              // <0 while still astern
        const D = -along;
        const lat = Math.hypot(_d.x - course.x * along, _d.z - course.z * along);
        if (along > 40 && this.pos.y < aim.y + 30) {
          // bolter — past the wires and still flying: power up, around we go
          this.mode = 'climbout'; this._t = 8; this._gear(false); this._hook(true);
          this._radio(G, 'LSO: ' + this.name + ' BOLTER, BOLTER.');
          break;
        }
        if (D > 1350) {
          // fly to the 1.3 km gate on-course
          const gx = aim.x - course.x * 1350, gz = aim.z - course.z * 1350;
          const gy = aim.y + 1350 * 0.0616;
          this._steerTo(gx, gy, gz, 64, dt);
        } else {
          // short final: steer onto the course line, hold 3.5° to D=320, then
          // flare so the wheels meet the deck right at the 3-wire
          const want = Math.atan2(aim.x - this.pos.x, -(aim.z - this.pos.z));
          const dhA = wrapAngle(want - this.heading);
          const turnRate = clamp(2.0 * 9.81 / Math.max(this.speed, 40), 0.3, 1.0) * 1.6;
          this.heading = wrapAngle(this.heading + clamp(dhA, -turnRate * dt, turnRate * dt));
          this.bank = damp(this.bank, clamp(dhA * 1.5, -0.5, 0.5), 3, dt);   // roll into the turn
          this.speed = damp(this.speed, 62, 0.5, dt);
          const vyT = D > 320
            ? clamp((aim.y + D * 0.0616 - this.pos.y) * 0.6, -14, 14)
            : clamp((aim.y + 0.8 - this.pos.y) / Math.max(D / Math.max(this.speed, 30), 0.25), -7, 1);
          this.vy = damp(this.vy, vyT, 2.2, dt);
          this.pitchA = damp(this.pitchA, clamp(-this.vy * 0.012, -0.3, 0.14), 2, dt);
          this._fly(dt);
          if (along > -24 && lat < 22 && this.pos.y <= aim.y + 3.2) {
            // TRAP — the wire yanks 62 m/s to a stop in two seconds
            const dl = this._worldToDeck(this.pos);
            this.dl.x = dl.x; this.dl.z = dl.z;
            this.onDeck = true; this.mode = 'rollout';
            const c = this.world.carrier;
            this.speed = Math.max(30, this.speed - c.speed);
            this.localHdg = wrapAngle(Math.atan2(course.x, -course.z) - c.heading);
            this._radio(G, 'TOWER: ' + this.name + ' TRAPPED ABOARD.');
            G.msg(this.name + ' CAUGHT THE 3-WIRE', 'info');
          }
        }
        break;
      }
      case 'rollout': {
        // decelerate along the angle deck, then clear the landing area
        this.speed = Math.max(0, this.speed - 26 * dt);
        this.dl.x += ANG.x * this.speed * dt; this.dl.z += ANG.z * this.speed * dt;
        if (this.speed <= 3.5) {
          this.speed = 0; this.mode = 'taxiPark'; this._hook(false);
          if (G.airWing._onFinal === this) G.airWing._onFinal = null;   // clear of the wires — release the groove
        }
        break;
      }
    }
    if (this.onDeck) this._syncDeck(dt);
    else this._syncAir(dt);
  }

  _patternWps() {
    // rebuilt each call so the racetrack tracks the steaming, turning ship —
    // gate 3 km astern keeps the groove to under a minute per recovery
    const c = this.world.carrier;
    return [
      { x: c.group.position.x + Math.sin(c.heading) * 900, y: 260, z: c.group.position.z - Math.cos(c.heading) * 900 },   // the break, over the bow
      this._relPoint(2600, 2400, 260, _v).clone(),      // upwind to forward-port
      this._relPoint(-3000, 2400, 260, _v).clone(),     // downwind, past the stern
      this._relPoint(-3400, 2100, 200, _v).clone(),     // base, turning in
      this._relPoint(-3000, 350, 185, _v).clone(),      // the final gate, near the approach course
    ];
  }

  _steerTo(x, y, z, speed, dt, gain = 1) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const want = Math.atan2(dx, -dz);
    const dh = wrapAngle(want - this.heading);
    const turnRate = clamp(2.0 * 9.81 / Math.max(this.speed, 40), 0.3, 1.0) * gain;
    this.heading = wrapAngle(this.heading + clamp(dh, -turnRate * dt, turnRate * dt));
    this.bank = damp(this.bank, clamp(dh * 1.5, -0.6, 0.6), 3, dt);   // roll into the turn
    this.speed = damp(this.speed, speed, 0.5, dt);
    this.vy = damp(this.vy, clamp((y - this.pos.y) * 0.6, -14, 14), 1.6, dt);
    this.pitchA = damp(this.pitchA, clamp(-this.vy * 0.012, -0.3, 0.14), 2, dt);
    this._fly(dt);
  }
  _fly(dt) {
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += -Math.cos(this.heading) * this.speed * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y < 12) this.pos.y = 12;   // wave-top floor — the deck at ~22 m must stay reachable
  }

  _syncDeck(dt) {
    const c = this.world.carrier;
    this._deckWorld(this.pos);
    this.heading = wrapAngle(c.heading + this.localHdg);
    this.pitchA = 0; this.bank = damp(this.bank, 0, 4, dt);
    this.model.rotation.set(0, Math.PI - this.heading, this.bank, 'YXZ');
  }
  _syncAir(dt) {
    this.model.rotation.set(this.pitchA, Math.PI - this.heading, this.bank, 'YXZ');
  }

  dispose() { this.scene.remove(this.model); }
}

export class AirWing {
  constructor(G) {
    this.G = G;
    this.airframes = [];
    for (const def of FLEET) {
      const a = new Airframe(G.scene, G.world, def);
      this.airframes.push(a);
      G.bandits.push(a);   // on the scope and the map with its callsign — friendly blue
    }
  }
  dispose() { /* airframes live in G.bandits — launchMission disposes them there */ }
}
