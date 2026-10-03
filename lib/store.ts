import demo from "./demo-perf.json";
import snapshot from "./snapshot.json";
import type { Performance, PerfResponse } from "./types";

// Live feed: the bot POSTs its performance snapshot to /api/ingest every minute; we keep the latest one in
// Supabase (table public.jev_perf, one row id='latest') and /api/perf serves it. Server-side only, with the
// service-role key, so the table needs no public policies. Setup SQL: supabase/jev_perf.sql.
// Without Supabase configured, the site falls back to lib/snapshot.json (committed by the bot every ~20 min).

const TABLE = "jev_perf";
const ROW = "latest";

type Stored = { received_ms: number; perf: Performance };

function supabase(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

function headers(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra };
}

export async function savePerformance(perf: Performance): Promise<void> {
  const sb = supabase();
  if (!sb) throw new Error("Supabase is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel)");
  const r = await fetch(`${sb.url}/rest/v1/${TABLE}?on_conflict=id`, {
    method: "POST",
    headers: headers(sb.key, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ id: ROW, received_ms: Date.now(), perf }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`supabase write ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

async function readLive(): Promise<Stored | null> {
  const sb = supabase();
  if (!sb) return null;
  try {
    const r = await fetch(`${sb.url}/rest/v1/${TABLE}?id=eq.${ROW}&select=received_ms,perf`, {
      headers: headers(sb.key), cache: "no-store",
    });
    if (!r.ok) {
      console.error("supabase read failed", r.status, (await r.text()).slice(0, 200));
      return null;
    }
    const rows = (await r.json()) as Stored[];
    return rows[0]?.perf ? rows[0] : null;
  } catch (err) {
    console.error("supabase read failed", err);
    return null;
  }
}

/** Latest live snapshot (Supabase), else the newer of it and the committed snapshot, else the demo. */
export async function loadPerformance(): Promise<PerfResponse> {
  const snap = snapshot as unknown as Performance;
  const haveSnap = snap?.schema === 1;
  const live = await readLive();
  // use the live row unless the committed snapshot is newer (e.g. the feed stopped)
  if (live && (!haveSnap || live.perf.updated_ms >= snap.updated_ms)) {
    return { source: "live", received_ms: live.received_ms, perf: live.perf };
  }
  if (haveSnap) return { source: "snapshot", received_ms: snap.updated_ms, perf: snap };
  return { source: "demo", received_ms: null, perf: demo as unknown as Performance };
}
