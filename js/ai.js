// ai.js — AI aircraft: waypoint routes, intercept, evade, attack, landing, cruise missiles
import * as THREE from 'three';
import { clamp, lerp, damp, wrapAngle, flightQuat, rand, KTS } from './util.js';
import { groundHeight } from './world.js';
import { buildModel } from './models.js';

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Euler(), _dq = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

export class AIAircraft {
  constructor(scene, world, type, opts = {}) {
    this.scene = scene; this.world = world; this.type = type;
    this.model = buildModel(type, opts.livery);
    scene.add(this.model);
    this.pos = this.model.position;
    this.pos.copy(opts.pos || new THREE.Vector3());
    this.heading = opts.heading ?? 0;
    this.speed = opts.speed ?? 220;
    this.targetSpeed = this.speed;
    this.hp = opts.hp ?? ({ b747: 400, b744: 420, dc10: 300, b737: 200, md90: 180, cruise: 60, tu95: 380 }[type] || 100);
    this.hostile = opts.hostile ?? false;
    this.identified = false;
    this.name = opts.name || type.toUpperCase();
    this.mode = opts.mode || 'route';
    this.waypoints = opts.waypoints || [];
    this.wpIndex = 0; this.loop = opts.loop ?? false;
    this.agility = opts.agility ?? 1.0;      // turn-rate multiplier
    this.skill = opts.skill ?? 1.0;          // evade/attack skill
    this.target = null;                      // attack target (AIAircraft or Player)
    this.fireCooldown = rand(2, 5);
    this.evasionT = 0; this.evadeDir = null; this.flareT = -9; this.chaffT = -9;
    this.maneuver = null;                    // active aerobatic maneuver (aces)
    this._attackWeaveT = rand(2, 4);         // idle weave timer in the attack
    this._offBoresightT = 0;                 // how long the shot isn't coming
    this.dead = false; this.removeMe = false; this.deadT = 0;
    this.landed = false; this.landSpeed = 0;
    this.bank = 0; this.pitch = 0;
    this.terrainFollow = opts.terrainFollow ?? false;
    this.surface = opts.surface ?? false;      // sits on the water (raft, sub)
    this.gunsOnly = opts.gunsOnly ?? false;
    this.noEvade = opts.noEvade ?? false;
    this.onEvent = opts.onEvent || null;     // cb(name, data) for missions
    this.quat = new THREE.Quaternion();
    this.quat.copy(flightQuat(this.heading, 0, 0));
    this.vel = new THREE.Vector3();
    this._syncVel();
    this.spinDir = Math.random() < 0.5 ? 1 : -1;
  }
  _syncVel() {
    this.vel.set(Math.sin(this.heading) * Math.cos(this.pitch) * this.speed,
                 Math.sin(this.pitch) * this.speed,
                 -Math.cos(this.heading) * Math.cos(this.pitch) * this.speed);
  }
  get alive() { return !this.dead; }
  fwd(out = _v) { return out.set(Math.sin(this.heading) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.heading) * Math.cos(this.pitch)); }

  // steer current heading/pitch toward desired direction, limited turn rate
  _steerToward(dir, dt, turnMul = 1) {
    const f = this.fwd(_v);
    const angle = f.angleTo(dir);
    if (angle > 1e-4) {
      const maxTurn = clamp(7.5 * 9.81 / Math.max(this.speed, 60), 0.25, 1.35) * this.agility * turnMul;
      const t = Math.min(1, maxTurn * dt / angle);
      f.lerp(dir, t).normalize();
      this.heading = Math.atan2(f.x, -f.z);
      this.pitch = Math.asin(clamp(f.y, -1, 1));
      // bank into the turn (visual)
      const cross = _d.set(f.x, 0, f.z).cross(dir).y;
      this.bank = damp(this.bank, clamp(angle * Math.sign(cross || 1) * 1.2, -1.2, 1.2), 3, dt);   // roll into the turn (right turn: cross<0, and flightQuat banks right for b<0)
    } else {
      this.bank = damp(this.bank, 0, 3, dt);
    }
  }

  update(dt, G) {
    if (this.dead) { this._updateDead(dt, G); return; }
    if (this.maneuver) this._updateManeuver(dt, G);
    else switch (this.mode) {
      case 'route': this._updateRoute(dt, G); break;
      case 'intercept': this._updateIntercept(dt, G); break;
      case 'attack': this._updateAttack(dt, G); break;
      case 'orbit': this._updateOrbit(dt, G); break;
      case 'land': this._updateLand(dt, G); break;
      case 'straight': this._updateStraight(dt, G); break;
    }
    // terrain following (cruise missile)
    if (this.terrainFollow) {
      const gh = groundHeight(this.pos.x, this.pos.z);
      const want = Math.max(gh + 58, 20);
      this.pos.y = damp(this.pos.y, want, 1.2, dt);
    }
    // flare/chaff timers age naturally by comparison with G.time
    this.speed = damp(this.speed, this.targetSpeed, 0.5, dt);
    this._syncVel();
    this.pos.addScaledVector(this.vel, dt);
    if (this.landed) this.pos.y = this.landY;
    // ground collision (non-landing)
    if (this.mode !== 'land' && !this.surface) {
      const gh = groundHeight(this.pos.x, this.pos.z);
      if (this.pos.y < gh + 4 || this.pos.y < 2) {
        if (this.terrainFollow) this.pos.y = Math.max(gh + 4, 3);
        else this.kill(G, true);
      }
    }
    // evade when locked / missile inbound
    if (!this.noEvade && !this.dead && this.mode !== 'land') this._checkThreats(dt, G);
    this._syncModel(dt);
  }

  _updateRoute(dt, G) {
    if (!this.waypoints.length) return;
    const wp = this.waypoints[this.wpIndex];
    _d.set(wp.x - this.pos.x, wp.y - this.pos.y, wp.z - this.pos.z);
    const dist = _d.length();
    if (dist < Math.max(700, this.speed * 2.2)) {
      this.wpIndex++;
      if (this.wpIndex >= this.waypoints.length) {
        if (this.loop) this.wpIndex = 0;
        else { this.wpIndex = this.waypoints.length - 1; if (this.onEvent) this.onEvent('routeDone', this); }
      }
      if (this.onEvent) this.onEvent('waypoint', this);
    }
    _d.normalize();
    this._steerToward(_d, dt);
  }
  _updateIntercept(dt, G) {
    const t = this.target;
    if (!t || (t.dead) || (t.ejected)) { this.mode = 'route'; return; }
    // pure pursuit with lead
    const tv = t.vel || _d.set(0,0,0);
    _d.copy(t.pos).addScaledVector(tv, clamp(this.pos.distanceTo(t.pos) / 600, 0, 2.5)).sub(this.pos).normalize();
    this._steerToward(_d, dt);
    if (this.onEvent) this.onEvent('intercepting', this);
  }
  _updateAttack(dt, G) {
    const t = this.target;
    if (!t || t.dead || t.ejected) { this.mode = 'route'; this.target = null; return; }
    const dist = this.pos.distanceTo(t.pos);
    // skilled pilots never hold a straight pursuit: they weave on the way in,
    // and if the shot isn't coming they reverse hard — loop or split-S back
    // onto the target's tail for the kill shot
    if (this.skill >= 1.25 && !this.maneuver) {
      const f = this.fwd(_v);
      _d.copy(t.pos).sub(this.pos).normalize();
      const ang = f.angleTo(_d);
      if (ang > 0.7) this._offBoresightT += dt; else this._offBoresightT = 0;
      this._attackWeaveT -= dt;
      if (this._offBoresightT > 2.2) {
        this._offBoresightT = 0;
        const agl = this.pos.y - groundHeight(this.pos.x, this.pos.z);
        const kind = agl > 950 && Math.random() < 0.5 ? 'loop' : (agl > 750 ? 'splitS' : 'break');
        this._startManeuver(kind, G, t.pos);
        return;
      }
      if (this._attackWeaveT <= 0 && dist > 2500) {
        this._attackWeaveT = rand(2.2, 4.0) / this.skill;
        this._startManeuver(Math.random() < 0.6 ? 'jink' : 'barrel', G, t.pos);
        return;
      }
    } else if (this.skill >= 0.8 && !this.maneuver) {
      this._attackWeaveT -= dt;
      if (this._attackWeaveT <= 0 && dist > 3000) {
        this._attackWeaveT = rand(3.0, 5.0) / this.skill;
        this._startManeuver('jink', G, t.pos);
        return;
      }
    }
    // pursue
    _d.copy(t.pos).addScaledVector(t.vel, clamp(dist / 600, 0, 2.5)).sub(this.pos).normalize();
    this._steerToward(_d, dt);
    this.targetSpeed = dist > 4000 ? 320 : 260;
    // fire?
    this.fireCooldown -= dt;
    const maxR = t.ecm ? 5200 : 11000;   // ECM jammer cuts their lock range
    if (this.fireCooldown <= 0 && !this.gunsOnly && dist > 1200 && dist < maxR) {
      const f = this.fwd(_v);
      _d.copy(t.pos).sub(this.pos).normalize();
      if (f.angleTo(_d) < 0.6) {
        G.fireEnemyMissile(this, t);
        this.fireCooldown = rand(9, 16) / this.skill;
      }
    }
  }
  _updateOrbit(dt, G) {
    const c = this.orbitCenter || this.waypoints[0];
    const r = this.orbitRadius || 6000;
    _d.set(this.pos.x - c.x, 0, this.pos.z - c.z);
    const ang = Math.atan2(_d.x, -_d.z) + 0.28;
    const nx = c.x + Math.sin(ang) * r, nz = c.z - Math.cos(ang) * r;
    _d.set(nx - this.pos.x, (c.y || this.pos.y) - this.pos.y, nz - this.pos.z).normalize();
    this._steerToward(_d, dt);
  }
  _updateLand(dt, G) {
    // follow waypoints to threshold, then roll out
    if (this.landed) {
      this.landSpeed = Math.max(0, this.landSpeed - 6 * dt);
      this.speed = this.landSpeed;
      this.pitch = 0;
      if (this.landSpeed <= 0 && this.onEvent) { this.onEvent('landed', this); this.onEvent = null; }
      return;
    }
    this._updateRoute(dt, G);
    const wp = this.waypoints[this.waypoints.length - 1];
    const d = Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z);
    this.targetSpeed = clamp(d / 12, 65, this.speed);
    if (d < 120 && Math.abs(this.pos.y - wp.y) < 12) {
      this.landed = true; this.landSpeed = Math.max(60, this.speed);
      this.landY = wp.y;
      this.pos.y = wp.y;
      this.speed = this.landSpeed;
      if (this.onEvent) this.onEvent('touchdown', this);
    }
  }
  _updateStraight(dt, G) {
    _d.set(Math.sin(this.heading), 0, -Math.cos(this.heading));
    // gentle weave
    this.weaveT = (this.weaveT || 0) + dt;
    const w = Math.sin(this.weaveT * 0.5) * 0.08;
    _d.applyAxisAngle(new THREE.Vector3(0, 1, 0), w);
    this._steerToward(_d, dt, 0.6);
  }

  // ---- aerobatic maneuver library (skilled bandits) ------------------------
  // break: hard 90-degree turn onto the threat's beam. jink: snap-roll
  // S-turns. splitS: roll inverted, pull through, out the other way. loop:
  // over the top and back down the hill. barrel: a full aileron roll that
  // keeps rough heading. Aces chain these so they never fly straight.
  _startManeuver(kind, G, threatPos) {
    if (this.maneuver || this.terrainFollow || this.surface || this.landed) return;
    const m = { kind, t: 0, side: Math.random() < 0.5 ? 1 : -1, baseHdg: this.heading };
    const f = this.fwd(new THREE.Vector3());
    if (kind === 'break') {
      m.dur = rand(1.4, 2.0);
      // turn onto the beam of whatever is threatening us (away from it)
      let a = m.side * Math.PI / 2 * rand(0.85, 1.15);
      if (threatPos) {
        _d.copy(threatPos).sub(this.pos).normalize();
        const c = f.x * _d.z - f.z * _d.x;   // >0: threat off the right wing
        a = (c > 0 ? -1 : 1) * Math.PI / 2 * rand(0.85, 1.15);
      }
      m.dir = f.applyAxisAngle(_up, a);
      m.dir.y = 0.12; m.dir.normalize();
    } else if (kind === 'jink') {
      m.dur = rand(1.8, 2.6); m.flipT = 0;
    } else if (kind === 'splitS') {
      m.dur = rand(2.6, 3.2);
    } else if (kind === 'loop') {
      m.dur = rand(4.4, 5.2);
    } else { // barrel
      m.dur = rand(2.2, 2.8);
    }
    this.maneuver = m;
    if (this.onEvent) this.onEvent('maneuver', { unit: this, kind });
  }
  _updateManeuver(dt, G) {
    const m = this.maneuver;
    m.t += dt;
    const f = this.fwd(_v);
    // never aerobatic into the dirt — pull out early
    const agl = this.pos.y - groundHeight(this.pos.x, this.pos.z);
    if (agl < 300 && (m.kind === 'splitS' || (m.kind === 'loop' && m.t > m.dur * 0.5))) {
      this.maneuver = null; this.bank = damp(this.bank, 0, 5, dt); this.pitch = Math.max(this.pitch, 0);
      return;
    }
    switch (m.kind) {
      case 'break': {
        this._steerToward(m.dir, dt, 1.7);
        this.bank = damp(this.bank, Math.sign(f.z * m.dir.x - f.x * m.dir.z) * 1.35, 5, dt);
        this.targetSpeed = Math.max(this.targetSpeed, 280);
        break;
      }
      case 'jink': {
        m.flipT -= dt;
        if (m.flipT <= 0) { m.flipT = 0.45; m.side *= -1; }
        _d.copy(f).applyAxisAngle(_up, m.side * 0.85);
        _d.y = clamp(_d.y + m.side * 0.1, -0.35, 0.35); _d.normalize();
        this._steerToward(_d, dt, 1.6);
        this.bank = damp(this.bank, m.side * 1.35, 6, dt);   // snap rolls between cuts
        this.targetSpeed = Math.max(this.targetSpeed, 270);
        break;
      }
      case 'splitS': {
        const ph = m.t / m.dur;
        if (ph < 0.25) {
          this.bank = damp(this.bank, m.side * Math.PI, 5, dt);   // roll inverted
        } else {
          const prog = clamp((ph - 0.25) / 0.6, 0, 1);
          const wantHdg = m.baseHdg + m.side * Math.PI * prog;
          _d.set(Math.sin(wantHdg), -0.85 * Math.sin(prog * Math.PI), -Math.cos(wantHdg)).normalize();
          this._steerToward(_d, dt, 1.6);
          this.bank = damp(this.bank, m.side * Math.PI * (1 - prog), 4, dt);
        }
        this.targetSpeed = Math.max(this.targetSpeed, 300);
        break;
      }
      case 'loop': {
        const ph = m.t / m.dur;
        const prof = Math.sin(ph * Math.PI * 2);   // up, over the top, back down
        _d.set(Math.sin(m.baseHdg), prof * 1.15, -Math.cos(m.baseHdg)).normalize();
        this._steerToward(_d, dt, 1.35);
        const apex = Math.max(0, 1 - Math.abs(ph - 0.3) / 0.16);
        this.bank = damp(this.bank, m.side * Math.PI * Math.min(1, apex * 1.7), 4, dt);
        this.targetSpeed = Math.max(this.targetSpeed, 260);
        break;
      }
      default: { // barrel — a full roll around the velocity vector
        const ph = m.t / m.dur;
        _d.copy(f).applyAxisAngle(_up, Math.sin(ph * Math.PI * 2) * 0.25);
        _d.y = clamp(_d.y + Math.cos(ph * Math.PI * 2) * 0.16, -0.4, 0.4); _d.normalize();
        this._steerToward(_d, dt, 1.2);
        this.bank = m.side * ph * Math.PI * 2;
        break;
      }
    }
    if (m.t >= m.dur) {
      this.maneuver = null;
      this.evasionT = rand(0.3, 0.9) / this.skill;   // chain another if still pressed
    }
  }

  _checkThreats(dt, G) {
    // evade if player's missile is inbound on us, or player locked & close behind
    let threatened = false;
    for (const m of G.missiles) {
      if (!m.dead && m.target === this && m.pos.distanceTo(this.pos) < 6000) { threatened = 'missile'; break; }
    }
    if (!threatened && G.playerTarget === this && G.lockLevel > 0.6) {
      const toMe = _d.copy(this.pos).sub(G.player.pos);
      const dist = toMe.length();
      if (dist < 9000) {
        const pf = G.player.fwd;
        if (pf.angleTo(toMe.normalize()) < 0.5) threatened = 'locked';
      }
    }
    if (threatened) {
      this.evasionT -= dt;
      if (this.evasionT <= 0 && !this.maneuver) {
        this.evasionT = rand(1.2, 2.4) / this.skill;
        const s = this.skill;
        const agl = this.pos.y - groundHeight(this.pos.x, this.pos.z);
        // threat position for break-side selection
        let threatPos = null;
        for (const m of G.missiles) if (!m.dead && m.target === this) { threatPos = m.pos; break; }
        if (!threatPos) threatPos = G.player.pos;
        if (s >= 1.25) {
          // ace: the full aerobatic library — hard to hit, never level for long
          const pool = threatened === 'missile'
            ? ['break', 'splitS', 'barrel', 'jink', 'loop']
            : ['jink', 'barrel', 'break', 'splitS'];
          let kind = pool[(Math.random() * pool.length) | 0];
          if (agl < 750 && (kind === 'splitS' || kind === 'loop')) kind = Math.random() < 0.5 ? 'break' : 'jink';
          this._startManeuver(kind, G, threatPos);
        } else if (s >= 0.8) {
          // regular: hard breaks and jinks
          this._startManeuver(Math.random() < 0.55 ? 'break' : 'jink', G, threatPos);
        } else {
          // rookie: a flat panicky turn
          const f = this.fwd(new THREE.Vector3());
          const ax = rand(0.7, 1.6) * (Math.random() < 0.5 ? 1 : -1);
          const ay = rand(-0.5, 0.5);
          this.evadeDir = f.applyAxisAngle(new THREE.Vector3(0, 1, 0), ax);
          this.evadeDir.y = clamp(this.evadeDir.y + ay, -0.5, 0.5);
          this.evadeDir.normalize();
        }
        if (threatened === 'missile' && Math.random() < 0.5 * this.skill) this.flareT = G.time;
        if (threatened === 'missile' && Math.random() < 0.4 * this.skill) this.chaffT = G.time;
        if (this.onEvent) this.onEvent('evade', this);
      }
      if (!this.maneuver && this.evadeDir) this._steerToward(this.evadeDir, dt, 1.4);
      this.targetSpeed = 300;
    }
  }

  hit(dmg, G, byPlayer = true) {
    if (this.dead) return;
    // civilian aircraft cannot be harmed by the player — not by gun, missile,
    // or bomb. The rounds pass through like the thought never occurred.
    // (Enemy weapons, byPlayer = false, still resolve normally.)
    if (byPlayer && this.kind === 'airliner') return;
    this.hp -= dmg;
    if (this.onEvent) this.onEvent('hit', this);
    if (this.hp <= 0) this.kill(G, false, byPlayer);
    else if (this.hp < 45) this.smoking = true;
  }
  kill(G, silent = false, byPlayer = true) {
    if (this.dead) return;
    this.dead = true; this.deadT = 0;
    this.mode = 'dead';
    if (!silent && this.onEvent) this.onEvent('killed', { unit: this, byPlayer });
    G.onAircraftDown(this, byPlayer);
  }
  _updateDead(dt, G) {
    this.deadT += dt;
    if (this.type === 'balloon') {
      // the envelope shreds on the first frames, then the payload truss
      // tumbles out of the sky on its own
      if (!this._shredded) {
        this._shredded = true;
        const u = this.model.userData;
        if (u.balloon) u.balloon.visible = false;
        G.fx.explosion(this.pos, 1.0);
        for (let i = 0; i < 8; i++) G.fx.smoke(this.pos, 2.5, 5, 0xf2f4f6);
      }
      this.vel.set(0, 0, 0);
      this.pos.y -= (14 + this.deadT * 6) * dt;
      this.model.rotation.x += 0.9 * dt; this.model.rotation.z += 0.6 * dt;
      if (this.pos.y < 2) { G.explode(this.pos.clone().setY(0), 1.6); G.fx.splash(this.pos.clone().setY(0), 2.2); this.removeMe = true; }
      return;
    }
    if (this.type === 'sub') {
      // the sub sinks stern-first under the waves
      this.vel.set(0, 0, 0);
      this.pos.y -= (3.5 + this.deadT) * dt;
      this.model.rotation.z += 0.04 * dt;
      if (Math.random() < 0.5) G.fx.smoke(this.pos.clone().setY(1), 1.2, 3, 0x333333);
      if (Math.random() < 0.3) G.fx.fire(this.pos.clone().setY(6), 0.8);
      if (this.pos.y < -30) { G.explode(this.pos.clone().setY(0), 2.5); this.removeMe = true; }
      return;
    }
    if (this.type === 'freighter') {
      // a big hull dies slowly: she takes on a list, settles by the bow,
      // burns amidships, and goes under forefoot-first
      this.vel.set(0, 0, 0);
      this.pos.y -= (0.55 + this.deadT * 0.16) * dt;
      this.model.rotation.z = Math.min(0.22, this.model.rotation.z + 0.012 * dt);
      this.model.rotation.x = Math.max(-0.16, this.model.rotation.x - 0.010 * dt);
      if (Math.random() < 0.6) G.fx.smoke(this.pos.clone().add(_v.set((Math.random() - 0.5) * 40, 10, (Math.random() - 0.5) * 90)), 2.2, 6, 0x2c2620);
      if (Math.random() < 0.4) G.fx.fire(this.pos.clone().add(_v.set(0, 8, (Math.random() - 0.5) * 60)), 1.2);
      if (this.pos.y < -26) { G.fx.splash(this.pos.clone().setY(0), 3.2); this.removeMe = true; }
      return;
    }
    if (this.type === 'fastboat') {
      // small and wooden-hearted: one puff, gone under
      this.vel.set(0, 0, 0);
      this.pos.y -= (2.5 + this.deadT * 1.5) * dt;
      this.model.rotation.z += 0.15 * dt;
      if (Math.random() < 0.4) G.fx.smoke(this.pos.clone().setY(1), 1.0, 2.5, 0x333333);
      if (this.pos.y < -6) { G.fx.splash(this.pos.clone().setY(0), 1.6); this.removeMe = true; }
      return;
    }
    // flat spin down with smoke & fire
    _e.set(0.9 * dt, 0.2 * dt, this.spinDir * 3.0 * dt, 'XYZ');
    _dq.setFromEuler(_e); this.quat.multiply(_dq).normalize();
    this.vel.y -= 9.81 * dt * 0.75;
    this.vel.multiplyScalar(1 - 0.1 * dt);
    this.pos.addScaledVector(this.vel, dt);
    if (Math.random() < 0.6) G.fx.smoke(this.pos, 0.8, 2.2, 0x333333);
    if (Math.random() < 0.35) G.fx.fire(this.pos, 0.5);
    const gh = groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y < Math.max(gh, 0) + 3) {
      G.explode(this.pos, 1.2);
      this.removeMe = true;
    }
  }
  _syncModel(dt) {
    if (!this.dead) this.quat.copy(flightQuat(this.heading, this.pitch, this.bank));
    this.model.quaternion.copy(this.quat);
    const u = this.model.userData;
    // gear: down on the ground and on final, up once airborne — the heavies
    // were cruising the bay with their wheels hanging out
    const agl = this.pos.y - Math.max(0, groundHeight(this.pos.x, this.pos.z));
    if (u.gear) {
      u.gear.visible = !this.dead && agl < 100 && this.speed < 95;
    }
    // control surfaces: ailerons follow the bank command (the bank rate IS the
    // stick here — bank>0 is a LEFT bank, so the left aileron rises), flaps
    // droop in the landing configuration on the same rule as the gear
    if (u.surf) {
      const dts = Math.max(dt, 1e-3);
      const bk = this.bank || 0;
      const rate = this.dead ? 0 : clamp((bk - (this._bankPrev ?? bk)) / dts / 2.2, -1, 1);
      this._bankPrev = bk;
      this._ailSm = damp(this._ailSm ?? 0, rate, 6, dts);
      this._flap01 = damp(this._flap01 ?? 0, (!this.dead && agl < 100 && this.speed < 95) ? 1 : 0, 2.4, dts);
      const ail = this._ailSm * 0.42;
      const flp = this._flap01 * -0.55;
      const s = u.surf;
      if (s.ail) { s.ail[0].rotation.x = ail; s.ail[1].rotation.x = -ail; }
      if (s.flaperon) { s.flaperon[0].rotation.x = ail + flp; s.flaperon[1].rotation.x = -ail + flp; }
      if (s.flap) { s.flap[0].rotation.x = flp; s.flap[1].rotation.x = flp; }
      if (s.spoiler) { s.spoiler[0].rotation.x = Math.max(0, ail) * 1.6; s.spoiler[1].rotation.x = Math.max(0, -ail) * 1.6; }
    }
    if (u.ab) for (const f of u.ab) {
      f.visible = !this.dead && this.targetSpeed > 240;
      if (f.visible) { const s = 0.7 + Math.random() * 0.5; f.scale.set(s, s, 0.7 + Math.random() * 0.6); }
    }
    // mission-spawned props and rotors keep turning (the ambient fleets spin
    // theirs in their own managers — an AIAircraft has to do it here)
    if (u.props && !this.dead) for (const p of u.props) p.rotation.z += dt * 42;
    if (u.rotor && !this.dead) { u.rotor.rotation.y += dt * 27; if (u.tailRotor) u.tailRotor.rotation.x += dt * 55; }
    if (u.rotorDisc) u.rotorDisc.visible = !this.dead && this.speed > 2;
    if (this.smoking && !this.dead && Math.random() < 0.25) {
      // light damage smoke handled by main via fx
    }
  }
  dispose() { this.scene.remove(this.model); }
}
