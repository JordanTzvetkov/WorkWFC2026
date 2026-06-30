#!/usr/bin/env node
/* World Cup 2026 bracket updater — Node 20, zero dependencies.
 *
 * Finds matches that finished (kickoff + 3h ago), asks Claude (one Messages API
 * call with the web_search tool) for the final scores plus a bilingual headline,
 * and writes data/results.json + data/headline.json. The GitHub workflow commits.
 *
 * Safe by design: never writes a score it can't parse, no-op when nothing is due
 * (and in that case makes NO API call, so a quiet tournament costs nothing).
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DATA = (name) => fileURLToPath(new URL(`../data/${name}`, import.meta.url));
const FIXTURES = DATA("fixtures.json");
const RESULTS = DATA("results.json");
const HEADLINE = DATA("headline.json");

const THREE_HOURS = 3 * 60 * 60 * 1000;
const FINAL_DATE = Date.UTC(2026, 6, 19); // 2026-07-19 (month is 0-indexed)
const STOP_AFTER = FINAL_DATE + 2 * 24 * 60 * 60 * 1000; // final + 2 days
const MODEL = "claude-sonnet-4-6";
const API_URL = "https://api.anthropic.com/v1/messages";

const now = Date.now();
const log = (...a) => console.log("[update]", ...a);

async function main() {
  // 0. Tournament guard.
  if (now > STOP_AFTER) {
    log("Tournament is over (past final + 2 days). Nothing to do.");
    return 0;
  }

  // 1. Load data.
  const fixtures = JSON.parse(await readFile(FIXTURES, "utf8"));
  const results = JSON.parse(await readFile(RESULTS, "utf8"));
  const byId = Object.fromEntries(fixtures.matches.map((m) => [m.id, m]));

  const getParticipants = (m) => {
    if (!m) return { home: null, away: null };
    if (m.round === "R32") return { home: m.home, away: m.away };
    return { home: winnerOf(m.source_home), away: winnerOf(m.source_away) };
  };
  function winnerOf(id) {
    const m = byId[id];
    const r = results[id];
    if (!m || !r || !r.final) return null;
    const p = getParticipants(m);
    return r.winner === "home" ? p.home : p.away;
  }
  const participantsKnown = (m) => {
    const p = getParticipants(m);
    return p.home && p.away;
  };

  // 2. Compute "due" matches.
  const due = fixtures.matches.filter((m) => {
    if (!m.kickoff_utc) return false;
    const kickoff = Date.parse(m.kickoff_utc);
    if (Number.isNaN(kickoff)) return false;
    if (now < kickoff + THREE_HOURS) return false;
    if (results[m.id] && results[m.id].final) return false;
    return participantsKnown(m);
  });

  // 3. Nothing due → no API call, no cost.
  if (due.length === 0) {
    log("Nothing due. No API call made.");
    return 0;
  }
  log(`Due matches (${due.length}): ${due.map((m) => m.id).join(", ")}`);

  // 4. Build the plain-text list of due matches.
  const describe = (m) => {
    const p = getParticipants(m);
    return `${m.id}: ${p.home.team} (${p.home.owner}) vs ${p.away.team} (${p.away.owner})`;
  };
  const dueList = due.map((m, i) => `${i + 1}. ${describe(m)}`).join("\n");
  const dueIds = new Set(due.map((m) => m.id));

  // 5. One Anthropic API call.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[update] ANTHROPIC_API_KEY is not set — cannot fetch results.");
    return 1;
  }

  const today = new Date(now).toISOString().slice(0, 10);
  const prompt = buildPrompt(today, dueList);

  let data;
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      console.error(`[update] API error ${res.status}: ${await res.text()}`);
      return 0; // fail safe — don't commit garbage
    }
    data = await res.json();
  } catch (err) {
    console.error("[update] Request failed:", err.message);
    return 0;
  }

  // 6. Parse the JSON (last fenced ```json block from concatenated text blocks).
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const parsed = extractJson(text);
  if (!parsed) {
    console.error("[update] Could not parse a JSON block from the response. Skipping.");
    return 0;
  }

  // 7. Merge verified scores into results.
  const resolved = [];
  for (const r of Array.isArray(parsed.results) ? parsed.results : []) {
    if (!r || !dueIds.has(r.id)) continue;
    if (!Number.isInteger(r.home) || !Number.isInteger(r.away)) {
      log(`Skipping ${r && r.id}: non-integer score.`);
      continue;
    }
    if (r.winner !== "home" && r.winner !== "away") {
      log(`Skipping ${r.id}: invalid winner.`);
      continue;
    }
    let pens = null;
    if (r.pens && Number.isInteger(r.pens.home) && Number.isInteger(r.pens.away)) {
      pens = { home: r.pens.home, away: r.pens.away };
    }
    results[r.id] = { home: r.home, away: r.away, winner: r.winner, pens, final: true };
    resolved.push(r.id);
  }

  if (resolved.length === 0) {
    log("No verifiable results returned. Nothing written.");
    return 0;
  }
  log(`Resolved: ${resolved.join(", ")}`);

  // 8. Update headline.json (move old current → history, cap 20).
  const headline = JSON.parse(await readFile(HEADLINE, "utf8"));
  if (parsed.headline && (parsed.headline.en || parsed.headline.bg)) {
    if (!Array.isArray(headline.history)) headline.history = [];
    if (headline.current) headline.history.unshift(headline.current);
    headline.history = headline.history.slice(0, 20);
    headline.current = {
      en: String(parsed.headline.en || ""),
      bg: String(parsed.headline.bg || ""),
      generated_at: new Date(now).toISOString(),
      covers: resolved,
    };
  }

  // 9. (Optional) Refresh kickoff_utc for later rounds — left to a manual edit of
  //    fixtures.json as FIFA confirms times; the architecture picks them up here.

  // 10. Write files. The workflow performs the git commit.
  await writeFile(RESULTS, JSON.stringify(results, null, 2) + "\n");
  await writeFile(HEADLINE, JSON.stringify(headline, null, 2) + "\n");
  log("Wrote results.json + headline.json.");
  return 0;
}

function buildPrompt(today, dueList) {
  return `Today is ${today}. These FIFA World Cup 2026 knockout matches have just finished (kickoff was at least 3 hours ago). Use web search to find each one's FINAL result.

${dueList}

For each match, determine the final score, whether it went to a penalty shootout (and the shootout score), and which side won (home or away as labelled above).

Then write ONE punchy, playful, family-friendly headline that summarises ONLY these results, naming the OWNERS (not just the countries) — e.g. frame it as one person's team knocking out another person's team. Make it spicy and fun but kind. Then translate that same headline into Bulgarian.

Respond with ONLY a single JSON code block, no other text:
\`\`\`json
{
  "results": [
    { "id": "R32-6", "home": 0, "away": 0, "winner": "home", "pens": null }
  ],
  "headline": { "en": "<one or two sentences>", "bg": "<Bulgarian translation>" }
}
\`\`\``;
}

function extractJson(text) {
  if (!text) return null;
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  const raw = matches.length
    ? matches[matches.length - 1][1]
    : (() => {
        const a = text.indexOf("{");
        const b = text.lastIndexOf("}");
        return a !== -1 && b > a ? text.slice(a, b + 1) : null;
      })();
  if (!raw) return null;
  try {
    return JSON.parse(raw.trim());
  } catch (err) {
    console.error("[update] JSON.parse failed:", err.message);
    return null;
  }
}

main()
  .then((code) => process.exit(code || 0))
  .catch((err) => {
    console.error("[update] Unexpected error:", err);
    process.exit(0); // never commit garbage on an unexpected throw
  });
