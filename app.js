const state = {
  cache: null,
  loading: false,
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

function empty(message = "No cached data found yet.") {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function compactText(value, max = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trim()}...`;
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
  const items = cache.watchlist?.items || [];
  const removed = cache.watchlist?.removed || [];
  $("#watchlistCount").textContent = items.length;
  $("#removedCount").textContent = removed.length;
  $("#watchlistItems").innerHTML =
    items.length === 0
      ? empty("No active watchlist names in cache.")
      : items
          .map(
            (item) => `
              <article class="item-card">
                <div class="item-topline">
                  <div>
                    <h3><span class="ticker">${escapeHtml(item.symbol)}</span> ${escapeHtml(item.market || "")}</h3>
                    <div class="status">${escapeHtml(item.status || "watch")}</div>
                  </div>
                  <div class="mini-count">${escapeHtml(item.setup_score_0_to_5 ?? item.confidence ?? "watch")}</div>
                </div>
                <div class="meta-line">
                  Price ${escapeHtml(item.current_price || "n/a")} | Entry ${escapeHtml(item.entry_point || item.entry_zone || "n/a")} | Stop ${escapeHtml(item.stoploss || item.invalidation || "n/a")} | Target ${escapeHtml(item.first_target || "n/a")}
                </div>
                <div class="reason">${escapeHtml(item.reason || item.thesis || "No thesis saved.")}</div>
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
