// traffic.js — SFO commercial airliner traffic: scheduled arrivals and
// departures around the clock, in every weather, like the real 24-hour airport.
// Fleet is 1994-correct: 747-400s, 737s, DC-10s, MD-90s in fictional liveries.
import * as THREE from 'three';
import { rand } from './util.js';
import { AIRLINE_LIVERIES } from './models.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FLEET = ['b744', 'b737', 'dc10', 'md90'];
const SOULS = { b744: 388, b737: 146, dc10: 268, md90: 158 };

export class Traffic {
  constructor(G) {
    this.G = G;
    this.t = 10;                 // first arrival is already on final when you launch
    this.flights = [];
    this.depNext = false;        // alternate arrivals and departures
    this.seq = 100 + Math.floor(Math.random() * 700);
  }

  _runway(name) { return this.G.world.runways.find(r => r.name === name); }

  _spawn(dep) {
    const G = this.G;
    const type = FLEET[Math.floor(Math.random() * FLEET.length)];
    const livery = Math.floor(Math.random() * AIRLINE_LIVERIES.length);
    const airline = AIRLINE_LIVERIES[livery].name;
    const flightNo = 100 + (this.seq++ % 800);
    const rw = this._runway(dep ? 'SFO INTL 01R' : 'SFO INTL 01L');
    const f = { x: Math.sin(rw.hdg), z: -Math.cos(rw.hdg) };        // down-runway
    const thr = { x: rw.x - f.x * rw.len / 2, z: rw.z - f.z * rw.len / 2 };
    let ai;
    if (dep) {
      // rolling out on 01R, climbing north over the bay, gone over San Pablo
      ai = G.spawnAI(type, {
        pos: V(thr.x, rw.elev + 2, thr.z), heading: rw.hdg, speed: 25,
        name: `${airline} ${flightNo}`, label: airline, livery,
        mode: 'route', noEvade: true, surface: true,   // surface: skip ground collision during the roll
        waypoints: [
          V(rw.x + f.x * (rw.len / 2 + 400), rw.elev + 8, rw.z + f.z * (rw.len / 2 + 400)),
          V(rw.x + f.x * 6000, 700, rw.z + f.z * 6000),   // high over San Bruno Mtn
          V(16000, 1300, 4000),
          V(28000, 2400, -16000),
        ],
      });
      ai.targetSpeed = 80;   // spool up down the runway; 235 once airborne
      ai._dep = true;
    } else {
      // 12 km final for 01L, in over South San Francisco
      ai = G.spawnAI(type, {
        pos: V(thr.x - f.x * 12000, 900, thr.z - f.z * 12000), heading: rw.hdg, speed: 165,
        name: `${airline} ${flightNo}`, label: airline, livery,
        mode: 'land', noEvade: true,
        waypoints: [
          V(thr.x - f.x * 6000, 420, thr.z - f.z * 6000),
          V(thr.x + f.x * 500, rw.elev + 2, thr.z + f.z * 500),
        ],
      });
    }
    ai.kind = 'airliner';
    ai.identified = true;
    ai.souls = SOULS[type] || 150;
    const fl = { ai, dep, done: false, landedAt: -1 };
    ai.onEvent = (ev) => {
      if (ev === 'routeDone') fl.done = true;
      if (ev === 'landed') fl.landedAt = G.time;
    };
    this.flights.push(fl);
    G.msg(`${dep ? 'SFO DEPARTURE' : 'SFO ARRIVAL'}: ${ai.name} ${dep ? 'ROLLING 01R' : 'ON FINAL 01L'}`, 'info');
  }

  update(dt) {
    const G = this.G;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = rand(50, 80);                 // a movement about every minute, forever
      // only traffic still in the SFO area counts against the cap — a departure
      // half an hour downrange doesn't hold up the next arrival
      const local = this.flights.filter(f => !f.ai.dead && Math.hypot(f.ai.pos.x - 13000, f.ai.pos.z - 20000) < 30000).length;
      if (local < 3) {
        this._spawn(this.depNext);
        this.depNext = !this.depNext;
      }
    }
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i], ai = f.ai;
      if (ai.dead && ai.removeMe) { this.flights.splice(i, 1); continue; }
      if (f.dep) {
        // two-stage departure: roll at 80, rotate and climb at 235
        if (ai.surface && ai.pos.y > 30) { ai.surface = false; ai.targetSpeed = 235; }
        if (f.done) { ai.removeMe = true; this.flights.splice(i, 1); }
      } else if (f.landedAt > 0 && G.time - f.landedAt > 15) {
        ai.removeMe = true;   // unloaded and off to the hangar
        this.flights.splice(i, 1);
      }
    }
  }
}
