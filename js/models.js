// models.js — procedural low-poly aircraft (nose = +Z, up = +Y, right = +X)
import * as THREE from 'three';

function M(color, opts = {}) {
  return new THREE.MeshLambertMaterial(Object.assign({ color, flatShading: true }, opts));
}
function wingGeo(points, thick) {
  // points: [[span, chordZ], ...] planform outline in XY, extruded in Z then laid flat
  const sh = new THREE.Shape();
  sh.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) sh.lineTo(points[i][0], points[i][1]);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // -> lies in XZ, thickness in Y
  g.translate(0, thick / 2, 0);
  return g;
}
function cone(r, len, color, segs = 8) {
  const g = new THREE.ConeGeometry(r, len, segs);
  g.rotateX(Math.PI / 2); // point along +Z
  return new THREE.Mesh(g, M(color));
}
function box(w, h, d, color) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(color)); }
function cyl(r1, r2, len, color, segs = 10) {
  const g = new THREE.CylinderGeometry(r1, r2, len, segs);
  g.rotateX(Math.PI / 2); // axis along Z
  return new THREE.Mesh(g, M(color));
}
function abFlame(len = 3.4, r = 0.5) {
  const g = new THREE.ConeGeometry(r, len, 8);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.visible = false;
  return m;
}
function missileMesh(color = 0xe8e8e8, len = 3, r = 0.14) {
  const g = new THREE.Group();
  const b = cyl(r, r, len * 0.75, color, 6); g.add(b);
  const n = cone(r, len * 0.25, 0xc03030, 6); n.position.z = len * 0.5; g.add(n);
  const f1 = box(0.5, 0.04, 0.4, color); f1.position.z = -len * 0.25; g.add(f1);
  const f2 = box(0.04, 0.5, 0.4, color); f2.position.z = -len * 0.25; g.add(f2);
  return g;
}

// ---------------- F/A-18 Hornet ----------------
// navigation lights — red port (+X is the left wing), green starboard, white
// tail; collected in userData.nav so the game can toggle them with the sun
let _navTex = null, _navMats = null;
function addNavLights(g, halfSpan, tailZ, y = 1) {
  if (!_navTex) _navTex = makeGlowTexture();
  if (!_navMats) _navMats = {
    r: new THREE.SpriteMaterial({ map: _navTex, color: 0xff2020, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    g: new THREE.SpriteMaterial({ map: _navTex, color: 0x28ff40, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    w: new THREE.SpriteMaterial({ map: _navTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  };
  if (!g.userData.nav) g.userData.nav = [];
  const mk = (mat, x, yy, z, role, scale = 1.1) => {
    const sp = new THREE.Sprite(mat);
    sp.scale.setScalar(scale); sp.position.set(x, yy, z); sp.visible = false;
    sp.userData.role = role; sp.userData.phase = Math.random(); sp.userData.base = scale;
    g.add(sp); g.userData.nav.push(sp);
  };
  mk(_navMats.r, halfSpan, y, 0, 'pos');              // steady red port
  mk(_navMats.g, -halfSpan, y, 0, 'pos');             // steady green starboard
  mk(_navMats.w, 0, y + 0.5, tailZ, 'strobe', 1.5);   // white tail strobe, double-flash
  mk(_navMats.r, 0, y + 0.9, tailZ * 0.35, 'beacon', 1.05);  // red anti-collision beacon
}

export function buildFA18() {
  const g = new THREE.Group();
  const C = 0xa8b4bc, CD = 0x8a98a0;
  const fus = box(2.0, 1.7, 9.5, C); fus.position.z = -0.8; g.add(fus);
  const spine = box(1.5, 0.5, 6, CD); spine.position.set(0, 1.0, -2); g.add(spine);
  // dorsal antenna blade behind the canopy
  const ant = box(0.07, 0.4, 0.55, CD); ant.position.set(0, 1.35, -0.6); g.add(ant);
  // slender radome with a hint of the real jet's droop
  const nose = cone(0.82, 5.0, C); nose.scale.set(1.12, 0.88, 1); nose.position.z = 6.4; g.add(nose);
  // teardrop bubble canopy — tinted gold/green like the real laminated glass
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8),
    M(0x5a707c));
  canopy.scale.set(0.8, 0.6, 2.3); canopy.position.set(0, 0.98, 3.15); g.add(canopy);
  // LEX — long ogival strakes running from the cockpit back into the wing
  const lexG = wingGeo([[0.4, 5.3], [2.2, 0.4], [0.4, 0.4]], 0.12);
  for (const s of [1, -1]) {
    const lex = new THREE.Mesh(lexG, M(CD)); lex.scale.x = s; lex.position.set(0, 0.35, 0.6); g.add(lex);
  }
  // main wing — trapezoid, taper ~0.3 like the real planform
  const wG = wingGeo([[0.8, 1.9], [0.8, -3.4], [6.6, -2.6], [6.6, -0.9]], 0.22);
  for (const s of [1, -1]) {
    const w = new THREE.Mesh(wG, M(C)); w.scale.x = s; w.position.y = 0.15; g.add(w);
  }
  // twin canted tails on the rear shelf, outboard of the nozzles
  const tG = wingGeo([[0, 0.4], [0, -2.0], [2.6, -2.9], [2.6, -2.2]], 0.16);
  for (const s of [1, -1]) {
    const t = new THREE.Mesh(tG, M(C));
    t.rotation.z = Math.PI / 2 - s * 0.31;
    t.position.set(s * 2.0, 0.65, -3.2); g.add(t);
  }
  // engines + nozzles + AB
  const ab = [];
  for (const s of [1, -1]) {
    const e = cyl(0.72, 0.62, 4.6, CD); e.position.set(s * 0.85, -0.1, -5.6); g.add(e);
    const nz = cyl(0.55, 0.42, 1.2, 0x33383e); nz.position.set(s * 0.85, -0.1, -8.2); g.add(nz);
    const ni = cyl(0.38, 0.38, 0.18, 0x0a0a0c); ni.position.set(s * 0.85, -0.1, -8.72); g.add(ni);   // dark tailpipe
    const f = abFlame(3.6, 0.5); f.position.set(s * 0.85, -0.1, -9.6); g.add(f); ab.push(f);
    // D-shaped intakes under the LEX, with dark splitter-gap mouths
    const it = box(0.95, 0.85, 2.8, CD); it.position.set(s * 1.15, -0.5, 0.9); g.add(it);
    const mouth = box(0.7, 0.62, 0.12, 0x0c0e10); mouth.position.set(s * 1.15, -0.5, 2.34); g.add(mouth);
  }
  // centre "beaver tail" fairing between the nozzles (hook attach point)
  const bt = box(0.34, 0.5, 2.0, CD); bt.position.set(0, -0.15, -7.7); g.add(bt);
  // stabilators (animated with pitch)
  const sG = wingGeo([[0.3, 0.3], [0.3, -1.8], [3.5, -1.5], [3.5, -0.3]], 0.14);
  const stabL = new THREE.Mesh(sG, M(C)); stabL.position.set(0.4, 0.1, -6.5); g.add(stabL);
  const stabR = new THREE.Mesh(sG, M(C)); stabR.scale.x = -1; stabR.position.set(-0.4, 0.1, -6.5); g.add(stabR);
  // gear
  const gear = new THREE.Group();
  const gm = M(0x2c3136);
  const mkWheel = (x, y, z) => {
    const w = new THREE.Group();
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.4, 6), gm); strut.position.y = 0.7; w.add(strut);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10), gm);
    tire.rotation.z = Math.PI / 2; tire.position.y = 0.1; w.add(tire);
    w.position.set(x, y, z); return w;
  };
  gear.add(mkWheel(0, -2.1, 3.6), mkWheel(1.1, -2.1, -1.4), mkWheel(-1.1, -2.1, -1.4));
  g.add(gear);
  // tailhook (stows under the beaver tail)
  const hook = box(0.1, 0.1, 2.6, 0xcccccc); hook.position.set(0, -0.45, -8.3);
  hook.rotation.x = -0.5; hook.visible = false; g.add(hook);
  // weapons (visual)
  const stores = { aim9: [], aim120: [] };
  for (const s of [1, -1]) {
    const m9 = missileMesh(0xe8e8e8, 2.9, 0.13); m9.position.set(s * 6.6, -0.1, -1.7); g.add(m9); stores.aim9.push(m9);
    for (const px of [2.6, 4.4]) {
      const m120 = missileMesh(0xd8d8d8, 3.6, 0.16); m120.position.set(s * px, -0.55, -1.8); g.add(m120); stores.aim120.push(m120);
    }
  }
  g.userData = { ab, gear, hook, stabL, stabR, stores, type: 'f18' };
  addNavLights(g, 6.8, -8.5, 1.0);
  return g;
}

// ---------------- F-16 Fighting Falcon ----------------
export function buildF16() {
  const g = new THREE.Group();
  const C = 0xa8b4bc, CD = 0x8a98a0;
  const fus = box(1.7, 1.5, 9, C); fus.position.z = -0.6; g.add(fus);
  // low spine blending the bubble canopy into the fin
  const spine = box(0.9, 0.3, 4.2, CD); spine.position.set(0, 0.8, -1.4); g.add(spine);
  // long, slender, distinctly dark radome
  const nose = cone(0.68, 4.4, 0x42484e); nose.position.z = 6.1; g.add(nose);
  // the famous frameless bubble canopy — tall gold-tinted teardrop
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8),
    M(0x6a7a80));
  canopy.scale.set(0.85, 0.75, 2.2); canopy.position.set(0, 0.95, 2.5); g.add(canopy);
  // chin ("mouth") intake under the forward fuselage, dark scoop opening
  const intake = box(1.2, 0.65, 2.4, CD); intake.position.set(0, -0.75, 2.1); g.add(intake);
  const mouth = box(0.95, 0.45, 0.12, 0x0c0e10); mouth.position.set(0, -0.75, 3.32); g.add(mouth);
  // M61 Vulcan port — left cheek above the wing root
  const gun = box(0.06, 0.2, 0.55, 0x14161a); gun.position.set(0.86, 0.3, 0.6); g.add(gun);
  // cropped-delta wing
  const wG = wingGeo([[0.7, 1.3], [0.7, -3.2], [5.4, -3.4], [5.4, -2.6]], 0.2);
  for (const s of [1, -1]) { const w = new THREE.Mesh(wG, M(C)); w.scale.x = s; w.position.y = 0.05; g.add(w); }
  // single tall fin
  const tG = wingGeo([[0, 0.6], [0, -2.4], [3.6, -3.4], [3.6, -2.6]], 0.16);
  const tail = new THREE.Mesh(tG, M(C)); tail.rotation.z = Math.PI / 2; tail.position.set(0, 0.5, -3.2); g.add(tail);
  // twin ventral fins under the engine, angled out
  for (const s of [1, -1]) {
    const vf = box(0.12, 1.0, 1.4, CD); vf.position.set(s * 0.55, -0.85, -5.3); vf.rotation.z = -s * 0.15; g.add(vf);
  }
  const e = cyl(0.75, 0.6, 4.4, CD); e.position.set(0, -0.05, -5.2); g.add(e);
  const nz = cyl(0.55, 0.42, 1.1, 0x33383e); nz.position.set(0, -0.05, -7.6); g.add(nz);
  const ni = cyl(0.38, 0.38, 0.18, 0x0a0a0c); ni.position.set(0, -0.05, -8.05); g.add(ni);   // dark tailpipe
  const f = abFlame(3.4, 0.5); f.position.set(0, -0.05, -8.9); g.add(f);
  // stabilators ride low at the tail
  const sG = wingGeo([[0.3, 0.2], [0.3, -1.5], [3.0, -1.3], [3.0, -0.4]], 0.13);
  const stabL = new THREE.Mesh(sG, M(C)); stabL.position.set(0.3, -0.3, -5.6); g.add(stabL);
  const stabR = new THREE.Mesh(sG, M(C)); stabR.scale.x = -1; stabR.position.set(-0.3, -0.3, -5.6); g.add(stabR);
  const gear = new THREE.Group();
  const gm = M(0x2c3136);
  const mkWheel = (x, y, z) => {
    const w = new THREE.Group();
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.3, 6), gm); strut.position.y = 0.65; w.add(strut);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 10), gm);
    tire.rotation.z = Math.PI / 2; tire.position.y = 0.08; w.add(tire);
    w.position.set(x, y, z); return w;
  };
  gear.add(mkWheel(0, -1.9, 3.2), mkWheel(1.0, -1.9, -1.2), mkWheel(-1.0, -1.9, -1.2));
  g.add(gear);
  // no tailhook — the F-16 is land-based only
  const stores = { aim9: [], aim120: [] };
  for (const s of [1, -1]) {
    const m9 = missileMesh(0xe8e8e8, 2.9, 0.13); m9.position.set(s * 5.4, -0.05, -3.0); g.add(m9); stores.aim9.push(m9);
    for (const px of [2.2, 3.8]) {
      const m120 = missileMesh(0xd8d8d8, 3.6, 0.16); m120.position.set(s * px, -0.5, -2.2); g.add(m120); stores.aim120.push(m120);
    }
  }
  g.userData = { ab: [f], gear, hook: null, stabL, stabR, stores, type: 'f16' };
  addNavLights(g, 5.5, -8.0, 0.8);
  return g;
}

// ---------------- F-14 Tomcat (VF-84 Jolly Rogers, 1978) ----------------
let _jollyTex = null;
function jollyRogersDecal(w = 3.6, h = 3.0) {
  if (!_jollyTex) {
    const c = document.createElement('canvas'); c.width = 192; c.height = 256;
    const x = c.getContext('2d');
    // black fin with the yellow tip band
    x.fillStyle = '#101114'; x.fillRect(0, 0, 192, 256);
    x.fillStyle = '#f0b41c'; x.fillRect(0, 0, 192, 26);
    x.fillStyle = '#101114'; x.fillRect(0, 26, 192, 5);
    // crossbones — two white rounded bars in an X, behind the skull
    x.strokeStyle = '#f2f2f2'; x.lineCap = 'round'; x.lineWidth = 13;
    x.beginPath(); x.moveTo(46, 118); x.lineTo(148, 198); x.stroke();
    x.beginPath(); x.moveTo(148, 118); x.lineTo(46, 198); x.stroke();
    // skull
    x.fillStyle = '#f2f2f2';
    x.beginPath(); x.arc(96, 108, 40, 0, Math.PI * 2); x.fill();        // cranium
    x.fillRect(66, 108, 60, 38);                                        // jaw
    x.fillStyle = '#101114';
    x.beginPath(); x.ellipse(81, 103, 10, 13, 0.25, 0, Math.PI * 2); x.fill();  // eyes
    x.beginPath(); x.ellipse(111, 103, 10, 13, -0.25, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.moveTo(96, 116); x.lineTo(89, 130); x.lineTo(103, 130); x.closePath(); x.fill();  // nose
    x.lineWidth = 3; x.lineCap = 'butt'; x.strokeStyle = '#101114';
    for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(74 + i * 12, 134); x.lineTo(74 + i * 12, 146); x.stroke(); }  // teeth
    // AJ / 200 below
    x.fillStyle = '#f2f2f2'; x.font = 'bold 30px "Courier New", monospace'; x.textAlign = 'center';
    x.fillText('AJ', 96, 226);
    x.font = 'bold 22px "Courier New", monospace';
    x.fillText('200', 96, 250);
    _jollyTex = new THREE.CanvasTexture(c);
  }
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: _jollyTex, transparent: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1 }));
}

export function buildF14() {
  const g = new THREE.Group();
  const C = 0xb8bfc4, CD = 0x96a0a6;          // light gull gray over white, 1978 scheme
  // flat "pancake" body between the widely spaced engines — the Tomcat signature
  const pan = box(4.6, 0.95, 10.5, C); pan.position.set(0, -0.05, -1.6); g.add(pan);
  const fwd = box(2.1, 1.5, 6.8, C); fwd.position.set(0, 0.25, 3.4); g.add(fwd);
  // black anti-glare band from radome back over the canopy (the top-view mark)
  const ag = box(1.9, 0.1, 4.2, 0x111417); ag.position.set(0, 1.02, 4.0); g.add(ag);
  // long pointed radome, a hint of droop
  const nose = cone(0.74, 4.4, C); nose.scale.set(1.05, 0.9, 1); nose.position.z = 8.4; g.add(nose);
  // two-seat bubble under the black band
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8), M(0x4a5c66));
  canopy.scale.set(0.85, 0.55, 2.4); canopy.position.set(0, 1.0, 4.1); g.add(canopy);
  const spine = box(1.7, 0.5, 5.5, CD); spine.position.set(0, 0.8, -1.2); g.add(spine);
  // M61 Vulcan port in the left cheek
  const gun = box(0.06, 0.2, 0.55, 0x14161a); gun.position.set(1.08, 0.3, 3.4); g.add(gun);
  // fixed gloves — highly swept root sections the swing wings pivot out of
  const glG = wingGeo([[0.9, 3.4], [0.9, -2.8], [3.3, -2.1], [3.3, 0.6]], 0.18);
  for (const s of [1, -1]) {
    const gl = new THREE.Mesh(glG, M(C)); gl.scale.x = s; gl.position.y = 0.2; g.add(gl);
  }
  // variable-sweep wings on their pivots (20 deg spread -> 68 deg swept)
  const wG = wingGeo([[0, 0.7], [0, -2.5], [6.4, -2.2], [6.4, -0.5]], 0.2);
  const wings = {};
  for (const s of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 3.1, 0.25, 0.4);
    const w = new THREE.Mesh(wG, M(C)); w.scale.x = s;
    pivot.add(w);
    // pivot-cap fairing + wingtip rail
    const rail = box(0.35, 0.12, 3.2, CD); rail.position.set(s * 5.6, 0.14, -1.4); pivot.add(rail);
    g.add(pivot);
    wings[s === 1 ? 'l' : 'r'] = pivot;
  }
  // twin verticals on the nacelle tops — Jolly Rogers on both outer faces
  const tG = wingGeo([[0, 0.6], [0, -2.9], [3.5, -3.7], [3.5, -3.0]], 0.15);
  for (const s of [1, -1]) {
    const t = new THREE.Mesh(tG, M(0x1a1c20));
    t.rotation.z = Math.PI / 2;
    t.position.set(s * 2.3, 0.4, -3.6); g.add(t);
    const decal = jollyRogersDecal(3.3, 2.8);
    decal.rotation.y = s * Math.PI / 2;
    decal.scale.x = s;                          // un-mirror the skull on the port face
    decal.position.set(s * (2.3 + 0.09), 2.15, -5.0);
    g.add(decal);
  }
  // engines, nozzles, the beavertail between them
  const ab = [];
  for (const s of [1, -1]) {
    const e = cyl(0.62, 0.55, 4.8, CD); e.position.set(s * 2.2, -0.4, -5.6); g.add(e);
    const nz = cyl(0.5, 0.4, 1.1, 0x33383e); nz.position.set(s * 2.2, -0.4, -8.3); g.add(nz);
    const ni = cyl(0.36, 0.36, 0.18, 0x0a0a0c); ni.position.set(s * 2.2, -0.4, -8.75); g.add(ni);
    const f = abFlame(3.8, 0.55); f.position.set(s * 2.2, -0.4, -9.7); g.add(f); ab.push(f);
    // boxy chin intake ahead of each nacelle
    const it = box(1.05, 0.9, 2.6, CD); it.position.set(s * 2.2, -0.45, 0.6); g.add(it);
    const mouth = box(0.85, 0.68, 0.12, 0x0c0e10); mouth.position.set(s * 2.2, -0.45, 1.95); g.add(mouth);
  }
  const bt = box(0.5, 0.35, 2.6, CD); bt.position.set(0, -0.2, -7.8); g.add(bt);
  // huge all-moving stabilators
  const sG = wingGeo([[0.4, 0.4], [0.4, -1.7], [3.7, -1.4], [3.7, -0.2]], 0.15);
  const stabL = new THREE.Mesh(sG, M(C)); stabL.position.set(0.5, -0.25, -6.7); g.add(stabL);
  const stabR = new THREE.Mesh(sG, M(C)); stabR.scale.x = -1; stabR.position.set(-0.5, -0.25, -6.7); g.add(stabR);
  // gear — twin-wheel nose gear, mains into the pancake
  const gear = new THREE.Group();
  const gm = M(0x2c3136);
  const mkWheel = (x, y, z, twin = false) => {
    const w = new THREE.Group();
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.5, 6), gm); strut.position.y = 0.75; w.add(strut);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10), gm);
    tire.rotation.z = Math.PI / 2; tire.position.y = 0.12; w.add(tire);
    if (twin) { const t2 = tire.clone(); t2.position.x += 0.2; tire.position.x -= 0.2; w.add(t2); }
    w.position.set(x, y, z); return w;
  };
  gear.add(mkWheel(0, -2.3, 4.4, true), mkWheel(1.9, -2.3, -1.2), mkWheel(-1.9, -2.3, -1.2));
  g.add(gear);
  // tailhook between the nozzles
  const hook = box(0.12, 0.12, 3.0, 0xcccccc); hook.position.set(0, -0.55, -8.5);
  hook.rotation.x = -0.5; hook.visible = false; g.add(hook);
  // stores: 4x AIM-54 Phoenix in the tunnel, 2x AIM-9 on glove pylons
  const stores = { aim9: [], aim54: [] };
  for (const s of [1, -1]) {
    const py = box(0.16, 0.5, 1.2, CD); py.position.set(s * 3.0, -0.35, -0.8); g.add(py);
    const m9 = missileMesh(0xe8e8e8, 2.9, 0.13); m9.position.set(s * 3.0, -0.75, -0.8); g.add(m9); stores.aim9.push(m9);
    for (const pz of [1.4, -2.4]) {
      const m54 = missileMesh(0xf0f0f0, 4.0, 0.19); m54.position.set(s * 0.55, -0.85, pz); g.add(m54); stores.aim54.push(m54);
    }
  }
  g.userData = { ab, gear, hook, stabL, stabR, stores, wings, tipX: 9.5, type: 'f14' };
  addNavLights(g, 9.5, -8.8, 0.6);
  return g;
}

// ---------------- MiG-29 Fulcrum ----------------
let _starTex = null;
function starDecal(size) {
  if (!_starTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    x.translate(32, 32);
    x.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * 2 * Math.PI / 5, b = a + Math.PI / 5;
      x[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 29, Math.sin(a) * 29);
      x.lineTo(Math.cos(b) * 12, Math.sin(b) * 12);
    }
    x.closePath();
    x.fillStyle = '#e81414'; x.fill();
    x.lineWidth = 2.5; x.strokeStyle = '#a00808'; x.stroke();
    _starTex = new THREE.CanvasTexture(c);
  }
  return new THREE.Mesh(new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: _starTex, transparent: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1 }));
}

export function buildMiG29() {
  const g = new THREE.Group();
  const C = 0x9fa8ae, CD = 0x828c94;   // classic Soviet light gray
  const fus = box(2.6, 1.4, 10, C); fus.position.z = -1; g.add(fus);
  // long drooped radome + pitot spike
  const nose = cone(0.75, 5.2, CD); nose.scale.set(1.2, 0.85, 1); nose.position.z = 6.6; g.add(nose);
  const pitot = box(0.05, 0.05, 2.0, 0x2c3136); pitot.position.set(0, -0.05, 10.2); g.add(pitot);
  // bubble canopy with dark surround
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8),
    M(0x35474f));
  canopy.scale.set(0.85, 0.6, 1.9); canopy.position.set(0, 0.9, 3.1); g.add(canopy);
  // IRST ball ahead of the canopy, offset to starboard
  const irst = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), M(0x1a1a1a));
  irst.position.set(0.35, 0.8, 4.6); g.add(irst);
  // broad LERX strakes blending nose into wing
  const lexG = wingGeo([[0.4, 4.8], [2.8, 0.0], [0.4, 0.0]], 0.12);
  for (const s of [1, -1]) {
    const lex = new THREE.Mesh(lexG, M(CD)); lex.scale.x = s; lex.position.set(0, 0.45, 0.4); g.add(lex);
  }
  // trapezoid wing
  const wG = wingGeo([[1.0, 1.6], [1.0, -3.8], [6.2, -3.4], [6.2, -2.3]], 0.22);
  for (const s of [1, -1]) { const w = new THREE.Mesh(wG, M(C)); w.scale.x = s; w.position.y = 0.1; g.add(w); }
  // glove intakes with dark ramp mouths + the famous top louvres
  for (const s of [1, -1]) {
    const it = box(1.0, 0.9, 3.4, CD); it.position.set(s * 1.5, -0.6, 0.4); g.add(it);
    const mouth = box(0.8, 0.68, 0.12, 0x0c0e10); mouth.position.set(s * 1.5, -0.6, 2.16); g.add(mouth);
    for (let k = 0; k < 3; k++) {
      const lv = box(0.85, 0.05, 0.28, 0x2c3136); lv.position.set(s * 1.5, 0.02, 0.8 + k * 0.55); g.add(lv);
    }
    const e = cyl(0.7, 0.6, 4.8, CD); e.position.set(s * 0.95, -0.05, -5.8); g.add(e);
    const nz = cyl(0.52, 0.4, 1.2, 0x2c3136); nz.position.set(s * 0.95, -0.05, -8.4); g.add(nz);
    const ni = cyl(0.36, 0.36, 0.18, 0x0a0a0c); ni.position.set(s * 0.95, -0.05, -8.95); g.add(ni);
    // small ventral strakes under the engine booms
    const vf = box(0.1, 0.8, 1.6, CD); vf.position.set(s * 1.15, -0.95, -6.4); vf.rotation.z = -s * 0.12; g.add(vf);
    // underwing AAM
    const aam = cyl(0.13, 0.13, 1.9, 0xd8dce0); aam.position.set(s * 3.8, -0.55, -2.0); g.add(aam);
    const aamN = cone(0.13, 0.4, 0xd8dce0); aamN.position.set(s * 3.8, -0.55, -0.85); g.add(aamN);
  }
  const ab = [];
  for (const s of [1, -1]) { const f = abFlame(3.4, 0.48); f.position.set(s * 0.95, -0.05, -9.8); g.add(f); ab.push(f); }
  // "beaver tail" boom between the nozzles
  const tb = box(0.7, 0.5, 3.4, CD); tb.position.set(0, 0.35, -8.6); g.add(tb);
  // twin fins at the outer rear corners, canted outward
  const tG = wingGeo([[0, 0.5], [0, -2.2], [2.7, -3.1], [2.7, -2.4]], 0.16);
  for (const s of [1, -1]) {
    const t = new THREE.Mesh(tG, M(C));
    t.rotation.z = Math.PI / 2 - s * 0.28; t.position.set(s * 2.4, 0.6, -3.6); g.add(t);
    const fs = starDecal(1.3); fs.position.set(s * 2.5, 1.9, -5.0); fs.rotation.y = s * Math.PI / 2; g.add(fs);
  }
  // red stars on the wing tops — the enemy's colours
  for (const s of [1, -1]) {
    const ws = starDecal(1.6); ws.position.set(s * 3.6, 0.43, -2.6); ws.rotation.x = -Math.PI / 2; g.add(ws);
  }
  const sG = wingGeo([[0.4, 0.2], [0.4, -1.6], [3.4, -1.4], [3.4, -0.6]], 0.14);
  const stabL = new THREE.Mesh(sG, M(C)); stabL.position.set(0.6, 0, -6.6); g.add(stabL);
  const stabR = new THREE.Mesh(sG, M(C)); stabR.scale.x = -1; stabR.position.set(-0.6, 0, -6.6); g.add(stabR);
  g.userData = { ab, gear: null, hook: null, stabL, stabR, stores: { aim9: [], aim120: [] }, type: 'mig29' };
  addNavLights(g, 5.7, -8.5, 1.0);
  return g;
}

// ---------------- Boeing VC-25A / 747-200B (Air Force One, 1994) ----------------
// Loewy livery: white crown, robin's-egg nose/belly/nacelles, dark blue
// window cheatline with a gold pinstripe, flag on the fin, tail 28000
export function build747() {
  const g = new THREE.Group();
  const W = 0xf0f2f4, LB = 0x9fc9dd, DB = 0x1c3a70, GD = 0xc8a020;
  const fus = cyl(3.6, 3.2, 62, W, 14); fus.position.z = 0; g.add(fus);
  // blue nose band sweeping up around the cockpit
  const nose = cone(3.6, 10, LB, 14); nose.position.z = 36; g.add(nose);
  // extended 747 upper deck
  const hump = box(5.5, 2.4, 20, W); hump.position.set(0, 3.6, 20); g.add(hump);
  // robin's-egg belly
  const belly = cyl(3.4, 3.4, 56, LB, 14); belly.scale.set(1.02, 0.55, 1); belly.position.set(0, -1.6, -2); g.add(belly);
  const tailCone = cone(3.0, 9, W, 10); tailCone.rotation.x = Math.PI; tailCone.position.z = -35; g.add(tailCone);
  // cheatline + gold pinstripe: tapered sleeves hugging the fuselage
  const cheat = cyl(3.66, 3.26, 50, DB, 14); cheat.scale.set(1, 0.22, 1); cheat.position.set(0, 0.9, -1); g.add(cheat);
  const pin = cyl(3.64, 3.24, 50, GD, 14); pin.scale.set(1, 0.05, 1); pin.position.set(0, 0.02, -1); g.add(pin);
  // upper-deck window band
  for (const s of [1, -1]) {
    const ud = box(0.06, 0.35, 14, DB); ud.position.set(s * 2.78, 4.3, 20); g.add(ud);
  }
  const wG = wingGeo([[2.5, 4], [2.5, -8], [30, -8], [30, -5.5]], 0.5);
  for (const s of [1, -1]) { const w = new THREE.Mesh(wG, M(W)); w.scale.x = s; w.position.y = -0.5; g.add(w); }
  // 4 blue nacelles
  for (const s of [1, -1]) for (const [ex, ez] of [[9, 0], [17, -2]]) {
    const en = cyl(1.3, 1.1, 5, LB, 10); en.position.set(s * ex, -3.0, ez + 1); g.add(en);
  }
  // white fin with a light-blue wedge at the leading-edge base
  const tG = wingGeo([[0, 2], [0, -5], [11, -7.5], [11, -5.5]], 0.6);
  const tail = new THREE.Mesh(tG, M(W)); tail.rotation.z = Math.PI / 2; tail.position.set(0, 2.5, -28); g.add(tail);
  const tB = wingGeo([[0, 1.8], [0, -4.8], [4.5, -5.6], [4.5, -4.2]], 0.62);
  const tailB = new THREE.Mesh(tB, M(LB)); tailB.rotation.z = Math.PI / 2; tailB.position.set(0, 2.5, -28); g.add(tailB);
  // the flag on the fin (both sides)
  for (const s of [1, -1]) {
    const fx = s * 0.36;
    const field = box(0.04, 1.0, 1.4, 0xffffff); field.position.set(fx, 9.6, -30.2); g.add(field);
    const canton = box(0.05, 0.45, 0.55, 0x1a3a8a); canton.position.set(fx, 9.85, -29.75); g.add(canton);
    for (const ry of [9.25, 9.55]) {
      const stripe = box(0.05, 0.12, 1.35, 0xb02030); stripe.position.set(fx, ry, -30.2); g.add(stripe);
    }
  }
  const sG = wingGeo([[1.5, 1], [1.5, -3], [11, -3.5], [11, -2]], 0.4);
  for (const s of [1, -1]) { const st = new THREE.Mesh(sG, M(W)); st.scale.x = s; st.position.set(0, 1, -30); g.add(st); }
  g.userData = { ab: [], gear: null, hook: null, stabL: null, stabR: null, stores: { aim9: [], aim120: [] }, type: 'b747' };
  addNavLights(g, 30, -34, 2.5);
  return g;
}

// ---------------- Boeing 707 ----------------
export function build707() {
  const g = new THREE.Group();
  const W = 0xd8dce0;
  const fus = cyl(2.0, 1.8, 40, W, 12); g.add(fus);
  const nose = cone(2.0, 6, W, 12); nose.position.z = 23; g.add(nose);
  const tailCone = cone(1.6, 6, W, 10); tailCone.rotation.x = Math.PI; tailCone.position.z = -23; g.add(tailCone);
  const wG = wingGeo([[1.4, 2], [1.4, -5], [17, -6], [17, -4]], 0.35);
  for (const s of [1, -1]) { const w = new THREE.Mesh(wG, M(W)); w.scale.x = s; w.position.y = -0.6; g.add(w); }
  for (const s of [1, -1]) for (const [ex, ez] of [[5.5, -1], [10, -2]]) {
    const en = cyl(0.8, 0.7, 3.4, 0xb8bcc0, 8); en.position.set(s * ex, -1.8, ez); g.add(en);
  }
  const tG = wingGeo([[0, 1.5], [0, -3.5], [7.5, -5], [7.5, -3.8]], 0.4);
  const tail = new THREE.Mesh(tG, M(0x8898a8)); tail.rotation.z = Math.PI / 2; tail.position.set(0, 1.6, -19); g.add(tail);
  const sG = wingGeo([[1, 0.8], [1, -2.2], [7, -2.6], [7, -1.6]], 0.3);
  for (const s of [1, -1]) { const st = new THREE.Mesh(sG, M(W)); st.scale.x = s; st.position.set(0, 0.6, -20); g.add(st); }
  g.userData = { ab: [], gear: null, hook: null, stabL: null, stabR: null, stores: { aim9: [], aim120: [] }, type: 'b707' };
  addNavLights(g, 22, -21, 1.8);
  return g;
}

// ---------------- commercial airliners (SFO traffic, 1994) ----------------
// The carriers are fictional-but-evocative: schemes tip a hat to the airlines
// that actually worked SFO in 1994 without borrowing a single trademark.
export const AIRLINE_LIVERIES = [
  { name: 'ALLIED',  full: 'ALLIED AIRLINES', fuse: 0xf2f3f5, belly: 0x5a6470, cheat: 0x24407a, tail: 0x24407a, accent: 0xffb737, engines: 0x5a6470 },  // battleship gray/blue
  { name: 'LIBERTY', full: 'LIBERTY AIR',     fuse: 0xd8dce0, belly: 0xd8dce0, cheat: 0xa02028, tail: 0xd8dce0, accent: 0x24407a, engines: 0xb8bcc0 },  // polished silver, red cheat
  { name: 'CASCADE', full: 'CASCADE AIR',     fuse: 0xf4f6f8, belly: 0x1c2c4c, cheat: 0x1c2c4c, tail: 0x1c2c4c, accent: 0xffffff, engines: 0x1c2c4c },  // white over navy widget
  { name: 'EMPRESS', full: 'PACIFIC EMPRESS', fuse: 0xf0f2f4, belly: 0x14213c, cheat: 0xc8a020, tail: 0x14213c, accent: 0xc8a020, engines: 0x14213c },  // navy/gold international
];

const _nameTexCache = {};
function _nameTex(text, hex) {
  const key = text + '|' + hex;
  if (_nameTexCache[key]) return _nameTexCache[key];
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const g2 = c.getContext('2d');
  g2.fillStyle = '#' + hex.toString(16).padStart(6, '0');
  g2.font = 'bold 46px Arial, sans-serif';
  g2.textAlign = 'center'; g2.textBaseline = 'middle';
  g2.fillText(text, 256, 36);
  const t = new THREE.CanvasTexture(c);
  _nameTexCache[key] = t;
  return t;
}

// VAW-123 Screwtops corkscrew: a black pinwheel spiral on the rotodome's flat
// faces — as the dome turns, the swirl screws like the squadron's namesake
let _swirlTexCache = null;
function _swirlTex() {
  if (_swirlTexCache) return _swirlTexCache;
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#e8ecef'; x.fillRect(0, 0, 512, 512);
  x.strokeStyle = '#15191d'; x.lineCap = 'round'; x.lineWidth = 44;
  // archimedean swirl: about two turns from the hub out to the rim
  const CX = 256, R0 = 26, R1 = 216, TURNS = 2.1;
  x.beginPath();
  for (let t = 0; t <= 1.0001; t += 0.004) {
    const th = t * TURNS * 2 * Math.PI, r = R0 + (R1 - R0) * t;
    const px = CX + r * Math.cos(th), py = CX + r * Math.sin(th);
    if (t === 0) x.moveTo(px, py); else x.lineTo(px, py);
  }
  x.stroke();
  // white hub + a clean white ring at the very edge, like the squadron paint
  x.fillStyle = '#e8ecef'; x.beginPath(); x.arc(CX, CX, 22, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#e8ecef'; x.lineWidth = 26;
  x.beginPath(); x.arc(CX, CX, 243, 0, Math.PI * 2); x.stroke();
  _swirlTexCache = new THREE.CanvasTexture(c);
  _swirlTexCache.colorSpace = THREE.SRGBColorSpace;
  return _swirlTexCache;
}

// shared airframe dresser: belly, cheatline, window band, titles, fin accent
function _dressAirliner(g, L, r1, r2, len, o) {
  const belly = cyl(r1 * 0.98, r2 * 0.98, len * 0.88, L.belly, 14);
  belly.scale.set(1.02, 0.5, 1); belly.position.set(0, -r1 * 0.42, o.bellyZ || -1); g.add(belly);
  const cheat = cyl(r1 + 0.05, r2 + 0.05, len * 0.8, L.cheat, 14);
  cheat.scale.set(1, 0.2, 1); cheat.position.set(0, o.cheatY, o.cheatZ || -0.5); g.add(cheat);
  // window band: a dark sleeve hugging the crown reads as the window line
  const win = cyl(r1 + 0.04, r2 + 0.04, len * 0.72, 0x10161f, 14);
  win.scale.set(1, 0.09, 1); win.position.set(0, o.winY, o.winZ || 0); g.add(win);
  // airline titles on the forward fuselage, both sides
  const tex = _nameTex(L.full, L.cheat === 0xd8dce0 ? 0x24407a : L.cheat);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(o.nameW, o.nameH),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * (r1 + 0.06), o.nameY, o.nameZ);
    p.rotation.y = s * Math.PI / 2;
    g.add(p);
  }
}

export function build744(livery = 0) {
  const L = AIRLINE_LIVERIES[livery % AIRLINE_LIVERIES.length];
  const g = new THREE.Group();
  const fus = cyl(3.6, 3.2, 62, L.fuse, 14); g.add(fus);
  const nose = cone(3.6, 10, L.fuse, 14); nose.position.z = 36; g.add(nose);
  const hump = box(5.5, 2.4, 20, L.fuse); hump.position.set(0, 3.6, 20); g.add(hump);
  const tailCone = cone(3.0, 9, L.fuse, 10); tailCone.rotation.x = Math.PI; tailCone.position.z = -35; g.add(tailCone);
  _dressAirliner(g, L, 3.6, 3.2, 62, { cheatY: 0.9, winY: 2.0, nameW: 17, nameH: 1.9, nameY: 2.9, nameZ: 21 });
  for (const s of [1, -1]) {
    const ud = box(0.06, 0.35, 14, 0x10161f); ud.position.set(s * 2.78, 4.3, 20); g.add(ud);
  }
  const wG = wingGeo([[2.5, 4], [2.5, -8], [30, -8], [30, -5.5]], 0.5);
  for (const s of [1, -1]) { const w = new THREE.Mesh(wG, M(L.fuse)); w.scale.x = s; w.position.y = -0.5; g.add(w); }
  // 747-400 winglets
  for (const s of [1, -1]) { const wl = box(0.22, 3.6, 4.2, L.cheat); wl.position.set(s * 30, 1.4, -6.6); g.add(wl); }
  for (const s of [1, -1]) for (const [ex, ez] of [[9, 0], [17, -2]]) {
    const en = cyl(1.3, 1.1, 5, L.engines, 10); en.position.set(s * ex, -3.0, ez + 1); g.add(en);
  }
  const tG = wingGeo([[0, 2], [0, -5], [11, -7.5], [11, -5.5]], 0.6);
  const tail = new THREE.Mesh(tG, M(L.tail)); tail.rotation.z = Math.PI / 2; tail.position.set(0, 2.5, -28); g.add(tail);
  const tB = wingGeo([[0, 1.8], [0, -4.8], [4.5, -5.6], [4.5, -4.2]], 0.62);
  const tailB = new THREE.Mesh(tB, M(L.accent)); tailB.rotation.z = Math.PI / 2; tailB.position.set(0, 2.5, -28); g.add(tailB);
  const sG = wingGeo([[1.5, 1], [1.5, -3], [11, -3.5], [11, -2]], 0.4);
  for (const s of [1, -1]) { const st = new THREE.Mesh(sG, M(L.fuse)); st.scale.x = s; st.position.set(0, 1, -30); g.add(st); }
  g.userData = { ab: [], gear: null, hook: null, stabL: null, stabR: null, stores: { aim9: [], aim120: [] }, type: 'b744' };
  addNavLights(g, 30, -34, 2.5);
  return g;
}

export function build737(livery = 0) {
  const L = AIRLINE_LIVERIES[livery % AIRLINE_LIVERIES.length];
  const g = new THREE.Group();
  const fus = cyl(1.9, 1.75, 30, L.fuse, 12); g.add(fus);
  const nose = cone(1.9, 5, L.fuse, 12); nose.position.z = 17.5; g.add(nose);
  const tailCone = cone(1.6, 5.5, L.fuse, 10); tailCone.rotation.x = Math.PI; tailCone.position.z = -17.5; g.add(tailCone);
  _dressAirliner(g, L, 1.9, 1.75, 30, { cheatY: 0.55, winY: 1.1, nameW: 9.5, nameH: 1.1, nameY: 1.45, nameZ: 10 });
  const wG = wingGeo([[1.3, 1.5], [1.3, -4], [14.5, -6], [14.5, -4.5]], 0.35);
  for (const s of [1, -1]) { const w = new THREE.Mesh(wG, M(L.fuse)); w.scale.x = s; w.position.y = -0.4; g.add(w); }
  for (const s of [1, -1]) {
    const en = cyl(0.9, 0.8, 3.2, L.engines, 8); en.position.set(s * 4.6, -1.7, -0.5); g.add(en);
  }
  const tG = wingGeo([[0, 1.5], [0, -3.5], [6.5, -5], [6.5, -3.6]], 0.45);
  const tail = new THREE.Mesh(tG, M(L.tail)); tail.rotation.z = Math.PI / 2; tail.position.set(0, 1.6, -15); g.add(tail);
  const tB = wingGeo([[0, 1.3], [0, -3.2], [2.8, -3.7], [2.8, -2.7]], 0.47);
  const tailB = new THREE.Mesh(tB, M(L.accent)); tailB.rotation.z = Math.PI / 2; tailB.position.set(0, 1.6, -15); g.add(tailB);
  const sG = wingGeo([[1, 0.8], [1, -2], [5.5, -2.4], [5.5, -1.4]], 0.3);
  for (const s of [1, -1]) { const st = new THREE.Mesh(sG, M(L.fuse)); st.scale.x = s; st.position.set(0, 0.7, -16); g.add(st); }
  g.userData = { ab: [], gear: null, hook: null, stabL: null, stabR: null, stores: { aim9: [], aim120: [] }, type: 'b737' };
  addNavLights(g, 14.5, -17, 1.4);
  return g;
}

export function buildDC10(livery = 0) {
  const L = AIRLINE_LIVERIES[livery % AIRLINE_LIVERIES.length];
  const g = new THREE.Group();
  const fus = cyl(3.0, 2.8, 50, L.fuse, 14); g.add(fus);
  const nose = cone(3.0, 8, L.fuse, 12); nose.position.z = 29; g.add(nose);
  const tailCone = cone(2.6, 8, L.fuse, 10); tailCone.rotation.x = Math.PI; tailCone.position.z = -29; g.add(tailCone);
  _dressAirliner(g, L, 3.0, 2.8, 50, { cheatY: 0.8, winY: 1.7, nameW: 14, nameH: 1.6, nameY: 2.4, nameZ: 17 });
  const wG = wingGeo([[2.2, 3], [2.2, -6], [26, -7.5], [26, -5.5]], 0.45);
  for (const s of [1, -1]) { const w = new THREE.Mesh(wG, M(L.fuse)); w.scale.x = s; w.position.y = -0.6; g.add(w); }
  for (const s of [1, -1]) for (const [ex, ez] of [[8, 0], [15, -1.5]]) {
    const en = cyl(1.15, 1.0, 4.6, L.engines, 10); en.position.set(s * ex, -2.6, ez); g.add(en);
  }
  // the trijet's signature: engine #2 buried in the fin root, intake ramp above the rear fuselage
  const tEng = cyl(1.0, 0.9, 9, L.engines, 10); tEng.position.set(0, 4.4, -24.5); g.add(tEng);
  const ramp = box(1.6, 1.2, 5, L.tail); ramp.position.set(0, 3.6, -20); g.add(ramp);
  const tG = wingGeo([[0, 2], [0, -4.5], [9.5, -6.5], [9.5, -5]], 0.55);
  const tail = new THREE.Mesh(tG, M(L.tail)); tail.rotation.z = Math.PI / 2; tail.position.set(0, 2, -23); g.add(tail);
  const tB = wingGeo([[0, 1.6], [0, -4.2], [4, -4.9], [4, -3.9]], 0.57);
  const tailB = new THREE.Mesh(tB, M(L.accent)); tailB.rotation.z = Math.PI / 2; tailB.position.set(0, 2, -23); g.add(tailB);
  const sG = wingGeo([[1.4, 1], [1.4, -2.8], [9.5, -3.2], [9.5, -1.9]], 0.38);
  for (const s of [1, -1]) { const st = new THREE.Mesh(sG, M(L.fuse)); st.scale.x = s; st.position.set(0, 1, -25); g.add(st); }
  g.userData = { ab: [], gear: null, hook: null, stabL: null, stabR: null, stores: { aim9: [], aim120: [] }, type: 'dc10' };
  addNavLights(g, 26, -28, 2);
  return g;
}

export function buildMD90(livery = 0) {
  const L = AIRLINE_LIVERIES[livery % AIRLINE_LIVERIES.length];
  const g = new THREE.Group();
  const fus = cyl(1.7, 1.55, 42, L.fuse, 12); g.add(fus);
  const nose = cone(1.7, 4.5, L.fuse, 12); nose.position.z = 23.2; g.add(nose);
  const tailCone = cone(1.4, 8, L.fuse, 10); tailCone.rotation.x = Math.PI; tailCone.position.z = -25; g.add(tailCone);
  _dressAirliner(g, L, 1.7, 1.55, 42, { cheatY: 0.5, winY: 1.0, nameW: 10, nameH: 1.0, nameY: 1.35, nameZ: 12 });
  // rear-set wing, rear-mounted engines, T-tail — the Maddog silhouette
  const wG = wingGeo([[1.2, 1], [1.2, -3], [13.5, -4.5], [13.5, -3.2]], 0.3);
  for (const s of [1, -1]) { const w = new THREE.Mesh(wG, M(L.fuse)); w.scale.x = s; w.position.set(0, -0.3, -6); g.add(w); }
  for (const s of [1, -1]) {
    const en = cyl(0.75, 0.65, 3.8, L.engines, 8); en.position.set(s * 1.8, 0.3, -17.5); g.add(en);
    const pylon = box(0.5, 0.5, 2.2, L.fuse); pylon.position.set(s * 1.5, 0.3, -16.5); g.add(pylon);
  }
  const tG = wingGeo([[0, 1.5], [0, -3], [7, -4.2], [7, -3]], 0.4);
  const tail = new THREE.Mesh(tG, M(L.tail)); tail.rotation.z = Math.PI / 2; tail.position.set(0, 1.5, -21); g.add(tail);
  const tB = wingGeo([[0, 1.3], [0, -2.8], [3, -3.3], [3, -2.4]], 0.42);
  const tailB = new THREE.Mesh(tB, M(L.accent)); tailB.rotation.z = Math.PI / 2; tailB.position.set(0, 1.5, -21); g.add(tailB);
  // stabilizers on top of the fin — the T
  const sG = wingGeo([[0.6, 0.5], [0.6, -1.7], [5.5, -2.1], [5.5, -1.1]], 0.25);
  for (const s of [1, -1]) { const st = new THREE.Mesh(sG, M(L.tail)); st.scale.x = s; st.position.set(0, 8.3, -23.2); g.add(st); }
  g.userData = { ab: [], gear: null, hook: null, stabL: null, stabR: null, stores: { aim9: [], aim120: [] }, type: 'md90' };
  addNavLights(g, 13.5, -24, 1.2);
  return g;
}

// ---------------- cruise missile ----------------
export function buildCruiseMissile() {
  const g = new THREE.Group();
  const b = cyl(0.35, 0.3, 5.4, 0x4a5258, 8); g.add(b);
  const n = cone(0.35, 1.4, 0x3a4148, 8); n.position.z = 3.4; g.add(n);
  const w1 = box(3.2, 0.08, 0.9, 0x4a5258); w1.position.z = 0.4; g.add(w1);
  const w2 = box(0.08, 1.8, 0.7, 0x4a5258); w2.position.z = -2.2; g.add(w2);
  const w3 = box(2.2, 0.08, 0.7, 0x4a5258); w3.position.z = -2.2; g.add(w3);
  const f = abFlame(2.2, 0.3); f.position.z = -3.6; f.visible = true; g.add(f);
  g.userData = { ab: [f], gear: null, hook: null, stabL: null, stabR: null, stores: { aim9: [], aim120: [] }, type: 'cruise' };
  return g;
}

// ---------------- rescue raft ----------------
export function buildRaft() {
  const g = new THREE.Group();
  const raft = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.55, 8, 12), M(0xe86818));
  raft.rotation.x = Math.PI / 2; raft.position.y = 0.4; g.add(raft);
  const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), M(0x2a4a2a));
  pilot.position.y = 0.9; g.add(pilot);
  g.userData = { type: 'raft' };
  return g;
}

// surfaced submersible aircraft carrier (mission 6 target)
export function buildSub() {
  const g = new THREE.Group();
  const hullMat = M(0x23282e), deckMat = M(0x31383f);
  // main hull
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 5.2, 96, 12), hullMat);
  hull.rotation.x = Math.PI / 2; hull.position.y = 1.6; g.add(hull);
  // bow taper
  const bow = new THREE.Mesh(new THREE.SphereGeometry(6.5, 12, 8), hullMat);
  bow.scale.set(1, 0.82, 2.2); bow.position.set(0, 1.6, -52); g.add(bow);
  const stern = new THREE.Mesh(new THREE.SphereGeometry(5.6, 12, 8), hullMat);
  stern.scale.set(1, 0.9, 1.6); stern.position.set(0, 1.6, 50); g.add(stern);
  // flat flight deck (it's an aircraft carrier sub)
  const deck = new THREE.Mesh(new THREE.BoxGeometry(13, 1.2, 88), deckMat);
  deck.position.y = 7.6; g.add(deck);
  // conning tower / island
  const sail = new THREE.Mesh(new THREE.BoxGeometry(4.5, 9, 12), hullMat);
  sail.position.set(5.5, 12.5, -8); g.add(sail);
  const periscope = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 5, 6), M(0x111417));
  periscope.position.set(5.5, 19, -10); g.add(periscope);
  // deck markings
  const line = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 70), M(0xd8c840));
  line.position.set(0, 8.3, 0); g.add(line);
  g.userData = { type: 'sub' };
  return g;
}

// ---------------- SH-60 Seahawk ----------------
export function buildSeahawk() {
  const g = new THREE.Group();
  const C = 0x5c6672, CD = 0x424a54, GL = 0x18242e;   // haze grey over dark
  // cabin + nose
  const cab = box(2.3, 1.9, 4.6, C); cab.position.set(0, 0.15, 1.2); g.add(cab);
  const nose = cone(1.05, 1.8, C, 8); nose.scale.set(1.1, 0.95, 1); nose.position.set(0, -0.05, 4.3); g.add(nose);
  // glasshouse
  const glass = box(2.0, 0.85, 1.5, GL); glass.position.set(0, 0.75, 3.0); glass.rotation.x = 0.28; g.add(glass);
  const chin = box(1.2, 0.5, 0.9, GL); chin.position.set(0, -0.15, 3.9); g.add(chin);
  // engine nacelles either side of the mast
  for (const s of [1, -1]) {
    const nac = box(0.8, 0.8, 2.6, CD); nac.position.set(s * 1.25, 1.35, 0.6); g.add(nac);
    const exh = cyl(0.26, 0.26, 0.7, 0x22262a, 6); exh.position.set(s * 1.7, 1.35, -0.5); exh.rotation.z = s * Math.PI / 2; g.add(exh);
  }
  // tail boom + pylon + canted fin
  const boom = cyl(0.62, 0.34, 6.8, C, 8); boom.position.set(0, 0.55, -4.7); g.add(boom);
  const stab = box(3.0, 0.14, 0.9, C); stab.position.set(0, 0.75, -6.2); g.add(stab);
  const fin = box(0.16, 1.7, 1.1, C); fin.position.set(0, 1.35, -7.6); fin.rotation.x = -0.5; g.add(fin);
  // tail rotor on the port face of the fin
  const tr = new THREE.Group(); tr.position.set(-0.22, 1.5, -7.7);
  for (let i = 0; i < 4; i++) {
    const b = box(0.09, 1.05, 0.16, 0x1c2024); b.position.y = 0;
    const holder = new THREE.Group(); holder.rotation.z = i * Math.PI / 2;
    b.position.set(0, 0.55, 0); holder.add(b); tr.add(holder);
  }
  tr.rotation.y = Math.PI / 2;   // plane of rotation faces sideways
  g.add(tr);
  // main rotor mast + 4 blades on a hub
  const mast = cyl(0.14, 0.14, 0.8, CD, 6); mast.rotation.x = 0; mast.rotation.z = 0;
  mast.geometry = new THREE.CylinderGeometry(0.14, 0.14, 0.8, 6);
  mast.position.set(0, 1.75, 0.2); g.add(mast);
  const hub = new THREE.Group(); hub.position.set(0, 2.2, 0.2);
  for (let i = 0; i < 4; i++) {
    const holder = new THREE.Group(); holder.rotation.y = i * Math.PI / 2 + 0.4;
    const b = box(7.6, 0.06, 0.42, 0x22262b); b.position.x = 3.9;
    const tip = box(0.5, 0.065, 0.44, 0xd8c840); tip.position.x = 7.45;
    holder.add(b); holder.add(tip); hub.add(holder);
  }
  g.add(hub);
  // full-speed rotor blur disc, swapped in by the Helicopter driver
  const disc = new THREE.Mesh(new THREE.CircleGeometry(8.1, 24),
    new THREE.MeshBasicMaterial({ color: 0x30363c, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.set(0, 2.22, 0.2); disc.visible = false; g.add(disc);
  // gear: two mains + tailwheel
  const gear = new THREE.Group();
  for (const s of [1, -1]) {
    const strut = box(0.14, 0.7, 0.14, CD); strut.position.set(s * 1.15, -1.0, 0.8); gear.add(strut);
    const wh = cyl(0.3, 0.3, 0.2, 0x14171a, 8); wh.rotation.z = Math.PI / 2; wh.position.set(s * 1.15, -1.4, 0.8); gear.add(wh);
  }
  const tw = cyl(0.22, 0.22, 0.18, 0x14171a, 8); tw.rotation.z = Math.PI / 2; tw.position.set(0, -0.5, -6.0); gear.add(tw);
  g.add(gear);
  // NAVY titles on the boom
  const tex = _nameTex('NAVY', 0x1c222a);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.3),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 0.66, 0.55, -3.6); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  g.userData = { ab: [], gear: null, hook: null, stabL: null, stabR: null, stores: {}, rotor: hub, tailRotor: tr, rotorDisc: disc, type: 'seahawk' };
  addNavLights(g, 1.4, -7.6, 1.2);
  return g;
}

// ---------------------------------------------------------------- AH-64 APACHE
export function buildApache() {
  const g = new THREE.Group();
  const C = 0x515a30, CD = 0x3c4423, GL = 0x141c22;   // army olive drab
  // narrow fuselage: nose, tandem stepped cockpit, engine deck
  const nose = cone(0.85, 2.2, C, 8); nose.scale.set(1.0, 0.85, 1); nose.position.set(0, -0.1, 4.6); g.add(nose);
  const body = box(1.7, 1.5, 5.4, C); body.position.set(0, 0.05, 1.3); g.add(body);
  // sensor turret ball on the nose + the 30mm chain gun under the chin
  const turret = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), M(GL)); turret.position.set(0, 0.35, 5.2); g.add(turret);
  const gun = cyl(0.09, 0.09, 1.3, 0x1c2024, 6); gun.position.set(0, -0.85, 4.1); gun.rotation.x = Math.PI / 2 + 0.12; g.add(gun);
  const gunMt = box(0.5, 0.5, 0.8, CD); gunMt.position.set(0, -0.7, 3.6); g.add(gunMt);
  // tandem glass: gunner front low, pilot back high — the Apache step
  const gF = box(1.15, 0.7, 1.3, GL); gF.position.set(0, 0.7, 3.1); gF.rotation.x = 0.22; g.add(gF);
  const gR = box(1.2, 0.8, 1.4, GL); gR.position.set(0, 1.05, 1.6); gR.rotation.x = 0.18; g.add(gR);
  // engine nacelles on the fuselage shoulders, either side of the mast
  for (const s of [1, -1]) {
    const nac = box(0.75, 0.75, 2.2, CD); nac.position.set(s * 1.2, 1.15, 0.4); g.add(nac);
    const exh = cyl(0.24, 0.3, 0.7, 0x22262a, 6); exh.position.set(s * 1.62, 1.2, -0.6); exh.rotation.z = s * Math.PI / 2; g.add(exh);
  }
  // stub wings with pylons: hellfire rack outboard, rocket pod inboard
  for (const s of [1, -1]) {
    const wing = box(2.6, 0.16, 1.1, C); wing.position.set(s * 2.1, 0.35, 0.4); g.add(wing);
    const rack = box(0.5, 0.62, 1.5, 0x2c3320); rack.position.set(s * 3.2, -0.05, 0.4); g.add(rack);
    for (let i = 0; i < 4; i++) { const msl = cyl(0.09, 0.09, 1.6, 0x22262b, 5); msl.position.set(s * 3.2 + (i % 2) * 0.22 - 0.11, -0.42 + Math.floor(i / 2) * 0.22, 0.4); msl.rotation.x = Math.PI / 2; g.add(msl); }
    const pod = cyl(0.28, 0.28, 1.7, CD, 8); pod.position.set(s * 1.3, -0.35, 0.4); pod.rotation.x = Math.PI / 2; g.add(pod);
  }
  // tail boom + fin, tail rotor on the port face
  const boom = cyl(0.55, 0.28, 6.6, C, 8); boom.position.set(0, 0.5, -4.9); g.add(boom);
  const stab = box(2.8, 0.13, 0.85, C); stab.position.set(0, 0.6, -6.4); g.add(stab);
  const fin = box(0.16, 1.8, 1.2, C); fin.position.set(0, 1.3, -7.7); fin.rotation.x = -0.45; g.add(fin);
  const ventral = box(0.14, 0.9, 1.3, C); ventral.position.set(0, -0.55, -7.3); ventral.rotation.x = 0.3; g.add(ventral);
  const tr = new THREE.Group(); tr.position.set(-0.24, 1.45, -7.75);
  for (let i = 0; i < 4; i++) {
    const b = box(0.09, 1.1, 0.15, 0x1c2024); b.position.set(0, 0.55, 0);
    const holder = new THREE.Group(); holder.rotation.z = i * Math.PI / 2;
    holder.add(b); tr.add(holder);
  }
  tr.rotation.y = Math.PI / 2;
  g.add(tr);
  // main rotor mast + 4 broad blades, no painted tips (army)
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.9, 6), M(CD));
  mast.position.set(0, 1.7, 0.3); g.add(mast);
  const hub = new THREE.Group(); hub.position.set(0, 2.2, 0.3);
  for (let i = 0; i < 4; i++) {
    const holder = new THREE.Group(); holder.rotation.y = i * Math.PI / 2 + 0.2;
    const b = box(7.2, 0.07, 0.5, 0x22262b); b.position.x = 3.7;
    holder.add(b); hub.add(holder);
  }
  g.add(hub);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(7.6, 24),
    new THREE.MeshBasicMaterial({ color: 0x30363c, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.set(0, 2.22, 0.3); disc.visible = false; g.add(disc);
  // tail-dragger gear: two mains + tailwheel
  for (const s of [1, -1]) {
    const strut = box(0.13, 0.8, 0.13, CD); strut.position.set(s * 1.1, -0.95, 0.9); g.add(strut);
    const wh = cyl(0.32, 0.32, 0.2, 0x14171a, 8); wh.rotation.z = Math.PI / 2; wh.position.set(s * 1.1, -1.4, 0.9); g.add(wh);
  }
  const tw = cyl(0.2, 0.2, 0.16, 0x14171a, 8); tw.rotation.z = Math.PI / 2; tw.position.set(0, -0.55, -6.8); g.add(tw);
  // U.S. ARMY titles on the boom
  const tex = _nameTex('U.S. ARMY', 0x151a10);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.32),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 0.6, 0.55, -3.9); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  g.userData = { ab: [], gear: null, hook: null, stabL: null, stabR: null, stores: {}, rotor: hub, tailRotor: tr, rotorDisc: disc, type: 'apache' };
  addNavLights(g, 1.4, -7.7, 1.3);
  return g;
}

// ---------------- E-2C Hawkeye ----------------
export function buildE2C() {
  const g = new THREE.Group();
  const W = 0xd6dce2, GY = 0xaeb6be, DK = 0x232e38;
  const fus = cyl(1.65, 1.45, 15.5, W, 12); g.add(fus);
  const nose = cone(1.65, 3.4, W, 10); nose.position.set(0, 0, 9.3); g.add(nose);
  // aft fuselage section: carries the quad tail, tapers to the stinger
  const aft = cone(1.45, 5.2, W, 10); aft.rotation.x = Math.PI; aft.position.set(0, 0, -9.95); g.add(aft);
  const ck = cyl(1.68, 1.68, 1.5, DK, 10); ck.scale.set(1, 0.55, 1); ck.position.set(0, 0.55, 7.6); g.add(ck);
  // high wing + two turboprops, four blades each
  const wG = wingGeo([[1.9, 2.6], [1.9, -2.4], [12.3, -3.0], [12.3, -1.6]], 0.35);
  for (const s of [1, -1]) { const w = new THREE.Mesh(wG, M(W)); w.scale.x = s; w.position.y = 1.35; g.add(w); }
  const props = [];
  for (const s of [1, -1]) {
    const nac = cyl(0.72, 0.6, 4.4, W, 8); nac.position.set(s * 5.4, 0.75, 0.5); g.add(nac);
    const spin = new THREE.Group(); spin.position.set(s * 5.4, 0.75, 2.85);
    for (let i = 0; i < 4; i++) { const b = box(0.13, 3.7, 0.09, 0x1a1e22); b.rotation.z = i * Math.PI / 4; spin.add(b); }
    const dome = cone(0.22, 0.45, DK, 8); dome.position.z = 0.1; spin.add(dome);
    g.add(spin); props.push(spin);
  }
  // the rotodome on its struts — a horizontal pancake spinning about its vertical axis
  const rd = new THREE.Group(); rd.position.set(0, 3.15, -2.2);
  const stA = box(0.28, 2.2, 0.5, GY); stA.position.set(0, -1.6, 0.8); stA.rotation.x = 0.35; rd.add(stA);
  const stB = box(0.28, 2.2, 0.5, GY); stB.position.set(0, -1.6, -0.8); stB.rotation.x = -0.35; rd.add(stB);
  // VAW-123 Screwtops: the black corkscrew pinwheel on the dome's flat faces —
  // only the disc spins on its struts
  const spin = new THREE.Group();
  const swirl = new THREE.MeshBasicMaterial({ map: _swirlTex() });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.8, 20), [M(0xcfd6dc), swirl, swirl]);
  spin.add(disc);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(3.62, 3.62, 0.3, 20), [M(GY), M(GY), M(GY)]);
  rim.position.y = -0.55; spin.add(rim);   // under-ring, clear of the spiral band
  rd.add(spin);
  g.add(rd);
  // quad tail: tall centre fin, two outboard fins, ventral fin
  const sG = wingGeo([[0.9, 1.1], [0.9, -1.7], [5.4, -2.4], [5.4, -1.4]], 0.28);
  for (const s of [1, -1]) { const st = new THREE.Mesh(sG, M(W)); st.scale.x = s; st.position.set(0, 0.6, -12.2); g.add(st); }
  const fin = new THREE.Mesh(wingGeo([[0, 2.4], [0, -2.6], [3.8, -3.4], [3.8, -2.6]], 0.3), M(W));
  fin.rotation.z = Math.PI / 2; fin.position.set(0, 1.0, -12.4); g.add(fin);
  for (const s of [1, -1]) {
    const of = new THREE.Mesh(wingGeo([[0, 1.2], [0, -1.6], [2.4, -2.2], [2.4, -1.5]], 0.22), M(W));
    of.rotation.z = Math.PI / 2; of.position.set(s * 5.2, 0.9, -12.8); g.add(of);
  }
  const vf = new THREE.Mesh(wingGeo([[0, 0.9], [0, -1.4], [1.8, -1.9], [1.8, -1.3]], 0.2), M(W));
  vf.rotation.z = -Math.PI / 2; vf.position.set(0, -0.9, -12.6); g.add(vf);
  // titles + tail code
  const tex = _nameTex('U.S. NAVY', 0x2a3540);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.6),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 1.72, 0.5, 2.0); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  const ac = _nameTex('AC 601', 0x2a3540);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.5),
      new THREE.MeshBasicMaterial({ map: ac, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 0.36, 3.1, -14.2); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  g.userData = { ab: [], gear: null, hook: null, stabL: null, stabR: null, stores: {}, props, rotodome: spin, type: 'e2c' };
  addNavLights(g, 12.3, -14.0, 1.6);
  return g;
}

// ---------------- P-3 Orion ----------------
export function buildP3() {
  const g = new THREE.Group();
  const W = 0xe4e8ec, GY = 0x9aa4ac, DK = 0x2a3540;   // white-top over gull grey
  const fus = cyl(1.75, 1.6, 30, GY, 12); g.add(fus);
  const crown = cyl(1.78, 1.63, 26, W, 12); crown.scale.set(1, 0.55, 1); crown.position.set(0, 0.65, 1); g.add(crown);
  const nose = cone(1.75, 4.2, W, 10); nose.position.set(0, 0, 17); g.add(nose);
  // cockpit band
  const ck = cyl(1.79, 1.79, 1.6, DK, 10); ck.scale.set(1, 0.5, 1); ck.position.set(0, 0.6, 14.6); g.add(ck);
  // MAD stinger tail
  const st = cyl(0.5, 0.12, 6.5, GY, 8); st.position.set(0, 0.3, -18.2); g.add(st);
  // wing + 4 turboprops with spinning props
  const wG = wingGeo([[2, 3.2], [2, -3.2], [15.2, -4.6], [15.2, -2.2]], 0.4);
  for (const s of [1, -1]) { const w = new THREE.Mesh(wG, M(GY)); w.scale.x = s; w.position.y = -0.4; g.add(w); }
  const props = [];
  for (const s of [1, -1]) for (const ex of [5.6, 10.6]) {
    const nac = cyl(0.75, 0.62, 4.6, GY, 8); nac.position.set(s * ex, -1.15, 0.4); g.add(nac);
    const spin = new THREE.Group(); spin.position.set(s * ex, -1.15, 2.85);
    for (let i = 0; i < 2; i++) {
      const b = box(0.14, 3.9, 0.1, 0x1a1e22); b.rotation.z = i * Math.PI / 2; spin.add(b);
    }
    const dome = cone(0.24, 0.5, DK, 8); dome.position.z = 0.1; spin.add(dome);
    g.add(spin); props.push(spin);
  }
  // tail: fin + high stabilators
  const tG = wingGeo([[0, 2.2], [0, -3.2], [5.6, -4.6], [5.6, -3.2]], 0.4);
  const fin = new THREE.Mesh(tG, M(GY)); fin.rotation.z = Math.PI / 2; fin.position.set(0, 1.2, -14.2); g.add(fin);
  const sG = wingGeo([[0.8, 0.9], [0.8, -1.6], [6.6, -2.2], [6.6, -1.2]], 0.3);
  for (const s of [1, -1]) { const st2 = new THREE.Mesh(sG, M(GY)); st2.scale.x = s; st2.position.set(0, 0.8, -13.6); g.add(st2); }
  // U.S. NAVY titles aft
  const tex = _nameTex('U.S. NAVY', 0x2a3540);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.65),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 1.82, 0.55, -8.5); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  g.userData = { ab: [], gear: null, hook: null, stabL: null, stabR: null, stores: {}, props, type: 'p3' };
  addNavLights(g, 15.2, -14.5, 1.5);
  return g;
}

// shared landing-gear cluster for the bigger birds: each entry [x, y, z] puts
// a wheel at that fuselage station, strut reaching up into the airframe
function _gearSet(pts, r = 0.34, strutLen = 1.35) {
  const gear = new THREE.Group();
  const gm = M(0x2c3136);
  for (const [x, y, z] of pts) {
    const w = new THREE.Group();
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, strutLen, 6), gm);
    strut.position.y = strutLen / 2 + 0.05; w.add(strut);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.22, 10), gm);
    tire.rotation.z = Math.PI / 2; tire.position.y = 0.1; w.add(tire);
    w.position.set(x, y, z); gear.add(w);
  }
  return gear;
}
// (soviet red stars come from starDecal() up in the MiG-29 section)


// ---------------- A-6E Intruder — VA-52 Knight Riders, CVW-15 (NL), 1994 ----------------
export function buildA6() {
  const g = new THREE.Group();
  const C = 0xaab2b8, CD = 0x8d979e, GL = 0x232e38, DK = 0x39434c;
  // fat little all-weather bomber: rounded body, side-by-side greenhouse
  const fus = cyl(1.08, 0.95, 12.6, C, 12); g.add(fus);
  const nose = cone(1.08, 3.4, DK, 10); nose.scale.set(1, 0.92, 1); nose.position.set(0, 0, 8.0); g.add(nose);
  // fixed refuelling probe spearing up off the nose — the Intruder silhouette
  const probe = cyl(0.035, 0.035, 1.7, CD, 5); probe.position.set(0, 0.62, 7.0); probe.rotation.x = -0.62; g.add(probe);
  // TRAM chin turret under the radome
  const tram = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), M(GL)); tram.position.set(0, -0.72, 6.2); g.add(tram);
  // wide side-by-side canopy — pilot left, B/N right and a half-step back
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.95, 10, 8), M(0x4a5a64));
  canopy.scale.set(1.05, 0.62, 1.55); canopy.position.set(0, 0.78, 3.9); g.add(canopy);
  // cheek intakes feeding the buried J52s, exhausts out under the wing roots
  for (const s of [1, -1]) {
    const it = box(0.5, 0.85, 2.6, CD); it.position.set(s * 1.06, -0.12, 2.0); g.add(it);
    const mouth = box(0.38, 0.6, 0.12, 0x0c0e10); mouth.position.set(s * 1.06, -0.12, 3.34); g.add(mouth);
    const exh = cyl(0.4, 0.34, 1.5, 0x2c3136, 8); exh.position.set(s * 0.78, -0.55, -5.9); g.add(exh);
    const pipe = cyl(0.3, 0.3, 0.14, 0x0a0a0c, 8); pipe.position.set(s * 0.78, -0.55, -6.62); g.add(pipe);
  }
  // mid swept wing
  const wG = wingGeo([[1.0, 1.7], [1.0, -2.5], [8.1, -4.2], [8.1, -2.9]], 0.24);
  let wingR, wingL;
  for (const s of [1, -1]) { const w = new THREE.Mesh(wG, M(C)); w.scale.x = s; w.position.y = 0.28; g.add(w); if (s > 0) wingR = w; else wingL = w; }
  // tall single fin with the forward dorsal run
  const fin = new THREE.Mesh(wingGeo([[0, 2.2], [0, -3.1], [3.5, -4.3], [3.5, -3.1]], 0.22), M(C));
  fin.rotation.z = Math.PI / 2; fin.position.set(0, 0.7, -5.4); g.add(fin);
  const dorsal = box(0.16, 0.5, 2.6, CD); dorsal.position.set(0, 0.95, -3.9); dorsal.rotation.x = 0.25; g.add(dorsal);
  // all-moving stabilators, low on the aft fuselage
  const sG = wingGeo([[0.3, 0.4], [0.3, -1.5], [3.4, -2.0], [3.4, -1.0]], 0.15);
  const stabL = new THREE.Mesh(sG, M(C)); stabL.position.set(0.4, -0.05, -5.9); g.add(stabL);
  const stabR = new THREE.Mesh(sG, M(C)); stabR.scale.x = -1; stabR.position.set(-0.4, -0.05, -5.9); g.add(stabR);
  // gear + hook (VA-52 worked the boat)
  const gear = _gearSet([[0, -1.85, 4.6], [0.95, -1.85, -0.4], [-0.95, -1.85, -0.4]]);
  g.add(gear);
  const hook = box(0.1, 0.1, 2.4, 0xcccccc); hook.position.set(0, -0.6, -7.2);
  hook.rotation.x = -0.5; hook.visible = false; g.add(hook);
  // 1994 low-vis: grey on grey — NAVY aft, NL 501 on the fin, modex on the nose
  const navy = _nameTex('U.S. NAVY', DK);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.45), new THREE.MeshBasicMaterial({ map: navy, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 1.12, 0.35, -3.6); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  const code = _nameTex('NL 501', DK);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.5), new THREE.MeshBasicMaterial({ map: code, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 0.13, 2.6, -6.6); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  const modex = _nameTex('501', DK);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.34), new THREE.MeshBasicMaterial({ map: modex, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 0.82, 0.1, 7.2); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  g.userData = { ab: [], gear, hook, stabL, stabR, stores: {}, wingR, wingL, foldUp: true, type: 'a6' };
  addNavLights(g, 8.2, -7.9, 1.0);
  return g;
}

// ---------------- C-2A Greyhound — VRC-30 Providers Det, 1994 ----------------
export function buildC2() {
  const g = new THREE.Group();
  const W = 0xd8dde2, GY = 0xb0b8c0, DK = 0x232e38, TX = 0x39434c;
  // the E-2's cargo-hauling sister: same wing, tails and T56s, bigger box
  const fus = cyl(1.95, 1.75, 14.6, GY, 12); g.add(fus);
  const crown = cyl(1.98, 1.78, 12.6, W, 12); crown.scale.set(1, 0.55, 1); crown.position.set(0, 0.68, 0.6); g.add(crown);
  const nose = cone(1.95, 3.2, GY, 10); nose.position.set(0, 0, 8.8); g.add(nose);
  const ck = cyl(1.98, 1.98, 1.6, DK, 10); ck.scale.set(1, 0.55, 1); ck.position.set(0, 0.62, 7.2); g.add(ck);
  // upswept tail with the loading ramp — the Greyhound's whole reason for being
  const aft = cone(1.75, 5.4, GY, 10); aft.rotation.x = Math.PI; aft.scale.set(1, 0.85, 1); aft.position.set(0, 0.3, -9.7); g.add(aft);
  const ramp = box(2.5, 0.14, 4.2, 0x98a0a8); ramp.position.set(0, -1.5, -8.2); ramp.rotation.x = 0.24; g.add(ramp);
  // high wing + two T56 turboprops, four blades each
  const wG = wingGeo([[1.9, 2.6], [1.9, -2.4], [12.3, -3.0], [12.3, -1.6]], 0.35);
  let wingR, wingL;
  for (const s of [1, -1]) { const w = new THREE.Mesh(wG, M(GY)); w.scale.x = s; w.position.y = 1.5; g.add(w); if (s > 0) wingR = w; else wingL = w; }
  const props = [];
  for (const s of [1, -1]) {
    const nac = cyl(0.74, 0.62, 4.6, GY, 8); nac.position.set(s * 5.4, 0.85, 0.5); g.add(nac);
    const spin = new THREE.Group(); spin.position.set(s * 5.4, 0.85, 2.95);
    for (let i = 0; i < 4; i++) { const b = box(0.13, 3.7, 0.09, 0x1a1e22); b.rotation.z = i * Math.PI / 4; spin.add(b); }
    const dome = cone(0.22, 0.45, DK, 8); dome.position.z = 0.1; spin.add(dome);
    g.add(spin); props.push(spin);
  }
  // quad tail: tall centre fin, two outboard fins, ventral fin (E-2 hand-me-down)
  const sG = wingGeo([[0.9, 1.1], [0.9, -1.7], [5.4, -2.4], [5.4, -1.4]], 0.28);
  for (const s of [1, -1]) { const st = new THREE.Mesh(sG, M(GY)); st.scale.x = s; st.position.set(0, 0.6, -11.9); g.add(st); }
  const fin = new THREE.Mesh(wingGeo([[0, 2.4], [0, -2.6], [3.8, -3.4], [3.8, -2.6]], 0.3), M(GY));
  fin.rotation.z = Math.PI / 2; fin.position.set(0, 1.0, -12.1); g.add(fin);
  for (const s of [1, -1]) {
    const of = new THREE.Mesh(wingGeo([[0, 1.2], [0, -1.6], [2.4, -2.2], [2.4, -1.5]], 0.22), M(GY));
    of.rotation.z = Math.PI / 2; of.position.set(s * 5.2, 0.9, -12.5); g.add(of);
  }
  const vf = new THREE.Mesh(wingGeo([[0, 0.9], [0, -1.4], [1.8, -1.9], [1.8, -1.3]], 0.2), M(GY));
  vf.rotation.z = -Math.PI / 2; vf.position.set(0, -0.9, -12.3); g.add(vf);
  // gear + hook — the COD traps aboard like everybody else
  const gear = _gearSet([[0, -2.35, 5.4], [1.35, -2.35, -0.6], [-1.35, -2.35, -0.6]], 0.4, 1.6);
  g.add(gear);
  const hook = box(0.1, 0.1, 2.4, 0xcccccc); hook.position.set(0, -0.9, -9.6);
  hook.rotation.x = -0.5; hook.visible = false; g.add(hook);
  // VRC-30: NAVY titles, RW tail code, modex 30
  const navy = _nameTex('U.S. NAVY', TX);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.6), new THREE.MeshBasicMaterial({ map: navy, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 1.98, 0.5, -4.6); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  const code = _nameTex('RW 30', TX);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.5), new THREE.MeshBasicMaterial({ map: code, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 0.17, 3.1, -13.9); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  g.userData = { ab: [], gear, hook, stabL: null, stabR: null, stores: {}, props, wingR, wingL, foldUp: false, type: 'c2' };
  addNavLights(g, 12.3, -13.7, 1.6);
  return g;
}

// ---------------- S-3B Viking — VS-37 Sawbucks, CVW-15 (NL), 1994 ----------------
export function buildS3() {
  const g = new THREE.Group();
  const C = 0xaab2b8, CD = 0x8d979e, GL = 0x232e38, DK = 0x39434c;
  // the Hoover: fat little sub-hunter, high wing, twin turbofan pods
  const fus = cyl(1.18, 1.05, 11.6, C, 12); g.add(fus);
  const nose = cone(1.18, 2.8, C, 10); nose.position.set(0, 0, 7.2); g.add(nose);
  // big four-pane office up front
  const ck = box(1.55, 0.85, 1.7, GL); ck.position.set(0, 0.72, 5.7); ck.rotation.x = 0.14; g.add(ck);
  // MAD stinger tail
  const st = cyl(0.3, 0.08, 3.4, CD, 8); st.position.set(0, 0.2, -7.4); g.add(st);
  // high wing, slight sweep
  const wG = wingGeo([[1.2, 1.9], [1.2, -2.0], [10.4, -3.7], [10.4, -2.5]], 0.26);
  let wingR, wingL;
  for (const s of [1, -1]) { const w = new THREE.Mesh(wG, M(C)); w.scale.x = s; w.position.y = 1.05; g.add(w); if (s > 0) wingR = w; else wingL = w; }
  // TF34 pods slung under the wing
  for (const s of [1, -1]) {
    const nac = cyl(0.64, 0.56, 3.6, C, 10); nac.position.set(s * 3.7, 0.25, 0.8); g.add(nac);
    const face = cyl(0.52, 0.52, 0.14, 0x0c0e10, 10); face.position.set(s * 3.7, 0.25, 2.62); g.add(face);
    const spinner = cone(0.16, 0.4, CD, 8); spinner.position.set(s * 3.7, 0.25, 2.68); g.add(spinner);
    const pipe = cyl(0.44, 0.44, 0.16, 0x0a0a0c, 8); pipe.position.set(s * 3.7, 0.25, -1.05); g.add(pipe);
  }
  // tall single fin (it folds on the real jet) + low all-moving stabilators
  const fin = new THREE.Mesh(wingGeo([[0, 2.6], [0, -2.9], [4.3, -3.9], [4.3, -2.8]], 0.26), M(C));
  fin.rotation.z = Math.PI / 2; fin.position.set(0, 0.9, -4.7); g.add(fin);
  const sG = wingGeo([[0.4, 0.5], [0.4, -1.4], [3.9, -1.9], [3.9, -1.0]], 0.17);
  const stabL = new THREE.Mesh(sG, M(C)); stabL.position.set(0.45, 0.35, -5.1); g.add(stabL);
  const stabR = new THREE.Mesh(sG, M(C)); stabR.scale.x = -1; stabR.position.set(-0.45, 0.35, -5.1); g.add(stabR);
  // sonobuoy chute dots along the belly
  for (let i = 0; i < 4; i++) {
    const chute = cyl(0.09, 0.09, 0.1, 0x3c444c, 6); chute.position.set((i % 2) * 0.5 - 0.25, -1.12, 1.5 - Math.floor(i / 2) * 0.8); g.add(chute);
  }
  // gear + hook
  const gear = _gearSet([[0, -1.95, 5.2], [1.15, -1.95, -0.1], [-1.15, -1.95, -0.1]]);
  g.add(gear);
  const hook = box(0.1, 0.1, 2.4, 0xcccccc); hook.position.set(0, -0.5, -6.6);
  hook.rotation.x = -0.5; hook.visible = false; g.add(hook);
  // VS-37 Sawbucks, last cruise 1994: NAVY aft, NL 700 on the fin
  const navy = _nameTex('U.S. NAVY', DK);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.44), new THREE.MeshBasicMaterial({ map: navy, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 1.22, 0.3, -3.4); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  const code = _nameTex('NL 700', DK);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.5), new THREE.MeshBasicMaterial({ map: code, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 0.15, 2.9, -6.2); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  const modex = _nameTex('700', DK);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.34), new THREE.MeshBasicMaterial({ map: modex, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 0.8, 0.05, 6.9); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  g.userData = { ab: [], gear, hook, stabL, stabR, stores: {}, wingR, wingL, foldUp: true, type: 's3' };
  addNavLights(g, 10.5, -8.6, 1.2);
  return g;
}

// ---------------- F-15C Eagle — U.S. Air Force, 1994 ----------------
export function buildF15() {
  const g = new THREE.Group();
  const C = 0x9aa6b2, CD = 0x7f8b97, GL = 0x6a7a80, DK = 0x4c565e;
  // big air-superiority bruiser: wide flat body, twin tails, huge wing
  const fus = box(2.1, 1.35, 9.0, C); fus.position.z = -0.5; g.add(fus);
  const spine = box(1.5, 0.42, 6.6, CD); spine.position.set(0, 0.9, -2.6); g.add(spine);
  const nose = cone(0.98, 4.8, C); nose.scale.set(1.12, 0.88, 1); nose.position.z = 6.4; g.add(nose);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.88, 10, 8), M(GL));
  canopy.scale.set(0.85, 0.68, 2.1); canopy.position.set(0, 0.98, 2.9); g.add(canopy);
  // the canted, angled intake boxes under the wing roots
  for (const s of [1, -1]) {
    const it = box(0.95, 1.15, 3.4, CD); it.position.set(s * 1.5, -0.3, 1.0); it.rotation.z = -s * 0.1; g.add(it);
    const mouth = box(0.75, 0.85, 0.14, 0x0c0e10); mouth.position.set(s * 1.62, -0.25, 2.74); mouth.rotation.z = -s * 0.1; g.add(mouth);
  }
  // shoulder wing, big chord, raked tips
  const wG = wingGeo([[1.1, 1.3], [1.1, -2.9], [6.5, -4.5], [6.5, -3.3]], 0.22);
  for (const s of [1, -1]) { const w = new THREE.Mesh(wG, M(C)); w.scale.x = s; w.position.y = 0.55; g.add(w); }
  // twin tails canted OUT, riding the engine humps
  const tG = wingGeo([[0, 0.5], [0, -2.4], [3.0, -3.3], [3.0, -2.3]], 0.18);
  for (const s of [1, -1]) {
    const t = new THREE.Mesh(tG, M(C));
    t.rotation.z = Math.PI / 2 + s * 0.2;
    t.position.set(s * 1.55, 0.75, -4.4); g.add(t);
  }
  // twin F100s: humps, nozzles, burner cans
  const ab = [];
  for (const s of [1, -1]) {
    const e = cyl(0.7, 0.62, 5.0, CD); e.position.set(s * 0.95, -0.2, -5.6); g.add(e);
    const nz = cyl(0.54, 0.44, 1.1, 0x33383e); nz.position.set(s * 0.95, -0.2, -8.3); g.add(nz);
    const ni = cyl(0.38, 0.38, 0.18, 0x0a0a0c); ni.position.set(s * 0.95, -0.2, -8.78); g.add(ni);
    const f = abFlame(4.2, 0.52); f.position.set(s * 0.95, -0.2, -9.8); g.add(f); ab.push(f);
  }
  // all-moving stabilators, low at the tail
  const sG = wingGeo([[0.3, 0.3], [0.3, -1.7], [3.7, -1.5], [3.7, -0.3]], 0.15);
  const stabL = new THREE.Mesh(sG, M(C)); stabL.position.set(0.4, -0.3, -5.9); g.add(stabL);
  const stabR = new THREE.Mesh(sG, M(C)); stabR.scale.x = -1; stabR.position.set(-0.4, -0.3, -5.9); g.add(stabR);
  // gear — land-based only, no hook, no catapult bridle
  const gear = _gearSet([[0, -2.0, 4.0], [1.1, -2.0, -1.0], [-1.1, -2.0, -1.0]]);
  g.add(gear);
  // air-to-air load: AMRAAMs on the fuselage corners, Sidewinders on the wings
  const stores = { aim9: [], aim120: [] };
  for (const s of [1, -1]) {
    const m9 = missileMesh(0xe8e8e8, 2.9, 0.13); m9.position.set(s * 5.6, -0.3, -3.4); g.add(m9); stores.aim9.push(m9);
    for (const pz of [0.2, -2.2]) {
      const m120 = missileMesh(0xd8d8d8, 3.6, 0.16); m120.position.set(s * 1.75, -1.05, pz); g.add(m120); stores.aim120.push(m120);
    }
  }
  // subdued USAF: titles aft, tail codes on the fins
  const usaf = _nameTex('U.S. AIR FORCE', DK);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.5), new THREE.MeshBasicMaterial({ map: usaf, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 1.1, 0.25, -3.6); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  const code = _nameTex('FF', DK);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), new THREE.MeshBasicMaterial({ map: code, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 1.66, 2.6, -5.6); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  g.userData = { ab, gear, hook: null, stabL, stabR, stores, type: 'f15' };
  addNavLights(g, 6.6, -8.6, 0.9);
  return g;
}

// ---------------- A-10A Thunderbolt II — U.S. Air Force, 1994 ----------------
export function buildA10() {
  const g = new THREE.Group();
  const C = 0x5f666e, CD = 0x4c535a, GL = 0x1c262e, DK = 0x2e343a;
  // the Hawg: straight wing, gun nose, engines on the shoulders, twin tails
  const fus = box(1.85, 1.6, 9.6, C); fus.position.z = -0.3; g.add(fus);
  const nose = cone(0.95, 2.8, C); nose.scale.set(1.05, 0.92, 1); nose.position.set(0, -0.1, 5.6); g.add(nose);
  // the GAU-8's muzzle, low and offset like the real gun install
  const gun = cyl(0.16, 0.16, 0.9, 0x1c2024, 8); gun.position.set(0.22, -0.62, 6.4); g.add(gun);
  // bubble canopy in its raised tub
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), M(0x54646e));
  canopy.scale.set(0.85, 0.7, 1.7); canopy.position.set(0, 0.95, 3.3); g.add(canopy);
  // long straight wing with the hint of a droop at the tips
  const wG = wingGeo([[0.9, 1.2], [0.9, -1.4], [8.7, -2.3], [8.7, -1.2]], 0.3);
  for (const s of [1, -1]) { const w = new THREE.Mesh(wG, M(C)); w.scale.x = s; w.position.y = -0.15; g.add(w); }
  // station pylons — the Hog never flies clean
  for (const s of [1, -1]) for (const px of [2.6, 4.6, 6.6]) {
    const py = box(0.22, 0.5, 1.3, CD); py.position.set(s * px, -0.55, -0.4); g.add(py);
  }
  // TF34 pods on the aft shoulders
  for (const s of [1, -1]) {
    const nac = cyl(0.74, 0.68, 3.8, C, 10); nac.position.set(s * 1.8, 1.15, -3.2); g.add(nac);
    const face = cyl(0.58, 0.58, 0.14, 0x0c0e10, 10); face.position.set(s * 1.8, 1.15, -1.28); g.add(face);
    const pipe = cyl(0.5, 0.5, 0.16, 0x0a0a0c, 8); pipe.position.set(s * 1.8, 1.15, -5.14); g.add(pipe);
  }
  // wide stabilator carrying a fin at each tip
  const sG = wingGeo([[0.4, 0.4], [0.4, -1.4], [4.5, -1.7], [4.5, -0.7]], 0.17);
  const stabL = new THREE.Mesh(sG, M(C)); stabL.position.set(0.45, 0.4, -5.4); g.add(stabL);
  const stabR = new THREE.Mesh(sG, M(C)); stabR.scale.x = -1; stabR.position.set(-0.45, 0.4, -5.4); g.add(stabR);
  for (const s of [1, -1]) {
    const fin = new THREE.Mesh(wingGeo([[0, 1.0], [0, -1.6], [2.0, -2.1], [2.0, -1.3]], 0.15), M(C));
    fin.rotation.z = Math.PI / 2; fin.position.set(s * 4.3, 0.55, -5.5); g.add(fin);
    // DM tail code on both fins
    const code = _nameTex('DM', 0x1c222a);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.48), new THREE.MeshBasicMaterial({ map: code, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 4.42, 1.6, -6.2); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  // gear — mains hang half-out of their fairings, Hawg style; nose strut offset
  const gear = _gearSet([[0.35, -1.95, 4.2], [2.3, -1.95, -0.7], [-2.3, -1.95, -0.7]], 0.38, 1.3);
  g.add(gear);
  // a pair of Sidewinders on the outboard rails — self-escort only
  const stores = { aim9: [] };
  for (const s of [1, -1]) {
    const m9 = missileMesh(0xd8d8d8, 2.9, 0.13); m9.position.set(s * 7.4, -0.75, -0.6); g.add(m9); stores.aim9.push(m9);
  }
  // subdued USAF titles aft
  const usaf = _nameTex('U.S. AIR FORCE', DK);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 0.46), new THREE.MeshBasicMaterial({ map: usaf, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 0.96, 0.15, -3.9); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  g.userData = { ab: [], gear, hook: null, stabL, stabR, stores, type: 'a10' };
  addNavLights(g, 8.8, -6.9, 0.9);
  return g;
}

// ---------------- Su-27 Flanker — Soviet-era markings ----------------
export function buildSU27() {
  const g = new THREE.Group();
  const C = 0x8294a8, CD = 0x6b7d92, GL = 0x1e2a34, DK = 0x3c4a58;
  // long, elegant bruiser: drooped nose, tunnel body, tail stinger
  const fus = box(2.0, 1.25, 9.8, C); fus.position.z = -0.9; g.add(fus);
  const spine = box(1.3, 0.4, 7.0, CD); spine.position.set(0, 0.8, -2.6); g.add(spine);
  const nose = cone(0.92, 5.6, C); nose.scale.set(1.08, 0.85, 1); nose.position.set(0, -0.08, 7.2); nose.rotation.x = 0.05; g.add(nose);
  // big bubble canopy + the IRST ball ahead of the windscreen
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), M(0x3c4a56));
  canopy.scale.set(0.85, 0.66, 2.2); canopy.position.set(0, 0.9, 3.2); g.add(canopy);
  const irst = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), M(GL)); irst.position.set(0.18, 0.72, 5.2); g.add(irst);
  // rectangular intakes under the LERX, wedge-profiled
  for (const s of [1, -1]) {
    const it = box(0.9, 0.95, 3.6, CD); it.position.set(s * 1.3, -0.6, 0.7); g.add(it);
    const mouth = box(0.72, 0.68, 0.14, 0x0c0e10); mouth.position.set(s * 1.3, -0.6, 2.54); g.add(mouth);
  }
  // LERX blending into the big swept wing
  const lexG = wingGeo([[0.5, 4.8], [2.1, 0.4], [0.5, 0.4]], 0.12);
  for (const s of [1, -1]) {
    const lex = new THREE.Mesh(lexG, M(CD)); lex.scale.x = s; lex.position.set(0, 0.25, 0.6); g.add(lex);
  }
  const wG = wingGeo([[1.1, 1.0], [1.1, -3.0], [7.3, -4.7], [7.3, -3.4]], 0.2);
  for (const s of [1, -1]) { const w = new THREE.Mesh(wG, M(C)); w.scale.x = s; w.position.y = 0.3; g.add(w); }
  // twin canted tails on the nacelles + small ventrals
  const tG = wingGeo([[0, 0.6], [0, -2.5], [3.1, -3.4], [3.1, -2.4]], 0.18);
  for (const s of [1, -1]) {
    const t = new THREE.Mesh(tG, M(C));
    t.rotation.z = Math.PI / 2 + s * 0.22;
    t.position.set(s * 1.75, 0.8, -4.7); g.add(t);
    const vf = box(0.12, 0.85, 1.4, CD); vf.position.set(s * 1.3, -0.95, -5.9); vf.rotation.z = -s * 0.12; g.add(vf);
  }
  // widely spaced AL-31s + the stinger boom between the nozzles
  const ab = [];
  for (const s of [1, -1]) {
    const e = cyl(0.64, 0.56, 5.6, CD); e.position.set(s * 1.2, -0.4, -6.1); g.add(e);
    const nz = cyl(0.5, 0.4, 1.2, 0x33383e); nz.position.set(s * 1.2, -0.4, -9.1); g.add(nz);
    const ni = cyl(0.34, 0.34, 0.18, 0x0a0a0c); ni.position.set(s * 1.2, -0.4, -9.62); g.add(ni);
    const f = abFlame(4.0, 0.48); f.position.set(s * 1.2, -0.4, -10.5); g.add(f); ab.push(f);
  }
  const stinger = cyl(0.24, 0.1, 3.2, C, 8); stinger.position.set(0, -0.15, -9.9); g.add(stinger);
  // all-moving stabilators
  const sG = wingGeo([[0.3, 0.3], [0.3, -1.7], [3.9, -1.6], [3.9, -0.4]], 0.15);
  const stabL = new THREE.Mesh(sG, M(C)); stabL.position.set(0.4, -0.2, -6.5); g.add(stabL);
  const stabR = new THREE.Mesh(sG, M(C)); stabR.scale.x = -1; stabR.position.set(-0.4, -0.2, -6.5); g.add(stabR);
  // gear
  const gear = _gearSet([[0, -2.0, 4.4], [1.25, -2.0, -1.2], [-1.25, -2.0, -1.2]]);
  g.add(gear);
  // soviet stars on the fins and rear fuselage, blue bort 38 on the nose
  for (const s of [1, -1]) {
    const p = starDecal(1.3); p.position.set(s * 1.86, 2.5, -5.9); p.rotation.y = s * Math.PI / 2; g.add(p);
    const p2 = starDecal(1.1); p2.position.set(s * 1.06, 0.1, -3.4); p2.rotation.y = s * Math.PI / 2; g.add(p2);
  }
  const bort = _nameTex('38', 0x2a5fd0);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshBasicMaterial({ map: bort, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 0.72, 0.15, 5.6); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  g.userData = { ab, gear, hook: null, stabL, stabR, stores: {}, type: 'su27' };
  addNavLights(g, 7.4, -9.6, 0.9);
  return g;
}

// ---------------- AV-8B Harrier II — VMA-513 Flying Nightmares ----------------
// the jump jet: bicycle gear with wingtip outriggers, four rotating nozzles,
// big semicircular intakes and a drooping anhedral wing. No afterburner —
// the Pegasus is all fan.
export function buildHarrier() {
  const g = new THREE.Group();
  const C = 0x9fa8ad, CD = 0x868f95, GL = 0x202a33, DK = 0x39434c;
  // plump fuselage with the fan hump rising behind the cockpit
  const fus = cyl(0.98, 0.9, 10.6, C, 12); g.add(fus);
  const nose = cone(0.98, 2.9, C, 10); nose.position.set(0, 0.08, 6.7); g.add(nose);
  // pointy little pitot — the Harrier's lance
  const pitot = cyl(0.03, 0.03, 1.5, DK, 5); pitot.position.set(0, 0.18, 8.6); g.add(pitot);
  // bubble canopy well forward
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.72, 10, 8), M(0x3a4a55));
  canopy.scale.set(0.82, 0.72, 1.6); canopy.position.set(0, 0.88, 4.6); g.add(canopy);
  // dorsal hump over the fan, running back to the tail
  const hump = box(0.9, 0.55, 6.2, CD); hump.position.set(0, 0.85, -1.2); g.add(hump);
  // the big semicircular intakes with suction doors dotted along the tops
  for (const s of [1, -1]) {
    const it = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 2.2, 12, 1, false, 0, Math.PI), M(CD));
    it.rotation.z = Math.PI / 2; it.rotation.y = Math.PI / 2;   // half-round, flat face inboard
    it.position.set(s * 0.92, 0.35, 1.9); g.add(it);
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.82, 12, 0, Math.PI), M(0x0c0e10));
    mouth.position.set(s * 0.92, 0.35, 3.02); g.add(mouth);
  }
  // four rotating nozzles amidships — the vectored-thrust signature
  const nozzles = [];
  for (const s of [1, -1]) for (const z of [0.6, -1.4]) {
    const nz = new THREE.Group();
    const body = cyl(0.34, 0.28, 1.0, 0x4a535a, 8); body.rotation.x = Math.PI / 2; nz.add(body);
    const lip = cyl(0.3, 0.3, 0.1, 0x14181c, 8); lip.rotation.x = Math.PI / 2; lip.position.z = -0.5; nz.add(lip);
    nz.position.set(s * 1.05, -0.15, z); nz.rotation.x = Math.PI / 2;   // aft-canted in wing-borne flight
    g.add(nz); nozzles.push(nz);
  }
  // high wing with the marked anhedral, big LERX running to the intakes
  const wG = wingGeo([[1.1, 1.6], [1.1, -1.9], [5.7, -3.1], [5.7, -1.7]], 0.22);
  let wingR, wingL;
  for (const s of [1, -1]) {
    const w = new THREE.Mesh(wG, M(C)); w.scale.x = s; w.position.y = 1.05;
    w.rotation.z = s * -0.16;   // the droop
    g.add(w);
    const lrx = new THREE.Mesh(wingGeo([[0.9, 2.6], [0.9, 1.6], [2.4, 0.6], [2.4, 0.2]], 0.14), M(C));
    lrx.scale.x = s; lrx.position.y = 0.75; g.add(lrx);
    if (s > 0) wingR = w; else wingL = w;
  }
  // single fin + anhedral stabilators low on the tailcone, ventral strake
  const fin = new THREE.Mesh(wingGeo([[0, 2.1], [0, -2.9], [3.2, -3.9], [3.2, -2.7]], 0.2), M(C));
  fin.rotation.z = Math.PI / 2; fin.position.set(0, 0.8, -4.2); g.add(fin);
  const sG = wingGeo([[0.3, 0.4], [0.3, -1.3], [3.1, -1.7], [3.1, -0.8]], 0.15);
  const stabL = new THREE.Mesh(sG, M(C)); stabL.position.set(0.35, 0.1, -4.9); stabL.rotation.z = 0.28; g.add(stabL);
  const stabR = new THREE.Mesh(sG, M(C)); stabR.scale.x = -1; stabR.position.set(-0.35, 0.1, -4.9); stabR.rotation.z = -0.28; g.add(stabR);
  const vent = box(0.12, 0.7, 2.0, CD); vent.position.set(0, -0.95, -4.0); g.add(vent);
  // twin gun/ammo pods faired into the belly — the GAU-12 fit
  for (const s of [1, -1]) {
    const pod = cyl(0.24, 0.2, 3.4, CD, 8); pod.position.set(s * 0.42, -0.95, -0.6); g.add(pod);
  }
  // bicycle gear: tandem mains on the centerline + wingtip outriggers
  const gear = _gearSet([[0, -1.7, 2.6], [0, -1.7, -2.2], [5.5, -0.9, -2.2], [-5.5, -0.9, -2.2]], 0.26, 1.0);
  g.add(gear);
  // MARINES on the intakes, modex 55 on the nose (VMA-513)
  const usmc = _nameTex('MARINES', DK);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.4), new THREE.MeshBasicMaterial({ map: usmc, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 1.62, 0.3, -0.6); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  const modex = _nameTex('WF 55', DK);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.42), new THREE.MeshBasicMaterial({ map: modex, transparent: true, side: THREE.FrontSide }));
    p.position.set(s * 0.62, 0.0, 5.9); p.rotation.y = s * Math.PI / 2; g.add(p);
  }
  g.userData = { ab: [], gear, hook: null, stabL, stabR, stores: {}, wingR, wingL, foldUp: false, nozzles, type: 'av8b' };
  addNavLights(g, 5.7, -6.6, 1.0);
  return g;
}

// ---------------- high-altitude surveillance balloon ----------------
// the 2023 intruder: a white latex envelope the size of three buses riding
// the jet stream at 60,000 ft, truss payload underneath with solar arrays.
export function buildBalloon() {
  const g = new THREE.Group();
  // envelope: slightly teardrop latex, fat at the equator
  const env = new THREE.Mesh(new THREE.SphereGeometry(9, 18, 14), M(0xf2f4f6));
  env.scale.set(1, 1.15, 1); g.add(env);
  // subtle panel seams: meridian gore lines from pole to pole
  for (let i = 0; i < 6; i++) {
    const seam = new THREE.Mesh(new THREE.TorusGeometry(9.02, 0.05, 4, 32), M(0xd8dde2));
    seam.rotation.y = (i / 6) * Math.PI;   // torus already stands in a vertical plane
    seam.scale.set(1, 1.15, 1);
    g.add(seam);
  }
  // net lines down to the payload
  const rig = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const line = cyl(0.03, 0.03, 10.4, 0x8a9098, 4);
    line.position.set(Math.cos(a) * 2.4, -12.4, Math.sin(a) * 2.4);
    line.rotation.x = Math.cos(a) * 0.22; line.rotation.z = -Math.sin(a) * 0.22;
    line.rotation.order = 'ZXY';
    rig.add(line);
  }
  g.add(rig);
  // payload truss with equipment boxes and the big solar panel wings
  const truss = new THREE.Group();
  const bus = box(3.2, 1.6, 2.2, 0xb8bec4); truss.add(bus);
  const crate = box(1.2, 1.0, 1.4, 0x9aa2a8); crate.position.set(1.4, -1.1, 0); truss.add(crate);
  const antenna = cyl(0.04, 0.04, 2.6, 0x565e66, 5); antenna.position.set(-1.2, -1.6, 0); antenna.rotation.x = Math.PI / 2; truss.add(antenna);
  for (const s of [1, -1]) {
    const panel = box(6.4, 0.12, 2.6, 0x24384c); panel.position.set(s * 5.0, 0.2, 0); truss.add(panel);
    const boom = cyl(0.06, 0.06, 3.4, 0x8a9098, 5); boom.rotation.z = Math.PI / 2; boom.position.set(s * 2.6, 0.2, 0); truss.add(boom);
  }
  truss.position.y = -17.6; g.add(truss);
  g.userData = { ab: [], gear: null, hook: null, stabL: null, stabR: null, stores: {}, balloon: env, payload: truss, type: 'balloon' };
  return g;
}

// ---------------- go-fast boat — the hijackers' runabouts ----------------
// 9 m planing hull, center console, twin outboards: the classic smuggler's
// speedboat, and the thing swarming a seized cruise ship looks exactly like.
export function buildBoat() {
  const g = new THREE.Group();
  const H = 0xdadde0, DK = 0x2b343c;
  // planing hull with a raked bow
  const hull = new THREE.Mesh(wingGeo([[0, 4.6], [1.35, 2.2], [1.5, -4.2], [-1.5, -4.2], [-1.35, 2.2]], 1.1), M(H));
  hull.rotation.y = Math.PI; hull.position.y = 0.1; g.add(hull);
  // gunwale stripe
  const stripe = box(3.1, 0.14, 8.2, 0x2050a0); stripe.position.y = 1.06; g.add(stripe);
  // center console + windscreen
  const con = box(1.1, 0.9, 1.3, H); con.position.set(0, 1.6, 0.4); g.add(con);
  const ws = box(1.0, 0.5, 0.12, 0x3a4a55); ws.position.set(0, 2.25, 1.0); ws.rotation.x = -0.3; g.add(ws);
  // twin outboards
  for (const s of [1, -1]) {
    const ob = box(0.4, 0.9, 0.7, DK); ob.position.set(s * 0.55, 1.0, -4.5); g.add(ob);
  }
  g.userData = { ab: [], gear: null, hook: null, stabL: null, stabR: null, stores: {}, type: 'boat' };
  return g;
}

// ---------------- MISSION ACCOMPLISHED banner (m9 set dressing) ------------
// flag-cloth backdrop, bold white serif — hung from the island for the
// carrier address. Scale-y animates the unfurl.
let _bannerTex = null;
export function buildBanner() {
  if (!_bannerTex) {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
    const x = c.getContext('2d');
    // clean navy field so the words carry; flag trim at the edges only
    x.fillStyle = '#16224e'; x.fillRect(0, 0, 2048, 1024);
    // canton of stars, top-left
    x.fillStyle = '#0a1440'; x.fillRect(0, 0, 520, 330);
    x.fillStyle = '#ffffff';
    for (let r = 0; r < 5; r++) for (let s = 0; s < 8; s++) {
      x.beginPath(); x.arc(42 + s * 60 + (r % 2) * 28, 40 + r * 60, 11, 0, 7); x.fill();
    }
    // stripes along the bottom edge
    for (let i = 0; i < 4; i++) {
      x.fillStyle = i % 2 ? '#ffffff' : '#b22234';
      x.fillRect(0, 880 + i * 36, 2048, 36);
    }
    // the words — big serif, dark outline, hard shadow: readable from the groove
    x.font = '900 200px Georgia, "Times New Roman", serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineJoin = 'round';
    x.strokeStyle = '#0a1030'; x.lineWidth = 22;
    x.strokeText('MISSION', 1024, 330);
    x.strokeText('ACCOMPLISHED', 1024, 620);
    x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 14; x.shadowOffsetY = 7;
    x.fillStyle = '#ffffff';
    x.fillText('MISSION', 1024, 330);
    x.fillText('ACCOMPLISHED', 1024, 620);
    _bannerTex = new THREE.CanvasTexture(c);
    _bannerTex.anisotropy = 4;
  }
  const g = new THREE.Group();
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(12, 6),
    new THREE.MeshBasicMaterial({ map: _bannerTex, side: THREE.DoubleSide }));
  g.add(cloth);
  // suspension lines running up to the island top
  const lm = M(0x888888);
  for (const s of [1, -1]) {
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 8, 4), lm);
    line.position.set(s * 5.8, 7, 0); g.add(line);
  }
  g.userData = { cloth, type: 'banner' };
  return g;
}

export function buildModel(type, livery = 0) {
  switch (type) {
    case 'f18': return buildFA18();
    case 'f16': return buildF16();
    case 'f14': return buildF14();
    case 'f15': return buildF15();
    case 'a10': return buildA10();
    case 'su27': return buildSU27();
    case 'a6': return buildA6();
    case 'c2': return buildC2();
    case 's3': return buildS3();
    case 'mig29': return buildMiG29();
    case 'seahawk': return buildSeahawk();
    case 'apache': return buildApache();
    case 'p3': return buildP3();
    case 'e2c': return buildE2C();
    case 'av8b': return buildHarrier();
    case 'balloon': return buildBalloon();
    case 'boat': return buildBoat();
    case 'b747': return build747();
    case 'b707': return build707();
    case 'b744': return build744(livery);
    case 'b737': return build737(livery);
    case 'dc10': return buildDC10(livery);
    case 'md90': return buildMD90(livery);
    case 'cruise': return buildCruiseMissile();
    case 'raft': return buildRaft();
    case 'sub': return buildSub();
  }
  return buildFA18();
}

// sprite textures for FX
export function makeGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,200,80,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, inner.replace('1)', '0.7)')); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
export function makeSmokeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  gr.addColorStop(0, 'rgba(200,200,200,0.85)'); gr.addColorStop(1, 'rgba(120,120,120,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
