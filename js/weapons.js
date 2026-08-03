// weapons.js — missiles, gun, countermeasures, explosions, particle FX
import * as THREE from 'three';
import { clamp, lerp, rand, randSpread } from './util.js';
import { makeGlowTexture, makeSmokeTexture } from './models.js';
import { groundHeight } from './world.js';
import { stats } from './stats.js';

const _v = new THREE.Vector3(), _d = new THREE.Vector3();

// ---------------- sprite particle pool ----------------
export class FXPool {
  constructor(scene) {
    this.scene = scene;
    this.glowTex = makeGlowTexture();
    this.smokeTex = makeSmokeTexture();
    this.parts = [];
    this.pool = [];
    for (let i = 0; i < 400; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false }));
      s.visible = false; scene.add(s);
      this.pool.push({ s, life: 0, maxLife: 1, vel: new THREE.Vector3(), grow: 1, fade: 1, size0: 1, col: new THREE.Color() });
    }
  }
  spawn(pos, vel, life, size, color, additive, grow = 1, tex = null) {
    const p = this.pool.find(q => q.life <= 0);
    if (!p) return;
    p.life = p.maxLife = life; p.vel.copy(vel); p.grow = grow; p.size0 = size;
    p.s.material.map = tex || this.smokeTex;
    p.s.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.s.material.color.set(color);
    p.s.material.opacity = additive ? 0.9 : 0.55;
    p.s.position.copy(pos);
    p.s.scale.set(size, size, 1);
    p.s.visible = true;
  }
  smoke(pos, life = 1.2, size = 2, color = 0x555555, vel = null) {
    this.spawn(pos, vel || _v.set(randSpread(2), rand(1, 3), randSpread(2)), life, size, color, false, 2.4);
  }
  fire(pos, life = 0.5, size = 3) {
    this.spawn(pos, _v.set(randSpread(4), rand(0, 3), randSpread(4)), life, size, 0xff8830, true, 0.6, this.glowTex);
  }
  flash(pos, size = 10, color = 0xfff0b0, life = 0.18) {
    this.spawn(pos, _v.set(0, 0, 0), life, size, color, true, 1.8, this.glowTex);
  }
  trail(pos, size = 1.6, color = 0xdddddd, life = 1.6) {
    this.spawn(pos, _v.set(0, 0.4, 0), life, size, color, false, 1.4);
  }
  // long-lived faint white puff for wingtip contrails
  contrail(pos) {
    this.spawn(pos, _v.set(0, 0.2, 0), 3.2, 1.5, 0xf0f0f0, false, 1.7);
  }
  // a catapult stroke vents steam the length of the track — bright white,
  // slow to rise, slow to fade
  steamLine(a, b, n = 22) {
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      _v.lerpVectors(a, b, t);
      _v.x += randSpread(1.4); _v.z += randSpread(1.4);
      this.spawn(_v, _d.set(randSpread(1.6), rand(1.5, 4), randSpread(1.6)), rand(4, 8), rand(2.5, 5), 0xf4f6f6, false, 2.8);
    }
  }
  explosion(pos, scale = 1) {
    this.flash(pos, 26 * scale, 0xfff4c0, 0.22);
    this.flash(pos, 60 * scale, 0xff9840, 0.35);
    for (let i = 0; i < 14; i++) {
      _d.set(randSpread(30), randSpread(30), randSpread(30));
      this.fire(_v.copy(pos).addScaledVector(_d, 0.15), rand(0.4, 0.9), rand(3, 7) * scale);
      this.spawn(_v, _d.clone().multiplyScalar(0.7), rand(0.5, 1.1), rand(2, 4) * scale, 0xffc060, true, 0.4, this.glowTex);
    }
    for (let i = 0; i < 16; i++) {
      _d.set(randSpread(18), rand(2, 16), randSpread(18));
      this.smoke(_v.copy(pos).addScaledVector(_d, 0.2), rand(1.5, 3.5), rand(4, 9) * scale, 0x2c2c2c, _d.clone().multiplyScalar(0.5));
    }
  }
  splash(pos, scale = 1) {
    for (let i = 0; i < 12; i++) {
      _d.set(randSpread(10), rand(8, 22), randSpread(10));
      this.spawn(pos, _d.clone(), rand(0.6, 1.2), rand(2, 5) * scale, 0xcfe8ff, false, 1.2, this.glowTex);
    }
    this.smoke(pos, 2, 8 * scale, 0xffffff);
  }
  // shattering wreckage: solid chunks that inherit the wreck's speed, tumble
  // through the air trailing smoke, bounce off the terrain once or twice and
  // come to rest before burning out
  shatter(pos, vel, scale = 1) {
    if (!this._debris) this._debris = [];
    if (!this._debrisGeo) this._debrisGeo = new THREE.BoxGeometry(1, 1, 1);
    if (!this._debrisMat) {
      this._debrisMat = [0x8a929c, 0x596069, 0x3c4248, 0x2e3238].map(c => new THREE.MeshLambertMaterial({ color: c }));
      this._debrisFireMat = new THREE.MeshBasicMaterial({ color: 0xff8830 });
    }
    for (let i = 0; i < 16; i++) {
      const burning = i % 4 === 0;
      const m = new THREE.Mesh(this._debrisGeo, burning ? this._debrisFireMat : this._debrisMat[i % this._debrisMat.length]);
      const s = rand(0.5, 2.2) * scale;
      m.scale.set(s * rand(0.5, 1.6), s * rand(0.4, 1.0), s * rand(0.6, 1.8));
      m.position.set(pos.x + randSpread(3), pos.y + randSpread(2), pos.z + randSpread(3));
      this.scene.add(m);
      this._debris.push({
        m,
        vel: vel.clone().multiplyScalar(rand(0.5, 0.95)).add(new THREE.Vector3(randSpread(20), rand(4, 24), randSpread(20))),
        av: new THREE.Vector3(randSpread(7), randSpread(7), randSpread(7)),
        life: rand(3.5, 6), rest: false, burning, smokeT: 0,
      });
    }
  }
  clearDebris() {
    if (!this._debris) return;
    for (const d of this._debris) this.scene.remove(d.m);
    this._debris.length = 0;
  }
  _updateDebris(dt) {
    if (!this._debris) return;
    for (let i = this._debris.length - 1; i >= 0; i--) {
      const d = this._debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.smoke(d.m.position, 1.2, 3, 0x3a3a3a);
        this.scene.remove(d.m);
        this._debris.splice(i, 1);
        continue;
      }
      if (!d.rest) {
        d.vel.y -= 9.81 * 0.9 * dt;
        d.m.position.addScaledVector(d.vel, dt);
        d.m.rotation.x += d.av.x * dt; d.m.rotation.y += d.av.y * dt; d.m.rotation.z += d.av.z * dt;
        const gh = Math.max(groundHeight(d.m.position.x, d.m.position.z), 0);
        if (d.m.position.y < gh + 0.4) {
          d.m.position.y = gh + 0.4;
          if (gh === 0) this.splash(d.m.position, 0.5); else this.smoke(d.m.position, 0.9, 3, 0x4a4640);
          d.vel.y = Math.abs(d.vel.y) * 0.3;
          d.vel.x *= 0.5; d.vel.z *= 0.5; d.av.multiplyScalar(0.5);
          if (d.vel.length() < 4) { d.rest = true; d.vel.set(0, 0, 0); d.av.set(0, 0, 0); }
        }
        d.smokeT -= dt;
        if (d.burning && d.smokeT <= 0) {
          d.smokeT = 0.09;
          this.smoke(d.m.position, rand(0.8, 1.4), rand(2, 3.5), 0x303030);
          if (Math.random() < 0.4) this.fire(d.m.position, 0.3, 2.5);
        }
      }
    }
  }
  update(dt) {
    this._updateDebris(dt);
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      p.s.position.addScaledVector(p.vel, dt);
      const t = 1 - p.life / p.maxLife;
      const sz = p.size0 * (1 + t * (p.grow - 1));
      p.s.scale.set(sz, sz, 1);
      p.s.material.opacity = (p.s.material.blending === THREE.AdditiveBlending ? 0.9 : 0.55) * (1 - t * t);
    }
  }
}

// ---------------- missiles ----------------
const MISSILE_TYPES = {
  aim120: { vmax: 1050, accel: 260, turn: 1.9, life: 40, prox: 30, dmg: 110, ir: false },
  aim9:   { vmax: 850,  accel: 320, turn: 3.2, life: 22, prox: 26, dmg: 110, ir: true  },
  // AIM-54 Phoenix: the big radar-guided stick — three AIM-120s of legs,
  // a truck of a warhead, but it wants a radar lock from much further out
  aim54:  { vmax: 1300, accel: 250, turn: 1.7, life: 90, prox: 40, dmg: 160, ir: false, len: 4.0, dia: 0.38 },
  // AIM-7M/P Sparrow (the 1994 fleet round): Mach 4 boost-sustain, ~45 km reach,
  // a 40 kg continuous-rod warhead — SEMI-ACTIVE: it only guides while the
  // launch radar holds the lock. Break the lock and it goes ballistic.
  aim7:   { vmax: 1050, accel: 300, turn: 1.6, life: 50, prox: 30, dmg: 130, ir: false, sarh: true, len: 3.7, dia: 0.20 },
  // 9K38 Igla MANPADS: shoulder-fired from the freighter decks and the escort
  // boats. Short-legged IR — deadly under 4 km and below 1,300 m, useless
  // above it. Flares beat it; so does altitude.
  igla:   { vmax: 570, accel: 300, turn: 2.7, life: 15, prox: 20, dmg: 55, ir: true, len: 1.7, dia: 0.07 },
  r27:    { vmax: 950,  accel: 240, turn: 1.6, life: 35, prox: 30, dmg: 70,  ir: false },
  r73:    { vmax: 800,  accel: 300, turn: 3.0, life: 18, prox: 26, dmg: 60,  ir: true  },
  // shipboard rounds: Klakring's SM-1 area-defence SAM and the sea-skimming Harpoon
  sm1:     { vmax: 950,  accel: 320, turn: 3.4, life: 40, prox: 30, dmg: 130, ir: false },
  harpoon: { vmax: 320,  accel: 70,  turn: 1.1, life: 150, prox: 45, dmg: 120, ir: false, len: 4.6, dia: 0.34 },
};
let missileGeo = null, missileMat = null;

export class Missile {
  constructor(G, owner, type, target) {
    const cfg = MISSILE_TYPES[type];
    this.G = G; this.cfg = cfg; this.type = type;
    this.owner = owner; this.target = target;
    if (!missileGeo) {
      missileGeo = new THREE.CylinderGeometry(0.16, 0.16, 3.4, 6);
      missileGeo.rotateX(Math.PI / 2);
      missileMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
    }
    this.mesh = new THREE.Mesh(missileGeo, missileMat);
    if (cfg.len) this.mesh.scale.set(cfg.dia / 0.32, cfg.dia / 0.32, cfg.len / 3.4);   // Phoenix is a fat, long round
    this.pos = this.mesh.position;
    this.pos.copy(owner.pos);
    // Player exposes fwd as a getter, AIAircraft as a method — handle both
    const f = (typeof owner.fwd === 'function') ? owner.fwd(new THREE.Vector3())
      : owner.fwd ? owner.fwd.clone()
        : _d.set(0, 0, 1).applyQuaternion(owner.quat);
    this.vel = f.clone().multiplyScalar((owner.speed || owner.vel.length()) + 60);
    this.vel.y += 8;
    this.dir = f.clone();
    this.life = cfg.life; this.dead = false; this.spoofed = false;
    this.smokeT = 0;
    G.scene.add(this.mesh);
    // orient
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.dir);
  }
  // spectate adapter: the J/O camera rides anything with pos/fwd/speed/len
  fwd(out) { return out.copy(this.vel).normalize(); }
  get speed() { return this.vel.length(); }
  get len() { return this.cfg.len || 3.4; }
  get name() { return ({ aim9: 'AIM-9', aim120: 'AIM-120', aim54: 'AIM-54', aim7: 'AIM-7', r27: 'R-27', r73: 'R-73', sm1: 'SM-1', harpoon: 'HARPOON', igla: 'IGLA' })[this.type] || this.type.toUpperCase(); }
  get removeMe() { return false; }
  update(dt) {
    const G = this.G, cfg = this.cfg;
    this.life -= dt;
    if (this.life <= 0) { this._die(); return; }
    const t = this.target;
    const tAlive = t && !t.dead && !t.ejected && !(t.removeMe);
    // countermeasure spoof check (continuous proximity-based)
    if (tAlive && !this.spoofed) {
      const dist = this.pos.distanceTo(t.pos);
      if (dist < 1500) {
        const now = G.time;
        if (cfg.ir && now - (t.flareT ?? -99) < 2.2 && Math.random() < 0.75) this._spoof();
        else if (!cfg.ir && now - (t.chaffT ?? -99) < 2.5 && Math.random() < 0.7) this._spoof();
        // hard break at close range can defeat it
        else if (dist < 900 && t.gForce && t.gForce > 7.5 && Math.random() < 0.012) this._spoof();
      }
    }
    // semi-active (Sparrow): the round only guides while the shooter's radar
    // holds the target locked. Half a second of lock flicker is forgiven;
    // longer and the round goes ballistic for good.
    if (cfg.sarh && this.owner === G.player && tAlive && !this.spoofed) {
      if (G.locked && G.playerTarget === t) this._noIll = 0;
      else {
        this._noIll = (this._noIll || 0) + dt;
        if (this._noIll > 0.5) { this.spoofed = true; G.msg('SPARROW LOST — RADAR LOCK BROKEN', 'warn'); }
      }
    }
    if (tAlive && !this.spoofed) {
      // proportional-nav-lite
      const lead = clamp(this.pos.distanceTo(t.pos) / cfg.vmax, 0, 2.2);
      _d.copy(t.pos).addScaledVector(t.vel, lead).sub(this.pos).normalize();
      const ang = this.dir.angleTo(_d);
      const maxT = cfg.turn * dt;
      if (ang > 1e-4) this.dir.lerp(_d, Math.min(1, maxT / ang)).normalize();
    }
    // speed
    const sp = Math.min(cfg.vmax, this.vel.length() + cfg.accel * dt);
    this.vel.copy(this.dir).multiplyScalar(sp);
    // gravity dip after burnout (last 25% life)
    if (this.life < cfg.life * 0.25) this.vel.y -= 4 * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.mesh.quaternion.setFromUnitVectors(_v.set(0, 0, 1), this.dir);
    // smoke trail
    this.smokeT -= dt;
    if (this.smokeT <= 0) { this.smokeT = 0.03; G.fx.trail(this.pos, 1.5, 0xeeeeee, 2.2); }
    // proximity kill
    if (tAlive && !this.spoofed) {
      const dist = this.pos.distanceTo(t.pos);
      if (dist < cfg.prox) {
        G.explode(this.pos, 0.8);
        if (t.isPlayer) G.onPlayerHit(cfg.dmg, this.owner);
        else {
          t.hit(cfg.dmg, G, this.owner === G.player);
          if (this.owner === G.player) stats.missileHit(this.type);
        }
        this._die();
        return;
      }
    }
    // unguided shot (fired with no lock) — still lethal to anything in its path
    if (!t && !this.spoofed) {
      for (const b of G.bandits) {
        if (b.dead || b.removeMe || b === this.owner) continue;
        if (this.pos.distanceTo(b.pos) < cfg.prox) {
          G.explode(this.pos, 0.8);
          b.hit(cfg.dmg, G, this.owner === G.player);
          if (this.owner === G.player) stats.missileHit(this.type);
          this._die();
          return;
        }
      }
    }
    // hit terrain?
    if (this.pos.y < 1) { G.fx.splash(this.pos, 0.7); this._die(); return; }
  }
  _spoof() {
    this.spoofed = true;
    if (this.target === this.G.player) this.G.msg('MISSILE DEFEATED', 'good');
  }
  _die() { this.dead = true; this.G.scene.remove(this.mesh); }
}

// ---------------- the M61 Vulcan ----------------
export class GunSystem {
  constructor(G) {
    this.G = G;
    this.cooldown = 0;
    this.tracers = [];
    if (!GunSystem.geo) {
      GunSystem.geo = new THREE.CylinderGeometry(0.34, 0.34, 30, 6);
      GunSystem.geo.rotateX(Math.PI / 2);
      GunSystem.mat = new THREE.MeshBasicMaterial({ color: 0xffe6a8, blending: THREE.AdditiveBlending, transparent: true, opacity: 1.0, depthWrite: false, fog: false });
      // soft additive glow riding each bolt so distant tracers still read
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const cx = cv.getContext('2d');
      const gr = cx.createRadialGradient(32, 32, 2, 32, 32, 30);
      gr.addColorStop(0, 'rgba(255,242,205,1)');
      gr.addColorStop(0.35, 'rgba(255,205,115,0.55)');
      gr.addColorStop(1, 'rgba(255,160,60,0)');
      cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
      GunSystem.glowMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    }
  }
  fire(dt, player, targets) {
    const G = this.G;
    this.cooldown -= dt;
    const ROF = 28; // rounds per second (arcade)
    while (this.cooldown <= 0 && player.stores.gun > 0) {
      this.cooldown += 1 / ROF;
      player.stores.gun--;
      if (player.isPlayer) stats.cannonRound();
      G.audio.gun();
      // tracer visual
      const tr = new THREE.Mesh(GunSystem.geo, GunSystem.mat);
      const f = player.fwd.clone();
      tr.position.copy(player.pos).addScaledVector(f, 12);
      tr.position.y -= 1;
      tr.quaternion.setFromUnitVectors(_v.set(0, 0, 1), f);
      const glow = new THREE.Sprite(GunSystem.glowMat);
      glow.scale.setScalar(7);
      tr.add(glow);
      G.scene.add(tr);
      this.tracers.push({ mesh: tr, vel: f.multiplyScalar(1050).add(player.vel), life: 1.4 });
      // hit check: ray vs targets (cylinder around flight path)
      for (const t of targets) {
        if (t.dead) continue;
        _d.copy(t.pos).sub(player.pos);
        const dist = _d.length();
        if (dist > 1600 || dist < 30) continue;
        const along = _d.dot(f);
        if (along < 0) continue;
        const perp2 = _d.lengthSq() - along * along;
        const hitR = 9 + dist * 0.012;
        if (perp2 < hitR * hitR && Math.random() < 0.5) {
          t.hit(6, G, true);
          G.fx.flash(t.pos, 6, 0xffe0a0, 0.1);
          G.audio.gunHit();
          G.gunHits++;
          stats.gunHit();
        }
      }
      if (player.stores.gun <= 0) { G.msg('GUN EMPTY', 'warn'); break; }
    }
  }
  update(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.mesh.position.addScaledVector(t.vel, dt);
      if (t.life <= 0) { this.G.scene.remove(t.mesh); this.tracers.splice(i, 1); }
    }
  }
}

// ---------------- Mk 83 1,000 lb dumb bomb ----------------
// No motor, no seeker, no mercy: release velocity plus gravity, nothing else.
// The CCIP pipper in hud.js integrates this exact model, so where the pipper
// sits is where the bomb lands. Blast is honest — mind your own frag.
export const BOMB_TYPES = {
  mk83: { g: 9.81, blast: 60, dmg: 430, label: 'MK 83' },
};
let _bombGeo = null, _bombMat = null, _bombFinMat = null;
export class Bomb {
  constructor(G, owner, type = 'mk83') {
    this.G = G; this.cfg = BOMB_TYPES[type]; this.type = type; this.owner = owner;
    this.target = null;                     // rides in G.missiles without being a missile
    this.dead = false; this.spoofed = true; // unguided by definition — never homes
    if (!_bombGeo) {
      _bombGeo = new THREE.CylinderGeometry(0.19, 0.15, 2.6, 8); _bombGeo.rotateX(Math.PI / 2);
      _bombMat = new THREE.MeshLambertMaterial({ color: 0x4a5238, flatShading: true });
      _bombFinMat = new THREE.MeshLambertMaterial({ color: 0x3a422c, flatShading: true });
    }
    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(_bombGeo, _bombMat); this.mesh.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.5, 8), _bombMat);
    nose.geometry.rotateX(Math.PI / 2); nose.position.z = 1.5; this.mesh.add(nose);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.55), _bombFinMat);
      fin.position.z = -1.25; fin.rotation.z = i * Math.PI / 2 + Math.PI / 4; this.mesh.add(fin);
    }
    this.pos = this.mesh.position;
    this.pos.copy(owner.pos); this.pos.y -= 2.2;   // off the rack, below the jet
    this.vel = owner.vel.clone();
    G.scene.add(this.mesh);
  }
  // spectate adapter — O will ride the bomb all the way down
  fwd(out) { return out.copy(this.vel).normalize(); }
  get speed() { return this.vel.length(); }
  get len() { return 3.0; }
  get name() { return this.cfg.label; }
  get removeMe() { return false; }
  update(dt) {
    const G = this.G;
    // substeps keep fast, steep deliveries honest
    const n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.vel.y -= this.cfg.g * h;
      this.pos.addScaledVector(this.vel, h);
      // direct contact with a surface target detonates on the hull
      for (const b of G.bandits) {
        if (b.dead || b.removeMe || !b.surface) continue;
        const rr = (b.blastR || 8) + 3;
        if (Math.abs(this.pos.x - b.pos.x) < rr && Math.abs(this.pos.z - b.pos.z) < rr &&
            this.pos.y < b.pos.y + 14) { this._burst(); return; }
      }
      const gh = groundHeight(this.pos.x, this.pos.z);
      const floor = Math.max(gh, 0.4);
      if (this.pos.y <= floor) {
        this.pos.y = floor;
        if (gh < 0.5) G.fx.splash(this.pos, 2.6);   // water
        this._burst();
        return;
      }
    }
    this.mesh.quaternion.setFromUnitVectors(_v.set(0, 0, 1), _d.copy(this.vel).normalize());
  }
  _burst() {
    const G = this.G, R = this.cfg.blast;
    G.explode(this.pos.clone(), 1.7);
    for (let i = 0; i < 6; i++) G.fx.smoke(this.pos.clone().add(_v.set((Math.random() - 0.5) * 14, Math.random() * 6, (Math.random() - 0.5) * 14)), 3.5, 7, 0x2c2620);
    for (const b of G.bandits) {
      if (b.dead || b.removeMe) continue;
      const eff = R + (b.blastR || 0);
      const d = Math.hypot(this.pos.x - b.pos.x, this.pos.z - b.pos.z);
      if (d > eff) continue;
      const f = d < eff * 0.45 ? 1 : 1 - 0.85 * (d - eff * 0.45) / (eff * 0.55);
      b.hit(Math.round(this.cfg.dmg * f), G, this.owner === G.player);
    }
    // your own frag is always in the pattern — low releases are for the bold
    const pd = this.pos.distanceTo(G.player.pos);
    if (pd < R * 1.1) G.onPlayerHit(Math.round(this.cfg.dmg * 0.4 * (1 - pd / (R * 1.1))), this.owner);
    this._die();
  }
  _die() { this.dead = true; this.G.scene.remove(this.mesh); }
}
