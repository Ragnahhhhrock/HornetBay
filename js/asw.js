// asw.js — the ambient sub hunt: the Shadow Sub prowls surfaced off the
// coast, the P-3 and the cruiser's Seahawk work it with sonobuoys and
// torpedoes, and USS Klakring reaches out with Harpoons. Free flight only —
// missions script their own drama.
import * as THREE from 'three';
import { clamp, damp, rand } from './util.js';
import { Missile } from './weapons.js';

const _v = new THREE.Vector3(), _d = new THREE.Vector3();
const horiz = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// where she prowls: the deep water west of the group's beat, close enough
// that the hunters can actually reach her on a group pass
const BOX = { x0: -52000, x1: -38000, z0: -2000, z1: 4000 };

let buoyGeo = null, buoyMat = null, torpGeo = null, torpMat = null;

export class AswOps {
  constructor(G) {
    this.G = G;
    if (!buoyGeo) {
      buoyGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.6, 6);
      buoyMat = new THREE.MeshBasicMaterial({ color: 0xff7722 });
      torpGeo = new THREE.CylinderGeometry(0.16, 0.16, 3.2, 6);
      torpGeo.rotateX(Math.PI / 2);
      torpMat = new THREE.MeshBasicMaterial({ color: 0xb8c0c8 });
    }
    this.buoys = [];        // {mesh, vel, live}
    this.torps = [];        // {mesh, vel, life}
    this.subHp = 600;
    this.surfaceId = 0;     // increments per surfacing — the frigate salvoes per id
    this.localized = false;
    this.up = false;        // sub on the surface
    this.cycleT = rand(30, 60);          // until she first shows
    this.diveT = 0;
    this.p3Engaged = false;
    this.p3BuoyCool = 0; this.p3TorpCool = 0;
    this.p3OrbitA = rand(0, 6);
    this._p3Called = false;
    // missile contract adapter so Klakring's Harpoons can track the sub
    this.subProxy = {
      pos: G.world.enemySub.pos, vel: new THREE.Vector3(),
      dead: false, removeMe: false, ejected: false,
      hit: (dmg) => this.damageSub(dmg),
    };
    // seahawk tasking state
    this.helo = null; this.heloDips = 0; this.heloCool = 20;
  }

  get sub() { return this.G.world.enemySub; }
  get freeFlight() { return !this.G.mission || this.G.mission.id === 'free'; }

  // ---- the sub herself: surface, creep, dive when hurt, show again elsewhere
  update(dt) {
    const G = this.G, sub = this.sub;
    if (!this.freeFlight) {
      if (this.up) this._goneDeep(true);
      this.p3Engaged = false;
      this._clearOrdnance();
      return;
    }
    if (!this.up) {
      this.cycleT -= dt;
      if (this.cycleT <= 0) this._surface();
      return;
    }
    // surfaced: a slow creep along the box, turning at the edges
    if (!sub.speed) sub.speed = 3.5;
    const p = sub.pos;
    if (p.x < BOX.x0 + 2000) sub.heading = Math.PI / 2;
    if (p.x > BOX.x1 - 2000) sub.heading = -Math.PI / 2;
    p.x += Math.sin(sub.heading) * sub.speed * dt;
    p.z += -Math.cos(sub.heading) * sub.speed * dt * 0.3;
    p.z = clamp(p.z, BOX.z0, BOX.z1);
    sub.group.rotation.y = Math.PI - sub.heading;
    // she doesn't loiter forever even unhurt
    this.diveT -= dt;
    if (this.diveT <= 0) { this._goneDeep(); return; }

    this._updateBuoys(dt);
    this._updateTorps(dt);
    this._driveP3(dt);
    this._driveHelo(dt);
  }

  _surface() {
    const sub = this.sub;
    sub.pos.set(rand(BOX.x0, BOX.x1), 0, rand(BOX.z0, BOX.z1));
    sub.heading = Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    sub.speed = 3.5;
    sub.submerged = false; sub.submergeT = 0;
    sub.pos.y = 0;
    sub.group.visible = true;
    this.up = true;
    this.surfaceId++;
    this.subHp = 600;
    this.localized = false;
    this.diveT = rand(300, 480);
    this._p3Called = false;
    this.G.msg('FLEET COM: POSSIBLE SUBMARINE CONTACT SURFACED WEST OF THE GROUP', 'info');
  }

  _goneDeep(silent = false) {
    const sub = this.sub;
    if (this.up && !sub.submerged) sub.submerge();
    this.up = false;
    this.localized = false;
    this.cycleT = rand(360, 660);
    this._clearOrdnance();
    this._releaseHelo();
    if (!silent) this.G.msg('P-3 ORION: CONTACT LOST — SHE\'S GONE DEEP', 'info');
  }

  damageSub(dmg) {
    if (!this.up) return;
    this.subHp -= dmg;
    const p = this.sub.pos;
    for (let i = 0; i < 8; i++) this.G.fx.splash(_v.set(p.x + (Math.random() - 0.5) * 40, 1, p.z + (Math.random() - 0.5) * 60), 1.2);
    if (this.subHp <= 150) {
      this.G.msg('P-3 ORION: GOOD HITS! SHE\'S DIVING!', 'good');
      this._goneDeep(true);
    }
  }

  // ---- sonobuoys: a splash, an orange can riding the swell, and a picture
  dropBuoy(pos, vel) {
    let b = this.buoys.find(q => !q.live);
    if (!b) {
      if (this.buoys.length >= 18) b = this.buoys[0];
      else { b = { mesh: new THREE.Mesh(buoyGeo, buoyMat), vel: new THREE.Vector3(), live: false }; this.G.scene.add(b.mesh); this.buoys.push(b); }
    }
    b.live = true;
    b.mesh.visible = true;
    b.mesh.position.copy(pos);
    b.vel.set(vel ? vel.x * 0.4 : 0, -12, vel ? vel.z * 0.4 : 0);
    this.G.msg(pos.y > 100 ? 'P-3 ORION: SONOBUOY AWAY' : 'NAVY 701: SONOBUOY AWAY', 'info');
  }

  _updateBuoys(dt) {
    for (const b of this.buoys) {
      if (!b.live) continue;
      const p = b.mesh.position;
      if (p.y > 0.4) {
        b.vel.y -= 18 * dt;
        p.addScaledVector(b.vel, dt);
        if (p.y <= 0.4) { p.y = 0.4; this.G.fx.splash(p, 0.5); b.vel.set(0, 0, 0); }
      } else {
        p.y = 0.4 + Math.sin(this.G.time * 1.3 + p.x) * 0.15;   // riding the swell
      }
    }
    // two wet buoys near the contact and the picture firms up
    if (!this.localized) {
      let near = 0;
      for (const b of this.buoys) if (b.live && b.mesh.position.y <= 0.5 && horiz(b.mesh.position, this.sub.pos) < 6000) near++;
      if (near >= 2) {
        this.localized = true;
        this.G.msg('P-3 ORION: SONOBUOYS HAVE CONTACT — LOCALIZED', 'good');
      }
    }
  }

  // ---- torpedoes: in the water, running hot toward the contact
  dropTorpedo(aircraft) {
    const t = { mesh: new THREE.Mesh(torpGeo, torpMat), vel: new THREE.Vector3(), life: 120, falling: true };
    t.mesh.position.copy(aircraft.pos);
    const f = aircraft.fwd ? aircraft.fwd(_d) : _d.set(Math.sin(aircraft.heading), 0, -Math.cos(aircraft.heading));
    t.vel.set(f.x * 30, -8, f.z * 30);
    this.G.scene.add(t.mesh);
    this.torps.push(t);
    this.G.msg(aircraft.kind === 'heli' ? 'NAVY 701: TORPEDO IN THE WATER' : 'P-3 ORION: TORPEDO IN THE WATER — RUNNING HOT', 'good');
  }

  _updateTorps(dt) {
    const sub = this.sub;
    for (const t of this.torps) {
      const p = t.mesh.position;
      t.life -= dt;
      if (t.falling) {
        t.vel.y -= 18 * dt;
        p.addScaledVector(t.vel, dt);
        if (p.y <= 0) { this.G.fx.splash(p, 0.7); t.falling = false; p.y = -3; t.vel.set(t.vel.x * 0.2, 0, t.vel.z * 0.2); }
        continue;
      }
      p.y = -3;
      // run toward the contact
      _d.set(sub.pos.x - p.x, 0, sub.pos.z - p.z);
      const dist = _d.length(); _d.normalize();
      const sp = Math.min(34, t.vel.length() + 14 * dt);
      const cur = _v.copy(t.vel).setY(0).normalize();
      cur.lerp(_d, clamp(1.2 * dt, 0, 1)).normalize();
      t.vel.copy(cur).multiplyScalar(sp);
      p.x += t.vel.x * dt; p.z += t.vel.z * dt;
      t.mesh.quaternion.setFromUnitVectors(_v.set(0, 0, 1), cur);
      if (dist < 30) {
        this.G.fx.splash(p, 1.6);
        this.G.fx.explosion(_v.set(p.x, 2, p.z), 0.7);
        this.damageSub(150);
        t.life = 0;
      }
      if (t.life <= 0 || !this.up) { this.G.scene.remove(t.mesh); t.dead = true; }
    }
    this.torps = this.torps.filter(t => !t.dead);
  }

  // ---- the P-3 diverts to the contact and works it
  _driveP3(dt) {
    const G = this.G, p3 = G.p3, sub = this.sub;
    this.p3Engaged = false;
    if (!p3 || p3.ai.dead || p3.ai.removeMe) return;
    const ai = p3.ai, d = horiz(ai.pos, sub.pos);
    if (d > 32000) return;
    this.p3Engaged = true;
    if (!this._p3Called) {
      this._p3Called = true;
      G.msg('P-3 ORION: INVESTIGATING SUBMARINE CONTACT', 'info');
    }
    // a 2.5 km wheel over the contact at 500 ft
    this.p3OrbitA += dt * 0.038;
    _d.set(sub.pos.x + Math.cos(this.p3OrbitA) * 2500 - ai.pos.x, 0,
           sub.pos.z + Math.sin(this.p3OrbitA) * 2500 - ai.pos.z).normalize();
    ai._steerToward(_d, dt, 0.55);
    ai.targetSpeed = 92;
    ai.pos.y = damp(ai.pos.y, 152, 0.6, dt);
    this.p3BuoyCool -= dt;
    if (this.p3BuoyCool <= 0 && d < 6000) { this.p3BuoyCool = 14; this.dropBuoy(ai.pos, ai.vel); }
    this.p3TorpCool -= dt;
    if (this.localized && this.p3TorpCool <= 0 && d < 6000) { this.p3TorpCool = 40; this.dropTorpedo(ai); }
  }

  // ---- the cruiser's Seahawk flies out, dips, and puts a torp in
  _driveHelo(dt) {
    const G = this.G, sub = this.sub;
    this.heloCool -= dt;
    const h = G.heliOps && G.heliOps.seahawk;
    if (!h || !G.world.ships.escorts.length) return;
    const cruiser = G.world.ships.escorts[0];
    if (!this.helo) {
      // task her when the contact is in reach and she's on a routine leg
      if (this.heloCool <= 0 && (h.task === 'circuit') && h.mode === 'transit'
          && horiz(cruiser.pos, sub.pos) < 34000) {
        this.helo = h; this.heloDips = 0;
        h.task = 'asw'; h.mode = 'dip'; h.dipPhase = undefined;
        h.target = { x: sub.pos.x + rand(-600, 600), z: sub.pos.z + rand(-600, 600), y: 0 };
        G.msg('NAVY 701: PROCEEDING TO SUBMARINE CONTACT FOR DIPPING SONAR', 'info');
      }
      return;
    }
    // she's ours: chain dips until the picture firms up, then a torpedo
    if (h.mode === 'transit' && h.task === 'asw') {
      this.heloDips++;
      if (this.localized && this.heloDips >= 1 && !h._torpDropped) {
        h._torpDropped = true;
        this.dropTorpedo(h);
      }
      if (this.heloDips >= 2) this._releaseHelo();
      else {
        h.task = 'asw'; h.mode = 'dip'; h.dipPhase = undefined;
        h.target = { x: sub.pos.x + rand(-600, 600), z: sub.pos.z + rand(-600, 600), y: 0 };
      }
    }
    if (h.dead) this._releaseHelo();
  }

  _releaseHelo() {
    const h = this.helo;
    if (h && this.G.heliOps && !h.dead) {
      h._torpDropped = false;
      h.task = 'circuit';
      this.G.heliOps._circuit(h);   // fresh plane-guard pattern…
      h.mode = 'transit';           // …but she's already airborne at cruise —
                                    // skip the spool/liftoff (which would drag
                                    // her at the anchor from mid-ocean)
      h.wi = 0; h.progress = 0; h.vy = 0;
    }
    this.helo = null;
    this.heloCool = 90;
  }

  heloDip(h) {
    this.dropBuoy(h.pos, null);
  }

  _clearOrdnance() {
    for (const b of this.buoys) { b.live = false; b.mesh.visible = false; }
    for (const t of this.torps) this.G.scene.remove(t.mesh);
    this.torps = [];
  }

  dispose() {
    this._clearOrdnance();
    for (const b of this.buoys) this.G.scene.remove(b.mesh);
    this._releaseHelo();
  }
}

// ---------------- the frigate fights back ----------------
// USS Klakring FFG-42: SM-1s at hostile aircraft inside 22 km, Harpoons at
// surface contacts inside 30 km (free flight's prowler only — mission subs
// belong to the mission script)
export class EscortWeapons {
  constructor(G) {
    this.G = G;
    this.aaCool = 8; this.asCool = 15;
    this._ffg = null;
    this._salvoId = -1; this._salvoLeft = 0;
  }
  _ship() {
    if (!this._ffg) this._ffg = this.G.world.ships.escorts.find(e => /FFG/.test(e.name || '')) || null;
    return this._ffg;
  }
  update(dt) {
    const G = this.G, ffg = this._ship();
    if (!ffg || G.state !== 'flying') return;
    // anti-air: the area-defence umbrella over the group
    this.aaCool -= dt;
    if (this.aaCool <= 0) {
      let best = null, bd = 1e9;
      for (const b of G.bandits) {
        if (!b.hostile || b.dead || b.ejected || b.removeMe) continue;
        if (b.noAA || b.type === 'sub' || b.pos.y < 40) continue;
        const d = b.pos.distanceTo(ffg.pos);
        if (d < 22000 && d < bd) { bd = d; best = b; }
      }
      if (best) { this._launch(ffg, 'sm1', best, 0.55); this.aaCool = 9; }
      else this.aaCool = 2;
    }
    // anti-ship: a two-round Harpoon salvo per surfacing, then weapons hold —
    // you don't fire into an active dipping zone with friendlies in the SAC
    this.asCool -= dt;
    if (this.asCool <= 0) {
      const asw = G.asw;
      if (asw && asw.freeFlight && asw.up && this._salvoId !== asw.surfaceId
          && asw.sub.pos.distanceTo(ffg.pos) < 30000) {
        this._salvoId = asw.surfaceId;
        this._salvoLeft = 2;
      }
      if (this._salvoLeft > 0 && asw.up) {
        this._salvoLeft--;
        this._launch(ffg, 'harpoon', asw.subProxy, 0.30);
        if (this._salvoLeft === 0) G.msg('KLAKRING: WEAPONS HOLD — FRIENDLIES IN THE SAC', 'info');
        this.asCool = this._salvoLeft > 0 ? 6 : 20;
      } else this.asCool = 4;
    }
  }
  _launch(ship, type, target, climb) {
    const G = this.G;
    const f = ship.fwd(new THREE.Vector3());
    const org = {
      pos: ship.pos.clone().addScaledVector(f, ship.len * 0.28).setY(9),
      fwd: (o) => o.copy(f).setY(climb).normalize(),
      speed: ship.speed,
    };
    G.missiles.push(new Missile(G, org, type, target));
    for (let i = 0; i < 10; i++) G.fx.smoke(org.pos, 1.5, 2.5, 0xcccccc);
    G.fx.flash(org.pos, 8);
    G.audio.missileFire();                  // the whoosh sells a shipboard launch too
    G.msg(`KLAKRING: ${type === 'sm1' ? 'SM-1 AWAY' : 'HARPOON AWAY'}`, 'info');
  }
}
