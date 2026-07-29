// intro.js — original-style mission entry: satellite map briefing with typed
// yellow text, plane select, then the top-down zoom onto the aircraft,
// plus the free-flight starting-location map. All rendered over the live 3D
// world from a high top-down camera, like the 1988 original.
import * as THREE from 'three';
import { clamp, lerp } from './util.js';
import { PILOT_RATING, pilotDescriptor } from './missions.js';

const _v = new THREE.Vector3();

// free flight locations, numbered like the original map — each with a one-line
// brief so the pilot knows what they're launching into
export const FF_SPOTS = [
  { key: '1', id: 'sfo',     label: 'SAN FRANCISCO INTL', desc: 'The big field on the peninsula — long runways, straight out over the Bay.' },
  { key: '2', id: 'oakland', label: 'OAKLAND INTL',       desc: 'East Bay side — the bridges and the city skyline dead ahead.' },
  { key: '3', id: 'moffett', label: 'MOFFETT FIELD',      desc: 'The quiet south-Bay pattern: all the sky to yourself, a long haul home.' },
  { key: '4', id: 'carrier', label: 'USS ENTERPRISE',     desc: 'The boat, wherever she is — cat shot, wires, the air wing around you. Tailhook only.' },
  { key: '5', id: 'alameda', label: 'NAS ALAMEDA',        desc: 'The old naval air station by the carrier piers — the shortest hop to the boat.' },
];

export class Intro {
  constructor(G) {
    this.G = G;
    this.active = null;      // 'briefing' | 'mapselect' | 'planesel' | 'zoom'
    this.t = 0;
    this.camH = 95000;       // map camera altitude — whole bay in frame like the original
    this.center = new THREE.Vector3(6000, 0, 4000);
    this.spot = null;
    this.zoomFrom = new THREE.Vector3();
    this.onDone = null;
  }

  // ---------- entry points ----------
  mapSelect() {
    this.active = 'mapselect'; this.t = 0;
    this.G.state = 'mapselect';
    this.G.world.setTimeOfDay('day');   // the original's map is always a daylight sat view
  }
  briefing(def, afterBrief) {
    this.active = 'briefing'; this.t = 0;
    this.def = def; this.afterBrief = afterBrief;
    this.G.state = 'briefing';
    this.typed = 0;
    // rated opposition gets its assessment typed into the brief itself
    this.briefLines = [...(def.brief || [])];
    const rating = PILOT_RATING[def.id];
    if (rating != null) this.briefLines.push('', `ENEMY PILOT RATING: ${rating}/100 — ${pilotDescriptor(rating).toUpperCase()}`);
    this.G.world.setTimeOfDay('day');
  }
  planeSelect(after) {
    this.active = 'planesel'; this.t = 0;
    this.afterPlane = after;
    this.G.state = 'planesel';
  }
  zoomToAircraft(cb) {
    this.active = 'zoom'; this.t = 0;
    this.zoomFrom.copy(this.G.camera.position);
    this.onDone = cb;
    this.G.state = 'zoom';
    // the key that confirmed the plane/location is still sitting in justPressed —
    // clear it so the dive isn't skipped on its very first frame
    this.G.input.justPressed.clear();
    this.G.audio.zoomRush(4.5);   // air rushing past during the dive (matches zoom time)
  }

  // ---------- per-frame ----------
  update(dt) {
    if (!this.active) return;
    const G = this.G;
    this.t += dt;
    if (this.active === 'zoom') {
      // any key skips the dive — straight to the cockpit, like the original
      if (G.input.justPressed.size > 0) {
        const cb = this.onDone; this.active = null; this.onDone = null;
        G.view = 'cockpit';
        G.audio.stopZoomRush && G.audio.stopZoomRush();
        cb && cb();
        return;
      }
      const k = clamp(this.t / 4.5, 0, 1);
      const e = k * k * (3 - 2 * k);
      // dive from map height down to just behind/above the player
      const P = G.player;
      const hdg = P.heading ?? 0;
      // fwd is (sin h, 0, -cos h), so 120m behind is the opposite
      const behind = new THREE.Vector3(-Math.sin(hdg), 0, Math.cos(hdg)).multiplyScalar(120);
      const tgt = _v.copy(P.pos).add(behind).add(new THREE.Vector3(0, 45, 0));
      G.camera.position.lerpVectors(this.zoomFrom, tgt, e);
      G.camera.lookAt(P.pos);
      if (k >= 1) { const cb = this.onDone; this.active = null; cb && cb(); }
      return;
    }
    // top-down satellite view
    G.camera.position.set(this.center.x, this.camH, this.center.z + this.camH * 0.28);
    G.camera.lookAt(this.center.x, 0, this.center.z);
    if (this.active === 'briefing') {
      const total = (this.briefLines || []).join('\n').length;
      if (this.typed < total) {
        const before = Math.floor(this.typed);
        this.typed = Math.min(total, this.typed + dt * 22);   // half speed — time to read the map
        // teletype chatter as each character hits the screen (original behavior)
        if (Math.floor(this.typed) > before) G.audio.teletype();
      }
      // no auto-advance: the brief and map stay up until the pilot commits with ENTER
    }
  }

  // ---------- 2D overlay (called by HUD) ----------
  drawOverlay(c, w, h) {
    if (!this.active || this.active === 'zoom') return;
    const G = this.G;
    c.save();
    this._grid(c, w, h);   // lat/lon graticule + carrier silhouette, like the original map
    // bottom status bar like the original
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(0, h - 26, w, 26);
    c.font = 'bold 15px "Courier New", monospace';
    c.textAlign = 'center';
    c.fillStyle = '#ffe23a';
    if (this.active === 'mapselect') {
      c.fillText('SELECT YOUR FREE FLIGHT STARTING LOCATION     ·     ESC — BACK TO MENU', w / 2, h - 8);
      this._markers(c, w, h, FF_SPOTS.map(s => ({
        key: s.key, label: s.label,
        pos: s.id === 'carrier' ? G.world.carrier?.pos : G.world.landmarks[s.id],
      })));
      this._ffLegend(c, w, h);
    } else if (this.active === 'planesel') {
      // carrier start? the land-based jets aren't even offered — no tailhook
      const tomcat = this.G.save && this.G.save.tomcat ? '3 ..... F-14 TOMCAT' : '3 ..... F-14 TOMCAT [DLC]';
      // the HUD canvas is 704 wide — one line never fitted five jets. a taller
      // panel with two aircraft rows, then time/weather + the ESC hint
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.fillRect(0, h - 86, w, 60);
      c.fillStyle = '#ffe23a';
      if (this.carrierStart) {
        c.fillText(`SELECT:  1 ..... F/A-18 HORNET     ${tomcat}`, w / 2, h - 44);
      } else {
        c.fillText('SELECT:  1 ..... F/A-18 HORNET     2 ..... F-16 FALCON', w / 2, h - 66);
        c.fillText(`4 ..... F-15 EAGLE     5 ..... A-10 WARTHOG     ${tomcat}`, w / 2, h - 44);
      }
      c.fillText(`T ..... TIME: ${(this.G.dayNightSel || 'day').toUpperCase()}     R ..... WX: ${(this.G.weatherSel || 'clear').toUpperCase()}     ·     ESC — BACK`, w / 2, h - 20);
      if (this.carrierStart) {
        c.font = `bold 13px "Courier New", monospace`;
        c.fillStyle = '#9ab';
        c.fillText('USAF JETS UNAVAILABLE — NO TAILHOOK FOR CARRIER OPS', w / 2, h - 102);
        c.font = 'bold 15px "Courier New", monospace';
        c.fillStyle = '#ffe23a';
      }
      // F-16 rejection flash (no tailhook — can't work the boat)
      if (this.blockMsg && G.time - (this.blockT || 0) < 2.5) {
        c.font = `bold ${15 * s}px "Courier New", monospace`;
        c.fillStyle = '#ff4040';
        c.fillText(this.blockMsg, w / 2, h - 104 * s);
        c.fillStyle = '#7dff6a';
      }
    } else if (this.active === 'briefing') {
      c.fillText('PRESS ENTER TO SCRAMBLE     ·     ESC — BACK TO MENU', w / 2, h - 8);
      this._briefText(c, w, h);
    }
    c.restore();
  }
  // light-gray graticule over land and sea + the Enterprise marked in the water
  _grid(c, w, h) {
    const G = this.G, cam = G.camera;
    const p = { x: 0, y: 0 };
    const proj = (x, z) => {
      _v.set(x, 0, z).project(cam);
      if (_v.z > 1) return false;
      p.x = (_v.x * 0.5 + 0.5) * w; p.y = (-_v.y * 0.5 + 0.5) * h;
      return true;
    };
    c.strokeStyle = 'rgba(215,215,215,0.55)';
    c.lineWidth = 2;
    c.font = 'bold 15px "Courier New", monospace';
    c.fillStyle = 'rgba(235,235,235,0.9)';
    c.textAlign = 'center';
    // meridians — lon 122 passes through the Golden Gate, like the original map
    for (const [wx, label] of [[0, '122'], [88000, '121'], [-88000, '123']]) {
      let x0, y0;
      if (!proj(wx, -110000)) continue; x0 = p.x; y0 = p.y;
      if (!proj(wx, 120000)) continue;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(p.x, p.y); c.stroke();
      if (label) c.fillText(label, p.x + 12, h - 34);
    }
    // parallels — lat 38 cuts through the north bay, like the original map
    for (const [wz, label] of [[-20000, '38'], [91000, '37']]) {
      let x0, y0;
      if (!proj(-90000, wz)) continue; x0 = p.x; y0 = p.y;
      if (!proj(130000, wz)) continue;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(p.x, p.y); c.stroke();
      if (label) { c.textAlign = 'left'; c.fillText(label, 10, y0 - 8); c.textAlign = 'center'; }
    }
    // bridges as crisp map strokes — 1 red (Golden Gate) + 2 gray, like the original
    const stroke = (ax, az, bx, bz, col) => {
      let x0, y0;
      if (!proj(ax, az)) return; x0 = p.x; y0 = p.y;
      if (!proj(bx, bz)) return;
      c.strokeStyle = col; c.lineWidth = 3;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(p.x, p.y); c.stroke();
    };
    stroke(0, -1750, 0, 1750, '#a02020');                    // Golden Gate (red)
    stroke(9800, 6000, 28000, 8800, '#b8bcc0');              // Bay Bridge (gray)
    stroke(16800, 24000, 29600, 24200, '#b8bcc0');           // San Mateo (gray)
    // the carrier, clearly marked as a dark silhouette in the water
    const car = G.world.carrier;
    if (car && car.group.visible && proj(car.pos.x, car.pos.z)) {
      const cx = p.x, cy = p.y;
      if (proj(car.pos.x + Math.sin(car.heading) * 800, car.pos.z - Math.cos(car.heading) * 800)) {
        const ang = Math.atan2(p.y - cy, p.x - cx);
        c.save(); c.translate(cx, cy); c.rotate(ang);
        c.fillStyle = '#14181c';
        c.beginPath();   // little hull with a pointed bow
        c.moveTo(15, 0); c.lineTo(8, -4); c.lineTo(-13, -4); c.lineTo(-13, 4); c.lineTo(8, 4);
        c.closePath(); c.fill();
        c.fillRect(-2, -7, 4, 4);   // island bump
        c.restore();
      }
    }
  }
  _markers(c, w, h, marks) {
    const G = this.G;
    for (const m of marks) {
      if (!m.pos) continue;
      _v.copy(m.pos).project(G.camera);
      if (_v.z > 1) continue;
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      c.fillStyle = '#ffe23a';
      c.beginPath(); c.arc(x, y, 13, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#141414';
      c.font = 'bold 15px "Courier New", monospace';
      c.fillText(m.key, x, y + 5);
      // the field's name rides beside its number, flipping side near the edge
      if (m.label) {
        const right = x < w - 180;
        c.fillStyle = '#ffe23a';
        c.font = 'bold 11px "Courier New", monospace';
        c.textAlign = right ? 'left' : 'right';
        c.fillText(m.label, x + (right ? 18 : -18), y + 4);
        c.textAlign = 'center';
      }
    }
  }

  // the free-flight chart's legend: every start point, titled and briefed
  _ffLegend(c, w, h) {
    const pad = 9, lw = 352;
    c.font = 'bold 10px "Courier New", monospace';
    const wrap = (t, max) => {
      const words = t.split(' '), lines = [];
      let cur = '';
      for (const word of words) {
        const s = cur ? cur + ' ' + word : word;
        if (c.measureText(s).width <= max) cur = s;
        else { lines.push(cur); cur = word; }
      }
      lines.push(cur);
      return lines;
    };
    const entries = FF_SPOTS.map(s => ({ s, lines: wrap(s.desc, lw - pad * 2 - 16) }));
    const lh = 13, th = 17, gap = 7;
    const ph = pad + entries.reduce((n, e) => n + th + e.lines.length * lh + gap, 0);
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(8, 8, lw, ph);
    c.strokeStyle = 'rgba(215,215,215,0.35)';
    c.lineWidth = 1;
    c.strokeRect(8.5, 8.5, lw - 1, ph - 1);
    c.textAlign = 'left';
    let y = 8 + pad + 9;
    for (const e of entries) {
      c.font = 'bold 12px "Courier New", monospace';
      c.fillStyle = '#ffe23a';
      c.fillText(`${e.s.key} · ${e.s.label}`, 8 + pad, y);
      y += th;
      c.font = 'bold 10px "Courier New", monospace';
      c.fillStyle = '#aebcd4';
      for (const line of e.lines) { c.fillText(line, 8 + pad + 16, y); y += lh; }
      y += gap;
    }
    c.textAlign = 'center';
  }
  _briefText(c, w, h) {
    const lines = (this.briefLines || []).join('\n').slice(0, Math.floor(this.typed)).split('\n');
    c.textAlign = 'left';
    c.font = 'bold 15px "Courier New", monospace';
    let y = 26;
    for (const ln of lines) {
      c.fillStyle = ln.startsWith('-') ? '#ffe23a' : '#7dff6a';
      c.fillText(ln, 24, y);
      y += 19;
    }
    if (Math.floor(this.t * 2.5) % 2 === 0) { c.fillStyle = '#7dff6a'; c.fillText('█', 24, y); }
    c.textAlign = 'center';
  }
}
