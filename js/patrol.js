// patrol.js — P-3 Orion on the sub-hunt: an oval station west of the carrier
// group at 500 feet, breaking off now and then for a visual pass on shipping
import * as THREE from 'three';
import { clamp, damp, rand, KTS } from './util.js';
import { AIAircraft } from './ai.js';

const _d = new THREE.Vector3();

export class P3Patrol {
  constructor(G) {
    this.G = G;
    const c = G.world.carrier.pos;
    this.ai = new AIAircraft(G.scene, G.world, 'p3', {
      pos: new THREE.Vector3(c.x - 14000, 152, c.z - 5000),
      heading: Math.PI / 2, speed: 96,
      name: 'P-3 ORION', label: 'P-3 ORION', hp: 300,
      mode: 'route', noEvade: true,
    });
    this.ai.kind = 'patrol';
    this.ai.identified = true;
    this.ai.targetSpeed = 96;
    this.mode = 'hunt';
    this.leg = 0;
    this.inspectT = rand(55, 95);
    this.inspectShip = null;
    this._msgT = -99;
    G.bandits.push(this.ai);   // on the scope, not lockable (kind 'patrol')
  }

  // the oval tracks the group: 11 km long x 5 km wide, 12 km west of the carrier
  _ovalPoint(t, out) {
    const c = this.G.world.carrier.pos;
    const cx = c.x - 12000, cz = c.z - 4000;
    const a = t * Math.PI * 2;
    return out.set(cx + Math.cos(a) * 5500, 152, cz + Math.sin(a) * 2500);
  }

  update(dt) {
    const G = this.G, ai = this.ai;
    if (ai.dead || ai.removeMe) return;
    // spin the props
    for (const p of ai.model.userData.props || []) p.rotation.z += dt * 55;
    // ASW owns the stick while she works a submarine contact
    if (G.asw && G.asw.p3Engaged) return;
    if (this.mode === 'hunt') {
      // steer to the next point on the oval
      this.legT = (this.legT ?? 0) + dt * 0.0045;   // ~3.7 min per lap
      const t0 = this.legT % 1;
      this._ovalPoint(t0, _d);
      const dir = _d.sub(ai.pos).normalize();
      ai._steerToward(dir, dt, 0.55);
      ai.targetSpeed = 96;
      // hold 500 ft
      ai.pitch = clamp(ai.pitch, -0.1, 0.1);
      ai.pos.y = damp(ai.pos.y, 152, 0.6, dt);
      this.inspectT -= dt;
      if (this.inspectT <= 0) {
        this.inspectT = rand(75, 140);
        const ship = this._pickShip();
        if (ship) {
          this.mode = 'inspect';
          this.inspectShip = ship;
          if (G.time - this._msgT > 30) {
            this._msgT = G.time;
            G.chatter(`P-3 ORION: VISUAL INSPECTION PASS ON ${ship.name || 'CONTACT'}`, 'info');
          }
        }
      }
    } else if (this.mode === 'inspect') {
      const s = this.inspectShip;
      if (!s || s.removeMe) { this.mode = 'hunt'; return; }
      // pass 400 m abeam at 300 ft, offset to the port side of the ship's course
      const f = s.fwd ? s.fwd(_d) : _d.set(0, 0, 1);
      const px = s.pos.x - f.z * 400, pz = s.pos.z + f.x * 400;
      _d.set(px - ai.pos.x, 0, pz - ai.pos.z);
      const dist = _d.length();
      _d.normalize(); _d.y = clamp((92 - ai.pos.y) * 0.004, -0.12, 0.12); _d.normalize();
      ai._steerToward(_d, dt, 0.7);
      ai.targetSpeed = 88;
      ai.pos.y = damp(ai.pos.y, 92, 0.5, dt);
      if (dist < 600) { this.mode = 'hunt'; this.inspectShip = null; }
    }
  }

  _pickShip() {
    const ai = this.ai;
    const all = this.G.world.ships.all;
    let best = null, bd = 1e9;
    for (const s of all) {
      if (s === this.G.world.carrier) continue;
      const d = Math.hypot(s.pos.x - ai.pos.x, s.pos.z - ai.pos.z);
      if (d < 22000 && d < bd) { bd = d; best = s; }
    }
    return best;
  }

  dispose() {
    const i = this.G.bandits.indexOf(this.ai);
    if (i >= 0) this.G.bandits.splice(i, 1);
    this.ai.dispose();
  }
}
