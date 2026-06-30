# World Cup 2026 Family Bracket — Build Plan

A self-updating mini-site that shows our family's World Cup 2026 prediction pool as a
realistic bracket: full knockout tree, team flags, a photo of the family member who "owns"
each team, and a spicy bilingual (English + Bulgarian) "who knocked out who" headline that
refreshes automatically as matches finish.

This file is the source of truth for the build. Follow it exactly; where it says CONFIRM,
verify against an official source during the build.

---

## 1. Architecture overview

- **Static site** hosted on **GitHub Pages** (deploy from `main` branch, root).
- **Data lives in JSON**, presentation is fixed. The browser fetches JSON and renders.
  This means a data update can never produce a broken layout.
- **A GitHub Action runs on a schedule.** It checks which matches have passed
  `kickoff + 3 hours`, fetches their results, regenerates the headline, writes JSON,
  and commits. Pages redeploys on commit.
- **Scores + headline come from one Anthropic API call** (Messages API with the
  server-side `web_search` tool). One request returns both the final scores for the
  due matches and the spicy EN/BG headline as structured JSON. Single dependency:
  an `ANTHROPIC_API_KEY` repo secret. (Fallback option in §8.)

Why this shape: round-of-16-onward kickoff times are not announced yet and the bracket
is fixed (no redraws). Storing structure separately from results lets the tree resolve
itself as winners come in, and a polling schedule self-heals if a run is missed.

---

## 2. Repository structure

```
worldcup-bracket-pool/
├── index.html                  # shell; loads styles.css + app.js
├── styles.css
├── app.js                      # fetches JSON, renders bracket + headline
├── data/
│   ├── fixtures.json           # bracket structure (matches, owners, flags, kickoff, wiring)
│   ├── results.json            # scores + winners (written by the updater)
│   ├── headline.json           # {current:{en,bg,generated_at}, history:[...]}
│   └── people.json             # name -> photo filename + fallback colour
├── assets/
│   └── people/                 # aleks.jpg, deyan.jpg, ... (user supplies)
├── scripts/
│   └── update.mjs              # the scheduled updater (Node 20, zero deps)
├── .github/
│   └── workflows/
│       └── update.yml          # cron + manual trigger
├── package.json                # { "type": "module" } minimal
└── README.md                   # setup + how-to
```

**Use relative paths everywhere** (`./data/...`, `./assets/...`) — the site lives under
`https://<user>.github.io/<repo>/`, so absolute `/` paths will 404.

---

## 3. Data schemas

### 3.1 `data/people.json`
Maps each person to a photo and a fallback colour (used for an initials avatar when the
photo is missing).

```json
{
  "Aleks":   { "img": "aleks.jpg",   "color": "#C0392B" },
  "Deyan":   { "img": "deyan.jpg",   "color": "#2980B9" },
  "Jayna":   { "img": "jayna.jpg",   "color": "#8E44AD" },
  "Ash":     { "img": "ash.jpg",     "color": "#16A085" },
  "Henna":   { "img": "henna.jpg",   "color": "#D35400" },
  "Jordan":  { "img": "jordan.jpg",  "color": "#27AE60" },
  "Miro":    { "img": "miro.jpg",    "color": "#2C3E50" },
  "Petya":   { "img": "petya.jpg",   "color": "#C0399B" },
  "Prem":    { "img": "prem.jpg",    "color": "#E67E22" },
  "Nila":    { "img": "nila.jpg",    "color": "#1ABC9C" },
  "Grandma": { "img": "grandma.jpg", "color": "#A93226" },
  "Grandad": { "img": "grandad.jpg", "color": "#1F618D" }
}
```

### 3.2 `data/fixtures.json`
The bracket structure. **Round of 32 cells carry the seeded teams + owners.**
**Later rounds carry source-match pointers**, and the participants/owners are resolved
at render time from `results.json` (do NOT mutate fixtures when a result comes in).

Per-match shape:
```json
// Round of 32 (teams known up front)
{
  "id": "R32-1",
  "round": "R32",
  "kickoff_utc": "2026-06-28T19:00:00Z",
  "venue": "Inglewood",
  "home": { "team": "Canada",       "code": "ca", "owner": "Aleks" },
  "away": { "team": "South Africa",  "code": "za", "owner": "Henna" },
  "feeds_into": "R16-1"
}

// Round of 16 onward (participants resolved from winners)
{
  "id": "R16-1",
  "round": "R16",
  "kickoff_utc": null,
  "venue": "CONFIRM",
  "source_home": "R32-?",
  "source_away": "R32-?",
  "feeds_into": "QF-1"
}
```

**The 16 Round-of-32 matches** (official bracket order, with owners and flag codes). Kickoff
times are derived from ET broadcast listings → UTC; CONFIRM the two marked, and sanity-check
the rest:

| id | Home (owner) | Away (owner) | kickoff_utc | venue |
|----|--------------|--------------|-------------|-------|
| R32-1  | Canada `ca` (Aleks)        | South Africa `za` (Henna)        | 2026-06-28T19:00:00Z | Inglewood |
| R32-2  | Brazil `br` (Jordan)       | Japan `jp` (Miro)                | 2026-06-29T17:00:00Z | Houston |
| R32-3  | Germany `de` (Prem)        | Paraguay `py` (Grandad)          | 2026-06-29T20:30:00Z | Foxborough |
| R32-4  | Netherlands `nl` (Nila)    | Morocco `ma` (Aleks)             | 2026-06-30T01:00:00Z | Monterrey |
| R32-5  | Ivory Coast `ci` (Ash)     | Norway `no` (Miro)               | 2026-06-30T17:00:00Z | Arlington |
| R32-6  | France `fr` (Jayna)        | Sweden `se` (Deyan)              | 2026-06-30T21:00:00Z | East Rutherford |
| R32-7  | Mexico `mx` (Grandad)      | Ecuador `ec` (Prem)              | 2026-07-01T01:00:00Z | Mexico City |
| R32-8  | England `gb-eng` (Grandad) | DR Congo `cd` (Prem)             | 2026-07-01T16:00:00Z | Atlanta |
| R32-9  | Belgium `be` (Ash)         | Senegal `sn` (Aleks)             | 2026-07-01T20:00:00Z | Seattle |
| R32-10 | USA `us` (Jordan)          | Bosnia & Herz. `ba` (Deyan)      | 2026-07-02T00:00:00Z | Santa Clara |
| R32-11 | Spain `es` (Petya)         | Austria `at` (Grandma)           | 2026-07-02T19:00:00Z | Inglewood |
| R32-12 | Switzerland `ch` (Nila)    | Algeria `dz` (Petya)             | CONFIRM              | Vancouver |
| R32-13 | Portugal `pt` (Henna)      | Croatia `hr` (Petya)             | 2026-07-02T23:00:00Z | Toronto |
| R32-14 | Australia `au` (Henna)     | Egypt `eg` (Jayna)               | CONFIRM              | Arlington |
| R32-15 | Argentina `ar` (Grandma)   | Cape Verde `cv` (Grandad)        | 2026-07-03T22:00:00Z | Miami Gardens |
| R32-16 | Colombia `co` (Deyan)      | Ghana `gh` (Nila)                | 2026-07-04T01:30:00Z | Kansas City |

**Bracket wiring (R16 → Final):** the bracket is fixed. Pull the **official** wiring during
the build and encode `source_home`/`source_away`/`feeds_into` for all R16, QF, SF, and Final
matches. Known anchors to validate against:
- R16: winner(R32-2) vs winner(R32-5)
- R16: winner(R32-7) vs winner(R32-8)
- R16: winner(R32-9) vs winner(R32-10)
- QF: [winner of R32-2/R32-5 bracket] vs [winner of R32-7/R32-8 bracket]

Note flag code specifics: **England = `gb-eng`** (flagcdn supports it), DR Congo = `cd`,
Cape Verde = `cv`, Bosnia & Herzegovina = `ba`.

### 3.3 `data/results.json`
Written by the updater. One entry per finished match:
```json
{
  "R32-1": { "home": 1, "away": 0, "winner": "home", "pens": null, "final": true },
  "R32-3": { "home": 1, "away": 1, "winner": "away", "pens": { "home": 3, "away": 4 }, "final": true }
}
```
`winner` is `"home"` or `"away"`. `pens` is `null` unless decided on penalties.
Seed it with the four results already known (R32-1 Canada 1–0; R32-2 Brazil 2–1;
R32-3 Germany 1–1, Paraguay 4–3 pens → winner away; R32-4 Netherlands 1–1, Morocco 3–2 pens
→ winner away).

### 3.4 `data/headline.json`
```json
{
  "current": {
    "en": "Aleks's Morocco sent the Dutch home on spot-kicks while Grandad's Paraguay buried Germany.",
    "bg": "Мароко на Алекс изпрати Нидерландия у дома след дузпи, а Парагвай на Дядо погреба Германия.",
    "generated_at": "2026-06-30T00:30:00Z",
    "covers": ["R32-3", "R32-4"]
  },
  "history": []
}
```
On each update, move the previous `current` into `history` (cap history at ~20).

---

## 4. The page (`index.html` / `styles.css` / `app.js`)

### 4.1 Rendering logic (`app.js`)
1. Fetch `people.json`, `fixtures.json`, `results.json`, `headline.json` in parallel.
2. Render the **headline banner** at the top: big EN line, BG line beneath it, plus a small
   "updated <relative time>" stamp from `generated_at`. Provide an EN/BG toggle as well.
3. Render the **bracket tree** (see 4.2). For each match:
   - Resolve participants: R32 → from fixtures; later rounds → `winner(source_home)` and
     `winner(source_away)` looked up via results (show a "TBD" placeholder until known).
   - Each team cell shows: **owner avatar** (circle, on top), then **flag + country**, then
     the **owner's name** in the accent colour beneath. Winner is highlighted; loser is
     dimmed/struck-through; not-yet-played is neutral.
   - Show score pills when the match is final (include pens, e.g. "1 (4)").
4. Render a small **standings strip**: per person, teams still alive vs eliminated
   (derive from results; a person's team is "out" if it lost any match).

### 4.2 Visual direction
Aim for a clean **broadcast-graphics** bracket, not stacked cards. Specifics:
- **Bracket tree with SVG/CSS connector lines** linking each round through to a champion
  plinth on the right (or center-out on very wide screens). R32 (16) → R16 (8) → QF (4) →
  SF (2) → Final (1).
- **Flags** via flagcdn: `https://flagcdn.com/w80/{code}.png` (and `w160` for retina via
  `srcset`). Render as small rounded rectangles with a subtle border.
- **Avatars**: circular, ~40–48px, from `assets/people/<img>`. If the image 404s, draw a
  coloured circle (people.json `color`) with the person's initials. Implement this fallback
  with an `onerror` handler so the site looks complete before photos are added.
- **Type**: pick a characterful condensed display face for team names (e.g. a Google Font
  such as Archivo, Oswald, or Saira Condensed via `<link>`) and a clean body face. Avoid the
  generic "cream + serif + terracotta" and "near-black + single acid accent" AI defaults —
  give it its own identity (a refined stadium/scoreboard feel with a restrained gold or
  electric accent is fine, executed crisply).
- **Responsive**: desktop = horizontal bracket with connectors (horizontal scroll allowed
  on the widest column). Mobile = rounds stacked vertically as collapsible sections; the
  headline banner stays pinned at the top. Keyboard focus visible; honour
  `prefers-reduced-motion`.

---

## 5. The updater (`scripts/update.mjs`)

Node 20, no dependencies (use built-in `fetch`). Pseudocode:

```js
// 0. Tournament guard: if now > FINAL_DATE + 2 days, exit 0 (stop pointless runs).
// 1. Load fixtures.json + results.json.
// 2. Compute "due" matches:
//      due = fixtures with a non-null kickoff_utc where
//            (now >= kickoff_utc + 3h) AND results[id]?.final !== true.
//    Only consider matches whose participants are known (R32 always; later rounds only
//    once both source winners exist).
// 3. If due is empty -> log "nothing due" and exit 0 (NO API call, no cost).
// 4. Build a plain-text list of the due matches: "R32-6: France (Jayna) vs Sweden (Deyan)".
// 5. ONE Anthropic API call (model e.g. "claude-sonnet-4-6"; CONFIRM current string) with
//    the web_search tool, asking it to:
//      - find each due match's final score + winner (+ pens if any), AND
//      - write a spicy, family-friendly headline summarising ONLY these results,
//        in English and Bulgarian,
//    returning a SINGLE json code block matching the contract in §6.
// 6. Parse the JSON (extract the last ```json block from the concatenated text blocks;
//    fail safe: if parsing fails or a score is missing, skip that match, log, exit 0 so the
//    workflow doesn't commit garbage).
// 7. Merge scores into results.json (set final:true, winner, pens).
// 8. Update headline.json: push old current -> history (cap 20), set new current with
//    generated_at = now and covers = [due ids that were resolved].
// 9. Optionally also refresh kickoff_utc for upcoming matches whose times are now announced.
// 10. Write files. (The workflow does the git commit, not this script.)
```

Robustness rules:
- Never write a result you can't verify — skip and log.
- Idempotent: re-running with no new finished matches changes nothing.
- All time math in UTC.

---

## 6. Anthropic API call contract

**Endpoint:** `POST https://api.anthropic.com/v1/messages`
**Headers:** `x-api-key: $ANTHROPIC_API_KEY`, `anthropic-version: 2023-06-01`, `content-type: application/json`
**Body (shape):**
```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 1500,
  "tools": [{ "type": "web_search_20250305", "name": "web_search" }],
  "messages": [{ "role": "user", "content": "<prompt below>" }]
}
```

**Prompt to send** (fill in the due-match list and today's date):
```
Today is {ISO date}. These FIFA World Cup 2026 knockout matches have just finished
(kickoff was at least 3 hours ago). Use web search to find each one's FINAL result.

{numbered list of due matches with their ids, teams, and each team's owner name}

For each match, determine the final score, whether it went to a penalty shootout
(and the shootout score), and which side won (home or away as labelled above).

Then write ONE punchy, playful, family-friendly headline that summarises ONLY these
results, naming the OWNERS (not just the countries) — e.g. frame it as one person's team
knocking out another person's team. Make it spicy and fun but kind. Then translate that
same headline into Bulgarian.

Respond with ONLY a single JSON code block, no other text:
```json
{
  "results": [
    { "id": "R32-6", "home": <int>, "away": <int>,
      "winner": "home"|"away", "pens": null | { "home": <int>, "away": <int> } }
  ],
  "headline": { "en": "<one or two sentences>", "bg": "<Bulgarian translation>" }
}
```
```

Parsing: the response `content` is an array of blocks (text + web_search tool blocks).
Concatenate the `type:"text"` blocks and extract the last fenced ```json block.

---

## 7. GitHub Actions workflow (`.github/workflows/update.yml`)

```yaml
name: Update bracket
on:
  schedule:
    - cron: "*/30 * * * *"     # every 30 min (UTC). The "3h after kickoff" rule lives in the script.
  workflow_dispatch: {}         # manual "Run workflow" button
permissions:
  contents: write
concurrency:
  group: bracket-update
  cancel-in-progress: false
jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: node scripts/update.mjs
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - name: Commit changes if any
        run: |
          git config user.name  "bracket-bot"
          git config user.email "bracket-bot@users.noreply.github.com"
          git add data/
          git diff --cached --quiet || git commit -m "chore: update results [skip ci]"
          git push
```

Notes:
- Triggers are **schedule + manual only** (NOT `push`), so the bot's own commits don't loop.
- Public repo → Actions minutes and Pages are free.
- GitHub disables scheduled workflows after 60 days of repo inactivity — irrelevant for a
  ~3-week tournament that commits regularly.
- Cron is best-effort and UTC; 30-min cadence means a result appears within ~30 min of the
  3h mark.

---

## 8. Fallback if LLM score-fetching proves flaky

Swap the data source in `update.mjs` for a structured football API (e.g. API-Football /
api-sports.io, football-data.org, or TheSportsDB) — verify it covers World Cup 2026 and add
its key as another secret. Keep the headline step as a separate Anthropic call. The rest of
the architecture is unchanged because the data layer is isolated.

---

## 9. Manual setup steps (the human does these)

1. Create a **public** GitHub repo and push the scaffold.
2. Repo → Settings → Secrets and variables → Actions → add `ANTHROPIC_API_KEY`.
3. Repo → Settings → Pages → Source: **Deploy from a branch** → `main` / **root**.
4. Add the 12 photos to `assets/people/` (square, ~400×400, JPG/PNG/WebP, <250 KB, filenames
   per `people.json`). Commit.
5. Actions → "Update bracket" → **Run workflow** once to confirm it works end-to-end.
6. Visit `https://<user>.github.io/<repo>/`.

---

## 10. v1 acceptance checklist

- [ ] Bracket renders as a connected tree R32 → Final with flags and owner avatars.
- [ ] The four known results show correctly (incl. the two penalty shootouts).
- [ ] Missing photos fall back to coloured initials (site looks complete with zero photos).
- [ ] Headline banner shows EN + BG with an "updated" stamp and a language toggle.
- [ ] `node scripts/update.mjs` run locally with the key: fetches due results, updates JSON,
      and is a no-op when nothing is due.
- [ ] Workflow commits only when data changed and never triggers itself.
- [ ] Everything uses relative paths and works under the Pages subpath on mobile + desktop.
