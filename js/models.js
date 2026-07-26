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
    const fs = starDecal(1.3); fs.position.set(s * 2.95, 1.9, -5.0); fs.rotation.y = s * Math.PI / 2; g.add(fs);
  }
  // red stars on the wing tops — the enemy's colours
  for (const s of [1, -1]) {
    const ws = starDecal(1.6); ws.position.set(s * 3.6, 0.24, -2.6); ws.rotation.x = -Math.PI / 2; g.add(ws);
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

export function buildModel(type, livery = 0) {
  switch (type) {
    case 'f18': return buildFA18();
    case 'f16': return buildF16();
    case 'f14': return buildF14();
    case 'mig29': return buildMiG29();
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
