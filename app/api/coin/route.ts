import { NextResponse } from "next/server";

// Live price + the last 24 h of hourly closes for one coin, for Heat Check and Hot Potato (public pages under /public).
// Source: CoinGecko's free public API, cached on the server so many viewers cost a handful of upstream calls.
export const runtime = "nodejs";

const CG = "https://api.coingecko.com/api/v3";
const HEADERS = { accept: "application/json", "user-agent": "jev-dashboard/1.0 (+heat-check)" };

type Hit = { id: string; name: string; symbol: string; market_cap_rank?: number | null };

async function cg(path: string, revalidate: number) {
  const r = await fetch(CG + path, { headers: HEADERS, next: { revalidate } });
  if (r.status === 429) throw Object.assign(new Error("CoinGecko is busy, try again in a minute"), { status: 503 });
  if (!r.ok) throw Object.assign(new Error(`CoinGecko answered ${r.status}`), { status: 502 });
  return r.json();
}

async function resolve(sym: string): Promise<Hit | null> {
  const d = await cg(`/search?query=${encodeURIComponent(sym)}`, 86_400);
  const want = sym.toUpperCase();
  const hits: Hit[] = (d.coins || []).filter((c: Hit) => (c.symbol || "").toUpperCase() === want);
  hits.sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9));
  return hits[0] || null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sym = (url.searchParams.get("sym") || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 15);
  let id = (url.searchParams.get("id") || "").replace(/[^a-z0-9-]/g, "").slice(0, 80);
  try {
    let name = "", symbol = sym.toUpperCase();
    if (!id) {
      if (!sym) return NextResponse.json({ error: "Give a ticker, e.g. ?sym=SOL" }, { status: 400 });
      const hit = await resolve(sym);
      if (!hit) return NextResponse.json({ error: `No coin with the ticker ${symbol}` }, { status: 404 });
      id = hit.id; name = hit.name; symbol = hit.symbol.toUpperCase();
    }
    const chart = await cg(`/coins/${id}/market_chart?vs_currency=usd&days=1`, 120);
    const pts: [number, number][] = (chart.prices || []).filter((p: [number, number]) => p && p[1] > 0);
    if (pts.length < 6) return NextResponse.json({ error: `No recent prices for ${symbol || id}` }, { status: 404 });
    // one close per hour (the last point in each hour), then the live last price
    const byHour = new Map<number, number>();
    for (const [t, p] of pts) byHour.set(Math.floor(t / 3_600_000), p);
    const closes = [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p).slice(-25);
    const last = pts[pts.length - 1];
    if (closes[closes.length - 1] !== last[1]) closes.push(last[1]);
    return NextResponse.json({ id, name, symbol, closes, last: last[1], at: last[0] },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message || "Price source failed" }, { status: err.status || 502 });
  }
}
