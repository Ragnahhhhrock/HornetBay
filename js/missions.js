// missions.js — qualification, thirteen missions, free flight
import * as THREE from 'three';
import { rand, clamp, damp } from './util.js';
import { carrierLocalToWorld } from './flight.js';
import { buildBanner } from './models.js';
import { groundHeight } from './world.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _cv = new THREE.Vector3();

// helpers
function near(a, b, r) { return a.distanceTo(b) < r; }

// ============================================================
// ------- Bear-raid helpers: the missile carrier, her escorts, and the last-ditch guns -------
// a Bear pack = one Tu-95MS + Flanker shotgun. she trucks straight for her
// launch point, pumps out two Kitchens twenty seconds apart, then turns for home
function _bearPack(G, opts) {
  const c = G.world.carrier;
  const bear = G.spawnAI('tu95', {
    pos: opts.pos, heading: Math.atan2(c.pos.x - opts.pos.x, -(c.pos.z - opts.pos.z)),
    speed: 235, hostile: true, name: 'TU-95MS BEAR-H', label: 'BEAR',
    mode: 'route', waypoints: [c.pos.clone().add(V(0, 8200, 0))], noEvade: true,
  });
  bear.kind = 'bandit'; bear.identified = true;
  const escorts = [];
  for (let i = 0; i < opts.escorts; i++) {
    const e = G.spawnAI('su27', {
      pos: opts.pos.clone().add(V(-2500 - i * 1800, 600 + i * 400, 2000 - i * 3600)),
      heading: bear.heading, speed: 240, hostile: true, name: 'SU-27', label: 'SU-27',
      mode: 'orbit', skill: skillFor(opts.rating), agility: agilityFor(opts.rating),
    });
    e.kind = 'bandit'; e.identified = true; e.orbitCenter = bear.pos.clone();
    e.orbitRadius = 3200 + i * 900; e.noAA = true;
    escorts.push(e);
  }
  return { bear, escorts, missiles: [], launched: 0, launchT: 0, launchD: opts.launchD || 52000, egress: false, hot: false };
}

function _bearPackUpdate(G, dt, pack) {
  const c = G.world.carrier;
  const { bear } = pack;
  if (!bear.dead) {
    // escorts weave around their charge until the fight comes to them
    for (const e of pack.escorts) {
      if (e.dead || e.mode === 'attack') continue;
      e.orbitCenter.copy(bear.pos);
      if (!pack.hot && (G.player.pos.distanceTo(bear.pos) < 30000 || bear.hp < 380)) {
        pack.hot = true;
        G.msg('FLANKERS ARE COMMITTING', 'bad');
        G.radio('SCREWTOPS 601: ESCORTS LEAVING THE BEAR — TWO NOSES ON YOU, VIPER. FIGHT\'S ON!');
      }
      if (pack.hot) for (const e2 of pack.escorts) {
        if (e2.dead || e2.mode === 'attack') continue;
        e2.mode = 'attack'; e2.target = Math.random() < 0.6 || !G.wingman ? G.player : G.wingman.ai; e2.fireCooldown = rand(6, 12);
      }
    }
    // launch point reached: two Kitchens, eighteen seconds apart, then run for home
    const d = bear.pos.distanceTo(c.pos);
    if (pack.launched < 2 && d < pack.launchD) {
      pack.launchT -= dt;
      if (pack.launchT <= 0) {
        pack.launchT = 18;
        pack.launched++;
        const m = G.spawnAI('cruise', {
          pos: bear.pos.clone().add(V(0, -60, 0)), heading: bear.heading, speed: 235,
          name: 'AS-4 KITCHEN', label: 'CRUISE MSL', mode: 'straight', noEvade: true, hp: 60,
          terrainFollow: true, hostile: true,
        });
        m.kind = 'bandit'; m.identified = true; m.targetSpeed = 300;
        pack.missiles.push(m);
        G.msg(`MISSILE IN THE AIR — KITCHEN #${pack.launched} AWAY`, 'bad');
        G.radio(`SCREWTOPS 601: VAMPIRE VAMPIRE! THE BEAR HAS LAUNCHED — MISSILE ${pack.launched} OF TWO, RUNNING FOR THE CARRIER!`);
        if (pack.launched === 2) {
          bear.waypoints = [bear.pos.clone().add(V(-220000, 800, 30000))];
          G.radio('SCREWTOPS 601: BEAR IS TURNING FOR HOME — THE MISSILES ARE YOURS, VIPER.');
        }
      }
    } else if (pack.launched === 0) pack.launchT = 1.2;   // inside the ring: first arrow nocks fast
    // the missiles steer for the moving boat the whole way in
    for (const m of pack.missiles) {
      if (m.dead) continue;
      const d = _cv.copy(c.pos).sub(m.pos);
      m.heading = Math.atan2(d.x, -d.z);
    }
  }
}

// Phalanx CIWS aboard the escorts — the last wall of lead. each mount picks
// the closest missile in its envelope, walks tracers onto it, kill odds
// climbing steeply as the range closes
function _ciwsUpdate(G, dt, missiles) {
  if (!G.world.ships) return;
  for (const e of G.world.ships.escorts) {
    let tgt = null, bd = 3800;
    for (const m of missiles) {
      if (m.dead) continue;
      const d = m.pos.distanceTo(e.pos);
      if (d < bd) { bd = d; tgt = m; }
    }
    if (!tgt) continue;
    const mount = _cv.copy(e.pos).setY(16);
    if (!e._ciwsCalled) { e._ciwsCalled = true; G.msg('PHALANX IS FIRING', 'warn'); G.radio(`${e.name}: CIWS ENGAGING — ALL HANDS BRACE!`); }
    if (Math.random() < dt * 26) G.fx.trail(mount.clone().lerp(tgt.pos, 0.06 + Math.random() * 0.25), 2.2, 0xffd080, 0.45);
    if (Math.random() < dt * 5) G.fx.flash(mount.clone(), 9, 0xfff0b0, 0.12);
    const pps = clamp(2.1 - bd / 2100, 0.3, 1.9);
    if (Math.random() < pps * dt) {
      G.explode(tgt.pos.clone(), 1.5);
      tgt.kill(G, true, false);
      G.msg(`PHALANX KILL — ${e.name} SAVED THE SHIP`, 'good');
      G.radio(`${e.name}: SPLASH ONE! PHALANX GOT HIM!`);
    }
  }
}

// MANPAD teams on decks and boats — shoulder-fired Iglas, deadly low and
// slow. Each shooter: { ent, cd, fired, max }. Envelope: inside 4.3 km and
// below 1,350 m. Flares beat the round; altitude beats the shooter.
function _manpadUpdate(G, dt, shooters) {
  const P = G.player;
  if (P.dead || P.ejected || P.onGround) return;
  for (const s of shooters) {
    if (s.ent.dead) continue;
    s.cd -= dt;
    const d = s.ent.pos.distanceTo(P.pos);
    if (s.cd <= 0 && d < 4300 && P.pos.y < 1350) {
      s.cd = rand(9, 15);
      if ((s.fired || 0) < (s.max || 8)) {
        s.fired = (s.fired || 0) + 1;
        G.fireEnemyMissile(s.ent, P, 'igla');
        G.msg('MANPAD IN THE AIR — FLARES!', 'bad');
        if (!s._called) { s._called = true; G.radio('SCREWTOPS 601: MISSILE OFF THE DECK — SHOULDER-FIRED, VIPER. FLARES AND CLIMB!'); }
      }
    }
  }
}

// fast-boat flak batteries — a wall of lead around the target run. Tracers
// and flashes always fly inside the envelope; damage only lands on the
// player. If VIPER TWO is in the ring and closer, the gunners take the
// easier target — that is the diversion the brief promises.
function _aaaUpdate(G, dt, boats) {
  const P = G.player;
  const wm = G.wingman && G.wingman.alive ? G.wingman.ai : null;
  for (const b of boats) {
    if (b.dead) continue;
    let tgt = null, td = 1e9, isW = false;
    const dp = b.pos.distanceTo(P.pos);
    if (!P.dead && !P.ejected && dp < 3400 && P.pos.y < 1050) { tgt = P; td = dp; }
    if (wm && !wm.dead) {
      const dw = b.pos.distanceTo(wm.pos);
      if (dw < 3400 && wm.pos.y < 1150 && dw < td * 1.25) { tgt = wm; td = dw; isW = true; }
    }
    if (!tgt) continue;
    if (Math.random() < dt * 22) {
      const from = b.pos.clone(); from.y += 4;
      const to = tgt.pos.clone().add(_cv.set((Math.random() - 0.5) * 150, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 150));
      G.fx.trail(from.lerp(to, 0.10 + Math.random() * 0.35), 2.0, 0xff9040, 0.4);
    }
    if (Math.random() < dt * 6) G.fx.flash(b.pos.clone().setY(b.pos.y + 4), 5, 0xffc080, 0.1);
    if (!isW) {
      const pps = clamp(2.0 - td / 1900, 0.12, 1.5);
      if (Math.random() < pps * dt) {
        G.onPlayerHit(3 + Math.random() * 5, b);
        if (G.time - (b._aaaMsg || -30) > 5) { b._aaaMsg = G.time; G.msg('FLAK — THE BOATS ARE SHOOTING', 'warn'); }
      }
    } else if (Math.random() < dt * 0.45 && G.time - (b._wmMsg || -30) > 9) {
      b._wmMsg = G.time;
      G.radio('VIPER TWO: TAKING THE FIRE OFF YOU, LEAD — PRESS THE RUN!');
    }
  }
}

export const MISSIONS = [
// ------------------------------------------------ QUALIFICATION
{
  id: 't1', num: 101, title: 'T-1 FIRST SOLO', code: 'FLIGHT SCHOOL — BASIC',
  time: 'day', planeChoice: true,
  brief: [
    'BASIC FLIGHT MANEUVERS — SORTIE 1', '',
    'PERFORM A SUCCESSFUL CARRIER LANDING.', '',
    'FLY AROUND, RETURN, THEN LAND ON CARRIER.', '',
    'FULL POWER + AFTERBURNER, ROTATE AT 150 KTS.',
    'GEAR (L), HOOK (A), 30-40% THROTTLE, ~140 KTS,',
    'AIM FOR THE WIRES.', '',
    '- ESC RE-POSITION ON CATAPULT -',
  ],
  briefing: 'First solo: launch, pattern, carrier trap.',
  loadout: 'UNARMED TRAINING LOAD — CHAFF/FLARES ONLY',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    this.phase = 0;
    G.radio('ENTERPRISE TOWER: WIND IS DOWN THE DECK. CLEARED TO LAUNCH, VIPER 1-1.');
  },
  update(G, dt) {
    if (this.phase === 0 && !G.player.onGround) {
      this.phase = 1;
      G.waypoint = G.world.carrier.pos.clone().add(V(0, 40, 0));
      G.radio('TOWER: GOOD LAUNCH. FLY AROUND, RETURN, THEN LAND ON THE CARRIER.');
    }
    if (this.phase === 1 && G.trappedThisSortie) {
      G.addScore(2000);
      G.completeMission('LANDING SUCCESSFUL', 'YOU ARE NOW QUALIFIED FOR MISSIONS.\n\nWelcome to the squadron, pilot.\n\nSCORE +2000 (QUAL + TRAP)');
    }
  },
},
// ------------------------------------------------ T-2 BAY TOUR
{
  id: 't2', num: 102, title: 'T-2 BAY TOUR', code: 'FLIGHT SCHOOL — BASIC',
  time: 'day', planeChoice: true,
  brief: [
    'BASIC FLIGHT MANEUVERS — SORTIE 2', '',
    'NAVIGATION: OVERFLY THREE BAY LANDMARKS IN ORDER.', '',
    'GOLDEN GATE BRIDGE, DOWNTOWN, ANGEL ISLAND.', '',
    'PASS WITHIN 500 M OF EACH CHECKPOINT.', '',
    'MIND THE BRIDGE TOWERS. UNDER SEVEN MINUTES FOR A BONUS.',
    'THEN BRING HER HOME — SHE COUNTS WHEN SHE\'S DECKED.',
  ],
  briefing: 'Navigation run: Golden Gate, downtown, Angel Island.',
  loadout: 'UNARMED TRAINING LOAD — CHAFF/FLARES ONLY',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    this.legs = [
      { name: 'GOLDEN GATE', p: V(0, 200, 0) },
      { name: 'DOWNTOWN', p: V(7000, 400, 5000) },
      { name: 'ANGEL ISLAND', p: V(16500, 500, -6000) },
    ];
    this.idx = 0; this.t0 = -1;
    G.waypoint = this.legs[0].p;
    G.radio('INSTRUCTOR: THREE CHECKPOINTS, ANY PROFILE YOU LIKE. CALL THEM AS YOU CROSS THEM.');
  },
  update(G, dt) {
    if (this.t0 < 0 && !G.player.onGround) this.t0 = G.time;
    const leg = this.legs[this.idx];
    if (!leg) return;
    if (G.player.pos.distanceTo(leg.p) < 500) {
      this.idx++;
      const next = this.legs[this.idx];
      G.msg(leg.name + ' — CHECKPOINT DOWN', 'good');
      if (next) {
        G.waypoint = next.p;
        G.radio('INSTRUCTOR: ' + leg.name + ' DOWN. NEXT, ' + next.name + '.');
      } else {
        const t = G.time - this.t0, bonus = t < 420 ? 400 : 0;   // ~100 km out-and-back: 420 s means burner discipline, not a fairy tale
        G.addScore(800 + bonus);
        G.completeMission('TOUR COMPLETE', 'ALL THREE CHECKPOINTS DOWN IN ' + Math.round(t) + ' SECONDS.\n\nSCORE +800' + (bonus ? ' (+' + bonus + ' UNDER SEVEN MINUTES)' : ''));
      }
    }
  },
},
// ------------------------------------------------ T-3 CARRIER PATTERN
{
  id: 't3', num: 103, title: 'T-3 CARRIER PATTERN', code: 'FLIGHT SCHOOL — ADVANCED',
  time: 'day', planeChoice: true,
  brief: [
    'ADVANCED FLIGHT MANEUVERS — SORTIE 3', '',
    'TRAP ABOARD TWICE IN ONE SORTIE.', '',
    'LAUNCH, PATTERN, TRAP. TAXI BACK, LAUNCH AGAIN,',
    'PATTERN, TRAP. TWO ARRESTED LANDINGS TO PASS.', '',
    'BOLTERS COUNT AS GO-AROUNDS, NOT TRAPS.',
  ],
  briefing: 'Two arrested landings in one sortie.',
  loadout: 'UNARMED TRAINING LOAD — CHAFF/FLARES ONLY',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    this.traps0 = G.trapCount || 0; this.said1 = false;
    G.radio('LSO: TWO TRAPS TO PASS, VIPER. TAKE YOUR TIME IN THE GROOVE.');
  },
  update(G, dt) {
    const traps = (G.trapCount || 0) - this.traps0;
    if (traps >= 1 && !this.said1) {
      this.said1 = true;
      G.msg('TRAP ONE IN THE BOOK — ONE MORE', 'good');
      G.radio('LSO: GOOD PASS. CHOCKS AND CHAINS, THEN DO IT AGAIN.');
    }
    if (traps >= 2) {
      G.addScore(2500);
      G.completeMission('PATTERN WORK PASSED', 'TWO ARRESTED LANDINGS IN ONE SORTIE.\n\nThe boat is your home now.\n\nSCORE +2500');
    }
  },
},
// ------------------------------------------------ T-4 JOIN UP
{
  id: 't4', num: 104, title: 'T-4 JOIN UP', code: 'FLIGHT SCHOOL — ADVANCED',
  time: 'day', planeChoice: true,
  brief: [
    'ADVANCED FLIGHT MANEUVERS — SORTIE 4', '',
    'JOIN ON YOUR INSTRUCTOR AND HOLD FORMATION.', '',
    'HE FLIES A LAZY CIRCLE JUST WEST OF THE BOAT AT 2,500 M.', '',
    'STAY INSIDE 130 M OF HIM FOR 45 SECONDS TOTAL.', '',
    'SMOOTH HANDS. SMALL CORRECTIONS.',
  ],
  briefing: 'Join up and hold close formation for 45 seconds.',
  loadout: 'UNARMED TRAINING LOAD — CHAFF/FLARES ONLY',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    // the rendezvous circle hangs just west of the boat — the old 47 km
    // schlep east was five minutes of dead air before the lesson even began
    const wps = [];
    for (let i = 0; i < 8; i++) {
      const a = Math.PI + (i / 8) * Math.PI * 2;
      wps.push(V(-17000 + Math.cos(a) * 8000, 2500, 8000 + Math.sin(a) * 8000));
    }
    this.lead = G.spawnAI('fa18', {
      pos: V(-25000, 2500, 8000), heading: 0, speed: 180, hp: 9999,
      name: 'F/A-18', label: 'INSTRUCTOR', mode: 'route', noEvade: true,
      waypoints: wps, loop: true, hostile: false,
    });
    this.lead.kind = 'airliner'; this.lead.identified = true;
    this.formT = 0; this.marks = [false, false];
    G.waypoint = this.lead.pos;
    G.radio('INSTRUCTOR: ON THE RENDEZVOUS CIRCLE, ANGELS 2.5. JOIN ON MY WING WHEN READY.');
  },
  update(G, dt) {
    G.waypoint = this.lead.pos;
    const d = G.player.pos.distanceTo(this.lead.pos);
    if (d < 130) {
      this.formT += dt;
      if (!this.marks[0] && this.formT > 15) { this.marks[0] = true; G.msg('HOLDING — 15 OF 45 SECONDS', 'good'); G.radio('INSTRUCTOR: LOOKING GOOD. KEEP HER THERE.'); }
      if (!this.marks[1] && this.formT > 30) { this.marks[1] = true; G.msg('HOLDING — 30 OF 45 SECONDS', 'good'); }
    }
    if (this.formT >= 45) {
      G.addScore(1500);
      G.completeMission('FORMATION PASSED', '45 SECONDS GLUED TO HIS WING.\n\nSCORE +1500');
    }
  },
},
// ------------------------------------------------ T-5 AEROBATICS
{
  id: 't7', num: 105, title: 'T-5 AEROBATICS', code: 'FLIGHT SCHOOL — ADVANCED',
  time: 'day', planeChoice: true,
  brief: [
    'ADVANCED FLIGHT MANEUVERS — SORTIE 5', '',
    'THREE FIGURES, GRADED BY THE INSTRUMENTS:', '',
    '1. AILERON ROLL — FULL STICK, ALL THE WAY AROUND.',
    '2. LOOP — PULL, OVER THE TOP, DOWN THE HILL.',
    '3. SPLIT-S — ROLL INVERTED, PULL THROUGH.', '',
    'GET ABOVE 1,800 M BEFORE EACH FIGURE. POWER ON.',
  ],
  briefing: 'Graded aerobatics: roll, loop, split-S, in order.',
  loadout: 'UNARMED TRAINING LOAD — CHAFF/FLARES ONLY',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    // one little state machine per figure, fed with the up/forward vectors
    this.figs = [
      { name: 'AILERON ROLL', state: 0, t: 0 },
      { name: 'LOOP', state: 0, t: 0 },
      { name: 'SPLIT-S', state: 0, t: 0 },
    ];
    this.idx = 0; this.lowWarned = false;
    this._up = V(0, 1, 0); this._fw = V(0, 0, 1);
    G.radio('INSTRUCTOR: WEST OVER THE WATER, CLIMB TO 3,000. ROLL FIRST — SMOOTH, ALL THE WAY ROUND.');
  },
  _vec(G) {
    const q = G.player.quat;
    const up = this._up.set(0, 1, 0).applyQuaternion(q);
    const fw = this._fw.set(0, 0, 1).applyQuaternion(q);
    return { upY: up.y, fwY: fw.y };
  },
  update(G, dt) {
    const f = this.figs[this.idx];
    if (!f) return;
    const P = G.player;
    if (P.onGround) return;
    const { upY, fwY } = this._vec(G);
    f.t += dt;
    // height discipline: the figures must happen with sky underneath
    if (P.pos.y < 1200 && f.state > 0) {
      f.state = 0; f.t = 0;
      G.msg('TOO LOW — CLIMB BACK ABOVE 1,800 M AND START THE FIGURE AGAIN', 'warn');
      return;
    }
    if (P.pos.y < 800 && !this.lowWarned) { this.lowWarned = true; G.radio('INSTRUCTOR: HEIGHT! AEROBATICS WANT SKY UNDERNEATH YOU.'); }
    if (P.pos.y > 1800) this.lowWarned = false;
    let done = false;
    if (this.idx === 0) {
      // roll: upright -> inverted -> upright, never pitching hard — the
      // roll-rate gate keeps a loop from masquerading as a slow roll, and
      // the nose gate forgives a roll entered nose-high (students do)
      if (f.state === 0 && upY > 0.6) f.state = 1;
      else if (f.state === 1 && upY < -0.5 && Math.abs(fwY) < 0.85 && Math.abs(P.rollRate) > 0.8) f.state = 2;
      else if (f.state === 2 && upY > 0.6) done = true;
      else if (f.state === 2 && Math.abs(fwY) > 0.95) f.state = 1;   // mushed out — try again
      if (f.t > 12) { f.state = 0; f.t = 0; }
    } else if (this.idx === 1) {
      // loop: pull up -> inverted over the top -> diving -> recovered level
      if (f.state === 0 && fwY > 0.55) f.state = 1;
      else if (f.state === 1 && upY < -0.2) f.state = 2;
      else if (f.state === 2 && fwY < -0.45) f.state = 3;
      else if (f.state === 3 && upY > 0.5 && Math.abs(fwY) < 0.45) done = true;
      if (f.t > 40) { f.state = 0; f.t = 0; }
    } else {
      // split-S: inverted first, then pull through into the dive, recover level
      if (f.state === 0 && upY < -0.5) f.state = 1;
      else if (f.state === 1 && fwY < -0.5) f.state = 2;
      else if (f.state === 2 && upY > 0.5 && Math.abs(fwY) < 0.5) done = true;
      if (f.t > 25) { f.state = 0; f.t = 0; }
    }
    if (done) {
      G.msg(f.name + ' — GRADED PASS', 'good');
      this.idx++;
      const next = this.figs[this.idx];
      if (next) {
        G.radio('INSTRUCTOR: CLEAN ' + f.name + '. NEXT: ' + next.name + '.');
      } else {
        G.addScore(1500);
        G.completeMission('AEROBATICS PASSED', 'ROLL, LOOP, SPLIT-S — ALL THREE GRADED.\n\nThe sky is yours to use now, not just to fly through.\n\nSCORE +1500');
      }
    }
  },
},
// ------------------------------------------------ T-6 GUNNERY
{
  id: 't5', num: 106, title: 'T-6 GUNNERY', code: 'FLIGHT SCHOOL — COMBAT',
  time: 'day', planeChoice: true,
  brief: [
    'AERIAL COMBAT — SORTIE 6', '',
    'FOUR TARGET BALLOONS TETHERED OFF THE COAST.', '',
    'SPLASH ALL FOUR. WORK THE GUN: SIGHT UP, TRACK,', '',
    'SHORT BURSTS. THE SCORERS PREFER 20MM.', '',
    'WATCH YOUR ALTITUDE ON THE RUN-OUT.',
  ],
  briefing: 'Splash four target balloons on the gunnery range.',
  loadout: 'GUNS + 2× AIM-9 — GUNNERY RANGE',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    this.targets = [];
    const spots = [[-26000, 1500, 9000], [-20000, 2000, 2000], [-14000, 1200, 11000], [-9000, 1800, 3000]];
    for (const s of spots) {
      const b = G.spawnAI('balloon', {
        pos: V(s[0], s[1], s[2]), heading: Math.random() * 6.28, speed: 12, hp: 20,
        name: 'TARGET BALLOON', label: 'TARGET', mode: 'straight', noEvade: true, hostile: true,
      });
      b.kind = 'bandit'; b.identified = true;
      b.noAA = true;   // school rules: the fleet holds fire — these are the pilot's
      this.targets.push(b);
    }
    G.waypoint = this.targets[0].pos;
    G.radio('RANGE CONTROL: FOUR TARGETS TETHERED OFF THE COAST. THE RANGE IS YOURS.');
  },
  update(G, dt) {
    if (this.done) return;
    const alive = this.targets.filter(b => !b.dead);
    if (alive.length) {
      let best = alive[0], bd = 1e12;
      for (const b of alive) { const d = b.pos.distanceToSquared(G.player.pos); if (d < bd) { bd = d; best = b; } }
      G.waypoint = best.pos;
    } else {
      this.done = true;
      G.addScore(1500);
      G.completeMission('GUNNERY PASSED', 'ALL FOUR TARGETS DOWN.\n\nSCORE +1500');
    }
  },
},
// ------------------------------------------------ T-6 DOGFIGHT 1V1
{
  id: 't6', num: 107, title: 'T-7 DOGFIGHT 1V1', code: 'FLIGHT SCHOOL — COMBAT',
  time: 'day', planeChoice: true,
  brief: [
    'AERIAL COMBAT — SORTIE 7', '',
    'ONE AGGRESSOR, GUNS AND HEATERS, NO HELP COMING.', '',
    'HE IS RATED BUT FAIR — LIKE A GOOD WINGMAN ON', '',
    'THE OTHER SIDE. SPLASH HIM TO GRADUATE.', '',
    'WATCH THE MERGE. FIGHT YOUR ANGLES.',
  ],
  briefing: 'One-versus-one against a rated aggressor. Splash him.',
  loadout: '2× AIM-9 + 2× AIM-7 + GUNS',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    const c = G.world.carrier;
    this.bandit = G.spawnAI('mig29', {
      pos: c.pos.clone().add(V(-14000, 3000, 6000)), heading: Math.PI / 2 + 0.4, speed: 240, hp: 100,
      hostile: true, name: 'MIG-29', label: 'AGGRESSOR', mode: 'attack', skill: skillFor(PILOT_RATING.t6), agility: agilityFor(PILOT_RATING.t6),
    });
    this.bandit.target = G.player; this.bandit.kind = 'bandit'; this.bandit.identified = true;
    this.bandit.noAA = true;   // school rules: the fleet holds fire — this one is the pilot's
    this.done = false;
    G.radio('AGGRESSOR CONTROL: BANDIT IS YOURS, VIPER. FIGHTS ON.');
    G.msg('!! FIGHTS ON — AGGRESSOR INBOUND !!', 'bad');
  },
  update(G, dt) {
    if (this.done) return;
    if (this.bandit.dead || this.bandit.ejected) {
      this.done = true;
      G.addScore(2000);
      G.completeMission('GRADUATED', 'AGGRESSOR SPLASHED.\n\nYou are cleared for the campaign, pilot.\n\nSCORE +2000');
    }
  },
},
// ------------------------------------------------ T-8 IRON BOMBS
{
  id: 't8', num: 108, title: 'T-8 IRON BOMBS', code: 'FLIGHT SCHOOL — STRIKE',
  time: 'day', planeChoice: true, mk83: 6,
  brief: [
    'STRIKE WEAPONS — SORTIE 8', '',
    'TWO TARGET HULKS ANCHORED ON THE BOMBING RANGE.', '',
    'SELECT MK 83 (KEY 5). THE CCIP PIPPER DOES THE', '',
    'MATH: DIVE 20-30 DEGREES ON THE RUN-IN, TRACK', '',
    'THE PIPPER ONTO THE HULL, PICKLE (SPACE), AND', '',
    'PULL OUT BY 800 FT — THE BLAST DOES NOT CARE', '',
    'WHO DROPPED IT. SINK BOTH HULKS TO PASS.', '',
    'SIX BOMBS. MAKE EACH ONE COUNT.',
  ],
  briefing: 'Sink two target hulks with Mk 83 dumb bombs on the range.',
  loadout: '6× MK 83 · GUNS — BOMBING RANGE',
  setup(G) {
    G.player.type = 'f18';                      // the bomb racks are Hornet-only
    G.setPlayerStart({ onCarrier: true });
    G.player.stores.mk83 = 6;
    this.targets = [];
    const spots = [[-39000, 16000, 'TARGET HULK 1'], [-45500, 21500, 'TARGET HULK 2']];
    for (const [x, z, nm] of spots) {
      const h = G.spawnAI('freighter', {
        pos: V(x, 0, z), heading: 0.8, speed: 0, hp: 380, surface: true, noEvade: true,
        name: nm, label: 'TARGET', mode: 'straight',
      });
      h.kind = 'bandit'; h.identified = true; h.blastR = 80; h.targetSpeed = 0;
      h.noAA = true;   // school rules: the fleet holds fire — these are the pilot's
      this.targets.push(h);
    }
    G.waypoint = this.targets[0].pos;
    G.radio('RANGE CONTROL: THE RANGE IS HOT, VIPER — TWO HULKS ANCHORED WEST OF THE BOAT. SIX MARK 83S ON THE RACKS.');
    G.radio('RANGE CONTROL: KEY 5 FOR THE BOMBS. PIPPER ON THE HULL, PICKLE, PULL OUT HIGH. SPLASH BOTH AND COME HOME.');
    G.msg('SELECT MK 83 — KEY 5 · CCIP DOES THE MATH', 'info');
  },
  update(G, dt) {
    if (this.done) return;
    const alive = this.targets.filter(h => !h.dead);
    if (alive.length) {
      let best = alive[0], bd = 1e12;
      for (const h of alive) { const d = h.pos.distanceToSquared(G.player.pos); if (d < bd) { bd = d; best = h; } }
      G.waypoint = best.pos;
    } else {
      this.done = true;
      G.addScore(1500);
      G.completeMission('BOMBING PASSED', 'BOTH HULKS ON THE BOTTOM.\n\nThe strike ledger is yours, pilot.\n\nSCORE +1500');
    }
  },
},
// ------------------------------------------------ M1 VISUAL CONFIRMATION
{
  id: 'm1', num: 1, title: 'VISUAL CONFIRMATION', code: 'SEPTEMBER 6, 1994',
  time: 'day', planeChoice: true,
  brief: [
    'NORAD STRATEGIC COMMAND',
    'LOCATION: SAN FRANCISCO',
    'DATE: SEPTEMBER 6, 1994', '',
    'VISUAL CONFIRMATION OPERATION',
    'ALERT STATUS: UNKNOWN AIRCRAFT IN YOUR SECTOR',
    'INBOUND BOGEY CLOSING ON ENTERPRISE', '',
    '- CLEARANCE CONFIRMED -',
    'SCRAMBLE IMMEDIATELY',
    'INTERCEPT AIRCRAFT FOR AERIAL RECON',
    'CONFIRM IF FRIEND OR FOE',
    'AND RETURN TO BASE',
    'DO NOT ENGAGE UNLESS FIRED UPON',
    'REPEAT: DO NOT FIRE UNLESS FIRED UPON',
  ],
  briefing: 'Visual confirmation operation.',
  loadout: '2× AIM-9 SIDEWINDER · 4× AIM-120 AMRAAM · 500× 20MM',
  setup(G) {
    G.setPlayerStart({ runway: G.world.runwayById('sfo') });   // original F1 scrambles from SFO
    G.vectorText = 'YOUR VECTOR 290 FOR BOGEY';
    const hostile = Math.random() < 0.65;
    this.hostile = hostile;
    this.bogeys = [];
    const type = hostile ? 'mig29' : 'b707';
    for (let i = 0; i < 2; i++) {
      const b = G.spawnAI(type, {
        pos: V(-58000 - i * 3000, 6100 + i * 300, 18000 + i * 2500),
        heading: Math.PI / 2, speed: hostile ? 240 : 220, hp: 100,
        hostile: false, name: hostile ? 'MIG-29' : 'BOEING 707', label: 'BOGEY',
        mode: hostile ? 'route' : 'land', noEvade: !hostile, identified: false,
        waypoints: hostile ? [V(7000, 6100, 5000), V(60000, 6100, -5000)] :
          [V(2000, 1500, 20000), V(9000, 300, 20000), V(11300, 6, 20000)],
      });
      b.identified = false; b.kind = 'bandit'; b.firedFirst = false;
      this.bogeys.push(b);
    }
    this.idCount = 0; this.weaponsFree = false; this.phase = 0; this.timer = 0;
    G.waypoint = this.bogeys[0].pos;
    G.radio('NORAD: VIPER 1-1, SCRAMBLE! TWO BOGEYS INBOUND FROM THE WEST.');
  },
  update(G, dt) {
    this.timer += dt;
    // waypoint to nearest unidentified bogey
    let next = this.bogeys.find(b => !b.dead && !b.identified);
    G.waypoint = next ? next.pos : null;
    // tower vector call, like the original's "YOUR VECTOR nnn FOR BOGEY"
    if (next) {
      const h = Math.round((Math.atan2(next.pos.x - G.player.pos.x, -(next.pos.z - G.player.pos.z)) * 180 / Math.PI + 360) % 360 / 5) * 5;
      G.vectorText = `YOUR VECTOR ${String(h).padStart(3, '0')} FOR BOGEY`;
    } else G.vectorText = null;
    for (const b of this.bogeys) {
      if (!b.dead && !b.identified && near(G.player.pos, b.pos, 900)) {
        b.identified = true; b.label = b.name;
        this.idCount++;
        G.audio.radioClick();
        if (b.type === 'mig29') { G.msg('VISUAL ID: MIG-29 FULCRUM — HOSTILE!', 'bad'); G.radio('VIPER: TALLY HO! MIG-29s! DO NOT ENGAGE UNLESS FIRED UPON.'); }
        else { G.msg('VISUAL ID: BOEING 707 — FRIENDLY', 'good'); G.radio('NORAD: CONFIRMED FRIENDLY. STAND DOWN, VIPER 1-1.'); }
      }
    }
    // rules of engagement
    if (!this.weaponsFree && this.hostile) {
      for (const b of this.bogeys) {
        if (b.dead && !b.firedFirst) { G.failMission('COURT MARTIAL', 'You fired before being fired upon.\nThe rules of engagement were explicit.'); return; }
      }
      if (this.idCount >= 2 && this.timer > 0) {
        this.timer = -0.01; this.phase = 1;
      }
      if (this.phase === 1 && this.timer > 12) {
        this.weaponsFree = true;
        for (const b of this.bogeys) {
          if (b.dead) continue;
          b.mode = 'attack'; b.target = G.player; b.hostile = true; b.noEvade = false; b.firedFirst = true; b.skill = skillFor(PILOT_RATING.m1); b.agility = agilityFor(PILOT_RATING.m1); b.targetSpeed = 280;
        }
        G.msg('THEY\'RE FIRING! WEAPONS FREE!', 'bad');
        G.radio('NORAD: WEAPONS FREE! SPLASH THE MIGS!');
      }
    }
    // friendly case: just RTB
    if (!this.hostile && this.idCount >= 2) {
      if (!this.rtbCalled) { this.rtbCalled = true; G.radio('NORAD: GOOD EYES. RETURN TO THE ENTERPRISE.'); G.waypoint = G.world.carrier.pos; }
      if (G.trappedThisSortie || G.landedThisSortie) {
        G.addScore(1500);
        G.completeMission('MISSION COMPLETE', 'Both bogeys identified as friendly.\nFalse alarm — but you were ready.\n\nSCORE +1500');
      }
    }
    if (this.weaponsFree) {
      const allDown = this.bogeys.every(b => b.dead);
      if (allDown) {
        G.addScore(2000);
        G.completeMission('MISSION COMPLETE', 'Both MiG-29s splashed.\nSan Francisco sleeps safe tonight.\n\nSCORE +2000 + KILL BONUSES');
      }
    }
  },
},
// ------------------------------------------------ M2 AIR FORCE ONE
{
  id: 'm2', num: 2, title: 'EMERGENCY DEFENSE', code: 'SEPT 3, 1994 — 0915 HRS',
  time: 'day', planeChoice: true,
  brief: [
    'EMERGENCY DEFENSE STATUS:', '',
    'WE HAVE HOSTILE AIRCRAFT IN YOUR SECTOR',
    'AIR FORCE ONE CURRENTLY ON COURSE TO SFO',
    'INBOUND BOGEY CLOSING ON AIR FORCE ONE',
    'AT 630 KNOTS', '',
    'SCRAMBLE IMMEDIATELY',
    'INTERCEPT AND DESTROY ATTACKING AIRCRAFT.',
    'REPEAT: THIS IS A TKO, ENGAGE AND TERMINATE',
  ],
  briefing: 'Emergency defense.',
  loadout: '2× AIM-9 · 4× AIM-120 · 500× 20MM — HOT SCRAMBLE',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    this.af1 = G.spawnAI('b747', {
      pos: V(-52000, 4200, 4000), heading: Math.PI / 2 + 0.35, speed: 220, hp: 750,
      name: 'AIR FORCE ONE', label: 'AF1', mode: 'land', noEvade: true,
      waypoints: [V(2000, 1500, 20000), V(9000, 300, 20000), V(11300, 6, 20000)],
    });
    this.af1.kind = 'af1';
    this.af1.onEvent = (ev) => { if (ev === 'landed') this.af1Down = true; };
    this.migs = [];
    for (let i = 0; i < 2; i++) {
      const m = G.spawnAI('mig29', {
        pos: V(-40000, 5000 + i * 800, -6000 + i * 6000), heading: Math.PI * 0.6, speed: 280,
        hostile: true, name: 'MIG-29', label: 'MIG-29', mode: 'attack', skill: skillFor(PILOT_RATING.m2), agility: agilityFor(PILOT_RATING.m2),
      });
      m.target = this.af1; m.kind = 'bandit'; m.identified = true; m.fireCooldown = 12 + i * 8;
      this.migs.push(m);
    }
    this.warned = false; this.damaged = false; this.af1Down = false; this.cleared = false;
    G.waypoint = this.migs[0].pos;
    G.radio('NORAD: VIPER 1-1, AIR FORCE ONE IS UNDER ATTACK! SCRAMBLE, SCRAMBLE, SCRAMBLE!');
  },
  update(G, dt) {
    G.waypoint = this.migs.find(m => !m.dead)?.pos || this.af1.pos;
    if (this.af1.dead) {
      G.failMission('THE PRESIDENT IS DOWN', 'AIR FORCE ONE HAS BEEN DESTROYED.\n\nGOOD THING THIS IS ONLY A SIMULATION!');
      return;
    }
    // original mid-mission update
    if (!this.damaged && this.af1.hp < 700) {
      this.damaged = true;
      G.msg('AIR FORCE ONE DAMAGED BY MISSILE', 'bad');
      G.radio('AIR FORCE ONE: WE\'RE HIT! ATTEMPTING EMERGENCY LANDING AT SFO!');
      G.radio('NORAD: ESCORT AIRCRAFT HAS BEEN DESTROYED. VIPER, YOU\'RE ALL THEY HAVE.');
    }
    if (!this.warned && this.migs.some(m => m.dead)) { this.warned = true; G.radio('AIR FORCE ONE: WE SEE THE SPLASH! KEEP THEM OFF US!'); }
    if (!this.cleared && this.migs.every(m => m.dead)) {
      this.cleared = true;
      G.msg('HOSTILES DOWN — COVER AF1 TO TOUCHDOWN', 'good');
      G.radio('NORAD: AIRSPACE CLEAR. AIR FORCE ONE IS ON FINAL FOR SFO.');
    }
    if (this.cleared && this.af1Down) {
      G.addScore(2500);
      G.completeMission('MISSION COMPLETE', 'AIR FORCE ONE HAS SAFELY LANDED AT\nSAN FRANCISCO INTERNATIONAL.\nTHE PRESIDENT IS UNHARMED.\n\nWELL DONE!\n\nSCORE +2500 + KILL BONUSES');
    }
  },
},
// ------------------------------------------------ M3 STOLEN F-16S
{
  id: 'm3', num: 3, title: 'STOLEN AIRCRAFT', code: 'SEPT 6, 1994 — 1400 HRS',
  time: 'day', planeChoice: true,
  brief: [
    'STOLEN AIRCRAFT', '',
    'TWO AMERICAN F-16 TEST AIRCRAFT HAVE BEEN',
    'STOLEN FROM MOFFETT FIELD BY TERRORISTS',
    'CURRENTLY ON COURSE TOWARD SOVIET UNION',
    'THEY HAVE AIR SUPPORT: PAIR OF MIGS', '',
    'INTERCEPT STOLEN AIRCRAFT AND ATTEMPT TO',
    'FORCE THEIR RETURN WITHOUT CONFLICT',
    'CLOSE TO 0.7 NM TO MAKE THE RADIO CHALLENGE.', '',
    'F-16S EQUIPPED WITH TOP SECRET ECM SYSTEMS',
    'SAFE RETURN OF HARDWARE IS TOP PRIORITY',
  ],
  briefing: 'Stolen aircraft.',
  loadout: '2× AIM-9 · 4× AIM-120 · 500× 20MM',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    this.f16s = []; this.migs = [];
    for (let i = 0; i < 2; i++) {
      const f = G.spawnAI('f16', {
        pos: V(26000 + i * 1500, 5200 + i * 400, 3000 + i * 1800), heading: -Math.PI / 2, speed: 265,
        hostile: false, name: 'STOLEN F-16', label: 'F-16 ?', mode: 'route', noEvade: true, skill: skillFor(PILOT_RATING.m3),
        waypoints: [V(-120000, 5200, -8000)],
      });
      f.kind = 'stolen'; f.contacted = false; f.refused = false;
      this.f16s.push(f);
    }
    for (let i = 0; i < 2; i++) {
      const m = G.spawnAI('mig29', {
        pos: V(22000, 8000 + i * 600, 6000 - i * 4000), heading: -Math.PI / 2, speed: 265,
        hostile: false, name: 'MIG-29', label: 'MIG-29', mode: 'route', skill: skillFor(PILOT_RATING.m3), agility: agilityFor(PILOT_RATING.m3),
        waypoints: [V(-120000, 8000, -8000)], noEvade: true,
      });
      m.kind = 'bandit'; m.identified = true;
      this.migs.push(m);
    }
    this.contacted = 0; this.weaponsFree = false; this.escTimer = 120;
    G.waypoint = this.f16s[0].pos;
    G.radio('NORAD: STOP THOSE F-16s BEFORE THEY CLEAR THE COAST.');
  },
  update(G, dt) {
    for (const f of this.f16s) {
      if (f.dead || f.contacted) continue;
      if (near(G.player.pos, f.pos, 1300)) {
        f.contacted = true; this.contacted++;
        G.audio.radioClick();
        G.radio('VIPER: RENEGADE FLIGHT, TURN BACK TO MOFFETT IMMEDIATELY.');
        setTimeout(() => { if (!G.over) { G.radio('RENEGADE: NEGATIVE. WE\'RE NOT GOING BACK.'); G.msg('THEY REFUSE TO TURN', 'bad'); } }, 3500);
      }
      // escaped?
      if (f.pos.x < -85000) { G.failMission('THEY ESCAPED', 'STOLEN AIRCRAFT ARE NOW BEYOND RECOVERY RANGE.\n\nThe secret ECM hardware is lost.'); return; }
    }
    if (!this.weaponsFree && (this.contacted >= 2 || (this.contacted > 0 && this.f16s.some(f => f.pos.x < -60000)))) {
      this.weaponsFree = true;
      G.msg('WEAPONS FREE — DOWN THE F-16s!', 'bad');
      G.radio('NORAD: WEAPONS FREE. THEY MADE THEIR CHOICE.');
      for (const f of this.f16s) { f.noEvade = false; f.hostile = true; f.targetSpeed = 300; f.label = 'RENEGADE'; }
      for (const m of this.migs) { m.mode = 'attack'; m.target = G.player; m.hostile = true; m.noEvade = false; }
    }
    if (this.weaponsFree && this.f16s.every(f => f.dead)) {
      G.addScore(2500);
      G.completeMission('MISSION COMPLETE', 'The stolen F-16s are at the bottom of the Pacific.\nThe ECM secrets are safe.\n\nSCORE +2500 + KILL BONUSES');
    }
  },
},
// ------------------------------------------------ M4 SEARCH AND RESCUE
{
  id: 'm4', num: 4, title: 'SEARCH AND RESCUE', code: 'SEPT 9, 1994 — 1930 HRS',
  time: 'dusk', planeChoice: true,
  brief: [
    'RESCUE OPERATION:', '',
    'WE HAVE MULTIPLE BOGEYS AT 25 MILES',
    '480 KNOTS CLOSURE', '',
    'ONE OF OUR PILOTS HAS BEEN HIT AND DOWNED',
    'BAILED OUT NEAR THE FARALLON ISLANDS', '',
    'SCRAMBLE IMMEDIATELY FOR RESCUE OPERATION',
    '- WARNING: TENSION IS HIGH -',
    'ENGAGE BANDITS IF NECESSARY',
    'THEN SEARCH FOR DOWNED PILOT',
    'AND DEPLOY EMERGENCY RESCUE POD AT SITE', '',
    'POD DROP: BELOW 1,500 FT, WITHIN 0.7 NM — SHIFT+P',
    'YOU CARRY THREE PODS. HE MARKS WITH ORANGE SMOKE.', '',
    '- WARNING: DOWNED PILOT HAS LIMITED TIME -',
  ],
  briefing: 'Rescue operation.',
  loadout: '2× AIM-9 · 4× AIM-120 · 500× 20MM · 3× RESCUE PODS',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    this.raftPos = V(-45800, 1, 3900);
    this.raft = G.spawnAI('raft', { pos: this.raftPos.clone(), speed: 0, name: 'PILOT RAFT', label: 'RAFT', mode: 'straight', noEvade: true, hp: 9999, surface: true });
    this.raft.kind = 'raft';
    this.raft.targetSpeed = 0; this.raft.speed = 0;
    this.migs = [];
    for (let i = 0; i < 2; i++) {
      const m = G.spawnAI('mig29', {
        pos: V(-46000 + i * 6000, 2200 + i * 900, 3900 - i * 5000), heading: rand(0, 6), speed: 230,
        hostile: false, name: 'MIG-29', label: 'MIG-29', mode: 'orbit', skill: skillFor(PILOT_RATING.m4), agility: agilityFor(PILOT_RATING.m4),
      });
      m.orbitCenter = V(-46000, 2200 + i * 900, 3900); m.orbitRadius = 9000 + i * 4000;
      m.kind = 'bandit'; m.identified = true;
      this.migs.push(m);
    }
    this.pods = 3; this.hostileNow = false; this.smokeT = 0; this.podDropped = false;
    this.pilotT = 480; this.warned4 = false; this.warned1 = false;   // downed pilot has limited time
    G.waypoint = this.raftPos;
    G.radio('RESCUE COORD: PILOT IS ALIVE AND SIGNALING. WATCH FOR MIGS.');
  },
  update(G, dt) {
    // orange smoke marker
    this.smokeT -= dt;
    if (this.smokeT <= 0 && !this.podDropped) { this.smokeT = 0.25; G.fx.smoke(this.raftPos.clone().add(V(0, 2, 0)), 2.5, 4, 0xff6a20); }
    G.waypoint = this.raftPos;
    // limited time
    if (!this.podDropped) {
      this.pilotT -= dt;
      if (!this.warned4 && this.pilotT < 240) { this.warned4 = true; G.msg('PILOT FADING — 4 MINUTES LEFT', 'warn'); G.radio('RESCUE COORD: HE\'S GOING INTO SHOCK. STEP ON IT, VIPER.'); }
      if (!this.warned1 && this.pilotT < 60) { this.warned1 = true; G.msg('ONE MINUTE TO SAVE THE PILOT', 'bad'); }
      if (this.pilotT <= 0) { G.failMission('TOO LATE', 'THE DOWNED PILOT WAS LOST AT SEA\nBEFORE THE POD REACHED HIM.'); return; }
    }
    // migs go hostile if player closes or fires
    if (!this.hostileNow && (G.player.pos.distanceTo(this.raftPos) < 16000 || G.shotsFired > 0)) {
      this.hostileNow = true;
      for (const m of this.migs) { m.mode = 'attack'; m.target = G.player; m.hostile = true; }
      G.radio('RESCUE COORD: MIGS ARE COMING TO YOU — FIGHT OR RUN THE DROP LOW!');
    }
    // pod drop
    if (G.podDropRequested) {
      G.podDropRequested = false;
      const altOk = G.player.altFt < 1500;
      const distOk = near(G.player.pos, this.raftPos, 1300);
      if (altOk && distOk && !this.podDropped) {
        this.podDropped = true;
        G.audio.podDrop();
        G.fx.splash(this.raftPos.clone(), 1.2);
        G.msg('POD AWAY — PILOT SECURED!', 'good');
        G.radio('RESCUE COORD: HE\'S GOT THE POD! PICKUP EN ROUTE. RTB, VIPER.');
        G.addScore(1500);
        setTimeout(() => { if (!G.over) G.completeMission('MISSION COMPLETE', 'EMERGENCY RESCUE POD DEPLOYED CLOSE ENOUGH.\nTHE PILOT WILL BE RECOVERED.\n\nWELL DONE!\n\nSCORE +1500 + KILL BONUSES'); }, 5000);
      } else {
        this.pods--;
        G.audio.podDrop();
        if (this.pods <= 0) { G.failMission('PODS EXPENDED', 'All three rescue pods missed the raft.\nThe pilot remains in the sea.'); return; }
        G.msg(`POD MISSED — ${altOk ? 'TOO FAR' : 'TOO HIGH'} (${this.pods} LEFT)`, 'warn');
      }
    }
  },
},
// ------------------------------------------------ M5 CRUISE MISSILE
{
  id: 'm5', num: 5, title: 'CRUISE MISSILE INBOUND', code: 'SEPT 12, 1994 — 0510 HRS',
  time: 'morning', planeChoice: true,
  brief: [
    'ALERT: NORAD HAS ENTERED DEFCON 3', '',
    'INCOMING CRUISE MISSILE',
    'BEARING 170 AT 30 MILES',
    '680 KNOTS CLOSURE', '',
    'ETA DELIVERY AT MOFFETT FIELD: 4 MINUTES', '',
    'SCRAMBLE IMMEDIATELY',
    'INTERCEPT AND DESTROY THE CRUISE MISSILE',
    'BEFORE IT REACHES MOFFETT FIELD', '',
    'IT FLIES AT 200 FT, TERRAIN-FOLLOWING.',
    'USE AMRAAMS HEAD-ON OR GET BEHIND IT WITH THE GUN.',
  ],
  briefing: 'Cruise missile inbound.',
  loadout: '2× AIM-9 · 4× AIM-120 · 500× 20MM — HOT SCRAMBLE',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    this.moffett = V(10000, 70, 34000);
    // 505 kts at 200 ft, 33 NM out — a four-minute problem, not the brief's
    // old nine-minute fairy tale (the geometry never matched the text)
    this.cm = G.spawnAI('cruise', {
      pos: V(17500, 70, 95000), heading: Math.atan2(this.moffett.x - 17500, -(this.moffett.z - 95000)), speed: 260,
      name: 'CRUISE MISSILE', label: 'CRUISE MSL', mode: 'straight', noEvade: true, hp: 60,
      terrainFollow: true, hostile: true,
    });
    this.cm.kind = 'bandit'; this.cm.identified = true;
    this.warnT = 0; this.t = 0; this.defcon2 = false; this.migs = [];
    G.waypoint = this.cm.pos;
    G.radio('NORAD: VIPER 1-1, CRUISE MISSILE INBOUND! FULL BURNER — GO!');
  },
  update(G, dt) {
    this.t += dt;
    if (this.cm.dead) {
      G.addScore(3000);
      G.completeMission('MISSION COMPLETE', 'CRUISE MISSILE DESTROYED SHORT OF MOFFETT FIELD.\n\nWELL DONE!\n\nSCORE +3000');
      return;
    }
    G.waypoint = this.cm.pos;
    // original mid-mission escalation
    if (!this.defcon2 && this.t > 45) {
      this.defcon2 = true;
      G.msg('NORAD HAS ENTERED DEFCON 2', 'bad');
      G.radio('NORAD: MULTIPLE BANDITS PROVIDING AIR SUPPORT FOR THE MISSILE.');
      for (let i = 0; i < 2; i++) {
        const m = G.spawnAI('mig29', {
          pos: this.cm.pos.clone().add(V(-1500 - i * 800, 800 + i * 400, 1200 + i * 900)),
          heading: Math.PI, speed: 280, hostile: true, name: 'MIG-29', label: 'MIG-29',
          mode: 'attack', skill: skillFor(PILOT_RATING.m5), agility: agilityFor(PILOT_RATING.m5),
        });
        m.target = G.player; m.kind = 'bandit'; m.identified = true;
        this.migs.push(m);
      }
      G.msg('BANDITS LAUNCHING — THEY\'RE DEFENDING THE MISSILE', 'warn');
    }
    const d = this.cm.pos.distanceTo(this.moffett);
    this.warnT -= dt;
    if (this.warnT <= 0) { this.warnT = 10; G.msg(`MISSILE ${(d / 1852).toFixed(0)} NM FROM MOFFETT FIELD`, 'warn'); }
    if (d < 2600) {
      G.explode(this.cm.pos, 3);
      G.failMission('MOFFETT FIELD DESTROYED', 'ENEMY CRUISE MISSILE HAS EXPLODED NORTH OF MOFFETT FIELD.\nNUCLEAR DESTRUCTION WIDESPREAD.\n\nGOOD THING THIS IS ONLY A SIMULATION!');
    }
  },
},
// ------------------------------------------------ M6 CARRIER SUB
{
  id: 'm6', num: 6, title: 'SHADOW SUB', code: 'SEPT 15, 1994 — 1745 HRS',
  time: 'dusk', planeChoice: true,
  brief: [
    'SHADOW SUB DETECTION:', '',
    'C-19 INTELLIGENCE REPORTS:',
    'SUBMERSIBLE AIRCRAFT CARRIER',
    'POINT OF ORIGIN OF ALL ENEMY AIRCRAFT', '',
    'SCRAMBLE AND INTERCEPT SHADOW SUB',
    '- FLY IN BELOW 100 FT TO AVOID RADAR -',
    'DESTROY SUB WHILE NOW SURFACED',
  ],
  briefing: 'Shadow sub.',
  loadout: '2× AIM-9 · 4× AIM-120 · 500× 20MM — LAND TO REARM ANYTIME',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    const sp = G.world.enemySub.pos;   // 60 mi west of the Golden Gate
    this.sub = G.spawnAI('sub', {
      pos: V(sp.x, 0, sp.z), heading: Math.PI / 2, speed: 0, hp: 500,
      name: 'SHADOW SUB', label: 'SHADOW SUB', mode: 'straight', noEvade: true,
      hostile: true, surface: true,
    });
    this.sub.kind = 'bandit'; this.sub.identified = true; this.sub.targetSpeed = 0;
    this.migs = []; this.detectT = 0; this.diveT = -1; this.migLaunched = false; this.done = false;
    G.waypoint = this.sub.pos;
    G.radio('FLEET COM: SHADOW SUB IS SURFACED AND LAUNCHING AIRCRAFT. STAY BELOW 100 FT ON THE RUN-IN.');
  },
  update(G, dt) {
    if (this.sub.dead) {
      if (!this.done) {
        this.done = true;
        G.addScore(4000);
        G.radio('FLEET COM: DIRECT HITS! THE SHADOW SUB IS GOING DOWN!');
        setTimeout(() => {
          if (!G.over) G.completeMission('MISSION COMPLETE', 'THE SHADOW SUB IS SUNK.\nTHE SOURCE OF ALL ENEMY AIRCRAFT IS DESTROYED.\n\nWELL DONE!\n\nSCORE +4000 + KILL BONUSES');
        }, 6000);
      }
      return;
    }
    G.waypoint = this.sub.pos;
    const dist = G.player.pos.distanceTo(this.sub.pos);
    // sub radar: detect the player high inside 25 km — it will dive and escape
    if (dist < 25000 && G.player.altFt > 100 && !G.player.onGround) {
      this.detectT += dt;
      if (this.detectT > 1.5 && !this.spotted) {
        this.spotted = true;
        G.msg('SPOTTED BY SUB RADAR — GET BELOW 100 FT!', 'bad');
        G.radio('FLEET COM: THEY\'VE MADE YOU! GET LOW OR SHE\'LL DIVE!');
      }
      if (this.detectT > 6) {
        G.failMission('THE SUB ESCAPED', 'THE SHADOW SUB HAS SUBMERGED AND ESCAPED.\nYOU MUST MAKE YOUR RUN-IN BELOW 100 FT.');
        return;
      }
    } else if (this.spotted) {
      this.detectT = Math.max(1.2, this.detectT - dt * 2);
    }
    // first hit → crash-dive countdown
    if (this.sub.hp < 500 && this.diveT < 0) {
      this.diveT = 25;
      G.msg('THE SUB IS PREPARING TO DIVE!', 'warn');
      G.radio('FLEET COM: SHE\'S CRASH-DIVING — FINISH HER IN 25 SECONDS!');
    }
    if (this.diveT > 0) {
      this.diveT -= dt;
      if (this.diveT <= 0) {
        G.failMission('THE SUB ESCAPED', 'THE SHADOW SUB SUBMERGED BEFORE YOU\nCOULD FINISH IT OFF.');
        return;
      }
    }
    // defensive fighter launches
    if (!this.migLaunched && (dist < 18000 || this.sub.hp < 500)) {
      this.migLaunched = true;
      for (let i = 0; i < 2; i++) {
        const m = G.spawnAI('mig29', {
          pos: this.sub.pos.clone().add(V(rand(-40, 40), 60, rand(-40, 40))),
          heading: Math.atan2(G.player.pos.x - this.sub.pos.x, -(G.player.pos.z - this.sub.pos.z)),
          speed: 240, hostile: true, name: 'MIG-29', label: 'MIG-29', mode: 'attack',
          skill: skillFor(PILOT_RATING.m6), agility: agilityFor(PILOT_RATING.m6),
        });
        m.target = G.player; m.kind = 'bandit'; m.identified = true;
        this.migs.push(m);
      }
      G.msg('FIGHTERS LAUNCHING FROM THE SUB!', 'warn');
      G.audio.radioClick();
    }
  },
},
// ------------------------------------------------ M7 THE DEFECTOR
{
  id: 'm7', num: 7, title: 'THE DEFECTOR', code: 'SEPT 13, 1994 — 2310 HRS',
  time: 'night', planeChoice: true,
  brief: [
    'NORAD STRATEGIC COMMAND',
    'LOCATION: SAN FRANCISCO',
    'DATE: SEPTEMBER 13, 1994 — 2310 HRS', '',
    'OPERATION SPARROW', '',
    'AT 2200 HRS A CHARTERED PACIFIC EMPRESS DC-10',
    'DEPARTED SHEMYA AFB FOR SAN FRANCISCO.', '',
    'ABOARD: DR. YURI KORSHAKOV, SENIOR DESIGNER',
    'OF THE SHTORM-7 HYPERSONIC WEAPON PROGRAM.',
    'HE IS DEFECTING. THE PLANS ARE IN HIS BRIEFCASE.', '',
    'THE SHADOW SUB HAS LAUNCHED MIG-29S TO',
    'SPLASH THE AIRLINER BEFORE IT LANDS.', '',
    'ESCORT SPARROW TO A SAFE LANDING AT SFO.',
    'THE PASSENGER MUST SURVIVE.', '',
    'NOTE: CIVILIAN TRAFFIC IS IN THE PATTERN.',
    'CHECK YOUR TARGETS BEFORE YOU FIRE.',
  ],
  briefing: 'Escort the defector airliner to SFO.',
  loadout: '2× AIM-9 · 4× AIM-120 · 500× 20MM — NIGHT INTERCEPT',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    // the defector flight: a chartered Pacific Empress DC-10 (livery 3),
    // straight in over the Golden Gate for runway 10L
    this.sparrow = G.spawnAI('dc10', {
      pos: V(-42000, 4800, 17000), heading: Math.PI / 2 + 0.12, speed: 210, hp: 500,
      name: 'PACIFIC EMPRESS 77', label: 'SPARROW', livery: 3,
      mode: 'land', noEvade: true,
      waypoints: [
        V(-8000, 1500, 19000),    // abeam the Golden Gate
        V(4000, 700, 19300),      // over the city, long final
        V(12003, 6, 19652),       // touchdown on 10L
      ],
    });
    this.sparrow.kind = 'airliner'; this.sparrow.identified = true; this.sparrow.souls = 96;
    this.sparrow.onEvent = (ev) => { if (ev === 'landed') this.sparrowDown = true; };
    // first pair of Fulcrums off the shadow sub, 60 mi west of the Gate
    const sp = G.world.enemySub.pos;
    this.migs = [];
    this._launchWave = (base, cd) => {
      for (let i = 0; i < 2; i++) {
        const m = G.spawnAI('mig29', {
          pos: V(sp.x + 3000 + i * 2500, 800 + i * 600, sp.z + base + i * 5000), heading: Math.PI / 2, speed: 300,
          hostile: true, name: 'MIG-29', label: 'MIG-29', mode: 'attack',
          skill: skillFor(PILOT_RATING.m7), agility: agilityFor(PILOT_RATING.m7),
        });
        m.target = this.sparrow; m.kind = 'bandit'; m.identified = true;
        m.fireCooldown = cd + i * 9;
        this.migs.push(m);
      }
    };
    this._launchWave(0, 20);
    this.wave2 = false; this.sparrowDown = false; this.hitWarned = false; this.firstSplash = false;
    G.waypoint = this.sparrow.pos;
    G.radio('FLEET COM: VIPER 1-1, OPERATION SPARROW IS GO. A CHARTERED DC-10 IS INBOUND FROM THE PACIFIC CARRYING A DEFECTOR WITH THE SHTORM PLANS.');
    G.radio('FLEET COM: THE SHADOW SUB HAS FULCRUMS IN THE AIR TASKED TO SPLASH HER. GET BETWEEN THEM AND THE AIRLINER.');
  },
  update(G, dt) {
    G.waypoint = this.migs.find(m => !m.dead)?.pos || this.sparrow.pos;
    if (this.sparrow.dead) {
      G.failMission('THE SPARROW IS DOWN',
        'THE DEFECTOR\'S DC-10 IS IN THE SEA.\nTHE SHTORM PLANS AND DR. KORSHAKOV ARE LOST FOREVER.\n\nTHE SUB\'S WOLFPACK IS LAUGHING AT US.');
      return;
    }
    if (!this.firstSplash && this.migs.some(m => m.dead)) {
      this.firstSplash = true;
      G.radio('SPARROW: WE SEE THE FIREBALL! KEEP THEM OFF US, VIPER!');
    }
    if (!this.hitWarned && this.sparrow.hp < 480) {
      this.hitWarned = true;
      G.msg('SPARROW IS HIT', 'bad');
      G.radio('SPARROW: WE\'RE HIT! NUMBER TWO ENGINE IS WINDMILLING — VIPER, WE NEED YOU NOW!');
    }
    // second wolfpack launches as the airliner nears the Gate
    if (!this.wave2 && (this.migs.every(m => m.dead) || this.sparrow.pos.x > -20000)) {
      this.wave2 = true;
      this._launchWave(4000, 16);
      G.msg('SECOND WAVE — MORE FULCRUMS OFF THE SUB!', 'warn');
      G.radio('FLEET COM: SECOND WAVE! TWO MORE FULCRUMS OFF THE SUB — THEY ARE DESPERATE NOW.');
    }
    if (this.sparrowDown) {
      for (const m of this.migs) if (!m.dead) { m.mode = 'route'; m.target = null; m.waypoints = [V(-120000, 9000, -8000)]; }
      G.addScore(3000);
      G.completeMission('MISSION COMPLETE',
        'PACIFIC EMPRESS 77 IS ON THE GROUND AT SFO.\nDR. KORSHAKOV AND THE SHTORM PLANS ARE IN\nFRIENDLY HANDS.\n\nTHE SUB LAUNCHED EVERYTHING IT HAD.\nIT WASN\'T ENOUGH.\n\nSCORE +3000 + KILL BONUSES');
    }
  },
},
// ------------------------------------------------ M8 THE SPY BALLOON
{
  id: 'm8', num: 8, title: 'THE SPY BALLOON', code: 'FEBRUARY 4, 2023 — 1439 HRS',
  time: 'day', planeChoice: true,
  brief: [
    'NORAD STRATEGIC COMMAND — FLASH TRAFFIC', '',
    'A HIGH-ALTITUDE SURVEILLANCE BALLOON HAS',
    'CROSSED THE COAST AND IS DRIFTING OVER',
    'THE BAY AT 34,000 FEET.', '',
    'IT IS NOT CHINESE. IT IS NOT A WEATHER',
    'BALLOON. IT IS LISTENING.', '',
    'SCRAMBLE AND CLIMB TO ANGELS 34.',
    'DESTROY THE BALLOON.', '',
    'IT IS UNARMED, UNMANNED, AND IN NO HURRY.',
    'AN EASY KILL — IF YOU CAN CLIMB TO IT.', '',
    'FULL BURNER IN THE CLIMB. WATCH THE STALL',
    'UP HIGH: THE AIR GETS THIN AT ANGELS 34.',
  ],
  briefing: 'Shoot down the spy balloon.',
  loadout: '2× AIM-9 · 4× AIM-120 · 500× 20MM',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    this.balloon = G.spawnAI('balloon', {
      pos: V(-26000, 10500, 9000), heading: Math.PI / 2 + 0.15, speed: 18, hp: 30,
      name: 'SURVEILLANCE BALLOON', label: 'BALLOON', mode: 'straight', noEvade: true,
      hostile: true,
    });
    this.balloon.kind = 'bandit'; this.balloon.identified = true;
    this.balloon.noAA = true;   // the escorts hold fire — this one is the pilot's balloon
    this.phase = 0; this.t = 0;
    G.waypoint = this.balloon.pos;
    G.radio('NORAD: VIPER 1-1, THE BALLOON IS OVER THE COAST AT ANGELS 34. GO UP AND GET IT.');
  },
  update(G, dt) {
    this.t += dt;
    if (this.balloon.dead) {
      if (this.phase < 90) {
        this.phase = 90;
        G.msg('BALLOON DOWN — PAYLOAD IN THE SEA', 'good');
        G.radio('NORAD: SPLASH ONE BALLOON! RECOVERY BOATS ARE EN ROUTE TO THE PAYLOAD. COME ON HOME, VIPER.');
        G.waypoint = G.world.carrier.pos;
      }
      if (G.trappedThisSortie || G.landedThisSortie) {
        G.addScore(2500);
        G.completeMission('MISSION COMPLETE', 'ONE SURVEILLANCE BALLOON, SPLASHED AT ANGELS 34.\nTHE PAYLOAD IS IN FRIENDLY HANDS.\n\nTHE PRESS WILL ARGUE ABOUT IT FOR WEEKS.\nYOU JUST DID YOUR JOB.\n\nSCORE +2500');
      }
      return;
    }
    G.waypoint = this.balloon.pos;
    // a gentle tutorial ladder — this is the first of the new campaign missions
    if (this.phase === 0 && !G.player.onGround) {
      this.phase = 1;
      G.radio('VIPER, CLIMB TO ANGELS 34 — THAT IS 34,000 FEET. FULL BURNER, NOSE UP.');
      G.msg('CLIMB TO 34,000 FT — FULL THROTTLE + AFTERBURNER (W)', 'info');
    }
    if (this.phase === 1 && G.player.altFt > 20000) {
      this.phase = 2;
      G.msg('ANGELS 20 — KEEP CLIMBING. THE AIR GETS THIN UP HERE', 'info');
      G.radio('NORAD: BALLOON AT YOUR 12 O\'CLOCK HIGH. WATCH YOUR STALL SPEED IN THE THIN AIR.');
    }
    if (this.phase === 2 && G.player.altFt > 31000) {
      this.phase = 3;
      G.msg('LOCK IT UP (T) — AN AMRAAM DOES THE REST', 'info');
      G.radio('NORAD: YOU ARE WEAPONS FREE. SPLASH THE BALLOON.');
    }
  },
},
// ------------------------------------------------ M9 NAVY ONE
{
  id: 'm9', num: 9, title: 'NAVY ONE', code: 'MARCH 12, 1995 — 1100 HRS',
  time: 'day', planeChoice: true,
  brief: [
    'FLEET COM — EYES ONLY', '',
    'THE WAR WITH IRAN IS OVER. THE PRESIDENT',
    'IS FLYING ABOARD THE ENTERPRISE TO SAY SO',
    'HIMSELF, ON DECK, IN FRONT OF THE BANNER.', '',
    'HE IS COMING IN AN S-3 VIKING, CALLSIGN',
    '"NAVY ONE", OUT OF MOFFETT FIELD.', '',
    'TEHRAN\'S LOYALISTS HAVE FULCRUMS AND',
    'FLANKERS IN THE AIR FOR ONE LAST SHOT',
    'AT HIM. THEY WOULD LOVE THE HEADLINE.', '',
    'ESCORT NAVY ONE TO THE BOAT.',
    'THE PRESIDENT MUST TRAP ABOARD ALIVE.', '',
    'NOTE THE BANNER ON THE ISLAND. IT HANGS',
    'FOR THIS DAY ONLY — MAKE IT TRUE.',
  ],
  briefing: 'Escort Navy One to the carrier.',
  loadout: '2× AIM-9 · 4× AIM-120 · 500× 20MM — PRESIDENTIAL ESCORT',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    // dress the island: the banner hangs furled until the President is aboard
    const c = G.world.carrier;
    const old = c.group.getObjectByName('m9banner'); if (old) c.group.remove(old);
    this.banner = buildBanner();
    this.banner.name = 'm9banner';
    // the island's bridge face, looking out over the flight deck — every
    // pilot on deck reads it, exactly like the Lincoln in '03.
    // Island box: x -37.5..-22.5, z -55..-25; the deck lies to +x.
    this.banner.position.set(-22.3, 32.5, -40);
    this.banner.rotation.y = Math.PI / 2;
    this.banner.scale.y = 0.02;                  // furled
    c.group.add(this.banner);
    this.navy1 = G.spawnAI('s3', {
      // staged off the steaming ship: 38 km out, wherever the group happens to be
      pos: c.pos.clone().add(V(36000, 1400, 19000)), heading: -0.9, speed: 150, hp: 400,
      name: 'S-3 VIKING', label: 'NAVY ONE', mode: 'route', noEvade: true,
      waypoints: [c.pos.clone().add(V(22000, 1200, 15000)), c.pos.clone().add(V(14000, 900, 7000)), c.pos.clone()],
    });
    this.navy1.kind = 'airliner'; this.navy1.identified = true; this.navy1.souls = 8;
    this.phase = 0; this.t = 0; this.trapped = false; this.trapT = 0;
    this.unfurlT = -1; this.unfurling = false; this.spoke = false;
    this.wave1 = false; this.wave2 = false;
    this.bandits = [];
    this._gate = new THREE.Vector3(); this._aim = new THREE.Vector3();
    G.waypoint = this.navy1.pos;
    G.radio('FLEET COM: NAVY ONE IS AIRBORNE OUT OF MOFFETT. RENDEZVOUS AND BRING HIM HOME.');
  },
  _wave(G, n, target1, target2, skill) {
    const base = this.navy1.pos;
    for (let i = 0; i < n; i++) {
      const type = i % 2 ? 'su27' : 'mig29';
      const b = G.spawnAI(type, {
        pos: base.clone().add(V(14000 + i * 3000, 1600 + i * 500, 9000 + i * 2500)),
        heading: -Math.PI / 2, speed: 290, hostile: true,
        name: type === 'su27' ? 'IRGC SU-27' : 'IRGC MIG-29', label: type === 'su27' ? 'IRGC SU-27' : 'IRGC MIG-29',
        mode: 'attack', skill, agility: 1.15,
      });
      b.target = i === 1 && target2 ? target2 : target1;
      b.kind = 'bandit'; b.identified = true; b.noAA = true; b.fireCooldown = rand(10, 15) + i * 6;
      this.bandits.push(b);
    }
  },
  update(G, dt) {
    this.t += dt;
    const c = G.world.carrier;
    if (this.navy1.dead) {
      G.failMission('THE PRESIDENT IS LOST', 'NAVY ONE IS IN THE SEA.\nTHERE WILL BE NO SPEECH, NO BANNER, NO END\nTO THIS WAR THAT ANYONE CAN SELL.\n\nTHE WHOLE WORLD SAW IT HAPPEN.');
      return;
    }
    // escort picture: bandits first, otherwise the Viking
    G.waypoint = this.bandits.find(b => !b.dead)?.pos || (this.trapped ? c.pos : this.navy1.pos);
    // the interceptors come for him — but the first wave sweeps the CAP,
    // which puts the fight on the player's terms with time to win it
    if (!this.wave1 && this.t > 40) {
      this.wave1 = true;
      this._wave(G, 2, G.player, G.wingman && G.wingman.ai, skillFor(PILOT_RATING.m9));
      G.msg('BANDITS SWEEPING FOR THE CAP!', 'bad');
      G.radio('NAVY ONE: WE HAVE COMPANY FORWARD OF US — VIPER, THEY ARE LOOKING FOR YOU. CLEAR US A PATH.');
    }
    if (!this.wave2 && this.navy1.pos.distanceTo(c.pos) < 24000) {
      this.wave2 = true;
      this._wave(G, 2, this.navy1, G.player, skillFor(Math.min(100, PILOT_RATING.m9 + 15)));
      G.msg('SECOND WAVE — FLANKERS, AND ONE WANTS YOU', 'warn');
      G.radio('FLEET COM: LAST CARD FROM TEHRAN — TWO MORE BOGEYS. DO NOT LET THEM THROUGH.');
    }
    // groove: glue the final waypoints to the moving boat
    if (!this.trapped) {
      carrierLocalToWorld(c, -20, 120, -1600, this._gate);
      carrierLocalToWorld(c, -6, 22, -85, this._aim);
      if (this.phase === 0) {
        // the marshalling point rides 12 km astern of the steaming ship
        this._far = this._far || new THREE.Vector3();
        carrierLocalToWorld(c, -20, 700, -12000, this._far);
        this.navy1.waypoints[2] = this._far;
      }
      if (this.phase === 0 && this.navy1.pos.distanceTo(this._gate) < 9000) {
        this.phase = 1;
        G.radio('TOWER: NAVY ONE, YOU ARE CLEARED INTO THE GROOVE. CALL THE BALL.');
        G.radio('NAVY ONE: NAVY ONE, VIKING BALL, 6.1 — THE PRESIDENT SENDS HIS REGARDS.');
      }
      if (this.phase <= 1) {
        this.navy1.waypoints = [this._gate, this._aim];
        this.navy1.wpIndex = Math.min(this.navy1.wpIndex, 0);
        if (this.navy1.pos.distanceTo(this._gate) < 2600) this.navy1.wpIndex = 1;
        this.navy1.targetSpeed = 82;
      }
      if (near(this.navy1.pos, this._aim, 300)) {
        this.trapped = true; this.trapT = 0;
        this.navy1.mode = 'straight'; this.navy1.heading = c.heading; this.navy1.pitch = 0;
        G.msg('NAVY ONE HAS TRAPPED ABOARD', 'good');
        G.radio('TOWER: NAVY ONE IS DOWN — CAUGHT THE 3-WIRE. THE PRESIDENT IS ABOARD, AND HE IS SMILING.');
        G.fx.splash(this._aim.clone().setY(1), 0.8);
        this.unfurlT = 3.0;
      }
    } else {
      // roll out with the deck and park behind the island
      this.trapT += dt;
      const lz = -85 + Math.min(48, this.trapT * 24);
      carrierLocalToWorld(c, -6 + Math.min(4, this.trapT * 0.8), 22, lz, this.navy1.pos);
      this.navy1.heading = c.heading; this.navy1.pitch = 0;
      this.navy1.speed = Math.max(0, 24 - this.trapT * 9);
      this.navy1.targetSpeed = this.navy1.speed;
      if (this.trapT > 2.5 && !this._wingsFolded) {
        this._wingsFolded = true;
        const ud = this.navy1.model.userData;
        if (ud.wingL) { ud.wingL.rotation.z = -1.85; ud.wingR.rotation.z = 1.85; }   // parked presidential style
      }
    }
    if (this.unfurlT > 0) {
      this.unfurlT -= dt;
      if (this.unfurlT <= 0) {
        this.unfurling = true;
        G.radio('ENTERPRISE: ALL HANDS TO THE FLIGHT DECK — THE PRESIDENT OF THE UNITED STATES.');
      }
    }
    if (this.unfurling) {
      this.banner.scale.y = Math.min(1, this.banner.scale.y + dt * 0.45);
      if (this.banner.scale.y >= 1 && !this.spoke) {
        this.spoke = true;
        G.radio('POTUS: MY FELLOW AMERICANS — THE WAR WITH IRAN IS OVER. MISSION ACCOMPLISHED.');
        G.msg('MISSION ACCOMPLISHED', 'good');
        setTimeout(() => {
          if (!G.over) {
            G.addScore(4000);
            G.completeMission('MISSION ACCOMPLISHED', 'THE PRESIDENT IS ABOARD, THE BANNER IS UP,\nAND THE WAR IS OVER ON EVENING NEWS\nFROM HERE TO TEHRAN.\n\nSCORE +4000 + KILL BONUSES');
          }
        }, 8000);
      }
    }
  },
},
// ------------------------------------------------ M10 THE LAST INTERCEPT
{
  id: 'm10', num: 10, title: 'THE LAST INTERCEPT', code: 'OCTOBER 2, 1994 — 0333 HRS',
  time: 'night', planeChoice: true,
  brief: [
    'ALERT: NORAD HAS ENTERED DEFCON 2', '',
    'A NUCLEAR-TIPPED CRUISE MISSILE IS IN THE',
    'AIR OVER THE PACIFIC, 800 KNOTS, STEADY',
    'FOR THE HEART OF SAN FRANCISCO.', '',
    'IF IT DETONATES, ONE MILLION PEOPLE DIE', '',
    'IT IS FAST. IT HAS ESCORTS WHO WANT YOU',
    'DEAD MORE THAN THEY WANT TO LIVE. THEY',
    'WILL MANEUVER, THEY WILL ROLL, AND THEY',
    'WILL NOT FLY STRAIGHT FOR A SECOND.', '', '',
    'YOUR WINGMAN TONIGHT FLIES THE CALLSIGN',
    '"EGARYTARIAS". TRUST HIS WING.', '',
    'INTERCEPT AND DESTROY THE MISSILE OVER',
    'OPEN WATER. NOTHING ELSE MATTERS.',
  ],
  briefing: 'Kill the nuclear cruise missile before the city.',
  loadout: '2× AIM-9 · 4× AIM-120 · 500× 20MM — DEFCON 2',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    if (G.wingman) G.wingman.callsign = 'EGARYTARIAS';
    this.city = V(-2000, 800, 19000);   // downtown, over the Bay
    this.cm = G.spawnAI('cruise', {
      pos: V(-68000, 2400, 4000),
      heading: Math.atan2(this.city.x + 68000, -(this.city.z - 4000)), speed: 400, hp: 80,
      name: 'KH-101', label: 'NUKE CRUISE MSL', mode: 'route', noEvade: true,
      hostile: true, waypoints: [this.city.clone()],
    });
    this.cm.kind = 'bandit'; this.cm.identified = true; this.cm.noAA = true;
    this.bandits = [];
    for (let i = 0; i < 3; i++) {
      const b = G.spawnAI('su27', {
        pos: this.cm.pos.clone().add(V(-3000 - i * 2200, 800 + i * 400, -2500 + i * 2600)),
        heading: Math.PI / 2, speed: 340, hostile: true, name: 'SU-27', label: 'SU-27',
        mode: 'attack', skill: skillFor(PILOT_RATING.m10), agility: agilityFor(PILOT_RATING.m10),
      });
      b.target = i === 2 && G.wingman ? (G.wingman.ai || G.player) : G.player;
      b.kind = 'bandit'; b.identified = true; b.noAA = true; b.fireCooldown = rand(8, 14) + i * 5;
      this.bandits.push(b);
    }
    this.warnT = 0; this.t = 0; this.chatter = 0;
    G.waypoint = this.cm.pos;
    G.radio('NORAD: VIPER 1-1, THE MISSILE IS EIGHT HUNDRED KNOTS FOR THE CITY. EVERYTHING YOU HAVE — GO.');
    setTimeout(() => { if (!G.over && G.wingman) G.radio('EGARYTARIAS: ON YOUR WING, LEAD. TONIGHT WE ARE THE ONLY THING BETWEEN THAT THING AND A MILLION PEOPLE.'); }, 9000);
  },
  update(G, dt) {
    this.t += dt;
    if (this.cm.dead) {
      G.addScore(5000);
      G.completeMission('MISSION COMPLETE',
        'THE MISSILE BROKE UP OVER OPEN WATER.\nTHE CORE SANK IN A THOUSAND FATHOMS,\nUNARMED. RECOVERY TEAMS ARE EN ROUTE.\n\nSAN FRANCISCO NEVER KNEW.\n\nSCORE +5000 + KILL BONUSES');
      return;
    }
    // hand the trailing Flanker to EGARYTARIAS once he is off the deck
    if (!this._wmAssigned && G.wingman && G.wingman.ai && this.bandits[2] && !this.bandits[2].dead) {
      this._wmAssigned = true;
      this.bandits[2].target = G.wingman.ai;
    }
    G.waypoint = this.cm.pos;
    const d = this.cm.pos.distanceTo(this.city);
    this.warnT -= dt;
    if (this.warnT <= 0) {
      this.warnT = 12;
      G.msg(`NUKE ${(d / 1852).toFixed(0)} NM FROM SAN FRANCISCO — ${Math.round(this.cm.speed * 1.94)} KNOTS`, 'warn');
    }
    this.chatter -= dt;
    if (this.chatter <= 0 && this.t > 20) {
      this.chatter = 26;
      const lines = [
        'EGARYTARIAS: HE WILL NOT TURN AND HE WILL NOT SLOW. PUT EVERYTHING INTO THE CHASE, LEAD.',
        'EGARYTARIAS: ESCORTS ON ME — KEEP YOUR EYES ON THE MISSILE, I WILL HOLD THEM.',
        'EGARYTARIAS: A MILLION PEOPLE ARE SLEEPING DOWN THERE. NOT TONIGHT. NOT ON OUR WATCH.',
      ];
      G.radio(lines[(Math.random() * lines.length) | 0]);
    }
    if (d < 3000) {
      G.explode(this.cm.pos, 6);
      G.failMission('ONE MILLION SOULS',
        'THE MISSILE DETONATED OVER THE HEART OF THE CITY.\n\nTHERE IS NO SCORE. THERE IS NO DEBRIEF.\nTHERE IS ONLY THE LIGHT.');
    }
  },
},
// ------------------------------------------------ M11 CRUISE SHIP SIEGE
{
  id: 'm11', num: 11, title: 'CRUISE SHIP SIEGE', code: 'OCTOBER 9, 1994 — 1510 HRS',
  time: 'dusk', planeChoice: true,
  brief: [
    'FLEET COM — FLASH TRAFFIC', '',
    'TERRORISTS HAVE SEIZED THE CRUISE SHIP',
    '"BAY MONARCH" IN THE MIDDLE OF THE BAY.',
    'TWO HUNDRED AND TWENTY HOSTAGES ABOARD.', '',
    'A SEAHAWK WITH A SEAL TEAM IS GOING IN',
    'TO STORM THE SHIP. YOU AND YOUR WINGMAN',
    'FLY TOP COVER.', '',
    'THE DECK IS COVERED IN MANPADS — IF YOU',
    'ARE LOW AND SLOW NEAR THE SHIP, YOU ARE',
    'A TARGET. SO IS THE SEAHAWK.', '',
    'GO-FAST BOATS ARE RACING IN WITH', '',
    'REINFORCEMENTS. SINK THEM BEFORE THEY',
    'REACH THE SHIP — THE GUN IS YOUR FRIEND.', '',
    'PROTECT THE SEAHAWK UNTIL THE SEALS',
    'ARE DOWN ON DECK.',
  ],
  briefing: 'Top cover for the SEAL boarding.',
  loadout: '2× AIM-9 · 4× AIM-120 · 500× 20MM — BRING THE GUN',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    this.ship = G.world.ships.all.find(v => v.name === 'MS BAY MONARCH');
    if (this.ship) this.ship._held = true;   // engines seized, dead in the water
    const sp = this.ship ? this.ship.pos : V(5000, 0, -1000);
    this.t = 0; this.boats = []; this.boatWave1 = false; this.boatWave2 = false; this.dropDone = false;
    this.padT = 6; this.padsLeft = 8; this.hoverT = -1; this.sealHome = false;
    // the SEAL bird staged from the coast guard pad — find her a wet spot
    let hx = sp.x - 6500, hz = sp.z - 5500;
    for (let a = 0; a < 8 && groundHeight(hx, hz) > -2; a++) {
      const th = a * 0.785;
      hx = sp.x + Math.sin(th) * 8500; hz = sp.z - Math.cos(th) * 8500;
    }
    this.seal = G.spawnAI('seahawk', {
      pos: V(hx, 140, hz), heading: 0, speed: 38, hp: 260,
      name: 'SH-60 SEAHAWK', label: 'SEAL TEAM', mode: 'route', noEvade: true,
      waypoints: [sp.clone().add(V(3000, 120, 3000))],
    });
    this.padHelo = 0; this._flareT = 0;
    this.seal.kind = 'wingman'; this.seal.identified = true;
    G.waypoint = sp;
    G.radio('FLEET COM: SEAL DELIVERY IS ROLLING. TOP COVER, VIPER — WATCH FOR MANPADS AND GO-FASTS.');
  },
  _boat(G, ang) {
    const sp = this.ship.pos;
    // go-fasts come from water, not the hills — walk the bearing to wet ground
    let p = V(sp.x + Math.sin(ang) * 12500, 0, sp.z - Math.cos(ang) * 12500);
    for (let a = 0; a < 10 && groundHeight(p.x, p.z) > -2; a++) {
      ang += 0.7;
      p = V(sp.x + Math.sin(ang) * 12500, 0, sp.z - Math.cos(ang) * 12500);
    }
    const b = G.spawnAI('boat', {
      pos: p, heading: ang + Math.PI, speed: 30, hp: 40,
      name: 'GO-FAST BOAT', label: 'GO-FAST', mode: 'straight', noEvade: true,
      hostile: true, surface: true,
    });
    b.kind = 'bandit'; b.identified = true;
    this.boats.push(b);
  },
  _manpad(G, target) {
    const sp = this.ship.pos;
    const p = V(sp.x + rand(-25, 25), 17, sp.z + rand(-70, 70));
    const dir = target.pos.clone().sub(p).normalize();
    // a static shooter: no velocity of its own, so the round starts slow
    const shooter = { pos: p, speed: 0, vel: new THREE.Vector3(), fwd: (out) => out.copy(dir) };
    G.fireEnemyMissile(shooter, target, 'r73');
    G.msg('MANPAD LAUNCH FROM THE SHIP!', 'warn');
    G.audio.radioClick();
  },
  update(G, dt) {
    this.t += dt;
    const sp = this.ship.pos;
    if (this.seal.dead) {
      G.failMission('THE SEAL TEAM IS DOWN', 'THE SEAHAWK WENT INTO THE BAY WITH THE\nWHOLE ASSAULT TEAM ABOARD.\n\nTHERE IS NO SECOND WAVE.\nTHE HOSTAGES ARE ON THEIR OWN.');
      return;
    }
    // go-fasts: they sortie when the rescue closes in, and again when the
    // ropes go out — timed so the player can actually get there first
    const sealD0 = this.seal.pos.distanceTo(sp);
    if (!this.boatWave1 && sealD0 < 9000) {
      this.boatWave1 = true;
      this._boat(G, 0.8); this._boat(G, 2.2);
      G.msg('GO-FAST BOATS INBOUND ON THE MONARCH', 'warn');
      G.radio('FLEET COM: TWO GO-FASTS OFF THE COAST, MAKING FOR THE MONARCH — SPLASH THEM.');
    }
    if (!this.boatWave2 && (this.hoverT >= 0 || (this.boatWave1 && this.boats.every(b => b.dead)))) {
      this.boatWave2 = true;
      this._boat(G, -0.9); this._boat(G, 3.6);
      G.msg('MORE GO-FASTS — SINK THEM!', 'warn');
    }
    for (const b of this.boats) {
      if (b.dead) continue;
      // hand-driven: route mode's arrival radius would park them 700 m out
      const want = Math.atan2(sp.x - b.pos.x, -(sp.z - b.pos.z));
      b.heading = want + Math.sin(this.t * 1.3 + b.pos.x * 0.001) * 0.25;   // evasive wake
      if (b.pos.distanceTo(sp) < 380) {
        G.failMission('REINFORCEMENTS GOT THROUGH', 'A GO-FAST BOAT MADE THE SHIP AND PUT MORE\nGUNS ABOARD. THE SEALS ARE OUTNUMBERED\nON THAT DECK.\n\nTHE OPERATION IS OVER.');
        return;
      }
    }
    G.waypoint = this.boats.find(b => !b.dead)?.pos || (this.dropDone ? G.world.carrier.pos : this.seal.pos);
    // the SEAL bird rides with a full flare rack — IR seekers mostly go stupid
    if (!this.seal.dead) {
      for (const m of G.missiles) {
        if (!m.dead && m.target === this.seal && m.pos.distanceTo(this.seal.pos) < 1500 && G.time - this._flareT > 0.8) {
          this._flareT = G.time; this.seal.flareT = G.time;
        }
      }
    }
    // MANPADS: the deck shoots back at anything low and close, but the gunners
    // only get so many clean shots at the helicopter
    this.padT -= dt;
    if (this.padT <= 0 && this.padsLeft > 0 && !this.dropDone) {
      const sealD = this.seal.pos.distanceTo(sp);
      const pD = G.player.pos.distanceTo(sp);
      let target = null;
      if (sealD < 5200 && this.padHelo < 4) target = this.seal;
      else if (pD < 3400 && G.player.altFt < 2200) target = G.player;
      if (target) {
        this._manpad(G, target);
        this.padsLeft--;
        if (target === this.seal) this.padHelo++;
        this.padT = rand(9, 14);
      } else this.padT = 3;
    }
    // the Seahawk: approach, hover, fast-rope, go home
    if (!this.dropDone) {
      const d = this.seal.pos.distanceTo(sp);
      if (this.hoverT < 0) {
        this.seal.waypoints = [V(sp.x + 40, 55, sp.z + 40)];
        this.seal.targetSpeed = d > 3000 ? 38 : 16;
        if (d < 500) {
          this.hoverT = 20;
          this.seal.mode = 'straight'; this.seal.targetSpeed = 0;
          G.radio('SEAL SIX: ON TOP OF THEM — ROPE\'S OUT, BOYS ARE GOING DOWN.');
        }
      } else {
        // pinned hover over the deck
        this.seal.pos.x = damp(this.seal.pos.x, sp.x + 40, 1.5, dt);
        this.seal.pos.z = damp(this.seal.pos.z, sp.z + 40, 1.5, dt);
        this.seal.pos.y = damp(this.seal.pos.y, 42, 1.5, dt);
        this.hoverT -= dt;
        if (this.hoverT < 8 && !this._ropeMsg) { this._ropeMsg = true; G.radio('SEAL SIX: FAST-ROPING — COVER US, VIPER!'); }
        if (this.hoverT <= 0) {
          this.dropDone = true;
          this.seal.mode = 'route'; this.seal.targetSpeed = 40;
          this.seal.waypoints = [V(sp.x + 6000, 200, sp.z - 6000), G.world.carrier.pos.clone().add(V(0, 150, -2000))];
          G.msg('SEALS ARE DOWN ON DECK', 'good');
          G.radio('SEAL SIX: WE ARE ABOARD! BRIDGE IN THIRTY — KEEP THE GO-FASTS OFF US A MINUTE LONGER!');
        }
      }
    } else if (!this.sealHome) {
      // ride the lift home
      if (this.seal.pos.distanceTo(sp) > 8000) {
        this.sealHome = true;
        G.radio('SEAL SIX: BRIDGE SECURE. ENGINE ROOM SECURE. THE MONARCH IS OURS — HOSTAGES SAFE.');
      }
    }
    const boatsDown = this.boats.every(b => b.dead);
    if (this.dropDone && boatsDown) {
      G.addScore(3500);
      G.completeMission('MISSION COMPLETE',
        'SEAL TEAM SIX HAS THE SHIP.\nTWO HUNDRED AND TWENTY HOSTAGES ARE GOING\nHOME FOR DINNER.\n\nSCORE +3500 + KILL BONUSES');
    }
  },
},
// ------------------------------------------------ M12 SUB HUNTERS
{
  id: 'm12', num: 12, title: 'SUB HUNTERS', code: 'OCTOBER 14, 1994 — 0630 HRS',
  time: 'morning', planeChoice: true,
  brief: [
    'FLEET COM — PRIORITY TASKING', '',
    'A KILO-CLASS BOAT IS CREEPING THE SHELF',
    'WEST OF THE GOLDEN GATE, SNIFFING THE', '',
    'BATTLE GROUP.', '',
    'THE HUNT IS ON: A P-3 ORION, AN S-3',
    'VIKING AND A SEAHAWK ARE OVER HER NOW,', '',
    'BUOYS IN THE WATER, TORPEDOES ARMED.', '',
    'ENEMY MIGS AND SUKHOIS HAVE SCRAMBLED',
    'TO KILL THE HUNTERS AND SPRING THEIR',
    'SUBMARINE. DO NOT LET THEM.', '',
    'IF EVEN ONE HUNTER GOES DOWN, THE KILO',
    'GOES DEEP AND IS GONE FOREVER.', '',
    'KEEP THE HUNTERS ALIVE UNTIL THE',
    'TORPEDOES RUN.',
  ],
  briefing: 'Protect the sub hunters. Lose one and the sub escapes.',
  loadout: '2× AIM-9 · 4× AIM-120 · 500× 20MM — HUNTER ESCORT',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    this.sub = G.spawnAI('sub', {
      pos: V(-46000, -3, 1000), heading: 0.9, speed: 3, hp: 200,
      name: 'KILO CLASS', label: 'KILO', mode: 'straight', noEvade: true,
      hostile: true, surface: true,
    });
    this.sub.kind = 'bandit'; this.sub.identified = true; this.sub.targetSpeed = 3;
    const sp = this.sub.pos;
    this.hunters = [];
    const mk = (type, off, alt, r, speed, label, hp) => {
      const h = G.spawnAI(type, {
        pos: sp.clone().add(off), speed, hp,
        name: type.toUpperCase(), label, mode: 'orbit', orbitRadius: r, noEvade: true,
      });
      h.kind = 'wingman'; h.identified = true;
      h.orbitCenter = new THREE.Vector3(sp.x, alt, sp.z);
      this.hunters.push(h);
      return h;
    };
    this.p3 = mk('p3', V(6000, 150, 3000), 150, 4200, 68, 'BLOODHOUND 21', 260);
    this.s3 = mk('s3', V(-4000, 420, -2000), 420, 2900, 76, 'SAWBUCK 701', 220);
    this.helo = mk('seahawk', V(1500, 80, 1500), 80, 1500, 30, 'THUNDER 62', 160);
    this.wave1 = false; this.wave2 = false; this.bandits = [];
    this.phase = 'hunt'; this.torps = []; this.torpT = 0; this.torpStep = 0;
    this.t = 0;
    G.waypoint = this.sub.pos;
    G.radio('FLEET COM: THE HUNTERS ARE ON HER. YOUR JOB IS SIMPLE — NOTHING TOUCHES THEM.');
    G.radio('BLOODHOUND 21: CONTACT IS FIRM, BUOYS IN THE WATER. JUST KEEP THE FIGHTERS OFF US, VIPER.');
  },
  _launchTorp(G, from, hit, side) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 4.2, 6), new THREE.MeshBasicMaterial({ color: 0xdadde0 }));
    m.geometry.rotateX(Math.PI / 2);
    const bearing = this.sub.pos.clone().sub(from.pos); bearing.y = 0; bearing.normalize();
    const perp = new THREE.Vector3(bearing.z, 0, -bearing.x).multiplyScalar(side * 280);
    const aim = this.sub.pos.clone().add(hit ? new THREE.Vector3() : perp);
    // the drop splashes under the hunter; the run itself starts a kilometre out
    m.position.copy(aim).addScaledVector(bearing, -1000); m.position.y = -2;
    G.scene.add(m);
    const dir = aim.clone().sub(m.position).setY(0).normalize();
    this.torps.push({ mesh: m, pos: m.position, dir, aim, hit, wakeT: 0, dead: false, spd: 50 });
    G.fx.splash(from.pos.clone().setY(0), 1.2);
  },
  update(G, dt) {
    this.t += dt;
    // lose any hunter and the Kilo slips away into the deep
    for (const h of this.hunters) {
      if (h.dead) {
        G.failMission('A HUNTER IS DOWN — THE SUB GETS AWAY',
          `${h.label} IS IN THE SEA.\nWITH A HOLE IN THE SCREEN THE KILO WENT DEEP\nAND VANISHED OFF EVERY SCOPE IN THE BAY.\n\nTHE HUNT IS OVER. SHE GOT AWAY.`);
        return;
      }
    }
    if (this.sub.dead) {
      if (this.phase !== 'done') {
        this.phase = 'done';
        G.addScore(4000);
        setTimeout(() => {
          if (!G.over) G.completeMission('MISSION COMPLETE',
            'THE KILO IS ON THE BOTTOM IN A HUNDRED PIECES,\nAND EVERY HUNTER IS GOING HOME.\n\nTHE SHELF IS QUIET TONIGHT.\n\nSCORE +4000 + KILL BONUSES');
        }, 5000);
      }
      return;
    }
    // the hunt tracks the creeping sub
    for (const h of this.hunters) { h.orbitCenter.x = this.sub.pos.x; h.orbitCenter.z = this.sub.pos.z; }
    // interceptors, in two waves: Fulcrums first, then the good Flankers
    if (!this.wave1 && this.t > 35) {
      this.wave1 = true;
      const sp = this.sub.pos;
      [[this.p3, 'mig29'], [this.s3, 'mig29']].forEach(([tgt, ty], i) => {
        const b = G.spawnAI(ty, {
          pos: V(sp.x - 24000 - i * 4000, 3000 + i * 800, sp.z - 8000 + i * 6000),
          heading: Math.PI / 2, speed: 300, hostile: true, name: 'MIG-29', label: 'MIG-29',
          mode: 'attack', skill: skillFor(PILOT_RATING.m12), agility: agilityFor(PILOT_RATING.m12),
        });
        b.target = tgt; b.kind = 'bandit'; b.identified = true; b.fireCooldown = 12 + i * 7;
        this.bandits.push(b);
      });
      G.msg('MIGS SCRAMBLED — THEY WANT THE HUNTERS', 'bad');
      G.radio('FLEET COM: TWO FULCRUMS OFF THE COAST, NOSED ONTO THE HUNTERS. GET BETWEEN THEM, VIPER.');
    }
    if (!this.wave2 && this.wave1 && this.bandits.every(b => b.dead)) {
      this.wave2 = true;
      const sp = this.sub.pos;
      [this.helo, G.player].forEach((tgt, i) => {
        const b = G.spawnAI('su27', {
          pos: V(sp.x - 20000 - i * 5000, 4000 + i * 1000, sp.z + 9000 - i * 4000),
          heading: Math.PI / 2, speed: 320, hostile: true, name: 'SU-27', label: 'SU-27',
          mode: 'attack', skill: skillFor(Math.min(100, PILOT_RATING.m12 + 15)), agility: agilityFor(Math.min(100, PILOT_RATING.m12 + 15)),
        });
        b.target = tgt; b.kind = 'bandit'; b.identified = true; b.fireCooldown = 10 + i * 6;
        this.bandits.push(b);
      });
      G.msg('FLANKERS! ONE FOR THE HELO, ONE FOR YOU', 'bad');
      G.radio('FLEET COM: SU-27s IN THE AIR — AND ONE OF THEM IS YOURS, VIPER.');
    }
    G.waypoint = this.bandits.find(b => !b.dead)?.pos || this.sub.pos;
    // once the sky is clear, the torpedo ballet: miss, miss, hit
    if (this.phase === 'hunt' && this.wave2 && this.bandits.every(b => b.dead)) {
      this.phase = 'torps'; this.torpT = 0; this.torpStep = 0;
      G.radio('FLEET COM: SKY IS CLEAR. BLOODHOUND 21, YOU ARE WEAPONS FREE.');
    }
    if (this.phase === 'torps') {
      this.torpT += dt;
      if (this.torpStep === 0 && this.torpT > 1.5) {
        this.torpStep = 1;
        this._launchTorp(G, this.p3, false, 1);
        G.radio('BLOODHOUND 21: TORPEDO ONE AWAY — RUNNING HOT AND STRAIGHT.');
      }
      if (this.torpStep === 1 && this.torpT > 22) {
        this.torpStep = 2;
        G.msg('TORPEDO ONE — MISS!', 'warn');
        G.radio('BLOODHOUND 21: SHE TURNED INTO IT AND LET IT GO BY! THIS SKIPPER IS GOOD.');
      }
      if (this.torpStep === 2 && this.torpT > 24) {
        this.torpStep = 3;
        this._launchTorp(G, this.s3, false, -1);
        G.radio('SAWBUCK 701: TORPEDO TWO AWAY — BEAR ON HER THIS TIME.');
      }
      if (this.torpStep === 3 && this.torpT > 40) {
        this.torpStep = 4;
        G.msg('TORPEDO TWO — MISS AGAIN!', 'warn');
        G.radio('SAWBUCK 701: MISS! SHE IS SLIPPERY AS A GREASED EEL DOWN THERE.');
      }
      if (this.torpStep === 4 && this.torpT > 42.5) {
        this.torpStep = 5;
        this._launchTorp(G, this.helo, true, 0);
        G.radio('THUNDER 62: I HAVE THE ANGLE — TORPEDO THREE AWAY!');
      }
    }
    // run the torpedoes
    for (const tp of this.torps) {
      if (tp.dead) continue;
      if (tp.hit) tp.dir.copy(this.sub.pos).sub(tp.pos).setY(0).normalize();   // the good one homes
      tp.pos.addScaledVector(tp.dir, (tp.spd || 36) * dt);
      tp.wakeT -= dt;
      if (tp.wakeT <= 0) { tp.wakeT = 0.12; G.fx.smoke(tp.pos.clone().setY(0.3), 1.6, 1.8, 0xeef2f4); }
      if (tp.hit && tp.pos.distanceTo(this.sub.pos) < 34) {
        tp.dead = true; G.scene.remove(tp.mesh);
        G.fx.splash(this.sub.pos.clone().setY(0), 2.6);
        G.explode(this.sub.pos.clone().setY(0), 2.2);
        this.sub.hit(999, G, false);
        G.radio('THUNDER 62: DIRECT HIT! SHE\'S GOING DOWN BY THE STERN — SPLASH ONE KILO!');
        G.msg('DIRECT HIT — THE KILO IS GOING DOWN', 'good');
      } else if (!tp.hit && tp.pos.distanceTo(tp.aim) < 60) {
        tp.dead = true; G.scene.remove(tp.mesh);
        G.fx.splash(tp.pos.clone().setY(0), 1.0);
      }
    }
  },
},
// ------------------------------------------------ M13 AVENGE VIPER TWO
{
  id: 'm13', num: 13, title: 'AVENGE VIPER TWO', code: 'OCTOBER 21, 1994 — 0940 HRS',
  time: 'day', planeChoice: true,
  brief: [
    'NORAD STRATEGIC COMMAND', '',
    'ROUTINE COMBAT AIR PATROL, TWO-SHIP,', '',
    'THE NORTHERN APPROACH. QUIET SKIES.', '',
    'NOTHING IN THE THREAT BRIEF. NOTHING ON',
    'THE SCOPE. A MILK RUN.', '', '', '',
    'THAT IS WHAT THE BRIEF SAYS, ANYWAY.', '', '', '',
    'FLY THE SWEEP. TRUST YOUR WINGMAN.', '',
    'IF THE WORST HAPPENS — AND PRAY IT DOES', '',
    'NOT — YOU KNOW WHAT TO DO.', '', '',
    'NO RETREAT. NO MERCY. NO SURVIVORS.',
  ],
  briefing: 'Avenge your wingman.',
  loadout: '2× AIM-9 · 4× AIM-120 · 500× 20MM — MAKE THEM PAY',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    this.t = 0; this.bounced = false; this.killT = -1; this.mourned = false;
    this.bandits = [];
    this.sweepPt = V(-4000, 6000, -22000);
    G.waypoint = this.sweepPt;
    G.radio('NORAD: VIPER FLIGHT, SWEEP THE NORTHERN APPROACH AT ANGELS 20. SCOPE IS CLEAN OUT THERE.');
  },
  update(G, dt) {
    this.t += dt;
    const wm = G.wingman;
    if (!this.bounced && this.t > 42) {
      this.bounced = true;
      const anchor = (wm && wm.alive) ? wm.ai.pos : G.player.pos;
      for (let i = 0; i < 2; i++) {
        const b = G.spawnAI('su27', {
          pos: anchor.clone().add(V(-5000 - i * 1800, 900 + i * 300, 5000 + i * 1600)),
          heading: 0, speed: 330, hostile: true, name: 'SU-27', label: 'SU-27',
          mode: 'attack', skill: skillFor(PILOT_RATING.m10), agility: agilityFor(PILOT_RATING.m10),
        });
        b.target = (wm && wm.alive) ? wm.ai : G.player;
        b.kind = 'bandit'; b.identified = true; b.noAA = true; b.fireCooldown = 2.5 + i * 2.5;
        this.bandits.push(b);
      }
      if (wm && wm.alive) {
        this.killT = 11;
        G.msg('BANDITS BOUNCING VIPER TWO!', 'bad');
        G.radio('VIPER TWO: TWO FLANKERS ON MY SIX — LEAD, REQUEST ASSISTANCE NOW!');
      }
    }
    if (this.killT > 0 && wm && wm.alive) {
      this.killT -= dt;
      if (this.killT <= 0) {
        wm.ai.hit(999, G, false);
        G.explode(wm.ai.pos.clone(), 1.8);
      }
    }
    if (this.bounced && !this.mourned && wm && wm.ai && wm.ai.dead) {
      this.mourned = true;
      G.msg('VIPER TWO IS DOWN', 'bad');
      G.radio('NORAD: WE HAVE LOST VIPER TWO... VIPER 1-1, YOU ARE WEAPONS FREE. MAKE THEM PAY.');
      G.radio('NORAD: TWO MORE BOGEYS JOINING THE FIGHT — THEY WANT YOU TOO.');
      for (let i = 0; i < 2; i++) {
        const b = G.spawnAI('su27', {
          pos: G.player.pos.clone().add(V(7000 + i * 2000, 1200, -7000 - i * 2000)),
          heading: Math.PI, speed: 330, hostile: true, name: 'SU-27', label: 'SU-27',
          mode: 'attack', skill: skillFor(PILOT_RATING.m13), agility: agilityFor(PILOT_RATING.m13),
        });
        b.target = G.player; b.kind = 'bandit'; b.identified = true; b.noAA = true; b.fireCooldown = 6 + i * 4;
        this.bandits.push(b);
      }
      for (const b of this.bandits) if (!b.dead) b.target = G.player;
    }
    G.waypoint = this.bounced ? (this.bandits.find(b => !b.dead)?.pos || null) : this.sweepPt;   // keep the sweep steer until the bounce
    if (this.mourned && this.bandits.length === 4 && this.bandits.every(b => b.dead)) {
      G.addScore(4000);
      G.completeMission('MISSION COMPLETE',
        'FOUR FLANKERS IN THE SEA.\nVIPER TWO IS AVENGED.\n\nHE WOULD HAVE DONE THE SAME FOR YOU.\n\nSCORE +4000 + KILL BONUSES');
    }
  },
},
// ------------------------------------------------ M14 BEAR HUNT
{
  id: 'm14', num: 14, title: 'BEAR HUNT', code: 'NOVEMBER 2, 1994 — 0750 HRS',
  time: 'day', planeChoice: true,
  brief: [
    'VAW-123 SCREWTOPS — AIRBORNE EARLY WARNING', '',
    '0750: SURFACE SEARCH PAINTS A TURBOPROP,',
    'BEARING 270, ONE HUNDRED TEN MILES OUT,',
    'ANGELS 27. CLASSIC BEAR PROFILE — AND SHE',
    'IS NOT OUT HERE TO TAKE PICTURES.', '',
    'ESM READS A BEAR-H: THE MISSILE CARRIER.',
    'TWO KITCHENS UNDER HER WINGS, TWO FLANKERS',
    'RIDING SHOT.', '',
    'RUN HER DOWN WEST OF THE FLEET. KILL THE',
    'ARCHER BEFORE THE ARROWS FLY.', '',
    'IF THE ARROWS FLY ANYWAY — YOU, VIPER TWO,',
    'AND THE PHALANX GUNS ARE ALL THAT STAND',
    'BETWEEN THEM AND FIVE THOUSAND SAILORS.',
  ],
  briefing: 'Kill the Bear before she launches. Whatever flies — shoot it down.',
  loadout: '2× AIM-9 · 4× AIM-120 · 500× 20MM — FULL BURNER WEST',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    this.t = 0; this.carrierHits = 0; this.westCall = false;
    const c = G.world.carrier;
    this.pack = _bearPack(G, { pos: V(c.pos.x - 200000, 8200, c.pos.z - 8000), escorts: 2, rating: PILOT_RATING.m14, launchD: 52000 });
    // the Screwtops' Hawkeye holds its orbit northeast of the boat
    const eye = G.spawnAI('e2c', {
      pos: c.pos.clone().add(V(14000, 7000, -14000)), heading: Math.PI, speed: 130,
      name: 'SCREWTOPS 601', label: 'E-2C', mode: 'route', loop: true, noEvade: true,
      waypoints: [c.pos.clone().add(V(14000, 7000, -14000)), c.pos.clone().add(V(-14000, 7000, -22000)), c.pos.clone().add(V(-22000, 7000, 8000)), c.pos.clone().add(V(8000, 7000, 14000))],
    });
    eye.kind = 'friendly';
    G.radio('SCREWTOPS 601: VIPER, PICTURE WEST — ONE BEAR, TWO FLANKERS, ONE HUNDRED TEN MILES. SHE CARRIES KITCHENS, GENTLEMEN. GO GET HER.');
  },
  update(G, dt) {
    this.t += dt;
    const c = G.world.carrier, pack = this.pack;
    _bearPackUpdate(G, dt, pack);
    const allMissiles = pack.missiles;
    _ciwsUpdate(G, dt, allMissiles);
    // impact check — the fleet cannot take a Kitchen amidships
    for (const m of allMissiles) {
      if (m.dead || m._impacted) continue;
      if (m.pos.distanceTo(c.pos) < 420) {
        m._impacted = true; m.kill(G, true, false);
        G.explode(c.pos.clone().setY(18), 4);
        G.failMission('THE BIG E IS HIT', 'A KITCHEN TOOK THE ENTERPRISE AMIDSHIPS.\nFIRES ON THE HANGAR DECK, FIVE HUNDRED MEN\nIN THE WATER.\n\nTHE PHALANX WAS THE LAST CHANCE — AND IT\nWAS NOT ENOUGH.');
        return;
      }
    }
    // endings, graded by how early the archer died
    const bearDead = pack.bear.dead;
    const missilesResolved = allMissiles.every(m => m.dead);
    if (bearDead && missilesResolved) {
      if (pack.launched === 0) {
        G.addScore(4000);
        G.completeMission('TEXTBOOK INTERCEPT', 'THE BEAR WENT DOWN WITH HER MISSILES STILL\nON THE RAILS. THE FLEET NEVER HEARD A THING.\n\nTHAT IS HOW THE EXPERTS DO IT.\n\nSCORE +4000');
      } else {
        G.addScore(2500);
        G.completeMission('MISSION COMPLETE', `THE ARCHER IS DOWN — AND ${pack.launched === 1 ? 'HER ONE ARROW' : 'BOTH HER ARROWS'} WITH HER.\n\nTHE FLEET SAILS ON.\n\nSCORE +2500`);
      }
      return;
    }
    // she got away clean — the missiles, at least, must not
    if (!bearDead && pack.launched === 2 && missilesResolved) {
      G.addScore(1200);
      G.completeMission('THE FLEET SAILS ON', 'THE BEAR ESCAPED INTO THE WEST — BUT NOT ONE\nOF HER MISSILES FOUND THE SHIP.\n\nTHE CAPTAIN CALLS THAT A WIN. BARELY.\n\nSCORE +1200');
      return;
    }
    G.waypoint = allMissiles.find(m => !m.dead)?.pos || (!bearDead ? pack.bear.pos : c.pos);
    if (!this.westCall && this.t > 30) { this.westCall = true; G.msg('INTERCEPT 100 NM WEST', 'info'); }
  },
},
// ------------------------------------------------ M15 BEAR PAK
{
  id: 'm15', num: 15, title: 'BEAR PAK', code: 'NOVEMBER 9, 1994 — 0540 HRS',
  time: 'day', planeChoice: true,
  brief: [
    'NORAD STRATEGIC COMMAND — FLASH TRAFFIC', '',
    'THE REGIMENT\'S DEMONSTRATION TEAM IS UP.',
    'TWO BEAR-HS, FOUR FLANKERS, EACH BOMBER',
    'CARRYING A PAIR OF KITCHENS. THE WHOLE',
    'MISSILE REGIMENT, COMING AT THE FLEET',
    'ON TWO AXES AT ONCE.', '',
    'EIGHT KILLERS IN THE AIR. ONE OF YOU.', '',
    'WELL — TWO, IF VIPER TWO IS THE PILOT',
    'THE LOGBOOK SAYS.', '',
    'THIS IS THE FINAL EXAM. NOTHING THE',
    'SCHOOL TAUGHT YOU IS OPTIONAL TODAY.', '',
    'KILL THE ARCHERS. KILL THE ARROWS.',
    'COME HOME.',
  ],
  briefing: 'Two Bears, four escorts, four missiles. The final exam.',
  loadout: '2× AIM-9 · 4× AIM-120 · 500× 20MM — EVERYTHING THE DECK CAN GIVE YOU',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    this.t = 0;
    const c = G.world.carrier;
    this.packs = [
      _bearPack(G, { pos: V(c.pos.x - 205000, 8400, c.pos.z - 26000), escorts: 2, rating: PILOT_RATING.m15, launchD: 52000 }),
      _bearPack(G, { pos: V(c.pos.x - 215000, 7800, c.pos.z + 18000), escorts: 2, rating: PILOT_RATING.m15, launchD: 52000 }),
    ];
    const eye = G.spawnAI('e2c', {
      pos: c.pos.clone().add(V(14000, 7000, -14000)), heading: Math.PI, speed: 130,
      name: 'SCREWTOPS 601', label: 'E-2C', mode: 'route', loop: true, noEvade: true,
      waypoints: [c.pos.clone().add(V(14000, 7000, -14000)), c.pos.clone().add(V(-14000, 7000, -22000)), c.pos.clone().add(V(-22000, 7000, 8000)), c.pos.clone().add(V(8000, 7000, 14000))],
    });
    eye.kind = 'friendly';
    G.radio('SCREWTOPS 601: VIPER, PICTURE WEST — TWO BEARS, TWO AXES, FOUR FLANKERS TOTAL. THE DEMONSTRATION TEAM, VIPER. GOOD HUNTING — YOU WILL NEED IT.');
  },
  update(G, dt) {
    this.t += dt;
    const c = G.world.carrier;
    for (const pack of this.packs) _bearPackUpdate(G, dt, pack);
    const allMissiles = this.packs.flatMap(p => p.missiles);
    _ciwsUpdate(G, dt, allMissiles);
    for (const m of allMissiles) {
      if (m.dead || m._impacted) continue;
      if (m.pos.distanceTo(c.pos) < 420) {
        m._impacted = true; m.kill(G, true, false);
        G.explode(c.pos.clone().setY(18), 4);
        G.failMission('THE BIG E IS HIT', 'THE REGIMENT\'S DEMONSTRATION TEAM GOT ONE\nTHROUGH. THE ENTERPRISE BURNS FROM BOW\nTO ISLAND.\n\nEIGHT KILLERS WAS ONE TOO MANY.');
        return;
      }
    }
    const bearsDead = this.packs.every(p => p.bear.dead);
    const missilesResolved = allMissiles.every(m => m.dead);
    if (bearsDead && missilesResolved) {
      const launched = this.packs.reduce((n, p) => n + p.launched, 0);
      if (launched === 0) {
        G.addScore(8000);
        G.completeMission('LEGEND STATUS', 'TWO BEARS DOWN WITH EVERY MISSILE ON THE\nRAILS. THE DEMONSTRATION TEAM WILL NOT BE\nDEMONSTRATING AGAIN.\n\nTHEY WILL FLY THIS ONE AT THE SCHOOL.\n\nSCORE +8000');
      } else {
        G.addScore(5000);
        G.completeMission('MISSION COMPLETE', 'BOTH ARCHERS DOWN, EVERY ARROW ACCOUNTED\nFOR. THE FLEET SAILS ON.\n\nSCORE +5000');
      }
      return;
    }
    if (!bearsDead && this.packs.every(p => p.launched === 2 || p.bear.dead) && missilesResolved) {
      G.addScore(2500);
      G.completeMission('THE FLEET SAILS ON', 'A BEAR SLIPPED HOME WEST — BUT ALL FOUR\nKITCHENS ARE IN THE SEA.\n\nTHE CAPTAIN CALLS THAT A WIN.\n\nSCORE +2500');
      return;
    }
    G.waypoint = allMissiles.find(m => !m.dead)?.pos
      || this.packs.find(p => !p.bear.dead)?.bear.pos
      || c.pos;
  },
},
// ------------------------------------------------ M16 SAR COVER
{
  id: 'm16', num: 16, title: 'SAR COVER', code: 'NOVEMBER 15, 1994 — 0845 HRS',
  time: 'day', planeChoice: true,
  brief: [
    'AIR BOSS — FLASH TASKING', '',
    'VIPER THREE IS IN THE WATER, TWENTY-FIVE',
    'MILES WEST. ALIVE, MARKING WITH SMOKE,',
    'AND NOT ALONE OUT THERE: TWO BANDIT',
    'PATROLS ARE BEING VECTORED TO MAKE SURE',
    'HE NEVER COMES HOME.', '',
    'THE ANGEL IS ON THE DECK AND TURNING.',
    'SHE GOES IN ALONE — SLOW, LOW, AND',
    'HOVERING DEAD STILL FOR TWO MINUTES',
    'WHILE THE HOIST DOES ITS WORK.', '',
    'YOUR JOB IS WRITTEN ON EVERY SAR', 
    'BRIEFING BOARD EVER CHALKED:', '',
    'NOTHING TOUCHES THE HELO.',
  ],
  briefing: 'Fly cover for the rescue helo. Nothing touches her.',
  loadout: '2× AIM-9 · 4× AIM-120 · 500× 20MM — TOP COVER',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    this.t = 0;
    const c = G.world.carrier;
    // the pilot is in the water twenty-five miles west
    this.raftPos = c.pos.clone().add(V(-46000, 1, -6000));
    this.raft = G.spawnAI('raft', { pos: this.raftPos.clone(), speed: 0, name: 'VIPER THREE', label: 'RAFT', mode: 'straight', noEvade: true, hp: 9999, surface: true });
    this.raft.kind = 'raft'; this.raft.targetSpeed = 0; this.raft.speed = 0;
    // the Angel lifts off the deck and runs the transit low
    this.angel = G.spawnAI('seahawk', {
      pos: c.pos.clone().add(V(-800, 80, -300)), heading: Math.atan2(-46000 + 800, 6000 + 300), speed: 70,
      name: 'ANGEL 01', label: 'SH-60', mode: 'straight', noEvade: true, hp: 160,
    });
    this.angel.kind = 'wingman'; this.angel.identified = true; this.angel.targetSpeed = 75;
    this.phase = 'outbound';      // outbound → hoist → inbound → home
    this.hoistT = 0; this.wave1 = false; this.wave2 = false; this.smokeT = 0; this._wv = [];
    G.waypoint = this.raftPos;
    G.radio('ANGEL 01: OFF THE DECK AND FEET WET. TWENTY-FIVE MILES, VIPER — KEEP THE SKY CLEAN FOR US.');
    G.radio('RESCUE COORD: VIPER THREE IS ALIVE AND SMOKING. TWO BANDIT PATROLS PAINTED, CLOSING HIM.');
  },
  _wave(G, n, dist) {
    const a = this.angel;
    for (let i = 0; i < n; i++) {
      const ang = rand(0, Math.PI * 2);
      const b = G.spawnAI('mig29', {
        pos: a.pos.clone().add(V(Math.cos(ang) * dist, 2500 + i * 800, Math.sin(ang) * dist)),
        heading: a.heading + Math.PI, speed: 260, hostile: true, name: 'MIG-29', label: 'MIG-29',
        mode: 'attack', skill: skillFor(PILOT_RATING.m16), agility: agilityFor(PILOT_RATING.m16),
      });
      b.target = a;   // ctor drops opts.target — set it post-spawn
      b.kind = 'bandit'; b.identified = true; b.fireCooldown = rand(8, 14);
      this._wv.push(b);
    }
    G.msg('BANDITS VECTORING ON THE ANGEL', 'bad');
    G.radio('ANGEL 01: SPIKED! WE HAVE COMPANY COMING — VIPER, WE NEED YOU NOW!');
  },
  update(G, dt) {
    this.t += dt;
    const a = this.angel, c = G.world.carrier;
    // orange smoke keeps the raft marked
    this.smokeT -= dt;
    if (this.smokeT <= 0 && this.phase !== 'home') { this.smokeT = 0.25; G.fx.smoke(this.raftPos.clone().add(V(0, 2, 0)), 2.5, 4, 0xff6a20); }
    // the Angel is the mission — lose her and it's over
    if (a.dead) {
      G.failMission('ANGEL DOWN', 'THE RESCUE HELO WENT INTO THE SEA WITH HER\nCREW. NOW THERE ARE TWO PILOTS IN THE WATER\n— AND NOBODY COMING FOR EITHER OF THEM.');
      return;
    }
    // scripted rescue: transit, hover, bring him home
    if (this.phase === 'outbound') {
      const d = this.raftPos.clone().sub(a.pos);
      a.heading = Math.atan2(d.x, -d.z); a.targetSpeed = 75;
      a.pos.y += (60 - a.pos.y) * Math.min(1, dt * 0.5);
      if (!this.wave1 && d.length() < 30000) { this.wave1 = true; this._wave(G, 2, 26000); }
      if (Math.hypot(d.x, d.z) < 400) { this.phase = 'hoist'; this.hoistT = 110; a.targetSpeed = 0;
        G.radio('ANGEL 01: OVER THE SURVIVOR — HOIST GOING DOWN. TWO MINUTES, KEEP THEM OFF US.'); }
    } else if (this.phase === 'hoist') {
      a.targetSpeed = 0;
      a.pos.x += (this.raftPos.x - a.pos.x) * dt; a.pos.z += (this.raftPos.z - a.pos.z) * dt;
      a.pos.y += (18 - a.pos.y) * Math.min(1, dt * 0.8);
      this.hoistT -= dt;
      if (!this.wave2 && this.hoistT < 70) { this.wave2 = true; this._wave(G, 3, 30000); }
      if (this.hoistT <= 0) { this.phase = 'inbound'; G.addScore(2000);
        G.msg('PILOT RECOVERED — COVER THE ANGEL HOME', 'good');
        G.radio('ANGEL 01: WE HAVE HIM! VIPER THREE IS ABOARD — COMING HOME, WATCH OUR SIX.'); }
    } else if (this.phase === 'inbound') {
      const d = c.pos.clone().sub(a.pos);
      a.heading = Math.atan2(d.x, -d.z); a.targetSpeed = 75;
      a.pos.y += (80 - a.pos.y) * Math.min(1, dt * 0.5);
      if (Math.hypot(d.x, d.z) < 2500) {
        this.phase = 'home';
        G.addScore(2500);
        G.completeMission('MISSION COMPLETE', 'THE ANGEL IS FEET DRY WITH VIPER THREE\nIN THE CABIN.\n\nNOTHING TOUCHED HER. THAT WAS THE WHOLE\nJOB — AND YOU DID IT.\n\nSCORE +4500 + KILL BONUSES');
        return;
      }
    }
    G.waypoint = this.phase === 'outbound' || this.phase === 'hoist' ? this.raftPos : a.pos;
  },
},
// ------------------------------------------------ M17 HABU DESCENDING
{
  id: 'm17', num: 17, title: 'HABU DESCENDING', code: 'DECEMBER 3, 1994 — 0610 HRS',
  time: 'morning', planeChoice: true,
  brief: [
    'NORAD STRATEGIC COMMAND — FLASH TRAFFIC', '',
    'NASA 832, AN SR-71 BLACKBIRD ON A HIGH',
    'SURVEY OVER THE PACIFIC, HAS LOST ONE',
    'ENGINE AND IS LOSING THE OTHER BY', 
    'DEGREES. SHE IS COMING HOME SLOW, LOW,',
    'AND ALONE — FROM THE WEST, OVER OPEN WATER.', '',
    'THE SHADOW SUB HAS FIGHTERS UP. A SICK',
    'BLACKBIRD IS THE INTELLIGENCE PRIZE OF',
    'THE DECADE, AND THEY MEAN TO FINISH HER', 
    'BEFORE SHE REACHES THE COAST.', '',
    'LAUNCH WITH VIPER TWO, RENDEZVOUS WITH',
    'THE HABU, AND PUT YOURSELVES BETWEEN HER', 
    'AND EVERYTHING THAT COMES.', '',
    'SHE MAKES SFO RUNWAY 10L OR SHE DOESN\'T',
    'COME HOME AT ALL.',
  ],
  briefing: 'Escort a wounded SR-71 home across the ocean.',
  loadout: '2× AIM-9 · 4× AIM-120 · 500× 20MM — ESCORT',
  setup(G) {
    G.setPlayerStart({ onCarrier: true });
    // the Habu: one engine out, one compressor-stalling, descending out of
    // the west at 330 knots and slowing by stages as the sick motor fades
    this.habu = G.spawnAI('sr71', {
      pos: V(-95000, 8100, 6000), heading: Math.PI / 2 + 0.10, speed: 330, hp: 420,
      name: 'NASA 832', label: 'HABU', mode: 'land', noEvade: true,
      waypoints: [
        V(-30000, 4600, 13000),
        V(-8000, 1500, 19000),    // abeam the Golden Gate
        V(4000, 700, 19300),      // over the city, long final
        V(12003, 6, 19652),       // touchdown on 10L
      ],
    });
    this.habu.kind = 'airliner'; this.habu.identified = true; this.habu.souls = 2;
    this.habu.onEvent = (ev) => { if (ev === 'landed') this.habuDown = true; };
    this.habuDown = false; this.met = false; this.w2 = false; this.w3 = false;
    this.t = 0; this.stage = 0; this._wv = [];
    const sp = G.world.enemySub.pos;
    this._wave = (n, type, rating, cd) => {
      for (let i = 0; i < n; i++) {
        const b = G.spawnAI(type, {
          pos: V(sp.x - 4000 + i * 3200, 2400 + i * 700, sp.z - 6000 + i * 5200),
          heading: Math.PI / 2, speed: 310, hostile: true,
          name: type === 'su27' ? 'SU-27' : 'MIG-29', label: type === 'su27' ? 'SU-27' : 'MIG-29',
          mode: 'attack', skill: skillFor(rating), agility: agilityFor(rating),
        });
        b.target = this.habu;   // ctor drops opts.target — set it post-spawn
        b.kind = 'bandit'; b.identified = true; b.fireCooldown = cd + i * 9;
        this._wv.push(b);
      }
    };
    this._wave(2, 'mig29', PILOT_RATING.m17, 26);
    G.waypoint = this.habu.pos;
    G.radio('NASA 832: NORAD, EIGHT-THREE-TWO. NUMBER ONE IS OUT AND NUMBER TWO IS ROUGH. WE ARE A VERY FAST GLIDER HAVING A BAD MORNING.');
    G.radio('FLEET COM: VIPER 1-1, THE HABU IS YOUR SHEPHERD. THE SUB ALREADY HAS TWO BANDITS CLIMBING FOR HER — GO GET BETWEEN THEM.');
  },
  update(G, dt) {
    this.t += dt;
    const h = this.habu;
    G.waypoint = this._wv.some(b => !b.dead) ? (this._wv.find(b => !b.dead) || h).pos : h.pos;
    if (h.dead) {
      G.failMission('THE HABU IS DOWN',
        'NASA 832 FELL INTO THE SEA FORTY MILES SHORT\nOF THE COAST. TWO CREW, THIRTY YEARS OF\nPROGRAM HISTORY — ALL OF IT ON THE BOTTOM.\n\nTHE SUB\'S AIR WING IS TOASTING ITSELF.');
      return;
    }
    // the sick engine gives up in stages — each one makes her slower and the
    // intercept geometry kinder to the bandits
    const stages = [
      { t: 25, spd: 250, call: 'NASA 832: NUMBER TWO JUST STALLED AND RELIT. WE\'RE DOWN TO TWO-FIFTY KNOTS. SHE DOESN\'T LIKE IT DOWN HERE.' },
      { t: 70, spd: 185, call: 'NASA 832: IT\'S GETTING WORSE — ONE-EIGHT-FIVE AND SINKING. WHATEVER YOU\'RE DOING OUT THERE, DO IT FASTER.' },
      { t: 120, spd: 150, call: 'NASA 832: ONE-FIVE-ZERO, THAT\'S ALL SHE HAS. WE ARE A BLACK PIANO LOOKING FOR A RUNWAY.' },
    ];
    if (this.stage < stages.length && this.t > stages[this.stage].t) {
      this.spdCap = stages[this.stage].spd;
      G.radio(stages[this.stage].call);
      for (let i = 0; i < 5; i++) G.fx.smoke(h.pos.clone().add(V(0, 1, -12 - i * 4)), 1.4, 2.5, 0xe8e8e8);
      G.msg('THE HABU IS SLOWING', 'warn');
      this.stage++;
    }
    // the land-mode autopilot manages its own targetSpeed — enforce the sick
    // engine as a hard cap on the airframe itself, eased in at 24 m/s/s
    if (this.spdCap && !h.landed && !h.dead) {
      if (h.speed > this.spdCap) h.speed = Math.max(this.spdCap, h.speed - 24 * dt);
      if (h.targetSpeed > h.speed) h.targetSpeed = h.speed;
    }
    // the rendezvous that matters: get a wing on her before the bandits do
    if (!this.met && G.player.pos.distanceTo(h.pos) < 2500) {
      this.met = true; G.addScore(500);
      G.msg('RENDEZVOUS — ON THE HABU\'S WING', 'good');
      G.radio('NASA 832: WE SEE YOU OFF THE LEFT WING, VIPER. NEVER THOUGHT WE\'D BE HAPPY TO SEE A NAVY JET THIS CLOSE. TAKE US HOME.');
    }
    if (h.hp < 380 && !this._hit1) { this._hit1 = true; G.radio('NASA 832: WE\'RE HIT — HYDRAULICS ARE GOING. VIPER, THOSE MISSILES ARE GETTING CLOSE!'); }
    if (!this.w2 && (this._wv.every(b => b.dead) || h.pos.x > -58000)) {
      this.w2 = true;
      this._wave(2, 'mig29', PILOT_RATING.m17, 22);
      G.msg('SECOND INTERCEPT — BANDITS OFF THE SUB', 'warn');
      G.radio('SCREWTOPS 601: TWO MORE BOGEYS UP FROM THE SUB, NOSED ON THE HABU. THEY SMELL BLOOD, VIPER.');
    }
    if (!this.w3 && h.pos.x > -26000) {
      this.w3 = true;
      this._wave(2, 'su27', PILOT_RATING.m17 + 10, 18);
      G.msg('LAST DITCH — FLANKERS COMMITTING', 'bad');
      G.radio('SCREWTOPS 601: FLANKERS, VIPER — THEY\'VE SENT THE GOOD ONES. NOBODY TOUCHES THAT AIRPLANE.');
    }
    if (this.habuDown) {
      for (const b of this._wv) if (!b.dead) { b.mode = 'route'; b.target = null; b.waypoints = [V(-130000, 9000, -20000)]; }
      G.addScore(3500);
      G.completeMission('MISSION COMPLETE',
        'NASA 832 IS ON THE GROUND AT SFO — ONE ENGINE\nWINDMILLING, BOTH CREW WALKING AWAY.\n\nTHE FASTEST AIRPLANE EVER BUILT JUST NEEDED\nA COUPLE OF HORNETS TO GET HOME.\n\nSCORE +3500 + RENDEZVOUS & KILL BONUSES');
    }
  },
},
// ------------------------------------------------ M18 DEADLY CARGO
{
  id: 'm18', num: 18, title: 'DEADLY CARGO', code: 'JANUARY 19, 1995 — 0540 HRS',
  time: 'dusk', planeChoice: true, mk83: 6,
  brief: [
    'JOINT INTERAGENCY TASK FORCE — MOST SECRET', '',
    'THE MV DANUBE STAR, 150 METRES OF RUST,', 
    'IS CARRYING WEAPONS-GRADE URANIUM IN HER',
    'FORWARD HOLD, BOUND FOR A ROGUE STATE.', '',
    'SHE HAS IGNORED EVERY ORDER TO HEAVE TO.',
    'A SHADOW SUB IS SURFACED WEST OF THE', 
    'GOLDEN GATE TO TAKE THE CARGO OFF HER.', '',
    'HER CREW MAN SHOULDER-FIRED SAMS ON THE', 
    'DECKS. COME IN LOW AND THEY WILL REACH', 
    'FOR YOU. FLARES BEAT IGLAS. ALTITUDE', 
    'BEATS THEM TOO — BUT SO DOES NOTHING', 
    'ELSE ABOUT A BOMB RUN.', '',
    'SINK THE DANUBE STAR BEFORE SHE MAKES',
    'THE HANDOFF. STRIKE IS HORNET-ONLY:',
    'SIX MK 83S ON THE RACKS, CCIP ON THE', 
    'GLASS. THE GUN WORKS ON HULLS TOO.', '',
    'PUT THE PIPPER ON HER AND PICKLE.',
  ],
  briefing: 'Sink the smuggler freighter before she meets the sub.',
  loadout: '6× MK 83 · 2× AIM-9 · 4× AIM-120 · 500× 20MM — STRIKE',
  setup(G) {
    G.player.type = 'f18';                      // strike is Hornet-only — the brief says so
    G.setPlayerStart({ onCarrier: true });
    G.player.stores.mk83 = 6;
    const subP = G.world.enemySub.pos;
    this.sub = G.spawnAI('sub', {
      pos: V(subP.x, 0, subP.z), speed: 0, hp: 500, surface: true, noEvade: true,
      name: 'SHADOW SUB', label: 'SUB', mode: 'straight',
    });
    this.sub.kind = 'bandit'; this.sub.identified = true; this.sub.blastR = 45; this.sub.targetSpeed = 0;
    this.frt = G.spawnAI('freighter', {
      pos: V(-61000, 0, -19000), heading: Math.atan2(subP.x + 61000, -(subP.z + 19000)),
      speed: 12.5, hp: 1400, surface: true, noEvade: true,
      name: 'MV DANUBE STAR', label: 'SMUGGLER', mode: 'route',
      waypoints: [V(subP.x, 0, subP.z)],
    });
    this.frt.kind = 'bandit'; this.frt.identified = true; this.frt.blastR = 80;
    this.pads = [ { ent: this.frt, cd: 6 }, { ent: this.frt, cd: 14 } ];
    this.escape = false; this._call = 0;
    G.waypoint = this.frt.pos;
    G.radio('USCGC MIDGETT: MV DANUBE STAR, THIS IS THE UNITED STATES COAST GUARD. HEAVE TO AND PREPARE TO BE BOARDED.');
    G.radio('FLEET COM: SHE\'S NOT STOPPING, VIPER. WEAPONS FREE ON THE HULL — SIX BOMBS, AND THE CLOCK IS THE SUB.');
    G.msg('SINK THE FREIGHTER BEFORE THE RENDEZVOUS', 'info');
  },
  update(G, dt) {
    const f = this.frt, s = this.sub;
    G.waypoint = f.pos;
    _manpadUpdate(G, dt, this.pads);
    if (f.dead) {
      G.addScore(3500 + (s.dead ? 1000 : 0));
      G.completeMission('MISSION COMPLETE',
        'THE DANUBE STAR IS GOING DOWN BY THE BOW,\nCARGO AND ALL — TWENTY FATHOMS OF WATER\nBETWEEN THAT URANIUM AND ANYONE WHO\nWANTED IT.\n\n' + (s.dead ? 'AND THE SHADOW SUB WENT WITH HER.\n\n' : '') +
        'THE COAST GUARD CALLS IT A NAVIGATION\nHAZARD NOW. SCORE +3500' + (s.dead ? ' +1000 SUB BONUS' : ''));
      return;
    }
    // the handoff: hull within reach of the waiting sub
    if (!s.dead && f.pos.distanceTo(s.pos) < 3500) {
      G.failMission('THE HANDOFF IS MADE',
        'CRANES SWUNG THE CRATES ACROSS IN THE DARK.\nTHE SUB IS UNDER AND GONE, AND THE CARGO\nWITH IT.\n\nSOMEWHERE DOWN THE ROAD THERE IS A CITY\nTHAT PAYS FOR THIS.');
      return;
    }
    // sinking the sub first doesn't end it — she just runs for open water
    if (s.dead && !this.escape) {
      this.escape = true;
      f.waypoints = [V(-150000, 0, -30000)]; f.wpIndex = 0; f.targetSpeed = 13.5;
      G.msg('SHE\'S RUNNING FOR OPEN WATER', 'warn');
      G.radio('FLEET COM: THE SUB\'S DOWN BUT THE FREIGHTER IS LEGGING IT WEST — DO NOT LET HER OVER THE HORIZON.');
    }
    if (this.escape && f.pos.x < -125000) {
      G.failMission('OVER THE HORIZON', 'SHE MADE THE OPEN PACIFIC AND VANISHED\nINTO THE SHIPPING LANES. THE CARGO WILL\nSURFACE AGAIN SOMEWHERE. COUNT ON IT.');
      return;
    }
    // the clock, called out loud
    const d = f.pos.distanceTo(s.pos);
    const call = d < 5000 ? 3 : d < 9000 ? 2 : d < 14000 ? 1 : 0;
    if (call > this._call) {
      this._call = call;
      G.radio(call === 3 ? 'FLEET COM: SHE\'S ON TOP OF THE SUB — SECONDS, VIPER!' :
              call === 2 ? 'FLEET COM: FIVE MILES FROM THE HANDOFF. PUT HER DOWN NOW.' :
                           'FLEET COM: CLOSING ON THE RENDEZVOUS. YOUR BOMBS ARE THE WHOLE ANSWER.');
    }
  },
},
// ------------------------------------------------ M19 WALL OF LEAD
{
  id: 'm19', num: 19, title: 'WALL OF LEAD', code: 'JANUARY 26, 1995 — 0515 HRS',
  time: 'night', planeChoice: true, mk83: 6,
  brief: [
    'JOINT INTERAGENCY TASK FORCE — MOST SECRET', '',
    'THEY LEARNED FROM THE DANUBE STAR.', '',
    'THE MV ARCTIC MERCHANT SAILS THE SAME',
    'CARGO ON THE SAME ERRAND — BUT TONIGHT',
    'SHE IS BRISTLING. FOUR FAST ATTACK BOATS', 
    'BOX HER IN WITH FLAK, FOUR MANPAD TEAMS', 
    'WAIT ON DECK, AND FIGHTER COVER ORBITS', 
    'HIGH. A SUB IS SURFACED TO RECEIVE.', '',
    'GOING IN ALONE AND LOW IS HOW PILOTS', 
    'GET POSTED MISSING. USE VIPER TWO:', 
    'HE DRAGS THE FIGHTERS AND SOAKS THE',
    'GUNLINE — YOU MAKE THE RUN.', '',
    'SIX MK 83S. CCIP ON THE GLASS. FLARES', 
    'FOR THE IGLAS. ALTITUDE IS LIFE — UNTIL', 
    'THE RUN, WHEN LIFE IS LOW AND FAST.', '',
    'SINK HER BEFORE THE HANDOFF.',
  ],
  briefing: 'The smuggler run, defended: boats, flak, MANPADs, fighters.',
  loadout: '6× MK 83 · 2× AIM-9 · 4× AIM-120 · 500× 20MM — STRIKE PACKAGE',
  setup(G) {
    G.player.type = 'f18';
    G.setPlayerStart({ onCarrier: true });
    G.player.stores.mk83 = 6;
    const subP = G.world.enemySub.pos;
    this.sub = G.spawnAI('sub', {
      pos: V(subP.x, 0, subP.z), speed: 0, hp: 500, surface: true, noEvade: true,
      name: 'SHADOW SUB', label: 'SUB', mode: 'straight',
    });
    this.sub.kind = 'bandit'; this.sub.identified = true; this.sub.blastR = 45; this.sub.targetSpeed = 0;
    this.frt = G.spawnAI('freighter', {
      pos: V(-56000, 0, -16500), heading: Math.atan2(subP.x + 56000, -(subP.z + 16500)),
      speed: 13, hp: 1700, surface: true, noEvade: true,
      name: 'MV ARCTIC MERCHANT', label: 'SMUGGLER', mode: 'route',
      waypoints: [V(subP.x, 0, subP.z)],
    });
    this.frt.kind = 'bandit'; this.frt.identified = true; this.frt.blastR = 80;
    // the gunline: four attack boats boxing her in
    this.boats = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const b = G.spawnAI('fastboat', {
        pos: V(this.frt.pos.x + Math.cos(a) * 700, 0, this.frt.pos.z + Math.sin(a) * 700),
        heading: a + Math.PI / 2, speed: 17 + i * 1.5, hp: 70, surface: true, hostile: true,
        name: 'BOG HAMMER ' + (i + 1), label: 'GUNBOAT', mode: 'orbit',
      });
      b.kind = 'bandit'; b.identified = true; b.blastR = 9;
      b.orbitCenter = this.frt.pos.clone(); b.orbitRadius = 460 + i * 190;
      this.boats.push(b);
    }
    this.pads = [ { ent: this.frt, cd: 5, max: 7 }, { ent: this.frt, cd: 12, max: 7 },
                  { ent: this.boats[0], cd: 9, max: 5 }, { ent: this.boats[3], cd: 16, max: 5 } ];
    // high cover: a pair of Fulcrums on station, more behind them
    this.cover = [];
    const sub = G.world.enemySub.pos;
    for (let i = 0; i < 2; i++) {
      const m = G.spawnAI('mig29', {
        pos: V(this.frt.pos.x - 9000 - i * 3000, 3400 + i * 500, this.frt.pos.z - 5000 + i * 4000),
        heading: Math.PI / 2, speed: 280, hostile: true, name: 'MIG-29', label: 'MIG-29',
        mode: 'orbit', skill: skillFor(PILOT_RATING.m19), agility: agilityFor(PILOT_RATING.m19),
      });
      m.kind = 'bandit'; m.identified = true; m.orbitCenter = this.frt.pos.clone(); m.orbitRadius = 8000 + i * 2500;
      this.cover.push(m);
    }
    this.hot = false; this.wave2 = false; this.diverted = false; this.escape = false; this._call = 0;
    G.waypoint = this.frt.pos;
    G.radio('FLEET COM: SAME ERRAND, WORSE NEIGHBORHOOD. THE MERCHANT HAS A GUNLINE AROUND HER AND FIGHTERS ON TOP.');
    G.radio('VIPER TWO: I\'LL DRAG THE COVER AND DRAW THE BOATS\' FIRE WHEN YOU CALL THE RUN, LEAD. JUST SAY WHEN.');
    G.msg('SINK THE FREIGHTER — USE YOUR WINGMAN', 'info');
  },
  update(G, dt) {
    const f = this.frt, s = this.sub;
    G.waypoint = f.pos;
    for (const b of this.boats) if (!b.dead) b.orbitCenter.copy(f.pos);
    for (const m of this.cover) if (!m.dead && m.mode === 'orbit') m.orbitCenter.copy(f.pos);
    _manpadUpdate(G, dt, this.pads);
    _aaaUpdate(G, dt, this.boats);
    // the cover commits once the Hornet is inside their ring
    if (!this.hot && G.player.pos.distanceTo(f.pos) < 26000) {
      this.hot = true;
      for (const m of this.cover) {
        if (m.dead) continue;
        m.mode = 'attack'; m.target = Math.random() < 0.55 || !G.wingman ? G.player : G.wingman.ai; m.fireCooldown = rand(6, 11);
      }
      G.msg('FIGHTER COVER IS COMMITTING', 'bad');
      G.radio('SCREWTOPS 601: THE ORBIT PAIR IS NOSE-DOWN ON YOU, VIPER — FIGHT\'S ON.');
    }
    // VIPER TWO earns his pay: once the run is on, put him on the fighter
    // cover and keep him stacked there — the gunline takes the easier target
    // while the bombs do the talking. Latch: he may still be on the deck when
    // the trigger first trips, so retry until he takes the order.
    if (!this.divertAck && (G.missiles.some(m => m.type === 'mk83') || (G.player.weapon === 'mk83' && G.player.pos.distanceTo(f.pos) < 14000))) {
      this.diverted = true;
      if (G.wingman && G.wingman.alive) {
        const tgt = this.cover.find(m => !m.dead);
        if (tgt) {
          this.divertAck = true;
          G.wingman.order = 'ATTACK MY TARGET'; G.wingman.engageT = tgt; G.wingman.state = 'ENGAGE';
          G.radio('VIPER TWO: ENGAGING THE COVER — GUNLINE\'S MINE TOO IF THEY WANT ME. MAKE THE RUN, LEAD!');
        }
      }
    }
    // splashed one? there's another — stay on the cover while the run is on
    if (this.divertAck && G.wingman && G.wingman.alive && G.player.pos.distanceTo(f.pos) < 24000 &&
        (G.wingman.state === 'WING' || G.wingman.state === 'JOIN')) {
      const tgt = this.cover.find(m => !m.dead);
      if (tgt) { G.wingman.engageT = tgt; G.wingman.state = 'ENGAGE'; }
    }
    if (!this.wave2 && f.hp < 1100) {
      this.wave2 = true;
      const sp = G.world.enemySub.pos;
      for (let i = 0; i < 2; i++) {
        const m = G.spawnAI('su27', {
          pos: V(sp.x - 3000 + i * 2600, 2800 + i * 600, sp.z - 5000 + i * 4400),
          heading: Math.PI / 2, speed: 300, hostile: true, name: 'SU-27', label: 'SU-27',
          mode: 'attack', skill: skillFor(PILOT_RATING.m19 + 8), agility: agilityFor(PILOT_RATING.m19 + 8),
        });
        m.target = G.player;   // ctor drops opts.target — set it post-spawn
        m.kind = 'bandit'; m.identified = true; m.fireCooldown = 9 + i * 8;
      }
      G.msg('THEY\'RE DESPERATE — FLANKERS LAUNCHING', 'bad');
      G.radio('FLEET COM: YOU\'VE HURT HER — THE SUB IS LAUNCHING ITS LAST PAIR. FINISH THE FREIGHTER.');
    }
    if (f.dead) {
      G.addScore(4500 + (s.dead ? 1000 : 0));
      G.completeMission('MISSION COMPLETE',
        'THE ARCTIC MERCHANT BROKE HER BACK IN THE\nFLAK BURST GLOW AND ROLLED UNDER, CARGO\nAND ALL. THE GUNLINE WENT QUIET.\n\n' + (s.dead ? 'THE SHADOW SUB JOINED HER ON THE BOTTOM.\n\n' : '') +
        'TWO RUNS LIKE THIS AND THERE WON\'T BE\nA SMUGGLING FLEET LEFT.\nSCORE +4500' + (s.dead ? ' +1000 SUB BONUS' : ''));
      return;
    }
    if (!s.dead && f.pos.distanceTo(s.pos) < 3500) {
      G.failMission('THE HANDOFF IS MADE',
        'SHE CAME ALONGSIDE THE SUB UNDER HER OWN\nGUNLINE. THE CRATES WENT ACROSS BEFORE\nYOUR BOMBS COULD STOP THEM.\n\nTHAT CARGO HAS A ZIP CODE NOW.');
      return;
    }
    if (s.dead && !this.escape) {
      this.escape = true;
      f.waypoints = [V(-150000, 0, -30000)]; f.wpIndex = 0; f.targetSpeed = 13.5;
      G.msg('SHE\'S RUNNING FOR OPEN WATER', 'warn');
      G.radio('FLEET COM: SUB\'S DOWN AND THE MERCHANT IS LEGGING IT — RUN HER DOWN.');
    }
    if (this.escape && f.pos.x < -125000) {
      G.failMission('OVER THE HORIZON', 'SHE OUTRAN YOUR BOMBS TO THE SHIPPING\nLANES. THE CARGO WILL FIND ANOTHER BUYER.');
      return;
    }
    const d = f.pos.distanceTo(s.pos);
    const call = d < 5000 ? 3 : d < 9000 ? 2 : d < 14000 ? 1 : 0;
    if (call > this._call) {
      this._call = call;
      G.radio(call === 3 ? 'FLEET COM: SHE\'S RAFTING UP WITH THE SUB — NOW, VIPER, NOW!' :
              call === 2 ? 'FLEET COM: FIVE MILES TO THE HANDOFF. PRESS THE RUN.' :
                           'FLEET COM: THE CLOCK IS THE SUB, VIPER. GET LOW AND GET IT DONE.');
    }
  },
},
// ------------------------------------------------ FREE FLIGHT
{
  id: 'free', num: 99, title: 'FREE FLIGHT', code: 'NO ENEMY ACTIVITY',
  time: 'day', planeChoice: true,
  brief: [
    'FREE FLIGHT, NO ENEMY CONFRONTATION', '',
    'THE BAY IS YOURS. FLY ANYWHERE, BUZZ THE BRIDGES,',
    'PRACTICE CARRIER TRAPS AND LANDINGS.', '',
    'ESC REPOSITIONS AT THE START POINT',
    'SHIFT+ESC RETURNS TO THE MENU',
  ],
  briefing: 'Free flight — no enemy confrontation.',
  loadout: 'FULL LOADOUT — UNLIMITED RESPAWNS',
  setup(G) {
    const start = G.freeFlightStart || 'carrier';
    if (start === 'carrier') G.setPlayerStart({ onCarrier: true });
    else if (start === 'sfo') G.setPlayerStart({ runway: G.world.runwayById('sfo') });
    else if (start === 'oakland') G.setPlayerStart({ runway: G.world.runwayById('oakland') });
    else if (start === 'moffett') G.setPlayerStart({ runway: G.world.runwayById('moffett') });
    else if (start === 'alameda') G.setPlayerStart({ runway: G.world.runwayById('alameda') });
    else G.setPlayerStart({ pos: V(-6000, 1200, 0), heading: Math.PI / 2, speed: 180 });
    // the original's free flight has NO enemies at all
    this.respawnT = 0;
  },
  update(G, dt) {},
},
];

// campaign difficulty ladder — shown as a tag on the mission-select board
export const DIFFICULTY = {
  m1: 20, m2: 25, m3: 40, m4: 45, m5: 60, m6: 45, m7: 60,
  m8: 25, m9: 70, m10: 95, m11: 65, m12: 55, m13: 50,
  m14: 80, m15: 95, m16: 70,
  m17: 65, m18: 70, m19: 90,
};

// what the sortie actually asks of you — type and maneuver tags, shown as
// chips on the mission-select board under each title
export const MISSION_TAGS = {
  m1: ['RUNWAY START', 'INTERCEPT', 'VISUAL ID'],        // SFO scramble, eyeball the bogeys, RTB
  m2: ['CARRIER LAUNCH', 'POINT DEFENSE', 'INTERCEPT'],  // bandits inbound on Air Force One's approach
  m3: ['CARRIER LAUNCH', 'PURSUIT', 'DOGFIGHT'],         // run the stolen F-16s down
  m4: ['CARRIER LAUNCH', 'SEARCH', 'SAR ESCORT'],        // find the raft, cover the pickup
  m5: ['CARRIER LAUNCH', 'INTERCEPT', 'HIGH SPEED'],     // a very fast lawn-dart to kill
  m6: ['CARRIER LAUNCH', 'SEARCH', 'MARITIME STRIKE'],   // find the shadow sub, sink it
  m7: ['CARRIER LAUNCH', 'ESCORT', 'NIGHT'],             // bring the defector in after dark
  m8: ['CARRIER LAUNCH', 'HIGH ALTITUDE', 'GUN ONLY'],   // Angels 34, cannon, one balloon
  m9: ['CARRIER LAUNCH', 'ESCORT', 'DOGFIGHT'],          // keep the President's S-3 alive
  m10: ['CARRIER LAUNCH', 'NIGHT', 'ONE PASS'],          // 400 m/s, no second run at it
  m11: ['CARRIER LAUNCH', 'ESCORT', 'LOW LEVEL'],        // cover the SEAL helo in the strait
  m12: ['CARRIER LAUNCH', 'ESCORT', 'FLEET DEFENSE'],    // the hunters must all survive
  m13: ['CARRIER LAUNCH', 'SWEEP', 'DOGFIGHT'],          // four bandits between you and even
  m14: ['CARRIER LAUNCH', 'INTERCEPT', 'FLEET DEFENSE'],   // run down the missile carrier
  m15: ['CARRIER LAUNCH', 'INTERCEPT', 'EXPERT'],          // the whole regiment, two axes
  m16: ['CARRIER LAUNCH', 'ESCORT', 'DOGFIGHT'],           // nothing touches the Angel
  m17: ['CARRIER LAUNCH', 'ESCORT', 'HIGH SPEED'],         // walk the wounded Habu home
  m18: ['CARRIER LAUNCH', 'MARITIME STRIKE', 'DUMB BOMBS'],// six Mk 83s against the clock
  m19: ['CARRIER LAUNCH', 'MARITIME STRIKE', 'EXPERT'],    // gunline, MANPADs, top cover
};

// one-line hooks under the chips — the pitch that makes you press the key
export const MISSION_HOOKS = {
  m1: "Two bogeys won't squawk. Scramble out of SFO and put your nose on them before the morning gets worse.",
  m2: 'Air Force One is on final and bandits are in the sector. Nothing — nothing — gets past you.',
  m3: 'Two F-16s just vanished off the Moffett ramp with terrorists at the stick. Run them down over the Pacific.',
  m4: 'One of ours is bobbing in a raft out there. Find him, cover the pickup, bring everyone home.',
  m5: 'A cruise missile is running for Moffett at full tilt. You are the only thing in the sky that is faster.',
  m6: 'Enemy aircraft keep coming out of the sea itself. Find the shadow under the bay — and sink it.',
  m7: 'He is defecting after dark with everything he knows. Fly the wing that brings him in alive.',
  m8: 'Angels 34: sixty-one metres of spy camera drifting the coast. Climb high and pop the most famous balloon on Earth.',
  m9: 'The President is flying out to end the war — and Tehran wants one last headline. Sweep the sky clean.',
  m10: 'Night. A nuclear cruise missile at 800 knots. One pass — or one million souls.',
  m11: 'Gunboats hold a liner in the strait. Twenty seconds of hover between the SEALs and disaster — cover them.',
  m12: 'A Kilo is creeping the shelf. Keep every hunter alive and let the torpedoes do the talking.',
  m13: 'They killed your wingman. Four bandits between you and even. You know what to do.',
  m14: 'A Bear-H is running at the fleet with two Kitchens on the rails. Kill the archer before the arrows fly.',
  m15: 'Two Bears, four Flankers, eight killers on two axes. The final exam — pass it and become legend.',
  m16: 'A pilot is in the water and the Angel is going in alone. Slow, low, and hovering dead still — nothing touches her.',
  m17: 'A crippled Habu is falling out of the black sky, too fast to catch and too hurt to run. Meet him at the coast and keep the vultures off.',
  m18: 'Weapons-grade uranium in a rustbucket\'s forward hold, a sub surfaced to take it off her — and six dumb bombs to stop the handoff.',
  m19: 'She came back with friends: a gunline on the water, MANPADs on every deck, fighters for top cover. Your wingman draws the fire. You make the run.',
};

// flight school display data — the same board treatment as the campaign
Object.assign(DIFFICULTY, {
  t1: 10, t2: 15, t3: 35, t4: 40, t7: 35, t5: 30, t6: 55, t8: 30,
});
Object.assign(MISSION_TAGS, {
  t1: ['CARRIER LAUNCH', 'CARRIER TRAP', 'SOLO'],
  t2: ['CARRIER LAUNCH', 'NAVIGATION', 'CHECKPOINTS'],
  t3: ['CARRIER LAUNCH', 'TWO TRAPS', 'PATTERN'],
  t4: ['CARRIER LAUNCH', 'FORMATION', 'STATION-KEEPING'],
  t5: ['CARRIER LAUNCH', 'GUNNERY', 'FOUR TARGETS'],
  t6: ['CARRIER LAUNCH', 'BFM', '1V1'],
  t8: ['CARRIER LAUNCH', 'BOMBING', 'CCIP'],
});
Object.assign(MISSION_HOOKS, {
  t1: 'One launch, one pattern, one trap — the three things every naval aviator must own. Your first solo starts now.',
  t2: 'Three checkpoints around the bay, any profile you like. Learn the neighbourhood you will be defending.',
  t3: 'Two arrested landings in a single sortie. The LSO grades every pass — make both of them pretty.',
  t4: 'Join on your instructor and glue yourself to his wing for 45 seconds. Smooth hands, small corrections.',
  t5: 'Four target balloons off the coast and a gun full of 20mm. The range is yours, pilot.',
  t6: 'One aggressor, no help, fights on. Splash him and you are cleared for the campaign.',
  t8: 'Six iron bombs, two dead hulks, one pipper. Learn the CCIP math — the fleet\'s strike missions depend on it.',
});

// enemy pilot capability, 0-100 — drives skill/agility (and therefore how
// aggressive they are and which maneuvers they pull: the library only opens
// loop/split-S/barrel work to pilots rated ace or better). Green patrol
// pilots early, their legends late.
export const PILOT_RATING = {
  m1: 25,    // startled patrol pilots, if it comes to that
  m2: 30,    // raid wing — green, but there are many of them
  m3: 35,    // terrorists in stolen jets: can fly, can't fight
  m4: 40,    // MiGs prowling the rescue area
  m5: 40,    // missile escorts — regulars, no better than they have to be
  m6: 45,    // the shadow sub's air wing
  m7: 50,    // night interceptors
  m9: 65,    // loyalist Fulcrums and Flankers
  m10: 85,   // the best stick-and-rudder men Iran has left
  m11: 50,   // strait pirates
  m12: 70,   // two waves, second one meaner
  m13: 70,   // the pilots who killed your wingman
  m14: 75,   // Bear escort veterans
  m15: 92,   // legends — the regiment's demonstration team
  m16: 65,   // vectored onto a hovering helo
  m17: 55,   // interceptors hunting a sick Blackbird
  m19: 62,   // the smuggler's fighter cover
  t6: 55,    // your aggressor instructor: rated, but fair
};
// rating -> the AI's skill/agility (aces unlock the full maneuver library
// at skill >= 1.25)
export const skillFor = (r) => 0.5 + (r / 100) * 1.1;
export const agilityFor = (r) => 0.85 + (r / 100) * 0.4;
export const pilotDescriptor = (r) =>
  r < 35 ? 'GREEN — patrol pilots' :
  r < 55 ? 'RATED — squadron pilots' :
  r < 75 ? 'VETERAN — experienced' :
  r < 90 ? 'ACES — their very best' : 'LEGENDS — they invented the maneuvers';

// the flight-school syllabus, in unlock order
export const SCHOOL_ORDER = ['t1', 't2', 't3', 't4', 't7', 't5', 't6', 't8'];
