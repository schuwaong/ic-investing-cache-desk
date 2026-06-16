const state = {
  cache: null,
  loading: false,
  watchlistQuery: "",
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

function renderStockReport(item, focusAgent = "") {
  const gates = item.agent_gates || [];
  const focused = focusAgent ? gates.filter((gate) => gate.source === focusAgent) : gates;
  const otherGates = focusAgent ? gates.filter((gate) => gate.source !== focusAgent) : [];
  const scoreRows = Object.entries(item.score_components || {}).slice(0, 8);
  return `
    <section class="report-summary">
      <article>
        <span>Status</span>
        <strong>${escapeHtml(item.status || "watch")}</strong>
      </article>
      <article>
        <span>Committee</span>
        <strong>${escapeHtml(item.confidence || "not run")}</strong>
      </article>
      <article>
        <span>Score</span>
        <strong>${escapeHtml(item.decision_score ?? item.setup_score_0_to_5 ?? "n/a")}</strong>
      </article>
      <article>
        <span>Agents</span>
        <strong>${escapeHtml(gateSummary(gates))}</strong>
      </article>
    </section>

    <section class="report-block">
      <h3>Why It Is On The Watchlist</h3>
      <p>${escapeHtml(item.reason || "No current reason saved.")}</p>
      <p>${escapeHtml(item.thesis || "No thesis saved.")}</p>
      <div class="report-levels">
        <span>Last <strong>${escapeHtml(item.current_price ?? "n/a")}</strong></span>
        <span>Today <strong class="${pctClass(item.change_pct)}">${escapeHtml(formatPct(item.change_pct))}</strong></span>
        <span>Entry <strong>${escapeHtml(item.entry_zone || "n/a")}</strong></span>
        <span>Add <strong>${escapeHtml(item.add_zone || "n/a")}</strong></span>
        <span>Chase above <strong>${escapeHtml(item.chase_above ?? "n/a")}</strong></span>
        <span>Invalid <strong>${escapeHtml(item.invalidation ?? "n/a")}</strong></span>
        <span>Max starter <strong>${escapeHtml(item.max_nav_pct ?? "n/a")}% NAV</strong></span>
      </div>
    </section>

    <section class="report-block">
      <h3>${focusAgent ? `Focused Agent: ${escapeHtml(focusAgent)}` : "What Each Agent Says"}</h3>
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
                    <p>${escapeHtml(gate.reason || "No agent reason saved.")}</p>
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
          <h3>Other Agents</h3>
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
          <h3>Score Components</h3>
          <div class="score-grid">
            ${scoreRows
              .map(([key, value]) => `<span>${escapeHtml(key.replaceAll("_", " "))}<strong>${escapeHtml(value)}</strong></span>`)
              .join("")}
          </div>
        </section>
      `
      : ""}

    <section class="report-block">
      <h3>Removal Rule</h3>
      <p>${escapeHtml(item.remove_if || "Remove if committee gates block the setup.")}</p>
      ${(item.evidence_ids || []).length ? `<div class="agent-evidence">Evidence IDs: ${escapeHtml((item.evidence_ids || []).join(", "))}</div>` : ""}
    </section>
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

function sourceLabel(key) {
  const labels = {
    watchlist: "Watchlist",
    market_mover: "Market mover briefing",
    reddit: "Reddit pulse",
    news_risk: "News risk state",
    news_headline_events: "News headline events",
    social_leads: "Social leads",
    scan_context: "Scan context",
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
  renderSources(cache);
  renderReports(cache);
}

$("#refreshButton").addEventListener("click", loadCache);
$("#watchlistSearch").addEventListener("input", (event) => {
  state.watchlistQuery = event.target.value;
  if (state.cache) renderWatchlist(state.cache);
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
