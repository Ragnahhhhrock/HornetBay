# Hornet Bay — Project Brief

> Single source of truth for continuing work on Hornet Bay. Paste this into a
> Kimi Project's instructions, or keep it as `AGENTS.md` in the repo root —
> any new session that reads this can pick up the project cold.

## What this is

**Hornet Bay** — a recreation of the 1988 Amiga *F/A-18 Interceptor* in Three.js,
running as a plain static site (no build step, ES modules straight to the browser).

- Live: https://hornetbay.com (also https://ragnahhhhrock.github.io/HornetBay)
- Repo: `github.com/Ragnahhhhrock/HornetBay` (branch `main`)
- Content: the sim itself, 8 flight-school sorties + 19 campaign missions,
  free flight, 150+ entry dev journal at `/blog/`, print-bay model pages, social pages.

## Standing rules (verbatim — always apply)

1. "whenever i refer to 'anthem' i am referring to Hornet Bay Anthem.mp3. This is the official audio soundtrack of Hornet Bay."
2. "Build for computers only. do not attempt to optimise for mobile unless instructed to do so."
3. RTB rule: "missions are only considered succesfully completed with a return to base. this is the point of origin of the mission. it is possible to land at other airfields or the carrier and be re-armed and refuelled but you must return to the point of origin for succesful mission completion"

## File layout

- `/mnt/agents/work/fa18/` — **master copy**. All edits happen here.
- `/mnt/agents/work/hb-deploy/` — git clone used for pushing (SSH deploy key).
- `/mnt/agents/output/hornet-bay/` + `/mnt/agents/output/app/` — mirrors (app = previewed/versioned copy).
- `/mnt/agents/output/hornet-bay-site.zip` — downloadable site archive.
- `/mnt/agents/output/Hornet Bay (standalone).html` — single-file build (all JS+SFX inlined).
- `/mnt/agents/work/tools/` — persistent tooling (espeak source zip + `build-espeak.sh`).
- `/mnt/agents/output/hornet-bay-ga-report.py` — GA4 puller the user runs locally on Windows.
- Sandbox `/tmp` is **wiped between turns** — never store anything reusable there; `/mnt/agents` persists. The `/mnt/agents` mount has no exec bits/symlinks: run scripts via interpreters, build native tools in `/tmp`.

## Deploy pipeline (every site change, in order)

1. Edit in `/mnt/agents/work/fa18/`.
2. Push:
   ```sh
   cd /mnt/agents/work/hb-deploy
   GIT_SSH_COMMAND="ssh -i /mnt/agents/work/.ssh/fa18_deploy -o StrictHostKeyChecking=no" git fetch origin -q
   GIT_SSH_COMMAND="ssh -i /mnt/agents/work/.ssh/fa18_deploy -o StrictHostKeyChecking=no" git checkout -B main origin/main -q
   rsync -a --delete --exclude '.git' --exclude 'media' --exclude '.social-state.json' /mnt/agents/work/fa18/ .
   git add -A
   git -c user.name="Hornet Bay Dev" -c user.email=maverick@hornetbay.com commit -q -m "…"
   GIT_SSH_COMMAND="ssh -i /mnt/agents/work/.ssh/fa18_deploy -o StrictHostKeyChecking=no" git push origin main -q
   ```
   - `GIT_SSH_COMMAND` on **every** git command that touches the remote.
   - `index.lock` stuck → `rm -f .git/index.lock`.
   - Never rebase on this mount. Avoid `git status` (Bus error) — use `git log`, `git diff --stat`.
3. Journal entry for feature/fix work (see §Journal), then push again if the journal changed files.
4. Mirrors: `rsync -a --delete --exclude '.git' /mnt/agents/work/fa18/ /mnt/agents/output/hornet-bay/` (same for `app/`). Long rsyncs can hit the ~120 s tool limit — chunk by subdir if needed; the FUSE mount occasionally drops ("Transport endpoint is not connected") and recovers — retry.
5. Rezip: `cd /mnt/agents/output && rm -f hornet-bay-site.zip && zip -qr hornet-bay-site.zip app -x 'app/node_modules/*'`
6. If SFX/JS changed: rebuild standalone — `python3 /mnt/agents/work/build_standalone.py` (globs `sfx/*.wav` automatically).
7. `build_version` → type `html`, project_dir `/mnt/agents/output/app`, message ≤ 6 words. Never end a web turn without it.

## Journal (dev blog)

- Generator: `/mnt/agents/work/journal_add.py`. Article blocks are Python string vars:
  `NEW` = latest; on each new entry rotate the old `NEW` to the next `NEW_OLDnn`
  (**used through NEW_OLD60 — next rotation is NEW_OLD61**; 153 articles live).
- Paste the new `<article>` above the line `# paste a new <article> block here…`,
  stamp `<span class="hash">` with the feature commit hash, matching
  `<span class="hash">`, DTG-style date, tags, and a `/shots/<slug>.jpg` screenshot.
- Run `python3 journal_add.py` → regenerates `blog/index.html`, JSON-LD, RSS, and all
  slug pages. Slug pages are **directories**: `blog/<slug>/index.html`.
- **Social auto-post.** A push touching `blog/index.html` triggers
  `.github/workflows/social.yml` → `social/post_update.py`, which posts the newest
  entry (title, lede, link, shot) to the Hornet Bay Facebook page
  (facebook.com/hornetbayflightsim), X and Instagram — whichever secrets exist
  (`META_PAGE_ID` / `META_PAGE_TOKEN` / `META_IG_USER_ID`, `X_*`, `YT_*`).
  Dedup lives in `.social-state.json` **on origin/main** — the workflow commits it
  back with `[skip ci]`. That is why the deploy rsync EXCLUDES `.social-state.json`:
  fa18's copy must never clobber origin's (it did once, and the record had to be
  rebuilt by hand). After shipping a journal entry, check the Actions run went green
  and the slug landed in origin's state file. To post or re-post by hand: Actions →
  Social auto-post → Run workflow (empty inputs = latest entry). Caveat: the state
  mark counts an X-skip as success, so "marked" ≠ "Facebook posted" — when in doubt,
  verify on the page itself.
- After regenerating, sanity-check the Facebook vanity URL survived
  (`hornetbayflightsim`, never the old `people/Hornet-Bay/61592…` numeric URL).

## Playtest harness

- `import sys; sys.path.insert(0,'/mnt/agents/work'); import pt; pt.new()` — static
  server on :8931 + headless Chromium; `pt.launch('<mission|free>')` opens
  `?auto=<id>`; `pt.ev(expr)` evaluates JS in-page; `pt.press('Enter')`;
  `pt.shot('name')` → `/mnt/agents/work/ptlog/<name>.jpg`.
- **Headless rAF runs ~4 fps** with dt clamped 0.05 → real-time scripted flights are
  unreliable. Use the deterministic boot warp instead:
  `?auto=<id>&script=<takeoff|trap|land|bridge|intercept|acro>&t=NN&wlog=1` runs NN
  seconds at 60 Hz synchronously; `window.__wlog` (capped 4000) holds per-step telemetry
  `[t, tag, x, y, z, og, spd, pitch, roll, vy, fx, fy, fz]`.

## Game internals gotchas

- Save key in localStorage: **`hornet-bay-v1`** (not `hb-save`).
- **`G.mission !== G.missionDef`** — the live mission is a clone; probe `G.mission`.
- RTB watcher requires `onGround.speedRel === 0` (main.js ~2032).
- Flight sign conventions: fwd=(0,0,1)→quat so +X = LEFT wing;
  `bankNow = atan2(−right.y, upY)` >0 = LEFT bank; positive rollRate = RIGHT bank;
  ArrowRight → roll += 1. Controller: `rollTo = (desBank + bankNow)*1.6 − rollRate*0.5`.
- Stall 95 m/s (F-18); banked-lift model in flight.js:280.
- Wingman (`js/wingman.js`, callsign VIPER TWO) launch gate: PREFLIGHT, flying,
  !onGround, y>30; spawn floored at `groundHeight+220 / 180` (he drowned before this).
- Weapon ring: F-14 `['aim54','aim7','aim9','gun']`, others `['aim120','aim9','gun']`,
  `mk83` appended when a strike mission loads bombs. ENTER cycles (Amiga spec), SPACE fires.

## Audio & voice pipeline

- SFX in `sfx/*.wav`; engine loops + gatling captured from the Amiga original.
- Spoken stores callouts (`voice_gun/sidewinder/amraam/phoenix/sparrow/mk83.wav`) are
  **all one voice by construction**: espeak 1.48 `en+m2 -s 120 -p 50`, then
  RMS-normalized to ~3000 (peak cap 32000), 22050 Hz mono 16-bit.
  Rebuild espeak: `sh /mnt/agents/work/tools/build-espeak.sh` (builds into /tmp),
  `ESPEAK_DATA_PATH=/tmp/espeak-1.48.04-source`. Do NOT re-voice individual files —
  regenerate the whole set from one recipe or consistency breaks (this bit us once).
- `audio.js weaponSelect(w)` maps weapon→sample; the 1988 console beep is the fallback.
- Radio chatter is text-only by decision ("radio goes silent" entry) — no squelch/TTS.

## Analytics (GA4)

- Measurement ID `G-8MPYL6WTM4` (fires only on live domains). Property **546642000**.
- Sandbox has **no Google egress** — the user runs `hornet-bay-ga-report.py` locally
  (Windows, stdlib + `cryptography`, service-account JSON key) and pastes output.
- Custom definitions to register in GA4 Admin → Data display: dims `mission_id`,
  `plane_type`, `start_point`, `missile_type`; metrics `seconds`, `rounds`, `hits`.
- Funnel events shipped in `js/stats.js`: `mission_complete`, `mission_failed`,
  `player_death` (plus `mission_flown`, weapon fire/hit/kill events).
- 28-day baseline: 228 users, 365 sessions, 42% engaged, 7.7 min avg, ~14% fly a
  mission, retention ≈ 0. Open strategic problem = **retention/replayability**.
- Design decision on record: free flight stays #2, FLIGHT SCHOOL stays top of menu;
  revisit only with funnel data (see "stores/menu career tags" entries).

## Social

- Facebook: https://www.facebook.com/hornetbayflightsim/ (vanity — all site links
  updated; never reintroduce the old numeric `people/Hornet-Bay/…` URL)
- X: https://x.com/hornetbay · Instagram: `@hornet_bay` · YouTube: `@hornetbay`
- Social automation lives in `.github/workflows/social.yml` + `.social-state.json`.

## Credential hygiene

- Never print private key contents in chat, never commit keys, never copy them into
  `fa18/` or the output mirrors. The GA service-account key was rotated once after a
  paste incident (old key id deleted). SSH deploy key stays at
  `/mnt/agents/work/.ssh/fa18_deploy` and is referenced, never copied.

## Current state / open threads

- Voice set re-cut to a single speaker (commit `59c8f35`, version `9a389d2`).
- Facebook vanity URL deployed (commit `7bd4ad3`).
- Waiting on user: re-run GA report ~24 h after custom definitions registered → then
  produce the per-mission completion-funnel analysis and difficulty recommendations.
- Open question parked: whether FREE FLIGHT should outrank FLIGHT SCHOOL in the menu
  (current answer: no — let the funnel instrumentation cook first).
