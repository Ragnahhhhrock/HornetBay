// mapview.js — N toggles a live tactical map: bay landmass, airfields,
// bridges, the carrier, bandits, waypoint and the player's own position,
// drawn north-up like the original's map screen.
import { groundHeight } from './world.js';

// world extent shown (m): the Pacific carrier waters to the inland edge,
// the Golden Gate at the heart and the south bay at the bottom
const X0 = -68000, X1 = 47000, Z0 = -40000, Z1 = 64000;

export class MapView {
  constructor() {
    this.on = false;
    this.base = null;   // prerendered land/sea/runways backdrop
  }
  toggle() { this.on = !this.on; return this.on; }

  _buildBase(world) {
    const px = 220, py = Math.round(px * (Z1 - Z0) / (X1 - X0));
    const cv = document.createElement('canvas'); cv.width = px; cv.height = py;
    const g = cv.getContext('2d');
    g.fillStyle = '#0b2c52'; g.fillRect(0, 0, px, py);
    const img = g.getImageData(0, 0, px, py), d = img.data;
    for (let iy = 0; iy < py; iy++) {
      const z = Z0 + (iy + 0.5) / py * (Z1 - Z0);
      for (let ix = 0; ix < px; ix++) {
        const x = X0 + (ix + 0.5) / px * (X1 - X0);
        if (groundHeight(x, z) >= 0) {
          const o = (iy * px + ix) * 4;
          d[o] = 26; d[o + 1] = 84; d[o + 2] = 26; d[o + 3] = 255;
        }
      }
    }
    g.putImageData(img, 0, 0);
    const mx = (x) => (x - X0) / (X1 - X0) * px, my = (z) => (z - Z0) / (Z1 - Z0) * py;
    // bridges: Golden Gate red, the rest gray (like the original map)
    const seg = (ax, az, bx, bz, col) => {
      g.strokeStyle = col; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(mx(ax), my(az)); g.lineTo(mx(bx), my(bz)); g.stroke();
    };
    seg(0, -1750, 0, 1750, '#c03030');
    seg(9800, 6000, 28000, 8800, '#9aa0a6');
    seg(16800, 24000, 29600, 24200, '#9aa0a6');
    seg(16800, 30500, 29500, 30600, '#9aa0a6');
    // runways as heading-true white strokes + airport labels
    g.font = 'bold 9px "Courier New", monospace';
    g.textAlign = 'left';
    for (const r of world.runways) {
      const dx = Math.sin(r.hdg) * r.len / 2, dz = -Math.cos(r.hdg) * r.len / 2;
      g.strokeStyle = '#dfe3e6'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(mx(r.x - dx), my(r.z - dz)); g.lineTo(mx(r.x + dx), my(r.z + dz)); g.stroke();
    }
    g.fillStyle = '#ffe23a';
    g.fillText('SFO', mx(13600), my(20600));
    g.fillText('OAK', mx(27600), my(16600));
    g.fillText('MOF', mx(10600), my(34600));
    g.fillText('ALA', mx(21600), my(13100));
    g.fillText('SF', mx(8400), my(-600));
    this.base = cv;
  }

  _ship(c, x, y, hdg, col) {
    c.save(); c.translate(x, y); c.rotate(hdg);
    c.fillStyle = col;
    c.beginPath();   // little hull with a pointed bow, pointing up = north
    c.moveTo(0, -9); c.lineTo(-2.5, -4); c.lineTo(-2.5, 8); c.lineTo(2.5, 8); c.lineTo(2.5, -4);
    c.closePath(); c.fill();
    c.fillRect(1.5, 0, 2.5, 2.5);   // island bump (starboard = right when pointing up)
    c.restore();
  }

  draw(c, w, h, G) {
    if (!this.on) return;
    if (!this.base) this._buildBase(G.world);
    const dh = Math.floor(h * 0.46);
    const sc = dh / this.base.height, dw = this.base.width * sc;
    const bx = 12, by = 12;
    const mx = (x) => bx + (x - X0) / (X1 - X0) * dw;
    const my = (z) => by + (z - Z0) / (Z1 - Z0) * dh;

    c.save();
    c.globalAlpha = 0.88;
    c.drawImage(this.base, bx, by, dw, dh);
    c.globalAlpha = 1;
    c.strokeStyle = 'rgba(223,227,230,0.9)'; c.lineWidth = 2;
    c.strokeRect(bx, by, dw, dh);

    // carrier + enemy sub
    const car = G.world.carrier;
    if (car && car.group.visible) this._ship(c, mx(car.pos.x), my(car.pos.z), car.heading, '#f2f2f2');
    const sub = G.world.enemySub;
    if (sub && sub.group.visible) this._ship(c, mx(sub.pos.x), my(sub.pos.z), sub.heading, '#ff4a3a');
    // bandits as red dots
    c.fillStyle = '#ff4a3a';
    for (const b of G.bandits || []) {
      if (!b.alive || !b.pos) continue;
      c.beginPath(); c.arc(mx(b.pos.x), my(b.pos.z), 3, 0, Math.PI * 2); c.fill();
    }
    // waypoint as a green diamond
    if (G.waypoint) {
      const x = mx(G.waypoint.x), y = my(G.waypoint.z);
      c.strokeStyle = '#3aff72'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x + 6, y); c.lineTo(x, y + 6); c.lineTo(x - 6, y);
      c.closePath(); c.stroke();
    }
    // the player: blinking yellow arrow pointing along the heading
    const P = G.player;
    if (P && P.pos) {
      const hd = Math.atan2(P.fwd.x, -P.fwd.z);
      if (Math.floor(G.time * 3) % 2 === 0) {
        c.save(); c.translate(mx(P.pos.x), my(P.pos.z)); c.rotate(hd);
        c.fillStyle = '#ffe23a';
        c.beginPath(); c.moveTo(0, -8); c.lineTo(-5, 6); c.lineTo(0, 2.5); c.lineTo(5, 6);
        c.closePath(); c.fill();
        c.restore();
      }
    }
    c.fillStyle = '#ffe23a';
    c.font = 'bold 12px "Courier New", monospace';
    c.textAlign = 'left';
    c.fillText('MAP', bx + 6, by + 15);
    c.restore();
  }
}
