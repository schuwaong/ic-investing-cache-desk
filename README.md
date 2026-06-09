# IC Investing Cache Desk

Local read-only dashboard for the trading bot cache.

It shows the active watchlist, removed setups, market movers, index pulse,
Yahoo trending symbols, Reddit/social mention trends, news risk state, social
leads, debate candidates, content ideas, source freshness, headline event logs,
and latest Markdown report previews.

## Run

```powershell
cd C:\Users\user\OneDrive\Desktop\Projects\trading\cache-dashboard
python server.py --port 8787
```

Open:

```text
http://127.0.0.1:8787
```

## GitHub Pages

The hosted version uses `cache-snapshot.json`, which is a static export of the
latest local cache. Run the local server and re-export that file before pushing
when you want the public dashboard refreshed.

## Reads

- `%APPDATA%\Telecodex\trading-watchlist.json`
- `automation\state\market-mover-briefing-latest.json`
- `automation\state\reddit-stock-trends-latest.json`
- `automation\state\trading-news-risk.json`
- `automation\state\trading-news-headlines.jsonl`
- `automation\state\trading-social-leads.json`
- latest scan-context JSON and Markdown report caches under `.codex\automations`

The server does not place trades, write bot state, or call Telegram.
