import { NextResponse } from "next/server";

// Fallback for Hot Potato's live prices when the browser can't hold Hyperliquid's WebSocket open: every coin's mid
// price, cached 2 seconds so any number of viewers costs one upstream call every 2 s.
export const runtime = "nodejs";

export async function GET() {
  try {
    const r = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST", headers: { "content-type": "application/json", "user-agent": "jev-dashboard/1.0 (+hot-potato)" },
      body: JSON.stringify({ type: "allMids" }), next: { revalidate: 2 },
    });
    if (!r.ok) throw new Error(`Hyperliquid answered ${r.status}`);
    return NextResponse.json({ mids: await r.json(), at: Date.now() }, { headers: { "Cache-Control": "public, s-maxage=2" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
