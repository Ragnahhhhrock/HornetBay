// attract.js — the homepage demo director. The old attract was one Hornet
// touring the bay at 210 knots; this is a seventeen-scene cinematic reel
// that cuts between carrier ops, dogfights, the battle group, the heavies
// and the sub hunt — day, dusk and night — so the menu sells the world
// behind it.
import * as THREE from 'three';
import { AIAircraft } from './ai.js';
import { Missile, GunSystem } from './weapons.js';
import { Helicopter } from './rotors.js';
import { makeGlowTexture } from './models.js';
import { flightQuat, clamp, lerp, damp, rand } from './util.js';

let _abGlowTex = null;

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _look = new THREE.Vector3();

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
    return m;
  }
  _teardown() {
    if (this.idx >= 0 && SCENES[this.idx].teardown) SCENES[this.idx].teardown(this);
    for (const a of this.actors) a.dispose();
    this.actors = [];
    for (const m of this.missiles) if (!m.dead) m._die();
    this.missiles = [];
    this.data = {};
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
      if (!D.launched) { D.launched = true; deckP(c, -13, Y, 32, _v); A.G.fx.flash(_v, 10, 0xffa030, 0.3); }
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
    const D = A.data, c = A.G.world.carrier, t = A.t;
    if (t < 2) {                                 // bow ramp, looking back at the jet on the cat
      deckP(c, 4, c.deckY + 3, 112, _v);
      A._chase(dt, camPos, camera, _v.x, _v.y, _v.z, D.j.pos.x, D.j.pos.y + 1, D.j.pos.z, 4, 52 - t01(A.t, 2) * 8);
    } else if (t < 4.6) {                        // run alongside the shot, trailing the burners
      deckD(c, 0, 0, 1, _w);
      A._chase(dt, camPos, camera,
        D.j.pos.x - _w.x * 26 + _w.z * 14, D.j.pos.y + 4.5, D.j.pos.z - _w.z * 26 - _w.x * 14,
        D.j.pos.x, D.j.pos.y + 1, D.j.pos.z, 4, 52 - t01(A.t - 2, 2.6) * 12);
    } else {                                     // chase the climb-out
      const f = D.j.fwd(_w);
      A._chase(dt, camPos, camera,
        D.j.pos.x - f.x * 46, D.j.pos.y + 10, D.j.pos.z - f.z * 46,
        D.j.pos.x + f.x * 40, D.j.pos.y + 3, D.j.pos.z + f.z * 40, 3.2, 60 - t01(A.t - 4.6, 5.4) * 16);
    }
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
    A.data = { f18, mig, C: new THREE.Vector3(-3000, 1400, 4000), fired1: false, flared: false, fired2: false, killT: 0, splashed: false, m1: null, phi: 0.8 };
  },
  update(A, dt) {
    const D = A.data, t = A.t, G = A.G;
    const orbit = (j, phase, r, wob) => {
      const th = phase + t * 0.34;
      const x = D.C.x + Math.sin(th) * r, z = D.C.z + Math.cos(th) * r;
      const y = D.C.y + Math.sin(t * 1.3 + phase) * wob;
      // tangent heading: d/dt of (sin th, cos th) is (cos th, -sin th) * 0.34r
      const dx = Math.cos(th), dz = -Math.sin(th);
      A._place(j, x, y, z, headingOf(_v.set(dx, 0, dz)), Math.cos(t * 1.3 + phase) * 0.06, -0.95);
    };
    orbit(D.f18, 0, 430, 60);
    if (!D.mig.dead) orbit(D.mig, Math.PI, 460, 75);
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
    const D = A.data;
    // ride with the Hornet; when the bandit dies, watch his death spiral instead
    const subj = (D.mig.dead && !D.splashed) ? D.mig : D.f18;
    const f = subj.fwd(_w);
    const back = D.mig.dead ? 110 : 55, up = D.mig.dead ? 34 : 15;
    A._chase(dt, camPos, camera,
      subj.pos.x - f.x * back, subj.pos.y + up, subj.pos.z - f.z * back,
      subj.pos.x + f.x * 45, subj.pos.y - 4, subj.pos.z + f.z * 45, 2.6, 56 - t01(A.t, 12) * 14);
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
      if (!D.puff) { D.puff = true; A.G.fx.smoke(_v, 1.2, 1.6, 0xcccccc); }
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
    // the Golden Gate gap from the old demo route: through (0,42,0) heading +x
    const x = -2900 + 290 * t, z = 520 - 52 * t;
    if (t < 8.6) {
      A._place(j, x, 46, z, Math.PI / 2 + 0.03, 0, 0);
    } else {                                     // the pull: vertical over the towers
      if (!D.pulled) {
        D.pulled = true;
        A.G.fx.flash(j.pos.clone(), 12, 0xffffff, 0.14);
        for (let i = 0; i < 8; i++) A.G.fx.smoke(_v.copy(j.pos).addScaledVector(j.fwd(_w), 2 - i * 1.8), 0.55, 1.3, 0xf4f8ff);
      }
      const u = Math.min(1, (t - 8.6) / 1.4);
      const climb = 1.05 * u * u;
      A._place(j, j.pos.x + Math.cos(climb) * 290 * dt, j.pos.y + Math.sin(climb) * 290 * dt, j.pos.z - 6 * dt, Math.PI / 2 + 0.03, climb, 0);
    }
  },
  cam(A, dt, camPos, camera) {
    const j = A.data.j, t = A.t;
    const f = j.fwd(_w);
    if (t < 5) {
      // off the left wing, bridge ahead — the pilot's run
      A._chase(dt, camPos, camera,
        j.pos.x - f.x * 44 - f.z * 18, j.pos.y + 9, j.pos.z - f.z * 44 + f.x * 18,
        j.pos.x + f.x * 60, j.pos.y + 4, j.pos.z + f.z * 60, 3.4, 56 - t01(t, 5) * 12);
    } else if (t < 8.8) {
      // from a boat in the strait — the landmark's view: he swells out of
      // the west with the north tower behind him, then blasts past overhead
      A._chase(dt, camPos, camera, -560, 12, 330, j.pos.x, j.pos.y, j.pos.z, 5, 32 - t01(t - 5, 3.8) * 12);
    } else {
      // back on him for the pull over the towers
      A._chase(dt, camPos, camera,
        j.pos.x - f.x * 44 - f.z * 18, j.pos.y + 9, j.pos.z - f.z * 44 + f.x * 18,
        j.pos.x + f.x * 60, j.pos.y + 4, j.pos.z + f.z * 60, 3.4, 50 - t01(t - 8.8, 2.2) * 14);
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
    A.data = { j, buoys: [], dropped: 0, C: new THREE.Vector3(-42000, 130, -8000) };
  },
  update(A, dt) {
    const D = A.data, t = A.t;
    // straight low run down the datum line — due east, no crab
    A._place(D.j, D.C.x + 96 * t, D.C.y + Math.sin(t * 0.8) * 4, D.C.z, Math.PI / 2, 0, -0.04);
    for (const p of D.j.model.userData.props || []) p.rotation.z += dt * 50;
    // a stick of three buoys
    const want = t > 3 ? (t > 4.5 ? (t > 6 ? 3 : 2) : 1) : 0;
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
        A.G.fx.splash(b.m.position, 0.8);
      }
    }
  },
  teardown(A) { for (const b of (A.data.buoys || [])) A.G.scene.remove(b.m); },
  cam(A, dt, camPos, camera) {
    // high off the RIGHT beam, looking back-down — Orion up top, the buoy
    // stick strung out below as it falls toward the water
    const j = A.data.j, f = j.fwd(_w);
    A._chase(dt, camPos, camera,
      j.pos.x + 125, j.pos.y - 22, j.pos.z + 38,
      j.pos.x - 25, j.pos.y - 55, j.pos.z - 8, 2.8, 52 - t01(A.t, 9.5) * 14);
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
  name: 'airliner', dur: 11.5,
  setup(A) {
    A.G.world.setTimeOfDay('morning');
    const G = A.G, rw = G.world.runways.find(r => r.name === 'SFO INTL 01R');
    const f = { x: Math.sin(rw.hdg), z: -Math.cos(rw.hdg) };
    const thr = { x: rw.x - f.x * rw.len / 2, z: rw.z - f.z * rw.len / 2 };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const ai = G.spawnAI('b744', {
      pos: V(thr.x, rw.elev + 2, thr.z), heading: rw.hdg, speed: 70,
      name: 'BAY AIR 216', label: 'BAY AIR', livery: 0,
      mode: 'route', noEvade: true, surface: true,
      waypoints: [
        V(rw.x + f.x * (rw.len / 2 + 400), rw.elev + 8, rw.z + f.z * (rw.len / 2 + 400)),
        V(rw.x + f.x * 6000, 700, rw.z + f.z * 6000),
        V(16000, 1300, 4000),
      ],
    });
    ai.kind = 'airliner'; ai.identified = true; ai.targetSpeed = 80;
    A.data = { ai, rw, f, airborne: false };
  },
  update(A, dt) {
    // hand-flown: menu state never ticks traffic AI, so the reel drives the
    // roll, rotation and climb itself (gear stays down like the real jet)
    const D = A.data, t = A.t, f = D.f, rw = D.rw, ai = D.ai;
    const thr = D.thr || (D.thr = { x: rw.x - f.x * rw.len / 2, z: rw.z - f.z * rw.len / 2 });
    let d, y, pitch;
    if (t < 8) {                       // the roll: 70 -> 166 m/s
      d = 70 * t + 6 * t * t;
      y = rw.elev + 2; pitch = 0;
    } else {                           // rotate at ~950 m, climb away
      const u = Math.min(1, (t - 8) / 1.3), w = Math.max(0, t - 8.6);
      d = 944 + 166 * (t - 8) + 6.9 * (t - 8) * (t - 8);
      y = rw.elev + 2 + 8 * w * w;
      pitch = 0.24 * u * u;
    }
    A._place(ai, thr.x + f.x * d, y, thr.z + f.z * d, rw.hdg, pitch, 0);
    if (!D.vapor && t > 8.1) { D.vapor = true; A.G.fx.flash(ai.pos.clone(), 8, 0xffffff, 0.1); }
  },
  teardown(A) {
    const D = A.data, i = A.G.bandits.indexOf(D.ai);
    if (i >= 0) A.G.bandits.splice(i, 1);
    D.ai.dispose();
  },
  cam(A, dt, camPos, camera) {
    const D = A.data, ai = D.ai, f = D.f, rw = D.rw;
    // parked close beside the rotation point, looking back up the runway
    const cx = rw.x - f.x * rw.len * 0.15 + f.z * 120, cz = rw.z - f.z * rw.len * 0.15 - f.x * 120;
    A._chase(dt, camPos, camera, cx, 16, cz, ai.pos.x, ai.pos.y + 8, ai.pos.z, 3.2, 48 - t01(A.t, 11.5) * 14);
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
  update(A, dt) { /* she creeps on her own update */ },
  teardown(A) { A.G.world.enemySub.group.visible = false; },
  cam(A, dt, camPos, camera) {
    const s = A.data.sub, t = A.t;
    // full low circle round the boat — hull, sail and wake in one sweep
    const phi = 0.9 + t01(t, 9) * Math.PI * 2;
    A._chase(dt, camPos, camera,
      s.pos.x + Math.sin(phi) * 150, 13, s.pos.z + Math.cos(phi) * 150,
      s.pos.x + 30, 10, s.pos.z, 3, 52 - t01(t, 9) * 14);
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

const SCENES = [Catapult, Screwtops, Furball, Tracers, BattleGroup, Trap, Sonobuoy, MissileCam, Eagle, Airliner, Jink, Fleet, HeloShip, Harrier, Prowler, Hawg, BridgeRun];
