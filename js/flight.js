// flight.js — arcade flight model, carrier ops, ground roll, collisions
import * as THREE from 'three';
import { clamp, lerp, damp, KTS, FT, flightQuat, wrapAngle } from './util.js';
import { groundHeight } from './world.js';
import { buildModel } from './models.js';

// numbers tuned against the original running in FS-UAE: ~600kt SL mil top,
// 1000+ kt at altitude on burner, hard ceiling 40,960 ft, stall ~185kt,
// 25,000 lbs of fuel that lasts ~5 min at full throttle, 7% idle thrust
export const PLANES = {
  f18: { label: 'F/A-18 HORNET', maxThrust: 11.5, abBoost: 13.0, dragK: 0.000114, maxRoll: 3.4,
         gMax: 10, stall: 95, rotate: 80, fuel: 25000, burnMil: 80, burnAB: 190, ceiling: 12487 },
  f16: { label: 'F-16 FALCON',   maxThrust: 11.0, abBoost: 12.0, dragK: 0.000108, maxRoll: 4.6,
         gMax: 11, stall: 90, rotate: 76, fuel: 18000, burnMil: 75, burnAB: 175, ceiling: 12487 },
};

const _e = new THREE.Euler(), _dq = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);

// 2D point-in-triangle (carrier sponson footprint test)
function _inTri(px, pz, ax, az, bx, bz, cx, cz) {
  const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
  const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
  const neg = (d1 < 0) || (d2 < 0) || (d3 < 0), pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(neg && pos);
}

export class Player {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.model = null; this.type = 'f18';
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.reset({ plane: 'f18' });
  }
  reset(cfg) {
    if (this.model) this.scene.remove(this.model);
    this.type = cfg.plane || 'f18';
    this.cfg = PLANES[this.type];
    this.model = buildModel(this.type);
    this.scene.add(this.model);
    this.throttle = 0; this.ab = false; this.abLatch = false; this._mach = 0;
    this.pitchRate = 0; this.rollRate = 0; this.yawRate = 0;
    this.gearDown = true; this.hookDown = false; this.brakes = false; this.ecm = false;
    this.fuel = this.cfg.fuel; this.damage = 0; this.gForce = 1;
    this.stores = { aim9: 2, aim120: 4, gun: 500, chaff: 14, flares: 14 };
    this.weapon = 'aim120';
    this.dead = false; this.ejected = false; this.stalled = false; this.modelDown = false;
    this._parkedEject = false; this._deckRide = null;
    this.onGround = null; this.deckLocal = null; this.smokeT = 0; this.contrailT = 0;
    this.crashTimer = 0; this.spinDir = 1;
    this.vel.set(0, 0, 0);
    if (cfg.onCarrier) {
      const c = this.world.carrier;
      // on the Cat 1 shuttle toward the bow, holdback bar engaged
      this.onGround = { type: 'carrier', speedRel: 0, cat: true };
      this.deckLocal = new THREE.Vector3(cfg.deckX ?? -13, 2.2, cfg.deckZ ?? 30);
      this.heading = c.heading; this.pitch = 0; this.bank = 0;
      const w = carrierLocalToWorld(c, this.deckLocal.x, this.deckLocal.y, this.deckLocal.z);
      this.pos.copy(w);
      this.quat.copy(flightQuat(this.heading, 0, 0));
    } else if (cfg.runway) {
      const rw = cfg.runway;
      this.onGround = { type: 'runway', rw, speedRel: 0 };
      this.heading = rw.hdg; this.pitch = 0; this.bank = 0;
      this.pos.set(rw.x - Math.sin(rw.hdg) * rw.len * 0.4, rw.elev + 2.2, rw.z + Math.cos(rw.hdg) * rw.len * 0.4);
      this.quat.copy(flightQuat(this.heading, 0, 0));
    } else {
      this.onGround = null;
      this.pos.copy(cfg.pos || new THREE.Vector3(-24000, 800, 14000));
      this.heading = cfg.heading ?? Math.PI / 2; this.pitch = 0; this.bank = 0;
      this.quat.copy(flightQuat(this.heading, 0, 0));
      const sp = cfg.speed ?? 150;
      this.vel.set(Math.sin(this.heading) * sp, 0, -Math.cos(this.heading) * sp);
      this.throttle = 0.8; this.brakes = false; this.gearDown = false;
    }
    this._syncVisual(0);
  }
  // on the deck the roll speed lives in onGround.speedRel — report it so the
  // HUD speed tape winds up during the takeoff roll / catapult stroke
  get speed() { return this.onGround ? this.onGround.speedRel : this.vel.length(); }
  get speedKts() { return this.speed / KTS; }
  get altFt() { return this.pos.y / FT; }
  get fwd() { return _v.set(0, 0, 1).applyQuaternion(this.quat); }
  headingDeg() { return ((Math.atan2(this.vel.x, -this.vel.z) * 180 / Math.PI) + 360) % 360; }

  update(dt, inp, G) {
    if (this.ejected) { this._updateBallistic(dt, G); return; }
    if (this.dead) { this._updateDead(dt, G); return; }
    // throttle
    this.throttle = clamp(this.throttle + inp.throttleDelta * dt * 0.6, 0, 1);
    // AB: hold SHIFT, or the original's latch — F10 twice at max throttle
    this.ab = (inp.ab || this.abLatch) && this.throttle > 0.9 && this.fuel > 0;
    if (this.throttle <= 0.9) this.abLatch = false;
    // fuel
    const burn = this.throttle * this.cfg.burnMil * (this.onGround ? 0.6 : 1) + (this.ab ? this.cfg.burnAB : 0);
    this.fuel = Math.max(0, this.fuel - burn * dt);
    if (this.onGround) this._updateGround(dt, inp, G);
    else this._updateAir(dt, inp, G);
    this._syncVisual(dt, inp);
  }

  // ---------------- ground (deck / runway) ----------------
  _updateGround(dt, inp, G) {
    const og = this.onGround;
    const cfg = this.cfg;
    const carrier = og.type === 'carrier' ? this.world.carrier : null;
    // engines idle at 7% like the original
    const thrEff = 0.07 + 0.93 * this.throttle;
    let thrustA = cfg.maxThrust * thrEff + (this.ab ? cfg.abBoost : 0);
    // ad-hoc deck roll (bolter / taxi launch): deck crew flings you off the bow —
    // F/A-18 only; the F-16 has no catapult bridle (and no hook)
    if (og.type === 'carrier' && !og.cat && this.type === 'f18' && this.throttle > 0.85 && !og.trapped) thrustA += 20;
    const brakeA = this.brakes ? (og.trapped ? 34 : 9) : 0;
    let acc = thrustA - brakeA - 0.4;
    // C-13 steam catapult: the holdback bar pins the jet until the pilot calls
    // the shot with 90%+ thrust, then ~3 g of steam on top of the engines
    // throws it down the 250-ft stroke — 0 to 265 km/h in under two seconds
    if (og.cat && og.type === 'carrier') {
      if (!og.catFired) {
        if (!og.hinted) { og.hinted = true; G.msg('CAT 1 HOLDBACK — 90% THRUST FOR THE SHOT', 'info'); }
        acc = Math.min(acc, 0);              // straining against the holdback
        if (this.throttle >= 0.9 && this.fuel > 0) {
          og.catFired = true;
          G.msg('CATAPULT SHOT!', 'good');
          if (G.audio.catapult) G.audio.catapult();
        }
      } else {
        acc += 30;
      }
    }
    // brakes are OFF at spawn — so chock the wheels at idle, or the 7%
    // idle thrust would slowly taxi the jet off the deck by itself
    if (og.speedRel === 0 && this.throttle < 0.05 && !og.trapped) acc = Math.min(acc, 0);
    og.speedRel = Math.max(0, og.speedRel + acc * dt * (this.fuel > 0 ? 1 : 0));
    // rolling friction stops the jet when throttle idle
    if (this.throttle < 0.02 && !this.brakes) og.speedRel = Math.max(0, og.speedRel - 1.2 * dt);
    const dir = _v.set(Math.sin(this.heading), 0, -Math.cos(this.heading));
    if (og.type === 'carrier') {
      const c = carrier;
      this.deckLocal.z += og.speedRel * dt;
      const w = carrierLocalToWorld(c, this.deckLocal.x, this.deckLocal.y, this.deckLocal.z);
      this.pos.copy(w);
      // ran off the bow?
      if (this.deckLocal.z > c.deckHalfLen + 4) {
        this.onGround = null;
        this.vel.copy(dir).multiplyScalar(og.speedRel).add(c.deckVelWorld(_v2));
        if (og.speedRel < cfg.stall) { this.vel.y = -2; } // settle into the sea
        G.msg('OFF THE BOW!', 'warn');
      }
    } else {
      const rw = og.rw;
      // rudder steering at low speed
      this.heading = wrapAngle(this.heading + inp.yaw * 0.25 * dt * clamp(og.speedRel / 20, 0, 1));
      dir.set(Math.sin(this.heading), 0, -Math.cos(this.heading));
      this.pos.addScaledVector(dir, og.speedRel * dt);
      this.pos.y = rw.elev + 2.2;
      // ran off runway end?
      const dx = this.pos.x - rw.x, dz = this.pos.z - rw.z;
      const along = dx * Math.sin(rw.hdg) - dz * Math.cos(rw.hdg);
      const cross = dx * Math.cos(rw.hdg) + dz * Math.sin(rw.hdg);
      if (Math.abs(along) > rw.len / 2 + 200 || Math.abs(cross) > rw.wid) {
        // off into the dirt — stop safely
        og.speedRel = Math.max(0, og.speedRel - 12 * dt);
        this.pos.y = groundHeight(this.pos.x, this.pos.z) + 2.2;
      }
      if (og.speedRel === 0 && this.throttle < 0.05) {
        // parked: rearm & refuel
        if (this.fuel < cfg.fuel || this.stores.aim9 < 2) {
          this.fuel = cfg.fuel; this.stores.aim9 = 2; this.stores.aim120 = 4; this.stores.gun = 500;
          this.stores.chaff = 14; this.stores.flares = 14;
          G.msg(rw.name + ': REARMED & REFUELED', 'good');
        }
      }
    }
    // rotate -> lift off
    if (og.speedRel > cfg.rotate && inp.pitch > 0.35) {
      const cv = carrier ? carrier.deckVelWorld(_v2) : _v2.set(0, 0, 0);
      this.vel.copy(dir).multiplyScalar(og.speedRel).add(cv);
      this.vel.y += 4;
      this.onGround = null;
      this.pitch = 0.12;
      G.msg('AIRBORNE', 'good');
      G.audio.gear();
    }
    this.quat.copy(flightQuat(this.heading, 0, 0));
  }

  // ---------------- airborne ----------------
  _updateAir(dt, inp, G) {
    const cfg = this.cfg;
    const speed = this.speed;
    const fwd = this.fwd.clone();
    const rho = Math.exp(-this.pos.y / 9500);
    // ---- speed dynamics
    const hasFuel = this.fuel > 0;
    const dmgFactor = this.damage > 60 ? 0.65 : 1;
    const thrEff = 0.07 + 0.93 * this.throttle;
    let thrustA = hasFuel ? (cfg.maxThrust * thrEff + (this.ab ? cfg.abBoost : 0)) * (0.35 + 0.65 * rho) * dmgFactor : 0;
    // the original pins out at exactly 40,960 ft — fade thrust to nothing there
    if (this.pos.y > 11000) thrustA *= clamp(1 - (this.pos.y - 11000) / 1487, 0, 1);
    let drag = cfg.dragK * rho * speed * speed;
    if (this.gearDown) drag += cfg.dragK * rho * speed * speed * 0.9 + 0.5;
    if (this.brakes) drag += cfg.dragK * rho * speed * speed * 1.4; // speedbrake
    drag += Math.abs(this.pitchRate) * speed * 0.06;                 // turn bleed (induced)
    const gAlong = -9.81 * fwd.y;
    let newSpeed = Math.max(0, speed + (thrustA - drag + gAlong) * dt);
    // ---- control rates
    const authority = clamp(newSpeed / cfg.stall, 0.12, 1);
    const pitchMax = Math.min(1.05, cfg.gMax * 9.81 / Math.max(newSpeed, 75)) * authority;
    const rollMax = cfg.maxRoll * clamp(newSpeed / 90, 0.25, 1);
    this.stalled = newSpeed < cfg.stall && this.pos.y > 5;
    // bank angle relative to the horizon — drives the banked-lift physics below
    const _rgt = _v3.set(1, 0, 0).applyQuaternion(this.quat);
    const _upv = _v4.set(0, 1, 0).applyQuaternion(this.quat).y;
    const bankNow = Math.atan2(-_rgt.y, _upv);
    let pitchIn = inp.pitch * pitchMax;
    if (this.stalled) pitchIn -= 0.5 * (1 - newSpeed / cfg.stall); // nose drops
    // spiral mode: with the lift vector tilted there is no vertical force
    // holding the nose up — it drops through the horizon unless the pilot
    // keeps back-pressure on. Gentle: strong values couple into the heading
    // and fight the coordinated turn.
    else pitchIn -= (1 - Math.cos(bankNow)) * 0.10;
    this.pitchRate = damp(this.pitchRate, -pitchIn, 7, dt);           // -X = nose up
    // nose = +Z convention: the pilot's right hand is local -X, so a
    // positive rotation about +Z raises the +X (left) wing = bank right
    this.rollRate  = damp(this.rollRate, inp.roll * rollMax, 7, dt);  // +Z = right roll
    this.yawRate   = damp(this.yawRate, -inp.yaw * 0.35 * authority, 6, dt); // -Y = nose right
    _e.set(this.pitchRate * dt, this.yawRate * dt, this.rollRate * dt, 'XYZ');
    _dq.setFromEuler(_e);
    this.quat.multiply(_dq).normalize();
    // ---- velocity aligns to nose (coordinated arcade model)
    const newFwd = _v.set(0, 0, 1).applyQuaternion(this.quat);
    const alignRate = 3.2 * clamp(newSpeed / cfg.stall * 0.55, 0.18, 1);
    const curDir = _v2.copy(this.vel).normalize();
    if (curDir.lengthSq() < 0.5) curDir.copy(newFwd);
    curDir.lerp(newFwd, 1 - Math.exp(-alignRate * dt)).normalize();
    this.vel.copy(curDir).multiplyScalar(newSpeed);
    // ---- banked-lift turn & sink (flight dynamics): the wings' lift acts
    // along the aircraft's up axis, so in a bank its horizontal component
    // curves the flight path — the coordinated turn, ω = g·tanφ/v — while
    // its reduced vertical component lets the flight path sag. Roll 45° and
    // the jet turns and sinks on its own; hold altitude with back-stick.
    let turnW = 0;
    if (!this.stalled && Math.abs(bankNow) > 0.01) {
      turnW = clamp(9.81 * Math.tan(bankNow) / Math.max(newSpeed, cfg.stall * 0.9), -1.2, 1.2);
      _dq.setFromAxisAngle(_Y, turnW * dt);
      this.quat.premultiply(_dq).normalize();
      this.vel.y -= 9.81 * (1 - Math.cos(bankNow)) * 0.85 * dt;
    }
    if (this.stalled) this.vel.y -= 9.81 * Math.pow(1 - newSpeed / cfg.stall, 2) * 3.2 * dt;
    // G estimate for HUD / blackout / contrails (stick pull + turn load)
    this.gForce = 1 + Math.abs(this.pitchRate) * newSpeed / 9.81 * 0.9 + Math.abs(turnW) * newSpeed / 9.81 * 0.9;
    this.pos.addScaledVector(this.vel, dt);
    // mach meter + sonic boom on the transition
    const a = Math.max(295, 340.3 - 3.2 * (this.pos.y / 1000));  // speed of sound, m/s
    const mach = newSpeed / a;
    if (G && ((this._mach < 1 && mach >= 1) || (this._mach >= 1 && mach < 1)) && !this.dead) G.onMachCross(mach >= 1);
    this._mach = mach;
    // the original pins out at exactly 40,960 ft
    if (this.pos.y > cfg.ceiling) { this.pos.y = cfg.ceiling; if (this.vel.y > 0) this.vel.y = 0; }
    // wingtip contrails when pulling hard — a signature of the original's demo
    this.contrailT -= dt;
    if (this.gForce > 2.3 && this.speed > 90 && this.contrailT <= 0 && G && G.fx) {
      this.contrailT = 0.045;
      for (const s of [-1, 1]) {
        _v.set(s * 4.3, 0.25, -1.2).applyQuaternion(this.quat).add(this.pos);
        G.fx.contrail(_v);
      }
    }
    this._collide(G);
  }

  _collide(G) {
    const p = this.pos;
    const carrier = this.world.carrier;
    // --- carrier deck touchdown
    const loc = carrier.toLocal(p, _v);
    // deck footprint = the hull deck plus the port-side angle-deck sponson
    const onSponson = !carrier.isSub && loc.x >= 30 && _inTri(loc.x, loc.z, 38, -16.3, 59.5, 106.8, 38, 116);
    if ((Math.abs(loc.x) < carrier.deckHalfWid && loc.z > -carrier.deckHalfLen - 10 && loc.z < carrier.deckHalfLen + 10) || onSponson) {
      if (loc.y < 2.6 && loc.y > -3) {
        // over the deck — attempt trap / bolter / deck landing
        const dv = carrier.deckVelWorld(_v2);
        const relV = this.vel.clone().sub(dv);
        const vy = this.vel.y;
        if (vy < 1.5 && relV.length() < 105 && this.gearDown) {
          if (this.hookDown && loc.z > -60) {
            // TRAP!
            this.onGround = { type: 'carrier', speedRel: relV.length() * 0.999, trapped: true };
            this.deckLocal = new THREE.Vector3(loc.x, 2.2, loc.z);
            this.heading = carrier.heading;
            this.throttle = 0; this.brakes = true;
            G.onTrapped();
            return;
          } else {
            // bolter / no hook — touch and go, weak brakes
            this.onGround = { type: 'carrier', speedRel: relV.length() };
            this.deckLocal = new THREE.Vector3(loc.x, 2.2, Math.max(loc.z, -carrier.deckHalfLen + 1));
            this.heading = carrier.heading;
            G.msg('BOLTER! NO WIRE — FULL POWER, GO AROUND!', 'warn');
            return;
          }
        } else if (!this.gearDown && vy < 1) {
          G.onCrashed('GEAR-UP DECK LANDING');
          return;
        }
      } else if (loc.y <= -3 && loc.y > -24) {
        G.onCrashed('HIT THE CARRIER HULL');
        return;
      }
    }
    // carrier island
    if (!carrier.isSub) {
      const il = carrier.toLocal(p, _v);
      if (Math.abs(il.x + 30) < 9 && Math.abs(il.z - 30) < 17 && il.y < 42 && il.y > -3) {
        G.onCrashed('HIT THE ISLAND'); return;
      }
    }
    // --- runway touchdown
    if (this.vel.y < 2) {
      for (const rw of this.world.runways) {
        const dx = p.x - rw.x, dz = p.z - rw.z;
        const along = dx * Math.sin(rw.hdg) - dz * Math.cos(rw.hdg);
        const cross = dx * Math.cos(rw.hdg) + dz * Math.sin(rw.hdg);
        if (Math.abs(along) < rw.len / 2 + 60 && Math.abs(cross) < rw.wid / 2 + 18 && p.y < rw.elev + 3.0) {
          if (this.vel.y > -11 && this.gearDown && this.speed < 110) {
            this.onGround = { type: 'runway', rw, speedRel: this.speed };
            this.heading = Math.atan2(this.vel.x, -this.vel.z);
            this.throttle = Math.min(this.throttle, 0.3);
            this.vel.y = 0;
            G.msg('TOUCHDOWN — ' + rw.name, 'good');
            G.audio.trap();
          } else if (!this.gearDown) { G.onCrashed('GEAR-UP LANDING'); }
          else if (this.vel.y <= -11) { G.onCrashed('HARD LANDING'); }
          return;
        }
      }
    }
    // --- terrain / water
    const gh = groundHeight(p.x, p.z);
    if (gh < -2) { if (p.y < 1.6) { G.onCrashed('DITCHED IN THE SEA'); return; } }
    else if (p.y < gh + 2.0) { G.onCrashed('TERRAIN IMPACT'); return; }
    // --- buildings / bridges
    if (p.y < 700) {
      const cols = this.world.colliders;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (p.x > c.min.x && p.x < c.max.x && p.y > c.min.y && p.y < c.max.y && p.z > c.min.z && p.z < c.max.z) {
          G.onCrashed('STRUCTURE IMPACT'); return;
        }
      }
    }
  }

  _updateDead(dt, G) {
    // uncontrolled spin down, trailing smoke
    this.crashTimer += dt;
    _e.set(0.8 * dt, 0.3 * dt, this.spinDir * 2.6 * dt, 'XYZ');
    _dq.setFromEuler(_e); this.quat.multiply(_dq).normalize();
    this.vel.y -= 9.81 * dt * 0.8;
    this.vel.multiplyScalar(1 - 0.12 * dt);
    this.pos.addScaledVector(this.vel, dt);
    const gh = groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y < gh + 2) G.onCrashed('SHOT DOWN');
  }
  _updateBallistic(dt, G) {
    // ejected while parked — the jet just sits there with its engine cut
    // (and still rides the ship if it was left on the deck)
    if (this._deckRide) {
      this.pos.copy(carrierLocalToWorld(this.world.carrier, this._deckRide.x, this._deckRide.y, this._deckRide.z));
      return;
    }
    if (this.modelDown) return;
    if (this._parkedEject) { this.modelDown = true; return; }
    this.vel.y -= 9.81 * dt;
    this.pos.addScaledVector(this.vel, dt);
    _e.set(0.5 * dt, 0, 1.2 * dt, 'XYZ'); _dq.setFromEuler(_e); this.quat.multiply(_dq).normalize();
    const gh = groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y < gh + 2) { this.modelDown = true; G.onEmptyPlaneDown(); }
  }

  _syncVisual(dt, inp = {}) {
    this.model.position.copy(this.pos);
    this.model.quaternion.copy(this.quat);
    const u = this.model.userData;
    if (u.gear) u.gear.visible = this.gearDown;
    if (u.hook) u.hook.visible = this.hookDown;
    for (const f of u.ab) {
      f.visible = this.ab && !this.dead;
      if (f.visible) { const s = 0.8 + Math.random() * 0.5; f.scale.set(s, s, 0.8 + Math.random() * 0.8); }
    }
    if (u.stabL) { const a = (inp.pitch || 0) * -0.5; u.stabL.rotation.x = a; u.stabR.rotation.x = a; }
    // store visuals
    if (u.stores) {
      u.stores.aim9.forEach((m, i) => m.visible = i < this.stores.aim9);
      u.stores.aim120.forEach((m, i) => m.visible = i < this.stores.aim120);
    }
  }
}

// helper kept here to match world.Carrier convention
export function carrierLocalToWorld(c, lx, ly, lz, out = new THREE.Vector3()) {
  const ch = Math.cos(c.heading), sh = Math.sin(c.heading);
  out.set(-lx * ch + lz * sh, ly + c.deckY + c.group.position.y, -lx * sh - lz * ch);
  out.x += c.group.position.x; out.z += c.group.position.z;
  return out;
}

// Chute — the ejected pilot drifting down under a canopy, like the original:
// a second of free fall in the seat, then the dome opens overhead and he
// sways his way down to the sea (or the hills, if he's lucky)
export class Chute {
  constructor(scene, pos, vel, groundY) {
    this.group = new THREE.Group();
    const LM = (c) => new THREE.MeshLambertMaterial({ color: c });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.6), LM(0x2e3238));
    seat.position.y = 0.5; this.group.add(seat);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.35), LM(0x5a6242));
    torso.position.y = 1.25; this.group.add(torso);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), LM(0xe8e8e8));
    helmet.position.y = 1.8; this.group.add(helmet);
    this.canopy = new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xf2f2ee, side: THREE.DoubleSide }));
    this.canopy.position.y = 4.6;
    this.canopy.scale.setScalar(0.12);          // still packed
    this.group.add(this.canopy);
    // shroud lines from the canopy rim to the seat
    const lv = [];
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      lv.push(Math.cos(a) * 3.1, 4.75, Math.sin(a) * 3.1, 0, 1.0, 0);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lv, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x30343a }));
    this.group.add(this.lines);
    this.group.position.copy(pos); this.group.position.y += 2.5;
    this.vel = vel.clone();
    this.groundY = groundY;             // deck height when ejecting on the carrier
    this.t = 0; this.landed = false; this._scene = scene;
    scene.add(this.group);
  }
  update(dt, G) {
    if (this.landed) return;
    this.t += dt;
    const v = this.vel, p = this.group.position;
    if (this.t < 1.1) {                 // seat separation: ballistic with drag
      v.y -= 9.81 * dt;
      v.multiplyScalar(1 - 0.22 * dt);
    } else {                            // canopy open: settle to a slow descent
      const k = Math.min(1, (this.t - 1.1) / 0.5);
      this.canopy.scale.set(0.12 + 0.88 * k, 0.12 + 0.60 * k, 0.12 + 0.88 * k);
      this.lines.visible = k > 0.6;
      v.y += (-7.5 - v.y) * Math.min(1, 2.0 * dt);
      v.x += (5.0 - v.x) * Math.min(1, 0.5 * dt);   // weather-vane downwind
      v.z += (0.0 - v.z) * Math.min(1, 0.5 * dt);
      this.group.rotation.z = Math.sin(this.t * 1.15) * 0.11;   // pendulum sway
      this.group.rotation.x = Math.sin(this.t * 0.85 + 1.3) * 0.08;
    }
    p.addScaledVector(v, dt);
    if (G && G.audio) G.audio.updateChute(v.y);   // the rush of air, not the engine
    const gh = this.groundY !== undefined ? this.groundY : Math.max(groundHeight(p.x, p.z), 0);
    if (p.y <= gh + 0.3) {
      p.y = gh + 0.3;
      this.landed = true;
      this.canopy.scale.set(1, 0.25, 1); this.canopy.position.y = 1.4;   // canopy collapses
      this.group.rotation.set(0, 0, 0);
      if (G && G.audio) G.audio.chuteLand();
      if (G && G.msg) G.msg(this.groundY !== undefined ? 'PILOT DOWN ON THE DECK'
        : groundHeight(p.x, p.z) > 0 ? 'PILOT DOWN ON TERRA FIRMA' : 'PILOT IN THE DRINK — SAR INBOUND', 'info');
    }
  }
  dispose() { this._scene.remove(this.group); }
}
