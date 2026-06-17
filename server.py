"""Local IC Investing cache dashboard server.

Run with:
    python server.py --port 8787

The server is read-only. It serves the static dashboard and exposes /api/cache,
which reads the current Telegram bot cache files from the trading workspace.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import urllib.parse
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


APP_DIR = Path(__file__).resolve().parent
TRADING_ROOT = APP_DIR.parent
HOME = Path.home()
APPDATA = Path(os.environ.get("APPDATA", HOME / "AppData" / "Roaming"))
PIPELINE_ROOT = Path(os.environ.get("TRADING_PIPELINE_ROOT", HOME / ".codex" / "automations" / "trading_pipeline"))


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8-sig", errors="replace"))
    except Exception as exc:
        return {"error": str(exc), "path": str(path)}


def read_csv_rows(path: Path | None, limit: int = 80) -> list[dict[str, Any]]:
    if not path or not path.exists():
        return []
    try:
        with path.open(newline="", encoding="utf-8-sig", errors="replace") as handle:
            return [dict(row) for row in list(csv.DictReader(handle))[:limit]]
    except Exception as exc:
        return [{"error": str(exc), "path": str(path)}]


def read_text_preview(path: Path | None, max_chars: int = 2200) -> str:
    if not path or not path.exists():
        return ""
    try:
        text = path.read_text(encoding="utf-8-sig", errors="replace").replace("\r", "").strip()
    except Exception as exc:
        return f"Could not read file: {exc}"
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "\n...[truncated]"


def report_line_for_code(path: Path | None, code: str) -> str:
    if not path or not path.exists() or not code:
        return ""
    try:
        lines = path.read_text(encoding="utf-8-sig", errors="replace").splitlines()
    except Exception:
        return ""
    needles = [f"`{code}`"]
    market, symbol = split_market_symbol(code)
    if symbol:
        needles.append(f"`{symbol}`")
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("- ") and any(needle in stripped for needle in needles):
            return stripped.removeprefix("- ").strip()
    return ""


def read_jsonl_tail(path: Path, limit: int = 25) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        lines = path.read_text(encoding="utf-8-sig", errors="replace").splitlines()
    except Exception as exc:
        return [{"error": str(exc), "path": str(path)}]

    output: list[dict[str, Any]] = []
    for line in lines[-limit:]:
        line = line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            parsed = {"raw": line}
        output.append(parsed if isinstance(parsed, dict) else {"value": parsed})
    return output


def file_info(path: Path | None) -> dict[str, Any] | None:
    if not path or not path.exists():
        return None
    stat = path.stat()
    return {
        "path": str(path),
        "name": path.name,
        "size": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


def latest_file(paths: list[Path], pattern: str | list[str]) -> Path | None:
    patterns = [pattern] if isinstance(pattern, str) else pattern
    files: list[Path] = []
    for path in paths:
        if path.exists():
            for item_pattern in patterns:
                files.extend(item for item in path.glob(item_pattern) if item.is_file() and item.stat().st_size > 0)
    if not files:
        return None
    return max(files, key=lambda item: item.stat().st_mtime)


def as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    return []


def report_specs() -> list[dict[str, Any]]:
    auto = HOME / ".codex" / "automations"
    reports = TRADING_ROOT / "automation" / "reports"
    pipeline_reports = PIPELINE_ROOT / "reports"
    return [
        {
            "key": "market_mover",
            "label": "Market Mover Briefing",
            "paths": [auto / "market_mover_briefing" / "reports", reports],
            "pattern": "market_mover_briefing_*.md",
        },
        {
            "key": "watchlist",
            "label": "Watchlist Refresh",
            "paths": [pipeline_reports, auto / "trading_watchlist" / "reports", reports],
            "pattern": ["watchlist_current.md", "watchlist_*.md"],
        },
        {
            "key": "opportunity",
            "label": "Opportunity Scan",
            "paths": [pipeline_reports, auto / "trading_opportunity_scan" / "reports", reports],
            "pattern": ["opportunity-scan_*.md", "opportunity_scan_*.md"],
        },
        {
            "key": "committee",
            "label": "Latest Debate",
            "paths": [pipeline_reports, auto / "trading_committee" / "reports", reports],
            "pattern": ["debate_*.md", "trading_*.md"],
        },
        {
            "key": "scan_context",
            "label": "Scan Context",
            "paths": [pipeline_reports, auto / "trading_scan_context" / "reports", reports],
            "pattern": ["handoff-plan_*.md", "scan_context_*.md"],
        },
        {
            "key": "bottleneck",
            "label": "Industry Bottleneck",
            "paths": [pipeline_reports, auto / "industry_bottleneck" / "reports", reports],
            "pattern": ["bottleneck_*.md", "industry_bottleneck_*.md"],
        },
        {
            "key": "ipo",
            "label": "IPO Scan",
            "paths": [pipeline_reports, auto / "ipo_scan" / "reports", reports],
            "pattern": ["ipo_*.md", "ipo_scan_*.md"],
        },
        {
            "key": "crypto",
            "label": "Crypto Scan",
            "paths": [auto / "crypto_scan" / "reports", reports],
            "pattern": "crypto_scan_*.md",
        },
        {
            "key": "instagram",
            "label": "Instagram Hype Scan",
            "paths": [pipeline_reports, reports],
            "pattern": "instagram_*.md",
        },
        {
            "key": "geopolitics",
            "label": "Geopolitics Scan",
            "paths": [pipeline_reports, reports],
            "pattern": "geopolitics_*.md",
        },
    ]


def build_reports() -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for spec in report_specs():
        path = latest_file(spec["paths"], spec["pattern"])
        output.append(
            {
                "key": spec["key"],
                "label": spec["label"],
                "file": file_info(path),
                "preview": read_text_preview(path),
            }
        )
    return output


def split_market_symbol(code: str) -> tuple[str, str]:
    text = str(code or "").strip()
    if "." not in text:
        return "", text
    market, symbol = text.split(".", 1)
    return market, symbol


def format_zone(values: Any) -> str:
    if isinstance(values, list) and len(values) >= 2:
        return f"{values[0]}-{values[1]}"
    if isinstance(values, tuple) and len(values) >= 2:
        return f"{values[0]}-{values[1]}"
    return str(values or "")


def score_to_five(value: Any) -> float | None:
    try:
        return round(float(value) / 20, 1)
    except (TypeError, ValueError):
        return None


def gate_sources(item: dict[str, Any]) -> list[str]:
    gates = item.get("committee_gates") or []
    sources = [str(gate.get("source")) for gate in gates if isinstance(gate, dict) and gate.get("source")]
    return sources


def dashboard_gate(gate: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": gate.get("source"),
        "status": gate.get("status"),
        "reason": gate.get("reason"),
        "evidence": gate.get("evidence"),
    }


def dashboard_watchlist_item(item: dict[str, Any], bucket: str, generated_at: str, bullbear_report: Path | None = None) -> dict[str, Any]:
    market, symbol = split_market_symbol(str(item.get("code") or item.get("symbol") or ""))
    setup = item.get("setup") or {}
    entry_zone = format_zone(setup.get("starter"))
    add_zone = format_zone(setup.get("add"))
    invalidation = setup.get("invalidation")
    return {
        "symbol": symbol,
        "market": market,
        "status": item.get("status") or bucket,
        "setup_score_0_to_5": score_to_five(item.get("decision_score")),
        "decision_score": item.get("decision_score"),
        "score_components": item.get("score_components") or {},
        "thesis": setup.get("thesis") or item.get("reason") or "",
        "source_agents": gate_sources(item),
        "agent_gates": [
            dashboard_gate(gate)
            for gate in as_list(item.get("committee_gates"))
            if isinstance(gate, dict)
        ],
        "evidence_ids": item.get("evidence_ids") or [],
        "current_price": item.get("last"),
        "entry_zone": entry_zone,
        "entry_point": entry_zone,
        "add_zone": add_zone,
        "chase_above": setup.get("chase_above"),
        "invalidation": invalidation,
        "stoploss": invalidation,
        "max_nav_pct": setup.get("max_nav_pct"),
        "first_target": "",
        "confidence": item.get("committee_result") or "",
        "reason": item.get("reason") or "",
        "bucket_label": setup.get("bucket") or bucket,
        "setup_label": setup.get("label") or item.get("name") or symbol,
        "bullbear_theory": report_line_for_code(bullbear_report, str(item.get("code") or "")),
        "committee_blockers": [dashboard_gate(gate) for gate in as_list(item.get("committee_blockers")) if isinstance(gate, dict)],
        "committee_cautions": [dashboard_gate(gate) for gate in as_list(item.get("committee_cautions")) if isinstance(gate, dict)],
        "remove_if": "Breaks invalidation, moves above chase zone, or committee gates block the setup.",
        "last_reviewed": generated_at,
        "raw_code": item.get("code"),
        "bucket": bucket,
        "change_pct": item.get("change_pct"),
    }


def dashboard_removed_item(item: dict[str, Any], generated_at: str) -> dict[str, Any]:
    market, symbol = split_market_symbol(str(item.get("code") or item.get("symbol") or ""))
    blockers = item.get("committee_blockers") or []
    evidence_source = ", ".join(
        str(gate.get("source"))
        for gate in blockers
        if isinstance(gate, dict) and gate.get("source")
    )
    return {
        "symbol": symbol,
        "market": market,
        "removed_at": generated_at,
        "reason": item.get("reason") or "Filtered into avoid/recheck by current watchlist gates.",
        "evidence_source": evidence_source or ", ".join(gate_sources(item)) or "watchlist_refresh",
        "raw_code": item.get("code"),
        "status": item.get("status") or "avoid_recheck",
    }


def dashboard_watchlist_from_pipeline(payload: dict[str, Any]) -> dict[str, Any]:
    generated_at = str(payload.get("generated_at") or utc_now())
    buckets = payload.get("buckets") or {}
    bullbear_report = latest_file([PIPELINE_ROOT / "reports"], "bullbear_*.md")
    active = []
    for bucket in ("starter_now", "starter_only_if_funded", "watch_pullback"):
        active.extend(dashboard_watchlist_item(item, bucket, generated_at, bullbear_report) for item in as_list(buckets.get(bucket)))
    removed = [dashboard_removed_item(item, generated_at) for item in as_list(buckets.get("avoid_recheck"))]
    return {
        "updated_at": generated_at,
        "items": active,
        "removed": removed,
        "source_reports": payload.get("source_reports") or {},
        "quote_errors": payload.get("quote_errors") or [],
        "market_volatility_warning": payload.get("market_volatility_warning") or {},
    }


def scan_context_from_pipeline(opportunity: dict[str, Any], watchlist_payload: dict[str, Any]) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in as_list(opportunity.get("decisions")) + as_list(watchlist_payload.get("committee_decisions")):
        code = str(item.get("code") or "")
        if not code or code in seen:
            continue
        seen.add(code)
        market, symbol = split_market_symbol(code)
        candidates.append(
            {
                "symbol": symbol,
                "market": market,
                "source_tags": [item.get("status") or item.get("committee_result") or "watchlist"],
                "mentions": len(item.get("evidence_ids") or []),
            }
        )
    return {"candidates": candidates}


def market_from_pipeline(watchlist_payload: dict[str, Any]) -> dict[str, Any]:
    warning = watchlist_payload.get("market_volatility_warning") or {}
    index_pulse = [
        {
            "symbol": item.get("label") or item.get("code"),
            "name": item.get("code"),
            "price": item.get("last"),
            "change_pct": item.get("change_pct"),
            "currency": "",
            "exchange": "",
        }
        for item in as_list(warning.get("benchmarks"))
    ]
    headlines = [
        {
            "title": item.get("title"),
            "published": item.get("date"),
            "description": item.get("job"),
            "link": "",
        }
        for item in as_list(warning.get("headlines"))
    ]
    return {
        "source": "trading_pipeline_watchlist_current",
        "mode": "research_only_no_trading",
        "generated_at": watchlist_payload.get("generated_at"),
        "index_pulse": index_pulse,
        "market_movers": [],
        "yahoo_trending_symbols": [],
        "headlines": headlines,
        "limitations": watchlist_payload.get("quote_errors") or [],
    }


def build_cache_payload() -> dict[str, Any]:
    state_dir = TRADING_ROOT / "automation" / "state"
    pipeline_watchlist_path = PIPELINE_ROOT / "data" / "watchlist_current.json"
    pipeline_data_dir = PIPELINE_ROOT / "data"
    legacy_watchlist_path = APPDATA / "Telecodex" / "trading-watchlist.json"
    watchlist_path = pipeline_watchlist_path if pipeline_watchlist_path.exists() else legacy_watchlist_path
    headline_events_path = state_dir / "trading-news-headlines.jsonl"
    raw_watchlist = read_json(watchlist_path, {"items": [], "removed": []})
    pipeline_watchlist = raw_watchlist if isinstance(raw_watchlist, dict) and "buckets" in raw_watchlist else {}
    watchlist = dashboard_watchlist_from_pipeline(pipeline_watchlist) if pipeline_watchlist else raw_watchlist
    market = read_json(state_dir / "market-mover-briefing-latest.json", {})
    reddit = read_json(state_dir / "reddit-stock-trends-latest.json", {"items": []})
    news_risk = read_json(state_dir / "trading-news-risk.json", {})
    social_leads = read_json(state_dir / "trading-social-leads.json", {"items": []})
    opportunity_path = latest_file([PIPELINE_ROOT / "data"], "opportunity-scan_*.json")
    opportunity = read_json(opportunity_path, {}) if opportunity_path else {}
    scan_context_path = latest_file(
        [
            PIPELINE_ROOT / "data",
            HOME / ".codex" / "automations" / "trading_scan_context" / "data",
            state_dir,
        ],
        ["handoff-plan_*.json", "scan_context_*.json"],
    )
    scan_context = read_json(scan_context_path, {}) if scan_context_path else {}
    if pipeline_watchlist:
        scan_context = scan_context_from_pipeline(opportunity if isinstance(opportunity, dict) else {}, pipeline_watchlist)
    if pipeline_watchlist:
        market = market_from_pipeline(pipeline_watchlist)

    instagram_path = latest_file([pipeline_data_dir], "instagram_*.json")
    geopolitics_path = latest_file([pipeline_data_dir], "geopolitics_*.json")
    opend_positions_csv_path = pipeline_data_dir / "opend_positions_current.csv"
    opend_positions_json_path = pipeline_data_dir / "opend_positions_current.json"
    active_portfolio_path = pipeline_data_dir / "active_portfolio.csv"
    instagram = read_json(instagram_path, {"items": []}) if instagram_path else {"items": []}
    geopolitics = read_json(geopolitics_path, {"items": []}) if geopolitics_path else {"items": []}
    opend_positions = read_csv_rows(opend_positions_csv_path if opend_positions_csv_path.exists() else active_portfolio_path)
    opend_metadata = read_json(opend_positions_json_path, {}) if opend_positions_json_path.exists() else {}

    active_watch = as_list(watchlist.get("items")) if isinstance(watchlist, dict) else []
    removed_watch = as_list(watchlist.get("removed")) if isinstance(watchlist, dict) else []
    market_movers = as_list(market.get("market_movers")) if isinstance(market, dict) else []
    headlines = as_list(market.get("headlines")) if isinstance(market, dict) else []
    headline_events = read_jsonl_tail(headline_events_path)
    index_pulse = as_list(market.get("index_pulse")) if isinstance(market, dict) else []
    reddit_items = as_list(reddit.get("items")) if isinstance(reddit, dict) else []
    leads = as_list(social_leads.get("items")) if isinstance(social_leads, dict) else []
    candidates = as_list(scan_context.get("candidates")) if isinstance(scan_context, dict) else []

    risk_state = "UNKNOWN"
    if isinstance(news_risk, dict):
        risk_state = str(news_risk.get("market_state") or news_risk.get("active_state") or "UNKNOWN")

    return {
        "generated_at": utc_now(),
        "workspace": str(TRADING_ROOT),
        "files": {
            "watchlist": file_info(watchlist_path),
            "market_mover": file_info(state_dir / "market-mover-briefing-latest.json"),
            "reddit": file_info(state_dir / "reddit-stock-trends-latest.json"),
            "news_risk": file_info(state_dir / "trading-news-risk.json"),
            "news_headline_events": file_info(headline_events_path),
            "social_leads": file_info(state_dir / "trading-social-leads.json"),
            "scan_context": file_info(scan_context_path),
            "instagram": file_info(instagram_path),
            "geopolitics": file_info(geopolitics_path),
            "opend_positions": file_info(opend_positions_csv_path if opend_positions_csv_path.exists() else None),
            "active_portfolio": file_info(active_portfolio_path if active_portfolio_path.exists() else None),
        },
        "summary": {
            "active_watchlist": len(active_watch),
            "removed_watchlist": len(removed_watch),
            "market_movers": len(market_movers),
            "headlines": len(headlines),
            "headline_events": len(headline_events),
            "reddit_trends": len(reddit_items),
            "social_leads": len(leads),
            "scan_candidates": len(candidates),
            "risk_state": risk_state,
            "instagram_items": len(as_list(instagram.get("items"))) if isinstance(instagram, dict) else 0,
            "geopolitics_items": len(as_list(geopolitics.get("items"))) if isinstance(geopolitics, dict) else 0,
            "opend_positions": len(opend_positions),
        },
        "watchlist": watchlist,
        "market": market,
        "reddit": reddit,
        "news_risk": news_risk,
        "news_headline_events": headline_events,
        "social_leads": social_leads,
        "scan_context": scan_context,
        "content": {
            "instagram": instagram,
            "geopolitics": geopolitics,
            "opend": {
                "positions": opend_positions,
                "metadata": opend_metadata,
            },
        },
        "reports": build_reports(),
    }


class CacheDashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/cache":
            payload = build_cache_payload()
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/":
            self.path = "/index.html"
        return super().do_GET()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the IC Investing cache dashboard.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument(
        "--export-snapshot",
        nargs="?",
        const=str(APP_DIR / "cache-snapshot.json"),
        help="Write a static cache snapshot JSON file and exit.",
    )
    args = parser.parse_args()
    if args.export_snapshot:
        output = Path(args.export_snapshot)
        output.write_text(json.dumps(build_cache_payload(), ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Exported cache snapshot: {output}")
        return
    server = ThreadingHTTPServer((args.host, args.port), CacheDashboardHandler)
    print(f"IC Investing cache dashboard: http://{args.host}:{args.port}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
