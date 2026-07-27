// missions.js — qualification, thirteen missions, free flight
import * as THREE from 'three';
import { rand, clamp, damp } from './util.js';
import { carrierLocalToWorld } from './flight.js';
import { buildBanner } from './models.js';
import { groundHeight } from './world.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// helpers
function near(a, b, r) { return a.distanceTo(b) < r; }

// ============================================================
export const MISSIONS = [
// ------------------------------------------------ QUALIFICATION
{
  id: 'qual', num: 0, title: 'CARRIER QUALIFICATION', code: 'TRAINING COMMAND',
  time: 'day', planeChoice: true,
  brief: [
    'QUALIFICATION', '',
    'PERFORM A SUCCESSFUL CARRIER LANDING.', '',
    'FLY AROUND, RETURN, THEN LAND ON CARRIER.', '',
    'FULL POWER + AFTERBURNER, ROTATE AT 150 KTS.',
    'GEAR (L), HOOK (A), 30-40% THROTTLE, ~140 KTS,',
    'AIM FOR THE WIRES.', '',
    '- ESC RE-POSITION ON CATAPULT -',
  ],
  briefing: 'Carrier qualification.',
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
          b.mode = 'attack'; b.target = G.player; b.hostile = true; b.noEvade = false; b.firedFirst = true; b.skill = 0.9; b.targetSpeed = 280;
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
        hostile: true, name: 'MIG-29', label: 'MIG-29', mode: 'attack', skill: 0.85, agility: 1.1,
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
        hostile: false, name: 'STOLEN F-16', label: 'F-16 ?', mode: 'route', noEvade: true, skill: 1.1,
        waypoints: [V(-120000, 5200, -8000)],
      });
      f.kind = 'stolen'; f.contacted = false; f.refused = false;
      this.f16s.push(f);
    }
    for (let i = 0; i < 2; i++) {
      const m = G.spawnAI('mig29', {
        pos: V(22000, 8000 + i * 600, 6000 - i * 4000), heading: -Math.PI / 2, speed: 265,
        hostile: false, name: 'MIG-29', label: 'MIG-29', mode: 'route', skill: 1.05, agility: 1.15,
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
        hostile: false, name: 'MIG-29', label: 'MIG-29', mode: 'orbit', skill: 1.0, agility: 1.1,
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
    'ETA DELIVERY AT MOFFETT FIELD: 9 MINUTES', '',
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
    this.cm = G.spawnAI('cruise', {
      pos: V(17500, 70, 80000), heading: Math.atan2(this.moffett.x - 17500, -(this.moffett.z - 80000)), speed: 300,
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
          mode: 'attack', skill: 0.95, agility: 1.1,
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
          skill: 1.0, agility: 1.1,
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
          skill: 0.9, agility: 1.15,
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
      this._wave(G, 2, G.player, G.wingman && G.wingman.ai, 1.25);
      G.msg('BANDITS SWEEPING FOR THE CAP!', 'bad');
      G.radio('NAVY ONE: WE HAVE COMPANY FORWARD OF US — VIPER, THEY ARE LOOKING FOR YOU. CLEAR US A PATH.');
    }
    if (!this.wave2 && this.navy1.pos.distanceTo(c.pos) < 24000) {
      this.wave2 = true;
      this._wave(G, 2, this.navy1, G.player, 1.45);
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
        mode: 'attack', skill: 1.5, agility: 1.2,
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
          mode: 'attack', skill: 1.3, agility: 1.15,
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
      [[this.helo, 1.5], [G.player, 1.5]].forEach(([tgt, sk], i) => {
        const b = G.spawnAI('su27', {
          pos: V(sp.x - 20000 - i * 5000, 4000 + i * 1000, sp.z + 9000 - i * 4000),
          heading: Math.PI / 2, speed: 320, hostile: true, name: 'SU-27', label: 'SU-27',
          mode: 'attack', skill: sk, agility: 1.2,
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
          mode: 'attack', skill: 1.5, agility: 1.2,
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
          mode: 'attack', skill: 1.45, agility: 1.2,
        });
        b.target = G.player; b.kind = 'bandit'; b.identified = true; b.noAA = true; b.fireCooldown = 6 + i * 4;
        this.bandits.push(b);
      }
      for (const b of this.bandits) if (!b.dead) b.target = G.player;
    }
    G.waypoint = this.bandits.find(b => !b.dead)?.pos || null;
    if (this.mourned && this.bandits.length === 4 && this.bandits.every(b => b.dead)) {
      G.addScore(4000);
      G.completeMission('MISSION COMPLETE',
        'FOUR FLANKERS IN THE SEA.\nVIPER TWO IS AVENGED.\n\nHE WOULD HAVE DONE THE SAME FOR YOU.\n\nSCORE +4000 + KILL BONUSES');
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
