/* Family World Cup 2026 — bracket renderer.
 * Fetches JSON, resolves the knockout tree from results, draws connectors.
 * Presentation is fixed; a data update can never break the layout.
 */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  };

  const ROUND_SHORT = { R32: "R32", R16: "R16", QF: "QF", SF: "SF", FINAL: "Final" };

  const state = {
    people: {},
    fixtures: { matches: [], rounds: [] },
    results: {},
    headline: { current: null, history: [] },
    prizes: null,
    byId: {},
  };

  const ROUND_LABEL_FULL = {
    0: "Groups",
    1: "Round of 32",
    2: "Round of 16",
    3: "Quarter-final",
    4: "Semi-final",
    5: "Final",
    6: "Champions",
  };

  /* ---------------- data load ---------------- */
  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return res.json();
  }

  async function boot() {
    try {
      const [people, fixtures, results, headline] = await Promise.all([
        loadJSON("./data/people.json"),
        loadJSON("./data/fixtures.json"),
        loadJSON("./data/results.json"),
        loadJSON("./data/headline.json"),
      ]);
      state.people = people || {};
      state.fixtures = fixtures || { matches: [], rounds: [] };
      state.results = results || {};
      state.headline = headline || { current: null, history: [] };
      state.byId = {};
      for (const m of state.fixtures.matches) state.byId[m.id] = m;

      // Prize pot config is optional (work version only).
      try {
        state.prizes = await loadJSON("./data/prizes.json");
      } catch (e) {
        state.prizes = null;
      }

      renderHeadline();
      renderPot();
      renderStandings();
      renderBracket();
      scheduleConnectors();
    } catch (err) {
      console.error(err);
      const h = $("#headline-primary");
      if (h) h.textContent = "Couldn't load the bracket data — check the data/ files.";
    }
  }

  /* ---------------- bracket resolution ---------------- */
  function getParticipants(match) {
    if (!match) return { home: null, away: null };
    if (match.round === "R32") return { home: match.home, away: match.away };
    return {
      home: winnerOf(match.source_home),
      away: winnerOf(match.source_away),
    };
  }

  function winnerOf(id) {
    const m = state.byId[id];
    const r = state.results[id];
    if (!m || !r || !r.final) return null;
    const p = getParticipants(m);
    return r.winner === "home" ? p.home : p.away;
  }

  function loserTeam(match) {
    const r = state.results[match.id];
    if (!r || !r.final) return null;
    const p = getParticipants(match);
    return r.winner === "home" ? p.away : p.home;
  }

  /* ---------------- small builders ---------------- */
  function initials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function avatarEl(owner, extraCls) {
    const p = state.people[owner] || {};
    const node = el("div", "avatar" + (extraCls ? " " + extraCls : ""));
    if (p.color) node.style.setProperty("--owner", p.color);
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", owner || "Unknown");

    const showInitials = () => {
      node.classList.add("avatar--initials");
      node.textContent = initials(owner);
    };

    if (p.img) {
      // Real <img> in the DOM (decoded eagerly). If it 404s, fall back to
      // coloured initials. Must be in the DOM — a detached image never loads.
      const img = el("img", "avatar__img");
      img.alt = "";
      img.decoding = "async";
      img.addEventListener("error", () => {
        img.remove();
        showInitials();
      });
      node.appendChild(img);
      img.src = "./assets/people/" + p.img;
    } else {
      showInitials();
    }
    return node;
  }

  function flagEl(code, name, extraCls) {
    const img = el("img", "flag" + (extraCls ? " " + extraCls : ""));
    img.src = `https://flagcdn.com/w80/${code}.png`;
    img.srcset = `https://flagcdn.com/w80/${code}.png 1x, https://flagcdn.com/w160/${code}.png 2x`;
    img.width = 26;
    img.height = 18;
    img.loading = "lazy";
    img.alt = name ? name + " flag" : "";
    return img;
  }

  function sourceHint(match, side) {
    const srcId = match["source_" + side];
    const src = state.byId[srcId];
    if (src && src.round === "R32" && src.home && src.away) {
      return `Winner ${src.home.team} / ${src.away.team}`;
    }
    return srcId ? `Winner ${srcId}` : "TBD";
  }

  /* ---------------- match card ---------------- */
  function teamRow(team, side, match) {
    const result = state.results[match.id];
    const isFinal = !!(result && result.final);
    const row = el("div", "team-row");

    if (!team) {
      row.classList.add("is-tbd");
      const av = el("div", "avatar");
      av.textContent = "?";
      av.setAttribute("aria-hidden", "true");
      const fl = el("div", "flag flag--tbd");
      fl.textContent = "?";
      const info = el("div", "team-row__info");
      const c = el("div", "team-row__country");
      c.textContent = "TBD";
      c.style.color = "var(--muted-2)";
      const o = el("div", "team-row__owner");
      o.textContent = sourceHint(match, side);
      o.style.color = "var(--muted-2)";
      info.append(c, o);
      row.append(av, fl, info, el("div", "score"));
      return row;
    }

    const p = state.people[team.owner] || {};
    row.style.setProperty("--owner", p.color || "var(--muted)");

    if (isFinal) row.classList.add(result.winner === side ? "is-winner" : "is-loser");

    const info = el("div", "team-row__info");
    const country = el("div", "team-row__country");
    country.textContent = team.team;
    const owner = el("div", "team-row__owner");
    owner.textContent = team.owner;
    info.append(country, owner);

    const score = el("div", "score");
    if (isFinal) {
      score.textContent = String(result[side]);
      if (result.pens) {
        const pens = el("span", "score__pens");
        pens.textContent = ` (${result.pens[side]})`;
        score.appendChild(pens);
      }
    }

    row.append(avatarEl(team.owner), flagEl(team.code, team.team), info, score);
    return row;
  }

  function renderMatch(match) {
    const tpl = $("#match-template").content.firstElementChild.cloneNode(true);
    tpl.dataset.id = match.id;
    tpl.setAttribute("aria-label", roundLabel(match.round) + " match");

    const result = state.results[match.id];
    const isFinal = !!(result && result.final);
    if (isFinal) tpl.classList.add("is-final");

    tpl.querySelector(".match__round").textContent = ROUND_SHORT[match.round] || match.round;
    const venue = tpl.querySelector(".match__venue");
    venue.innerHTML = "";
    if (match.venue && match.venue !== "CONFIRM") {
      const s = el("span");
      s.textContent = match.venue;
      venue.append("📍", s);
    }

    const parts = getParticipants(match);
    const teams = tpl.querySelector(".match__teams");
    teams.append(teamRow(parts.home, "home", match), teamRow(parts.away, "away", match));

    const foot = tpl.querySelector(".match__foot");
    foot.innerHTML = "";
    if (isFinal) {
      const ft = el("span", "pill pill--final");
      ft.textContent = "Full time";
      foot.appendChild(ft);
      if (result.pens) {
        const pen = el("span", "pill pill--pens");
        pen.textContent = "On penalties";
        foot.appendChild(document.createTextNode(" "));
        foot.appendChild(pen);
      }
    } else if (match.kickoff_utc) {
      const k = el("span", "pill");
      k.textContent = formatKickoff(match.kickoff_utc);
      foot.appendChild(k);
    } else if (parts.home && parts.away) {
      foot.textContent = "Kick-off time TBC";
    } else {
      foot.textContent = "Awaiting teams";
    }
    return tpl;
  }

  /* ---------------- bracket render ---------------- */
  function roundLabel(key) {
    const r = (state.fixtures.rounds || []).find((x) => x.key === key);
    return r ? r.label : key;
  }

  const isMobile = () => window.matchMedia("(max-width: 900px)").matches;

  // Walk the tree from a root match down to its R32 leaves, one array per round
  // (root first). SF-1 -> [[SF-1],[QF-1,QF-2],[R16-1..4],[8 x R32]]. Because each
  // node expands to [source_home, source_away] in order, the deepest array is the
  // clean top-to-bottom R32 order, so feeders of an R16 always sit adjacent.
  function levelsFromRoot(rootId) {
    const levels = [];
    let cur = [rootId];
    while (cur.length) {
      levels.push(cur.slice());
      const first = state.byId[cur[0]];
      if (!first || first.round === "R32") break;
      const next = [];
      for (const id of cur) {
        const m = state.byId[id];
        if (m.source_home) next.push(m.source_home);
        if (m.source_away) next.push(m.source_away);
      }
      cur = next;
    }
    return levels;
  }

  function renderColumn(ids) {
    const first = state.byId[ids[0]];
    const col = el("div", "round round--" + first.round.toLowerCase());

    const title = el("button", "round__title");
    title.type = "button";
    title.setAttribute("aria-expanded", "true");
    const label = el("span");
    label.textContent = roundLabel(first.round);
    const count = el("span", "round__count");
    count.textContent = ids.length > 1 ? ids.length + " ties" : "";
    const chev = el("span", "round__chevron");
    chev.setAttribute("aria-hidden", "true");
    chev.textContent = "▾";
    const rightWrap = el("span");
    rightWrap.style.cssText = "display:inline-flex;align-items:center;gap:10px";
    rightWrap.append(count, chev);
    title.append(label, rightWrap);

    const list = el("div", "round__matches");
    for (const id of ids) list.appendChild(renderMatch(state.byId[id]));

    title.addEventListener("click", () => {
      if (!isMobile()) return;
      const collapsed = col.classList.toggle("is-collapsed");
      title.setAttribute("aria-expanded", String(!collapsed));
    });

    col.append(title, list);
    return col;
  }

  function renderBracket() {
    const bracket = $("#bracket");
    bracket.innerHTML = "";
    const finalMatch = state.fixtures.matches.find((m) => m.round === "FINAL");
    if (!finalMatch) return;

    if (isMobile()) {
      // Stacked, top-to-bottom: R32 (clean order) … Final, then champion.
      bracket.classList.remove("bracket--sided");
      const levels = levelsFromRoot(finalMatch.id); // [FINAL],[SF],[QF],[R16],[R32]
      for (let i = levels.length - 1; i >= 0; i--) bracket.appendChild(renderColumn(levels[i]));
      bracket.appendChild(renderChampion());
      return;
    }

    // Two-sided: left half | Final + champion | right half (mirrored to centre).
    bracket.classList.add("bracket--sided");
    const leftLevels = levelsFromRoot(finalMatch.source_home); // [SF],[QF],[R16],[R32]
    const rightLevels = levelsFromRoot(finalMatch.source_away);

    const left = el("div", "bracket__side bracket__side--left");
    for (let i = leftLevels.length - 1; i >= 0; i--) left.appendChild(renderColumn(leftLevels[i]));

    const center = el("div", "bracket__center");
    center.appendChild(renderColumn([finalMatch.id]));
    center.appendChild(renderChampion());

    const right = el("div", "bracket__side bracket__side--right");
    for (let i = 0; i < rightLevels.length; i++) right.appendChild(renderColumn(rightLevels[i]));

    bracket.append(left, center, right);
  }

  function renderChampion() {
    const card = el("div", "champion");
    const champ = winnerOf("FINAL");

    const trophy = el("div", "champion__trophy");
    trophy.textContent = "🏆";
    const label = el("div", "champion__label");
    label.textContent = "Champion";
    card.append(trophy, label);

    if (champ) {
      card.append(
        avatarEl(champ.owner, "champion__avatar"),
        flagEl(champ.code, champ.team, "champion__flag")
      );
      const name = el("div", "champion__name");
      name.textContent = champ.team;
      const owner = el("div", "champion__owner");
      const p = state.people[champ.owner] || {};
      owner.style.color = p.color || "var(--gold)";
      owner.textContent = champ.owner;
      card.append(name, owner);
      $("#footer-champ").textContent = `🏆 ${champ.team} (${champ.owner}) are your champions!`;
    } else {
      card.classList.add("is-tbd");
      const name = el("div", "champion__name");
      name.textContent = "TBD";
      name.style.color = "var(--muted)";
      card.append(name);
    }
    return card;
  }

  /* ---------------- prize pot ---------------- */
  // Team -> owner, spanning the 32 bracket teams and the group-stage casualties.
  function teamOwnerMap() {
    const map = {};
    for (const m of state.fixtures.matches) {
      if (m.round !== "R32") continue;
      if (m.home) map[m.home.team] = m.home.owner;
      if (m.away) map[m.away.team] = m.away.owner;
    }
    for (const [owner, p] of Object.entries(state.people)) {
      (p && p.out_groups ? p.out_groups : []).forEach((t) => (map[t.team] = owner));
    }
    return map;
  }

  function r32MatchOfTeam(team) {
    return state.fixtures.matches.find(
      (m) =>
        m.round === "R32" &&
        ((m.home && m.home.team === team) || (m.away && m.away.team === team))
    );
  }

  // How far a team has got. depth: 0 groups .. 5 final, 6 champions.
  function teamProgress(team) {
    let m = r32MatchOfTeam(team);
    if (!m) return { depth: 0, alive: false }; // never reached the bracket
    const DEPTH = { R32: 1, R16: 2, QF: 3, SF: 4, FINAL: 5 };
    while (true) {
      const r = state.results[m.id];
      if (r && r.final) {
        const parts = getParticipants(m);
        const won = r.winner === "home" ? parts.home : parts.away;
        if (won && won.team === team) {
          if (m.feeds_into) {
            m = state.byId[m.feeds_into];
            continue;
          }
          return { depth: 6, alive: true }; // won the final
        }
        return { depth: DEPTH[m.round], alive: false }; // knocked out here
      }
      return { depth: DEPTH[m.round], alive: true }; // still to play this round
    }
  }

  function bestInTranche(list) {
    let depth = -1;
    let teams = [];
    for (const team of list || []) {
      const d = teamProgress(team).depth;
      if (d > depth) {
        depth = d;
        teams = [team];
      } else if (d === depth) {
        teams.push(team);
      }
    }
    return { depth, teams };
  }

  function renderPot() {
    const grid = $("#pot-grid");
    const section = $("#pot");
    if (!grid) return;
    const cfg = state.prizes;
    if (!cfg || !Array.isArray(cfg.prizes)) {
      if (section) section.style.display = "none";
      return;
    }
    grid.innerHTML = "";
    const cur = cfg.currency || "£";
    const owners = teamOwnerMap();
    const tr = cfg.tranches || {};
    const man = cfg.manual || {};

    const total = cfg.prizes.reduce((s, p) => s + (p.amount || 0), 0);
    const totalEl = $("#pot-total");
    if (totalEl) totalEl.textContent = cur + total;

    const holdersFor = (key) => {
      const one = (team, stage) => (team ? [{ team, owner: owners[team], stage }] : null);
      if (key === "winner") {
        const c = winnerOf("FINAL");
        return c ? [{ team: c.team, owner: c.owner }] : null;
      }
      if (key === "runnerup") {
        const f = state.byId["FINAL"];
        const r = f && state.results["FINAL"];
        if (r && r.final) {
          const p = getParticipants(f);
          const lo = r.winner === "home" ? p.away : p.home;
          return lo ? [{ team: lo.team, owner: lo.owner }] : null;
        }
        return null;
      }
      if (key === "good_best" || key === "avg_best" || key === "weak_best") {
        const name = key === "good_best" ? "Good" : key === "avg_best" ? "Average" : "Weak";
        const best = bestInTranche(tr[name]);
        if (best.depth < 0) return null;
        return best.teams.map((t) => ({ team: t, owner: owners[t], stage: ROUND_LABEL_FULL[best.depth] }));
      }
      if (key === "golden_boot") return one(man.golden_boot_team);
      if (key === "discipline") return one(man.discipline_team);
      if (key === "worst_team") return one(man.worst_team);
      return null;
    };

    for (const prize of cfg.prizes) {
      const item = el("div", "pot__item");
      const amount = el("div", "pot__amount");
      amount.textContent = cur + prize.amount;
      const label = el("div", "pot__label");
      label.textContent = prize.label;

      const holder = el("div", "pot__holder");
      const holders = holdersFor(prize.key);
      if (holders && holders.length) {
        item.classList.add("is-held");
        holders.forEach((h) => {
          const win = el("div", "pot__winner");
          win.appendChild(avatarEl(h.owner, "pot__avatar"));
          const txt = el("div", "pot__winner-text");
          const nm = el("span", "pot__owner");
          const pc = (state.people[h.owner] || {}).color;
          if (pc) nm.style.color = pc;
          nm.textContent = h.owner || "—";
          const tm = el("span", "pot__team");
          tm.textContent = h.stage ? `${h.team} · ${h.stage}` : h.team;
          txt.append(nm, tm);
          win.append(txt);
          holder.appendChild(win);
        });
      } else {
        const tbd = el("span", "pot__tbd");
        tbd.textContent = "TBD";
        holder.appendChild(tbd);
      }

      item.append(amount, label, holder);
      grid.appendChild(item);
    }
  }

  /* ---------------- standings ---------------- */
  function renderStandings() {
    const grid = $("#standings-grid");
    const graveGrid = $("#graveyard-grid");
    const graveyard = $("#graveyard");
    const graveCount = $("#graveyard-count");
    grid.innerHTML = "";
    if (graveGrid) graveGrid.innerHTML = "";

    // Every R32 (bracket) team, grouped by owner.
    const byOwner = {};
    const order = Object.keys(state.people);
    const ensure = (owner) => (byOwner[owner] = byOwner[owner] || []);
    for (const m of state.fixtures.matches) {
      if (m.round !== "R32") continue;
      for (const t of [m.home, m.away]) {
        if (t) ensure(t.owner).push({ team: t.team, code: t.code });
      }
    }

    // Eliminated bracket teams (loser of any finished match).
    const out = new Set();
    for (const m of state.fixtures.matches) {
      const loser = loserTeam(m);
      if (loser) out.add(loser.team);
    }

    // Group-stage casualties declared per owner in people.json as `out_groups`.
    const groupOut = (owner) => {
      const g = (state.people[owner] || {}).out_groups;
      return Array.isArray(g) ? g : [];
    };
    const aliveCount = (owner) =>
      (byOwner[owner] || []).filter((t) => !out.has(t.team)).length;

    const owners = order.filter((o) => (byOwner[o] && byOwner[o].length) || groupOut(o).length);

    const makeCard = (owner) => {
      const teams = byOwner[owner] || [];
      const gout = groupOut(owner);
      const aliveN = aliveCount(owner);
      const outN = teams.length - aliveN + gout.length;

      const card = el("div", "person");
      card.appendChild(avatarEl(owner));
      const body = el("div", "person__body");
      const name = el("div", "person__name");
      const p = state.people[owner] || {};
      name.style.color = p.color || "var(--text)";
      name.textContent = owner;

      const chips = el("div", "person__teams");
      teams
        .slice()
        .sort((a, b) => Number(out.has(a.team)) - Number(out.has(b.team)))
        .forEach((t) => {
          const isOut = out.has(t.team);
          const chip = el("span", "chip " + (isOut ? "chip--out" : "chip--alive"));
          chip.appendChild(flagEl(t.code, t.team));
          const tn = el("span");
          tn.textContent = t.team;
          chip.appendChild(tn);
          chips.appendChild(chip);
        });
      gout.forEach((t) => {
        const chip = el("span", "chip chip--out chip--group");
        chip.appendChild(flagEl(t.code, t.team));
        const tn = el("span");
        tn.textContent = t.team;
        chip.appendChild(tn);
        const tag = el("span", "chip__tag");
        tag.textContent = "groups";
        chip.appendChild(tag);
        chips.appendChild(chip);
      });

      const tally = el("div", "person__tally");
      tally.innerHTML = `<b>${aliveN}</b> alive · ${outN} out`;
      body.append(name, chips, tally);
      card.appendChild(body);
      return card;
    };

    // Owners with a team still alive stay in the main grid; the fully-eliminated
    // drop into the collapsible graveyard.
    const alive = owners
      .filter((o) => aliveCount(o) > 0)
      .sort((a, b) => aliveCount(b) - aliveCount(a) || a.localeCompare(b));
    const dead = owners.filter((o) => aliveCount(o) === 0).sort((a, b) => a.localeCompare(b));

    alive.forEach((o) => grid.appendChild(makeCard(o)));
    if (graveGrid) dead.forEach((o) => graveGrid.appendChild(makeCard(o)));

    if (graveyard) {
      graveyard.style.display = dead.length ? "" : "none";
      if (graveCount) graveCount.textContent = `(${dead.length})`;
    }
  }

  /* ---------------- headline ---------------- */
  function renderHeadline() {
    const c = state.headline.current;
    const primaryEl = $("#headline-primary");
    const updatedEl = $("#headline-updated");

    if (!c || !c.en) {
      primaryEl.textContent = "No results yet — first whistle awaits.";
      if (updatedEl) updatedEl.textContent = "";
      return;
    }

    primaryEl.innerHTML = highlightNames(c.en);
    if (updatedEl) updatedEl.textContent = c.generated_at ? "Updated " + relTime(c.generated_at) : "";
  }

  function highlightNames(text) {
    const safe = escapeHtml(text);
    const names = Object.keys(state.people).sort((a, b) => b.length - a.length);
    if (!names.length) return safe;
    const re = new RegExp("\\b(" + names.map(escapeReg).join("|") + ")\\b", "g");
    return safe.replace(re, '<span class="own">$1</span>');
  }

  function relTime(iso) {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "";
    const diff = Math.max(0, (Date.now() - then) / 1000);
    if (diff < 60) return "just now";
    const mins = Math.round(diff / 60);
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
    const days = Math.round(hrs / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  function formatKickoff(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
    );
  }
  function escapeReg(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /* ---------------- connectors ---------------- */
  let connectorRaf = 0;
  function scheduleConnectors() {
    cancelAnimationFrame(connectorRaf);
    connectorRaf = requestAnimationFrame(() =>
      requestAnimationFrame(drawConnectors)
    );
  }

  function drawConnectors() {
    const svg = $("#connectors");
    const scroll = $("#bracket-scroll");
    const bracket = $("#bracket");
    if (!svg || !scroll || !bracket) return;

    if (window.matchMedia("(max-width: 900px)").matches) {
      svg.innerHTML = "";
      return;
    }

    const w = bracket.scrollWidth;
    const h = bracket.scrollHeight;
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.style.width = w + "px";
    svg.style.height = h + "px";

    const base = scroll.getBoundingClientRect();
    const rectOf = (id) => {
      const node = bracket.querySelector(`.match[data-id="${id}"]`);
      if (!node) return null;
      const r = node.getBoundingClientRect();
      const left = r.left - base.left + scroll.scrollLeft;
      const right = r.right - base.left + scroll.scrollLeft;
      return {
        left,
        right,
        cx: (left + right) / 2,
        midY: r.top - base.top + scroll.scrollTop + r.height / 2,
      };
    };

    const paths = [];
    for (const m of state.fixtures.matches) {
      if (m.round === "R32") continue;
      const tgt = rectOf(m.id);
      if (!tgt) continue;
      for (const side of ["source_home", "source_away"]) {
        const srcId = m[side];
        const src = rectOf(srcId);
        if (!src) continue;
        // Direction-aware: works for the left half, the mirrored right half,
        // and both feeds into the centre Final.
        const ltr = src.cx < tgt.cx;
        const x1 = ltr ? src.right : src.left;
        const x2 = ltr ? tgt.left : tgt.right;
        const y1 = src.midY;
        const y2 = tgt.midY;
        const mx = (x1 + x2) / 2;
        const done = state.results[srcId] && state.results[srcId].final;
        paths.push(
          `<path d="M ${x1} ${y1} H ${mx} V ${y2} H ${x2}" class="${
            done ? "conn conn--done" : "conn"
          }"/>`
        );
      }
    }
    svg.innerHTML =
      `<style>
        .conn{fill:none;stroke:rgba(255,255,255,0.14);stroke-width:2;stroke-linejoin:round;}
        .conn--done{stroke:rgba(236,184,74,0.65);stroke-width:2.25;}
      </style>` + paths.join("");
  }

  /* ---------------- lifecycle ---------------- */
  window.addEventListener("resize", scheduleConnectors);
  window.addEventListener("load", scheduleConnectors);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleConnectors);
  }
  const bracketEl = document.getElementById("bracket");
  if (window.ResizeObserver && bracketEl) {
    new ResizeObserver(scheduleConnectors).observe(bracketEl);
  }

  // The two-sided desktop layout and the stacked mobile layout are different DOM,
  // so re-render when crossing the breakpoint.
  const layoutMq = window.matchMedia("(max-width: 900px)");
  const onLayoutChange = () => {
    if (!state.fixtures.matches.length) return;
    renderBracket();
    scheduleConnectors();
  };
  if (layoutMq.addEventListener) layoutMq.addEventListener("change", onLayoutChange);
  else if (layoutMq.addListener) layoutMq.addListener(onLayoutChange);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
