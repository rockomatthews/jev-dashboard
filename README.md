# jev-dashboard

Live 3D performance & P&L dashboard for [jev-agent](../jev-agent) — Next.js 16 + React Three Fiber, hosted on Vercel.

- **3D scene:** the equity curve as a glowing ribbon against the $10,000 starting balance, and one pillar per coin for net P&L. Hover for detail, drag to orbit. `?fx=0` turns off bloom on weak GPUs.
- **Numbers:** equity, total / realized / unrealized P&L, fees + funding, max drawdown, win rate, profit factor, daily P&L, P&L by coin, open positions, recent trades and fills.
- **Live:** the bot pushes a snapshot every minute; the page polls every 30 s and shows LIVE / OFFLINE (no update for 5 min) / DEMO DATA (nothing published yet — a bundled simulated run).
- **Colors:** gain blue `#1b9bd0` / loss orange `#d96b25` — a colorblind-safe pair (validated), and every number also carries a +/− sign and ▲/▼.

## How data flows

```
jev-agent runner (your Mac, every minute)
  └─ POST /api/ingest   Authorization: Bearer $INGEST_SECRET   (~25 KB JSON)
        └─ Upstash Redis (key jev:perf:latest)
              └─ GET /api/perf  (CDN-cached 20 s)  ◄── the page polls every 30 s
```

About 1,440 writes/day plus at most ~3 reads/min however many people watch — well within
Upstash's free tier (check the current limits on their pricing page).

## Deploy (one time, ~5 minutes)

1. **Create the Vercel project** from this folder, either:
   - `cd ~/Code/jev-dashboard && npx vercel` (then `npx vercel --prod`), or
   - push it to GitHub and "Add New → Project" in Vercel.
2. **Add Redis:** Vercel project → **Storage** → **Create Database** → **Upstash for Redis** (free) → connect
   it to this project. That injects `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatically.
3. **Add the secret:** Project → Settings → Environment Variables → `INGEST_SECRET` = output of
   `openssl rand -hex 32`. Redeploy (Deployments → ⋯ → Redeploy) so it takes effect.
4. **Point the bot at it** — in `~/Code/jev-agent/.env`:
   ```
   DASHBOARD_URL=https://<your-project>.vercel.app
   DASHBOARD_INGEST_SECRET=<the same secret>
   ```
   then restart the runner:
   `launchctl kickstart -k gui/$(id -u)/com.projectorbach.jev-agent.runner`

Within a minute the badge flips from DEMO DATA to LIVE.

## Local dev

```bash
npm install
npm run dev          # http://localhost:3000 — shows DEMO DATA without Redis env vars
```

Test an ingest locally: set `INGEST_SECRET` + the Redis vars in `.env.local`, then
`curl -X POST localhost:3000/api/ingest -H "Authorization: Bearer $INGEST_SECRET" --data-binary @lib/demo-perf.json`.

## Files

| Path | What |
| --- | --- |
| `app/page.tsx` | Server-renders the latest snapshot, hands it to the client dashboard |
| `app/api/ingest/route.ts` | Authenticated write (constant-time secret check, schema validation, 512 KB cap) |
| `app/api/perf/route.ts` | Public read, CDN-cached |
| `components/Scene.tsx` | Three.js scene: equity ribbon, per-coin pillars, bloom, hover |
| `components/Dashboard.tsx` | Stats, daily bars, tables, polling, live/offline state |
| `lib/store.ts` | Upstash Redis read/write, demo fallback |
| `lib/demo-perf.json` | Simulated 5-day run shown until the bot reports |

The site is public and shows full detail (paper equity, positions, fills) by design.
