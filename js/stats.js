// stats.js — Hornet Bay player analytics.
// Two channels for every metric:
//   1. a persistent local counter store (localStorage 'hb-stats-v1') that the
//      /analytics dashboard reads and renders;
//   2. a GA4 event bridge — events fire only when window.gtag exists, which
//      index.html defines solely on the live domains, so dev copies never
//      pollute the property.
// Low-frequency events go to GA immediately; high-frequency streams (flight
// time, cannon rounds, gun hits) are batched and flushed every 60s of flight
// and at the end of every sortie.

const STATS_KEY = 'hb-stats-v1';

const blank = () => ({
  missions_flown: 0,                       // mission launches (free flight excluded)
  flight_seconds: 0,                       // wall-clock seconds spent in the air
  mig_kills: 0,                            // MiG-29s downed by the player
  plane_selects: { f18: 0, f16: 0 },       // Hornet / Falcon picks on the plane-select screen
  start_points: {},                        // free-flight map spot id -> count
  ejections: 0,
  missiles_fired: { aim9: 0, aim120: 0 },  // by type
  cannon_rounds: 0,                        // 20mm Vulcan rounds
  missile_hits: { aim9: 0, aim120: 0 },    // player missiles that connected, by type
  gun_hits: 0,
  missions_completed: 0,                   // sorties that made it home (RTB rule applied)
  missions_failed: 0,                      // objective blown / court martial / gave up
  deaths: 0,                               // pilots lost — crashes, not ejections
});

class Stats {
  constructor() {
    this.data = blank();
    try {
      const raw = JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
      // shallow-merge scalars, then deep-merge the nested counter objects so
      // a shape that grew between versions never loses old counts
      const d = this.data;
      for (const k of Object.keys(raw)) {
        if (raw[k] && typeof raw[k] === 'object' && d[k] && typeof d[k] === 'object') Object.assign(d[k], raw[k]);
        else d[k] = raw[k];
      }
    } catch (e) { /* corrupted store — start clean */ }
    this._gaFlight = 0;   // flight seconds not yet reported to GA
    this._gaCannon = 0;   // cannon rounds not yet reported to GA
    this._gaGunHits = 0;  // gun hits not yet reported to GA
  }

  persist() { try { localStorage.setItem(STATS_KEY, JSON.stringify(this.data)); } catch (e) {} }

  // fire a GA4 event when the live-domain snippet is present
  ga(name, params) {
    if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
  }

  // ---------------- discrete events (immediate GA) ----------------
  missionFlown(id) {
    this.data.missions_flown++; this.persist();
    this.ga('mission_flown', { mission_id: id });
  }
  missionComplete(id, score) {
    this.data.missions_completed++; this.persist();
    this.ga('mission_complete', { mission_id: id, score: score });
  }
  missionFailed(id) {
    this.data.missions_failed++; this.persist();
    this.ga('mission_failed', { mission_id: id });
  }
  playerDeath(cause, missionId) {
    this.data.deaths++; this.persist();
    this.ga('player_death', { cause: cause, mission_id: missionId });
  }
  planeSelect(type) {   // 'f18' | 'f16'
    if (!this.data.plane_selects[type]) this.data.plane_selects[type] = 0;
    this.data.plane_selects[type]++; this.persist();
    this.ga('plane_select', { plane_type: type === 'f18' ? 'hornet' : type === 'f14' ? 'tomcat' : 'falcon' });
  }
  startPoint(id) {
    this.data.start_points[id] = (this.data.start_points[id] || 0) + 1; this.persist();
    this.ga('start_point_select', { start_point: id });
  }
  ejection() {
    this.data.ejections++; this.persist();
    this.ga('ejection');
  }
  migKill() {
    this.data.mig_kills++; this.persist();
    this.ga('mig_kill');
  }
  missileFired(type) {   // 'aim9' | 'aim120'
    if (this.data.missiles_fired[type] === undefined) this.data.missiles_fired[type] = 0;
    this.data.missiles_fired[type]++; this.persist();
    this.ga('missile_fired', { missile_type: type });
  }
  missileHit(type) {
    if (this.data.missile_hits[type] === undefined) this.data.missile_hits[type] = 0;
    this.data.missile_hits[type]++; this.persist();
    this.ga('missile_hit', { missile_type: type });
  }

  // ---------------- high-frequency streams (batched GA) ----------------
  addFlight(seconds) {
    this.data.flight_seconds += seconds;
    this._gaFlight += seconds;
    if (this._gaFlight >= 60) this.flushGA();   // heartbeat roughly once a minute
    if ((this._persistT = (this._persistT || 0) + seconds) > 10) { this._persistT = 0; this.persist(); }
  }
  cannonRound() { this.data.cannon_rounds++; this._gaCannon++; this._batchPersist(); }
  gunHit() { this.data.gun_hits++; this._gaGunHits++; this._batchPersist(); }
  _batchPersist() {
    // tracers fly at 28 rounds/sec — don't hammer localStorage per round
    const n = (this._bp = (this._bp || 0) + 1);
    if (n >= 25) { this._bp = 0; this.persist(); }
  }

  // push everything still pending to GA — sortie end + flight heartbeat
  flushGA() {
    if (this._gaFlight >= 1) { this.ga('flight_time', { seconds: Math.round(this._gaFlight) }); this._gaFlight = 0; }
    if (this._gaCannon > 0) { this.ga('cannon_rounds_fired', { rounds: this._gaCannon }); this._gaCannon = 0; }
    if (this._gaGunHits > 0) { this.ga('gun_hits', { hits: this._gaGunHits }); this._gaGunHits = 0; }
    this.persist();
  }
}

export const stats = new Stats();
