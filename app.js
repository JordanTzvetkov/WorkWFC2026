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
    byId: {},
    lang: localStorage.getItem("wc26-lang") === "bg" ? "bg" : "en",
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

      renderHeadline();
      renderStandings();
      renderBracket();
      wireLangToggle();
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
    node.textContent = initials(owner);
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", owner || "Unknown");
    if (p.img) {
      const img = new Image();
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("load", () => {
        node.textContent = "";
        img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%";
        node.appendChild(img);
      });
      // On 404 we simply keep the coloured initials already shown.
      img.addEventListener("error", () => {});
      img.src = "./assets/people/" + p.img;
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

  function renderBracket() {
    const bracket = $("#bracket");
    bracket.innerHTML = "";
    const rounds = state.fixtures.rounds || [];

    for (const r of rounds) {
      const matches = state.fixtures.matches.filter((m) => m.round === r.key);
      if (!matches.length) continue;

      const col = el("div", "round round--" + r.key.toLowerCase());
      const title = el("button", "round__title");
      title.type = "button";
      title.setAttribute("aria-expanded", "true");
      const label = el("span");
      label.textContent = r.label;
      const right = el("span", "round__count");
      right.textContent = matches.length === 1 ? "" : matches.length + " ties";
      const chev = el("span", "round__chevron");
      chev.setAttribute("aria-hidden", "true");
      chev.textContent = "▾";
      const rightWrap = el("span");
      rightWrap.style.cssText = "display:inline-flex;align-items:center;gap:10px";
      rightWrap.append(right, chev);
      title.append(label, rightWrap);

      const list = el("div", "round__matches");
      for (const m of matches) list.appendChild(renderMatch(m));

      title.addEventListener("click", () => {
        if (!window.matchMedia("(max-width: 900px)").matches) return;
        const collapsed = col.classList.toggle("is-collapsed");
        title.setAttribute("aria-expanded", String(!collapsed));
      });

      col.append(title, list);
      bracket.appendChild(col);
    }

    bracket.appendChild(renderChampion());
  }

  function renderChampion() {
    const col = el("div", "round round--champion");
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
    col.appendChild(card);
    return col;
  }

  /* ---------------- standings ---------------- */
  function renderStandings() {
    const grid = $("#standings-grid");
    grid.innerHTML = "";

    // Every R32 team, grouped by owner.
    const byOwner = {};
    const order = Object.keys(state.people);
    const ensure = (owner) => (byOwner[owner] = byOwner[owner] || []);

    for (const m of state.fixtures.matches) {
      if (m.round !== "R32") continue;
      for (const t of [m.home, m.away]) {
        if (t) ensure(t.owner).push({ team: t.team, code: t.code });
      }
    }

    // Eliminated team names (loser of any finished match).
    const out = new Set();
    for (const m of state.fixtures.matches) {
      const loser = loserTeam(m);
      if (loser) out.add(loser.team);
    }

    const owners = order.filter((o) => byOwner[o]);
    // Sort by teams still alive (desc), then name.
    owners.sort((a, b) => {
      const av = byOwner[a].filter((t) => !out.has(t.team)).length;
      const bv = byOwner[b].filter((t) => !out.has(t.team)).length;
      return bv - av || a.localeCompare(b);
    });

    for (const owner of owners) {
      const teams = byOwner[owner];
      const aliveN = teams.filter((t) => !out.has(t.team)).length;

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

      const tally = el("div", "person__tally");
      tally.innerHTML = `<b>${aliveN}</b> alive · ${teams.length - aliveN} out`;

      body.append(name, chips, tally);
      card.appendChild(body);
      grid.appendChild(card);
    }
  }

  /* ---------------- headline ---------------- */
  function renderHeadline() {
    const c = state.headline.current;
    const primaryEl = $("#headline-primary");
    const secondaryEl = $("#headline-secondary");
    const updatedEl = $("#headline-updated");

    if (!c || (!c.en && !c.bg)) {
      primaryEl.textContent = "No results yet — first whistle awaits.";
      secondaryEl.textContent = "";
      updatedEl.textContent = "";
      return;
    }

    const other = state.lang === "en" ? "bg" : "en";
    primaryEl.innerHTML = highlightNames(c[state.lang] || c[other] || "", state.lang);
    secondaryEl.textContent = c[other] || "";
    updatedEl.textContent = c.generated_at ? "Updated " + relTime(c.generated_at) : "";

    document.querySelectorAll(".lang-toggle__btn").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.lang === state.lang)
    );
  }

  function wireLangToggle() {
    document.querySelectorAll(".lang-toggle__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.lang = btn.dataset.lang;
        localStorage.setItem("wc26-lang", state.lang);
        renderHeadline();
      });
    });
  }

  function highlightNames(text, lang) {
    const safe = escapeHtml(text);
    if (lang !== "en") return safe; // names are transliterated in BG
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
      return {
        left: r.left - base.left + scroll.scrollLeft,
        right: r.right - base.left + scroll.scrollLeft,
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
        const x1 = src.right;
        const y1 = src.midY;
        const x2 = tgt.left;
        const y2 = tgt.midY;
        const mx = x1 + (x2 - x1) / 2;
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
