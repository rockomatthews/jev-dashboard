import { NextResponse } from "next/server";

// "Hot" coins for Hot Potato: CoinGecko's trending list plus the day's biggest gainers among the 250 most traded
// coins (at least $1M of volume, up on the day, stablecoins left out). Cached 5 minutes on the server.
export const runtime = "nodejs";

const CG = "https://api.coingecko.com/api/v3";
const HEADERS = { accept: "application/json", "user-agent": "jev-dashboard/1.0 (+hot-potato)" };

type Hot = { id: string; symbol: string; name: string; price: number; ch24: number; volume: number; rank: number | null; why: string };

export async function GET() {
  const out = new Map<string, Hot>();
  const errors: string[] = [];
  try {
    const r = await fetch(`${CG}/search/trending`, { headers: HEADERS, next: { revalidate: 300 } });
    if (!r.ok) throw new Error(`trending ${r.status}`);
    const d = await r.json();
    for (const { item } of d.coins || []) {
      const ch = Number(item?.data?.price_change_percentage_24h?.usd);
      const price = Number(item?.data?.price);
      const vol = Number(String(item?.data?.total_volume || "").replace(/[$,]/g, ""));
      if (item?.id && ch > 0 && price > 0) out.set(item.id, { id: item.id, symbol: String(item.symbol).toUpperCase(), name: item.name,
        price, ch24: ch, volume: isFinite(vol) ? vol : 0, rank: item.market_cap_rank ?? null, why: "trending on CoinGecko" });
    }
  } catch (e) { errors.push((e as Error).message); }
  try {
    const r = await fetch(`${CG}/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&price_change_percentage=24h`,
      { headers: HEADERS, next: { revalidate: 300 } });
    if (!r.ok) throw new Error(`markets ${r.status}`);
    const rows = await r.json();
    const gainers = (rows as any[])
      .filter((c) => c.total_volume >= 1_000_000 && c.price_change_percentage_24h > 3 && !(Math.abs(c.current_price - 1) < 0.02))
      .sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h).slice(0, 30);
    for (const c of gainers) if (!out.has(c.id)) out.set(c.id, { id: c.id, symbol: String(c.symbol).toUpperCase(), name: c.name,
      price: c.current_price, ch24: c.price_change_percentage_24h, volume: c.total_volume, rank: c.market_cap_rank ?? null,
      why: "top 24 h gainer among the most traded coins" });
  } catch (e) { errors.push((e as Error).message); }
  if (out.size < 5) {
    // CoinGecko rate-limited this server: fall back to Hyperliquid's own list (24 h gainers with real volume)
    try {
      const r = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { ...HEADERS, "content-type": "application/json" },
        cache: "no-store", body: JSON.stringify({ type: "metaAndAssetCtxs" }) });
      const [meta, ctxs] = await r.json();
      (meta.universe as { name: string; isDelisted?: boolean }[]).forEach((a, i) => {
        const c = ctxs[i] || {}, px = parseFloat(c.midPx || c.markPx), prev = parseFloat(c.prevDayPx), vol = parseFloat(c.dayNtlVlm);
        if (a.isDelisted || !(px > 0) || !(prev > 0) || !(vol >= 5_000_000)) return;
        const ch = (px / prev - 1) * 100;
        if (ch <= 3) return;
        const sym = a.name.startsWith("k") && a.name.length > 2 && a.name[1] === a.name[1].toUpperCase() ? a.name.slice(1) : a.name;
        out.set(`hl-${a.name}`, { id: "", symbol: sym, name: sym, price: a.name !== sym ? px / 1000 : px, ch24: ch, volume: vol, rank: null,
          why: "top 24 h gainer on Hyperliquid" });
      });
    } catch (e) { errors.push(`hyperliquid ${(e as Error).message}`); }
  }
  const coins = [...out.values()];
  if (!coins.length) return NextResponse.json({ coins, error: errors.join("; ") || "No hot coins right now" }, { status: errors.length ? 502 : 200 });
  return NextResponse.json({ coins, errors }, { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } });
}
