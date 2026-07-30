// attract.js — the homepage demo director. The old attract was one Hornet
// touring the bay at 210 knots; this is a twenty-four-scene cinematic reel
// that cuts between carrier ops, dogfights, the battle group, the heavies
// and the sub hunt — day, dusk and night — so the menu sells the world
// behind it.
import * as THREE from 'three';
import { AIAircraft } from './ai.js';
import { Missile, GunSystem } from './weapons.js';
import { Helicopter } from './rotors.js';
import { Chute } from './flight.js';
import { makeGlowTexture } from './models.js';
import { flightQuat, clamp, lerp, damp, rand } from './util.js';

let _abGlowTex = null;

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _look = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, 1);

// deck-local -> world helpers (the carrier steams at 7.7 m/s, so every
// deck-referenced point is re-evaluated through its live transform)
function deckP(carrier, x, y, z, out) { return out.set(x, y, z).applyMatrix4(carrier.group.matrixWorld); }
function deckD(carrier, x, y, z, out) { return out.set(x, y, z).transformDirection(carrier.group.matrixWorld); }
function headingOf(d) { return Math.atan2(d.x, -d.z); }

export class DemoDirector {
  constructor(G, scene) {
    this.G = G; this.scene = scene;
    this.actors = []; this.missiles = [];
    this.idx = -1; this.t = 0;
    this.data = {};              // per-scene scratch
    this._next();
  }
  dispose() { this._teardown(); }
  navJets() { return this.actors; }

  _spawn(type, opts = {}) {
    const j = new AIAircraft(this.scene, this.G.world, type, opts);
    j.scripted = true;                       // we drive pos/quat, not the AI
    if (j.model.userData.gear) j.model.userData.gear.visible = opts.gear !== false;
    this._ab(j, !!opts.ab);
    this.actors.push(j);
    return j;
  }
  _ab(j, on) {
    const u = j.model.userData;
    for (const f of (u.ab || [])) f.visible = on;
    // burner glow sprites — readable from any angle, day or night
    if (on && !u.abGlow && (u.ab || []).length) {
      _abGlowTex = _abGlowTex || makeGlowTexture('rgba(255,235,200,1)', 'rgba(255,120,20,0)');
      u.abGlow = u.ab.map((f) => {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: _abGlowTex, color: 0xffa030, transparent: true, opacity: 0.95,
          depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
        }));
        sp.position.copy(f.position); sp.position.z += 0.6;
        sp.scale.setScalar(6);
        f.parent.add(sp);
        return sp;
      });
    }
    if (u.abGlow) for (const sp of u.abGlow) sp.visible = on;
  }
  _place(j, x, y, z, h, p, b) {
    j.pos.set(x, y, z);
    j.heading = h; j.pitch = p; j.bank = b;
    j.quat.copy(flightQuat(h, p, b));
  }
  _fire(owner, target, type) {
    const m = new Missile(this.G, owner, type, target);
    owner.speed = owner.speed || 220;
    this.missiles.push(m);
    this.G.audio.missileFire();            // the whoosh sells every launch
    return m;
  }
  // reel voice: scenes call this every frame with the engine the camera
  // rides ('jet' | 'prop' | 'turbofan'); nothing called = silence
  _spec(kind, rpm = 0.7) { this._svKind = kind; this._svRpm = rpm; }
  _teardown() {
    if (this.idx >= 0 && SCENES[this.idx].teardown) SCENES[this.idx].teardown(this);
    for (const a of this.actors) a.dispose();
    this.actors = [];
    for (const m of this.missiles) if (!m.dead) m._die();
    this.missiles = [];
    this.data = {};
    this.G.audio.specTick(null);
    this.G.audio.setGatling(false);
  }
  _next() {
    this._teardown();
    this.idx = (this.idx + 1) % SCENES.length;
    this.t = 0;
    SCENES[this.idx].setup(this);
    if (this.G.flashCut) this.G.flashCut(0.22);
  }
  update(dt) {
    this.t += dt;
    const s = SCENES[this.idx];
    s.update(this, dt);
    this.G.audio.specTick(this._svKind || null, this._svRpm || 0);
    this._svKind = null;
    for (const m of this.missiles) if (!m.dead) m.update(dt);
    for (const a of this.actors) {
      a.model.quaternion.copy(a.quat);
      // burner flames get the cinematic treatment — bigger and angrier than gameplay
      const u = a.model.userData, ab = u.ab;
      if (ab) for (const f of ab) if (f.visible) { const s = 1.5 + Math.random() * 0.9; f.scale.set(s, s, 1.3 + Math.random() * 1.2); }
      if (u.abGlow) for (const sp of u.abGlow) if (sp.visible) sp.scale.setScalar(5 + Math.random() * 3);
    }
    if (this.t >= s.dur) this._next();
  }
  driveCamera(dt, camPos, camera) {
    SCENES[this.idx].cam(this, dt, camPos, camera);
  }
  // smooth camera helper: damp toward a point, look at a point
  _chase(dt, camPos, camera, tx, ty, tz, lx, ly, lz, rate = 2.2, fov = 58) {
    camPos.x = damp(camPos.x, tx, rate, dt);
    camPos.y = damp(camPos.y, Math.max(ty, 6), rate, dt);
    camPos.z = damp(camPos.z, tz, rate, dt);
    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(_look.set(lx, ly, lz));
    camera.fov = damp(camera.fov, fov, 2, dt); camera.updateProjectionMatrix();
  }
}

// ---------------- scene 1: night catapult shot ----------------
const Catapult = {
  name: 'catapult', dur: 10,
  setup(A) {
    A.G.world.setTimeOfDay('night');
    const j = A._spawn('f18', { ab: true, gear: true });
    j.speed = 0;
    A.data = { j, steamT: 0, launched: false };
  },
  update(A, dt) {
    const D = A.data, c = A.G.world.carrier, t = A.t, Y = c.deckY + 2.2;
    A._spec('jet', t < 2 ? 0.35 : 1.05);         // idle to full blower
    deckD(c, 0, 0, 1, _w);                       // bow direction in the world
    const h = headingOf(_w);
    if (t < 2) {                                 // tension on the cat
      deckP(c, -13, Y, 30, _v);
      A._place(D.j, _v.x, _v.y, _v.z, h, 0, 0);
      D.steamT -= dt;
      if (D.steamT <= 0) {
        D.steamT = 0.22;
        deckP(c, -13, c.deckY + 1, 24, _v);
        A.G.fx.smoke(_v, 0.9, 1.4, 0xdfe8f2);
      }
    } else if (t < 4.1) {                        // the shot: 0 -> 78 m/s in 128 m
      if (!D.launched) { D.launched = true; deckP(c, -13, Y, 32, _v); A.G.fx.flash(_v, 10, 0xffa030, 0.3); A.G.audio.catapult(); }
      const u = (t - 2) / 2.1;
      deckP(c, -13, Y, 30 + 128 * u * u, _v);
      A._place(D.j, _v.x, _v.y, _v.z, h, 0.02, 0);
      D.j.speed = 78 * u;
    } else {                                     // off the bow and climbing
      const u = t - 4.1;
      const dist = 158 + 78 * u, climb = 0.19 * Math.min(1, u * 1.6);
      deckP(c, -13, Y + Math.sin(climb) * 78 * u * 0.9, dist, _v);
      const bank = t > 8 ? -0.3 * Math.min(1, (t - 8) / 2) : 0;
      A._place(D.j, _v.x, _v.y, _v.z, h + bank * 0.6, climb, bank);
      D.j.speed = 78;
      if (t > 5.6 && D.j.model.userData.gear) D.j.model.userData.gear.visible = false;
    }
  },
  cam(A, dt, camPos, camera) {
    const D = A.data, c = A.G.world.carrier, t = A.t, k = t01(t, 10);
    // one full lap round the boat: starts dead astern on the cat line,
    // swings right (past the island, round the bow as he launches, down
    // the port side and home) — the radius and height keep growing the
    // whole way, so the Enterprise swells from jet close-up to full-length
    const phi = k * Math.PI * 2;
    const r = 55 + k * 300, h = c.deckY + 9 + k * 135;
    deckP(c, -13 - Math.sin(phi) * r, h, 40 - Math.cos(phi) * r, _v);
    // eyes on the jet until he's away, then on the island for the reveal
    const m = t01(t - 3.4, 2.8);
    deckP(c, 20, c.deckY + 26, 0, _w);
    A._chase(dt, camPos, camera, _v.x, _v.y, _v.z,
      lerp(D.j.pos.x, _w.x, m), lerp(D.j.pos.y + 2, _w.y, m), lerp(D.j.pos.z, _w.z, m),
      3.2, 58);
  },
};

// ---------------- scene 2: the furball ----------------
const Furball = {
  name: 'furball', dur: 12,
  setup(A) {
    A.G.world.setTimeOfDay('day');
    const f18 = A._spawn('f18', { ab: false, gear: false, name: 'VIPER' });
    const mig = A._spawn('mig29', { ab: true, gear: false, hostile: true, name: 'BANDIT' });
    f18.speed = mig.speed = 235;
    A.data = { f18, mig, C: new THREE.Vector3(-15000, 1200, 8000), fired1: false, flared: false, fired2: false, killT: 0, splashed: false, m1: null, phi: 0.8 };
  },
  update(A, dt) {
    const D = A.data, t = A.t, G = A.G;
    A._spec('jet', t > 8 ? 1.05 : 0.85);         // burner for the kill shot
    const orbit = (j, phase, r, wob) => {
      const th = phase + t * 0.34;
      const x = D.C.x + Math.sin(th) * r, z = D.C.z + Math.cos(th) * r;
      const y = D.C.y + Math.sin(t * 1.3 + phase) * wob;
      // tangent heading: d/dt of (sin th, cos th) is (cos th, -sin th) * 0.34r
      const dx = Math.cos(th), dz = -Math.sin(th);
      A._place(j, x, y, z, headingOf(_v.set(dx, 0, dz)), Math.cos(t * 1.3 + phase) * 0.06, -0.95);
    };
    orbit(D.f18, 0, 120, 15);
    if (!D.mig.dead) orbit(D.mig, Math.PI, 130, 18);
    // wingtip ribbons: the circle draws itself on the sky — the only way
    // a two-ship orbit reads at reel distance
    D.trailT = (D.trailT || 0) - dt;
    if (D.trailT <= 0) {
      D.trailT = 0.1;
      G.fx.trail(D.f18.pos, 1.7, 0xdfe8ff, 3.2);
      if (!D.mig.dead) G.fx.trail(D.mig.pos, 1.9, 0x9aa2ac, 3.2);
    }
    // bandit shoots first — and the Hornet flares it off
    if (t > 3 && !D.fired1) { D.fired1 = true; D.m1 = A._fire(D.mig, D.f18, 'r73'); }
    if (t > 5.1 && !D.flared) {
      D.flared = true;
      D.f18.flareT = G.time;
      for (let i = 0; i < 7; i++) {
        _v.copy(D.f18.pos).add(_w.set(rand(-30, 30), rand(-14, 4), rand(-30, 30)));
        G.fx.flash(_v, 4, 0xffc860, 0.5);
        G.fx.smoke(_v, 1.1, 0.9, 0xffd080);
      }
      if (D.m1 && !D.m1.dead) D.m1._spoof();
    }
    // the reversal — Hornet's missile doesn't miss
    if (t > 8 && !D.fired2) { D.fired2 = true; A._fire(D.f18, D.mig, 'aim9'); A._ab(D.f18, true); }
    if (t > 9.4 && D.fired2 && !D.mig.dead) {    // backstop: the script says he dies
      D.mig.dead = true;
      G.explode(D.mig.pos.clone(), 1.6);
    }
    if (D.mig.dead && !D.splashed) {
      // dead jet: spiral down trailing smoke, into the bay
      D.killT += dt;
      const k = D.killT;
      D.mig.pos.y -= (90 + k * 50) * dt;
      D.mig.pos.x += Math.sin(k * 3) * 90 * dt;
      D.mig.pos.z += Math.cos(k * 2.6) * 90 * dt;
      D.mig.quat.copy(flightQuat(D.mig.heading + k * 1.2, -0.5 - k * 0.12, Math.sin(k * 4) * 1.4));
      if ((k * 30 | 0) % 2 === 0) G.fx.smoke(D.mig.pos, 1.6, 1.8, 0x333333);
      if (D.mig.pos.y <= 3) {
        D.splashed = true;
        D.mig.pos.y = 0;
        G.fx.splash(D.mig.pos, 2.4);
        G.audio.splash(1.1);
        G.explode(D.mig.pos.clone(), 1.4);
        D.mig.model.visible = false;
      }
    }
    if (D.splashed) {                            // victor climbs away
      const f = D.f18.fwd(_w);
      D.f18.pos.addScaledVector(f, 240 * dt); D.f18.pos.y += 30 * dt;
      A._place(D.f18, D.f18.pos.x, D.f18.pos.y, D.f18.pos.z, D.f18.heading, 0.12, 0);
    }
  },
  cam(A, dt, camPos, camera) {
    const D = A.data, t = A.t;
    if (D.mig.dead) {                            // the death spiral still gets the ride
      const subj = D.mig, f = subj.fwd(_w);
      A._chase(dt, camPos, camera,
        subj.pos.x - f.x * 110, subj.pos.y + 34, subj.pos.z - f.z * 110,
        subj.pos.x + f.x * 45, subj.pos.y - 4, subj.pos.z + f.z * 45, 2.6, 56 - t01(t, 12) * 14);
      return;
    }
    // wide orbit of the whole fight: opens on the Hornet's six with both
    // jets framed, swings round to his nose as the camera pushes in
    const k = t01(t, 12);
    const psi = t * 0.34 - 0.3 + k * 1.7;      // trail his circle, rear -> front
    const R = 280 - k * 60;
    const mx = (D.f18.pos.x + D.mig.pos.x) / 2, my = (D.f18.pos.y + D.mig.pos.y) / 2 + 4, mz = (D.f18.pos.z + D.mig.pos.z) / 2;
    // menu sits on the left of the screen: bias the look left of the fight
    // so the pair holds right-of-centre
    _v.set(mx - camPos.x, 0, mz - camPos.z).normalize();
    _w.set(-_v.z, 0, _v.x);
    A._chase(dt, camPos, camera,
      D.C.x + Math.sin(psi) * R, D.C.y + 12 - k * 6, D.C.z + Math.cos(psi) * R,
      mx - _w.x * 104, my, mz - _w.z * 104, 2.8, 62 - k * 6);
  },
};

// ---------------- scene 3: dusk trap ----------------
const Trap = {
  name: 'trap', dur: 11,
  setup(A) {
    A.G.world.setTimeOfDay('dusk');
    const j = A._spawn('f14', { ab: false, gear: true, name: 'TOMCAT' });
    if (j.model.userData.hook) j.model.userData.hook.visible = true;
    j.speed = 68;
    A.data = { j, u: 0, v: 0, puff: false };
  },
  update(A, dt) {
    const D = A.data, c = A.G.world.carrier, t = A.t;
    A._spec('jet', t < 7.5 ? 0.5 : 0.25);        // groove power, then cut
    // the angled deck line in carrier-local coords (matches the deck texture)
    const a0 = { x: -14, z: -160 }, a1 = { x: 27, z: 112 };
    const dl = Math.hypot(a1.x - a0.x, a1.z - a0.z);
    const dx = (a1.x - a0.x) / dl, dz = (a1.z - a0.z) / dl;
    deckD(c, dx, 0, dz, _w);
    const h = headingOf(_w);
    if (t < 7.5) {                               // the groove: 2.4 km final, 3.5° glideslope
      D.u = t / 7.5;
      const back = 2400 * (1 - D.u);
      deckP(c, a0.x - dx * back, c.deckY + 2.2 + 147 * (1 - D.u), a0.z - dz * back, _v);
      A._place(D.j, _v.x, _v.y, _v.z, h, 0.055, 0);
    } else {                                     // in the wires: 68 -> 0 on the deck
      D.v = Math.max(0, 68 - 26 * (t - 7.5));
      D.roll = (D.roll || 0) + D.v * dt;
      deckP(c, a0.x + dx * (30 + D.roll), c.deckY + 2.2, a0.z + dz * (30 + D.roll), _v);
      A._place(D.j, _v.x, _v.y, _v.z, h, D.v > 40 ? 0.09 : 0, 0);
      if (!D.puff) { D.puff = true; A.G.fx.smoke(_v, 1.2, 1.6, 0xcccccc); A.G.audio.trap(); }
    }
  },
  cam(A, dt, camPos, camera) {
    const D = A.data, c = A.G.world.carrier;
    deckP(c, 46, c.deckY + 5, -178, _v);         // the LSO's platform
    A._chase(dt, camPos, camera, _v.x, _v.y, _v.z, D.j.pos.x, D.j.pos.y + 2, D.j.pos.z, 3.4, 54 - t01(A.t, 11) * 18);
  },
};

// ---------------- scene 4: fleet flyby ----------------
const Fleet = {
  name: 'fleet', dur: 10,
  setup(A) {
    A.G.world.setTimeOfDay('day');
    const c = A.G.world.carrier;
    const lead = A._spawn('f14', { ab: true, gear: false, name: 'LEAD' });
    const w1 = A._spawn('f16', { ab: true, gear: false, name: 'WING' });
    const w2 = A._spawn('a10', { ab: false, gear: false, name: 'HAWG' });
    for (const j of [lead, w1, w2]) j.speed = 250;
    // run line: over the carrier, along the deck
    deckD(c, 0, 0, 1, _w);
    const h = headingOf(_w);
    const start = _v.copy(c.group.position).addScaledVector(_w, -1700).setY(130);
    A.data = { jets: [lead, w1, w2], h, dir: _w.clone(), start: start.clone(), boom: false };
  },
  update(A, dt) {
    const D = A.data, t = A.t;
    A._spec('jet', 0.85);
    const offsets = [[0, 0, 0], [-26, 6, -42], [26, 12, -84]];   // tight vic
    D.jets.forEach((j, i) => {
      const [ox, oy, oz] = offsets[i];
      // lateral offset perpendicular to the run line
      const px = D.start.x + D.dir.x * 250 * t + (-D.dir.z) * ox + D.dir.x * oz;
      const pz = D.start.z + D.dir.z * 250 * t + (D.dir.x) * ox + D.dir.z * oz;
      A._place(j, px, D.start.y + oy, pz, D.h, 0, -0.06);
    });
    const lead = D.jets[0];
    if (!D.boom && lead.pos.distanceTo(A.G.world.carrier.group.position) < 500) {
      D.boom = true;
      A.G.fx.flash(lead.pos.clone(), 14, 0xffffff, 0.15);
      for (let i = 0; i < 6; i++) A.G.fx.smoke(_v.copy(lead.pos).addScaledVector(lead.fwd(_w), -i * 5), 0.5, 1.2, 0xf4f8ff);
    }
  },
  cam(A, dt, camPos, camera) {
    const D = A.data, c = A.G.world.carrier, lead = D.jets[0], t = A.t;
    if (t < 4.8) {
      // off the lead's wing, burner trailing — the pilots' perspective
      A._chase(dt, camPos, camera,
        lead.pos.x - D.dir.x * 44 - D.dir.z * 18, lead.pos.y + 9, lead.pos.z - D.dir.z * 44 + D.dir.x * 18,
        lead.pos.x + D.dir.x * 60, lead.pos.y + 4, lead.pos.z + D.dir.z * 60, 3.4, 56 - t01(t, 4.8) * 12);
    } else {
      // up on the island, looking down the run — the ship's perspective
      deckP(c, 24, c.deckY + 9, 60, _v);
      A._chase(dt, camPos, camera, _v.x, _v.y, _v.z, lead.pos.x, lead.pos.y + 6, lead.pos.z, 4.2, 62 - t01(t - 4.8, 5.2) * 16);
    }
  },
};

// ---------------- scene 5: night bridge run ----------------
const BridgeRun = {
  name: 'bridge', dur: 11,
  setup(A) {
    A.G.world.setTimeOfDay('night');
    const j = A._spawn('f18', { ab: true, gear: false, name: 'RUNNER' });
    j.speed = 290;
    A.data = { j, pulled: false };
  },
  update(A, dt) {
    const D = A.data, t = A.t, j = D.j;
    A._spec('jet', 1.05);                        // full blower on the deck
    // the Golden Gate gap from the old demo route: through (0,42,0) heading +x
    const x = -2900 + 290 * t, z = 520 - 52 * t;
    if (t < 9.7) {
      A._place(j, x, 46, z, Math.PI / 2 + 0.03, 0, 0);
    } else {                                     // clear of the deck — the pull: vertical
      if (!D.pulled) {
        D.pulled = true;
        A.G.fx.flash(j.pos.clone(), 12, 0xffffff, 0.14);
        for (let i = 0; i < 8; i++) A.G.fx.smoke(_v.copy(j.pos).addScaledVector(j.fwd(_w), 2 - i * 1.8), 0.55, 1.3, 0xf4f8ff);
      }
      const u = Math.min(1, (t - 9.7) / 1.3);
      const climb = 1.3 * u * u;
      A._place(j, j.pos.x + Math.cos(climb) * 290 * dt, j.pos.y + Math.sin(climb) * 290 * dt, j.pos.z - 6 * dt, Math.PI / 2 + 0.03, climb, 0);
    }
    // night run: an ember streak off the tailpipes so the jet reads
    D.streak = (D.streak || 0) - dt;
    if (D.streak <= 0) {
      D.streak = 0.09;
      j.fwd(_v);
      A.G.fx.trail(_w.copy(j.pos).addScaledVector(_v, -9), 1.3, 0xffa050, 0.8);
    }
  },
  cam(A, dt, camPos, camera) {
    const j = A.data.j, t = A.t;
    const f = j.fwd(_w);
    if (t < 9.7) {
      // opens on his six with the bridge swelling ahead, swings to the
      // bow quarter, pushing in the whole way
      const k = t01(t, 9.7);
      const psi = Math.PI - k * 1.85;          // rear -> front-quarter
      const r = 90 - k * 36;
      const cx = j.pos.x + (f.x * Math.cos(psi) - f.z * Math.sin(psi)) * r;
      const cy = j.pos.y + 10 + k * 4;
      const cz = j.pos.z + (f.z * Math.cos(psi) + f.x * Math.sin(psi)) * r;
      _v.set(j.pos.x - cx, 0, j.pos.z - cz).normalize();
      _w.set(-_v.z, 0, _v.x);                  // camera right (xz)
      A._chase(dt, camPos, camera, cx, cy, cz,
        j.pos.x + f.x * 12 - _w.x * 36, j.pos.y + 5, j.pos.z + f.z * 12 - _w.z * 36, 3.6, 58 - k * 12);
    } else {
      // vertical now — the camera hangs ahead of him and looks back at the
      // bridge: he rips up through frame, still pushing in for speed
      const k = t01(t - 9.7, 1.3);
      A._chase(dt, camPos, camera,
        j.pos.x + 125 - k * 45, j.pos.y + 18 - k * 12, j.pos.z + 44 - k * 16,
        j.pos.x - 30, j.pos.y - 6, j.pos.z - 8, 4.5, 50 - k * 14);
    }
  },
};

// ---------------- scene: Screwtops — the E-2's turning dome ----------------
const Screwtops = {
  name: 'screwtops', dur: 9.5,
  setup(A) {
    A.G.world.setTimeOfDay('day');
    const j = A._spawn('e2c', { ab: false, gear: false, name: 'SCREWTOPS 601' });
    j.speed = 140;
    const c = A.G.world.carrier.pos;
    A.data = { j, C: new THREE.Vector3(c.x, 850, c.z), phi: 0, camPhi: 0 };
  },
  update(A, dt) {
    const D = A.data, t = A.t;
    A._spec('prop', 0.75);
    // the E-2 holds its own wide circle over the group; the camera orbits IT
    const th = t * 0.22;
    const x = D.C.x + Math.sin(th) * 900, z = D.C.z + Math.cos(th) * 900;
    const dx = Math.cos(th), dz = -Math.sin(th);
    A._place(D.j, x, D.C.y + Math.sin(t * 0.7) * 12, z, headingOf(_v.set(dx, 0, dz)), 0, -0.12);
    // props windmilling, dome turning — the corkscrew on its face screws by
    for (const p of D.j.model.userData.props || []) p.rotation.z += dt * 50;
    if (D.j.model.userData.rotodome) D.j.model.userData.rotodome.rotation.y += dt * 0.6;
    D.camPhi = t * (Math.PI * 2 / 9.5);           // one full 360 across the scene
  },
  cam(A, dt, camPos, camera) {
    const D = A.data, j = D.j;
    A._chase(dt, camPos, camera,
      j.pos.x + Math.sin(D.camPhi) * 68, j.pos.y + 28, j.pos.z + Math.cos(D.camPhi) * 68,
      j.pos.x, j.pos.y + 2, j.pos.z, 5, 48 - t01(A.t, 9.5) * 14);
  },
};

// ---------------- scene: tracers — the gun speaks at night ----------------
const Tracers = {
  name: 'tracers', dur: 9,
  setup(A) {
    A.G.world.setTimeOfDay('night');
    const j = A._spawn('f18', { ab: true, gear: false, name: 'GUNSLINGER' });
    j.speed = 260;
    const gun = new GunSystem(A.G);
    // GunSystem wants a player-shaped shooter; the scripted jet fills in
    const shooter = { pos: j.pos, fwd: new THREE.Vector3(), vel: new THREE.Vector3(), stores: { gun: 9999 }, isPlayer: false };
    A.data = { j, gun, shooter, C: new THREE.Vector3(-12000, 260, -3000), burst: 0 };
  },
  update(A, dt) {
    const D = A.data, t = A.t;
    A._spec('jet', 0.9);
    A.G.audio.setGatling(t > 1.2 && t < 8.5);    // the Vulcan sings with the hose
    // shallow dive down a gentle weave, hammering the water off the headlands
    const th = t * 0.5;
    const x = D.C.x + t * 225, z = D.C.z + Math.sin(th) * 90;
    const y = 340 + Math.sin(t * 0.6) * 12;      // high and level — the hose
    const dz = Math.cos(th) * 90 * 0.5 / 225;    // reads against open sky
    A._place(D.j, x, y, z, Math.PI / 2 + Math.atan(dz), -0.02, Math.sin(th) * 0.35);
    // one long continuous hose — 38 m spacing with 30 m bolts reads as a
    // solid laser stream across the night sky
    if (t > 1.2 && t < 8.5) {
      const f = D.j.fwd(_w);
      D.shooter.fwd.copy(f);
      D.shooter.vel.copy(f).multiplyScalar(260);
      D.shooter.vel.y = -6;
      D.gun.fire(dt, D.shooter, []);
    }
    D.gun.update(dt);
  },
  teardown(A) {
    const D = A.data;
    if (D.gun) for (const tr of D.gun.tracers) A.G.scene.remove(tr.mesh);
  },
  cam(A, dt, camPos, camera) {
    // fixed headlands perch, lens square across the gun line — 8 solid
    // seconds of bolts streaking laterally through the frame, then the
    // jet itself flashes past for the finale
    const C = A.data.C;
    A._chase(dt, camPos, camera,
      C.x + 1200, 40, C.z + 170,
      C.x + 1750, 300, C.z - 80, 3, 52 - t01(A.t, 9) * 14);
  },
};

// ---------------- scene: the battle group on station ----------------
const BattleGroup = {
  name: 'battlegroup', dur: 11,
  setup(A) {
    A.G.world.setTimeOfDay('day');
    const ships = A.G.world.ships;
    A.data = {
      cg: ships.all.find(s => s.name === 'USS GETTYSBURG CG-64'),
      ddg: ships.all.find(s => s.name === 'USS STOUT DDG-55'),
      ffg: ships.all.find(s => s.name === 'USS KLAKRING FFG-42'),
    };
  },
  update(A, dt) { /* the group steams itself — nothing to script */ },
  cam(A, dt, camPos, camera) {
    const D = A.data, t = A.t, c = A.G.world.carrier;
    // the group steams east into a high eastern sun — so every beat sits
    // east/starboard of the ships and looks back west into the lit faces
    const cp = c.group.position;
    if (t < 3.8 && D.cg) {
      // Gettysburg's bow, close and low — bow wave, lit forecastle, wake
      A._chase(dt, camPos, camera,
        D.cg.pos.x + 150, 15, D.cg.pos.z - 95,
        D.cg.pos.x + 30, 10, D.cg.pos.z + 10, 2.6, 52 - t01(t, 3.8) * 12);
    } else if (t < 7.6) {
      // over the ramp and straight down the deck — bow, waist cat and the
      // island stacked in one rushing line
      A._chase(dt, camPos, camera,
        cp.x + 470, 48, cp.z - 30,
        cp.x - 120, 12, cp.z + 20, 2.2, 50 - t01(t - 3.8, 3.8) * 14);
    } else if (D.ffg) {
      // Klakring bringing up the rear, close on her quarter, wake creaming
      A._chase(dt, camPos, camera,
        D.ffg.pos.x + 190, 14, D.ffg.pos.z - 120,
        D.ffg.pos.x - 100, 10, D.ffg.pos.z + 80, 2.4, 52 - t01(t - 7.6, 3.4) * 12);
    }
  },
};

// ---------------- scene: sonobuoys away — the P-3 works the datum ----------------
const Sonobuoy = {
  name: 'sonobuoy', dur: 9.5,
  setup(A) {
    A.G.world.setTimeOfDay('day');
    const j = A._spawn('p3', { ab: false, gear: false, name: 'P-3 ORION' });
    j.speed = 96;
    A.data = { j, buoys: [], dropped: 0, C: new THREE.Vector3(-42000, 130, -8000), beat: -1 };
  },
  update(A, dt) {
    const D = A.data, t = A.t;
    A._spec('prop', 0.6);
    // straight low run down the datum line — due east, no crab
    A._place(D.j, D.C.x + 96 * t, D.C.y + Math.sin(t * 0.8) * 4, D.C.z, Math.PI / 2, 0, -0.04);
    for (const p of D.j.model.userData.props || []) p.rotation.z += dt * 50;
    // a stick of three buoys — early enough that the first splash lands
    // while the belly cam is still on
    const want = t > 1.6 ? (t > 3.2 ? (t > 4.8 ? 3 : 2) : 1) : 0;
    while (D.dropped < want) {
      D.dropped++;
      const m = new THREE.Mesh(Sonobuoy.geo || (Sonobuoy.geo = new THREE.CylinderGeometry(0.35, 0.35, 1.6, 6)),
        Sonobuoy.mat || (Sonobuoy.mat = new THREE.MeshBasicMaterial({ color: 0xff7722 })));
      m.position.copy(D.j.pos); m.position.y -= 2;
      A.G.scene.add(m);
      D.buoys.push({ m, vy: 0, live: true });
    }
    for (const b of D.buoys) {
      if (!b.live) { b.m.position.y = 0.5 + Math.sin(A.G.time * 1.4 + b.m.position.x) * 0.25; continue; }
      b.vy -= 9.81 * dt;
      b.m.position.y += b.vy * dt;
      b.m.position.x += 96 * dt * 0.9;
      b.m.rotation.x += dt * 4;
      if (b.m.position.y <= 0.4) {
        b.live = false; b.m.position.y = 0.4; b.m.rotation.x = 0;
        A.G.fx.splash(b.m.position, 1.6);
        A.G.audio.splash(0.8);
      }
    }
  },
  teardown(A) { for (const b of (A.data.buoys || [])) A.G.scene.remove(b.m); },
  cam(A, dt, camPos, camera) {
    const D = A.data, j = D.j, t = A.t, f = j.fwd(_w);
    const b = t < 2.5 ? 0 : t < 7.2 ? 1 : 2;
    let tx, ty, tz, lx, ly, lz, rate, fov;
    if (b === 1) {
      // belly cam: slung under the Orion looking back and straight down —
      // the buoys fall away under us, shrink, and stitch white into the sea
      tx = j.pos.x - f.x * 3; ty = j.pos.y - 4.2; tz = j.pos.z - f.z * 3 + 1.4;
      lx = j.pos.x - f.x * 40; ly = j.pos.y - 75; lz = j.pos.z - f.z * 40;
      rate = 8; fov = 58;
    } else {
      // high off the RIGHT beam, looking back-down — Orion up top, the buoy
      // stick strung out below as it falls toward the water
      tx = j.pos.x + 125; ty = j.pos.y - 22; tz = j.pos.z + 38;
      lx = j.pos.x - 25; ly = j.pos.y - 55; lz = j.pos.z - 8;
      rate = 2.8; fov = 52 - t01(t, 9.5) * 14;
    }
    if (D.beat !== b) {
      if (D.beat >= 0 && A.G.flashCut) A.G.flashCut(0.1);   // fast cut to the drop view
      D.beat = b;
      camPos.set(tx, ty, tz);                               // hard snap — a cut, not a swoop
      camera.position.copy(camPos);
    }
    A._chase(dt, camPos, camera, tx, ty, tz, lx, ly, lz, rate, fov);
  },
};

// ---------------- scene: missile cam — ride the Sidewinder ----------------
const MissileCam = {
  name: 'missilecam', dur: 9,
  setup(A) {
    A.G.world.setTimeOfDay('morning');
    const f18 = A._spawn('f18', { ab: false, gear: false, name: 'VIPER' });
    const mig = A._spawn('mig29', { ab: true, gear: false, hostile: true, name: 'BANDIT' });
    mig.hp = 30;                                   // one Sidewinder is plenty
    const C = new THREE.Vector3(-6000, 1500, 2000);
    A._place(f18, C.x, C.y, C.z, Math.PI / 2, 0, 0);
    A._place(mig, C.x + 900, C.y + 40, C.z - 140, Math.PI / 2 + 0.2, 0, 0.1);
    f18.speed = mig.speed = 240;
    A.data = { f18, mig, m: null, fired: false, boom: false, hdg: Math.PI / 2 };
  },
  update(A, dt) {
    const D = A.data, t = A.t, G = A.G;
    A._spec('jet', 0.9);
    if (!D.mig.dead) {
      // both jets press east; the bandit holds a shallow bank — the
      // Sidewinder runs him down in one clean pass
      const mv = 240 * dt;
      D.f18.pos.x += mv; D.mig.pos.x += mv * 0.98;
      D.mig.pos.z -= Math.sin(Math.min(1, t * 0.4)) * 8 * dt;
      D.mig.heading = Math.PI / 2 + Math.min(1, t * 0.4) * 0.1;
      D.mig.quat.copy(flightQuat(D.mig.heading, 0, 0.25));
      D.f18.quat.copy(flightQuat(Math.PI / 2, 0, 0));
    } else {
      // dead: snap-roll down toward the bay — slow enough for the cam to hold
      D.mig.pos.y -= (22 + t * 5) * dt;
      D.mig.quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(dt * 2.4, 0, dt * 3.2)));
      if (((t * 30) | 0) % 2 === 0) G.fx.smoke(D.mig.pos, 1.4, 1.6, 0x333333);
    }
    if (t > 2 && !D.fired) { D.fired = true; D.m = A._fire(D.f18, D.mig, 'aim9'); }
    if (D.mig.dead && !D.boom) { D.boom = true; G.explode(D.mig.pos.clone(), 1.5); }
  },
  cam(A, dt, camPos, camera) {
    const D = A.data;
    if (D.m && !D.m.dead && !D.mig.dead) {
      // ride just above the missile, watching it run the bandit down
      _v.copy(D.mig.pos).sub(D.m.pos).normalize();       // missile's line
      A._chase(dt, camPos, camera,
        D.m.pos.x - _v.x * 26, D.m.pos.y + 7, D.m.pos.z - _v.z * 26,
        D.mig.pos.x, D.mig.pos.y, D.mig.pos.z, 8, 48 - t01(A.t, 4) * 12);
    } else {
      // after the kill: orbit the falling fireball, pushing in
      const phi = A.t * 0.55;
      A._chase(dt, camPos, camera,
        D.mig.pos.x + Math.sin(phi) * 85, D.mig.pos.y + 22, D.mig.pos.z + Math.cos(phi) * 85,
        D.mig.pos.x, D.mig.pos.y, D.mig.pos.z, 4, 52 - t01(A.t, 9) * 14);
    }
  },
};

// ---------------- scene: the Eagle goes vertical ----------------
const Eagle = {
  name: 'eagle', dur: 9,
  setup(A) {
    A.G.world.setTimeOfDay('day');
    const j = A._spawn('f15', { ab: true, gear: false, name: 'EAGLE' });
    j.speed = 280;
    A.data = { j, C: new THREE.Vector3(-9000, 130, 2500), pulled: false };
  },
  update(A, dt) {
    const D = A.data, t = A.t, j = D.j;
    A._spec('jet', 1.0);                         // the Eagle stays in blower
    if (t < 3) {
      A._place(j, D.C.x + 280 * t, D.C.y, D.C.z, Math.PI / 2, 0, 0);
    } else {
      // the pull: 3 g into the vertical, burner glow against the sky
      const u = Math.min(1, (t - 3) / 1.1), pitch = 1.35 * u * u;
      if (!D.pulled && u > 0.4) { D.pulled = true; A.G.fx.flash(j.pos.clone(), 10, 0xffffff, 0.12); }
      const f = j.fwd(_w);
      j.pos.x += Math.cos(pitch) * 280 * dt;
      j.pos.y += Math.sin(pitch) * 280 * dt;
      A._place(j, j.pos.x, j.pos.y, j.pos.z, Math.PI / 2, pitch, Math.sin(t * 1.2) * 0.5 * u);
    }
  },
  cam(A, dt, camPos, camera) {
    const j = A.data.j, t = A.t;
    if (t < 3) {   // waiting low on the water as he crosses
      A._chase(dt, camPos, camera,
        A.data.C.x + 620, 40, A.data.C.z + 420,
        j.pos.x, j.pos.y + 10, j.pos.z, 3.4, 56 - t01(A.t, 3) * 10);
    } else {       // look up after him — close on the burners
      A._chase(dt, camPos, camera,
        j.pos.x - 38, Math.max(40, j.pos.y - 48), j.pos.z + 42,
        j.pos.x, j.pos.y + 22, j.pos.z, 3.2, 50 - t01(A.t - 3, 6) * 16);
    }
  },
};

// ---------------- scene: heavy metal off 01R ----------------
const Airliner = {
  name: 'airliner', dur: 13.5,
  setup(A) {
    A.G.world.setTimeOfDay('day');
    // grey day out of SFO: a broken deck overhead (snapped on, not ramped) —
    // half cover: the puffs read without dragging the light down to dusk
    A.G.world.setWeather('clouds');
    A.G.world.cloud01 = 0.5;
    const G = A.G, rw = G.world.runways.find(r => r.name === 'SFO INTL 01R');
    const f = { x: Math.sin(rw.hdg), z: -Math.cos(rw.hdg) };
    const thr = { x: rw.x - f.x * rw.len / 2, z: rw.z - f.z * rw.len / 2 };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const ai = G.spawnAI('b744', {
      pos: V(thr.x, rw.elev + 6.4, thr.z), heading: rw.hdg, speed: 70,
      name: 'BAY AIR 216', label: 'BAY AIR', livery: 0,
      mode: 'route', noEvade: true, surface: true,
      waypoints: [
        V(rw.x + f.x * (rw.len / 2 + 400), rw.elev + 8, rw.z + f.z * (rw.len / 2 + 400)),
        V(rw.x + f.x * 6000, 700, rw.z + f.z * 6000),
        V(16000, 1300, 4000),
      ],
    });
    ai.kind = 'airliner'; ai.identified = true; ai.targetSpeed = 80;
    if (ai.model.userData.gear) ai.model.userData.gear.visible = true;
    A.data = { ai, rw, f, airborne: false };
  },
  update(A, dt) {
    // hand-flown: menu state never ticks traffic AI, so the reel drives the
    // roll, rotation, gear-up and climb itself
    const D = A.data, t = A.t, f = D.f, rw = D.rw, ai = D.ai;
    A._spec('turbofan', t > 8.6 ? 0.95 : 0.6);   // spool up for the climb
    const thr = D.thr || (D.thr = { x: rw.x - f.x * rw.len / 2, z: rw.z - f.z * rw.len / 2 });
    let d, y, pitch;
    if (t < 8) {                       // the roll: 70 -> 166 m/s
      d = 70 * t + 6 * t * t;
      y = rw.elev + 6.4; pitch = 0;    // riding on the gear
    } else {                           // rotate at ~950 m, climb away
      const u = Math.min(1, (t - 8) / 1.3), w = Math.max(0, t - 8.6);
      d = 944 + 166 * (t - 8) + 6.9 * (t - 8) * (t - 8);
      y = rw.elev + 6.4 + 8 * w * w;
      pitch = 0.24 * u * u;
    }
    A._place(ai, thr.x + f.x * d, y, thr.z + f.z * d, rw.hdg, pitch, 0);
    if (!D.vapor && t > 8.1) { D.vapor = true; A.G.fx.flash(ai.pos.clone(), 8, 0xffffff, 0.1); }
    if (!D.gearUp && t > 9.8) {        // gear comes up as the orbit sweeps on
      D.gearUp = true;
      if (ai.model.userData.gear) ai.model.userData.gear.visible = false;
    }
  },
  teardown(A) {
    const D = A.data, i = A.G.bandits.indexOf(D.ai);
    if (i >= 0) A.G.bandits.splice(i, 1);
    D.ai.dispose();
    A.G.world.setWeather('clear');
    A.G.world.cloud01 = 0;
  },
  cam(A, dt, camPos, camera) {
    // one long slow orbit round the jet: opens on her rear quarter as the
    // roll begins, swings round the nose as she rotates, and keeps going
    // onto the far beam through the gear-up and the climb — closing the
    // whole way
    const D = A.data, ai = D.ai, t = A.t, k = t01(t, 13.5);
    const f = ai.fwd(_w);
    const alpha = Math.PI - 0.55 - t * 0.33;   // rear-right -> ahead -> far beam
    const r = 122 - k * 58;
    A._chase(dt, camPos, camera,
      ai.pos.x + (f.x * Math.cos(alpha) - f.z * Math.sin(alpha)) * r,
      ai.pos.y + 9 + k * 30,
      ai.pos.z + (f.z * Math.cos(alpha) + f.x * Math.sin(alpha)) * r,
      ai.pos.x + f.x * 18, ai.pos.y + 4, ai.pos.z + f.z * 18, 3.2, 56 - k * 10);
  },
};

// ---------------- scene: break break break — the jink ----------------
const Jink = {
  name: 'jink', dur: 10,
  setup(A) {
    A.G.world.setTimeOfDay('night');
    const f18 = A._spawn('f18', { ab: true, gear: false, name: 'VIPER' });
    const mig = A._spawn('mig29', { ab: false, gear: false, hostile: true, name: 'BANDIT' });
    f18.speed = 250; mig.speed = 250;
    const C = new THREE.Vector3(-14000, 1200, 6000);
    A._place(f18, C.x, C.y, C.z, Math.PI / 2, 0, 0);
    A._place(mig, C.x - 1500, C.y + 100, C.z + 300, Math.PI / 2, 0, 0);
    A.data = { f18, mig, m: null, fired: false, flares: 0, bank: 0 };
  },
  update(A, dt) {
    const D = A.data, t = A.t, G = A.G, j = D.f18;
    // desperate: alternating hard breaks with a dive thrown in
    const cyc = t % 3.4;
    const want = cyc < 1.7 ? 1.15 : -1.15;
    D.bank = damp(D.bank, want, 3.5, dt);
    const h = j.heading + D.bank * 0.9 * dt;
    const dive = (t > 4 && t < 7) ? -0.22 : 0.02;
    const f = _w.set(Math.sin(h), 0, -Math.cos(h));
    A._place(j, j.pos.x + f.x * 250 * dt, Math.max(220, j.pos.y + dive * 250 * dt), j.pos.z + f.z * 250 * dt, h, dive, D.bank);
    if (!D.fired && t > 5) { D.fired = true; D.m = A._fire(D.mig, D.f18, 'r73'); }
    // the bandit trails, lagging the breaks
    A._place(D.mig, D.mig.pos.x + Math.sin(D.mig.heading) * 250 * dt, D.mig.pos.y, D.mig.pos.z - Math.cos(D.mig.heading) * 250 * dt,
      D.mig.heading + Math.sin(t * 0.5) * 0.2 * dt, 0, D.bank * 0.5);
    // two flare bursts; the second one sells the R-73
    const wantF = t > 6.5 ? (t > 8.5 ? 2 : 1) : 0;
    while (D.flares < wantF) {
      D.flares++;
      j.flareT = G.time;
      for (let i = 0; i < 8; i++) {
        _v.copy(j.pos).add(f.set(rand(-26, 26), rand(-16, 2), rand(-26, 26)));
        G.fx.flash(_v, 5, 0xffc860, 0.6);
        G.fx.smoke(_v, 1.4, 1.0, 0xffd080);
      }
    }
    if (D.flares >= 2 && D.m && !D.m.dead && !D.m._spoofed) D.m._spoof();
  },
  cam(A, dt, camPos, camera) {
    const j = A.data.f18, f = j.fwd(_w);
    // ahead of him, looking back: the missile's trail closes from behind
    A._chase(dt, camPos, camera,
      j.pos.x + f.x * 110 - f.z * 30, j.pos.y + 16, j.pos.z + f.z * 110 + f.x * 30,
      j.pos.x - f.x * 90, j.pos.y - 8, j.pos.z - f.z * 90, 3.2, 54 - t01(A.t, 10) * 14);
  },
};

// ---------------- scene: the cruiser's rotor ----------------
const HeloShip = {
  name: 'heloship', dur: 10,
  setup(A) {
    A.G.world.setTimeOfDay('dusk');
    const cg = A.G.world.ships.all.find(s => s.name === 'USS GETTYSBURG CG-64');
    const h = new Helicopter(A.G.scene, A.G.world, {
      type: 'seahawk', spun: true,
      pos: new THREE.Vector3(cg.pos.x - 500, 160, cg.pos.z - 500),
      heading: Math.PI * 0.75,
    });
    h.order({ kind: 'goto', wp: { x: cg.pos.x - 90, y: 26, z: cg.pos.z - 60 } });
    A.data = { h, cg, phi: 0 };
  },
  update(A, dt) {
    const D = A.data;
    A._spec('prop', 0.6);
    // hover off the cruiser's quarter, riding with her
    D.h.wp.x = D.cg.pos.x - 90; D.h.wp.z = D.cg.pos.z - 60;
    D.h.update(dt, A.G);
    D.phi = 2.2 + t01(A.t, 10) * Math.PI * 2;   // a full 360 round the hover
  },
  teardown(A) { A.G.scene.remove(A.data.h.model); },
  cam(A, dt, camPos, camera) {
    const D = A.data, h = D.h;
    A._chase(dt, camPos, camera,
      h.pos.x + Math.sin(D.phi) * 52, h.pos.y + 6, h.pos.z + Math.cos(D.phi) * 52,
      h.pos.x, h.pos.y - 2, h.pos.z, 3, 52 - t01(A.t, 10) * 16);
  },
};
function t01(t, dur) { return clamp(t / dur, 0, 1); }

// ---------------- scene: the Harrier rides its pillar ----------------
const Harrier = {
  name: 'harrier', dur: 10,
  setup(A) {
    A.G.world.setTimeOfDay('day');
    const ship = A.G.world.ships.all.find(s => s.name === 'MV BAY TRADER');
    const j = A._spawn('av8b', { ab: false, gear: true, name: 'HARrier' });
    j.label = 'VMA-513';
    A.data = { j, ship, phi: 0.6 };
  },
  update(A, dt) {
    const D = A.data, t = A.t, j = D.j;
    A._spec('jet', 0.85);
    const s = D.ship;
    // station-keeping over the container stacks, gentle bob, slow turn
    const bob = Math.sin(t * 1.1) * 1.4;
    A._place(j, s.pos.x - 20 + Math.sin(t * 0.4) * 4, 34 + bob, s.pos.z + Math.cos(t * 0.5) * 4,
      Math.PI + t * 0.12, 0, Math.sin(t * 0.9) * 0.03);
    D.phi = 0.6 + t01(t, 10) * Math.PI * 2;    // a full 360 round the pillar
  },
  cam(A, dt, camPos, camera) {
    const D = A.data, j = D.j;
    A._chase(dt, camPos, camera,
      j.pos.x + Math.sin(D.phi) * 62, j.pos.y + 8, j.pos.z + Math.cos(D.phi) * 62,
      j.pos.x, j.pos.y - 4, j.pos.z, 3.4, 52 - t01(A.t, 10) * 16);
  },
};

// ---------------- scene: the prowler shows her sail ----------------
const Prowler = {
  name: 'prowler', dur: 9,
  setup(A) {
    A.G.world.setTimeOfDay('day');
    const sub = A.G.world.enemySub;
    sub.group.visible = true;
    A.data = { sub };
  },
  update(A, dt) { A._spec('prop', 0.45); /* she creeps on her own update */ },
  teardown(A) { A.G.world.enemySub.group.visible = false; },
  cam(A, dt, camPos, camera) {
    const s = A.data.sub, t = A.t, k = t01(t, 9);
    // the tracker's eye: high overhead, circling slow and sinking lower —
    // her whole plan-view profile, sail and wake on the blue, like a P-3
    // sitting on top of the contact
    const phi = 0.6 + k * Math.PI * 1.5;
    const r = 800 - k * 120, h = 760 - k * 140;   // she's a kilometre long — stand off enough to hold the whole profile
    const tx = s.pos.x + Math.sin(phi) * r, tz = s.pos.z + Math.cos(phi) * r;
    _v.set(s.pos.x + 15 - tx, 0, s.pos.z - tz).normalize();   // camera-right look bias keeps her clear of the menu
    _w.set(-_v.z, 0, _v.x);
    A._chase(dt, camPos, camera, tx, h, tz,
      s.pos.x + 15 - _w.x * 170, 0, s.pos.z - _w.z * 170, 2.6, 46 - k * 6);
  },
};

// ---------------- scene: the Hawg owns the low level ----------------
const Hawg = {
  name: 'hawg', dur: 9,
  setup(A) {
    A.G.world.setTimeOfDay('dusk');
    const j = A._spawn('a10', { ab: false, gear: false, name: 'HAWG' });
    j.speed = 140;
    A.data = { j, C: new THREE.Vector3(-6000, 110, -800), bank: 0 };
  },
  update(A, dt) {
    const D = A.data, t = A.t, j = D.j;
    A._spec('jet', 0.7);
    // low and unhurried up the strait, a gentle wing-rock for the camera
    D.bank = Math.sin(t * 0.7) * 0.14;
    const h = Math.PI / 2 - 0.08 + Math.sin(t * 0.3) * 0.06;
    A._place(j, D.C.x + 140 * t, D.C.y + Math.sin(t * 0.9) * 6, D.C.z - 18 * t, h, 0, D.bank);
  },
  cam(A, dt, camPos, camera) {
    const j = A.data.j, f = j.fwd(_w), t = A.t;
    if (t < 4.5) {
      // off the wing, dusk city sliding past below
      A._chase(dt, camPos, camera,
        j.pos.x - f.x * 34 - f.z * 46, j.pos.y + 9, j.pos.z - f.z * 34 + f.x * 46,
        j.pos.x + f.x * 50, j.pos.y + 2, j.pos.z + f.z * 50, 3.2, 54 - t01(t, 4.5) * 12);
    } else {
      // ahead looking back — the Hog bears down on the camera
      A._chase(dt, camPos, camera,
        j.pos.x + f.x * 85 - f.z * 28, j.pos.y + 10, j.pos.z + f.z * 85 + f.x * 28,
        j.pos.x, j.pos.y + 2, j.pos.z, 3.2, 46 - t01(t - 4.5, 4.5) * 12);
    }
  },
};

// ---------------- scene: the group throws steel — VLS birds and CIWS at night ----------------
const Ciws = {
  name: 'ciws', dur: 10,
  setup(A) {
    A.G.world.setTimeOfDay('night');
    const ships = A.G.world.ships;
    const cg = ships.all.find(s => s.name === 'USS GETTYSBURG CG-64') || ships.all[0];
    const ddg = ships.all.find(s => s.name === 'USS STOUT DDG-55') || cg;
    const ffg = ships.all.find(s => s.name === 'USS KLAKRING FFG-42') || cg;
    // fore & aft gatling mounts on each escort — one GunSystem per mount so
    // the bursts phase against each other up and down the formation
    const mounts = [];
    [cg, ddg, ffg].forEach((sh, si) => {
      for (const off of [52, -52]) {
        mounts.push({
          sh, off,
          gun: new GunSystem(A.G),
          shooter: { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), vel: new THREE.Vector3(7.7, 0, 0), stores: { gun: 99999 }, isPlayer: false },
          phase: si * 0.5 + (off > 0 ? 0 : 0.18),
          az: si % 2 ? -0.65 : 0.65,
          cont: si === 0,          // the Gettysburg never lets go of the trigger
          flashT: 0,
        });
      }
    });
    A.data = { cg, ships: [cg, ddg, ffg], mounts, vls: [], launches: [0.8, 2.6, 4.9, 7.2], li: 0 };
  },
  update(A, dt) {
    const D = A.data, t = A.t;
    A.G.audio.setGatling(true);            // the Gettysburg never lets go
    // VLS launches ripple down the line — vertical off the deck, then tip
    // over onto the threat axis and streak away under their own smoke pillar
    if (D.li < D.launches.length && t >= D.launches[D.li]) {
      const sh = D.ships[D.li % D.ships.length];
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(
        Ciws.vlsGeo || (Ciws.vlsGeo = (() => { const g = new THREE.CylinderGeometry(0.28, 0.36, 3.8, 6); g.rotateX(Math.PI / 2); return g; })()),
        Ciws.vlsMat || (Ciws.vlsMat = new THREE.MeshBasicMaterial({ color: 0xdde2e8 }))));
      Ciws.glowTex = Ciws.glowTex || makeGlowTexture('rgba(255,240,210,1)', 'rgba(255,140,40,0)');
      const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: Ciws.glowTex, color: 0xffc060, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
      gl.position.z = -2.4; gl.scale.setScalar(8); grp.add(gl);
      grp.position.set(sh.pos.x + 14, sh.pos.y + 15, sh.pos.z + (D.li % 2 ? -6 : 6));
      A.G.scene.add(grp);
      D.vls.push({ grp, vel: new THREE.Vector3(0, 30, 0), age: 0, smokeT: 0 });
      D.li++;
      A.G.fx.flash(grp.position, 16, 0xffc060, 0.25);
      A.G.fx.fire(grp.position, 0.7, 6);
      A.G.audio.missileFire();
    }
    for (let i = D.vls.length - 1; i >= 0; i--) {
      const m = D.vls[i];
      m.age += dt;
      const tip = t01(m.age - 0.9, 1.3);
      _w.set(0, 30 + 150 * Math.min(m.age, 1), 0).lerp(_v.set(0.86, 0.42, -0.28).normalize().multiplyScalar(340), tip);
      m.vel.copy(_w);
      m.grp.position.addScaledVector(m.vel, dt);
      m.grp.quaternion.setFromUnitVectors(_zAxis, _w.normalize());
      m.smokeT -= dt;
      if (m.smokeT <= 0) { m.smokeT = 0.055; A.G.fx.trail(m.grp.position, 2.6, 0xe8ecf2, 2.8); }
      if (m.age > 4.6) { A.G.scene.remove(m.grp); D.vls.splice(i, 1); }
    }
    // the gatlings hose the dark — short bursts, slow azimuth fans, muzzle
    // flash winking on the decks between the fountains of tracer
    for (const mt of D.mounts) {
      const cyc = (t + mt.phase) % 1.5;
      mt.shooter.pos.set(mt.sh.pos.x + mt.off, mt.sh.pos.y + 15, mt.sh.pos.z + (mt.off > 0 ? 4 : -4));
      if (mt.cont || cyc < 0.85) {
        // the flagship's hoses sweep the sky like sprinklers; the escorts
        // fire short disciplined bursts in fixed quadrants
        const az = mt.cont ? 0.35 + Math.sin(t * 0.4 + mt.off) * 0.85
                           : mt.az + Math.sin((t + mt.phase) * 1.7) * 0.45;
        const el = mt.cont ? 0.5 + Math.sin(t * 0.23 + mt.off) * 0.16
                           : 0.55 + Math.sin(t * 0.9 + mt.phase) * 0.08;
        mt.shooter.fwd.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
        mt.gun.fire(dt, mt.shooter, []);
        mt.flashT -= dt;
        if (mt.flashT <= 0) { mt.flashT = 0.09; A.G.fx.flash(mt.shooter.pos, 5, 0xffd090, 0.09); }
      }
      mt.gun.update(dt);
    }
  },
  teardown(A) {
    const D = A.data;
    for (const mt of D.mounts) for (const tr of mt.gun.tracers) A.G.scene.remove(tr.mesh);
    for (const m of D.vls) A.G.scene.remove(m.grp);
  },
  cam(A, dt, camPos, camera) {
    // one unbroken 360 round the Gettysburg while the whole group fires —
    // hulls slide by below, tracer fountains wheel across the sky
    const cg = A.data.cg, t = A.t;
    const phi = 0.6 + t01(t, 10) * Math.PI * 2;
    A._chase(dt, camPos, camera,
      cg.pos.x + Math.sin(phi) * 500, 70, cg.pos.z + Math.cos(phi) * 500,
      cg.pos.x + 200, 190, cg.pos.z + 30, 3.2, 58 - t01(t, 10) * 12);
  },
};

// ---------------- scene: the sub hunt — torpedoes away ----------------
const Torpedo = {
  name: 'torpedo', dur: 11,
  setup(A) {
    A.G.world.setTimeOfDay('day');
    const sub = A.G.world.enemySub;
    sub.group.visible = true;
    const p3 = A._spawn('p3', { ab: false, gear: false, name: 'P-3 ORION' });
    const s3 = A._spawn('s3', { ab: false, gear: false, name: 'S-3 VIKING' });
    A.data = { sub, p3, s3, torps: [], rel1: false, rel2: false, beat: -1 };
  },
  _drop(A, ac) {
    const D = A.data, f = ac.fwd(_w);
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(
      Torpedo.geo || (Torpedo.geo = (() => { const g = new THREE.CylinderGeometry(0.32, 0.32, 4.4, 8); g.rotateX(Math.PI / 2); return g; })()),
      Torpedo.mat || (Torpedo.mat = new THREE.MeshLambertMaterial({ color: 0x30343a }))));
    grp.position.copy(ac.pos); grp.position.y -= 3;
    A.G.scene.add(grp);
    // the retarder chute streams the instant the weapon leaves the rack
    const ch = new THREE.Group();
    ch.add(new THREE.Mesh(
      Torpedo.canGeo || (Torpedo.canGeo = new THREE.SphereGeometry(3.6, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.52)),
      Torpedo.canMat || (Torpedo.canMat = new THREE.MeshLambertMaterial({ color: 0xff6a26, side: THREE.DoubleSide }))));
    const lp = [];
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; lp.push(Math.cos(a) * 3.3, -0.35, Math.sin(a) * 3.3, 0, -5.2, 0); }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    ch.add(new THREE.LineSegments(lg, Torpedo.lineMat || (Torpedo.lineMat = new THREE.LineBasicMaterial({ color: 0xe8e8e8 }))));
    ch.position.copy(grp.position); ch.position.y += 5.6;
    ch.scale.set(0.25, 0.3, 0.25);
    A.G.scene.add(ch);
    D.torps.push({ grp, ch, vel: new THREE.Vector3(f.x * 100, -2, f.z * 100), state: 'chute', open: 0, seed: Math.random() * 9, wakeT: 0, crumple: -1, hit: false });
  },
  update(A, dt) {
    const D = A.data, t = A.t, sub = D.sub;
    A._spec('prop', 0.65);                     // the Orion owns the voice
    // parallel low tracks up the sub's line of advance — Orion on the port
    // side, Viking offset starboard and a half-mile back
    A._place(D.p3, sub.pos.x - 480 + 115 * t, 86, sub.pos.z - 60, Math.PI / 2, 0, 0);
    A._place(D.s3, sub.pos.x - 620 + 125 * t, 78, sub.pos.z + 90, Math.PI / 2, -0.01, 0);
    for (const p of D.p3.model.userData.props || []) p.rotation.z += dt * 50;
    if (!D.rel1 && D.p3.pos.x >= sub.pos.x - 130) { D.rel1 = true; Torpedo._drop(A, D.p3); }
    if (!D.rel2 && D.s3.pos.x >= sub.pos.x - 120) { D.rel2 = true; Torpedo._drop(A, D.s3); }
    stepTorps(A, dt, sub, 10.15);
  },
  teardown(A) {
    const D = A.data;
    for (const tp of D.torps) { A.G.scene.remove(tp.grp); A.G.scene.remove(tp.ch); }
    A.G.world.enemySub.group.visible = false;
  },
  cam(A, dt, camPos, camera) {
    const D = A.data, t = A.t, sub = D.sub, p3 = D.p3, s3 = D.s3;
    const b = t < 2.8 ? 0 : t < 5.6 ? 1 : t < 8.6 ? 2 : 3;
    if (D.beat !== b) {
      D.beat = b;
      if (A.G.flashCut) A.G.flashCut(0.12);
      if (b === 1) camPos.set(sub.pos.x - 40, 9, sub.pos.z - 200);
      else if (b === 2 && D.torps[0]) camPos.set(D.torps[0].grp.position.x - 30, D.torps[0].grp.position.y + 14, D.torps[0].grp.position.z + 36);
      else if (b === 3) camPos.set(sub.pos.x + 120, 12, sub.pos.z + 260);
      camera.position.copy(camPos);
    }
    if (b === 0) {
      // off the Orion's starboard wing — both hunters in one frame
      A._chase(dt, camPos, camera,
        p3.pos.x - 24, p3.pos.y + 9, p3.pos.z + 26,
        (p3.pos.x + s3.pos.x) / 2, (p3.pos.y + s3.pos.y) / 2 - 4, (p3.pos.z + s3.pos.z) / 2,
        3.2, 54 - t01(t, 2.8) * 12);
    } else if (b === 1) {
      // down on the water at the drop point — the run comes overhead and the
      // chutes crack open right on top of the camera
      const lk = (t < 3.9 || !D.torps[0]) ? p3.pos : D.torps[0].grp.position;
      A._chase(dt, camPos, camera,
        sub.pos.x - 40, 9, sub.pos.z - 200,
        lk.x, lk.y, lk.z, 5, 50 - t01(t - 2.8, 2.8) * 12);
    } else if (b === 2) {
      // riding alongside the first weapon under its canopy — the boat waits below
      const tp = (D.torps[0] && D.torps[0].state === 'chute') ? D.torps[0] : D.torps[1] || D.torps[0];
      A._chase(dt, camPos, camera,
        tp.grp.position.x - 26, tp.grp.position.y + 12, tp.grp.position.z + 32,
        tp.grp.position.x, tp.grp.position.y, tp.grp.position.z, 4.5, 46 - t01(t - 5.6, 3) * 10);
    } else {
      // low and wide off the bow — two wakes converge and the sea erupts
      A._chase(dt, camPos, camera,
        sub.pos.x + 120, 12, sub.pos.z + 260,
        sub.pos.x + 20, 6, sub.pos.z, 3.2, 52 - t01(t - 8.6, 2.4) * 14);
    }
  },
};

// shared torp-chute physics: every weapon in A.data.torps opens its
// retarder chute, brakes to splashdown, then homes on the live sub with a
// wake — killAt is the scene's backstop cut time
function stepTorps(A, dt, sub, killAt) {
  for (const tp of A.data.torps) {
    if (tp.state === 'chute') {
      // canopy cracks open, then brakes the fall to a soft splashdown
      tp.open = Math.min(1, tp.open + dt / 0.4);
      const s = 0.25 + 0.8 * tp.open;
      tp.ch.scale.set(s, 0.3 + 0.7 * tp.open, s);
      tp.ch.rotation.z = Math.sin(A.G.time * 1.6 + tp.seed) * 0.12;
      tp.ch.rotation.x = Math.cos(A.G.time * 1.3 + tp.seed) * 0.1;
      tp.vel.x = damp(tp.vel.x, 12, 1.1, dt);
      tp.vel.z = damp(tp.vel.z, 0, 1.1, dt);
      tp.vel.y = damp(tp.vel.y, -26, 1.4, dt);
      tp.grp.position.addScaledVector(tp.vel, dt);
      tp.grp.quaternion.setFromUnitVectors(_zAxis, _w.copy(tp.vel).normalize());
      tp.ch.position.copy(tp.grp.position); tp.ch.position.y += 5.6;
      if (tp.grp.position.y <= 0.5) {
        tp.state = 'run';
        tp.grp.position.y = -3;
        A.G.fx.splash(_v.copy(tp.grp.position).setY(0.5), 1.1);
        A.G.audio.splash(1.0);
        tp.crumple = 0;
        tp.ch.position.y = 1.4;   // the spent canopy collapses on the sea
      }
    } else if (tp.state === 'run') {
      const p = tp.grp.position;
      _v.set(sub.pos.x - p.x, 0, sub.pos.z - p.z);
      const dist = _v.length(); _v.normalize();
      p.x += _v.x * 40 * dt; p.z += _v.z * 40 * dt; p.y = -3;
      tp.grp.quaternion.setFromUnitVectors(_zAxis, _v);
      tp.wakeT -= dt;
      if (tp.wakeT <= 0) {
        tp.wakeT = 0.07;
        A.G.fx.trail(_w.set(p.x, 0.5, p.z), 6.5, 0xffffff, 2.6);
        if (Math.random() < 0.3) A.G.fx.splash(_w, 0.45);
      }
      if (dist < 82 || A.t > killAt) {   // the sub-carrier's beam is 128m: detonate at her waterline, not under the hull
        tp.state = 'dead';
        A.G.scene.remove(tp.grp);
        _w.set(p.x, 1, p.z);
        A.G.fx.splash(_w, 2.3);
        A.G.fx.explosion(_w, 1.7);
        A.G.audio.splash(1.2);
        A.G.audio.explosion(A.G.camera.position.distanceTo(_w));
      }
    }
    if (tp.crumple >= 0) {
      tp.crumple += dt;
      const k = t01(tp.crumple, 0.55);
      tp.ch.scale.set(1.05 + k * 0.15, (1 - k) * 0.9 + 0.06, 1.05 + k * 0.15);
      if (tp.crumple > 1.4) { A.G.scene.remove(tp.ch); tp.crumple = -1; }
    }
  }
}

// ---------------- scene: Air Force One with the Eagle watch ----------------
const AirForceOne = {
  name: 'af1', dur: 12,
  setup(A) {
    A.G.world.setTimeOfDay('day');
    const af1 = A._spawn('b747', { ab: false, gear: false, name: 'AIR FORCE ONE' });
    const e1 = A._spawn('f15', { ab: false, gear: false, name: 'ESCORT 1' });
    const e2 = A._spawn('f15', { ab: false, gear: false, name: 'ESCORT 2' });
    af1.speed = e1.speed = e2.speed = 220;
    A.data = { af1, e1, e2, C: new THREE.Vector3(12000, 2600, 16000), hdg: Math.PI * 0.32 };
  },
  update(A, dt) {
    const D = A.data, t = A.t, h = D.hdg;
    A._spec('turbofan', 0.8);
    const fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const px = D.C.x + fx * 220 * t, pz = D.C.z + fz * 220 * t, py = D.C.y + Math.sin(t * 0.5) * 12;
    // right = (cos h, 0, sin h): an Eagle welded to each wingtip, stepped
    // down and a touch back
    A._place(D.af1, px, py, pz, h, 0, Math.sin(t * 0.4) * 0.02);
    A._place(D.e1, px + rx * 40 - fx * 14, py - 7, pz + rz * 40 - fz * 14, h, 0, 0.03);
    A._place(D.e2, px - rx * 40 - fx * 14, py - 7, pz - rz * 40 - fz * 14, h, 0, -0.03);
  },
  cam(A, dt, camPos, camera) {
    // a full lap round the formation, opening on the rear quarter and
    // closing the whole way — the escorts hold station through frame
    const D = A.data, t = A.t, k = t01(t, 12), h = D.hdg;
    const fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const phi = Math.PI - 0.5 + k * Math.PI * 1.76;   // ~317 degrees: ends on the front-right money shot, short of the rear-right blind spot
    const r = (160 - k * 55) * (1 + 0.3 * Math.abs(Math.sin(phi)));   // breathe out abeam so the near escort holds frame
    const ox = fx * Math.cos(phi) * r + rx * Math.sin(phi) * r;
    const oz = fz * Math.cos(phi) * r + rz * Math.sin(phi) * r;
    // screen-space look bias, stable all the way round the lap (a formation-
    // space bias flips sign as the camera circles): push the frame contents
    // right, clear of the menu — same trick as Furball and BridgeRun
    _v.set(fx * 12 - ox, 0, fz * 12 - oz).normalize();
    _w.set(-_v.z, 0, _v.x);
    A._chase(dt, camPos, camera,
      D.af1.pos.x + ox, D.af1.pos.y + 26 - k * 16, D.af1.pos.z + oz,
      D.af1.pos.x + fx * 12 - _w.x * 38, D.af1.pos.y + 2, D.af1.pos.z + fz * 12 - _w.z * 38, 3, 54 - k * 4);
  },
};

// ---------------- scene: the Seahawk's dip turns into an attack ----------------
const HeloTorp = {
  name: 'helotorp', dur: 10,
  setup(A) {
    A.G.world.setTimeOfDay('dusk');
    const sub = A.G.world.enemySub;
    sub.group.visible = true;
    const h = new Helicopter(A.G.scene, A.G.world, {
      type: 'seahawk', spun: true, cruiseAlt: 60,
      pos: new THREE.Vector3(sub.pos.x - 240, 60, sub.pos.z + 130),   // on station almost at once — the drop must happen over the hover
      heading: Math.PI / 2,
    });
    h.order({ kind: 'goto', wp: { x: sub.pos.x - 170, y: 46, z: sub.pos.z + 90 } });
    A.data = { h, sub, torps: [], dropped: false, beat: -1 };
  },
  update(A, dt) {
    const D = A.data, t = A.t;
    A._spec('prop', 0.65);
    // hover on her quarter, tracking the creep
    D.h.wp.x = D.sub.pos.x - 170; D.h.wp.z = D.sub.pos.z + 90;
    D.h.update(dt, A.G);
    const hdx = D.h.pos.x - (D.sub.pos.x - 170), hdz = D.h.pos.z - (D.sub.pos.z + 90);
    if (t > 1.7 && !D.dropped && (hdx * hdx + hdz * hdz < 6400 || t > 3.5)) {
      D.dropped = true;
      // weapon away and a wall of flares in the same beat
      Torpedo._drop(A, { pos: D.h.pos, fwd: (o) => D.h.fwd(o) });
      const tp = D.torps[D.torps.length - 1], f = D.h.fwd(_v);
      tp.vel.set(f.x * 8, -1, f.z * 8);       // a drop, not a launch
      for (let i = 0; i < 8; i++) {
        _w.copy(D.h.pos).add(_v.set(rand(-16, 16), rand(-8, 2), rand(-16, 16)));
        A.G.fx.flash(_w, 4, 0xffc860, 0.5);
        A.G.fx.smoke(_w, 1.1, 0.9, 0xffd080);
      }
    }
    stepTorps(A, dt, D.sub, 9.0);
  },
  teardown(A) {
    const D = A.data;
    for (const tp of D.torps) { A.G.scene.remove(tp.grp); A.G.scene.remove(tp.ch); }
    A.G.scene.remove(D.h.model);
    A.G.world.enemySub.group.visible = false;
  },
  cam(A, dt, camPos, camera) {
    const D = A.data, t = A.t, h = D.h;
    const b = t < 2.4 ? 0 : t < 6.5 ? 1 : 2;
    if (D.beat !== b) {
      if (D.beat >= 0 && A.G.flashCut) A.G.flashCut(0.12);
      D.beat = b;
      const tp = D.torps[0];
      if (b === 1 && tp) camPos.set(tp.grp.position.x - 24, tp.grp.position.y + 11, tp.grp.position.z + 30);
      else if (b === 2) camPos.set(D.sub.pos.x - 40, 12, D.sub.pos.z + 220);
      camera.position.copy(camPos);
    }
    if (b === 0) {
      // rear three-quarter on the hover, swinging toward the nose, closing —
      // the drop and the flare wall happen mid-sweep
      const k = t01(t, 2.4);
      const phi = Math.PI - 0.6 + k * 2.3;
      const f = h.fwd(_w), rx = Math.cos(h.heading), rz = Math.sin(h.heading);
      const r = 42 - k * 14;
      const ox = (f.x * Math.cos(phi) + rx * Math.sin(phi)) * r;
      const oz = (f.z * Math.cos(phi) + rz * Math.sin(phi)) * r;
      _v.set(-ox, 0, -oz).normalize();   // camera-to-helo: bias the look along camera-right, clear of the menu
      A._chase(dt, camPos, camera,
        h.pos.x + ox, h.pos.y + 9, h.pos.z + oz,
        h.pos.x + _v.z * 6, h.pos.y - 2, h.pos.z - _v.x * 6, 3.4, 56 - k * 10);
    } else if (b === 1) {
      // ride the weapon down under its canopy — look biased camera-right, clear of the menu
      const tp = D.torps[0];
      if (tp) {
        const run = tp.state === 'run';
        if (run) {
          // she's swimming: high behind the weapon, wake stretching ahead to the target
          _v.set(D.sub.pos.x - tp.grp.position.x, 0, D.sub.pos.z - tp.grp.position.z).normalize();
          A._chase(dt, camPos, camera,
            tp.grp.position.x - _v.x * 50 - _v.z * 24, 42, tp.grp.position.z - _v.z * 50 + _v.x * 24,
            tp.grp.position.x + _v.x * 14 + _v.z * 8, 0, tp.grp.position.z + _v.z * 14 - _v.x * 8, 4.5, 42);
        } else {
          _v.set(24, 0, -30).normalize();
          A._chase(dt, camPos, camera,
            tp.grp.position.x - 24, tp.grp.position.y + 11, tp.grp.position.z + 30,
            tp.grp.position.x + _v.z * 6, tp.grp.position.y, tp.grp.position.z - _v.x * 6, 4.5, 46 - t01(t - 2.4, 4.1) * 10);
        }
      }
    } else {
      // low off her beam on the weapon's approach side: the wake closes and the sea erupts
      A._chase(dt, camPos, camera,
        D.sub.pos.x - 40, 12, D.sub.pos.z + 220,
        D.sub.pos.x - 75, 3, D.sub.pos.z + 45, 3.2, 52 - t01(t - 6.5, 2.4) * 14);
    }
  },
};

// ---------------- scene: door gunner vs the fast boat ----------------
const HeloGun = {
  name: 'helogun', dur: 10.5,
  setup(A) {
    A.G.world.setTimeOfDay('day');
    // hover at 300 ft over open water, right side to the threat axis
    const h = new Helicopter(A.G.scene, A.G.world, {
      type: 'seahawk', spun: true,
      pos: new THREE.Vector3(-20000, 91, 8000),
      heading: 0,                       // nose north; the gun looks east
    });
    const boat = A._spawn('boat', { ab: false, gear: false, name: 'GO-FAST' });
    boat.speed = 45;
    boat.pos.set(-19450, 0.6, 8000);   // 550 m east, charging the gun line
    // door gun: a short barrel bolted to the right-hand door
    const gun = new GunSystem(A.G);
    const barrel = new THREE.Mesh(
      HeloGun.bGeo || (HeloGun.bGeo = (() => { const g = new THREE.CylinderGeometry(0.09, 0.09, 2.2, 6); g.rotateZ(Math.PI / 2); return g; })()),
      HeloGun.bMat || (HeloGun.bMat = new THREE.MeshBasicMaterial({ color: 0x1c2024 })));
    barrel.position.set(-1.7, -0.6, 0.3);   // model right is -x
    h.model.add(barrel);
    const shooter = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), vel: new THREE.Vector3(), stores: { gun: 99999 }, isPlayer: false };
    A.data = {
      h, boat, gun, shooter, barrel, beat: -1, flashT: 0, splashT: 0, aimT: 0,
      aim: new THREE.Vector3(30, 0, -14),
    };
  },
  update(A, dt) {
    const D = A.data, t = A.t, h = D.h, boat = D.boat;
    A._spec('prop', 0.55);
    A.G.audio.setGatling((t % 1.2) < 0.7 && t > 1.2);   // the bursts bark
    // rock-steady hover at 300 ft (parked holds the spot; we keep the rotor lit)
    h.rpm = 1;
    h.update(dt, A.G);
    h.model.position.y += Math.sin(A.G.time * 1.1) * 0.5;   // hover breathe
    // the go-fast runs straight at the gun, throwing a rooster tail
    const gx = h.pos.x + 1.7, gz = h.pos.z + 0.3;   // gun world (heading 0: right = +x)
    const dx = gx - boat.pos.x, dz = gz - boat.pos.z;
    const dist = Math.hypot(dx, dz);
    const bh = Math.atan2(dx, -dz);
    A._place(boat, boat.pos.x + Math.sin(bh) * 45 * dt, 0.6, boat.pos.z - Math.cos(bh) * 45 * dt, bh, 0, 0);
    D.splashT -= dt;
    if (D.splashT <= 0) {   // bow spray + wake
      D.splashT = 0.13;
      A.G.fx.trail(_w.set(boat.pos.x - Math.sin(bh) * 4, 0.4, boat.pos.z + Math.cos(bh) * 4), 2.6, 0xffffff, 1.3);
      if (Math.random() < 0.35) A.G.fx.splash(_v.set(boat.pos.x + Math.sin(bh) * 4, 0.5, boat.pos.z - Math.cos(bh) * 4), 0.5);
    }
    // the gunner walks his bursts onto the boat — the aim point wanders
    // tight as the run closes
    D.aimT -= dt;
    if (D.aimT <= 0) {
      D.aimT = 0.45;
      const spread = 42 * (1 - t01(t, 9.6)) + 4;
      const a = Math.random() * Math.PI * 2, rr = (0.35 + Math.random() * 0.65) * spread;
      D.aim.set(boat.pos.x + Math.cos(a) * rr, 0, boat.pos.z + Math.sin(a) * rr);
    }
    // bursts: 0.7 s on, 0.5 s off
    D.shooter.pos.set(gx, h.pos.y - 1.4, gz);
    D.shooter.fwd.set(D.aim.x - gx, D.aim.y - (h.pos.y - 1.4), D.aim.z - gz).normalize();
    if ((t % 1.2) < 0.7 && t > 1.2) {
      D.gun.fire(dt, D.shooter, []);
      D.flashT -= dt;
      if (D.flashT <= 0) {
        D.flashT = 0.09;
        A.G.fx.flash(D.shooter.pos, 3, 0xffc860, 0.08);
      }
      // rounds striking the sea around the boat
      if (Math.random() < 0.55) A.G.fx.splash(_v.set(D.aim.x + rand(-6, 6), 0.5, D.aim.z + rand(-6, 6)), 0.55);
    }
    D.gun.update(dt);
  },
  teardown(A) {
    const D = A.data;
    for (const tr of D.gun.tracers) A.G.scene.remove(tr.mesh);
    D.h.model.remove(D.barrel);
    A.G.scene.remove(D.h.model);
  },
  cam(A, dt, camPos, camera) {
    const D = A.data, t = A.t, h = D.h, boat = D.boat;
    const b = t < 8.6 ? 0 : 1;
    if (D.beat !== b) {
      if (D.beat >= 0 && A.G.flashCut) A.G.flashCut(0.12);
      D.beat = b;
      if (b === 1) {
        const bh = Math.atan2(h.pos.x - boat.pos.x, -(h.pos.z - boat.pos.z));
        camPos.set(boat.pos.x - Math.sin(bh) * 3.5, 2.6, boat.pos.z + Math.cos(bh) * 3.5);
      }
      camera.position.copy(camPos);
    }
    if (b === 0) {
      // a full lap round the gunship, tight and closing — the door gun and
      // its tracer stream stitched down toward the charging go-fast
      const k = t01(t, 8.6);
      const phi = Math.PI - 0.5 + k * Math.PI * 2;
      const r = 46 - k * 18;
      const gx = h.pos.x + 1.7, gz = h.pos.z + 0.3;
      const cx = h.pos.x + Math.sin(phi) * r, cz = h.pos.z + Math.cos(phi) * r;
      _v.set(boat.pos.x - gx, 0, boat.pos.z - gz).normalize();   // gun-to-boat line
      // look down the tracer lane early, swing back onto the gun as the orbit
      // comes round the boat side — else the lane lead drags her out of frame
      const lead = (24 - k * 10) * (1 - k * k);
      const lx = gx + _v.x * lead, lz = gz + _v.z * lead;
      // screen-space bias off the true view axis: frame contents shift right, clear of the menu
      _w.set(lx - cx, 0, lz - cz).normalize();
      const rx = -_w.z, rz = _w.x;
      A._chase(dt, camPos, camera,
        cx, h.pos.y + 10 - k * 6, cz,
        lx - rx * 12, h.pos.y - 1 - k * 2, lz - rz * 12, 3, 56 - k * 8);
    } else {
      // the go-fast's bow: the Seahawk hangs dead ahead at 300 ft and the
      // tracers rip past overhead
      const bh = Math.atan2(h.pos.x - boat.pos.x, -(h.pos.z - boat.pos.z));
      A._chase(dt, camPos, camera,
        boat.pos.x - Math.sin(bh) * 3.5, 2.6, boat.pos.z + Math.cos(bh) * 3.5,
        h.pos.x, h.pos.y, h.pos.z, 7, 52);
    }
  },
};

// ---------------- scene: SAR — the group brings its pilot home ----------------
const Rescue = {
  name: 'rescue', dur: 18,
  setup(A) {
    A.G.world.setTimeOfDay('day');
    const c = A.G.world.carrier;
    // already under the canopy, ninety seconds into the float down
    const start = new THREE.Vector3(c.pos.x + 700, 120, c.pos.z - 420);
    const chute = new Chute(A.G.scene, start, new THREE.Vector3(4, -2, 0), 0);
    chute.t = 1.7; chute.canopy.scale.set(1, 0.72, 1); chute.lines.visible = true;
    // the alert helo is already off the deck and bending on
    const h = new Helicopter(A.G.scene, A.G.world, {
      type: 'seahawk', spun: true, cruiseAlt: 55, cruiseSpeed: 115,
      pos: new THREE.Vector3(c.pos.x + 330, 55, c.pos.z - 200),
      heading: Math.PI / 2,
    });
    // no goto order — the update loop hand-flies the whole profile
    // winch wire, hidden until the hoist
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const wire = new THREE.Line(wg, Rescue.wMat || (Rescue.wMat = new THREE.LineBasicMaterial({ color: 0x101418 })));
    wire.visible = false; wire.frustumCulled = false;
    A.G.scene.add(wire);
    A.data = { c, chute, h, wire, phase: 'float', beat: -1, grabY: 0 };
  },
  update(A, dt) {
    const D = A.data, t = A.t, ch = D.chute, h = D.h;
    A._spec('prop', 0.55);
    if (D.phase === 'float') {
      ch.update(dt);                        // the long float down
      // hand-flown inbound: bore in for a spot over the pilot — the stock
      // goto loiters and the scene clock can't wait on it
      _v.set(ch.group.position.x - h.pos.x, 55 - h.pos.y, ch.group.position.z - h.pos.z);
      const d0 = _v.length();
      if (d0 > 0.01) {
        _v.normalize();
        h.pos.addScaledVector(_v, Math.min(d0, 85 * dt));
        h.heading = damp(h.heading, Math.atan2(_v.x, -_v.z), 1.2, dt);
      }
      h.rpm = 1;
      h.update(dt, A.G);
      // on station overhead: switch to a driven hover above the pilot
      const dx = ch.group.position.x - h.pos.x, dz = ch.group.position.z - h.pos.z;
      if (Math.hypot(dx, dz) < 60 && h.pos.y < 75) { D.phase = 'hover'; h.mode = 'parked'; }
    } else {
      // hand-flown from here: hold station over the pilot, winch him up,
      // then bend on for the boat
      let tx, ty, tz;
      if (D.phase === 'hover') {
        ch.update(dt);                      // he keeps floating while the helo positions
        tx = ch.group.position.x; ty = ch.group.position.y + 15; tz = ch.group.position.z;
        const d = Math.hypot(tx - h.pos.x, tz - h.pos.z);
        if (d < 4 && Math.abs(h.pos.y - ty) < 2.5) {
          D.phase = 'hoist';
          D.grabY = h.pos.y;                // hold this altitude on the winch — else helo and pilot ladder-climb forever
          ch.landed = true;                 // freeze the chute's own physics
          ch.canopy.visible = false; ch.lines.visible = false;
          D.wire.visible = true;
        }
      } else if (D.phase === 'hoist') {
        tx = ch.group.position.x; ty = D.grabY; tz = ch.group.position.z;
        ch.group.position.y += (h.pos.y - 9 - ch.group.position.y) * Math.min(1, 1.3 * dt);
        ch.group.rotation.set(0, 0, 0);
        if (ch.group.position.y > h.pos.y - 9.6) D.phase = 'home';
      } else {
        // straight leg back to the carrier, pilot on the wire
        const c = D.c;
        tx = c.pos.x + 40; ty = 42; tz = c.pos.z;
      }
      const sp = D.phase === 'home' ? 34 : 26;
      _v.set(tx - h.pos.x, ty - h.pos.y, tz - h.pos.z);
      const d = _v.length();
      if (d > 0.01) {
        _v.normalize();
        const step = Math.min(d, sp * dt);
        h.pos.addScaledVector(_v, step);
        h.heading = damp(h.heading, Math.atan2(_v.x, -_v.z), 1.2, dt);
      }
      h.rpm = 1;                            // parked would spool down — keep her lit
      h.update(dt, A.G);                    // parked with no anchor holds position
      if (D.phase !== 'hover') {            // pilot rides the wire once grabbed
        ch.group.position.x = h.pos.x; ch.group.position.z = h.pos.z;
        if (D.phase === 'home') ch.group.position.y = h.pos.y - 9.6;
      }
      const p = D.wire.geometry.attributes.position;
      p.setXYZ(0, h.pos.x, h.pos.y - 1.5, h.pos.z);
      p.setXYZ(1, ch.group.position.x, ch.group.position.y + 2.2, ch.group.position.z);
      p.needsUpdate = true;
    }
  },
  teardown(A) {
    const D = A.data;
    A.G.scene.remove(D.chute.group); A.G.scene.remove(D.h.model); A.G.scene.remove(D.wire);
  },
  cam(A, dt, camPos, camera) {
    const D = A.data, t = A.t, ch = D.chute, h = D.h;
    const b = t < 4.5 ? 0 : t < 8 ? 1 : t < 13 ? 2 : 3;
    const p = ch.group.position;
    if (D.beat !== b) {
      if (D.beat >= 0 && A.G.flashCut) A.G.flashCut(0.12);
      D.beat = b;
      if (b === 1) {
        _v.set(h.pos.x - p.x, 0, h.pos.z - p.z).normalize();
        camPos.set(p.x - _v.x * 25 - _v.z * 55, 14, p.z - _v.z * 25 + _v.x * 55);
      } else if (b === 2) camPos.set(h.pos.x + 26, h.pos.y + 2, h.pos.z + 26);
      else if (b === 3) {
        _v.set(D.c.pos.x - h.pos.x, 0, D.c.pos.z - h.pos.z).normalize();
        _w.set(-_v.z, 0, _v.x);
        camPos.set(h.pos.x - _v.x * 55 + _w.x * 30, h.pos.y + 16, h.pos.z - _v.z * 55 + _w.z * 30);
      }
      camera.position.copy(camPos);
    }
    if (b === 0) {
      // slow orbit of the float down, closing in
      const k = t01(t, 4.5);
      const phi = 2.4 + k * 2.2;
      A._chase(dt, camPos, camera,
        p.x + Math.sin(phi) * (58 - k * 20), p.y + 6, p.z + Math.cos(phi) * (58 - k * 20),
        p.x, p.y + 2, p.z, 3.2, 56 - k * 10);
    } else if (b === 1) {
      // side-on tracking shot: the pilot foreground, the Seahawk swelling
      // inbound beyond him — the pair shoved right, clear of the menu
      _v.set(h.pos.x - p.x, 0, h.pos.z - p.z).normalize();      // chute -> helo line
      _w.set(-_v.z, 0, _v.x);                                   // camera right
      A._chase(dt, camPos, camera,
        p.x - _v.x * 25 - _v.z * 55, 14, p.z - _v.z * 25 + _v.x * 55,
        p.x + _v.x * 30 - _w.x * 42, (p.y + h.pos.y) / 2, p.z + _v.z * 30 - _w.z * 42, 3.4, 50 - t01(t - 4.5, 3.5) * 10);
    } else if (b === 2) {
      // tight circle on the hoist: the pilot comes up to the door
      const k = t01(t - 8, 5);
      const phi = 0.8 + k * 1.8;
      const cx = h.pos.x + Math.sin(phi) * 30, cz = h.pos.z + Math.cos(phi) * 30;
      _v.set(h.pos.x - cx, 0, h.pos.z - cz).normalize();
      _w.set(-_v.z, 0, _v.x);
      A._chase(dt, camPos, camera, cx, h.pos.y + 2, cz,
        h.pos.x - _w.x * 8, h.pos.y - 5, h.pos.z - _w.z * 8, 3.6, 46 - k * 8);
    } else {
      // off their trailing quarter: helo, pilot on the wire, the boat beyond
      const c = D.c;
      _v.set(c.pos.x - h.pos.x, 0, c.pos.z - h.pos.z).normalize();
      _w.set(-_v.z, 0, _v.x);
      A._chase(dt, camPos, camera,
        h.pos.x - _v.x * 55 + _w.x * 30, h.pos.y + 16, h.pos.z - _v.z * 55 + _w.z * 30,
        h.pos.x + _v.x * 60 - _w.x * 34, 30, h.pos.z + _v.z * 60 - _w.z * 34, 2.6, 48 - t01(t - 13, 5) * 8);
    }
  },
};

// ---------------- scene: burners over downtown ----------------
const CityBuzz = {
  name: 'citybuzz', dur: 11,
  setup(A) {
    A.G.world.setTimeOfDay('night');
    const jets = [];
    for (let i = 0; i < 4; i++) jets.push(A._spawn('f18', { ab: true, gear: false, name: 'BUZZ ' + (i + 1) }));
    // the skyline is rebuilt fresh every load — pull the real towers out of
    // the instanced mesh so the corridor and rooftop cams hit actual buildings
    const bm = A.G.world.cityMesh, M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
    const towers = [];
    for (let i = 0; i < bm.count; i++) { bm.getMatrixAt(i, M); M.decompose(P, Q, S); towers.push({ x: P.x, z: P.z, top: P.y + S.y, h: S.y }); }
    const dir = new THREE.Vector3(0.806, 0, -0.592).normalize();
    const P0 = new THREE.Vector3(5900, 0, 5620);
    // slide the corridor sideways until nothing taller than the jets pierces it
    let best = 0, bestScore = -1;
    for (let s = -80; s <= 80; s += 8) {
      let score = 1e9;
      for (const b of towers) {
        if (b.top < 198) continue;
        const rx = b.x - P0.x, rz = b.z - P0.z;
        const along = rx * dir.x + rz * dir.z;
        if (along < -100 || along > 3500) continue;
        const perp = Math.abs(rx * -dir.z + rz * dir.x - s);
        if (perp < score) score = perp;
      }
      if (score > bestScore) { bestScore = score; best = s; }
    }
    P0.x += -dir.z * best; P0.z += dir.x * best;
    // rooftop anchors: the tallest tower nearest each beat's stretch of track
    const anchor = (tt, lo) => {
      const px = P0.x + dir.x * 300 * tt, pz = P0.z + dir.z * 300 * tt;
      let pick = null, pd = 1e9;
      for (const b of towers) { if (b.h < lo) continue; const d = (b.x - px) ** 2 + (b.z - pz) ** 2; if (d < pd) { pd = d; pick = b; } }
      return pick;
    };
    // rooftop: a tower the formation will actually BUZZ — right beside the
    // track with its roof just below the jets, not a block away
    let bRoof = null, bd = 1e9;
    for (const b of towers) {
      if (b.top < 150 || b.top > 196) continue;
      const rx = b.x - P0.x, rz = b.z - P0.z;
      const along = rx * dir.x + rz * dir.z;
      if (along < 700 || along > 1500) continue;   // the pass must land inside beat 1
      const lat = Math.abs(rx * -dir.z + rz * dir.x);
      if (lat < bd) { bd = lat; bRoof = b; }
    }
    if (!bRoof || bd > 70) bRoof = anchor(3.6, 110) || { x: 7000, z: 5000, top: 160 };
    A.data = { jets, P0, dir, right: new THREE.Vector3(-dir.z, 0, dir.x), y: 205, h: Math.atan2(dir.x, -dir.z), bRoof, beat: -1 };
  },
  update(A, dt) {
    const D = A.data, t = A.t, f = D.dir, r = D.right;
    A._spec('jet', 0.95);
    const bank = Math.sin(t * 0.85) * 0.16;
    const cx = D.P0.x + f.x * 300 * t, cz = D.P0.z + f.z * 300 * t;
    // tight diamond — lead, wingmen stepped back on the beams, slot in the wash
    const offs = [[0, 0, 0], [-26, 4, -20], [-26, 4, 20], [-52, 9, 0]];
    D.jets.forEach((j, i) => {
      const o = offs[i];
      A._place(j,
        cx + f.x * o[0] + r.x * o[2], D.y + o[1] + Math.sin(t * 0.7 + i) * 2, cz + f.z * o[0] + r.z * o[2],
        D.h, -0.01, bank * (i === 3 ? 0.6 : 1));
    });
  },
  cam(A, dt, camPos, camera) {
    const D = A.data, t = A.t, lead = D.jets[0], f = D.dir;
    const b = t < 2.4 ? 0 : t < 4.8 ? 1 : t < 7.2 ? 2 : t < 9.4 ? 3 : 4;
    if (D.beat !== b) {
      D.beat = b;
      if (A.G.flashCut) A.G.flashCut(0.1);
      if (b === 1) camPos.set(D.bRoof.x + D.right.x * 18, D.bRoof.top + 9, D.bRoof.z + D.right.z * 18);
      else if (b === 2) camPos.set(7372, 248, 4672);
      else if (b === 3) camPos.set(lead.pos.x + f.x * 95, lead.pos.y + 6, lead.pos.z + f.z * 95);
      else if (b === 4) camPos.set(lead.pos.x - f.x * 75, lead.pos.y + 34, lead.pos.z - f.z * 75);
      camera.position.copy(camPos);
    }
    if (b === 0) {
      // hard arc off the formation — swings astern-to-beam, city rising ahead
      const r = D.right, phi = Math.PI + t01(t, 2.4) * Math.PI * 0.85;
      A._chase(dt, camPos, camera,
        lead.pos.x + (f.x * Math.cos(phi) + r.x * Math.sin(phi)) * 58,
        lead.pos.y + 12,
        lead.pos.z + (f.z * Math.cos(phi) + r.z * Math.sin(phi)) * 58,
        lead.pos.x + f.x * 10, lead.pos.y + 2, lead.pos.z + f.z * 10, 4.5, 58 - t01(t, 2.4) * 10);
    } else if (b === 1) {
      // rooftop — the diamond comes straight down the boulevard and over the camera
      A._chase(dt, camPos, camera,
        D.bRoof.x + D.right.x * 18, D.bRoof.top + 9, D.bRoof.z + D.right.z * 18,
        lead.pos.x, lead.pos.y, lead.pos.z, 5, 50 - t01(t - 2.4, 2.4) * 12);
    } else if (b === 2) {
      // the Transamerica perch — burners carve past BELOW the tip
      A._chase(dt, camPos, camera,
        7372, 248, 4672,
        lead.pos.x, lead.pos.y + 2, lead.pos.z, 5, 55 - t01(t - 4.8, 2.4) * 15);
    } else if (b === 3) {
      // riding ahead looking back — four burners coming at the camera with
      // the whole lit skyline and the pyramid behind them
      A._chase(dt, camPos, camera,
        lead.pos.x + f.x * 95, lead.pos.y + 6, lead.pos.z + f.z * 95,
        lead.pos.x - f.x * 140, lead.pos.y + 18, lead.pos.z - f.z * 140, 4.5, 58 - t01(t - 7.2, 2.2) * 14);
    } else {
      // gone — chasing the burners out over the bay
      A._chase(dt, camPos, camera,
        lead.pos.x - f.x * 75, lead.pos.y + 34, lead.pos.z - f.z * 75,
        lead.pos.x + f.x * 140, lead.pos.y + 10, lead.pos.z + f.z * 140, 4, 54 - t01(t - 9.4, 1.6) * 12);
    }
  },
};

const SCENES = [Catapult, Screwtops, Furball, Tracers, BattleGroup, Ciws, Trap, Sonobuoy, Torpedo, HeloTorp, HeloGun, Rescue, MissileCam, Eagle, Airliner, AirForceOne, Jink, Fleet, HeloShip, Harrier, Prowler, Hawg, CityBuzz, BridgeRun];
