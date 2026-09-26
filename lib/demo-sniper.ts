// Placeholder for Strategy 2 until the runner has published its first real scan.
// Clearly labelled as sample data in the UI; never mixed with real numbers.
import type { Performance, RadarItem, RadarStatus, SniperInfo } from "./types";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const SYLL = ["BON", "WIF", "PEP", "MOO", "GIGA", "NEI", "FRO", "CAT", "DOG", "ZOO", "PUMP", "MEW", "POPC", "SHRK", "BOME", "SLER", "TRMP", "GOAT", "CHAD", "HAMS"];

export const SNIPER_CONFIG_DEFAULT: SniperInfo["config"] = {
  start_balance: 10000, chain: "solana",
  min_age_min: 5, max_age_min: 360, min_liquidity: 20000, max_liquidity: 3000000, max_fdv: 30000000,
  min_m5_volume: 3000, max_m5_change: 60, min_score: 0.62,
  position_frac: 0.1, max_open: 6,
  stop_loss: -0.3, take_profit_1: 1.0, trail_after: 0.5, trail_pct: 0.35, max_hold_min: 720,
  rug_liquidity_drop: 0.8, dex_fee: 0.0025, priority_fee_usd: 0.4, latency_slip: 0.02,
  max_drawdown: 0.6, max_daily_loss: 0.25, reentry_block_h: 24,
};

export function demoRadar(n = 64, seed = 7): RadarItem[] {
  const r = rng(seed);
  const out: RadarItem[] = [];
  for (let i = 0; i < n; i++) {
    const age = Math.exp(Math.log(2) + r() * (Math.log(900) - Math.log(2)));
    const liq = Math.pow(10, 3.6 + r() * 2.8);
    const buys = Math.round(10 + r() * 300);
    const sells = Math.round(10 + r() * 220);
    const chg5 = (r() - 0.35) * 70;
    const chg1h = (r() - 0.3) * 220;
    const vol5 = liq * r() * 0.3;
    const ratio = buys / Math.max(1, sells);
    let status: RadarStatus = "watch";
    let why = "";
    if (age < 5) { status = "rejected"; why = "too new"; }
    else if (age > 360) { status = "rejected"; why = "too old"; }
    else if (liq < 20000) { status = "rejected"; why = "thin liquidity"; }
    else if (chg5 > 60) { status = "rejected"; why = "already vertical"; }
    const clamp = (x: number, lo: number, hi: number) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
    const score = why ? 0 :
      0.3 * clamp(ratio, 1, 2.5) + 0.2 * clamp(vol5 / liq, 0.02, 0.25) + 0.2 * clamp(chg1h, 0, 150) +
      0.15 * clamp(chg5, -5, 25) + 0.1 * (1 - clamp(age, 30, 360)) + 0.05 * clamp(Math.log10(liq), 4.3, 5.7);
    if (!why && score >= 0.62) status = "candidate";
    const sym = SYLL[Math.floor(r() * SYLL.length)] + (r() > 0.5 ? SYLL[Math.floor(r() * SYLL.length)].slice(0, 2) : "");
    out.push({
      symbol: sym, token: `demo${i}`, pair: null, dex: "raydium", url: null, price: r() * 0.01,
      liquidity: liq, fdv: liq * (8 + r() * 30), age_min: age, buys5: buys, sells5: sells, buy_ratio: ratio,
      vol5, turnover5: vol5 / liq, chg5, chg1h, score: Math.round(score * 1e4) / 1e4, status, why,
    });
  }
  const sorted = out.sort((a, b) => b.score - a.score);
  // pretend the two best are held so the visual shows every state
  sorted.slice(0, 2).forEach((x) => (x.status = "held"));
  return sorted;
}

export function demoSniperPerf(now: number): Performance {
  const radar = demoRadar();
  return {
    schema: 1, updated_ms: now, start_balance: 10000, equity: 10000, cash: 10000, pnl: 0, pnl_pct: 0,
    realized: 0, unrealized: 0, fees: 0, funding: 0, max_drawdown: 0, current_drawdown: 0, equity_peak: 10000,
    trades: { closed: 0, wins: 0, losses: 0, win_rate: null, avg_win: null, avg_loss: null, profit_factor: null, best: null, worst: null, open: 0 },
    per_coin: [], positions: [], curve: [[now, 10000]], daily: [], recent_fills: [], recent_trades: [],
    risk_limits: { max_drawdown: 0.6, max_daily_loss: 0.25, max_position_frac: 0.1, max_gross_frac: 1, vol_target: null },
    sniper: { radar, scanned_total: 0, last_scan_ms: 0, kill_reason: "", last_error: "", deployed: 0, holdings: [], config: SNIPER_CONFIG_DEFAULT },
    status: { decider: "memecoin sniper (DexScreener, Solana)", mode: "paper", venue: "solana dex (paper)", coins: [] },
  };
}
