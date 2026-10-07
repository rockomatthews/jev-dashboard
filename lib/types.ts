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
    max_drawdown: number; max_daily_loss: number; reentry_block_h: number; max_liq_frac?: number; manage_interval_s?: number; note?: string;
  };
};

// Strategy 12: Metadata Movers (same engine and payload shape as the sniper, mode "meta")
export type MetaRadarItem = RadarItem & {
  mc: number;
  chain: string | null;
  has_desc: boolean;
  website: string;
  twitter: string;
  description?: string;
};

export type MetaHolding = SniperHolding & {
  chain?: string;
  entry_mc?: number;
  last_mc?: number;
  peak_mc?: number;
  buys5?: number;
  sells5?: number;
  trail_armed?: boolean;
  trail_pct?: number | null;
  trail_exit_px?: number | null;
  url?: string | null;
  website?: string;
  twitter?: string;
};

export type MetaInfo = {
  mode: "meta";
  radar: MetaRadarItem[];
  scanned_total: number;
  last_scan_ms: number;
  kill_reason: string;
  last_error?: string;
  deployed?: number;
  holdings: MetaHolding[];
  config: {
    start_balance: number; chain: string; chains: string[];
    max_entry_mc: number; min_mc: number; max_age_h: number; min_liquidity: number; min_h1_volume: number;
    min_score: number; target_mc: number; stop_loss: number; rug_liquidity_drop: number; max_hold_h: number;
    position_frac: number; max_liq_frac: number; max_open: number; dex_fee: number; priority_fee_usd: number;
    latency_slip: number; max_drawdown: number; max_daily_loss: number; reentry_block_h: number;
    manage_interval_s: number; note?: string;
    trail_arm?: number; trail_start?: number; trail_step?: number; trail_min?: number; trail_tight?: number;
    fade_min_gain?: number; fade_buy_ratio?: number; fade_drop?: number;
  };
};

export type TerrainScene = {
  kind: "terrain";
  title?: string;
  x_label?: string;
  z_label?: string;
  y_label?: string;
  x: string[];
  z: string[];
  y: (number | null)[][];
  glow?: number[][];
  glow_label?: string;
  ref_plane?: number | null;
  ref_label?: string;
  enter_line?: number | null;
  // live beacons: one reading per coin; live_key names the field to plot (default "apr")
  live?: Record<string, { held: boolean; apr?: number | null; [k: string]: number | string | boolean | null | undefined }>;
  live_key?: string;
};

export type KalshiMarket = {
  ticker: string; title: string; event?: string | null; bid: number; ask: number; vol24: number; hours_to_close: number;
  bids: [number, number][]; asks: [number, number][]; stage: "idle" | "bidding" | "holding";
  our_bid: number | null; our_ask: number | null; held: number; entry: number | null; mid?: number | null;
};

export type KalshiTrip = {
  ticker: string; title: string; qty: number; entry: number; exit: number; t_open: number; t_close: number;
  hold_s: number; how: "maker" | "taker"; pnl: number;
};

export type KalshiInfo = {
  markets: KalshiMarket[];
  round_trips: KalshiTrip[];
  summary: {
    round_trips: number; wins: number; win_rate: number | null; contracts: number; pnl: number;
    pnl_per_contract_c: number | null; avg_hold_s: number | null; maker_exit_share: number | null;
    quotes: number; entry_fills: number; maker_exits: number; taker_exits: number; cancels: number;
  };
  control: { n: number; contracts: number; pnl: number; pnl_per_contract_c: number | null };
  config: Record<string, number>;
  kill_reason: string; last_error: string; last_step_ms: number; source: string; source_url: string;
};

export type ChannelLane = {
  coin: string;
  close: (number | null)[];
  upper20: (number | null)[];
  lower20: (number | null)[];
  upper90: (number | null)[];
  lower90: (number | null)[];
  lights: number[];
  signal: number;
  weight: number;
  events: { i: number; L: number; kind: "entry" | "exit" }[];
};

export type ChannelScene = {
  kind: "channels";
  title?: string;
  lookbacks: number[];
  days: number;
  last_day: string | null;
  scale: number;
  book_vol_pct: number;
  gross: number;
  target_vol_pct: number;
  gross_cap: number;
  lanes: ChannelLane[];
  held?: Record<string, number>;
};

export type RiderScene = {
  kind: "rider";
  title?: string;
  subtitle?: string;
  x: string[];                 // coins
  z: string[];                 // time steps (oldest first), "YYYY-MM-DDTHH"
  y: (number | null)[][];      // [step][coin] 7-day risk-adjusted momentum score
  y_label?: string;
  path: (string | null)[];     // coin ridden at each step (null = cash)
  equity?: number[];           // book equity (1 = start of the window) at each step
  dev_score?: Record<string, number>;
  chain?: Record<string, "solana" | "base" | "robinhood">;
  generated?: string;
  live?: Record<string, { held: boolean; score?: number | null; [k: string]: number | string | boolean | null | undefined }>;
  live_key?: string;
  live_ride?: { coin?: string; entry_px?: number; peak?: number; stop?: number } | null;
};

export type JumpEvent = { i: number; j: number; z: number; jump_pct: number; drift_pct: number[] };

export type JumpScene = {
  kind: "jumps";
  title?: string;
  x: string[];                 // altcoins (most jumps in the last 2 years first)
  z: string[];                 // days, oldest first
  y: (number | null)[][];      // [day][coin] BTC-residual move in sigmas
  held: number[][];            // [day][coin] 1 = held over the next day
  events: JumpEvent[];         // jumps above the threshold and the coin's residual drift after them
  y_label?: string;
  threshold: number;
  hold_days: number;
  avg_drift_pct?: number | null;
  hit_rate_pct?: number | null;
  live?: Record<string, { held: boolean; z?: number | null; days_left?: number; [k: string]: number | string | boolean | null | undefined }>;
  live_key?: string;
  live_btc_hedge?: number | null;
};

export type SpotlightEvent = { i: number; j: number; av: number; day_ret_pct: number; drift_pct: number[] };

export type SpotlightScene = {
  kind: "spotlight";
  title?: string;
  x: string[];                 // altcoins (most spotlight days in the last year first)
  z: string[];                 // days, oldest first
  y: (number | null)[][];      // [day][coin] log2(dollar volume / prior-30-day average)
  held: number[][];            // [day][coin] 1 = held over the next day
  events: SpotlightEvent[];    // spotlight days and the coin's move vs BTC over the hold
  y_label?: string;
  threshold: number;           // abnormal-volume multiple (2 = twice normal)
  hold_days: number;
  avg_drift_pct?: number | null;
  hit_rate_pct?: number | null;
  live?: Record<string, { held: boolean; av?: number | null; days_left?: number; [k: string]: number | string | boolean | null | undefined }>;
  live_key?: string;
  live_btc_hedge?: number | null;
};

export type IdeaScene = TerrainScene | ChannelScene | RiderScene | JumpScene | SpotlightScene;

export type IdeaInfo = {
  slug: string;
  n: number;
  date: string;
  name: string;
  blurb?: string;
  venue?: string;
  source: string;
  source_url?: string;
  rule: string;
  status?: string;
  max_drawdown?: number;
  backtest?: Record<string, unknown> & {
    period?: string; sharpe?: number; ci95?: [number, number]; ret_yr_pct?: number; max_dd_pct?: number;
    walk_forward_sharpe?: number; walk_forward_ret_yr_pct?: number; placebo_p?: number;
    by_year_ret_pct?: Record<string, number>; stress_basis_30bp_sharpe?: number; caveat?: string;
  };
  kill_reason?: string;
  last_error?: string;
  last_rebalance_day?: string;
  state?: { scores_apr_pct?: Record<string, number>; held?: string[]; signal?: Record<string, number>; weights?: Record<string, number>; scale?: number; gross?: number } & Record<string, unknown>;
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
  kalshi?: KalshiInfo;
  ideas?: { date: string; name: string; source: string; rule: string; status: string; verdict: string; sharpe?: number | null }[];
  strategies?: { sniper?: Performance; kalshi?: Performance; metasniper?: Performance } & { [key: `idea:${string}`]: Performance | undefined };
  idea?: IdeaInfo;
  scene?: IdeaScene | null;
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
