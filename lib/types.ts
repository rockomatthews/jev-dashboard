// Shape of the snapshot the jev-agent runner publishes (jev_agent/perf.py, schema 1).

export type CoinPnl = {
  coin: string;
  realized: number;
  unrealized: number;
  fees: number;
  net: number;
  trades: number;
  wins: number;
  volume_usd: number;
};

export type OpenPosition = {
  coin: string;
  side: "long" | "short";
  size: number;
  entry: number;
  mark: number;
  notional: number;
  unrealized: number;
  unrealized_pct: number;
};

export type Fill = {
  ts: number;
  coin: string;
  side: "buy" | "sell";
  size: number;
  px: number;
  fee: number;
  reason: string;
};

export type ClosedTrade = {
  coin: string;
  side: "long" | "short";
  open_ts: number;
  close_ts: number | null;
  realized: number;
  fees: number;
  pnl: number;
};

export type Performance = {
  schema: 1;
  updated_ms: number;
  start_balance: number;
  equity: number;
  cash: number;
  pnl: number;
  pnl_pct: number;
  realized: number;
  unrealized: number;
  fees: number;
  funding: number;
  max_drawdown: number;
  current_drawdown: number;
  equity_peak: number;
  trades: {
    closed: number;
    wins: number;
    losses: number;
    win_rate: number | null;
    avg_win: number | null;
    avg_loss: number | null;
    profit_factor: number | null;
    best: number | null;
    worst: number | null;
    open: number;
  };
  per_coin: CoinPnl[];
  positions: OpenPosition[];
  curve: [number, number][];
  daily: { day: string; pnl: number; equity: number }[];
  recent_fills: Fill[];
  recent_trades: ClosedTrade[];
  readiness?: {
    ready: boolean;
    passed: number;
    total: number;
    strategy: string;
    checks: { key: string; label: string; threshold: string; pass: boolean; display: string }[];
  };
  status: {
    step?: number;
    decider?: string;
    targets?: Record<string, number>;
    kill?: boolean;
    jev?: string;
    coins?: string[];
    mode?: string;
    venue?: string;
    prices?: Record<string, number>;
  };
};

export type PerfResponse = {
  source: "live" | "demo";
  received_ms: number | null;
  perf: Performance;
};

export function isPerformance(x: unknown): x is Performance {
  if (!x || typeof x !== "object") return false;
  const p = x as Record<string, unknown>;
  return (
    p.schema === 1 &&
    typeof p.updated_ms === "number" &&
    typeof p.start_balance === "number" &&
    typeof p.equity === "number" &&
    Array.isArray(p.curve) &&
    Array.isArray(p.per_coin) &&
    typeof p.trades === "object"
  );
}
