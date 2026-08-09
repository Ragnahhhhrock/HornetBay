// awacs.js — E-2C Hawkeye of VAW-123 Screwtops, high over the bay with the
// big radar: calls bogies, friendlies and civil traffic to the player
import * as THREE from 'three';
import { clamp, damp, rand, wrapAngle } from './util.js';
import { AIAircraft } from './ai.js';

const _d = new THREE.Vector3();
const CLOCK = ['TWELVE', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN'];
const NUM = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
             'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN', 'TWENTY'];

function clockCode(relRad) {
  let deg = (relRad * 180 / Math.PI + 360) % 360;
  return CLOCK[Math.round(deg / 30) % 12];
}
function angels(altM) { return Math.max(1, Math.round(altM * 3.28084 / 1000)); }

export class Awacs {
  constructor(G) {
    this.G = G;
    this.legT = 0.2;
    this.ai = new AIAircraft(G.scene, G.world, 'e2c', {
      pos: this._orbitPoint(this.legT, new THREE.Vector3()),
      heading: 0, speed: 140,
      name: 'SCREWTOPS 601', label: 'E-2C HAWKEYE', hp: 300,
      mode: 'route', noEvade: true,
    });
    this.ai.kind = 'awacs';
    this.ai.identified = true;
    this.ai.targetSpeed = 140;
    this.greeted = false;
    this.cool = { bogie: 0, traffic: 0, picture: 20, friendly: 30 };
    this._lastBogie = null;
    G.bandits.push(this.ai);
  }

  // a 20 NM x 20 NM oval around the map centre (-10500, 12000) at 23,000 ft
  // — 20 NM = 37,040 m across, so an 18,520 m radius (~14 min a lap)
  _orbitPoint(t, out) {
    const a = t * Math.PI * 2;
    return out.set(-10500 + Math.cos(a) * 18520, 7010, 12000 + Math.sin(a) * 18520);
  }

  _call(text) {
    this.G.msg(`SCREWTOPS: ${text}`, 'radio');
    this.G.audio.radioClick();
  }

  update(dt) {
    const G = this.G, ai = this.ai;
    if (ai.dead || ai.removeMe) return;
    // fly the oval — 140 m/s around a 2*pi*18520 m lap
    this.legT = (this.legT + dt * 140 / (2 * Math.PI * 18520)) % 1;
    this._orbitPoint(this.legT, _d);
    ai._steerToward(_d.sub(ai.pos).normalize(), dt, 0.5);
    ai.targetSpeed = 140;
    ai.pos.y = damp(ai.pos.y, 7010, 0.5, dt);
    // props + rotodome
    for (const p of ai.model.userData.props || []) p.rotation.z += dt * 50;
    if (ai.model.userData.rotodome) ai.model.userData.rotodome.rotation.y += dt * 0.6;

    // ---- the radar work ----
    for (const k of Object.keys(this.cool)) this.cool[k] -= dt;
    const P = G.player;
    if (G.state !== 'flying' || P.dead || P.onGround) return;
    if (!this.greeted) {
      this.greeted = true;
      this._call('VAW-123 ON STATION, ANGELS TWO-THREE OVER THE BAY — BULLSEYE IS ALCATRAZ. WE\'RE YOUR EYES.');
      return;
    }
    // 1) approaching bogies: hostile, within 50 NM of the player, closing
    if (this.cool.bogie <= 0) {
      let best = null, bd = 1e9;
      for (const b of G.bandits) {
        if (!b.hostile || b.dead || b.ejected) continue;
        const d = b.pos.distanceTo(P.pos);
        const closing = b.target === P || (b.vel && b.vel.dot(_d.copy(P.pos).sub(b.pos).normalize()) > 40);
        if (closing && d < 95000 && d < bd) { bd = d; best = b; }
      }
      if (best) {
        const rel = wrapAngle(Math.atan2(best.pos.x - P.pos.x, -(best.pos.z - P.pos.z)) - P.heading);
        const nm = Math.max(1, Math.round(bd / 1852));
        const aspect = best.target === P ? 'ON YOU' : 'CLOSING';
        this._call(`BOGEY — YOUR ${clockCode(rel)} O'CLOCK, ${nm} MILES, ANGELS ${angels(best.pos.y)}, ${aspect}.`);
        this.cool.bogie = 28;
        this._lastBogie = best;
        return;
      }
      this.cool.bogie = 4;   // re-scan soon
    }
    // 2) civil traffic close aboard
    if (this.cool.traffic <= 0) {
      for (const b of G.bandits) {
        if (b.kind !== 'airliner' || b.dead) continue;
        const d = b.pos.distanceTo(P.pos);
        if (d < 11000 && Math.abs(b.pos.y - P.pos.y) < 900) {
          const rel = wrapAngle(Math.atan2(b.pos.x - P.pos.x, -(b.pos.z - P.pos.z)) - P.heading);
          const below = Math.round((P.pos.y - b.pos.y) * 3.28084 / 500) * 500;
          this._call(`CIVIL TRAFFIC — YOUR ${clockCode(rel)} O'CLOCK, ${Math.max(1, Math.round(d / 1852))} MILES, ${below > 0 ? below + ' BELOW' : 'CO-ALTITUDE'}.`);
          this.cool.traffic = 40;
          return;
        }
      }
      this.cool.traffic = 8;
    }
    // 3) friendly note, now and then
    if (this.cool.friendly <= 0) {
      this.cool.friendly = rand(70, 110);
      const fr = [];
      if (G.wingman && G.wingman.alive) fr.push('VIPER TWO ON YOUR WING');
      if (G.p3 && !G.p3.ai.dead) fr.push('THE ORION WORKING THE SEA LANES WEST');
      if (G.heliOps && G.heliOps.seahawk.mode !== 'parked') fr.push('THE CRUISER\'S HELO AIRBORNE');
      if (fr.length) { this._call(`FRIENDLIES — ${fr.join(', ')}.`); return; }
    }
    // 4) the big picture, on a slow cycle
    if (this.cool.picture <= 0) {
      this.cool.picture = 95;
      let hos = 0, civ = 0;
      for (const b of G.bandits) {
        if (b.dead) continue;
        if (b.hostile) hos++;
        else if (b.kind === 'airliner') civ++;
      }
      this._call(hos
        ? `PICTURE — ${hos <= 20 ? NUM[hos] : hos} HOSTILE GROUPS WEST, CIVIL TRAFFIC ${civ <= 20 ? NUM[civ] : civ} IN THE BAY.`
        : `PICTURE CLEAN — NO HOSTILES ON THE SCOPE. CIVIL TRAFFIC ${civ <= 20 ? NUM[civ] : civ} IN THE BAY.`);
    }
  }

  dispose() {
    const i = this.G.bandits.indexOf(this.ai);
    if (i >= 0) this.G.bandits.splice(i, 1);
    this.ai.dispose();
  }
}
