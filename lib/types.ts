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

export type RugGate = {
  counts: Record<string, number>;   // "passed" and one key per kill reason (authority_open, top10, ...)
  ticket_usd: number;
  max_open: number;
  rules: { max_risk_score: number; max_top10_pct: number; min_lp_locked_pct: number; max_insider_nets: number;
           stop_loss: number; take_half_at: number; max_impact: number };
};

export type MetaInfo = {
  mode: "meta" | "rug";
  gate?: RugGate;                   // Strategy 23 only
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

export type EchoBar = { t: number; m: number | null; z: number | null; side: number; pnl: number | null };

export type EchoScene = {
  kind: "echo";
  title?: string;
  bars: EchoBar[];             // last 60 days of 4h bars, oldest first (t = bar open, ms)
  thr: number;                 // |z| entry threshold
  lag_bars: number;            // 6 = the bar 24h earlier, rolling out of the 24h window
  lev?: number;
  y_label?: string;
  hit_rate_pct?: number | null;
  avg_event_net_pct?: number | null;
  events_total?: number;
  live?: { z: number | null; side: number; bar: number | null; z_hist?: [number, number | null, number][] };
};

export type CountdownEvent = { i: number; date: string; path: number[]; future: boolean; pre7_pct: number | null };

export type CountdownScene = {
  kind: "countdown";
  title?: string;
  x: string[];                 // coins with scheduled unlocks (most unlocks first)
  events: CountdownEvent[];    // path = cumulative coin-minus-beta*BTC % from T-30, one point per day (T-30..T+6)
  pre_days: number;            // days shorted before each unlock (7)
  upcoming?: { coin: string; date: string; days_to?: number }[];
  avg_path_pct?: number[] | null;   // all-event mean cumulative path T-30..T+14
  avg_pre7_pct?: number | null;
  hit_rate_pct?: number | null;
  y_label?: string;
  live_short?: Record<string, string>;   // coin -> unlock date currently shorted
  live_btc_hedge?: number | null;
};

export type LadderCoin = {
  coin: string;
  held: boolean;
  price: number;
  entry_level?: number | null;   // flat coins: the bait (EMA band - 1.9%)
  avg?: number | null;           // held: average entry
  tp?: number | null;            // held: average x (1 + markup)
  next?: number | null;          // held: next rung (last fill - step)
  fills: number[];               // held: every fill price, first = top rung
  worst_pct?: number | null;
  age_h?: number | null;
  usd?: number;
};

export type LadderScene = {
  kind: "ladder";
  title?: string;
  step_pct: number;
  markup_pct: number;
  entry_dist_pct: number;
  max_pos: number;
  ddf: number;
  weeks: string[];               // backtest weeks (4h bars Jul 2024 - Oct 2026)
  equity_pct: number[];          // the rule, after taker costs + funding
  placebo_pct: number[];         // same ladder, random entries (median of 20)
  hold_pct: number[];            // equal-weight buy-and-hold of the 22 perps
  cycles: number;
  win_rate_pct: number;
  avg_fills: number;
  avg_hold_h: number;
  fills_hist: Record<string, number>;   // closed cycles by rungs filled (1..6)
  coins: LadderCoin[];
  live?: {
    cycles: number; wins: number; realised: number; gross_x?: number | null; deepest_rung?: number | null;
    max_gross_usd?: number; shadow_equity?: number | null; shadow_cycles?: number;
    recent?: { coin: string; pnl: number; fills: number; hours: number; worst_pct: number }[];
  };
};

export type OrbitCoin = { s: number; b: number | null; side: number };

export type OrbitScene = {
  kind: "orbits";
  title?: string;
  lookback_days: number;          // residual window (days)
  k: number;                      // coins long / short
  weeks: { t: string; coins: Record<string, OrbitCoin> }[];   // last 16 Monday rebalances, oldest first
  next_week_resid_pct: Record<string, Record<string, number>>; // week -> coin -> residual move over that week (%)
  live?: Record<string, OrbitCoin>;
  live_decided?: number | null;   // day number (UTC) of the live book's Monday
  leverage?: number;
};

export type QuadrantCoin = { c: string; slow: number; fast: number; state: number; w: number };

export type QuadrantScene = {
  kind: "quadrants";
  title?: string;
  slow_days: number;              // slow trend window (days)
  fast_days: number;              // fast trend window (days)
  leverage?: number;
  asof?: string;
  tilt: { correction: number; rebound: number };  // position taken in each turning state (-1..1)
  coins: QuadrantCoin[];          // state 1 bull, 2 bear, 3 correction, 4 rebound; w = book weight
  mix_180d?: number[][];          // per day, oldest first: [bull, bear, correction, rebound] coin counts
  live_day?: number | null;
};

export type PulseWeek = { d: string; r: number; w: number; px: number };

export type PulseScene = {
  kind: "pulse";
  title?: string;
  lookback_weeks: number;         // BTC return window that sets the weekly sign
  leverage?: number;
  asof?: string;
  now?: { r: number; w: number }; // live 4-week return (%) and BTC weight (x equity)
  weeks: PulseWeek[];             // last ~52 Mondays, oldest first: d = Monday, r = 4-week return %, w = weight
  live_day?: number | null;
};

export type WebNode = { corr: number; vol: number | null; beta: number | null; w: number };

export type WebScene = {
  kind: "web";
  title?: string;
  decided?: string;               // date the shown book was decided (Monday)
  decided_day?: number | null;    // live book's Monday as a UTC day number
  nodes: Record<string, WebNode>; // corr = 180d corr of 3-day returns with BTC, vol = annualised, w = weight at 1x
  weeks: { t: string; ret_pct: number }[];  // last 26 weekly long-minus-short results at 1x, oldest first
  leverage?: number;
  corr_window_days?: number;
};

export type RibbonCoin = { bm_bp: number; w: number; path_bp: (number | null)[] };

export type RibbonsScene = {
  kind: "ribbons";
  title?: string;
  decided?: string;                 // date the shown book was decided (Monday)
  dates?: string[];                 // the 9 weekly points of each ribbon, oldest first
  coins: Record<string, RibbonCoin>; // bm_bp = 4-week change of 7-day mean premium (bp), w = weight at 1x
  weeks: { t: string; ret_pct: number }[];
  leverage?: number;
  lookback_weeks?: number;
};

export type SpectrumDay = { t: string; ar: number; s15: number; l365: number; e: number | null; ret_pct: number };

export type SpectrumScene = {
  kind: "spectrum";
  title?: string;
  asof?: string;                    // date of the decision the numbers belong to
  n_top: number;                    // eigenvalues counted in the absorption ratio (1/5 of the coins)
  ar: number;                       // absorption ratio, 0..1
  shift: number | null;             // (15-day mean AR - 1-year mean AR) / 1-year std
  exposure: number | null;          // 0 cash, 0.5 half, 1 all in (before leverage)
  leverage?: number;
  threshold?: number;
  eig_share: number[];              // share of total variance per principal component, largest first
  coins: Record<string, { pc1: number; vol_ann: number }>;
  history: SpectrumDay[];           // last 365 days, oldest first
};

export type CoskewCoin = { cs: number; side: number; fwd?: number | null };

export type CoskewScene = {
  kind: "coskew";
  title?: string;
  window_days: number;              // days of daily returns in the coskewness estimate
  k: number;                        // coins per side
  leverage?: number;
  weeks: { t: string; coins: Record<string, CoskewCoin> }[];  // last 16 Monday decisions, oldest first; fwd = next-week return %
  live?: Record<string, { cs: number; side: number }>;        // the live book's current reading
  live_decided?: number | null;     // day number (UTC days since epoch) of the live decision
};

export type SectorCoin = { r: number | null; w?: number; side?: number; fwd?: number | null };
export type SectorCell = { r: number; side: number; coins: Record<string, SectorCoin> };

export type SectorScene = {
  kind: "sectors";
  title?: string;
  lookback_days: number;            // days of return each sector is ranked on
  sectors_per_side: number;         // sectors held long (and short)
  leverage?: number;
  weeks: { t: string; sectors: Record<string, SectorCell> }[];  // last 16 Monday decisions, oldest first; r in %, fwd = next-week %
  live?: Record<string, SectorCell>;  // the live book's current reading
  live_decided?: number | null;     // day number (UTC days since epoch) of the live decision
};

export type DownsideDay = { t: string; r: number; idx: number; dn: number; up: number; w: number };  // r in %, dn/up annualised (0.45 = 45%), w = exposure at 1x
export type DownsideScene = {
  kind: "downside";
  title?: string;
  window_days: number;              // days of basket returns in the downside-vol window
  target: number;                   // exposure = min(cap, target / downside vol)
  cap: number;
  leverage?: number;                // book leverage on top of the exposure
  days: DownsideDay[];              // last 180 days, oldest first
  live?: { exposure?: number | null; drv?: number | null; upv?: number | null; n_coins?: number | null; decided?: number | null };
};

export type IdeaScene = TerrainScene | ChannelScene | RiderScene | JumpScene | SpotlightScene | EchoScene | CountdownScene | LadderScene | OrbitScene | QuadrantScene | PulseScene | WebScene | RibbonsScene | SpectrumScene | CoskewScene | SectorScene | DownsideScene;

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
  strategies?: { sniper?: Performance; kalshi?: Performance; metasniper?: Performance; rugsniper?: Performance } & { [key: `idea:${string}`]: Performance | undefined };
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
