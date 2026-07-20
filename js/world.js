// world.js — San Francisco Bay Area: terrain, ocean, sky, city, bridges, carrier, airports
import * as THREE from 'three';
import { clamp, lerp, fbm, noise2, rand } from './util.js';

// ---------- polygon coastline ----------
// Traced against the original game's satellite map: the Pacific on the west,
// the Golden Gate strait at the origin, the SF peninsula wrapping under the
// bay's south tip, Marin headlands to the north, the San Pablo / Suisun lobe
// reaching northeast and the East Bay shore behind Oakland. x east, z south,
// listed in kilometers and scaled to meters below.
const sstep = (e0, e1, v) => { const t = clamp((v - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const _UP = new THREE.Vector3(0, 1, 0);

const PENINSULA = [ // SF peninsula + the land south of the bay (San Jose side)
  [-2, 1.8], [7, 2.8], [9, 5.5], [10.5, 9], [12, 12.5], [13.8, 16], [15.5, 20],
  [16.5, 24], [17, 27], [16.8, 31], [17, 35], [19, 37.5], [22, 38.5], [25.5, 37.8],
  [28, 39.5], [33, 41], [40, 42.5], [55, 44], [75, 46], [100, 47], [125, 48],
  [125, 130], [6, 130], [3, 90], [1, 76], [-0.5, 66], [-1.8, 57], [-3, 50],
  [-4, 43], [-4.8, 36], [-5.4, 30], [-5.6, 24], [-5.2, 18], [-4.5, 13],
  [-3.5, 8], [-2.5, 4],
];
const MARIN_EASTBAY = [ // Marin + north shore + East Bay; the bay itself is a "bite"
  [-2, -1.8], [-3.5, -5], [-5.5, -10], [-6.5, -16], [-7, -22], [-6, -28],
  [-4.5, -34], [-3, -40], [-1, -46], [1, -54], [3, -64], [5, -76], [6.5, -92], [7.5, -115],
  // inland boundary runs a few km SOUTH of the peninsula polygon's, so the
  // two landmasses overlap — no water seam east of the bay's south tip
  [130, -115], [130, 52], [100, 51], [75, 50], [55, 48], [40, 46.5], [33, 45], [28, 43.5],
  [25.5, 37.8], [28, 35], [29.5, 31], [30, 26], [24.5, 21], [24, 16], [24, 13],
  [24.5, 8], [29, 2], [30, -4], [32, -10], [36, -12], [40, -14], [46, -16],
  [52, -17], [60, -18], [70, -20],
  [74, -23], [72, -27], [64, -29], [54, -30.5], [48, -32], [40, -33], [32, -32], [26, -30], [22, -27],
  [19, -22], [17.5, -17], [15.5, -12], [14, -9], [9, -4], [2, -2],
];
const LAND_POLYS = [PENINSULA, MARIN_EASTBAY].map(p => p.map(([x, z]) => [x * 1000, z * 1000]));
const POLY_PEAK = [150, 330];
const POLY_BBOX = LAND_POLYS.map(p => {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return { x0, x1, z0, z1 };
});
const ISLANDS = [
  { x: 10000,  z: 0,     r: 230,  peak: 44,  f: 0.004,  s: 5 },  // Alcatraz
  { x: 16500,  z: -6000, r: 1000, peak: 250, f: 0.0012, s: 9 },  // Angel Island
  { x: -46000, z: 4200,  r: 420,  peak: 100, f: 0.005,  s: 3 },  // Farallon
];
function _inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function _distToPoly(x, z, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const x1 = poly[j][0], z1 = poly[j][1], dx = poly[i][0] - x1, dz = poly[i][1] - z1;
    const t = clamp(((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz), 0, 1);
    const ex = x - (x1 + dx * t), ez = z - (z1 + dz * t);
    const dd = ex * ex + ez * ez;
    if (dd < best) best = dd;
  }
  return Math.sqrt(best);
}
const FLATS = [
  { x: 7000,  z: 5200,  r: 2600, y: 14 },   // downtown SF
  { x: 13000, z: 20000, r: 2400, y: 4 },    // SFO
  { x: 26500, z: 16000, r: 2200, y: 3 },    // Oakland Intl
  { x: 10000, z: 34000, r: 2000, y: 10 },   // Moffett Field
  { x: 14000, z: 23500, r: 900,  y: 8 },    // San Mateo (EA HQ)
];
const BUMPS = [
  { x: 4800, z: 9200, r: 900, h: 240 },  // Twin Peaks N
  { x: 5500, z: 9700, r: 900, h: 260 },  // Twin Peaks S
  { x: 8300, z: 4000, r: 500, h: 85 },   // Telegraph Hill (Coit Tower)
  { x: 3500, z: 6800, r: 1100, h: 130 }, // Nob/Russian hill mass
];

export function groundHeight(x, z) {
  let h = -12;
  for (let p = 0; p < LAND_POLYS.length; p++) {
    const B = POLY_BBOX[p];
    if (x < B.x0 || x > B.x1 || z < B.z0 || z > B.z1) continue;
    const poly = LAND_POLYS[p];
    if (!_inPoly(x, z, poly)) continue;
    const d = _distToPoly(x, z, poly);            // distance inland from the shore
    const m = clamp(d / 1300, 0, 1);
    const shore = lerp(-12, 5, Math.min(1, m * 3.2));
    // fbm dips negative — clamp the noise term so valleys flatten into
    // lowland instead of carving below sea level (solid green, like the original)
    const hills = m * m * POLY_PEAK[p] * Math.max(0, 0.25 + 1.5 * fbm(x * 0.00016 + p * 31.7, z * 0.00016 + p * 17.3, 4));
    const v = shore + hills;
    if (v > h) h = v;
  }
  for (const I of ISLANDS) {
    const d = Math.hypot(x - I.x, z - I.z);
    if (d > I.r + 900) continue;
    const m = clamp(1 - d / (I.r + 900), 0, 1);
    const v = lerp(-12, 5, Math.min(1, m * 3.2)) + m * m * I.peak * Math.max(0, 0.4 + fbm(x * I.f + I.s, z * I.f + I.s * 2, 3));
    if (v > h) h = v;
  }
  for (const B of BUMPS) {
    const d2 = (x - B.x) * (x - B.x) + (z - B.z) * (z - B.z);
    const r2 = B.r * B.r;
    if (d2 < r2 * 4) h += B.h * Math.exp(-d2 / r2);
  }
  for (const F of FLATS) {
    const d = Math.hypot(x - F.x, z - F.z);
    // flat out to 1.05r so the whole runway rectangle (len/2 ~ 0.7r) plus
    // margin sits exactly at field elevation, then a wide, gentle apron out
    // to 2.6x the pad radius: a short ramp cuts 300 m cliff walls into the
    // mesh around each airfield, and those giant vertical triangles straddle
    // ground-level cameras and wreck weak rasterizers (smears in the sky,
    // holes beside the runway)
    if (d < F.r * 2.6) h = lerp(h, F.y, sstep(F.r * 2.6, F.r * 1.05, d));
  }
  return h;
}

// ============================================================
export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.time = 0;
    this.landmarks = {
      goldenGate: new THREE.Vector3(0, 67, 0),
      downtown:   new THREE.Vector3(7000, 0, 5000),
      alcatraz:   new THREE.Vector3(10000, 45, 0),
      sfo:        new THREE.Vector3(13000, 4, 20000),
      oakland:    new THREE.Vector3(26500, 3, 16000),
      moffett:    new THREE.Vector3(10000, 10, 34000),
      farallon:   new THREE.Vector3(-46000, 60, 4200),
      ea:         new THREE.Vector3(14000, 8, 23500),
    };
    this.runways = [
      { name: 'SFO INTL',     x: 13000, z: 20000, hdg: Math.PI / 2, len: 3200, wid: 60, elev: 4 },
      { name: 'OAKLAND INTL', x: 26500, z: 16000, hdg: 0,           len: 3000, wid: 55, elev: 3 },
      { name: 'MOFFETT FLD',  x: 10000, z: 34000, hdg: Math.PI / 2, len: 2800, wid: 55, elev: 10 },
    ];
    this._buildLights();
    this._buildSky();
    this._buildOcean();
    this._buildTerrain();
    this._buildClouds();
    this._buildCity();
    this._buildGoldenGate();
    this._buildBayBridge();
    this._buildAlcatraz();
    this._buildAirports();
    this._buildFarallon();
    this._buildEA();
    this.carrier = new Carrier(this, new THREE.Vector3(-30000, 0, 10000), Math.PI / 2, false);
    this.enemySub = new Carrier(this, new THREE.Vector3(-42000, 0, -14000), Math.PI / 2, true);
    this.enemySub.group.visible = false;
    this.setTimeOfDay('day');
  }

  addCollider(cx, cy, cz, hx, hy, hz) {
    this.colliders.push({ min: { x: cx - hx, y: cy - hy, z: cz - hz }, max: { x: cx + hx, y: cy + hy, z: cz + hz } });
  }

  _buildLights() {
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.position.set(50000, 80000, -30000);
    this.scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a4a3a, 0.85);
    this.scene.add(this.hemi);
  }
  _buildSky() {
    const geo = new THREE.SphereGeometry(280000, 24, 16);
    this.skyU = {
      top:     { value: new THREE.Color(0x2a6fd4) },
      horizon: { value: new THREE.Color(0xbfd9ef) },
      sunDir:  { value: new THREE.Vector3(0.5, 0.6, -0.3).normalize() },
      sunCol:  { value: new THREE.Color(0xfff3d0) },
      night:   { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `
        uniform vec3 top, horizon, sunCol; uniform vec3 sunDir; uniform float night;
        varying vec3 vDir;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
        void main(){
          float h = clamp(vDir.y, 0.0, 1.0);
          // Amiga-flat sky: thin horizon band, then solid color — no sun disc
          vec3 col = mix(horizon, top, smoothstep(0.0, 0.12, h));
          if (night > 0.01 && vDir.y > 0.02) {
            vec3 g = floor(vDir * 220.0);
            float st = step(0.9975, hash(g)) * night * smoothstep(0.02, 0.25, vDir.y);
            col += vec3(st);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.skyMesh = new THREE.Mesh(geo, mat);
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);
    this.scene.fog = new THREE.Fog(0xbfd9ef, 12000, 130000);
  }
  setTimeOfDay(mode) {
    const S = this.skyU, F = this.scene.fog;
    // true Amiga palette, sampled from the original running under emulation:
    // day sky 0x444477, sea 0x003366 — muted, not the bright web-shot lavender
    const cfg = {
      day:     { top: 0x444477, hor: 0x444477, water: 0x003366, sun: [0.45, 0.75, -0.35], i: 1.1,  hemi: 1.0,  fog: [45000, 220000], night: 0 },
      morning: { top: 0x3c3c6e, hor: 0x6a5f7e, water: 0x0a2c55, sun: [0.85, 0.25, -0.25], i: 1.0,  hemi: 0.85, fog: [45000, 220000], night: 0 },
      dusk:    { top: 0x2e2842, hor: 0x4a3a4a, water: 0x081226, sun: [-0.9, 0.15, 0.2],   i: 0.9,  hemi: 0.75, fog: [40000, 200000], night: 0.12 },
      night:   { top: 0x0a0a24, hor: 0x181830, water: 0x060a1c, sun: [0.3, 0.5, 0.4],     i: 0.3,  hemi: 0.25, fog: [35000, 160000], night: 1 },
    }[mode] || {};
    // setRGB bypasses sRGB->linear conversion: the custom sky shader outputs
    // raw color, so feed it the exact display values (the Amiga palette)
    const raw = (hex, col) => col.setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
    raw(cfg.top, S.top.value); raw(cfg.hor, S.horizon.value);
    S.sunDir.value.set(...cfg.sun).normalize(); S.night.value = cfg.night;
    this.sun.position.copy(S.sunDir.value).multiplyScalar(120000);
    this.sun.intensity = cfg.i; this.sun.color.set(0xffffff);
    this.hemi.intensity = cfg.hemi;
    F.color.set(cfg.hor); F.near = cfg.fog[0]; F.far = cfg.fog[1];
    if (this.waterMat) this.waterMat.color.set(cfg.water);
    if (this.clouds) this.clouds.visible = false;   // the original's sky is cloudless
    this.mode = mode;
  }

  _buildOcean() {
    // The sea is one solid sheet of blue, built as a polar fan centred on the
    // camera: tiny cells near the eye (no extreme slivers for the near-plane
    // clip to mangle on weak rasterizers), growing geometrically to the
    // horizon. It follows the camera in World.update; being flat and
    // untextured, the motion is invisible.
    const RINGS = 72, SEGS = 128, R0 = 60, R1 = 260000;
    const q = Math.pow(R1 / R0, 1 / (RINGS - 1));
    const verts = [0, 0, 0];
    for (let i = 0; i < RINGS; i++) {
      const r = R0 * Math.pow(q, i);
      for (let j = 0; j < SEGS; j++) {
        const a = (j / SEGS) * Math.PI * 2;
        verts.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      }
    }
    const idx = [];
    for (let j = 0; j < SEGS; j++) idx.push(0, 1 + ((j + 1) % SEGS), 1 + j);
    for (let i = 0; i < RINGS - 1; i++) {
      for (let j = 0; j < SEGS; j++) {
        const a = 1 + i * SEGS + j, b = 1 + i * SEGS + ((j + 1) % SEGS),
              c = 1 + (i + 1) * SEGS + j, d = 1 + (i + 1) * SEGS + ((j + 1) % SEGS);
        idx.push(a, b, d, a, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    geo.setIndex(idx);
    this.waterMat = new THREE.MeshBasicMaterial({ color: 0x003366, fog: true });
    const mesh = new THREE.Mesh(geo, this.waterMat);
    mesh.position.set(5000, -2.5, 8000);   // a touch below the beaches, less grazing z-fight
    mesh.frustumCulled = false;            // it follows the camera — always visible
    this.oceanMesh = mesh;
    this.scene.add(mesh);
    // sparse whitecap specks, like the original's sea texture
    const n = 2600, wp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // keep the specks on the sea — the original's land is clean
      let x = 0, z = 0, tries = 0;
      do {
        x = 5000 + (Math.random() - 0.5) * 240000;
        z = 8000 + (Math.random() - 0.5) * 240000;
      } while (groundHeight(x, z) > -1 && tries++ < 6);
      wp[i * 3] = x; wp[i * 3 + 1] = 0.6; wp[i * 3 + 2] = z;
    }
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute('position', new THREE.BufferAttribute(wp, 3));
    const wpts = new THREE.Points(wgeo, new THREE.PointsMaterial({
      color: 0xffffff, size: 5, sizeAttenuation: true, transparent: true, opacity: 0.55, fog: true }));
    this.scene.add(wpts);
  }

  _buildTerrain() {
    const W = 230000, SEG = 480, CX = 5000, CZ = 8000;
    const geo = new THREE.PlaneGeometry(W, W, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    // flat Amiga land colors, sampled from the original: green 0x115511, grey city
    const cGrass = new THREE.Color(0x115511), cRock = new THREE.Color(0x0e4a0e),
          cSand = new THREE.Color(0x777755), cCity = new THREE.Color(0x555555),
          cDeep = new THREE.Color(0x003366), cShallow = new THREE.Color(0x003366), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + CX, z = pos.getZ(i) + CZ;
      const h = groundHeight(x, z);
      // sink submerged verts well below the water plane so distant depth
      // buffer imprecision never lets the seafloor z-fight through the sea
      let y = h < 0 ? h - 25 : h;
      // keep the coarse sheet well under the fine airfield pads: its 479 m
      // cells mis-interpolate the flattening ramps by up to ~2.3 m, which
      // buried the runway strips. Smooth 5 m depression, no cliffs.
      for (const F of FLATS) {
        const dF = Math.hypot(x - F.x, z - F.z);
        if (dF < F.r * 2.8) y -= 5 * sstep(F.r * 2.8, F.r * 0.5, dF);
      }
      pos.setY(i, y);
      const dCity = Math.hypot(x - 7000, z - 5000);
      if (h < -4) tmp.copy(cDeep);
      else if (h < 1.5) tmp.copy(cSand);
      else if (h < 3) tmp.copy(cShallow).lerp(cSand, sstep(-2, 1.5, h));
      else if (dCity < 2800) tmp.copy(cCity).lerp(cGrass, sstep(1600, 2800, dCity));
      else tmp.copy(cGrass).lerp(cRock, sstep(170, 320, h));
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // unlit: the original's terrain is flat-filled polygons with no shading.
    // (depth separation from the ocean is handled by the renderer's
    // logarithmic depth buffer — polygonOffset can't span 1.5m..320km)
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(CX, 0, CZ);
    this.scene.add(mesh);

    // Fine pads under each airfield: a 62 m local copy of the true surface
    // (interpolation error is sub-centimetre on the gentle ramps). The coarse
    // sheet is depressed 5 m below these discs, so the pad is the visible
    // ground around every airfield and the runway strips rest 20 cm above it.
    for (const F of FLATS) {
      const pg = new THREE.PlaneGeometry((F.r + 400) * 2, (F.r + 400) * 2, 84, 84);
      pg.rotateX(-Math.PI / 2);
      const pp = pg.attributes.position;
      const pcol = new Float32Array(pp.count * 3);
      for (let i = 0; i < pp.count; i++) {
        const x = pp.getX(i) + F.x, z = pp.getZ(i) + F.z;
        const h = groundHeight(x, z);
        pp.setY(i, h < 0 ? h - 25 : h);
        const dCity = Math.hypot(x - 7000, z - 5000);
        if (h < -4) tmp.copy(cDeep);
        else if (h < 1.5) tmp.copy(cSand);
        else if (h < 3) tmp.copy(cShallow).lerp(cSand, sstep(-2, 1.5, h));
        else if (dCity < 2800) tmp.copy(cCity).lerp(cGrass, sstep(1600, 2800, dCity));
        else tmp.copy(cGrass).lerp(cRock, sstep(170, 320, h));
        pcol[i * 3] = tmp.r; pcol[i * 3 + 1] = tmp.g; pcol[i * 3 + 2] = tmp.b;
      }
      pg.setAttribute('color', new THREE.BufferAttribute(pcol, 3));
      const pad = new THREE.Mesh(pg, mat);
      pad.position.set(F.x, 0, F.z);
      this.scene.add(pad);
    }
  }

  _cloudTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    for (let i = 0; i < 14; i++) {
      const x = 24 + rand(80), y = 44 + rand(40), r = 12 + rand(22);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
    return new THREE.CanvasTexture(c);
  }
  _buildClouds() {
    const tex = this._cloudTexture();
    this.cloudMat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.7, depthWrite: false, fog: false });
    this.clouds = new THREE.Group();
    for (let i = 0; i < 46; i++) {
      const s = new THREE.Sprite(this.cloudMat);
      const sc = rand(500, 1400);
      s.scale.set(sc, sc * 0.32, 1);
      s.position.set(rand(-70000, 80000), rand(900, 2400), rand(-50000, 70000));
      this.clouds.add(s);
    }
    this.scene.add(this.clouds);
  }

  _windowTexture() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#4c5258'; g.fillRect(0, 0, 64, 128);
    for (let y = 4; y < 124; y += 7) for (let x = 4; x < 60; x += 6) {
      const lit = Math.random() < 0.55;
      g.fillStyle = lit ? (Math.random() < 0.7 ? '#ffd890' : '#bfe0ff') : '#22262c';
      g.fillRect(x, y, 4, 4);
    }
    return new THREE.CanvasTexture(c);
  }
  _buildCity() {
    // flat light-grey boxes, like the original's untextured downtown
    this.cityMat = new THREE.MeshLambertMaterial({ color: 0x777777, flatShading: true });
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const N = 130;
    this.cityMesh = new THREE.InstancedMesh(box, this.cityMat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let i = 0, guard = 0;
    while (i < N && guard++ < 2000) {
      const a = rand(Math.PI * 2), r = Math.pow(rand(), 0.6) * 1900;
      const x = 7000 + Math.cos(a) * r, z = 5000 + Math.sin(a) * r * 0.85;
      const g = groundHeight(x, z); if (g < 2) continue;
      const tall = r < 700;
      const h = tall ? rand(120, 260) : rand(18, 80);
      const w = rand(22, 55), d = rand(22, 55);
      p.set(x, g - 1, z); s.set(w, h, d); q.setFromAxisAngle(up, rand(Math.PI));
      m.compose(p, q, s);
      this.cityMesh.setMatrixAt(i, m);
      this.addCollider(x, g + h / 2, z, w / 2 + 4, h / 2 + 2, d / 2 + 4);
      i++;
    }
    this.scene.add(this.cityMesh);
    const g1 = groundHeight(7300, 4600);
    const pyr = new THREE.Mesh(new THREE.ConeGeometry(26, 260, 4), new THREE.MeshLambertMaterial({ color: 0x888888 }));
    pyr.position.set(7300, g1 + 130, 4600); pyr.rotation.y = Math.PI / 4;
    this.scene.add(pyr); this.addCollider(7300, g1 + 130, 4600, 24, 132, 24);
    const g2 = groundHeight(8300, 4000);
    const coit = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 64, 10), new THREE.MeshLambertMaterial({ color: 0xe8e0d0 }));
    coit.position.set(8300, g2 + 32, 4000); this.scene.add(coit);
    this.addCollider(8300, g2 + 32, 4000, 8, 34, 8);
    const g3 = groundHeight(5150, 9450);
    const sutro = new THREE.Group();
    const smat = new THREE.MeshLambertMaterial({ color: 0xc04030 });
    for (let k = 0; k < 3; k++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2, 300, 5), smat);
      const a = k * Math.PI * 2 / 3;
      leg.position.set(Math.cos(a) * 22, 150, Math.sin(a) * 22);
      leg.rotation.z = Math.cos(a) * 0.14; leg.rotation.x = -Math.sin(a) * 0.14;
      sutro.add(leg);
    }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(46, 4, 4), smat);
    cross.position.y = 250; cross.rotation.y = 0.5; sutro.add(cross);
    const cross2 = cross.clone(); cross2.position.y = 180; cross2.rotation.y = -0.4; sutro.add(cross2);
    sutro.position.set(5150, g3, 9450); this.scene.add(sutro);
    this.addCollider(5150, g3 + 150, 9450, 28, 152, 28);
  }

  _buildGoldenGate() {
    // unlit: the original's bridge is a flat, unmistakable dark red silhouette
    const orange = new THREE.MeshBasicMaterial({ color: 0x880000, fog: true });
    const g = new THREE.Group();
    const DECK_Y = 67, HALF = 1750;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(30, 8, HALF * 2), orange);
    deck.position.set(0, DECK_Y, 0); g.add(deck);
    this.addCollider(0, DECK_Y, 0, 16, 6, HALF);
    for (const tz of [-640, 640]) {
      for (const tx of [-14, 14]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(8, 230, 12), orange);
        leg.position.set(tx, 115, tz); g.add(leg);
      }
      for (const sy of [70, 130, 185, 225]) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(34, 10, 10), orange);
        strut.position.set(0, sy, tz); g.add(strut);
      }
      this.addCollider(0, 115, tz, 19, 118, 9);
    }
    const pts = [];
    for (const cx of [-13, 13]) {
      let prev = null;
      for (let z = -HALF; z <= HALF; z += 50) {
        const az = Math.abs(z);
        let y;
        if (az > 640) y = lerp(228, 6, sstep(640, HALF, az));
        else y = 80 + 148 * Math.pow(az / 640, 2.2);
        if (prev !== null) pts.push(cx, prev, z - 50, cx, y, z);
        prev = y;
        if (az < 640 && y > DECK_Y + 6 && (z / 50) % 2 === 0) pts.push(cx, y, z, cx, DECK_Y + 4, z);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x883333 })));
    this.scene.add(g);
  }

  _buildBayBridge() {
    // two gray spans like the original's map: Bay Bridge (SF->Oakland) and
    // the San Mateo crossing further south — each drawn shore to shore
    this._bridgeSpan(new THREE.Vector3(9800, 56, 6000), new THREE.Vector3(28000, 56, 8800));
    this._bridgeSpan(new THREE.Vector3(16800, 48, 24000), new THREE.Vector3(29600, 48, 24200));
  }
  _bridgeSpan(a, b) {
    const gray = new THREE.MeshLambertMaterial({ color: 0x9aa2a8 });
    const g = new THREE.Group();
    const dir = b.clone().sub(a), len = dir.length(), ang = Math.atan2(dir.x, dir.z);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(24, 6, len), gray);
    deck.position.copy(a).add(b).multiplyScalar(0.5); deck.rotation.y = ang;
    g.add(deck);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    this.addCollider(mid.x, mid.y, mid.z, Math.abs(dir.x) / 2 + 12, 5, Math.abs(dir.z) / 2 + 12);
    for (const t of [0.25, 0.5, 0.75]) {
      const p = a.clone().lerp(b, t);
      const tw = new THREE.Mesh(new THREE.BoxGeometry(10, 160, 10), gray);
      tw.position.set(p.x, 80, p.z); g.add(tw);
      this.addCollider(p.x, 80, p.z, 8, 84, 8);
    }
    this.scene.add(g);
  }

  _buildAlcatraz() {
    const g = new THREE.Group();
    const base = groundHeight(10000, 0);
    const rock = new THREE.Mesh(new THREE.CylinderGeometry(180, 260, 40, 12), new THREE.MeshLambertMaterial({ color: 0x8a8578 }));
    rock.position.set(10000, base - 5, 0); g.add(rock);
    const prison = new THREE.Mesh(new THREE.BoxGeometry(150, 26, 60), new THREE.MeshLambertMaterial({ color: 0xc9c2b2 }));
    prison.position.set(10000, base + 26, 0); g.add(prison);
    const light = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 26, 8), new THREE.MeshLambertMaterial({ color: 0xe8e0d0 }));
    light.position.set(10070, base + 30, 10); g.add(light);
    this.scene.add(g);
    this.addCollider(10000, base + 26, 0, 80, 22, 34);
  }

  _buildFarallon() {
    const mat = new THREE.MeshLambertMaterial({ color: 0x6f6a5e });
    for (const [x, z, r, h] of [[-46000, 4200, 500, 90], [-45400, 3900, 260, 60], [-46600, 4600, 300, 70]]) {
      const rock = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), mat);
      rock.position.set(x, h / 2 - 6, z);
      this.scene.add(rock);
      this.addCollider(x, h / 2, z, r * 0.7, h / 2, r * 0.7);
    }
  }

  _buildEA() {
    const g = groundHeight(14000, 23500);
    const b = new THREE.Mesh(new THREE.BoxGeometry(70, 42, 70), new THREE.MeshLambertMaterial({ color: 0x3a4a5c }));
    b.position.set(14000, g + 21, 23500); this.scene.add(b);
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#0a1220'; ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px monospace'; ctx.textAlign = 'center'; ctx.fillText('EA', 64, 46);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) }));
    sign.position.set(14000, g + 34, 23500 - 36); sign.rotation.y = Math.PI; this.scene.add(sign);
    this.addCollider(14000, g + 21, 23500, 36, 23, 36);
  }

  _buildAirports() {
    this.towerViews = [];   // viewpoints for the tower camera
    const mkStrip = (rw) => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 512;
      const g2 = c.getContext('2d');
      g2.fillStyle = '#5a5e63'; g2.fillRect(0, 0, 64, 512);
      g2.fillStyle = '#e8e8e8';
      for (let y = 30; y < 500; y += 42) g2.fillRect(30, y, 4, 22);
      // piano-key thresholds like the original's runways
      for (let k = 0; k < 6; k++) {
        g2.fillRect(5 + k * 9.5, 4, 5, 14); g2.fillRect(5 + k * 9.5, 494, 5, 14);
      }
      const t = new THREE.CanvasTexture(c);
      // subdivided along the length: a 3 km two-triangle strip straddles
      // ground-level cameras and breaks weak rasterizers — 75 m segments clip cleanly
      const smat = new THREE.MeshLambertMaterial({ map: t });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(rw.wid, rw.len, 1, 40), smat);
      m.rotation.x = -Math.PI / 2; m.rotation.z = -rw.hdg;
      // 20 cm above the pad (which is exactly the true surface): wins the
      // depth contest everywhere without visible float
      m.position.set(rw.x, rw.elev + 0.2, rw.z);
      this.scene.add(m);
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 40, 8), new THREE.MeshLambertMaterial({ color: 0xb8c0c8 }));
      tw.position.set(rw.x + 300, rw.elev + 20, rw.z + 300); this.scene.add(tw);
      const cab = new THREE.Mesh(new THREE.CylinderGeometry(8, 6, 10, 8), new THREE.MeshLambertMaterial({ color: 0x30414f }));
      cab.position.set(rw.x + 300, rw.elev + 44, rw.z + 300); this.scene.add(cab);
      this.addCollider(rw.x + 300, rw.elev + 24, rw.z + 300, 9, 26, 9);
      this.towerViews.push({ name: `${rw.name} TOWER`, pos: new THREE.Vector3(rw.x + 300, rw.elev + 50, rw.z + 300) });
    };
    for (const rw of this.runways) mkStrip(rw);
  }

  // carrier island cab — computed live since the ship is underway
  carrierTowerPos(out) {
    const c = this.carrier, ci = c.islandOffset;
    out.set(ci.x, c.deckY + 24, ci.z).applyAxisAngle(_UP, Math.PI - c.heading);
    return out.add(c.group.position);
  }

  update(dt, camPos) {
    this.time += dt;
    // ocean is flat — nothing to animate
    if (this.skyMesh) this.skyMesh.position.copy(camPos);
    if (this.oceanMesh) this.oceanMesh.position.set(camPos.x, -2.5, camPos.z);
    this.carrier.update(dt);
    this.enemySub.update(dt);
  }
}

// ============================================================
// Aircraft carrier (USS Enterprise) + enemy submersible carrier
// ============================================================
export class Carrier {
  constructor(world, pos, heading, isSub) {
    this.world = world; this.isSub = isSub;
    this.group = new THREE.Group();
    this.speed = isSub ? 0 : 7.7;
    this.baseSpeed = this.speed;
    this.heading = heading;
    this.turning = 0;
    this.deckY = 19.4; this.deckHalfLen = 166; this.deckHalfWid = 38;
    this.submerged = false; this.submergeT = 0;
    this._build(isSub);
    this.group.position.copy(pos);
    this.group.rotation.y = Math.PI - heading;
    world.scene.add(this.group);
  }
  _deckTexture() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 1024;
    const g = c.getContext('2d');
    g.fillStyle = '#22252a'; g.fillRect(0, 0, 256, 1024);
    g.strokeStyle = '#e8e8e8'; g.lineWidth = 3;
    g.setLineDash([30, 24]);
    g.beginPath(); g.moveTo(128, 40); g.lineTo(128, 984); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = '#d8b040'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(20, 60); g.lineTo(20, 964); g.stroke();
    g.beginPath(); g.moveTo(236, 60); g.lineTo(236, 964); g.stroke();
    g.strokeStyle = '#e8e8e8'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(30, 700); g.lineTo(200, 240); g.stroke();
    g.beginPath(); g.moveTo(50, 720); g.lineTo(220, 260); g.stroke();
    g.strokeStyle = '#ddd'; g.lineWidth = 2;
    for (const y of [420, 460, 500, 540]) { g.beginPath(); g.moveTo(60, y); g.lineTo(210, y - 60); g.stroke(); }
    if (!this.isSub) {
      g.fillStyle = '#e8e8e8'; g.font = 'bold 60px monospace';
      g.save(); g.translate(190, 950); g.rotate(Math.PI); g.fillText('65', 0, 0); g.restore();
    }
    return new THREE.CanvasTexture(c);
  }
  _build(isSub) {
    const hullC = isSub ? 0x1c2126 : 0x5a626a;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(70, 18, 320), new THREE.MeshLambertMaterial({ color: isSub ? hullC : 0x7d868f }));
    hull.position.y = 2; this.group.add(hull);
    const bow = new THREE.Mesh(new THREE.CylinderGeometry(35, 12, 18, 4, 1), new THREE.MeshLambertMaterial({ color: hullC }));
    bow.rotation.y = Math.PI / 4; bow.scale.set(1, 1, 1.6); bow.position.set(0, 2, 178); this.group.add(bow);
    const deckMat = new THREE.MeshLambertMaterial({ map: this._deckTexture() });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(76, 3, 336), deckMat);
    deck.position.y = this.deckY - 1.5; this.group.add(deck);
    if (!isSub) {
      const island = new THREE.Mesh(new THREE.BoxGeometry(14, 26, 30), new THREE.MeshLambertMaterial({ color: 0x9aa4ae }));
      island.position.set(-30, this.deckY + 13, 30); this.group.add(island);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.5, 26, 6), new THREE.MeshLambertMaterial({ color: 0x7a848e }));
      mast.position.set(-30, this.deckY + 38, 24); this.group.add(mast);
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const cx = c.getContext('2d'); cx.fillStyle = '#444c54'; cx.fillRect(0, 0, 64, 64);
      cx.fillStyle = '#fff'; cx.font = 'bold 40px monospace'; cx.textAlign = 'center'; cx.fillText('65', 32, 46);
      const num = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) }));
      num.position.set(-22.8, this.deckY + 20, 30); num.rotation.y = Math.PI / 2; this.group.add(num);
      this.islandOffset = { x: -30, z: 30 };
    } else {
      const sail = new THREE.Mesh(new THREE.BoxGeometry(10, 14, 22), new THREE.MeshLambertMaterial({ color: 0x23292e }));
      sail.position.set(0, this.deckY + 7, 60); this.group.add(sail);
    }
    const wakeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false });
    const wake = new THREE.Mesh(new THREE.PlaneGeometry(60, 700), wakeMat);
    wake.rotation.x = -Math.PI / 2; wake.position.set(0, 0.6, -480);
    this.group.add(wake); this.wake = wake;
  }
  get pos() { return this.group.position; }
  toLocal(v, out = new THREE.Vector3()) {
    const dx = v.x - this.group.position.x, dz = v.z - this.group.position.z;
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    out.set(-ch * dx - sh * dz, v.y - this.group.position.y - this.deckY, sh * dx - ch * dz);
    return out;
  }
  deckVelWorld(out = new THREE.Vector3()) {
    out.set(Math.sin(this.heading) * this.speed, 0, -Math.cos(this.heading) * this.speed);
    return out;
  }
  update(dt) {
    if (this.submerged) {
      this.submergeT += dt;
      this.group.position.y = -this.submergeT * 3.5;
      if (this.group.position.y < -80) this.group.visible = false;
      return;
    }
    if (this.isSub) { this.group.rotation.y = Math.PI - this.heading; return; }
    const p = this.group.position;
    // stay well out in the Pacific — the coast at this latitude is ~-4 km
    if (this.turning === 0 && Math.abs(Math.sin(this.heading)) > 0.5 && (p.x > -14000 || p.x < -56000)) this.turning = Math.PI;
    if (this.turning > 0) { const tr = 0.06 * dt; this.heading += tr; this.turning -= tr; if (this.turning <= 0) this.turning = 0; }
    p.x += Math.sin(this.heading) * this.speed * dt;
    p.z += -Math.cos(this.heading) * this.speed * dt;
    this.group.rotation.y = Math.PI - this.heading;
  }
  submerge() { this.submerged = true; }
}
