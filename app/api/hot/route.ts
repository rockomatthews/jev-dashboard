import { NextResponse } from "next/server";

// "Hot" coins for Hot Potato: the day's strongest Hyperliquid coins with real volume (everything up 2%+, at least the
// top 20), so every coin tossed can be priced live from Hyperliquid's mid-price stream. Coins also trending on
// CoinGecko are tagged and go first.
// Cached about 2 minutes on the server.
export const runtime = "nodejs";

const UA = { accept: "application/json", "user-agent": "jev-dashboard/1.0 (+hot-potato)" };

type Hot = { hl: string; symbol: string; scale: number; price: number; ch24: number; volume: number; why: string; trending: boolean };

export async function GET() {
  try {
    const r = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST", headers: { ...UA, "content-type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    });
    if (!r.ok) throw new Error(`Hyperliquid answered ${r.status}`);
    const [meta, ctxs] = await r.json();

    let trending = new Set<string>();
    try {
      const t = await fetch("https://api.coingecko.com/api/v3/search/trending", { headers: UA, next: { revalidate: 300 } });
      if (t.ok) trending = new Set(((await t.json()).coins || []).map((c: { item: { symbol: string } }) => String(c.item.symbol).toUpperCase()));
    } catch { /* trending is only a tag */ }

    const coins: Hot[] = [];
    (meta.universe as { name: string; isDelisted?: boolean }[]).forEach((a, i) => {
      const c = ctxs[i] || {};
      const px = parseFloat(c.midPx || c.markPx), prev = parseFloat(c.prevDayPx), vol = parseFloat(c.dayNtlVlm);
      if (a.isDelisted || !(px > 0) || !(prev > 0) || !(vol >= 3_000_000)) return;
      const ch = (px / prev - 1) * 100;
      const kilo = /^k[A-Z0-9]/.test(a.name);                 // kPEPE, kBONK...: priced per 1,000 tokens
      const symbol = kilo ? a.name.slice(1) : a.name;
      const isTrending = trending.has(symbol);
      coins.push({ hl: a.name, symbol, scale: kilo ? 1000 : 1, price: kilo ? px / 1000 : px, ch24: ch, volume: vol,
        why: isTrending ? "trending on CoinGecko and up on Hyperliquid" : "a top 24 h gainer on Hyperliquid", trending: isTrending });
    });
    // the day's best performers: everything up 2%+, topped up to at least 20 coins with the next strongest, and
    // CoinGecko-trending coins that are up at all
    coins.sort((a, b) => b.ch24 - a.ch24);
    const pick = coins.filter((c, i) => c.ch24 > 2 || i < 20 || (c.trending && c.ch24 > 0)).slice(0, 40);
    for (const c of pick) if (c.ch24 <= 2 && !c.trending) c.why = "one of the day's 20 strongest coins on Hyperliquid";
    pick.sort((a, b) => Number(b.trending) - Number(a.trending) || b.ch24 - a.ch24);
    return NextResponse.json({ coins: pick, at: Date.now() },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } });
  } catch (e) {
    return NextResponse.json({ coins: [], error: (e as Error).message || "No hot coins right now" }, { status: 502 });
  }
}
