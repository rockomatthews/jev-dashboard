import { NextResponse } from "next/server";
import { loadPerformance } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await loadPerformance();
  return NextResponse.json(data, {
    // CDN absorbs viewer traffic: at most ~3 Redis reads/min however many people watch.
    headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40" },
  });
}
