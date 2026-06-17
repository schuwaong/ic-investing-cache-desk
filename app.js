const state = {
  cache: null,
  loading: false,
  watchlistQuery: "",
  selectedContentSymbol: "",
  contentFormat: "reel",
  lastContentScript: "",
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return number.toLocaleString();
}

function formatBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KB`;
  return `${(number / 1024 / 1024).toFixed(1)} MB`;
}

function formatPct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toFixed(2)}%`;
}

function pctClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "";
  return number > 0 ? "positive" : "negative";
}

function statusClass(value) {
  return `gate-${String(value || "missing").toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`;
}

function empty(message = "No cached data found yet.") {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function compactText(value, max = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trim()}...`;
}

function stripMarkup(value) {
  const text = String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function sourceHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return String(value || "source");
  }
}

function normalizeSymbol(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/^US\./, "")
    .replace(/^HK\./, "")
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^0+(?=\d)/, "");
}

function watchlistItems() {
  return state.cache?.watchlist?.items || [];
}

function findWatchlistItem(symbol) {
  return watchlistItems().find((item) => item.symbol === symbol || item.raw_code === symbol);
}

function gateSummary(gates = []) {
  const counts = gates.reduce(
    (acc, gate) => {
      const status = gate.status || "missing";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    {},
  );
  return [
    counts.pass ? `${counts.pass} pass` : "",
    counts.caution ? `${counts.caution} caution` : "",
    counts.block ? `${counts.block} block` : "",
    counts.missing ? `${counts.missing} missing` : "",
  ]
    .filter(Boolean)
    .join(" / ") || "no agent gates";
}

function gateBySource(item, source) {
  return (item.agent_gates || []).find((gate) => gate.source === source) || {};
}

function sentenceList(...values) {
  return values
    .flat()
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function buildBullBear(item) {
  const gates = item.agent_gates || [];
  const passGates = gates.filter((gate) => gate.status === "pass");
  const riskGates = gates.filter((gate) => ["caution", "block", "missing"].includes(gate.status || ""));
  const opportunity = gateBySource(item, "opportunity-scan");
  const technical = gateBySource(item, "technical");
  const valuation = gateBySource(item, "valuation");
  const bottleneck = gateBySource(item, "bottleneck");
  const earnings = gateBySource(item, "earnings");
  const redteam = gateBySource(item, "redteam");

  const bull = sentenceList(
    item.bullbear_theory || item.thesis,
    opportunity.status === "pass" ? `Opportunity scan supports the setup: ${opportunity.reason}` : "",
    technical.status === "pass" ? `Technical gate is clean: ${technical.evidence || technical.reason}` : "",
    valuation.status === "pass" ? `Valuation gate is acceptable: ${valuation.evidence || valuation.reason}` : "",
    passGates
      .filter((gate) => !["opportunity-scan", "technical", "valuation"].includes(gate.source))
      .slice(0, 3)
      .map((gate) => `${gate.source}: ${gate.reason}`),
  ).slice(0, 7);

  const bear = sentenceList(
    riskGates
      .filter((gate) => gate.source !== "portfolio-risk")
      .slice(0, 6)
      .map((gate) => `${gate.source}: ${gate.reason}${gate.evidence ? ` - ${gate.evidence}` : ""}`),
    bottleneck.status === "caution" ? "Bottleneck risk must be cleared before conviction sizing." : "",
    earnings.status === "caution" ? "Earnings/catalyst timing is unresolved, so sizing before date confirmation is lower quality." : "",
    redteam.reason ? `Redteam objection: ${redteam.evidence || redteam.reason}` : "",
  ).slice(0, 8);

  return { bull, bear };
}

function keywordTags(signal) {
  const hits = signal?.keyword_hits || {};
  return [
    ...new Set(
      Object.entries(hits).flatMap(([tag, values]) => [
        tag,
        ...(Array.isArray(values) ? values : []),
      ]),
    ),
  ].filter(Boolean);
}

function signalText(signal) {
  return [
    signal?.title,
    signal?.summary,
    signal?.source,
    keywordTags(signal).join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

function symbolThemes(item) {
  const text = [
    item?.symbol,
    item?.raw_code,
    item?.market,
    item?.setup_label,
    item?.thesis,
    item?.reason,
    item?.bullbear_theory,
  ]
    .join(" ")
    .toLowerCase();
  const symbol = String(item?.symbol || "").toUpperCase();
  const themes = new Set(["market", "macro", "policy"]);
  const techSymbols = ["AAPL", "AMZN", "AVGO", "GOOG", "META", "MSFT", "NVDA", "QNT", "TSLA"];
  const energySymbols = ["BKR", "EOG", "KMI", "OKE", "PSX", "SLB", "WMB", "XOM", "CVX"];
  const foodSymbols = ["ADM", "BG"];

  if (item?.market === "HK" || /china|hong kong|adr|netease|tencent|alibaba|gaming/.test(text)) {
    ["china", "tariff", "export controls", "geopolitics", "policy"].forEach((theme) => themes.add(theme));
  }
  if (techSymbols.includes(symbol) || /ai|semiconductor|chips|platform|cloud|quantum/.test(text)) {
    ["ai", "semiconductor", "export controls", "rare earths", "china"].forEach((theme) => themes.add(theme));
  }
  if (energySymbols.includes(symbol) || /energy|oil|gas|pipeline|refiner|lng|drilling/.test(text)) {
    ["energy", "oil", "shipping", "red sea", "hormuz"].forEach((theme) => themes.add(theme));
  }
  if (foodSymbols.includes(symbol) || /grain|agriculture|commodity|food/.test(text)) {
    ["commodity", "shipping", "tariff", "china"].forEach((theme) => themes.add(theme));
  }
  return [...themes];
}

function rankContentSignals(signals, item, limit = 4) {
  const themes = symbolThemes(item);
  const symbol = normalizeSymbol(item?.symbol);
  return (signals || [])
    .map((signal) => {
      const text = signalText(signal);
      const tags = keywordTags(signal).map((tag) => String(tag).toLowerCase());
      let rank = Number(signal.score || 0);
      if (symbol && text.includes(symbol.toLowerCase())) rank += 6;
      themes.forEach((theme) => {
        if (text.includes(theme)) rank += 2.2;
        if (tags.includes(theme)) rank += 2.8;
      });
      const age = Number(signal.age_days);
      if (Number.isFinite(age)) {
        if (age <= 3) rank += 5;
        else if (age <= 14) rank += 3;
        else if (age <= 45) rank += 1;
        else if (age > 90) rank -= 3.5;
      }
      return { signal, rank };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((entry) => entry.signal);
}

function signalFreshness(signal) {
  const age = Number(signal?.age_days);
  if (!Number.isFinite(age)) return "undated";
  if (age <= 3) return `${age.toFixed(1)}d fresh`;
  if (age <= 14) return `${age.toFixed(1)}d recent`;
  if (age <= 90) return `${age.toFixed(0)}d context`;
  return `${age.toFixed(0)}d old context`;
}

function qualityLine(label, payload) {
  const quality = payload?.quality || {};
  const recency = quality.recency || {};
  const count = quality.item_count ?? payload?.items?.length ?? 0;
  const newest = Number(recency.newest_age_days);
  const newestText = Number.isFinite(newest) ? `${newest.toFixed(1)}d newest` : "freshness n/a";
  const failed = Number(quality.failed_sources || 0);
  return `${label}: ${quality.status || "missing"} | ${formatNumber(count)} items | ${newestText} | ${failed} failed sources`;
}

function portfolioPosition(cache, item) {
  const rows = cache.content?.opend?.positions || [];
  const itemSymbols = [item?.symbol, item?.raw_code].map(normalizeSymbol).filter(Boolean);
  return rows.find((row) => itemSymbols.includes(normalizeSymbol(row.Symbol || row.symbol || row.Code || row.code)));
}

function positionSummary(cache, item) {
  const position = portfolioPosition(cache, item);
  if (!position) return "No matching OpenD or active portfolio row in cache; treat this as watchlist-only context.";
  return [
    position["% of Portfolio"] ? `${position["% of Portfolio"]} of portfolio` : "",
    position.Quantity ? `${position.Quantity} shares` : "",
    position["Average Cost"] ? `avg ${position["Average Cost"]}` : "",
    position["Current price"] ? `last ${position["Current price"]}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function scriptDraft(cache, item, format) {
  const { bull, bear } = buildBullBear(item);
  const geopolitics = rankContentSignals(cache.content?.geopolitics?.items || [], item, 3);
  const instagram = rankContentSignals(cache.content?.instagram?.items || [], item, 2);
  const symbol = item.symbol || item.raw_code || "this setup";
  const thesis = item.thesis || item.reason || item.bullbear_theory || "No thesis saved in the current cache.";
  const bullLine = bull[0] || thesis;
  const bearLine = bear[0] || "The bear case is not fully expressed in the current gates, so I would keep sizing conservative.";
  const geoLine = geopolitics[0]
    ? `${stripMarkup(geopolitics[0].title)} (${signalFreshness(geopolitics[0])})`
    : "No fresh geopolitical signal matched this ticker in the cache.";
  const socialLine = instagram[0]
    ? `${stripMarkup(instagram[0].title)} (${signalFreshness(instagram[0])})`
    : "No strong Instagram/social buzz signal matched this ticker in the cache.";
  const levelLine = `Entry ${item.entry_zone || "n/a"}, add ${item.add_zone || "n/a"}, invalidation ${item.invalidation || "n/a"}, max ${item.max_nav_pct ?? "n/a"}% NAV.`;
  const positionLine = positionSummary(cache, item);
  const hook =
    item.status === "watch_pullback"
      ? `${symbol} is not a chase for me - it is a patience test.`
      : `${symbol} is on my watchlist, but I want the bull case and the risk case side by side.`;

  if (format === "carousel") {
    return {
      title: `${symbol} carousel script`,
      beats: [
        ["Slide 1", `${symbol}: a watchlist case study, not a buy signal.`],
        ["Slide 2", `The simple thesis: ${thesis}`],
        ["Slide 3", `Bull case: ${bullLine}`],
        ["Slide 4", `Bear case: ${bearLine}`],
        ["Slide 5", `Geopolitical overlay: ${geoLine}`],
        ["Slide 6", `Position/zone check: ${positionLine}. ${levelLine}`],
        ["Slide 7", "My rule: if the invalidation breaks or the risk news gets worse, the setup goes back to review."],
      ],
      caption: `Research-only watchlist note on ${symbol}. The point is not prediction; it is separating thesis, risk, and price discipline.`,
    };
  }

  if (format === "voiceover") {
    return {
      title: `${symbol} voiceover script`,
      beats: [
        ["Open", hook],
        ["Context", `The thesis is simple: ${thesis}`],
        ["Bull", `The bull case is: ${bullLine}`],
        ["Bear", `The bear case is: ${bearLine}`],
        ["Geopolitics", `The geopolitical line I would keep on screen is: ${geoLine}`],
        ["Social angle", `The content/buzz angle in the cache is: ${socialLine}`],
        ["Process", `My level discipline is: ${levelLine} ${positionLine}`],
        ["Close", "This is research-only. I am trying to decide what would make me wrong before I decide what would make me excited."],
      ],
      caption: `${symbol} in plain English: thesis, bear case, geopolitics, and invalidation before action.`,
    };
  }

  return {
    title: `${symbol} reel script`,
    beats: [
      ["0-3s", hook],
      ["3-8s", `The bull case: ${bullLine}`],
      ["8-14s", `The bear case: ${bearLine}`],
      ["14-20s", `The geopolitics check: ${geoLine}`],
      ["20-25s", `The social/content signal: ${socialLine}`],
      ["25-32s", `The trading rule: ${levelLine}`],
      ["32-38s", `OpenD/portfolio context: ${positionLine}`],
      ["Close", "No hype, no prediction. Just thesis, risk, and the price where the idea is wrong."],
    ],
    caption: `Research-only ${symbol} watchlist breakdown: bull case, bear case, geopolitics, and invalidation before action.`,
  };
}

function draftToText(draft) {
  return [
    draft.title,
    "",
    ...draft.beats.map(([label, text]) => `${label}: ${text}`),
    "",
    `Caption: ${draft.caption}`,
    "Hashtags: #investing #stocks #watchlist #riskmanagement #geopolitics",
  ].join("\n");
}

function decisionLabel(item) {
  if (item.status === "starter_now") return "Buy Now Candidate";
  if (item.status === "starter_only_if_funded") return "Buy Only If Funded";
  if (item.status === "watch_pullback") return "Watchlist / Pullback";
  return "Recheck Before Action";
}

function renderStockReport(item, focusAgent = "") {
  const gates = item.agent_gates || [];
  const focused = focusAgent ? gates.filter((gate) => gate.source === focusAgent) : gates;
  const otherGates = focusAgent ? gates.filter((gate) => gate.source !== focusAgent) : [];
  const scoreRows = Object.entries(item.score_components || {}).slice(0, 8);
  const { bull, bear } = buildBullBear(item);
  return `
    <section class="report-hero">
      <div>
        <p class="section-kicker">${escapeHtml(decisionLabel(item))}</p>
        <h3>${escapeHtml(item.setup_label || item.symbol)} thesis</h3>
        <p>${escapeHtml(item.thesis || item.reason || "No thesis saved.")}</p>
      </div>
      <aside>
        <span>Committee</span>
        <strong>${escapeHtml(item.confidence || "not run")}</strong>
        <span>Agents</span>
        <strong>${escapeHtml(gateSummary(gates))}</strong>
        <span>Decision score</span>
        <strong>${escapeHtml(item.decision_score ?? item.setup_score_0_to_5 ?? "n/a")}</strong>
      </aside>
    </section>

    <section class="report-block decision-why">
      <h3>Why It Was Chosen</h3>
      <p>${escapeHtml(item.reason || "No current reason saved.")}</p>
      <p>${escapeHtml(item.bullbear_theory || "No bull/bear theory line found in the latest report.")}</p>
      <div class="decision-tags">
        <span>${escapeHtml(item.status || "watch")}</span>
        <span>${escapeHtml(item.bucket_label || "watchlist")}</span>
        <span>Max ${escapeHtml(item.max_nav_pct ?? "n/a")}% NAV</span>
      </div>
    </section>

    <section class="thesis-grid">
      <article class="case-card bull-card">
        <div class="case-title"><span>Bull</span><strong>Why it could work</strong></div>
        <ul>
          ${bull.length ? bull.map((point) => `<li>${escapeHtml(point)}</li>`).join("") : "<li>No bull points found.</li>"}
        </ul>
      </article>
      <article class="case-card bear-card">
        <div class="case-title"><span>Bear</span><strong>What can break it</strong></div>
        <ul>
          ${bear.length ? bear.map((point) => `<li>${escapeHtml(point)}</li>`).join("") : "<li>No bear points found.</li>"}
        </ul>
      </article>
    </section>

    <section class="report-block">
      <h3>Trade Plan / Invalidation</h3>
      <div class="report-levels compact-levels">
        <span>Entry <strong>${escapeHtml(item.entry_zone || "n/a")}</strong></span>
        <span>Add <strong>${escapeHtml(item.add_zone || "n/a")}</strong></span>
        <span>Chase above <strong>${escapeHtml(item.chase_above ?? "n/a")}</strong></span>
        <span>Invalid <strong>${escapeHtml(item.invalidation ?? "n/a")}</strong></span>
      </div>
      <p>${escapeHtml(item.remove_if || "Remove if committee gates block the setup.")}</p>
    </section>

    <section class="report-block">
      <h3>${focusAgent ? `Focused Agent: ${escapeHtml(focusAgent)}` : "Agent Debate"}</h3>
      <div class="agent-report-list">
        ${(focused.length ? focused : gates).length
          ? (focused.length ? focused : gates)
              .map(
                (gate) => `
                  <article class="agent-report ${statusClass(gate.status)}">
                    <div class="agent-report-top">
                      <strong>${escapeHtml(gate.source || "agent")}</strong>
                      <span>${escapeHtml(gate.status || "missing")}</span>
                    </div>
                    <p><strong class="${gate.status === "pass" ? "bull-word" : gate.status === "block" ? "bear-word" : ""}">${escapeHtml(gate.reason || "No agent reason saved.")}</strong></p>
                    ${gate.evidence ? `<div class="agent-evidence">${escapeHtml(gate.evidence)}</div>` : ""}
                  </article>
                `,
              )
              .join("")
          : empty("No agent details found for this stock.")}
      </div>
    </section>

    ${focusAgent && otherGates.length
      ? `
        <section class="report-block">
          <h3>Other Agent Votes</h3>
          <div class="agent-mini-grid">
            ${otherGates
              .map((gate) => `<span class="${statusClass(gate.status)}">${escapeHtml(gate.source)}: ${escapeHtml(gate.status)}</span>`)
              .join("")}
          </div>
        </section>
      `
      : ""}

    ${scoreRows.length
      ? `
        <section class="report-block">
          <h3>Model / Score Drivers</h3>
          <div class="score-grid">
            ${scoreRows
              .map(([key, value]) => `<span>${escapeHtml(key.replaceAll("_", " "))}<strong>${escapeHtml(value)}</strong></span>`)
              .join("")}
          </div>
        </section>
      `
      : ""}
    ${(item.evidence_ids || []).length ? `<div class="agent-evidence">Evidence IDs: ${escapeHtml((item.evidence_ids || []).join(", "))}</div>` : ""}
  `;
}

function openStockReport(symbol, focusAgent = "") {
  const item = findWatchlistItem(symbol);
  if (!item) return;
  $("#stockDialogTitle").textContent = `${item.symbol} ${item.market || ""} - ${item.setup_label || item.bucket_label || "Watchlist report"}`;
  $("#stockDialogBody").innerHTML = renderStockReport(item, focusAgent);
  const dialog = $("#stockDialog");
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function closeStockReport() {
  const dialog = $("#stockDialog");
  if (dialog.open && typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
}

async function loadCache() {
  if (state.loading) return;
  state.loading = true;
  $("#sidebarStatus").textContent = "Refreshing cache";
  $("#refreshButton").disabled = true;
  try {
    const { data, source } = await fetchCachePayload();
    state.cache = data;
    state.cacheSource = source;
    render();
    $("#sidebarStatus").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    $("#sidebarStatus").textContent = "Cache error";
    $("#heroMeta").innerHTML = `<span class="error-state">Could not load cache: ${escapeHtml(error.message)}</span>`;
  } finally {
    state.loading = false;
    $("#refreshButton").disabled = false;
  }
}

async function fetchCachePayload() {
  const attempts = [
    { url: "/api/cache", source: "live local API" },
    { url: "./cache-snapshot.json", source: "GitHub snapshot" },
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${attempt.url} ${response.status}`);
      return { data: await response.json(), source: attempt.source };
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(errors.join("; "));
}

function renderKpis(summary) {
  const cards = [
    ["Risk State", summary.risk_state || "UNKNOWN", "Macro/news guardrail"],
    ["Active Watchlist", summary.active_watchlist || 0, `${summary.removed_watchlist || 0} removed names cached`],
    ["Market Movers", summary.market_movers || 0, `${summary.headlines || 0} headlines, ${summary.headline_events || 0} risk events`],
    ["Debate Candidates", summary.scan_candidates || 0, `${summary.reddit_trends || 0} Reddit trends cached`],
  ];
  $("#kpiGrid").innerHTML = cards
    .map(
      ([label, value, note]) => `
        <article class="kpi-card">
          <div class="kpi-label">${escapeHtml(label)}</div>
          <div class="kpi-value">${escapeHtml(value)}</div>
          <div class="kpi-note">${escapeHtml(note)}</div>
        </article>
      `,
    )
    .join("");
}

function renderWatchlist(cache) {
  const query = state.watchlistQuery.trim().toLowerCase();
  const matchesQuery = (item) => {
    if (!query) return true;
    return [
      item.symbol,
      item.raw_code,
      item.name,
      item.market,
      item.status,
      item.confidence,
      item.reason,
      item.thesis,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  };
  const tableRows = (cache.watchlist?.table || []).filter(matchesQuery);
  const items = (cache.watchlist?.items || []).filter(matchesQuery);
  const removed = cache.watchlist?.removed || [];
  $("#watchlistCount").textContent = tableRows.length || items.length;
  $("#removedCount").textContent = removed.length;
  $("#watchlistItems").innerHTML = tableRows.length
    ? `
      <div class="watchlist-meta">
        <span>${escapeHtml(cache.watchlist?.mode || "research-only")}</span>
        <span>Updated ${escapeHtml(cache.watchlist?.table_generated_at || formatDate(cache.watchlist?.updated_at))}</span>
      </div>
      <div class="watchlist-table-wrap">
        <table class="watchlist-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Symbol</th>
              <th>Last</th>
              <th>Today</th>
              <th>Decision</th>
              <th>ML</th>
              <th>Entry / Add</th>
              <th>Invalidation</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows
              .map(
                (item) => `
                  <tr class="watch-row status-${escapeHtml(item.status || "watch")}">
                    <td><button class="status-chip stock-report-trigger" type="button" data-symbol="${escapeHtml(item.symbol)}">${escapeHtml(item.status_label || item.status || "watch")}</button></td>
                    <td>
                      <button class="link-button stock-report-trigger" type="button" data-symbol="${escapeHtml(item.symbol)}"><strong class="ticker">${escapeHtml(item.symbol)}</strong></button>
                      <div class="meta-line">${escapeHtml(item.name || item.market || "")}</div>
                    </td>
                    <td>${escapeHtml(item.last ?? "n/a")}</td>
                    <td><span class="${pctClass(item.change_pct)}">${escapeHtml(formatPct(item.change_pct))}</span></td>
                    <td>${escapeHtml(item.decision_score ?? "n/a")}</td>
                    <td>
                      ${escapeHtml(item.ml_score ?? "n/a")}
                      <div class="meta-line">${escapeHtml(item.ml_status || "")}</div>
                    </td>
                    <td>
                      ${escapeHtml(item.entry_zone || "n/a")}
                      <div class="meta-line">Add ${escapeHtml(item.add_zone || "n/a")}</div>
                    </td>
                    <td>${escapeHtml(item.invalidation ?? "n/a")}</td>
                    <td>
                      <strong>${escapeHtml(item.reason_tag || item.reason || "")}</strong>
                      <div class="meta-line">${escapeHtml(compactText(item.thesis || item.reason || "", 150))}</div>
                    </td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `
    : items.length === 0
      ? empty("No active watchlist names in cache.")
      : items
          .map(
            (item) => `
              <article class="item-card watchlist-card status-${escapeHtml(item.status || "watch")}" data-symbol="${escapeHtml(item.symbol)}">
                <div class="item-topline">
                  <div>
                    <h3><button class="link-button stock-report-trigger" type="button" data-symbol="${escapeHtml(item.symbol)}"><span class="ticker">${escapeHtml(item.symbol)}</span> ${escapeHtml(item.market || "")}</button></h3>
                    <div class="status">${escapeHtml(item.confidence || item.status || "watch")}</div>
                  </div>
                  <button class="status-chip stock-report-trigger" type="button" data-symbol="${escapeHtml(item.symbol)}">${escapeHtml(item.status || "watch")}</button>
                </div>
                <div class="watch-metrics">
                  <span><small>Last</small><strong>${escapeHtml(item.current_price || "n/a")}</strong></span>
                  <span><small>Today</small><strong class="${pctClass(item.change_pct)}">${escapeHtml(formatPct(item.change_pct))}</strong></span>
                  <span><small>Entry</small><strong>${escapeHtml(item.entry_point || item.entry_zone || "n/a")}</strong></span>
                  <span><small>Add</small><strong>${escapeHtml(item.add_zone || "n/a")}</strong></span>
                  <span><small>Invalid</small><strong>${escapeHtml(item.stoploss || item.invalidation || "n/a")}</strong></span>
                </div>
                <div class="reason">${escapeHtml(item.reason || item.thesis || "No thesis saved.")}</div>
                <div class="agent-strip">
                  ${(item.source_agents || [])
                    .slice(0, 8)
                    .map((agent) => `<button type="button" data-symbol="${escapeHtml(item.symbol)}" data-agent="${escapeHtml(agent)}">${escapeHtml(agent)}</button>`)
                    .join("")}
                </div>
              </article>
            `,
          )
          .join("");

  $("#removedItems").innerHTML =
    removed.length === 0
      ? empty("No removed names cached.")
      : removed
          .slice(0, 18)
          .map(
            (item) => `
              <article class="item-card">
                <div class="item-topline">
                  <h3><span class="ticker">${escapeHtml(item.symbol)}</span></h3>
                  <span class="status">${escapeHtml(formatDate(item.removed_at))}</span>
                </div>
                <div class="reason">${escapeHtml(item.reason || "No removal reason saved.")}</div>
                <div class="meta-line">${escapeHtml(item.evidence_source || "")}</div>
              </article>
            `,
          )
          .join("");
}

function renderMarket(cache) {
  const index = cache.market?.index_pulse || [];
  $("#indexPulse").innerHTML =
    index.length === 0
      ? empty("No index pulse cached.")
      : index
          .map(
            (item) => `
              <div class="quote-tile">
                <div class="item-topline">
                  <span class="ticker">${escapeHtml(item.symbol)}</span>
                  <span class="${pctClass(item.change_pct)}">${escapeHtml(formatPct(item.change_pct))}</span>
                </div>
                <div class="quote-price">${escapeHtml(formatNumber(item.price))} ${escapeHtml(item.currency || "")}</div>
                <div class="meta-line">${escapeHtml(item.name || item.exchange || "")}</div>
              </div>
            `,
          )
          .join("");

  const trending = cache.market?.yahoo_trending_symbols || [];
  $("#trendingSymbols").innerHTML =
    trending.length === 0
      ? ""
      : trending
          .slice(0, 18)
          .map((symbol) => `<span class="tag-pill">${escapeHtml(symbol)}</span>`)
          .join("");

  const movers = cache.market?.market_movers || [];
  const headlines = cache.market?.headlines || [];
  $("#marketMovers").innerHTML =
    movers.length === 0
      ? empty("No market movers cached.")
      : movers
          .slice(0, 10)
          .map((item) => {
            const headline = headlines.find((entry) => String(entry.title || "").toUpperCase().includes(String(item.symbol || "").replace("^", "").toUpperCase()));
            return `
              <article class="item-card">
                <div class="item-topline">
                  <h3><span class="ticker">${escapeHtml(item.symbol)}</span> ${escapeHtml(item.name || "")}</h3>
                  <span class="${pctClass(item.change_pct)}">${escapeHtml(formatPct(item.change_pct))}</span>
                </div>
                <div class="meta-line">${escapeHtml(formatNumber(item.price))} ${escapeHtml(item.currency || "")} | ${escapeHtml(item.exchange || "")}</div>
                <div class="reason">${escapeHtml(headline?.title || "No direct headline match cached.")}</div>
              </article>
            `;
          })
          .join("");

  $("#headlineList").innerHTML =
    headlines.length === 0
      ? empty("No headlines cached.")
      : headlines
          .slice(0, 12)
          .map(
            (item) => `
              <a class="headline-item" href="${escapeHtml(item.link || "#")}" target="_blank" rel="noreferrer">
                ${escapeHtml(item.title)}
                <span class="headline-source">${escapeHtml(item.published || item.description || "")}</span>
              </a>
            `,
          )
          .join("");
}

function renderReddit(cache) {
  const items = cache.reddit?.items || [];
  $("#redditItems").innerHTML =
    items.length === 0
      ? empty("No Reddit trend cache found.")
      : items
          .slice(0, 12)
          .map((item) => {
            const delta = Number(item.mention_delta ?? 0);
            const deltaText = delta >= 0 ? `+${delta}` : String(delta);
            return `
              <article class="item-card">
                <div class="item-topline">
                  <div>
                    <h3>#${escapeHtml(item.rank || "?")} <span class="ticker">${escapeHtml(item.ticker)}</span> ${escapeHtml(item.name || "")}</h3>
                    <div class="status">${escapeHtml(item.rank_24h_ago ? `24h rank #${item.rank_24h_ago}` : "attention")}</div>
                  </div>
                  <span class="${pctClass(delta)}">${escapeHtml(deltaText)}</span>
                </div>
                <div class="meta-line">${escapeHtml(formatNumber(item.mentions))} mentions | ${escapeHtml(formatNumber(item.upvotes))} upvotes | ${escapeHtml(formatPct(item.mention_delta_pct))}</div>
                <div class="reason">${escapeHtml((item.why || []).slice(0, 3).join("; "))}</div>
                <div class="meta-line">${escapeHtml(item.content_angle?.reel_hook || "")}</div>
              </article>
            `;
          })
          .join("");
}

function renderRisk(cache) {
  const risk = cache.news_risk || {};
  const stateText = risk.market_state || risk.active_state || "UNKNOWN";
  const badge = $("#riskBadge");
  badge.textContent = stateText;
  badge.className = "risk-badge";
  if (stateText === "RISK_OFF") badge.classList.add("risk-off");
  if (stateText === "RISK_ON") badge.classList.add("risk-on");
  const rows = [
    ["Sentiment score", risk.sentiment_score ?? "n/a"],
    ["Geopolitical flag", risk.geopolitical_risk_flag ?? "n/a"],
    ["Override active", risk.risk_override_active ?? "n/a"],
    ["Risk expires", risk.risk_expires_at || "none"],
    ["Target sectors", (risk.target_sectors || []).join(", ") || "none"],
    ["Evaluated headlines", risk.evaluated_headline_count ?? "n/a"],
  ];
  $("#riskDetails").innerHTML = rows
    .map(
      ([label, value]) => `
        <div class="risk-row">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `,
    )
    .join("");

  const leads = cache.social_leads?.items || [];
  $("#socialLeads").innerHTML =
    leads.length === 0
      ? empty("No social leads cached.")
      : leads
          .slice(0, 10)
          .map(
            (item) => `
              <article class="item-card">
                <div class="item-topline">
                  <h3>${escapeHtml(item.author || item.id || "Lead")}</h3>
                  <span class="status">${escapeHtml(item.status || item.source || "lead")}</span>
                </div>
                <div class="reason">${escapeHtml(compactText(item.note || item.caption || item.raw_request || ""))}</div>
                <div class="meta-line">${escapeHtml(item.url || "")}</div>
              </article>
            `,
          )
          .join("");
}

function renderCandidates(cache) {
  const candidates = cache.scan_context?.candidates || [];
  $("#candidateList").innerHTML =
    candidates.length === 0
      ? empty("No structured scan context found.")
      : `
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Market</th>
              <th>Sources</th>
              <th>Mentions</th>
            </tr>
          </thead>
          <tbody>
            ${candidates
              .slice(0, 24)
              .map(
                (item) => `
                  <tr>
                    <td><strong>${escapeHtml(item.symbol)}</strong></td>
                    <td>${escapeHtml(item.market || "")}</td>
                    <td>${escapeHtml((item.source_tags || []).join(", "))}</td>
                    <td>${escapeHtml(item.mentions ?? "")}</td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      `;
}

function renderIdeas(cache) {
  const ideas = cache.market?.content_ideas || [];
  $("#contentIdeas").innerHTML =
    ideas.length === 0
      ? empty("No briefing ideas cached.")
      : ideas
          .map(
            (item) => `
              <article class="item-card">
                <div class="item-topline">
                  <h3>${escapeHtml(item.hook || "Briefing idea")}</h3>
                  <span class="status">${escapeHtml(item.format || "idea")}</span>
                </div>
                <div class="reason">${escapeHtml(item.beats || "")}</div>
                <div class="meta-line">${escapeHtml(item.caption || item.source_hint || "")}</div>
              </article>
            `,
          )
          .join("");

  const limitations = [...new Set([...(cache.market?.limitations || []), ...(cache.reddit?.limitations || [])])];
  $("#limitationsList").innerHTML =
    limitations.length === 0
      ? empty("No limitations cached.")
      : limitations
          .map(
            (item) => `
              <article class="item-card">
                <div class="reason">${escapeHtml(item)}</div>
              </article>
            `,
          )
          .join("");
}

function renderContent(cache) {
  const items = watchlistItems();
  const tickerSelect = $("#contentTickerSelect");
  const formatSelect = $("#contentFormatSelect");
  if (!items.length) {
    tickerSelect.innerHTML = "";
    $("#contentScript").innerHTML = empty("No watchlist names available for script generation.");
    $("#contentSignals").innerHTML = empty("No content context available.");
    return;
  }

  if (state.contentFormat !== formatSelect.value) {
    state.contentFormat = formatSelect.value || "reel";
  }
  if (!state.selectedContentSymbol || !items.some((item) => item.symbol === state.selectedContentSymbol)) {
    state.selectedContentSymbol = items[0].symbol;
  }
  formatSelect.value = state.contentFormat;
  tickerSelect.innerHTML = items
    .map((item) => `<option value="${escapeHtml(item.symbol)}" ${item.symbol === state.selectedContentSymbol ? "selected" : ""}>${escapeHtml(item.symbol)} - ${escapeHtml(item.setup_label || item.status || "watch")}</option>`)
    .join("");

  const item = findWatchlistItem(state.selectedContentSymbol) || items[0];
  const draft = scriptDraft(cache, item, state.contentFormat);
  const text = draftToText(draft);
  state.lastContentScript = text;
  const { bull, bear } = buildBullBear(item);
  const geoSignals = rankContentSignals(cache.content?.geopolitics?.items || [], item, 4);
  const instaSignals = rankContentSignals(cache.content?.instagram?.items || [], item, 4);
  const contentRiskLabel = cache.summary?.risk_state === "RISK_OFF" ? "Hold / de-risk" : "Research / build";

  $("#contentScript").innerHTML = `
    <article class="item-card script-card">
      <div class="item-topline">
        <div>
          <h3>${escapeHtml(draft.title)}</h3>
          <div class="status">${escapeHtml(item.status || "watch")} | ${escapeHtml(item.market || "market")} | ${escapeHtml(contentRiskLabel)}</div>
        </div>
        <button class="status-chip" id="copyContentScript" type="button">Copy</button>
      </div>
      <div class="script-beats">
        ${draft.beats
          .map(
            ([label, line]) => `
              <div class="script-beat">
                <span>${escapeHtml(label)}</span>
                <p>${escapeHtml(line)}</p>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="script-caption">${escapeHtml(draft.caption)}</div>
      <pre>${escapeHtml(text)}</pre>
    </article>

    <article class="item-card">
      <div class="item-topline">
        <h3>Trading Pipeline Check</h3>
        <span class="status">${escapeHtml(item.confidence || "research")}</span>
      </div>
      <div class="script-mini-grid">
        <span>Bull Case<strong>${escapeHtml(compactText(bull[0] || item.thesis || "No bull thesis saved.", 130))}</strong></span>
        <span>Bear Case<strong>${escapeHtml(compactText(bear[0] || "No bear case saved.", 130))}</strong></span>
        <span>Levels<strong>${escapeHtml(`Entry ${item.entry_zone || "n/a"} | Add ${item.add_zone || "n/a"} | Invalid ${item.invalidation || "n/a"}`)}</strong></span>
        <span>OpenD<strong>${escapeHtml(positionSummary(cache, item))}</strong></span>
      </div>
    </article>
  `;

  const qualityRows = [
    qualityLine("Instagram", cache.content?.instagram || {}),
    qualityLine("Geopolitics", cache.content?.geopolitics || {}),
  ];
  $("#contentSignals").innerHTML = `
    <article class="item-card">
      <div class="item-topline">
        <h3>Data Quality</h3>
        <span class="status">${escapeHtml(cache.summary?.opend_positions ? `${cache.summary.opend_positions} positions` : "watchlist")}</span>
      </div>
      <div class="script-quality">
        ${qualityRows.map((row) => `<div>${escapeHtml(row)}</div>`).join("")}
      </div>
    </article>
    <article class="item-card">
      <div class="item-topline">
        <h3>Matched Geopolitics</h3>
        <span class="status">${escapeHtml(symbolThemes(item).slice(0, 3).join(", "))}</span>
      </div>
      ${geoSignals.length
        ? geoSignals
            .map(
              (signal) => `
                <a class="signal-item" href="${escapeHtml(signal.link || "#")}" target="_blank" rel="noreferrer">
                  <strong>${escapeHtml(compactText(stripMarkup(signal.title), 140))}</strong>
                  <span>${escapeHtml(signalFreshness(signal))} | ${escapeHtml(sourceHost(signal.source || signal.link))} | ${escapeHtml(keywordTags(signal).slice(0, 5).join(", ") || "untagged")}</span>
                </a>
              `,
            )
            .join("")
        : empty("No matched geopolitics signals.")}
    </article>
    <article class="item-card">
      <div class="item-topline">
        <h3>Matched Instagram/Social</h3>
        <span class="status">${escapeHtml(cache.content?.instagram?.quality?.status || "missing")}</span>
      </div>
      ${instaSignals.length
        ? instaSignals
            .map(
              (signal) => `
                <a class="signal-item" href="${escapeHtml(signal.link || "#")}" target="_blank" rel="noreferrer">
                  <strong>${escapeHtml(compactText(stripMarkup(signal.title), 140))}</strong>
                  <span>${escapeHtml(signalFreshness(signal))} | ${escapeHtml(sourceHost(signal.source || signal.link))} | ${escapeHtml(keywordTags(signal).slice(0, 5).join(", ") || "untagged")}</span>
                </a>
              `,
            )
            .join("")
        : empty("No matched Instagram/social signals.")}
    </article>
  `;
}

function sourceLabel(key) {
  const labels = {
    watchlist: "Watchlist",
    market_mover: "Market mover briefing",
    reddit: "Reddit pulse",
    news_risk: "News risk state",
    news_headline_events: "News headline events",
    social_leads: "Social leads",
    scan_context: "Scan context",
    instagram: "Instagram scan",
    geopolitics: "Geopolitics scan",
    opend_positions: "OpenD positions",
    active_portfolio: "Active portfolio",
  };
  return labels[key] || key.replaceAll("_", " ");
}

function renderSources(cache) {
  const files = Object.entries(cache.files || {});
  $("#sourceList").innerHTML =
    files.length === 0
      ? empty("No source files reported.")
      : files
          .map(([key, file]) => {
            const present = Boolean(file);
            return `
              <div class="source-row">
                <span class="fresh-dot ${present ? "" : "missing"}"></span>
                <div>
                  <h3>${escapeHtml(sourceLabel(key))}</h3>
                  <div class="source-path">${escapeHtml(file?.path || "Missing or not generated yet.")}</div>
                </div>
                <div class="meta-line">${escapeHtml(present ? `${formatDate(file.modified_at)} | ${formatBytes(file.size)}` : "missing")}</div>
              </div>
            `;
          })
          .join("");

  const events = cache.news_headline_events || [];
  $("#newsEvents").innerHTML =
    events.length === 0
      ? empty("No headline event log found yet.")
      : events
          .slice()
          .reverse()
          .map((item) => {
            const title = item.headline || item.title || item.raw || item.value || "Headline event";
            const status = item.market_state || item.active_state || item.signal || item.sentiment || item.symbol || "event";
            const time = item.created_at || item.timestamp || item.updated_at || item.time || "";
            return `
              <article class="item-card">
                <div class="item-topline">
                  <h3>${escapeHtml(compactText(title, 120))}</h3>
                  <span class="status">${escapeHtml(status)}</span>
                </div>
                <div class="meta-line">${escapeHtml(formatDate(time))}</div>
                <div class="reason">${escapeHtml(compactText(item.reason || item.note || item.why || "", 180))}</div>
              </article>
            `;
          })
          .join("");
}

function renderReports(cache) {
  const reports = cache.reports || [];
  $("#reportList").innerHTML =
    reports.length === 0
      ? empty("No reports found.")
      : reports
          .map(
            (report) => `
              <details class="item-card report-card">
                <summary>${escapeHtml(report.label)} ${report.file ? "" : "(missing)"}</summary>
                <div class="meta-line">${escapeHtml(report.file?.path || "No file found.")}</div>
                <div class="meta-line">Updated ${escapeHtml(formatDate(report.file?.modified_at))}</div>
                <pre>${escapeHtml(report.preview || "No preview available.")}</pre>
              </details>
            `,
          )
          .join("");
}

function render() {
  const cache = state.cache;
  if (!cache) return;
  const summary = cache.summary || {};
  $("#heroMeta").textContent = `Workspace ${cache.workspace}. Source ${state.cacheSource || "cache"}. Refresh ${formatDate(cache.generated_at)}. Latest market cache ${formatDate(cache.files?.market_mover?.modified_at)}.`;
  renderKpis(summary);
  renderWatchlist(cache);
  renderMarket(cache);
  renderReddit(cache);
  renderRisk(cache);
  renderCandidates(cache);
  renderIdeas(cache);
  renderContent(cache);
  renderSources(cache);
  renderReports(cache);
}

$("#refreshButton").addEventListener("click", loadCache);
$("#watchlistSearch").addEventListener("input", (event) => {
  state.watchlistQuery = event.target.value;
  if (state.cache) renderWatchlist(state.cache);
});
$("#contentTickerSelect").addEventListener("change", (event) => {
  state.selectedContentSymbol = event.target.value;
  if (state.cache) renderContent(state.cache);
});
$("#contentFormatSelect").addEventListener("change", (event) => {
  state.contentFormat = event.target.value;
  if (state.cache) renderContent(state.cache);
});
$("#contentScript").addEventListener("click", async (event) => {
  if (!event.target.closest("#copyContentScript")) return;
  try {
    await navigator.clipboard.writeText(state.lastContentScript || "");
    event.target.textContent = "Copied";
    setTimeout(() => {
      event.target.textContent = "Copy";
    }, 1200);
  } catch {
    event.target.textContent = "Select text";
  }
});
$("#watchlistItems").addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-symbol]");
  if (!trigger) return;
  openStockReport(trigger.dataset.symbol, trigger.dataset.agent || "");
});
$("#closeStockDialog").addEventListener("click", closeStockReport);
$("#stockDialog").addEventListener("click", (event) => {
  if (event.target.id === "stockDialog") closeStockReport();
});
async function setupMotionRuntime() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  try {
    const { animate, hover, stagger, inView } = await import("https://cdn.jsdelivr.net/npm/motion@latest/+esm");
    document.documentElement.classList.add("motion-ready");

    animate(
      ".sidebar, .hero-panel, .kpi-card",
      { opacity: [0, 1], y: [18, 0], filter: ["blur(10px)", "blur(0px)"] },
      { duration: 0.72, delay: stagger(0.07), easing: [0.16, 1, 0.3, 1] }
    );

    inView(".panel, .item-card", (element) => {
      animate(element, { opacity: [0, 1], y: [20, 0] }, { duration: 0.58, easing: [0.16, 1, 0.3, 1] });
    }, { margin: "0px 0px -10% 0px" });

    document.querySelectorAll(".primary-action, .nav-list a, .kpi-card, .panel").forEach((element) => {
      hover(element, () => {
        animate(element, { scale: 1.01 }, { type: "spring", stiffness: 420, damping: 32 });
        return () => animate(element, { scale: 1 }, { type: "spring", stiffness: 420, damping: 32 });
      });
    });
  } catch (error) {
    document.documentElement.classList.remove("motion-ready");
  }
}

setupMotionRuntime();
loadCache();
