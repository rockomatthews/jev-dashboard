import { NextResponse } from "next/server";

// Live price + the last 24 h of hourly closes for one coin, for Heat Check and Hot Potato (public pages under /public).
// Sources, first that answers: Coinbase's public candles, Hyperliquid's public candles, then CoinGecko (its free API
// rate-limits shared server IPs, so it is the last resort). All cached on the server for about a minute.
export const runtime = "nodejs";

const UA = { "user-agent": "jev-dashboard/1.0 (+heat-check)", accept: "application/json" };
const HOUR = 3_600_000;

type Series = { closes: number[]; last: number; at: number; source: string };

async function coinbase(sym: string): Promise<Series | null> {
  const r = await fetch(`https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=3600`,
    { headers: UA, next: { revalidate: 60 } });
  if (!r.ok) return null;
  const rows = (await r.json()) as number[][];                 // [time s, low, high, open, close, volume], newest first
  if (!Array.isArray(rows) || rows.length < 6) return null;
  const asc = rows.slice(0, 26).reverse();
  const closes = asc.map((x) => x[4]).filter((x) => x > 0);
  return closes.length >= 6 ? { closes, last: closes[closes.length - 1], at: asc[asc.length - 1][0] * 1000, source: "Coinbase" } : null;
}

async function hlCandles(coin: string): Promise<number[][] | null> {
  const now = Date.now();
  const r = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST", headers: { ...UA, "content-type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval: "1h", startTime: now - 26 * HOUR, endTime: now } }),
  });
  if (!r.ok) return null;
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length < 6) return null;
  return rows.map((x: { t: number; c: string }) => [x.t, parseFloat(x.c)]);
}

async function hyperliquid(sym: string): Promise<Series | null> {
  for (const [coin, scale] of [[sym, 1], [`k${sym}`, 1000]] as [string, number][]) {
    const rows = await hlCandles(coin);
    if (rows) {
      const closes = rows.map((x) => x[1] / scale).filter((x) => x > 0);
      if (closes.length >= 6) return { closes, last: closes[closes.length - 1], at: rows[rows.length - 1][0], source: "Hyperliquid" };
    }
  }
  return null;
}

async function coingecko(sym: string, id: string): Promise<(Series & { id: string; name: string; symbol: string }) | null> {
  const cg = async (path: string, revalidate: number) => {
    const r = await fetch("https://api.coingecko.com/api/v3" + path, { headers: UA, next: { revalidate } });
    return r.ok ? r.json() : null;
  };
  let name = "", symbol = sym;
  if (!id) {
    const d = await cg(`/search?query=${encodeURIComponent(sym)}`, 86_400);
    const hits = ((d?.coins || []) as { id: string; name: string; symbol: string; market_cap_rank?: number | null }[])
      .filter((c) => (c.symbol || "").toUpperCase() === sym)
      .sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9));
    if (!hits.length) return null;
    id = hits[0].id; name = hits[0].name; symbol = hits[0].symbol.toUpperCase();
  }
  const chart = await cg(`/coins/${id}/market_chart?vs_currency=usd&days=1`, 120);
  const pts: [number, number][] = (chart?.prices || []).filter((p: [number, number]) => p && p[1] > 0);
  if (pts.length < 6) return null;
  const byHour = new Map<number, number>();
  for (const [t, p] of pts) byHour.set(Math.floor(t / HOUR), p);
  const closes = [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p).slice(-25);
  const last = pts[pts.length - 1];
  if (closes[closes.length - 1] !== last[1]) closes.push(last[1]);
  return { id, name, symbol, closes, last: last[1], at: last[0], source: "CoinGecko" };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sym = (url.searchParams.get("sym") || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 15).toUpperCase();
  const id = (url.searchParams.get("id") || "").replace(/[^a-z0-9-]/g, "").slice(0, 80);
  if (!sym && !id) return NextResponse.json({ error: "Give a ticker, e.g. ?sym=SOL" }, { status: 400 });
  try {
    let s: (Series & { id?: string; name?: string; symbol?: string }) | null = null;
    if (sym) s = (await coinbase(sym).catch(() => null)) || (await hyperliquid(sym).catch(() => null));
    if (!s) s = await coingecko(sym, id).catch(() => null);
    if (!s) {
      return NextResponse.json({ error: sym ? `No hourly prices for ${sym} right now. Check the ticker.` : "No hourly prices for that coin right now." },
        { status: 404 });
    }
    return NextResponse.json({ id: s.id || id || sym.toLowerCase(), name: s.name || sym, symbol: s.symbol || sym, closes: s.closes,
      last: s.last, at: s.at, source: s.source }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Price source failed" }, { status: 502 });
  }
}
