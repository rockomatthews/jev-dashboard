import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { savePerformance } from "@/lib/store";
import { isPerformance } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 512 * 1024;

function authorized(header: string | null): boolean {
  const secret = process.env.INGEST_SECRET;
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const text = await req.text();
  if (text.length > MAX_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!isPerformance(body)) {
    return NextResponse.json({ error: "not a schema-1 performance snapshot" }, { status: 422 });
  }
  try {
    await savePerformance(body);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
