// ---------------- flight deck crew — the colored shirts ----------------
// Yellow shirts direct and shoot, green run the cats, blue handle the planes,
// red is ordnance, brown the plane captain, purple fuel. The directors work
// the standard marshalling vocabulary: START ENGINES and IDENTIFY GATE when a
// jet comes alive, STRAIGHT AHEAD and TURN signals along the taxi route, SLOW
// DOWN on short final to the spot, then NORMAL STOP, CUT ENGINES and CHOCKS.
// A wingwalker walks the starboard wingtip with one wand up the whole way.
import * as THREE from 'three';

const SHIRT = {
  yellow: 0xe8c81c, green: 0x2e9e4f, red: 0xc8352a, blue: 0x2a5fc8,
  purple: 0x7a3fc8, white: 0xd8d8d8, brown: 0x7a5230,
};
const SKIN = 0x2a3240;   // trousers / float coat dark

function _mat(c) { return new THREE.MeshLambertMaterial({ color: c }); }

function buildFigure(shirt) {
  const g = new THREE.Group();
  const col = SHIRT[shirt] || SHIRT.white;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.8, 0.2), _mat(SKIN));
  legs.position.y = 0.4; g.add(legs);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.26), _mat(col));
  torso.position.y = 1.11; g.add(torso);
  // cranial helmet in shirt color, skin visor band
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), _mat(col));
  head.position.y = 1.58; head.scale.y = 1.1; g.add(head);
  const mkArm = (side) => {
    const piv = new THREE.Group();
    piv.position.set(side * 0.28, 1.4, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.6, 0.11), _mat(col));
    arm.position.y = -0.28; piv.add(arm);
    // marshalling wand — bright enough to read from the cockpit
    const wand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.05), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
    wand.position.y = -0.66; piv.add(wand);
    g.add(piv);
    return piv;
  };
  g.userData = { armL: mkArm(-1), armR: mkArm(1), legs, torso };
  return g;
}

// pose targets: shoulder rotation x (0 = arm down, π/2 = forward level, π = overhead),
// rotation z (sideways raise; L + out, R - out), kneel factor, an optional wave
// amplitude for arms flagged w:1, and bob for figures on the march
const POSES = {
  idle:          { L: { x: 0.12, z: 0.10 }, R: { x: 0.12, z: -0.10 }, kneel: 0, wave: 0 },
  crouch:        { L: { x: 0.9, z: 0.2 },  R: { x: 0.9, z: -0.2 },  kneel: 0.8, wave: 0 },
  launch:        { L: { x: 1.35, z: 0.1 }, R: { x: 0.55, z: -0.15 }, kneel: 1, wave: 0 },
  // --- the marshalling vocabulary (per the iPin chart) ---
  startEngines:  { L: { x: 0.05, z: 1.5 }, R: { x: 3.05, z: -0.05 }, kneel: 0, wave: 0 },            // right wand up, left points at the engine
  identifyGate:  { L: { x: 3.05, z: 0.06 }, R: { x: 3.05, z: -0.06 }, kneel: 0, wave: 0 },           // both wands straight up: "I have you"
  straightAhead: { L: { x: 2.35, z: 0.18, w: 1 }, R: { x: 2.35, z: -0.18, w: 1 }, kneel: 0, wave: 0.45 }, // beckon with both
  turnLeft:      { L: { x: 0.06, z: 1.5 }, R: { x: 2.35, z: -0.2, w: 1 }, kneel: 0, wave: 0.5 },     // left wand out pointing, right beckons
  turnRight:     { L: { x: 2.35, z: 0.2, w: 1 }, R: { x: 0.06, z: -1.5 }, kneel: 0, wave: 0.5 },     // mirror
  slowDown:      { L: { x: 0.6, z: 0.45, w: 1 }, R: { x: 0.6, z: -0.45, w: 1 }, kneel: 0, wave: 0.22 }, // wands low, patting down
  normalStop:    { L: { x: 3.0, z: 0.85 }, R: { x: 3.0, z: -0.85 }, kneel: 0, wave: 0 },             // wands crossed overhead
  cutEngines:    { L: { x: 0.12, z: 0.08 }, R: { x: 0.35, z: -0.65, w: 1 }, kneel: 0, wave: 0.12 },  // wand across the throat
  chocks:        { L: { x: 3.08, w: 1 }, R: { x: 3.08, w: 1 }, kneel: 0, wave: 0.05 },               // both up, held: chocks in
  guide:         { L: { x: 0.12, z: 0.08 }, R: { x: 3.05, z: -0.05 }, kneel: 0, wave: 0, bob: 1 },   // wingwalker: one wand up, marching
  guideHold:     { L: { x: 0.12, z: 0.08 }, R: { x: 3.05, z: -0.05 }, kneel: 0, wave: 0 },           // wand up, standing while the jet brakes
  walk:          { L: { x: 0.12, z: 0.10 }, R: { x: 0.12, z: -0.10 }, kneel: 0, wave: 0, bob: 1 },
  // legacy alias kept for the shooter logic below
  comeAhead:     { L: { x: 1.25, z: 0.25 }, R: { x: 1.25, z: -0.25 }, kneel: 0, wave: 0.35 },
  stop:          { L: { x: 3.0, z: 0.85 }, R: { x: 3.0, z: -0.85 }, kneel: 0, wave: 0 },
};

class CrewMember {
  constructor(carrier, shirt, role, x, z, faceY = 0) {
    this.role = role; this.x = x; this.z = z;
    this.g = buildFigure(shirt);
    this.g.position.set(x, carrier.deckY, z);
    this.g.rotation.y = faceY;
    carrier.group.add(this.g);
    this.u = this.g.userData;
    this.cur = { L: { x: 0.12, z: 0.1 }, R: { x: 0.12, z: -0.1 }, kneel: 0 };
    this.pose = 'idle'; this.subject = null;
    this.baseY = carrier.deckY; this.faceY = faceY;
    this.phase = Math.random() * 6.28;
    this._seq = null; this._sqT = 0;
  }
  // a timed signal routine: [[pose, seconds], ...] — overrides the per-frame pick
  play(steps) { this._seq = steps; this._sqT = 0; }
  seqPose(dt) {
    if (!this._seq) return null;
    this._sqT += dt;
    let acc = 0;
    for (const [p, s] of this._seq) {
      acc += s;
      if (this._sqT <= acc) return p;
    }
    this._seq = null;
    return null;
  }
  get busy() { return !!this._seq; }
  update(dt, t) {
    const P = POSES[this.pose] || POSES.idle;
    const k = Math.min(1, dt * 6);
    for (const side of ['L', 'R']) {
      const tgt = P[side], cur = this.cur[side];
      const wob = (P.wave && tgt.w) ? Math.sin(t * 7 + this.phase) * P.wave : 0;
      cur.x += (tgt.x + wob - cur.x) * k;
      cur.z += ((tgt.z || 0) - cur.z) * k;
      const piv = side === 'L' ? this.u.armL : this.u.armR;
      piv.rotation.x = cur.x;
      piv.rotation.z = cur.z;
    }
    this.cur.kneel += (P.kneel - this.cur.kneel) * k;
    const bob = P.bob ? Math.abs(Math.sin(t * 9 + this.phase)) * 0.09 : 0;
    this.g.position.y = this.baseY - this.cur.kneel * 0.55 + bob;
    this.u.legs.scale.y = 1 - this.cur.kneel * 0.55;
    this.u.legs.position.y = 0.4 * (1 - this.cur.kneel * 0.55);
    // face the subject aircraft, or hold the assigned facing
    if (this.subject) {
      const want = Math.atan2(this.subject.x - this.x, this.subject.z - this.z);
      let d = want - this.g.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.g.rotation.y += d * Math.min(1, dt * 5);
    } else {
      let d = this.faceY - this.g.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.g.rotation.y += d * Math.min(1, dt * 2);
    }
  }
}

const CAT1 = { x: -13, z: 30 }, CAT2 = { x: 11, z: 30 };

export class DeckCrew {
  constructor(carrier) {
    this.carrier = carrier; this.t = 0;
    this.members = [
      // the shooters: one knee beside each shuttle, point down the track
      new CrewMember(carrier, 'yellow', 'shooter1', -8.2, 34, Math.PI),   // Cat 1 (the player's)
      new CrewMember(carrier, 'yellow', 'shooter2', 15.8, 34, Math.PI),   // Cat 2
      // green shirts — catapult crew standing by their JBDs
      new CrewMember(carrier, 'green', 'idle', -8.2, 12, Math.PI),
      new CrewMember(carrier, 'green', 'idle', 15.8, 12, Math.PI),
      // yellow directors: one works the cat-2 taxi lane, one works the recovery
      new CrewMember(carrier, 'yellow', 'directorCat', 19, -4),
      new CrewMember(carrier, 'yellow', 'directorAft', -2, -56),
      // the wingwalker: marches the starboard wingtip of every taxiing jet
      new CrewMember(carrier, 'yellow', 'walker', 18, -20, Math.PI),
      // blue handlers crouched on the tie-downs along the port row
      new CrewMember(carrier, 'blue', 'crouch', -23.2, 88),
      new CrewMember(carrier, 'blue', 'crouch', -23.2, 60),
      // ordnance reds by the island, the plane captain and fuel purple on the row
      new CrewMember(carrier, 'red', 'idle', 21, 52, -Math.PI / 2),
      new CrewMember(carrier, 'red', 'idle', 21, 44, -Math.PI / 2),
      new CrewMember(carrier, 'brown', 'idle', -22.5, 102, Math.PI),
      new CrewMember(carrier, 'purple', 'idle', -22.5, 74, Math.PI),
    ];
    this.byRole = {};
    for (const m of this.members) this.byRole[m.role] = m;
    // mover tracking for turn-signal geometry and arrival edges
    this._mvPrev = null;        // last deck-local mover position
    this._mvPrevMode = null;
    this._taxiT = 0;            // time since the mover started taxiing
    // player choreography state
    this._playerWasOnDeck = false;
    this._playerParkSeq = 0;    // 0 = taxiing, 1 = stop routine done, reset on movement
    this._catSeqDone = false;
  }

  // which way should the jet turn? cross of current motion vs next leg, and an
  // arm picked so the pointing wand genuinely aims at the turn side
  _turnSignal(m, mv, moveDir, nextDir) {
    const cross = moveDir.x * nextDir.z - moveDir.z * nextDir.x;
    if (Math.abs(cross) < 0.30) return null;
    // lateral direction the jet should veer toward (deck-local)
    const lat = cross > 0 ? { x: -moveDir.z, z: moveDir.x } : { x: moveDir.z, z: -moveDir.x };
    // the member's right-arm direction under its current facing
    const f = m.g.rotation.y;
    const armR = { x: Math.cos(f), z: -Math.sin(f) };
    const dot = armR.x * lat.x + armR.z * lat.z;
    return dot >= 0 ? 'turnRight' : 'turnLeft';
  }

  update(dt, G) {
    this.t += dt;
    const aw = G.airWing;
    // the taxi director works whichever jet is on the move — the deck token is
    // the official claim, but a braked jet briefly drops it and still needs wands
    let mover = aw && aw._mover && !aw._mover.dead ? aw._mover : null;
    if (!mover && aw && aw.airframes)
      mover = aw.airframes.find(j => (j.mode === 'taxiCat' || j.mode === 'taxiPark') && !j.dead) || null;
    const P = G.player, og = P && P.onGround;
    const playerOnDeck = !!(og && og.type === 'carrier');
    const pSpeed = P && P.vel ? P.vel.length() : 0;

    // ---- edges: player rolls on board (fresh start, not a trap) → START ENGINES
    if (playerOnDeck && !this._playerWasOnDeck && !og.trapped) {
      const d = this.byRole.directorCat;
      if (d && !d.busy) d.play([['startEngines', 3.0], ['identifyGate', 2.2]]);
      this._catSeqDone = false;
    }
    this._playerWasOnDeck = playerOnDeck;

    // ---- edges: the air-wing mover changes state
    const mvMode = mover ? mover.mode : null;
    if (mvMode !== this._mvPrevMode) {
      if (mover && mvMode === 'taxiCat') {
        // engine start, then the director picks the jet up
        const d = this.byRole.directorCat;
        if (d && !d.busy) d.play([['startEngines', 2.6], ['identifyGate', 2.2]]);
        this._taxiT = 0;
      } else if (mover && mvMode === 'taxiPark') {
        const d = this.byRole.directorAft;
        if (d && !d.busy) d.play([['identifyGate', 2.0]]);
        this._taxiT = 0;
      } else if (this._mvPrevMode === 'taxiCat' && (mvMode === 'hold' || mvMode === null)) {
        // reached the cat: stop, cut, chocks
        const d = this.byRole.directorCat;
        if (d && !d.busy) d.play([['normalStop', 1.6], ['cutEngines', 2.8], ['chocks', 2.4]]);
      } else if (this._mvPrevMode === 'taxiPark' && (mvMode === 'parked' || mvMode === null)) {
        const d = this.byRole.directorAft;
        if (d && !d.busy) d.play([['normalStop', 1.6], ['cutEngines', 2.8], ['chocks', 2.4]]);
      }
      this._mvPrevMode = mvMode;
    }
    const taxiing = mover && (mover.mode === 'taxiCat' || mover.mode === 'taxiPark');
    if (taxiing) this._taxiT += dt;

    // movement direction of the mover (for TURN geometry)
    let moveDir = null, nextDir = null;
    if (taxiing && this._mvPrev) {
      const mx = mover.dl.x - this._mvPrev.x, mz = mover.dl.z - this._mvPrev.z;
      const ml = Math.hypot(mx, mz);
      if (ml > 0.005) moveDir = { x: mx / ml, z: mz / ml };
      if (mover._path && mover._path.length) {
        const nx = mover._path[0].x - mover.dl.x, nz = mover._path[0].z - mover.dl.z;
        const nl = Math.hypot(nx, nz);
        if (nl > 0.05) nextDir = { x: nx / nl, z: nz / nl, dist: nl, last: mover._path.length === 1 };
      }
    }
    if (mover) this._mvPrev = { x: mover.dl.x, z: mover.dl.z };

    for (const m of this.members) {
      let pose = m.role === 'crouch' ? 'crouch' : 'idle', subject = null;

      if (m.role === 'shooter1') {
        // the player's shooter: kneel and point once she's at military power,
        // hold it through the shot, stand when the deck is clear again
        if (playerOnDeck && og.cat && !og.catFired && P.throttle > 0.55) { pose = 'launch'; subject = { x: -13, z: 150 }; }
      } else if (m.role === 'shooter2') {
        if (mover && (mover.mode === 'hold' || (mover.mode === 'launch' && mover._t < 1.5))) { pose = 'launch'; subject = { x: 11, z: 150 }; }
      } else if (m.role === 'directorCat') {
        // marshals the mover up the cat-2 lane — and the player, when she's
        // taxiing for Cat 1 under her own power
        if (taxiing && mover.mode === 'taxiCat') {
          subject = mover.dl;
          if (this._taxiT < 4.8) pose = m.pose;             // start-engines / identify routine running
          else if ((mover.speed || 0) < 0.2) pose = 'stop';  // brakes on — hold her there
          else if (nextDir && nextDir.last && nextDir.dist < 11) pose = 'slowDown';
          else if (moveDir && nextDir) pose = this._turnSignal(m, mover, moveDir, nextDir) || 'straightAhead';
          else pose = 'straightAhead';
        } else if (mover && (mover.mode === 'hold' || mover.mode === 'launch')) {
          pose = 'stop'; subject = mover.dl;
        } else if (playerOnDeck && !og.trapped && !og.cat && pSpeed > 2 && P.deckLocal.z > -10) {
          // player taxiing forward for the cat: wave her in, slow her at the track
          subject = { x: P.deckLocal.x, z: P.deckLocal.z };
          const dCat = Math.hypot(P.deckLocal.x - CAT1.x, P.deckLocal.z - CAT1.z);
          pose = dCat < 12 ? 'slowDown' : 'straightAhead';
        } else if (playerOnDeck && !og.trapped && og.cat && !og.catFired) {
          // on the shuttle: cross the wands, then chocks until she throttles up
          subject = { x: P.deckLocal.x, z: P.deckLocal.z };
          if (!this._catSeqDone && !m.busy) { m.play([['normalStop', 1.4], ['chocks', 2.4]]); this._catSeqDone = true; }
          pose = P.throttle > 0.55 ? 'stop' : (m.busy ? m.pose : 'stop');
        }
      } else if (m.role === 'directorAft') {
        // recovery director: marshals the trap survivors and the player to parking
        if (taxiing && mover.mode === 'taxiPark') {
          subject = mover.dl;
          if (this._taxiT < 2.0) pose = m.pose;             // identify-gate routine running
          else if ((mover.speed || 0) < 0.2) pose = 'stop';  // brakes on — hold her there
          else if (nextDir && nextDir.last && nextDir.dist < 11) pose = 'slowDown';
          else if (moveDir && nextDir) pose = this._turnSignal(m, mover, moveDir, nextDir) || 'straightAhead';
          else pose = 'straightAhead';
        } else if (playerOnDeck && og.trapped && !og.cat) {
          // the player, fresh out of the wires: wave her up, slow her down,
          // then stop / cut / chocks once she halts
          subject = { x: P.deckLocal.x, z: P.deckLocal.z };
          if (pSpeed > 8) { pose = 'straightAhead'; this._playerParkSeq = 0; }
          else if (pSpeed > 2) { pose = 'slowDown'; this._playerParkSeq = 0; }
          else if (!this._playerParkSeq && !m.busy) {
            m.play([['normalStop', 1.6], ['cutEngines', 2.8], ['chocks', 2.4]]);
            this._playerParkSeq = 1;
          }
          if (this._playerParkSeq && !m.busy) pose = 'idle';
        } else this._playerParkSeq = 0;
      } else if (m.role === 'walker') {
        // wingwalker: marches the starboard wingtip, one wand up, all the way —
        // and stands fast with the wand up whenever the jet brakes
        if (taxiing && !moveDir) {
          pose = 'guideHold'; subject = { x: mover.dl.x, z: mover.dl.z };
        } else if (taxiing && moveDir) {
          const lat = { x: -moveDir.z, z: moveDir.x };   // starboard wingtip
          const tx = mover.dl.x + lat.x * 3.4 + moveDir.x * 1.5;
          const tz = mover.dl.z + lat.z * 3.4 + moveDir.z * 1.5;
          const k = Math.min(1, dt * 7);
          m.x += (Math.max(-24, Math.min(24, tx)) - m.x) * k;
          m.z += (Math.max(-70, Math.min(105, tz)) - m.z) * k;
          m.g.position.x = m.x; m.g.position.z = m.z;
          pose = (mover.speed || 0) > 0.2 ? 'guide' : 'guideHold';
          subject = { x: mover.dl.x + moveDir.x * 10, z: mover.dl.z + moveDir.z * 10 };
        } else {
          // march back to his station by the island
          const dx = 18 - m.x, dz = -20 - m.z;
          const far = Math.hypot(dx, dz) > 1.5;
          if (far) {
            const k = Math.min(1, dt * 2.2 / Math.hypot(dx, dz));
            m.x += dx * k; m.z += dz * k;
            m.g.position.x = m.x; m.g.position.z = m.z;
            pose = 'walk'; subject = { x: 18, z: -20 };
          } else pose = 'idle';
        }
      }

      // a timed routine in progress wins the arms
      const sp = m.seqPose(dt);
      if (sp) pose = sp;
      m.pose = pose; m.subject = subject;
      m.update(dt, this.t);
    }
  }
}
