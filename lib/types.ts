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

export type RadarStatus = "held" | "candidate" | "watch" | "rejected" | "cooldown";

export type RadarItem = {
  symbol: string;
  token: string;
  pair: string | null;
  dex: string | null;
  url: string | null;
  price: number;
  liquidity: number;
  fdv: number;
  age_min: number | null;
  buys5: number;
  sells5: number;
  buy_ratio: number;
  vol5: number;
  turnover5: number;
  chg5: number;
  chg1h: number;
  score: number;
  status: RadarStatus;
  why: string;
};

export type SniperHolding = {
  key: string;
  token: string;
  pair: string;
  symbol: string;
  qty: number;
  entry_px: number;
  cost_usd: number;
  opened_ms: number;
  peak_px: number;
  entry_liquidity: number;
  took_partial: boolean;
  last_px: number;
  last_liquidity: number;
  ret: number;
};

export type SniperInfo = {
  radar: RadarItem[];
  scanned_total: number;
  last_scan_ms: number;
  kill_reason: string;
  last_error?: string;
  deployed?: number;
  holdings: SniperHolding[];
  config: {
    start_balance: number; chain: string;
    min_age_min: number; max_age_min: number; min_liquidity: number; max_liquidity: number; max_fdv: number;
    min_m5_volume: number; max_m5_change: number; min_score: number;
    position_frac: number; max_open: number;
    stop_loss: number; take_profit_1: number; trail_after: number; trail_pct: number; max_hold_min: number;
    rug_liquidity_drop: number; dex_fee: number; priority_fee_usd: number; latency_slip: number;
    max_drawdown: number; max_daily_loss: number; reentry_block_h: number;
  };
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
  risk_limits?: { max_drawdown: number; max_daily_loss: number; max_position_frac: number; max_gross_frac: number; vol_target: number | null };
  research?: {
    study?: {
      verdict: string; interval: string; coins: string[]; from: string; to: string; configs: number;
      strategies: { name: string; sharpe: number; ci: [number, number]; p: number | null; cagr: number; mdd: number; oos_from: string; oos_to: string; pass: boolean }[];
    };
    risk_scaling?: { vol_target: number; cagr: number; vol: number; sharpe: number; mdd: number; worst_day: number; gross_max: number }[];
    risk_scaling_note?: string;
    new_strategy?: { name: string; source: string; rule: string; period: string; sharpe: number; ci: [number, number]; cagr: number; mdd: number; p: number | null; verdict: string };
    replication?: { universe: string; sharpe: number; ci: [number, number]; p: number | null; mdd: number; buyhold_sharpe: number; buyhold_mdd: number };
  };
  sniper?: SniperInfo;
  strategies?: { sniper?: Performance };
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
  source: "live" | "snapshot" | "demo";
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
