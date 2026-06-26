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
from math import ceil, floor
from typing import Any


APP_DIR = Path(__file__).resolve().parent
TRADING_ROOT = APP_DIR.parent
HOME = Path.home()
APPDATA = Path(os.environ.get("APPDATA", HOME / "AppData" / "Roaming"))
PIPELINE_ROOT = Path(os.environ.get("TRADING_PIPELINE_ROOT", HOME / ".codex" / "automations" / "trading_pipeline"))
AVOID_STATUSES = {"avoid", "avoid_chase", "committee_blocked"}
SYMBOL_ALIASES = {
    "GOOG": {"GOOG", "GOOGL"},
    "GOOGL": {"GOOG", "GOOGL"},
}


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
            "key": "options",
            "label": "Options / Volatility Scan",
            "paths": [pipeline_reports, reports],
            "pattern": "options_*.md",
        },
        {
            "key": "cache_audit",
            "label": "Cache Audit",
            "paths": [pipeline_reports, reports],
            "pattern": "cache-audit_*.md",
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


def normalize_symbol(value: Any) -> str:
    text = str(value or "").strip().upper()
    if "." in text:
        _, text = split_market_symbol(text)
    return "".join(ch for ch in text if ch.isalnum())


def symbol_keys(value: Any) -> set[str]:
    normalized = normalize_symbol(value)
    if not normalized:
        return set()
    return set(SYMBOL_ALIASES.get(normalized, {normalized}))


def parse_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text or text in {"--", "N/A", "n/a"}:
        return None
    text = text.removeprefix("+").removesuffix("%")
    try:
        return float(text)
    except ValueError:
        return None


def market_from_position(row: dict[str, Any]) -> str:
    symbol = str(row.get("Symbol") or row.get("symbol") or "").strip().upper()
    currency = str(row.get("Currency") or row.get("currency") or "").strip().upper()
    if symbol.isdigit() or currency == "HKD":
        return "HK"
    if currency == "USD":
        return "US"
    if currency == "SGD":
        return "SG"
    if currency == "MYR":
        return "MY"
    return ""


def price_step(value: float | None) -> float:
    number = float(value or 0)
    if number >= 500:
        return 5.0
    if number >= 200:
        return 2.0
    if number >= 100:
        return 1.0
    if number >= 25:
        return 0.5
    if number >= 10:
        return 0.2
    if number >= 1:
        return 0.1
    return 0.05


def round_to_step(value: float, step: float, direction: str) -> float:
    if step <= 0:
        return value
    scaled = value / step
    rounded = floor(scaled) if direction == "down" else ceil(scaled)
    return round(rounded * step, 4)


def format_price(value: float | None, currency: str = "") -> str:
    if value is None:
        return "n/a"
    number = float(value)
    step = price_step(number)
    decimals = 0
    if step < 1:
        decimals = 1 if step >= 0.1 else 2
    elif number < 100 and step <= 0.5:
        decimals = 1
    formatted = f"{number:.{decimals}f}"
    suffix = f" {currency}" if currency else ""
    return f"{formatted}{suffix}"


def format_band(low: float | None, high: float | None, currency: str = "") -> str:
    if low is None and high is None:
        return "n/a"
    if low is None:
        return format_price(high, currency)
    if high is None or abs(high - low) < 1e-9:
        return format_price(low, currency)
    step = min(price_step(low), price_step(high))
    decimals = 0
    if step < 1:
        decimals = 1 if step >= 0.1 else 2
    elif max(low, high) < 100 and step <= 0.5:
        decimals = 1
    low_text = f"{low:.{decimals}f}"
    high_text = f"{high:.{decimals}f}"
    suffix = f" {currency}" if currency else ""
    return f"{low_text}-{high_text}{suffix}"


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


def build_watchlist_lookup(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    buckets = payload.get("buckets") or {}
    for items in buckets.values():
        for item in as_list(items):
            if not isinstance(item, dict):
                continue
            keys = symbol_keys(item.get("code")) | symbol_keys(item.get("symbol"))
            for key in keys:
                lookup[key] = item
    return lookup


def sample_sell_band(position: dict[str, Any], watch_item: dict[str, Any] | None) -> str:
    current = parse_float(position.get("Current price"))
    currency = str(position.get("Currency") or "")
    if current is None:
        return "n/a"

    setup = watch_item.get("setup") if isinstance(watch_item, dict) else {}
    invalidation = parse_float((setup or {}).get("invalidation"))
    chase_above = parse_float((setup or {}).get("chase_above"))
    market = position.get("_market") or market_from_position(position)
    status = str((watch_item or {}).get("status") or "")

    low: float | None
    high: float | None
    if status in AVOID_STATUSES:
        invalidation_gap = ((invalidation - current) / current) if invalidation and current else None
        if invalidation_gap is not None and 0 < invalidation_gap <= 0.08:
            low = current * (1.02 if invalidation_gap > 0.03 else 1.01)
            high = invalidation
        else:
            low = current * 1.01
            high = current * (1.04 if market == "HK" else 1.05)
    elif status == "watch_pullback":
        if chase_above and chase_above > current:
            low = chase_above * 0.99
            high = chase_above
        else:
            low = current * 1.05
            high = current * 1.08
    else:
        low = current * (1.02 if market == "HK" else 1.03)
        high = current * (1.05 if market == "HK" else 1.06)

    step = price_step(current)
    low = round_to_step(low, step, "down")
    high = round_to_step(max(high, low), step, "up")
    return format_band(low, high, currency)


def sample_sell_discipline(position: dict[str, Any], watch_item: dict[str, Any] | None) -> str:
    current = parse_float(position.get("Current price"))
    currency = str(position.get("Currency") or "")
    avg_cost = parse_float(position.get("Average Cost"))
    setup = watch_item.get("setup") if isinstance(watch_item, dict) else {}
    invalidation = parse_float((setup or {}).get("invalidation"))
    chase_above = parse_float((setup or {}).get("chase_above"))
    status = str((watch_item or {}).get("status") or "")

    if status in AVOID_STATUSES:
        trim_zone = sample_sell_band(position, watch_item)
        if current and invalidation and current < invalidation:
            gap = (invalidation - current) / current if current else 0.0
            if gap <= 0.08:
                return f"Position is already below the watch invalidation ({format_price(invalidation, currency)}); treat {trim_zone} as the sample rebound-trim zone."
            return f"Position sits well below the preferred setup; use {trim_zone} as the sample trim-on-bounce zone instead of waiting for a full recovery."
        floor_level = invalidation or (current * 0.97 if current else None)
        return f"Sample trim into strength near {trim_zone}; recheck fast below {format_price(floor_level, currency)}."

    if status == "watch_pullback":
        sell_line = invalidation or avg_cost or (current * 0.94 if current else None)
        trim_line = chase_above or (current * 1.08 if current else None)
        return f"Hold for now; only trim above {format_price(trim_line, currency)} if reducing size. Thesis breaks below {format_price(sell_line, currency)}."

    review_line = avg_cost or (current * 0.95 if current else None)
    trim_line = current * 1.06 if current else None
    return f"Hold unless the thesis weakens; sample trim window {format_price(trim_line, currency)} and below-{format_price(review_line, currency)} is the review line."


def sample_portfolio_analysis(positions_rows: list[dict[str, Any]], watchlist_payload: dict[str, Any]) -> dict[str, Any]:
    if not positions_rows:
        return {
            "label": "Sample portfolio analysis",
            "mode": "sample_only",
            "updated_at": utc_now(),
            "disclaimer": "Educational sample only. Not financial advice or a live order signal.",
            "summary": {
                "positions_reviewed": 0,
                "trim_candidates": 0,
                "hold_review_names": 0,
            },
            "trim_candidates": [],
            "hold_review": [],
            "notes": [
                "No OpenD positions were available in this cache export.",
                "Run the latest portfolio export before publishing the sample portfolio analysis block.",
            ],
        }

    watch_lookup = build_watchlist_lookup(watchlist_payload if isinstance(watchlist_payload, dict) else {})
    parsed_positions: list[dict[str, Any]] = []
    for row in positions_rows:
        if not isinstance(row, dict):
            continue
        weight = parse_float(row.get("% of Portfolio"))
        current = parse_float(row.get("Current price"))
        pnl_pct = parse_float(row.get("% Unrealized P/L"))
        total_pl = parse_float(row.get("Total P/L"))
        market = market_from_position(row)
        keys = symbol_keys(row.get("Symbol")) | symbol_keys(row.get("symbol"))
        watch_item = next((watch_lookup[key] for key in keys if key in watch_lookup), None)
        parsed = dict(row)
        parsed["_weight"] = weight or 0.0
        parsed["_current"] = current
        parsed["_pnl_pct"] = pnl_pct
        parsed["_total_pl"] = total_pl
        parsed["_market"] = market
        parsed["_watch_item"] = watch_item
        parsed_positions.append(parsed)

    def trim_rank(row: dict[str, Any]) -> float:
        watch_item = row.get("_watch_item") or {}
        status = str(watch_item.get("status") or "")
        market = row.get("_market") or ""
        weight = float(row.get("_weight") or 0.0)
        pnl_pct = parse_float(row.get("_pnl_pct"))
        total_pl = parse_float(row.get("_total_pl"))
        score = 0.0
        if status in AVOID_STATUSES:
            score += 7.0
        if market == "HK":
            score += 1.5
        if weight >= 4:
            score += weight / 2
        if pnl_pct is not None and pnl_pct <= -10:
            score += 2.0
        if pnl_pct is not None and pnl_pct >= 20:
            score += 1.25
        if total_pl is not None and total_pl <= -1000:
            score += 1.0
        return score

    trim_pool = []
    for row in parsed_positions:
        watch_item = row.get("_watch_item") or {}
        status = str(watch_item.get("status") or "")
        market = row.get("_market") or ""
        weight = float(row.get("_weight") or 0.0)
        pnl_pct = parse_float(row.get("_pnl_pct"))
        include = (
            status in AVOID_STATUSES
            or (market == "HK" and pnl_pct is not None and pnl_pct <= -15)
            or (weight >= 8 and pnl_pct is not None and (pnl_pct >= 15 or pnl_pct <= -5))
        )
        if include:
            trim_pool.append(row)

    trim_candidates = []
    for priority, row in enumerate(sorted(trim_pool, key=trim_rank, reverse=True)[:6], start=1):
        watch_item = row.get("_watch_item") or {}
        status = str(watch_item.get("status") or "review")
        symbol = str(row.get("Symbol") or row.get("symbol") or "")
        name = str(row.get("Name") or row.get("name") or symbol)
        current = parse_float(row.get("Current price"))
        weight = float(row.get("_weight") or 0.0)
        reason = str(watch_item.get("reason") or "")
        thesis = str(((watch_item.get("setup") or {}).get("thesis")) or "")
        sample_action = "Trim into strength" if status in AVOID_STATUSES else "Reduce concentration on strength"
        trim_candidates.append(
            {
                "priority": priority,
                "symbol": symbol,
                "name": name,
                "market": row.get("_market") or "",
                "status": status,
                "last_price": format_price(current, str(row.get("Currency") or "")),
                "portfolio_weight_pct": round(weight, 2),
                "unrealized_pct": row.get("% Unrealized P/L"),
                "sample_action": sample_action,
                "sample_sell_band": sample_sell_band(row, watch_item),
                "when_to_sell": sample_sell_discipline(row, watch_item),
                "why": reason or thesis or "Position sits outside the strongest current setup window.",
            }
        )

    trimmed_symbols = {item["symbol"] for item in trim_candidates}
    hold_review = []
    for row in sorted(parsed_positions, key=lambda item: float(item.get("_weight") or 0.0), reverse=True):
        symbol = str(row.get("Symbol") or row.get("symbol") or "")
        if symbol in trimmed_symbols:
            continue
        watch_item = row.get("_watch_item") or {}
        status = str(watch_item.get("status") or "")
        weight = float(row.get("_weight") or 0.0)
        pnl_pct = parse_float(row.get("_pnl_pct"))
        include = status == "watch_pullback" or weight >= 6 or (pnl_pct is not None and pnl_pct >= 20)
        if not include:
            continue
        hold_review.append(
            {
                "symbol": symbol,
                "name": str(row.get("Name") or row.get("name") or symbol),
                "status": status or "hold_review",
                "last_price": format_price(parse_float(row.get("Current price")), str(row.get("Currency") or "")),
                "portfolio_weight_pct": round(weight, 2),
                "unrealized_pct": row.get("% Unrealized P/L"),
                "sample_action": "Hold for now",
                "sample_sell_band": sample_sell_band(row, watch_item),
                "when_to_sell": sample_sell_discipline(row, watch_item),
                "why": str(watch_item.get("reason") or ((watch_item.get("setup") or {}).get("thesis")) or "No active trim pressure from the latest watchlist gates."),
            }
        )
        if len(hold_review) >= 4:
            break

    trim_focus = "China/HK drawdown names and blocked US megacap setups"
    if not trim_candidates:
        trim_focus = "Concentration review only; no urgent trim bucket was generated."

    return {
        "label": "Sample portfolio analysis",
        "mode": "sample_only",
        "updated_at": utc_now(),
        "disclaimer": "Educational sample only. This is not financial advice, a recommendation, or a live order signal.",
        "summary": {
            "positions_reviewed": len(parsed_positions),
            "trim_candidates": len(trim_candidates),
            "hold_review_names": len(hold_review),
            "focus": trim_focus,
        },
        "trim_candidates": trim_candidates,
        "hold_review": hold_review,
        "notes": [
            "Built from the latest cached OpenD positions and current trading-pipeline watchlist gates.",
            "Sell timing is presented as a sample trim plan so the public site can show process without exposing full account detail.",
        ],
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
    news_feed_path = latest_file([pipeline_data_dir], "news_*.json")
    opend_positions_csv_path = pipeline_data_dir / "opend_positions_current.csv"
    opend_positions_json_path = pipeline_data_dir / "opend_positions_current.json"
    active_portfolio_path = pipeline_data_dir / "active_portfolio.csv"
    instagram = read_json(instagram_path, {"items": []}) if instagram_path else {"items": []}
    geopolitics = read_json(geopolitics_path, {"items": []}) if geopolitics_path else {"items": []}
    news_feed = read_json(news_feed_path, {"items": []}) if news_feed_path else {"items": []}
    opend_positions = read_csv_rows(opend_positions_csv_path if opend_positions_csv_path.exists() else active_portfolio_path)
    opend_metadata = read_json(opend_positions_json_path, {}) if opend_positions_json_path.exists() else {}
    portfolio_analysis = sample_portfolio_analysis(opend_positions, pipeline_watchlist if isinstance(pipeline_watchlist, dict) else {})

    active_watch = as_list(watchlist.get("items")) if isinstance(watchlist, dict) else []
    removed_watch = as_list(watchlist.get("removed")) if isinstance(watchlist, dict) else []
    market_movers = as_list(market.get("market_movers")) if isinstance(market, dict) else []
    headlines = as_list(market.get("headlines")) if isinstance(market, dict) else []
    headline_events = read_jsonl_tail(headline_events_path)
    index_pulse = as_list(market.get("index_pulse")) if isinstance(market, dict) else []
    reddit_items = as_list(reddit.get("items")) if isinstance(reddit, dict) else []
    leads = as_list(social_leads.get("items")) if isinstance(social_leads, dict) else []
    candidates = as_list(scan_context.get("candidates")) if isinstance(scan_context, dict) else []
    news_items = as_list(news_feed.get("items")) if isinstance(news_feed, dict) else []
    news_headlines = [
        {
            "title": item.get("title"),
            "published": item.get("published"),
            "description": item.get("summary") or item.get("source") or "",
            "link": item.get("link"),
            "source": "Futubull Financial News",
        }
        for item in news_items
        if isinstance(item, dict) and item.get("title")
    ]
    if isinstance(market, dict) and news_headlines:
        existing_headlines = as_list(market.get("headlines"))
        combined_headlines: list[dict[str, Any]] = []
        seen_headlines: set[tuple[str, str]] = set()
        for item in existing_headlines + news_headlines:
            if not isinstance(item, dict):
                continue
            key = (str(item.get("title") or ""), str(item.get("link") or ""))
            if key in seen_headlines:
                continue
            seen_headlines.add(key)
            combined_headlines.append(item)
        market["headlines"] = combined_headlines
        market["news_sources"] = ["Futubull Financial News"]

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
            "news_feed": file_info(news_feed_path),
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
            "news_items": len(news_items),
            "opend_positions": len(opend_positions),
            "portfolio_trim_candidates": len(as_list(portfolio_analysis.get("trim_candidates"))),
        },
        "watchlist": watchlist,
        "portfolio_analysis": portfolio_analysis,
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


def public_file_info(info: dict[str, Any] | None) -> dict[str, Any] | None:
    if not info:
        return None
    return {
        "name": info.get("name"),
        "size": info.get("size"),
        "modified_at": info.get("modified_at"),
    }


def redact_local_paths(value: Any) -> Any:
    if isinstance(value, list):
        return [redact_local_paths(item) for item in value]
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            lowered = str(key).lower()
            if lowered in {"path", "config_source"}:
                continue
            if lowered == "source_reports" and isinstance(item, dict):
                redacted[key] = {
                    report_key: Path(str(report_path)).name
                    for report_key, report_path in item.items()
                }
                continue
            redacted[key] = redact_local_paths(item)
        return redacted
    if isinstance(value, str) and ("/Users/" in value or "\\Users\\" in value):
        return Path(value).name
    return value


def public_cache_payload(payload: dict[str, Any]) -> dict[str, Any]:
    public = redact_local_paths(json.loads(json.dumps(payload)))
    public["workspace"] = "static GitHub Pages snapshot"
    public["files"] = {
        key: public_file_info(value)
        for key, value in (payload.get("files") or {}).items()
    }
    public["reports"] = [
        {
            "key": report.get("key"),
            "label": report.get("label"),
            "file": public_file_info(report.get("file")),
            "preview": "",
        }
        for report in payload.get("reports", [])
    ]
    if isinstance(public.get("content"), dict):
        public["content"]["opend"] = {
            "positions": [],
            "metadata": {
                "visibility": "redacted_public_snapshot",
                "note": "Raw OpenD rows are hidden in the public snapshot. Review the sample portfolio analysis block instead.",
            },
        }
    if isinstance(public.get("summary"), dict):
        public["summary"]["opend_positions"] = 0
    if isinstance(public.get("portfolio_analysis"), dict):
        public["portfolio_analysis"]["notes"] = as_list(public["portfolio_analysis"].get("notes")) + [
            "Public snapshot note: raw position rows, account identifiers, and funds metadata are intentionally hidden.",
        ]
    return public


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
    parser.add_argument(
        "--public-snapshot",
        action="store_true",
        help="Redact local paths and report previews from exported static snapshots.",
    )
    args = parser.parse_args()
    if args.export_snapshot:
        output = Path(args.export_snapshot)
        payload = build_cache_payload()
        if args.public_snapshot:
            payload = public_cache_payload(payload)
        output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Exported cache snapshot: {output}")
        return
    server = ThreadingHTTPServer((args.host, args.port), CacheDashboardHandler)
    print(f"IC Investing cache dashboard: http://{args.host}:{args.port}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
