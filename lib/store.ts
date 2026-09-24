import { Redis } from "@upstash/redis";
import demo from "./demo-perf.json";
import type { Performance, PerfResponse } from "./types";

const KEY = "jev:perf:latest";

function redis(): Redis | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

type Stored = { received_ms: number; perf: Performance };

export async function savePerformance(perf: Performance): Promise<void> {
  const r = redis();
  if (!r) throw new Error("Redis is not configured (connect Upstash Redis in the Vercel Storage tab)");
  const value: Stored = { received_ms: Date.now(), perf };
  await r.set(KEY, value);
}

/** Latest live snapshot, or the bundled demo when nothing has been published yet. */
export async function loadPerformance(): Promise<PerfResponse> {
  const r = redis();
  if (r) {
    try {
      const stored = await r.get<Stored>(KEY);
      if (stored?.perf) return { source: "live", received_ms: stored.received_ms, perf: stored.perf };
    } catch (err) {
      console.error("redis read failed", err);
    }
  }
  return { source: "demo", received_ms: null, perf: demo as unknown as Performance };
}
