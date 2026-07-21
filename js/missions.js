// missions.js — qualification, six missions, free flight (authentic to the 1988 original)
import * as THREE from 'three';
import { rand, clamp } from './util.js';

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
