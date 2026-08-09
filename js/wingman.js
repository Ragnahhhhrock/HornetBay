// wingman.js — VIPER TWO: an assigned wingman who launches with you on
// missions, holds your wing, covers you, takes tasking, and calls for help
// when he's the one in trouble
import * as THREE from 'three';
import { clamp, damp, rand, wrapAngle } from './util.js';
import { AIAircraft } from './ai.js';
import { Missile } from './weapons.js';
import { groundHeight } from './world.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

const ORDERS = ['ATTACK MY TARGET', 'COVER ME', 'FORM UP', 'RETURN TO BASE'];

export class Wingman {
  constructor(G) {
    this.G = G;
    this.ai = null;
    this.state = 'PREFLIGHT';   // PREFLIGHT -> JOIN -> WING / ENGAGE / DEFENSIVE / RTB / DEAD
    this.order = 'COVER ME';
    this.engageT = null;
    this.fireCool = rand(4, 7);
    this.helpCalled = false;
    this.defensiveSince = -1;
    this.callsign = 'VIPER TWO';
    this._chatter = -99;
  }

  get alive() { return !!(this.ai && !this.ai.dead); }

  _say(text, cls = 'info') {
    const G = this.G;
    G.msg(text, cls);
    if (G.radio) G.radio(text);
    this._chatter = G.time;
  }

  // called from main once the player is airborne on a mission
  launch() {
    const G = this.G, P = G.player;
    const type = P.type;
    // spawn astern and below, already dirty and climbing to join — but never
    // below the dirt: the launch gate fires at y>30, and a flat -300 offset
    // drowned him in the bay on every catapult shot (the VIPER TWO self-death)
    const back = P.fwd.clone().multiplyScalar(-2600);
    const spawnPos = P.pos.clone().add(back);
    spawnPos.y = Math.max(P.pos.y - 300, groundHeight(spawnPos.x, spawnPos.z) + 220, 180);
    this.ai = new AIAircraft(G.scene, G.world, type, {
      pos: spawnPos,
      heading: P.heading, speed: Math.max(P.speedKts * 0.514444, 140),
      name: this.callsign, label: this.callsign, hp: 130,
      mode: 'route', skill: 1.35, agility: 1.25, gunsOnly: true,
    });
    this.ai.kind = 'wingman';
    this.ai.identified = true;
    this.ai.isWingman = true;
    this.ai.missionUnit = true;   // VIPER TWO is always part of the cast — first seat on the K ring
    this.state = 'JOIN';
    this._say(`${this.callsign}: AIRBORNE — JOINING YOUR WING`);
    G.bandits.push(this.ai);
  }

  // station: 90 m abeam right, 70 m back, co-altitude
  _station(out) {
    const P = this.G.player;
    const f = P.fwd, r = _w.set(f.z, 0, -f.x);   // right vector
    return out.copy(P.pos).addScaledVector(f, -70).addScaledVector(r, 90);
  }

  issueOrder(o) {
    const G = this.G;
    if (!this.alive) { G.msg('NO WINGMAN ABOARD THIS SORTIE', 'warn'); return; }
    this.order = o;
    if (o === 'ATTACK MY TARGET') {
      const t = G.playerTarget;
      if (!t || t.dead) { this._say(`${this.callsign}: NO TARGET, LEAD`); return; }
      this.engageT = t;
      this.state = 'ENGAGE';
      this._say(`${this.callsign}: ATTACKING YOUR TARGET`);
    } else if (o === 'COVER ME') {
      this.engageT = null; this.state = 'WING';
      this._say(`${this.callsign}: COVERING YOU, LEAD`);
    } else if (o === 'FORM UP') {
      this.engageT = null; this.state = 'WING';
      this._say(`${this.callsign}: FORMING UP`);
    } else if (o === 'RETURN TO BASE') {
      this.state = 'RTB';
      this._say(`${this.callsign}: RTB — SEE YOU BACK AT THE BOAT`);
    }
  }

  _pickThreat() {
    const G = this.G, P = G.player;
    let best = null, bd = 1e9;
    for (const b of G.bandits) {
      if (!b.hostile || b.dead || b.ejected) continue;
      const afterMe = b.target === this.ai;
      const afterLead = b.target === P;
      const d = b.pos.distanceTo(P.pos);
      if (afterMe) return b;                        // self-defence first
      if ((afterLead || d < 14000) && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  _tryFire(dt) {
    const G = this.G, ai = this.ai, t = this.engageT;
    if (!t || t.dead || t.ejected) return;
    this.fireCool -= dt;
    if (this.fireCool > 0) return;
    const dist = ai.pos.distanceTo(t.pos);
    if (dist < 1800 || dist > 12000) return;
    _v.copy(t.pos).sub(ai.pos).normalize();
    if (ai.fwd(_w).angleTo(_v) > 0.55) return;
    G.missiles.push(new Missile(G, ai, 'aim120', t));
    G.audio.enemyMissile();
    this.fireCool = rand(7, 12);
    this._say(`${this.callsign}: FOX THREE!`);
    // shot at him and he may well turn into the fight: that's how TWO gets
    // in trouble and starts calling for the lead
    if (t.hostile && !t.dead && t.target !== ai && Math.random() < 0.55) {
      t.target = ai; t.mode = 'attack';
    }
  }

  _checkDefensive(dt) {
    const G = this.G, ai = this.ai;
    // a hostile on him or an inbound missile makes him defensive
    let threat = null, missileIn = false;
    for (const b of G.bandits) {
      if (b.hostile && !b.dead && b.target === ai) { threat = b; break; }
    }
    for (const m of G.missiles) {
      if (!m.dead && m.target === ai && m.pos.distanceTo(ai.pos) < 9000) { missileIn = true; threat = threat || m.owner; break; }
    }
    if (threat) {
      if (this.state !== 'DEFENSIVE') {
        this.state = 'DEFENSIVE';
        this.defensiveSince = G.time;
        this.helpCalled = false;
      }
      // jink hard
      if ((this._jinkT ?? 0) <= G.time) {
        this._jinkT = G.time + rand(1.0, 1.8);
        const f = ai.fwd(new THREE.Vector3());
        this._jink = f.applyAxisAngle(new THREE.Vector3(0, 1, 0), rand(0.9, 1.8) * (Math.random() < 0.5 ? 1 : -1));
        this._jink.y = clamp(this._jink.y + rand(-0.4, 0.4), -0.5, 0.5);
      }
      ai._steerToward(this._jink, dt, 1.6);
      ai.targetSpeed = 310;
      // call for help if he can't shake it
      if (!this.helpCalled && G.time - this.defensiveSince > 6) {
        this.helpCalled = true;
        this._say(`${this.callsign}: BANDIT ON MY SIX — LEAD, REQUEST ASSISTANCE!`, 'warn');
      }
      return true;
    }
    if (this.state === 'DEFENSIVE') {
      // shook it (maybe the lead saved him)
      this.state = this.order === 'ATTACK MY TARGET' && this.engageT && !this.engageT.dead ? 'ENGAGE' : 'WING';
      if (this.helpCalled) this._say(`${this.callsign}: SHOT'S AWAY — THANKS, LEAD!`);
      this.helpCalled = false;
    }
    return false;
  }

  update(dt) {
    const G = this.G, ai = this.ai;
    if (!ai) return;
    if (ai.dead) {
      if (this.state !== 'DEAD') {
        this.state = 'DEAD';
        G.msg(`${this.callsign} IS DOWN`, 'bad');
        if (G.radio) G.radio(`${this.callsign} IS DOWN. NO CHUTE OBSERVED.`);
      }
      return;
    }
    const P = G.player;
    if (P.dead || P.ejected) { ai.targetSpeed = 220; return; }   // orbit quietly, lead's done

    if (this._checkDefensive(dt)) return;

    switch (this.state) {
      case 'JOIN': {
        this._station(_v);
        _w.copy(_v).sub(ai.pos);
        const d = _w.length();
        ai._steerToward(_w.normalize(), dt, d > 900 ? 1.0 : 0.6);
        ai.targetSpeed = d > 2500 ? 330 : d > 600 ? P.speedKts * 0.514444 + 45 : P.speedKts * 0.514444 + 12;
        if (d < 260) { this.state = 'WING'; this._say(`${this.callsign}: ON YOUR WING`); }
        break;
      }
      case 'WING': {
        // cover: if something's hunting the lead (or close in), go get it
        if (this.order === 'COVER ME') {
          const t = this._pickThreat();
          if (t && t.pos.distanceTo(P.pos) < 12000) {
            this.engageT = t; this.state = 'ENGAGE';
            this._say(`${this.callsign}: ENGAGING — I'VE GOT THIS ONE`);
            break;
          }
        }
        this._station(_v);
        if (P.onGround) _v.y = P.pos.y + 260;   // lead's on the deck: hold overhead
        _w.copy(_v).sub(ai.pos);
        const d = _w.length();
        ai._steerToward(_w.normalize(), dt, d > 700 ? 0.9 : 0.5);
        const leadSpd = P.onGround ? 168 : P.speedKts * 0.514444;
        ai.targetSpeed = d > 1200 ? Math.min(340, leadSpd + 80) : d > 250 ? leadSpd + 18 : leadSpd;
        break;
      }
      case 'ENGAGE': {
        const t = this.engageT;
        if (!t || t.dead || t.ejected) {
          this.state = 'WING'; this.engageT = null;
          this._say(`${this.callsign}: SPLASH ONE — RESUMING STATION`);
          break;
        }
        ai._steerToward(_v.copy(t.pos).sub(ai.pos).normalize(), dt, 1.2);
        const d = ai.pos.distanceTo(t.pos);
        ai.targetSpeed = d > 5000 ? 340 : 280;
        this._tryFire(dt);
        // gun-zone finish if the fight gets close
        if (d < 1500 && ai.fwd(_w).angleTo(_v.copy(t.pos).sub(ai.pos).normalize()) < 0.3) {
          if (Math.random() < dt * 1.6) { t.hit(18, G, false); if (t.dead) G.explode(t.pos, 1.5); }
        }
        // task saturation: too far from the lead and he gives it up
        if (ai.pos.distanceTo(P.pos) > 26000) { this.state = 'WING'; this.engageT = null;
          this._say(`${this.callsign}: TOO FAR FROM YOU, LEAD — COMING HOME`); }
        break;
      }
      case 'RTB': {
        // head for home plate and fade out
        const c = G.world.carrier;
        const dx = c.pos.x - ai.pos.x, dz = c.pos.z - ai.pos.z;
        const d = Math.hypot(dx, dz);
        const want = Math.atan2(dx, -dz);
        let err = wrapAngle(want - ai.heading);
        // frozen-sign unwind: dead astern the raw steer dithers forever
        if (Math.abs(err) > 2.6) {
          if (!this._rtbSign) this._rtbSign = err >= 0 ? 1 : -1;
          ai.heading += this._rtbSign * Math.min(0.8 * dt, Math.abs(err));
        } else {
          this._rtbSign = null;
          ai.heading += clamp(err, -0.8 * dt, 0.8 * dt);
        }
        ai.pitch = clamp(ai.pitch, -0.08, 0.08);
        ai.pos.y = damp(ai.pos.y, 400, 0.4, dt);
        ai.targetSpeed = 260;
        if (d < 6000) {
          this._say(`${this.callsign}: RECOVERED ABOARD — GOOD HUNTING, LEAD`);
          ai.removeMe = true;
          this.state = 'GONE';
        }
        break;
      }
    }
    // idle chatter when nothing's happening
    if (this.state === 'WING' && G.time - this._chatter > 75) {
      this._chatter = G.time;
      if (Math.random() < 0.3) this._say(`${this.callsign}: ${['WINGS LEVEL, LEAD', 'NICE FORMATION, LEAD', 'WATCH YOUR SIX O\'CLOCK LOW', 'FUEL STATE IS FINE'][Math.floor(Math.random() * 4)]}`);
    }
  }

  hudLine() {
    if (!this.ai) return '';
    const s = this.state;
    if (s === 'DEAD') return 'TWO: KIA';
    if (s === 'GONE') return 'TWO: RTB';
    if (s === 'DEFENSIVE') return 'TWO: DEFENSIVE!';
    if (s === 'ENGAGE') return 'TWO: ENGAGING';
    if (s === 'JOIN') return 'TWO: JOINING';
    return this.order === 'COVER ME' ? 'TWO: COVERING' : 'TWO: ON WING';
  }

  dispose() {
    const G = this.G;
    if (this.ai) {
      const i = G.bandits.indexOf(this.ai);
      if (i >= 0) G.bandits.splice(i, 1);
      this.ai.dispose();
      this.ai = null;
    }
  }
}

export { ORDERS };
