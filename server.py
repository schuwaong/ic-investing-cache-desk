"""Local IC Investing cache dashboard server.

Run with:
    python server.py --port 8787

The server is read-only. It serves the static dashboard and exposes /api/cache,
which reads the current Telegram bot cache files from the trading workspace.
"""

from __future__ import annotations

import argparse
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


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8-sig", errors="replace"))
    except Exception as exc:
        return {"error": str(exc), "path": str(path)}


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


def latest_file(paths: list[Path], pattern: str) -> Path | None:
    files: list[Path] = []
    for path in paths:
        if path.exists():
            files.extend(item for item in path.glob(pattern) if item.is_file() and item.stat().st_size > 0)
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
            "paths": [auto / "trading_watchlist" / "reports", reports],
            "pattern": "watchlist_*.md",
        },
        {
            "key": "opportunity",
            "label": "Opportunity Scan",
            "paths": [auto / "trading_opportunity_scan" / "reports", reports],
            "pattern": "opportunity_scan_*.md",
        },
        {
            "key": "committee",
            "label": "Latest Debate",
            "paths": [auto / "trading_committee" / "reports", reports],
            "pattern": "trading_*.md",
        },
        {
            "key": "scan_context",
            "label": "Scan Context",
            "paths": [auto / "trading_scan_context" / "reports", reports],
            "pattern": "scan_context_*.md",
        },
        {
            "key": "bottleneck",
            "label": "Industry Bottleneck",
            "paths": [auto / "industry_bottleneck" / "reports", reports],
            "pattern": "industry_bottleneck_*.md",
        },
        {
            "key": "ipo",
            "label": "IPO Scan",
            "paths": [auto / "ipo_scan" / "reports", reports],
            "pattern": "ipo_scan_*.md",
        },
        {
            "key": "crypto",
            "label": "Crypto Scan",
            "paths": [auto / "crypto_scan" / "reports", reports],
            "pattern": "crypto_scan_*.md",
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


def build_cache_payload() -> dict[str, Any]:
    state_dir = TRADING_ROOT / "automation" / "state"
    watchlist_path = APPDATA / "Telecodex" / "trading-watchlist.json"
    headline_events_path = state_dir / "trading-news-headlines.jsonl"
    watchlist = read_json(watchlist_path, {"items": [], "removed": []})
    market = read_json(state_dir / "market-mover-briefing-latest.json", {})
    reddit = read_json(state_dir / "reddit-stock-trends-latest.json", {"items": []})
    news_risk = read_json(state_dir / "trading-news-risk.json", {})
    social_leads = read_json(state_dir / "trading-social-leads.json", {"items": []})
    scan_context_path = latest_file(
        [
            HOME / ".codex" / "automations" / "trading_scan_context" / "data",
            state_dir,
        ],
        "scan_context_*.json",
    )
    scan_context = read_json(scan_context_path, {}) if scan_context_path else {}

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
        },
        "watchlist": watchlist,
        "market": market,
        "reddit": reddit,
        "news_risk": news_risk,
        "news_headline_events": headline_events,
        "social_leads": social_leads,
        "scan_context": scan_context,
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
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), CacheDashboardHandler)
    print(f"IC Investing cache dashboard: http://{args.host}:{args.port}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
