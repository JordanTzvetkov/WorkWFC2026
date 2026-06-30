# World Cup 2026 — Family Bracket Pool ⚽🏆

A self-updating mini-site showing our family's FIFA World Cup 2026 prediction pool as a
realistic knockout bracket: full tree (Round of 32 → Final), team flags, the family member
who "owns" each team, and a spicy bilingual (English + Bulgarian) "who knocked out who"
headline that refreshes automatically as matches finish.

- **Static site** (GitHub Pages) — the browser fetches JSON and renders. A data update can
  never break the layout.
- **Scheduled GitHub Action** checks which matches have passed `kickoff + 3h`, fetches their
  results via a single Anthropic web-search call, writes JSON, and commits. Pages redeploys.

---

## How it works

```
index.html / styles.css / app.js   → the bracket UI (fetches JSON, draws the tree)
data/fixtures.json                  → bracket structure: matches, owners, flags, kickoffs, wiring
data/results.json                   → scores + winners (written by the updater)
data/headline.json                  → { current:{en,bg,generated_at,covers}, history:[...] }
data/people.json                    → owner → photo filename + fallback colour
assets/people/                      → owner photos (you supply; initials fallback until then)
scripts/update.mjs                  → the scheduled updater (Node 20, zero deps)
.github/workflows/update.yml        → cron (every 30 min) + manual trigger
```

The **bracket is fixed** (no redraws). Round-of-32 cells carry seeded teams + owners; later
rounds carry `source_home` / `source_away` pointers and resolve their participants from
`results.json` at render time. That's why a result can never produce a broken bracket.

### The updater (`scripts/update.mjs`)
1. Stops if the tournament is over (past the final + 2 days).
2. Finds **due** matches: `now >= kickoff_utc + 3h`, not already final, participants known.
3. **No due matches → no API call** (a quiet day costs nothing).
4. Makes **one** Anthropic Messages API call (model `claude-sonnet-4-6`) with the
   `web_search` tool, asking for the final scores **and** a bilingual headline as a single
   JSON block.
5. Parses safely (last ```json block). If parsing fails or a score is missing, it **skips**
   that match and writes nothing — never a garbage commit.
6. Merges scores into `results.json`, rotates the headline (`current` → `history`, cap 20),
   and writes the files. The workflow does the `git commit`.

All time math is UTC. Re-running with no newly-finished matches changes nothing.

---

## Manual setup (the human does these)

1. **Create a public GitHub repo** and push this scaffold (commands below).
2. **Add the API secret:** repo → *Settings → Secrets and variables → Actions →
   New repository secret* → name `ANTHROPIC_API_KEY`, value = your Anthropic key.
3. **Enable Pages:** repo → *Settings → Pages → Source: Deploy from a branch* →
   branch `main`, folder `/ (root)` → Save.
4. **Add the 12 photos** to `assets/people/` (square ~400×400, JPG/PNG/WebP, < 250 KB),
   filenames exactly per `data/people.json` (`aleks.jpg`, `deyan.jpg`, …). Commit + push.
   Until a photo exists, that owner shows a coloured initials avatar — the site already
   looks complete with zero photos.
5. **Run the workflow once:** repo → *Actions → "Update bracket" → Run workflow* to confirm
   end-to-end. (It's a no-op unless a match is `kickoff + 3h` past.)
6. **Visit** `https://<your-user>.github.io/<repo>/`.

> Scheduled workflows are disabled by GitHub after 60 days of repo inactivity — irrelevant
> for a ~3-week tournament that commits regularly.

---

## Editing the data

- **Results** are normally written by the bot. To fix one by hand, edit `data/results.json`:
  ```json
  "R32-6": { "home": 2, "away": 1, "winner": "home", "pens": null, "final": true }
  ```
  `winner` is `"home"` or `"away"`. `pens` is `null` unless decided on penalties
  (e.g. `"pens": { "home": 3, "away": 4 }`).
- **Later-round kickoff times** are `null` until FIFA confirms them. When a Round-of-16 (or
  later) kickoff is announced, set its `kickoff_utc` (UTC, e.g. `"2026-07-04T20:00:00Z"`) in
  `data/fixtures.json` — the updater will then pick that match up automatically.
- **Owners / teams are fixed.** Don't change `fixtures.json` team↔owner assignments mid-pool.

---

## Run locally

No build step — it's plain static files.

```bash
# serve the folder (any static server works); relative paths need a server, not file://
npx serve .          # then open the printed http://localhost:... URL
# or: python -m http.server 8000   → http://localhost:8000
```

Test the updater locally (needs the key; it's a no-op unless something is due):

```bash
ANTHROPIC_API_KEY=sk-ant-... node scripts/update.mjs
```

---

## Fallback if LLM score-fetching is flaky

The data layer is isolated, so you can swap the score source in `update.mjs` for a
structured football API (API-Football, football-data.org, TheSportsDB — verify WC2026
coverage, add its key as another secret) and keep the headline step as a separate Anthropic
call. Nothing else changes.
