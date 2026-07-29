// attract.js — the homepage demo director. The old attract was one Hornet
// touring the bay at 210 knots; this is a five-scene cinematic reel that
// cuts between carrier ops, a dogfight and a bridge run — day, dusk and
// night — so the menu sells the world behind it.
import * as THREE from 'three';
import { AIAircraft } from './ai.js';
import { Missile } from './weapons.js';
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
  name: 'catapult', dur: 13,
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
      A._chase(dt, camPos, camera, _v.x, _v.y, _v.z, D.j.pos.x, D.j.pos.y + 1, D.j.pos.z, 4, 50);
    } else if (t < 4.6) {                        // run alongside the shot, trailing the burners
      deckD(c, 0, 0, 1, _w);
      A._chase(dt, camPos, camera,
        D.j.pos.x - _w.x * 26 + _w.z * 14, D.j.pos.y + 4.5, D.j.pos.z - _w.z * 26 - _w.x * 14,
        D.j.pos.x, D.j.pos.y + 1, D.j.pos.z, 4, 50);
    } else {                                     // chase the climb-out
      const f = D.j.fwd(_w);
      A._chase(dt, camPos, camera,
        D.j.pos.x - f.x * 46, D.j.pos.y + 10, D.j.pos.z - f.z * 46,
        D.j.pos.x + f.x * 40, D.j.pos.y + 3, D.j.pos.z + f.z * 40, 3.2, 58);
    }
  },
};

// ---------------- scene 2: the furball ----------------
const Furball = {
  name: 'furball', dur: 15.5,
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
    if (t > 9 && !D.fired2) { D.fired2 = true; A._fire(D.f18, D.mig, 'aim9'); A._ab(D.f18, true); }
    if (t > 10.4 && D.fired2 && !D.mig.dead) {   // backstop: the script says he dies
      D.mig.dead = true;
      G.explode(D.mig.pos.clone(), 1.6);
    }
    if (D.mig.dead && !D.splashed) {
      // dead jet: spiral down trailing smoke, into the bay
      D.killT += dt;
      const k = D.killT;
      D.mig.pos.y -= (60 + k * 40) * dt;
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
      subj.pos.x + f.x * 45, subj.pos.y - 4, subj.pos.z + f.z * 45, 2.6, 52);
  },
};

// ---------------- scene 3: dusk trap ----------------
const Trap = {
  name: 'trap', dur: 12.5,
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
    A._chase(dt, camPos, camera, _v.x, _v.y, _v.z, D.j.pos.x, D.j.pos.y + 2, D.j.pos.z, 3.4, 50);
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
    const offsets = [[0, 0, 0], [-70, 12, -110], [-150, 26, -230]];
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
    const D = A.data, c = A.G.world.carrier, lead = D.jets[0];
    deckP(c, 24, c.deckY + 9, 60, _v);           // up on the island, looking down the run
    A._chase(dt, camPos, camera, _v.x, _v.y, _v.z, lead.pos.x, lead.pos.y + 6, lead.pos.z, 4.2, 62);
  },
};

// ---------------- scene 5: night bridge run ----------------
const BridgeRun = {
  name: 'bridge', dur: 10.5,
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
    const j = A.data.j;
    const f = j.fwd(_w);           // off the left wing, bridge ahead
    A._chase(dt, camPos, camera,
      j.pos.x - f.x * 44 - f.z * 18, j.pos.y + 9, j.pos.z - f.z * 44 + f.x * 18,
      j.pos.x + f.x * 60, j.pos.y + 4, j.pos.z + f.z * 60, 3.4, 54);
  },
};

const SCENES = [Catapult, Furball, Trap, Fleet, BridgeRun];
