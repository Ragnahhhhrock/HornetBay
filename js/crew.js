// ---------------- flight deck crew — the colored shirts ----------------
// Yellow shirts direct and shoot, green run the cats, blue handle the planes,
// red is ordnance, brown the plane captain, purple fuel. They wave the air
// wing through its day: recovery to parking, parking to the cat, the shoot.
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

// pose targets: shoulder rotation x (0 = arm down, π/2 = forward level, π = overhead)
// plus a kneel factor and an optional wave that oscillates the beckoning arms
const POSES = {
  idle:      { L: { x: 0.12, z: 0.10 }, R: { x: 0.12, z: -0.10 }, kneel: 0, wave: 0 },
  crouch:    { L: { x: 0.9, z: 0.2 },  R: { x: 0.9, z: -0.2 },  kneel: 0.8, wave: 0 },
  comeAhead: { L: { x: 1.25, z: 0.25 }, R: { x: 1.25, z: -0.25 }, kneel: 0, wave: 0.35 },
  stop:      { L: { x: 2.75, z: -0.55 }, R: { x: 2.75, z: 0.55 }, kneel: 0, wave: 0 },
  launch:    { L: { x: 1.35, z: 0.1 }, R: { x: 0.55, z: -0.15 }, kneel: 1, wave: 0 },
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
  }
  update(dt, t) {
    const P = POSES[this.pose] || POSES.idle;
    const k = Math.min(1, dt * 6);
    const wob = P.wave ? Math.sin(t * 7 + this.phase) * P.wave : 0;
    for (const side of ['L', 'R']) {
      const tgt = P[side], cur = this.cur[side];
      cur.x += (tgt.x + wob - cur.x) * k;
      cur.z += (tgt.z - cur.z) * k;
      const piv = side === 'L' ? this.u.armL : this.u.armR;
      piv.rotation.x = cur.x;
      piv.rotation.z = cur.z;
    }
    this.cur.kneel += (P.kneel - this.cur.kneel) * k;
    this.g.position.y = this.baseY - this.cur.kneel * 0.55;
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

export class DeckCrew {
  constructor(carrier) {
    this.carrier = carrier; this.t = 0;
    const D = carrier.deckY;
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
      // blue handlers crouched on the tie-downs along the port row
      new CrewMember(carrier, 'blue', 'crouch', -23.2, 88),
      new CrewMember(carrier, 'blue', 'crouch', -23.2, 60),
      // ordnance reds by the island, the plane captain and fuel purple on the row
      new CrewMember(carrier, 'red', 'idle', 21, 52, -Math.PI / 2),
      new CrewMember(carrier, 'red', 'idle', 21, 44, -Math.PI / 2),
      new CrewMember(carrier, 'brown', 'idle', -22.5, 102, Math.PI),
      new CrewMember(carrier, 'purple', 'idle', -22.5, 74, Math.PI),
    ];
  }

  update(dt, G) {
    this.t += dt;
    const aw = G.airWing;
    const mover = aw && aw._mover && !aw._mover.dead ? aw._mover : null;
    const P = G.player, og = P && P.onGround;
    const playerOnDeck = !!(og && og.type === 'carrier');
    for (const m of this.members) {
      let pose = m.role === 'crouch' ? 'crouch' : 'idle', subject = null;
      if (m.role === 'shooter1') {
        // the player's shooter: kneel and point once she's at military power,
        // hold it through the shot, stand when the deck is clear again
        if (playerOnDeck && og.cat && !og.catFired && P.throttle > 0.55) { pose = 'launch'; subject = { x: -13, z: 150 }; }
      } else if (m.role === 'shooter2') {
        if (mover && (mover.mode === 'hold' || (mover.mode === 'launch' && mover._t < 1.5))) { pose = 'launch'; subject = { x: 11, z: 150 }; }
      } else if (m.role === 'directorCat') {
        // marshals the air wing's mover up the cat-2 lane, crosses wands at the hold
        if (mover && mover.mode === 'taxiCat') { pose = 'comeAhead'; subject = mover.dl; }
        else if (mover && (mover.mode === 'hold' || mover.mode === 'launch')) { pose = 'stop'; subject = mover.dl; }
      } else if (m.role === 'directorAft') {
        // recovery director: waves the trap survivors and the player toward parking
        if (mover && mover.mode === 'taxiPark') { pose = 'comeAhead'; subject = mover.dl; }
        else if (playerOnDeck && og.trapped && !og.cat && P.vel.length() > 1.5) { pose = 'comeAhead'; subject = { x: P.deckLocal.x, z: P.deckLocal.z }; }
        else if (playerOnDeck && og.trapped && !og.cat) { pose = 'stop'; subject = { x: P.deckLocal.x, z: P.deckLocal.z }; }
      }
      m.pose = pose; m.subject = subject;
      m.update(dt, this.t);
    }
  }
}
