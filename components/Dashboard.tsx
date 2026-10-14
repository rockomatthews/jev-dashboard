"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { demoSniperPerf } from "@/lib/demo-sniper";
import BacktestLab, { SLIDE_TO_BACKTEST } from "./BacktestLab";
import type { CopyBlock, CopyInfo } from "./CopyScene";
import type { LotInfo } from "./LotScene";
import { ago, arrow, num, pct, polarity, price, signedUsd, usd, when } from "@/lib/format";
import type { IdeaInfo, KalshiInfo, MetaInfo, Performance, PerfResponse, RadarItem, SniperInfo } from "@/lib/types";

const Scene = dynamic(() => import("./Scene"), {
  ssr: false,
  loading: () => <div className="scene-loading">Rendering…</div>,
});

const SniperScene = dynamic(() => import("./SniperScene"), {
  ssr: false,
  loading: () => <div className="scene-loading">Spinning up the radar…</div>,
});

const KalshiScene = dynamic(() => import("./KalshiScene"), {
  ssr: false,
  loading: () => <div className="scene-loading">Raising the order-book towers…</div>,
});

const MetaScene = dynamic(() => import("./MetaScene"), {
  ssr: false,
  loading: () => <div className="scene-loading">Raising the market-cap elevator…</div>,
});

const CopyScene = dynamic(() => import("./CopyScene"), { ssr: false });
const LotScene = dynamic(() => import("./LotScene"), { ssr: false });
const IdeaScene = dynamic(() => import("./IdeaScene"), {
  ssr: false,
  loading: () => <div className="scene-loading">Raising the landscape…</div>,
});

const POLL_MS = 30_000;
const STALE_AFTER_MS = 5 * 60_000;
// idea-lab books are re-marked every 5 minutes (config idealab.interval_s = 300), so they are only stale
// after three missed marks - with a 5-minute threshold they flickered to OFFLINE between marks
const IDEA_STALE_AFTER_MS = 15 * 60_000;

type SlideKey = string; // "trend" | "sniper" | "idea:<slug>"
type Slide = { key: SlideKey; n: number; name: string; blurb: string };

const BASE_SLIDES: Slide[] = [
  { key: "trend", n: 1, name: "Trend ensemble", blurb: "Hyperliquid perps · daily trend · long only" },
  { key: "sniper", n: 2, name: "Memecoin sniper v3", blurb: "Solana DEX pairs · deep pools only · skips coins already +100% in the hour · fresh $10k (v2 −39%, v1 −60% archived)" },
];

/** Strategy 1 and 2, then one slide per idea-lab book (each idea trades its own $10k on paper). */
function buildSlides(perf: Performance): Slide[] {
  const ideas = Object.entries(perf.strategies ?? {})
    .filter(([k, v]) => k.startsWith("idea:") && v && (v as Performance).idea)
    .map(([k, v]) => {
      const idea = (v as Performance).idea as IdeaInfo;
      return { key: k, n: idea.n, name: idea.name, blurb: idea.blurb ?? idea.venue ?? "idea lab · paper" };
    })
    .sort((a, b) => a.n - b.n);
  const kalshi: Slide[] = perf.strategies?.kalshi?.kalshi
    ? [{ key: "kalshi", n: 7, name: "Kalshi in-and-out scalper v2",
        blurb: "prediction markets · only 3c+ spreads, step 1c inside, 5c stop · fresh $10k (v1 −40% archived) · naive buy-then-sell tracked as a control" }]
    : [];
  const meta: Slide[] = perf.strategies?.metasniper?.sniper
    ? [{ key: "metasniper", n: 12, name: "Metadata Movers v4",
        blurb: "Solana/Base memecoins with a description, website or X link · 30 min+ old, $60k-$1M market cap · sell seconds after the peak · fresh $10k (v1-v3 −47% archived)" }]
    : [];
  const rug: Slide[] = perf.strategies?.rugsniper?.sniper
    ? [{ key: "rugsniper", n: 23, name: "Rugcheck Gate",
        blurb: "Strategy 12's Solana memecoins, bought only if Rugcheck's facts pass · no open mint/freeze, top-10 ≤ 30%, LP ≥ 90% locked · flat $500 · −50% stop, half off at +100%" }]
    : [];
  const copyPerf = (perf.strategies as Record<string, Performance | undefined> | undefined)?.copydesk;
  const copy: Slide[] = copyPerf?.sniper
    ? [{ key: "copydesk", n: 25, name: "Copy Desk",
        blurb: "fomo's top traders watched on-chain on Solana, Robinhood Chain and Base · every buy through Rugcheck/GoPlus facts, then Grok's COPY/SKIP · flat $500 · mirror the leader's exit, −50% stop, half off at +100%" }]
    : [];
  const lotPerf = (perf.strategies as Record<string, Performance | undefined> | undefined)?.lotladder;
  const lot: Slide[] = (lotPerf as unknown as { lots?: unknown } | undefined)?.lots
    ? [{ key: "lotladder", n: 26, name: "Lot Ladder",
        blurb: "Rob's STRAFE HELM OKX lot engine · $50 taker lots, 6 per coin · maker exit at +$0.40 net (decays to $0.25) · never sells at a loss · bags marked at the bid" }]
    : [];
  return [...BASE_SLIDES, ...ideas, ...kalshi, ...meta, ...rug, ...copy, ...lot];
}

function Pol({ v, children }: { v: number; children: React.ReactNode }) {
  return <span className={`pol pol--${polarity(v)}`}>{children}</span>;
}

function Stat({ label, value, sub, v }: { label: string; value: string; sub?: string; v?: number }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{v === undefined ? value : <Pol v={v}>{value}</Pol>}</div>
      {sub && <div className="stat__sub">{sub}</div>}
    </div>
  );
}

function fmtAge(min: number | null): string {
  if (min === null || min === undefined) return "—";
  if (min < 90) return `${Math.round(min)}m`;
  if (min < 48 * 60) return `${(min / 60).toFixed(1)}h`;
  return `${Math.round(min / 1440)}d`;
}

function compactUsd(v: number): string {
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}k`;
  return usd(v, false);
}

// =============================================================================================
// Carousel
// =============================================================================================
function Carousel({ slides, slide, onPrev, onNext, equities }: {
  slides: Slide[]; slide: number; onPrev: () => void; onNext: () => void; equities: (number | null)[];
}) {
  const s = slides[slide];
  return (
    <nav className="carousel" aria-label="Strategies">
      <button type="button" className="carousel__btn" onClick={onPrev} aria-label="Previous strategy">
        <span aria-hidden>◀</span>
      </button>
      <div className="carousel__body" aria-live="polite">
        <div className="carousel__kicker">STRATEGY {s.n} / {slides.length}{s.key.startsWith("idea:") ? " · IDEA LAB · OWN $10K PAPER BOOK" : ""}</div>
        <div className="carousel__name">{s.name}</div>
        <div className="carousel__blurb">{s.blurb}</div>
        <div className="carousel__dots">
          {slides.map((x, i) => (
            <span key={x.key} className={`carousel__dot ${i === slide ? "carousel__dot--on" : ""}`}>
              <i aria-hidden />
              S{x.n} {equities[i] === null ? "—" : usd(equities[i] as number, false)}
            </span>
          ))}
        </div>
      </div>
      <button type="button" className="carousel__btn" onClick={onNext} aria-label="Next strategy">
        <span aria-hidden>▶</span>
      </button>
    </nav>
  );
}

// =============================================================================================
// Strategy 1 panels (trend): strategy targets, testing, readiness
// =============================================================================================
function TrendPanels({ p }: { p: Performance }) {
  return (
    <>
      {p.status.targets && Object.keys(p.status.targets).length > 0 && (
        <section className="panel">
          <h2>Strategy 1 <span className="panel__hint">{p.status.decider}</span></h2>
          <p className="strategy__what">
            Once a day each coin is scored on four trend horizons (10, 20, 42 and 84 days). Every horizon
            that is up adds a quarter of the coin&apos;s position; a coin in a downtrend on all four is sold.
            Size shrinks when a coin is volatile, so each coin carries similar risk. Long only, no leverage
            {p.risk_limits ? `, risk setting ${num(p.risk_limits.vol_target ?? 0, 1)}, max ${pct(p.risk_limits.max_position_frac, 0)} per coin and ${pct(p.risk_limits.max_gross_frac, 0)} invested` : ""}.
          </p>
          <div className="targets">
            {Object.entries(p.status.targets).sort((a, b) => b[1] - a[1]).map(([coin, w]) => {
              const held = p.positions.find((o) => o.coin === coin);
              const heldW = held ? held.notional / p.equity : 0;
              return (
                <div key={coin} className="target">
                  <span className="coin">{coin}</span>
                  <div className="target__bar"><i style={{ width: `${Math.min(100, (w / 0.1) * 100)}%` }} /></div>
                  <span className="target__num">{pct(w, 1)} target · {pct(heldW, 1)} held</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {p.research && (
        <section className="panel">
          <h2>Testing <span className="panel__hint">every strategy is scored only on data it was not tuned on, after fees, slippage and funding</span></h2>
          {p.research.study && (
            <>
              <p className="strategy__what">
                <b>Edge study</b> · {p.research.study.coins.length} coins · daily bars · out of sample {p.research.study.strategies[0]?.oos_from} → {p.research.study.to}
                {" "}· {p.research.study.configs} configurations tried. <b>{p.research.study.verdict}</b>
              </p>
              <table>
                <thead><tr><th>Strategy</th><th className="r">Sharpe</th><th className="r">95% range</th><th className="r">Beats random (p)</th><th className="r">Return/yr</th><th className="r">Worst drawdown</th><th className="r">Pass</th></tr></thead>
                <tbody>
                  {[...p.research.study.strategies].sort((a, b) => b.sharpe - a.sharpe).map((st) => (
                    <tr key={st.name} className={st.name === p.readiness?.strategy ? "row--live" : ""}>
                      <td className="coin">{st.name}{st.name === p.readiness?.strategy ? " ◀ trading" : ""}</td>
                      <td className="r">{num(st.sharpe, 2)}</td>
                      <td className="r muted">{num(st.ci[0], 2)} … {num(st.ci[1], 2)}</td>
                      <td className="r">{st.p === null ? "—" : num(st.p, 3)}</td>
                      <td className="r"><Pol v={st.cagr}>{pct(st.cagr, 1, true)}</Pol></td>
                      <td className="r">{pct(-st.mdd, 1)}</td>
                      <td className="r">{st.pass ? "✓" : "✗"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div className="grid2 grid2--tight">
            {p.research.replication && (
              <div className="subpanel">
                <h3>Replication on unseen coins</h3>
                <p className="strategy__what">{p.research.replication.universe}: Sharpe <b>{num(p.research.replication.sharpe, 2)}</b> (range {num(p.research.replication.ci[0], 2)} … {num(p.research.replication.ci[1], 2)}), beats random p = {num(p.research.replication.p, 3)}, worst drawdown {pct(-p.research.replication.mdd, 1)} vs buy &amp; hold Sharpe {num(p.research.replication.buyhold_sharpe, 2)} / {pct(-p.research.replication.buyhold_mdd, 1)}.</p>
              </div>
            )}
            {p.research.new_strategy && (
              <div className="subpanel">
                <h3>Newest strategy tested: {p.research.new_strategy.name}</h3>
                <p className="strategy__what">{p.research.new_strategy.rule} Source: {p.research.new_strategy.source}. Out of sample {p.research.new_strategy.period}: Sharpe <b>{num(p.research.new_strategy.sharpe, 2)}</b>, return {pct(p.research.new_strategy.cagr, 1, true)}/yr. <b>{p.research.new_strategy.verdict}</b></p>
              </div>
            )}
          </div>
          {p.research.risk_scaling && (
            <>
              <h3 className="h3">Risk dial <span className="panel__hint">{p.research.risk_scaling_note}</span></h3>
              <table>
                <thead><tr><th>Risk setting</th><th className="r">Return/yr</th><th className="r">Volatility</th><th className="r">Sharpe</th><th className="r">Worst drawdown</th><th className="r">Worst day</th><th className="r">Max invested</th></tr></thead>
                <tbody>
                  {p.research.risk_scaling.map((r) => {
                    const live = p.risk_limits?.vol_target !== undefined && p.risk_limits?.vol_target !== null && Math.abs(r.vol_target - p.risk_limits.vol_target) < 1e-6;
                    return (
                      <tr key={r.vol_target} className={live ? "row--live" : ""}>
                        <td className="coin">{num(r.vol_target, 1)}{live ? " ◀ now" : ""}</td>
                        <td className="r">{pct(r.cagr, 1, true)}</td>
                        <td className="r muted">{pct(r.vol, 1)}</td>
                        <td className="r">{num(r.sharpe, 2)}</td>
                        <td className="r">{pct(-r.mdd, 1)}</td>
                        <td className="r">{pct(r.worst_day, 1)}</td>
                        <td className="r muted">{pct(r.gross_max, 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
          {p.risk_limits && (
            <p className="empty">Hard limits now: kill switch at {pct(-p.risk_limits.max_drawdown, 0)} drawdown · daily loss stop {pct(-p.risk_limits.max_daily_loss, 0)} · max {pct(p.risk_limits.max_position_frac, 0)} per coin · max {pct(p.risk_limits.max_gross_frac, 0)} invested.</p>
          )}
        </section>
      )}

      {p.readiness && (
        <section className="panel readiness">
          <h2>
            Go-live readiness{" "}
            <span className={`badge ${p.readiness.ready ? "badge--live" : "badge--offline"}`}>
              {p.readiness.ready ? "✓ READY" : `${p.readiness.passed}/${p.readiness.total} checks`}
            </span>
            <span className="panel__hint">every check must pass before real money · strategy: {p.readiness.strategy}</span>
          </h2>
          <div className="checks">
            {p.readiness.checks.map((c) => (
              <div key={c.key} className={`check ${c.pass ? "check--pass" : "check--fail"}`}>
                <span className="check__icon" aria-hidden>{c.pass ? "✓" : "✗"}</span>
                <span className="check__label">{c.label}</span>
                <span className="check__value">{c.display}</span>
                <span className="check__threshold">need {c.threshold}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// =============================================================================================
// Strategy 2 panels (sniper): rules, radar, holdings
// =============================================================================================
function StatusPill({ s }: { s: RadarItem["status"] }) {
  const label = { held: "HELD", candidate: "TARGET", watch: "WATCH", rejected: "REJECT", cooldown: "COOLDOWN" }[s];
  return <span className={`pill pill--${s}`}>{label}</span>;
}

function SniperPanels({ p, sn, demo, now }: { p: Performance; sn: SniperInfo; demo: boolean; now: number }) {
  const c = sn.config;
  const live = sn.radar.filter((r) => r.status !== "rejected").sort((a, b) => b.score - a.score).slice(0, 15);
  const counts = sn.radar.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const rejects = Object.entries(
    sn.radar.filter((r) => r.status === "rejected").reduce<Record<string, number>>((acc, r) => {
      acc[r.why || "other"] = (acc[r.why || "other"] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <section className="panel">
        <h2>Strategy 2 <span className="panel__hint">{p.status.decider} · paper · own {usd(c.start_balance, false)}</span></h2>
        <p className="strategy__what">
          Every minute the bot pulls the newest Solana token listings and boosted tokens from DexScreener and scores each
          pair from 0 to 1: buy pressure (30%), 5-minute volume vs pool depth (20%), 1-hour trend (20%), 5-minute move (15%),
          how new it is (10%) and pool depth (5%). Hard filters throw out anything younger than {c.min_age_min} minutes or older
          than {fmtAge(c.max_age_min)}, pools under {compactUsd(c.min_liquidity)} or over {compactUsd(c.max_liquidity)}, FDV over{" "}
          {compactUsd(c.max_fdv)}, under {compactUsd(c.min_m5_volume)} of 5-minute volume, or already up {c.max_m5_change}% in 5 minutes.
          It buys the best pair scoring {num(c.min_score, 2)} or more with {pct(c.position_frac, 0)} of equity{c.max_liq_frac ? ` (never more than ${pct(c.max_liq_frac, 1)} of the pool, so the trade can't move the price much)` : ""}, up to {c.max_open} at once{c.manage_interval_s ? `; open positions are re-checked every ${c.manage_interval_s} seconds` : ""}.
        </p>
        <div className="rules">
          <span className="rule rule--loss">stop {pct(c.stop_loss, 0, true)}</span>
          <span className="rule rule--gain">sell half at {pct(c.take_profit_1, 0, true)}</span>
          <span className="rule rule--gain">trail {pct(c.trail_pct, 0)} after {pct(c.trail_after, 0, true)}</span>
          <span className="rule">time stop {fmtAge(c.max_hold_min)}</span>
          <span className="rule rule--loss">rug exit: liquidity −{pct(c.rug_liquidity_drop, 0)}</span>
          <span className="rule">no re-entry {c.reentry_block_h}h</span>
          <span className="rule rule--loss">kill at {pct(-c.max_drawdown, 0)} · day stop {pct(-c.max_daily_loss, 0)}</span>
        </div>
        <p className="empty">
          Fills are priced on a constant-product AMM from the pool&apos;s real depth: price impact, {pct(c.dex_fee, 2)} DEX fee,
          {" "}{usd(c.priority_fee_usd)} priority fee per swap and {pct(c.latency_slip, 0)} latency slippage each way. A rug exits into the drained pool.
        </p>
        <div className="scanmeta">
          <span><b>{sn.radar.length}</b> pairs on radar</span>
          <span><b>{counts.candidate ?? 0}</b> targets</span>
          <span><b>{counts.held ?? 0}</b> held</span>
          <span><b>{counts.rejected ?? 0}</b> rejected</span>
          <span><b>{num(sn.scanned_total, 0)}</b> pairs scanned total</span>
          <span>last scan <b>{demo || !sn.last_scan_ms ? "pending" : ago(sn.last_scan_ms, now)}</b></span>
          <span><b>{usd(sn.deployed ?? 0, false)}</b> deployed</span>
          {sn.kill_reason && <span className="pol pol--loss">⛔ {sn.kill_reason}</span>}
          {sn.last_error && !demo && <span className="pol pol--loss">⚠ {sn.last_error}</span>}
        </div>
        {rejects.length > 0 && (
          <p className="empty">Rejected by filter: {rejects.map(([w, n]) => `${w} ${n}`).join(" · ")}</p>
        )}
      </section>

      <section className="panel">
        <h2>Radar <span className="panel__hint">best-scoring live pairs right now{demo ? " · sample data until the first live scan" : ""}</span></h2>
        {live.length === 0 ? (
          <p className="empty">Nothing passes the filters this minute. The sniper waits.</p>
        ) : (
          <table>
            <thead><tr><th>Token</th><th>Status</th><th>Score</th><th className="r">Age</th><th className="r">Liquidity</th><th className="r">5m</th><th className="r">1h</th><th className="r">Buys/sells 5m</th><th className="r">Vol/liq 5m</th></tr></thead>
            <tbody>
              {live.map((r) => (
                <tr key={r.token} className={r.status === "held" ? "row--held" : r.status === "candidate" ? "row--live" : ""}>
                  <td className="coin">{r.url ? <a href={r.url} target="_blank" rel="noreferrer">${r.symbol}</a> : `$${r.symbol}`}</td>
                  <td><StatusPill s={r.status} /></td>
                  <td>
                    <div className="scorebar" title={`${r.score.toFixed(3)} (needs ${c.min_score})`}>
                      <i style={{ width: `${Math.min(100, r.score * 100)}%` }} className={r.score >= c.min_score ? "scorebar--hot" : ""} />
                      <em style={{ left: `${c.min_score * 100}%` }} />
                      <span>{r.score.toFixed(2)}</span>
                    </div>
                  </td>
                  <td className="r">{fmtAge(r.age_min)}</td>
                  <td className="r">{compactUsd(r.liquidity)}</td>
                  <td className="r"><Pol v={r.chg5}>{pct(r.chg5 / 100, 1, true)}</Pol></td>
                  <td className="r"><Pol v={r.chg1h}>{pct(r.chg1h / 100, 0, true)}</Pol></td>
                  <td className="r">{r.buys5}/{r.sells5}</td>
                  <td className="r muted">{pct(r.turnover5, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Sniper holdings <span className="panel__hint">{sn.holdings.length} of {c.max_open} slots</span></h2>
        {sn.holdings.length === 0 ? (
          <p className="empty">No open snipes. Cash waits for the next pair that clears {num(c.min_score, 2)}.</p>
        ) : (
          <table>
            <thead><tr><th>Token</th><th className="r">Cost</th><th className="r">Entry</th><th className="r">Now</th><th className="r">Peak</th><th className="r">Return</th><th className="r">Pool</th><th className="r">Held</th><th>Half sold</th></tr></thead>
            <tbody>
              {sn.holdings.map((h) => (
                <tr key={h.key}>
                  <td className="coin">${h.symbol}</td>
                  <td className="r">{usd(h.cost_usd, false)}</td>
                  <td className="r">${price(h.entry_px)}</td>
                  <td className="r">${price(h.last_px)}</td>
                  <td className="r muted">${price(h.peak_px)}</td>
                  <td className="r"><b><Pol v={h.ret}>{pct(h.ret, 1, true)}</Pol></b></td>
                  <td className="r muted">{compactUsd(h.last_liquidity)}</td>
                  <td className="r muted">{fmtAge((now - h.opened_ms) / 60000)}</td>
                  <td>{h.took_partial ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

// =============================================================================================
// Strategy 12 panels (Metadata Movers): rules, radar with metadata, holdings with market-cap progress
// =============================================================================================
const GATE_LABEL: Record<string, string> = {
  passed: "passed → bought", no_report: "no Rugcheck report", authority_open: "mint / freeze authority open",
  danger: "danger flag", risk_score: "risk score > limit", top10: "top-10 holders too big",
  lp_unlocked: "LP not locked", insiders: "insider network",
};

function RugGatePanel({ p, m, g }: { p: Performance; m: MetaInfo; g: NonNullable<MetaInfo["gate"]> }) {
  const c = m.config;
  const r = g.rules;
  const total = Object.values(g.counts).reduce((a, b) => a + b, 0);
  const rows = Object.entries(g.counts).sort((a, b) => (a[0] === "passed" ? -1 : b[0] === "passed" ? 1 : b[1] - a[1]));
  return (
    <section className="panel">
      <h2>Strategy 23 <span className="panel__hint">Rugcheck Gate · paper · own {usd(c.start_balance, false)}</span></h2>
      <p className="strategy__what">
        From a copy-trading playbook built on one split: code fetches the facts, a model judges, a bot executes. This book
        keeps the free, code-only part. It watches the same new Solana memecoins as Strategy 12 (a description, website or
        X link, {compactUsd(c.min_mc)}-{compactUsd(c.max_entry_mc)} market cap, {fmtAge(30)}+ old, pool of at least{" "}
        {compactUsd(c.min_liquidity)}). Before every buy it pulls the coin&apos;s Rugcheck report and kills the coin on the first
        failed fact. Those facts are: a still-open mint or freeze authority, any danger-level flag, a risk score over{" "}
        {r.max_risk_score}, top-10 holders over {r.max_top10_pct}% of supply (pool accounts excluded), LP under{" "}
        {r.min_lp_locked_pct}% locked, or {r.max_insider_nets === 0 ? "any" : `more than ${r.max_insider_nets}`} insider
        network. A coin with no report is skipped, never passed. Survivors get a flat {usd(g.ticket_usd, false)} ticket. The
        bot holds {g.max_open} coins at most, never takes a ticket that would move the pool more than{" "}
        {pct(r.max_impact, 0)}, and waits an hour between entries. Exits: a {pct(r.stop_loss, 0, true)} stop, then half
        sold at {pct(r.take_half_at, 0, true)}, and the rest trails the peak like Strategy 12.
      </p>
      <div className="rules">
        <span className="rule rule--loss">no open mint / freeze</span>
        <span className="rule rule--loss">no danger flags</span>
        <span className="rule">risk score ≤ {r.max_risk_score}</span>
        <span className="rule">top-10 ≤ {r.max_top10_pct}%</span>
        <span className="rule">LP locked ≥ {r.min_lp_locked_pct}%</span>
        <span className="rule">flat {usd(g.ticket_usd, false)} · max {g.max_open}</span>
        <span className="rule rule--loss">stop {pct(r.stop_loss, 0, true)}</span>
        <span className="rule rule--gain">half off at {pct(r.take_half_at, 0, true)}</span>
      </div>
      <p className="empty">
        Rugcheck keeps no point-in-time history, so there is no backtest; this paper book is the test. The live A/B test
        is Strategy 12, which buys the same candidates without the gate. Not taken from the playbook: copying fomo
        leaders (no public API), the Grok verdict, and any real-money execution.
      </p>
      <table>
        <thead><tr><th>Gate verdict (since launch)</th><th className="r">Coins</th><th className="r">Share</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={3} className="muted">no coin checked yet</td></tr>}
          {rows.map(([k, v]) => (
            <tr key={k}><td>{GATE_LABEL[k] ?? k}</td><td className="r">{v}</td><td className="r">{pct(total ? v / total : 0, 0)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted">{p.status.decider}</p>
    </section>
  );
}

// =============================================================================================
// Strategy 25 panels (Copy Desk): how it works, leaders and candidates, every leader buy and what we did
// =============================================================================================
const COPY_STATUS: Record<string, string> = { COPY: "copied", SKIP: "skipped", MIRROR: "mirrored exit", HOLD: "held (small trim)" };

function CopyDeskPanels({ p, m, c, now }: { p: Performance; m: MetaInfo; c: CopyBlock; now: number }) {
  const r = c.rules;
  const g = m.gate;
  const total = Object.values(c.counts).reduce((a, b) => a + b, 0);
  const counts = Object.entries(c.counts).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <section className="panel">
        <h2>Strategy 25 <span className="panel__hint">Copy Desk · paper · own {usd(m.config.start_balance, false)} · runs by itself</span></h2>
        <p className="strategy__what">
          The copy-trading playbook (&quot;code fetches, Grok judges, copyfomo executes&quot;) with no human step. Every 30
          minutes the desk reads fomo&apos;s public top-5 board, which lists each trader&apos;s Solana and EVM wallets, and
          keeps every trader it has seen as a candidate. Every 20 seconds it reads the leaders&apos; newest trades on{" "}
          {(c as unknown as { chains_live?: string[] }).chains_live?.join(", ") ?? "Solana, Robinhood Chain and Base"}. The
          other candidates are read every 2 minutes. On Solana, a transaction that adds one token while SOL or a stablecoin
          leaves the wallet counts as a buy. On EVM chains, a token arriving in the wallet counts as a buy, valued by the
          WETH/USDG/USDC leg or DexScreener&apos;s price. A leader
          buy of at least {usd(r.min_leader_usd, false)}, seen within {Math.round(r.max_signal_age_s / 60)} minutes, goes to
          the gate. The gate first checks the hard facts. On Solana that is Rugcheck: mint/freeze authority, danger flags, risk score,
          top-10 holders with pools excluded, LP lock, and insiders. On EVM it is GoPlus: honeypot, taxes over 10%, owner
          powers, minting with a live owner, top-10 holders, and LP held by people. It then asks Grok for COPY or SKIP, and only a COPY with confidence of at least{" "}
          {Math.round(r.min_confidence * 100)}% books a flat {usd(g?.ticket_usd ?? 500, false)} ticket. When the leader sells, the
          desk sells the same share, and all of it once he sells 90% or more. There is also a {pct(g?.rules.stop_loss ?? -0.5, 0, true)}{" "}
          stop, half comes off at {pct(g?.rules.take_half_at ?? 1, 0, true)}, and the rest trails the peak. Once a week, after 3
          days of tape, the leaders are picked again from stats the desk measured itself on-chain. The cut needs{" "}
          {r.trader.min_closed_trades}+ closed trades, a win rate of {Math.round(r.trader.min_win_rate * 100)}% or more, no
          single coin over {Math.round(r.trader.max_top_coin_share * 100)}% of profit, and a green last week. Grok then ranks the
          survivors and keeps at most 3. Zero is an allowed answer.
        </p>
        <div className="rules">
          <span className="rule">leader buy ≥ {usd(r.min_leader_usd, false)}</span>
          <span className="rule">seen ≤ {Math.round(r.max_signal_age_s / 60)} min</span>
          <span className="rule rule--loss">Rugcheck facts</span>
          <span className="rule">Grok COPY ≥ {Math.round(r.min_confidence * 100)}%</span>
          <span className="rule rule--gain">mirror the leader&apos;s exit</span>
          <span className="rule rule--loss">stop {pct(g?.rules.stop_loss ?? -0.5, 0, true)}</span>
          <span className="rule rule--gain">half off at {pct(g?.rules.take_half_at ?? 1, 0, true)}</span>
        </div>
        <p className="muted">
          Leaders: {c.leaders_source}{c.next_pick_ms ? ` · next pick ${when(c.next_pick_ms)}` : " · first weekly pick after 3 days of tape"} ·
          tape {c.tape_swaps.toLocaleString()} swaps{c.missed_tx ? ` (${c.missed_tx.toLocaleString()} transactions skipped over the read budget)` : ""} ·
          Grok {c.grok.via}, {c.grok.calls_last_hour}/{c.grok.budget_per_hour} calls this hour · RPC {c.rpc.calls.toLocaleString()} calls,
          {" "}{c.rpc.errors} failed{c.rpc.last_error ? ` (last: ${c.rpc.last_error})` : ""}
        </p>
        <p className="muted">{p.status.decider}</p>
      </section>

      <section className="panel">
        <h2>Who it watches <span className="panel__hint">gold = leader (copied) · stats measured from their own on-chain swaps</span></h2>
        <table>
          <thead><tr><th>Trader</th><th>Source</th><th className="r">fomo 24h</th><th className="r">Followers</th><th className="r">Seen</th><th className="r">Closed</th><th className="r">Win</th><th className="r">Measured PnL</th></tr></thead>
          <tbody>
            {c.candidates.length === 0 && <tr><td colSpan={8} className="muted">waiting for fomo&apos;s board</td></tr>}
            {c.candidates.map((x) => (
              <tr key={x.wallet}>
                <td>{x.leader ? <b className="pol pol--gain">★ @{x.handle}</b> : <>@{x.handle}</>}{" "}
                  {x.sol && <a className="muted" href={`https://solscan.io/account/${x.sol}`} target="_blank" rel="noreferrer">sol</a>}{" "}
                  {x.evm && <a className="muted" href={`https://robinhoodchain.blockscout.com/address/${x.evm}`} target="_blank" rel="noreferrer">evm</a>}</td>
                <td className="muted">{x.source ?? "—"}{x.on_board ? " · now" : ""}{x.last_tx && Object.keys(x.last_tx).length ? ` · ${Object.keys(x.last_tx).join("/")}` : ""}</td>
                <td className="r">{x.pnl24h_usd === null || x.pnl24h_usd === undefined ? "—" : compactUsd(x.pnl24h_usd)}</td>
                <td className="r">{(x.followers ?? 0).toLocaleString()}</td>
                <td className="r">{x.buys ?? 0}b / {x.sells ?? 0}s</td>
                <td className="r">{x.closed_trades ?? 0}</td>
                <td className="r">{x.win_rate === null || x.win_rate === undefined ? "—" : pct(x.win_rate, 0)}</td>
                <td className="r">{x.pnl_30d_usd === null || x.pnl_30d_usd === undefined ? "—" : <Pol v={x.pnl_30d_usd}>{signedUsd(x.pnl_30d_usd)}</Pol>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {c.pick_log.length > 0 && <p className="muted">Last pick: {c.pick_log.slice(-6).join(" · ")}</p>}
      </section>

      {(c.firehose ?? []).map((f) => (
        <section className="panel" key={f.chain}>
          <h2>fomo tape · {f.chain} <span className="panel__hint">every fill on fomo&apos;s settlement contract, every trader scored</span></h2>
          <p className="strategy__what">
            Every fomo buy on this chain is delivered from one settlement contract, and every sell goes back into it, with
            the dollar leg in the same transaction. The desk reads all of them, so it can score every fomo trader instead of
            only five names from a board. So far it has read {f.fills.toLocaleString()} fills by {f.wallets.toLocaleString()}{" "}
            traders over the last {f.hours} h{f.backfill_pct < 1 ? ` (history ${Math.round(f.backfill_pct * 100)}% loaded)` : ""}.
            Every {Math.round((c.rules as unknown as { pick_every_h?: number }).pick_every_h ?? 6)} hours the best of
            them by measured profit go through the copy cut and Grok&apos;s ranking, and the winners become the leaders. The copy
            cut keeps traders a copy that is 20–40 seconds late can still follow: 5+ round trips on 3+ tokens, a median hold
            of 2+ minutes, a median size of $20+, 50%+ wins, no coin above 60% of the profit, and a profit overall. Most of
            the busiest wallets on the tape are bots: they farm one token with 6-second holds and $7–10 clips.
          </p>
          <table>
            <thead><tr><th>Trader (passes the cut)</th><th className="r">Closed</th><th className="r">Win</th><th className="r">Measured PnL</th><th className="r">Tokens</th><th className="r">Median hold</th><th className="r">Median size</th></tr></thead>
            <tbody>
              {f.top.length === 0 && <tr><td colSpan={7} className="muted">nobody passes the copy cut yet</td></tr>}
              {f.top.map((t) => (
                <tr key={t.wallet}>
                  <td><a href={`https://robinhoodchain.blockscout.com/address/${t.wallet}`} target="_blank" rel="noreferrer">{t.wallet.slice(0, 6)}…{t.wallet.slice(-4)}</a>
                    {c.leaders.some((l) => (l as unknown as { evm?: string }).evm === t.wallet) && <b className="pol pol--gain"> ★ leader</b>}</td>
                  <td className="r">{t.closed_trades}</td>
                  <td className="r">{t.win_rate === null ? "—" : pct(t.win_rate, 0)}</td>
                  <td className="r">{t.pnl_30d_usd === null ? "—" : <Pol v={t.pnl_30d_usd}>{signedUsd(t.pnl_30d_usd)}</Pol>}</td>
                  <td className="r">{(t as unknown as { tokens?: number }).tokens ?? "—"}</td>
                  <td className="r">{(t as unknown as { median_hold_minutes?: number }).median_hold_minutes == null ? "—" : `${Math.round((t as unknown as { median_hold_minutes: number }).median_hold_minutes)} min`}</td>
                  <td className="r">{(t as unknown as { median_size_usd?: number }).median_size_usd == null ? "—" : compactUsd((t as unknown as { median_size_usd: number }).median_size_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {f.last_error && <p className="muted">last read error: {f.last_error}</p>}
        </section>
      ))}

      <section className="panel">
        <h2>Every leader move <span className="panel__hint">newest first · {total} decisions so far</span></h2>
        <div className="rules">
          {counts.map(([k, v]) => <span key={k} className={`rule ${k === "COPY" || k === "MIRROR" ? "rule--gain" : ""}`}>{COPY_STATUS[k] ?? k} · {v}</span>)}
        </div>
        <table>
          <thead><tr><th>When</th><th>Leader</th><th>Token</th><th className="r">Their size</th><th>Desk</th><th>Why</th></tr></thead>
          <tbody>
            {c.events.length === 0 && <tr><td colSpan={6} className="muted">no leader trade seen yet (the first read of a wallet only marks where to start)</td></tr>}
            {c.events.slice(0, 30).map((e, i) => (
              <tr key={`${e.ts}-${e.mint}-${i}`}>
                <td className="muted">{ago(e.ts, now)}</td>
                <td>@{e.handle}</td>
                <td><span className="muted">{e.chain ?? "solana"}</span>{" "}<a href={`https://dexscreener.com/${e.chain ?? "solana"}/${e.mint}`} target="_blank" rel="noreferrer">{e.symbol ? `$${e.symbol}` : `${e.mint.slice(0, 5)}…`}</a> <span className="muted">{e.side.toLowerCase()}</span></td>
                <td className="r">{usd(e.usd, false)}</td>
                <td>{e.status === "COPY" || e.status === "MIRROR" ? <b className="pol pol--gain">{COPY_STATUS[e.status]}</b> : <span className="muted">{COPY_STATUS[e.status] ?? e.status}</span>}</td>
                <td className="muted">{e.why}{e.confidence !== null && e.confidence !== undefined ? ` (${Math.round(e.confidence * 100)}%)` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

// =============================================================================================
// Strategy 26 panels (Lot Ladder): the rules, Rob's run #5 vs. our live book vs. the 7-day backtest, coins, lots
// =============================================================================================
function LotPanels({ p, L, now }: { p: Performance; L: LotInfo; now: number }) {
  const s = L.summary;
  const r5 = L.run5;
  const bt = L.backtest;
  const cfg = L.config as Record<string, number>;
  const mins = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${Math.round(x / 60)} min`);
  const coins = [...L.coins].sort((a, b) => b.lots.length - a.lots.length || b.net - a.net);
  return (
    <>
      <section className="panel">
        <h2>Strategy 26 <span className="panel__hint">Lot Ladder · Rob&apos;s STRAFE HELM OKX engine · paper · own {usd(p.start_balance, false)}</span></h2>
        <p className="strategy__what">
          This book runs the lot engine from Rob&apos;s OKX run sheet (paper run #5, 2026-10-13) on live OKX prices. Every
          position is a fixed {usd(cfg.lot_usd, false)} lot bought with a taker order, at most one lot every{" "}
          {cfg.entry_clock_s} s, up to {cfg.max_lots_per_coin} per coin, on {L.coins.length} coins. Each lot then rests a maker
          sell priced to net +${Number(cfg.profit_per_lot).toFixed(2)} after both fees. The target slides to
          +${Number(cfg.min_profit).toFixed(2)} over {cfg.decay_h} h. There is no stop and no time exit, and a lot is never
          sold below its cost. Only crashes block new lots: −6% in 1 h, −12% in 4 h, −25% in a day. New lots also stop once
          lots held cost {Math.round(Number(cfg.flow_frac) * 100)}% of equity. Never-loss turns every losing trade into a
          held bag. A 100% win rate on closed lots is therefore built in, so the score that counts here is realized P&amp;L
          plus the bags marked at the bid.
        </p>
        <div className="rules">
          <span className="rule">{usd(cfg.lot_usd, false)} taker lots</span>
          <span className="rule">max {cfg.max_lots_per_coin} / coin</span>
          <span className="rule rule--gain">maker exit +${Number(cfg.profit_per_lot).toFixed(2)} → ${Number(cfg.min_profit).toFixed(2)}</span>
          <span className="rule rule--loss">never sells at a loss</span>
          <span className="rule">crash gates 1h −6% · 4h −12% · 1d −25%</span>
          <span className="rule">flow limit {Math.round(Number(cfg.flow_frac) * 100)}% of equity</span>
          <span className="rule">fees 0.35% taker / 0.20% maker</span>
        </div>
        {L.kill_reason && <p className="empty">⛔ {L.kill_reason}</p>}
        {L.last_error && <p className="muted">last data error: {L.last_error}</p>}
      </section>

      <section className="panel">
        <h2>Three views of the same engine <span className="panel__hint">realized vs. what the bags are worth</span></h2>
        <table>
          <thead><tr><th></th><th className="r">Rob&apos;s run #5</th><th className="r">This book (live)</th><th className="r">Backtest {bt ? `${bt.days} d` : ""}</th></tr></thead>
          <tbody>
            <tr><td>Capital</td><td className="r">{r5 ? usd(r5.capital, false) : "—"}</td><td className="r">{usd(p.start_balance, false)}</td><td className="r">{usd(p.start_balance, false)}</td></tr>
            <tr><td>Time</td><td className="r">{r5 ? `${r5.hours} h` : "—"}</td><td className="r">since {when(p.curve.length ? p.curve[0][0] : p.updated_ms)}</td><td className="r">{bt ? `${bt.days} days · ${bt.coins} coins` : "running (first result within ~20 min)"}</td></tr>
            <tr><td>Lots sold</td><td className="r">{r5?.lots_closed ?? "—"}</td><td className="r">{s.lots_closed}</td><td className="r">{bt?.lots_closed ?? "—"}</td></tr>
            <tr><td>Realized</td><td className="r">{r5 ? <Pol v={r5.realized}>{signedUsd(r5.realized)}</Pol> : "—"}</td><td className="r"><Pol v={s.realized}>{signedUsd(s.realized)}</Pol></td><td className="r">{bt ? <Pol v={bt.realized}>{signedUsd(bt.realized)}</Pol> : "—"}</td></tr>
            <tr><td>Net per lot sold</td><td className="r">{r5?.net_per_lot_median === null || !r5 ? "—" : `$${r5.net_per_lot_median.toFixed(3)} (median)`}</td><td className="r">{s.net_per_lot === null ? "—" : `$${s.net_per_lot.toFixed(3)}`}</td><td className="r">{bt?.net_per_lot == null ? "—" : `$${bt.net_per_lot.toFixed(3)}`}</td></tr>
            <tr><td>Median hold</td><td className="r">{mins(r5?.hold_median_s)}</td><td className="r">{mins(s.hold_median_s)}</td><td className="r">{mins(bt?.hold_median_s)}</td></tr>
            <tr><td>Bags held (cost)</td><td className="r">{r5 ? `${r5.held_lots} · ${usd(r5.held_cost, false)}` : "—"}</td><td className="r">{s.held_lots} · {usd(s.held_cost, false)}</td><td className="r">{bt ? `${bt.held_lots} · ${usd(bt.held_cost, false)}` : "—"}</td></tr>
            <tr><td>Bags at the bid</td><td className="r">{r5 ? <Pol v={r5.held_pnl}>{signedUsd(r5.held_pnl)}</Pol> : "—"}</td><td className="r"><Pol v={s.held_pnl}>{signedUsd(s.held_pnl)}</Pol></td><td className="r">{bt ? <Pol v={bt.held_pnl}>{signedUsd(bt.held_pnl)}</Pol> : "—"}</td></tr>
            <tr><td><b>Net (realized + bags)</b></td><td className="r">{r5 ? <b><Pol v={r5.net_after_bags}>{signedUsd(r5.net_after_bags)}</Pol></b> : "—"}</td>
              <td className="r"><b><Pol v={s.realized + s.held_pnl}>{signedUsd(s.realized + s.held_pnl)}</Pol></b></td>
              <td className="r">{bt ? <b><Pol v={bt.realized + bt.held_pnl}>{signedUsd(bt.realized + bt.held_pnl)}</Pol> · {pct(bt.return_pct, 2, true)} · max DD {pct(-bt.max_drawdown, 1)}</b> : "—"}</td></tr>
          </tbody>
        </table>
        {bt && <p className="muted">Backtest method: {bt.method}.</p>}
      </section>

      <section className="panel">
        <h2>Coins <span className="panel__hint">lots held, bags and what each coin has sold</span></h2>
        <table>
          <thead><tr><th>Coin</th><th className="r">Bid</th><th className="r">24h</th><th className="r">Lots</th><th className="r">Bags</th><th className="r">Sold</th><th className="r">Net sold</th><th>Gate</th></tr></thead>
          <tbody>
            {coins.map((c) => {
              const bag = c.lots.reduce((a, l) => a + l.pnl, 0);
              return (
                <tr key={c.coin}>
                  <td><b>{c.coin}</b></td>
                  <td className="r">{c.bid === null ? "—" : price(c.bid)}</td>
                  <td className="r">{c.chg24 === null ? "—" : <Pol v={c.chg24}>{pct(c.chg24, 1, true)}</Pol>}</td>
                  <td className="r">{c.lots.length}/{cfg.max_lots_per_coin}</td>
                  <td className="r">{c.lots.length ? <Pol v={bag}>{signedUsd(bag)}</Pol> : "—"}</td>
                  <td className="r">{c.closed}</td>
                  <td className="r">{c.closed ? <Pol v={c.net}>{signedUsd(c.net)}</Pol> : "—"}</td>
                  <td className="muted">{c.blocked ?? "open"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Lots sold <span className="panel__hint">newest first</span></h2>
        <table>
          <thead><tr><th>When</th><th>Coin</th><th className="r">Entry</th><th className="r">Exit</th><th className="r">Hold</th><th className="r">Net</th></tr></thead>
          <tbody>
            {L.closed.length === 0 && <tr><td colSpan={6} className="muted">no lot sold yet (each coin is watched 3 minutes before its first lot)</td></tr>}
            {[...L.closed].reverse().slice(0, 30).map((x) => (
              <tr key={x.id}>
                <td className="muted">{ago(x.close, now)}</td>
                <td>{x.coin}</td>
                <td className="r">{price(x.entry)}</td>
                <td className="r">{price(x.exit)}</td>
                <td className="r">{mins(x.hold_s)}</td>
                <td className="r"><Pol v={x.net}>{signedUsd(x.net)}</Pol></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">{p.status.decider}</p>
      </section>
    </>
  );
}

function MetaPanels({ p, m, now }: { p: Performance; m: MetaInfo; now: number }) {
  const c = m.config;
  const live = m.radar.filter((r) => r.status !== "rejected").slice(0, 20);
  const counts = m.radar.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const rejects = Object.entries(
    m.radar.filter((r) => r.status === "rejected").reduce<Record<string, number>>((acc, r) => {
      acc[r.why || "other"] = (acc[r.why || "other"] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const near = m.radar.filter((r) => r.status === "rejected" && r.score > 0 && r.mc > 0).slice(0, 10);
  const metaIcons = (r: { has_desc?: boolean; website?: string; twitter?: string }) => (
    <span className="muted">
      {r.has_desc ? "📝" : "·"}{" "}
      {r.website ? <a href={r.website} target="_blank" rel="noreferrer">🌐</a> : "·"}{" "}
      {r.twitter ? <a href={r.twitter} target="_blank" rel="noreferrer">𝕏</a> : "·"}
    </span>
  );
  return (
    <>
      {m.mode === "rug" && m.gate && <RugGatePanel p={p} m={m} g={m.gate} />}
      {(m.mode as string) === "copy" && (m as unknown as CopyInfo).copy && <CopyDeskPanels p={p} m={m} c={(m as unknown as CopyInfo).copy as CopyBlock} now={now} />}
      <section className="panel" style={m.mode === "rug" || (m.mode as string) === "copy" ? { display: "none" } : undefined}>
        <h2>Strategy 12 <span className="panel__hint">{p.status.decider} · paper · own {usd(c.start_balance, false)}</span></h2>
        <p className="strategy__what">
          New memecoins whose teams have already put up a description, a website or an X account (DexScreener&apos;s
          token profile / Enhanced Token Info, which aggregators and the Coinbase app&apos;s token pages pick up) look legitimate
          and get seen early. Every minute the bot pulls the newest token profiles, community takeovers and boosts on{" "}
          {(c.chains ?? [c.chain]).join(" and ")}, and buys every coin that has at least one of them (more metadata goes first), a market cap between{" "}
          {compactUsd(c.min_mc)} and {compactUsd(c.max_entry_mc)}, a pair younger than {c.max_age_h} hours, a pool of at least{" "}
          {compactUsd(c.min_liquidity)} and some trading in the last hour - {pct(c.position_frac, 0)} of equity each (never more than{" "}
          {pct(c.max_liq_frac, 0)} of the pool), up to {c.max_open} at once. There is no fixed target: held coins are re-priced every{" "}
          {c.manage_interval_s} seconds, and once a coin is {pct(c.trail_arm ?? 0.3, 0, true)} a trailing stop follows its peak and sells
          when it gives back {pct(c.trail_start ?? 0.25, 0)} from the top - {pct(c.trail_step ?? 0.05, 0)} less per doubling (floor{" "}
          {pct(c.trail_min ?? 0.12, 0)}), only {pct(c.trail_tight ?? 0.08, 0)} above {compactUsd(c.target_mc)} market cap. If sellers take over
          (5-minute buy/sell ratio {num(c.fade_buy_ratio ?? 0.7, 1)} or less) after a {pct(c.fade_min_gain ?? 0.5, 0, true)} run, it bails even earlier.
        </p>
        <div className="rules">
          <span className="rule rule--gain">trail from the peak after {pct(c.trail_arm ?? 0.3, 0, true)}: {pct(c.trail_start ?? 0.25, 0)} → {pct(c.trail_min ?? 0.12, 0)}</span>
          <span className="rule rule--gain">{pct(c.trail_tight ?? 0.08, 0)} trail above {compactUsd(c.target_mc)}</span>
          <span className="rule">fade exit: sellers take over</span>
          <span className="rule">re-priced every {c.manage_interval_s}s</span>
          <span className="rule rule--loss">stop {pct(c.stop_loss, 0, true)}</span>
          <span className="rule rule--loss">rug exit: liquidity −{pct(c.rug_liquidity_drop, 0)}</span>
          <span className="rule">time stop {fmtAge(c.max_hold_h * 60)}</span>
          <span className="rule">no re-entry {c.reentry_block_h}h</span>
          <span className="rule rule--loss">kill at {pct(-c.max_drawdown, 0)} · day stop {pct(-c.max_daily_loss, 0)}</span>
        </div>
        <p className="empty">
          No backtest exists (DexScreener keeps no history of when a profile appeared), so this paper book is the test.
          Fills use the same AMM model as Strategy 2: pool-depth price impact, {pct(c.dex_fee, 1)} DEX fee, {usd(c.priority_fee_usd)} per
          swap and {pct(c.latency_slip, 0)} latency slippage each way. The stop, rug exit and time stop are safety additions to the
          buy-under-$1M / sell-after-the-peak rule. "Seconds after the peak" is limited by DexScreener&apos;s own refresh lag.
        </p>
        <div className="scanmeta">
          <span><b>{m.radar.length}</b> coins on radar</span>
          <span><b>{counts.candidate ?? 0}</b> targets</span>
          <span><b>{counts.held ?? 0}</b> held</span>
          <span><b>{counts.rejected ?? 0}</b> rejected</span>
          <span><b>{num(m.scanned_total, 0)}</b> pairs scanned total</span>
          <span>last scan <b>{m.last_scan_ms ? ago(m.last_scan_ms, now) : "pending"}</b></span>
          <span><b>{usd(m.deployed ?? 0, false)}</b> deployed</span>
          {m.kill_reason && <span className="pol pol--loss">⛔ {m.kill_reason}</span>}
          {m.last_error && <span className="pol pol--loss">⚠ {m.last_error}</span>}
        </div>
        {rejects.length > 0 && (
          <p className="empty">Rejected by filter: {rejects.map(([w, n]) => `${w} ${n}`).join(" · ")}</p>
        )}
      </section>

      <section className="panel">
        <h2>Metadata Movers holdings <span className="panel__hint">{m.holdings.length} of {c.max_open} slots · sells seconds after the peak</span></h2>
        {m.holdings.length === 0 ? (
          <p className="empty">No open positions. Cash waits for a new coin with a description, website or X link under {compactUsd(c.max_entry_mc)}.</p>
        ) : (
          <table>
            <thead><tr><th>Token</th><th>Chain</th><th className="r">Cost</th><th className="r">Entry mc</th><th className="r">Mc now</th><th className="r">Peak mc</th><th className="r">Return</th><th className="r">Sells below</th><th className="r">Pool</th><th className="r">Held</th><th>Links</th></tr></thead>
            <tbody>
              {m.holdings.map((h) => (
                <tr key={h.key}>
                  <td className="coin">{h.url ? <a href={h.url} target="_blank" rel="noreferrer">${h.symbol}</a> : `$${h.symbol}`}</td>
                  <td className="muted">{h.chain ?? "—"}</td>
                  <td className="r">{usd(h.cost_usd, false)}</td>
                  <td className="r muted">{compactUsd(h.entry_mc ?? 0)}</td>
                  <td className="r">{compactUsd(h.last_mc ?? 0)}</td>
                  <td className="r muted">{compactUsd(h.peak_mc ?? 0)}</td>
                  <td className="r"><b><Pol v={h.ret}>{pct(h.ret, 1, true)}</Pol></b></td>
                  <td className="r">{h.trail_armed && h.trail_exit_px ? `$${price(h.trail_exit_px)} (−${pct(h.trail_pct ?? 0, 0)})` : <span className="muted">not armed</span>}</td>
                  <td className="r muted">{compactUsd(h.last_liquidity)}</td>
                  <td className="r muted">{fmtAge((now - h.opened_ms) / 60000)}</td>
                  <td>{metaIcons({ has_desc: true, website: h.website, twitter: h.twitter })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Radar <span className="panel__hint">targets, held and cooling-down coins right now · 📝 description · 🌐 website · 𝕏 account</span></h2>
        {live.length === 0 ? (
          <p className="empty">No coin with metadata under {compactUsd(c.max_entry_mc)} this minute. The bot waits.</p>
        ) : (
          <table>
            <thead><tr><th>Token</th><th>Chain</th><th>Status</th><th className="r">Market cap</th><th className="r">Age</th><th className="r">Pool</th><th className="r">1h</th><th>Metadata</th></tr></thead>
            <tbody>
              {live.map((r) => (
                <tr key={`${r.chain}-${r.token}`} className={r.status === "held" ? "row--held" : r.status === "candidate" ? "row--live" : ""}>
                  <td className="coin">{r.url ? <a href={r.url} target="_blank" rel="noreferrer">${r.symbol}</a> : `$${r.symbol}`}</td>
                  <td className="muted">{r.chain ?? "—"}</td>
                  <td><StatusPill s={r.status} /></td>
                  <td className="r">{compactUsd(r.mc)}</td>
                  <td className="r">{fmtAge(r.age_min)}</td>
                  <td className="r">{compactUsd(r.liquidity)}</td>
                  <td className="r"><Pol v={r.chg1h}>{pct(r.chg1h / 100, 0, true)}</Pol></td>
                  <td>{metaIcons(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {near.length > 0 && (
          <p className="empty">Has metadata but filtered out: {near.map((r) => `$${r.symbol} ${compactUsd(r.mc)} (${r.why})`).join(" · ")}</p>
        )}
      </section>
    </>
  );
}

// =============================================================================================
// Idea-lab panels: the idea, its research, today's scores and live pairs
// =============================================================================================
function IdeaPanels({ p, idea }: { p: Performance; idea: IdeaInfo }) {
  const bt = idea.backtest;
  const scores = Object.entries(idea.state?.scores_apr_pct ?? {});
  const held = new Set(idea.state?.held ?? []);
  const maxScore = Math.max(20, ...scores.map(([, v]) => Math.abs(v)));
  const weights = idea.state?.weights ?? {};
  const signals = Object.entries(idea.state?.signal ?? {}).sort((a, b) => b[1] - a[1] || (weights[b[0]] ?? 0) - (weights[a[0]] ?? 0));
  return (
    <>
      <section className="panel">
        <h2>Strategy {idea.n} <span className="panel__hint">idea lab · added {idea.date} · own {usd(p.start_balance, false)} paper book</span></h2>
        <p className="strategy__what">{idea.rule}</p>
        <p className="empty">
          Research: {idea.source_url ? <a href={idea.source_url} target="_blank" rel="noreferrer">{idea.source}</a> : idea.source}
          {idea.last_rebalance_day ? ` · last rebalance ${idea.last_rebalance_day}` : ""}
          {idea.kill_reason ? ` · KILLED: ${idea.kill_reason}` : ""}
          {idea.last_error ? ` · last error: ${idea.last_error}` : ""}
        </p>
        {bt && (
          <div className="study">
            <div className="study__head">
              <b>Backtest</b> · {bt.period ?? ""} · after fees, spreads and real funding
            </div>
            <table>
              <thead><tr><th>Test</th><th className="r">Sharpe</th><th className="r">95% CI</th><th className="r">Return / yr</th><th className="r">Max DD</th></tr></thead>
              <tbody>
                <tr><td>Fixed rule (all data out of sample)</td><td className="r">{num(bt.sharpe ?? null, 1)}</td>
                  <td className="r muted">{bt.ci95 ? `${num(bt.ci95[0], 1)} … ${num(bt.ci95[1], 1)}` : "—"}</td>
                  <td className="r">{bt.ret_yr_pct === undefined ? "—" : `${num(bt.ret_yr_pct, 1)}%`}</td>
                  <td className="r">{bt.max_dd_pct === undefined ? "—" : `${num(bt.max_dd_pct, 2)}%`}</td></tr>
                {bt.walk_forward_sharpe !== undefined && (
                  <tr><td>Walk-forward (tuned on past, traded blind)</td><td className="r">{num(bt.walk_forward_sharpe, 1)}</td>
                    <td className="r muted">—</td><td className="r">{bt.walk_forward_ret_yr_pct === undefined ? "—" : `${num(bt.walk_forward_ret_yr_pct, 1)}%`}</td><td className="r muted">—</td></tr>
                )}
              </tbody>
            </table>
            <p className="empty">
              {bt.placebo_p !== undefined ? `Beats random coin picks (p = ${bt.placebo_p}). ` : ""}
              {bt.by_year_ret_pct ? `By year: ${Object.entries(bt.by_year_ret_pct).map(([y, v]) => `${y} ${v}%`).join(" · ")}. ` : ""}
              {bt.caveat ?? ""}
            </p>
          </div>
        )}
      </section>
      {bt?.risk_dial && typeof bt.risk_dial === "object" && (
        <section className="panel">
          <h2>Risk dial <span className="panel__hint">same rules, different leverage · live setting marked</span></h2>
          <table>
            <thead><tr><th>Volatility target</th><th className="r">Sharpe</th><th className="r">Return / yr</th><th className="r">Max DD</th></tr></thead>
            <tbody>
              {Object.entries(bt.risk_dial as Record<string, { sharpe: number; ret_yr_pct: number; max_dd_pct: number }>).map(([k, r]) => (
                <tr key={k} className={k.includes("live") ? "row--live" : ""}>
                  <td className="coin">{k}</td><td className="r">{num(r.sharpe, 2)}</td>
                  <td className="r">{num(r.ret_yr_pct, 1)}%</td><td className="r">{num(r.max_dd_pct, 1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {signals.length > 0 && (
        <section className="panel">
          <h2>Breakout board <span className="panel__hint">share of the nine breakout systems that are long · weight = % of equity · book ×{num(idea.state?.scale ?? 0, 2)}, {num(idea.state?.gross ?? 0, 2)}x gross</span></h2>
          <div className="targets">
            {signals.map(([coin, v]) => (
              <div key={coin} className={`target ${v > 0 ? "target--held" : ""}`}>
                <span className="coin">{coin}</span>
                <div className="target__bar"><i style={{ width: `${Math.min(100, v * 100)}%` }} /></div>
                <span className="target__num">{Math.round(v * 9)}/9 long · {num((weights[coin] ?? 0) * 100, 1)}%</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {scores.length > 0 && (
        <section className="panel">
          <h2>Today&apos;s funding scores <span className="panel__hint">7-day average funding paid to shorts, % a year · ◆ = held</span></h2>
          <div className="targets">
            {scores.map(([coin, v]) => (
              <div key={coin} className={`target ${held.has(coin) ? "target--held" : ""}`}>
                <span className="coin">{held.has(coin) ? "◆ " : ""}{coin}</span>
                <div className="target__bar"><i style={{ width: `${Math.min(100, (Math.max(0, v) / maxScore) * 100)}%` }} /></div>
                <span className="target__num">{num(v, 1)}% / yr</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// =============================================================================================
// Strategy 7 panels (Kalshi scalper)
// =============================================================================================
function KalshiPanels({ k, now }: { k: KalshiInfo; now: number }) {
  const s = k.summary;
  const c = k.config;
  const ctl = k.control;
  return (
    <>
      <section className="panel">
        <h2>Strategy 7 <span className="panel__hint">Kalshi · paper · own $10,000 · positions opened and closed within seconds</span></h2>
        <p className="strategy__what">
          &quot;Buy, then sell right away&quot; pays the whole bid/ask spread plus two taker fees on every round trip, so the naive version
          loses by construction. This book does the only in-and-out version that can win: it buys at the bid and sells at the
          ask as a resting order on the {c.max_markets ?? 20} busiest Kalshi markets. On tight books it joins the back of the best-bid queue
          (it only fills after every contract resting ahead of it has traded); on books {Math.round((c.improve_spread ?? 0.03) * 100)}¢+ wide it steps
          one cent inside. The moment the public trade tape says it filled, it offers the contracts back one cent higher (or in the
          best-ask queue). If nobody takes the offer within {c.max_hold_s ?? 120}s, or the bid drops {c.stop_cents ?? 3}¢ under the entry,
          it sells into the bid as a taker. About {usd(c.order_usd ?? 400, false)} per quote, up to {usd(c.max_open_usd ?? 4000, false)} working at once.
        </p>
        <div className="vs">
          <div className="vs__card vs__card--bad">
            <div className="vs__label">Naive in-and-out (control, never traded)</div>
            <div className="vs__num pol pol--loss">{ctl.pnl_per_contract_c === null ? "—" : `${ctl.pnl_per_contract_c.toFixed(2)}¢`}</div>
            <div className="vs__sub">per contract · buy at the ask, sell at the bid, two taker fees · measured {num(ctl.n, 0)} times</div>
          </div>
          <div className="vs__card">
            <div className="vs__label">Spread harvest (what this book trades)</div>
            <div className={`vs__num pol pol--${s.pnl_per_contract_c === null ? "flat" : s.pnl_per_contract_c > 0 ? "gain" : "loss"}`}>
              {s.pnl_per_contract_c === null ? "—" : `${s.pnl_per_contract_c > 0 ? "+" : ""}${s.pnl_per_contract_c.toFixed(2)}¢`}
            </div>
            <div className="vs__sub">per contract after fees · {s.round_trips} round trips · win rate {s.win_rate === null ? "—" : pct(s.win_rate, 0)}
              {" "}· avg hold {s.avg_hold_s === null ? "—" : `${Math.round(s.avg_hold_s)}s`} · {s.maker_exit_share === null ? "—" : pct(s.maker_exit_share, 0)} exited as maker</div>
          </div>
        </div>
        <div className="scanmeta">
          <span><b>{k.markets.length}</b> markets worked</span>
          <span><b>{num(s.quotes, 0)}</b> bids quoted</span>
          <span><b>{num(s.entry_fills, 0)}</b> filled</span>
          <span><b>{num(s.cancels, 0)}</b> cancelled / re-pegged</span>
          <span><b>{num(s.maker_exits, 0)}</b> maker exits · <b>{num(s.taker_exits, 0)}</b> taker bail-outs</span>
          <span>last tick <b>{k.last_step_ms ? ago(k.last_step_ms, now) : "—"}</b></span>
          {k.kill_reason && <span className="pol pol--loss">⛔ {k.kill_reason}</span>}
          {k.last_error && <span className="pol pol--loss">⚠ {k.last_error}</span>}
        </div>
        <p className="empty">
          Paper fills are earned from the real tape: a bid fills only when a later trade shows a seller at or through our price
          (and only after every contract queued ahead of it has traded), never before a {c.latency_s ?? 1}s latency, and never for more contracts
          than actually traded. Fees follow Kalshi&apos;s schedule (taker 0.07·C·P·(1−P), maker 0.0175·C·P·(1−P), rounded up to the cent),
          with the maker fee applied only on series whose fee schedule charges makers. Why makers: Kalshi&apos;s own data show takers
          losing ~32% on average vs ~10% for makers (<a href={k.source_url} target="_blank" rel="noreferrer">{k.source}</a>).
        </p>
      </section>

      <section className="panel">
        <h2>Markets on the board <span className="panel__hint">the most active open markets with a wide spread · refreshed every 10 minutes</span></h2>
        {k.markets.length === 0 ? (
          <p className="empty">No open market has a 3¢+ spread with enough volume right now. The scalper waits.</p>
        ) : (
          <table>
            <thead><tr><th>Market</th><th className="r">Bid</th><th className="r">Ask</th><th className="r">Spread</th><th className="r">24h vol</th><th>Our order</th><th className="r">Held</th><th className="r">Closes</th></tr></thead>
            <tbody>
              {k.markets.map((m) => (
                <tr key={m.ticker} className={m.held > 0 ? "row--held" : m.stage === "bidding" ? "row--live" : ""}>
                  <td className="why" title={`${m.ticker} · ${m.title}`}>{m.title}</td>
                  <td className="r">{Math.round((m.bids[0]?.[0] ?? m.bid) * 100)}¢</td>
                  <td className="r">{Math.round((m.asks[0]?.[0] ?? m.ask) * 100)}¢</td>
                  <td className="r">{Math.round(((m.asks[0]?.[0] ?? m.ask) - (m.bids[0]?.[0] ?? m.bid)) * 100)}¢</td>
                  <td className="r muted">{num(m.vol24, 0)}</td>
                  <td>{m.our_bid !== null ? <span className="pill pill--watch">BID {Math.round(m.our_bid * 100)}¢</span>
                    : m.our_ask !== null ? <span className="pill pill--held">OFFER {Math.round(m.our_ask * 100)}¢</span> : "—"}</td>
                  <td className="r">{m.held > 0 ? `${num(m.held, 0)} @ ${Math.round((m.entry ?? 0) * 100)}¢` : "—"}</td>
                  <td className="r muted">{m.hours_to_close}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Recent round trips <span className="panel__hint">in → out, after fees</span></h2>
        {k.round_trips.length === 0 ? (
          <p className="empty">No completed round trips yet.</p>
        ) : (
          <table>
            <thead><tr><th>Closed</th><th>Market</th><th className="r">Contracts</th><th className="r">In</th><th className="r">Out</th><th className="r">Held</th><th>Exit</th><th className="r">P&amp;L</th></tr></thead>
            <tbody>
              {[...k.round_trips].reverse().slice(0, 25).map((r, i) => (
                <tr key={`${r.ticker}-${r.t_close}-${i}`}>
                  <td className="muted">{when(r.t_close * 1000)}</td>
                  <td className="why" title={r.ticker}>{r.title || r.ticker}</td>
                  <td className="r">{num(r.qty, 0)}</td>
                  <td className="r">{Math.round(r.entry * 100)}¢</td>
                  <td className="r">{(r.exit * 100).toFixed(1)}¢</td>
                  <td className="r muted">{Math.round(r.hold_s)}s</td>
                  <td>{r.how === "maker" ? <span className="pill pill--watch">MAKER</span> : <span className="pill pill--rejected">TAKER BAIL</span>}</td>
                  <td className="r"><b><Pol v={r.pnl}>{signedUsd(r.pnl)}</Pol></b></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

// =============================================================================================
// Page
// =============================================================================================
export default function Dashboard({ initial }: { initial: PerfResponse }) {
  const [data, setData] = useState<PerfResponse>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [slide, setSlide] = useState(0);
  const [dir, setDir] = useState<"left" | "right">("right");
  // Both 3D scenes stay mounted once visited (unmounting a canvas with HTML overlays mid-render
  // breaks React's DOM bookkeeping); the hidden one stops rendering frames.
  const [visited, setVisited] = useState<Record<SlideKey, boolean>>({ trend: true });

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/api/perf", { cache: "no-store" });
        if (r.ok && alive) setData(await r.json());
      } catch {
        /* keep last good data */
      }
    };
    const a = setInterval(pull, POLL_MS);
    const b = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const sniperReal = data.perf.strategies?.sniper;
  const sniperDemo = !sniperReal?.sniper;
  const sniperPerf = useMemo(
    () => (sniperReal?.sniper ? sniperReal : demoSniperPerf(data.perf.updated_ms)),
    [sniperReal, data.perf.updated_ms],
  );

  const SLIDES = useMemo(() => buildSlides(data.perf), [data.perf]);
  const slideIdx = Math.min(slide, SLIDES.length - 1);
  const slideKey = SLIDES[slideIdx].key;
  const isSniper = slideKey === "sniper";
  const isKalshi = slideKey === "kalshi";
  const isRug = slideKey === "rugsniper";
  const isCopy = slideKey === "copydesk";
  const isLot = slideKey === "lotladder";
  const lotPerf = (data.perf.strategies as Record<string, Performance | undefined> | undefined)?.lotladder;
  const lotInfo = (lotPerf as unknown as { lots?: LotInfo } | undefined)?.lots;
  const isMeta = slideKey === "metasniper" || isRug || isCopy;
  const metaPerf = data.perf.strategies?.metasniper;
  const rugPerf = data.perf.strategies?.rugsniper;
  const copyPerf = (data.perf.strategies as Record<string, Performance | undefined> | undefined)?.copydesk;
  const kalshiPerf = data.perf.strategies?.kalshi;
  const ideaPerf = slideKey.startsWith("idea:") ? data.perf.strategies?.[slideKey as `idea:${string}`] : undefined;
  const idea = ideaPerf?.idea;
  const isIdea = !!(ideaPerf && idea);
  const p: Performance = isSniper ? sniperPerf : isKalshi && kalshiPerf ? kalshiPerf : isRug && rugPerf ? rugPerf : isCopy && copyPerf ? copyPerf : isLot && lotPerf ? lotPerf : isMeta && metaPerf ? metaPerf
    : isIdea ? (ideaPerf as Performance) : data.perf;
  const meta = isMeta && p.sniper ? (p.sniper as unknown as MetaInfo) : undefined;
  const kal = isKalshi ? p.kalshi : undefined;
  const sn = isSniper ? p.sniper : undefined;
  const t = p.trades;

  const go = (step: number) => {
    const next = (slideIdx + step + SLIDES.length) % SLIDES.length;
    setDir(step > 0 ? "right" : "left");
    setVisited((v) => ({ ...v, [SLIDES[next].key]: true }));
    setSlide(next);
  };

  const age = now - p.updated_ms;
  const staleAfter = data.source === "snapshot" ? 90 * 60_000 : isIdea ? IDEA_STALE_AFTER_MS : STALE_AFTER_MS;
  const state = data.source === "demo" || (isSniper && sniperDemo) ? "demo" : age > staleAfter ? "offline" : "live";
  const stateLabel = {
    live: data.source === "snapshot" ? "LIVE · 30-MIN SNAPSHOTS" : "LIVE",
    offline: "OFFLINE",
    demo: isSniper && sniperDemo && data.source !== "demo" ? "SAMPLE DATA" : "DEMO DATA",
  }[state];
  const stateNote =
    state !== "demo" ? `updated ${ago(p.updated_ms, now)}`
      : isSniper && data.source !== "demo" ? "sniper just launched — first live scan lands with the next snapshot"
        : "bot hasn't reported yet — showing a simulated run";

  const dailyMax = useMemo(() => Math.max(1, ...p.daily.map((d) => Math.abs(d.pnl))), [p.daily]);
  const since = p.curve.length ? p.curve[0][0] : p.updated_ms;
  const tickerItems: [string, string][] = isSniper
    ? (sn?.radar ?? []).filter((r) => r.status !== "rejected").slice(0, 24).map((r) => [`$${r.symbol}`, `${pct(r.chg5 / 100, 1, true)} · ${r.score.toFixed(2)}`])
    : isMeta
      ? (meta?.radar ?? []).filter((r) => r.status !== "rejected").slice(0, 24).map((r) => [`$${r.symbol}`, `${compactUsd(r.mc)} mc · ${r.chain ?? ""}`])
    : isKalshi
      ? (kal?.markets ?? []).map((m) => [m.ticker, `${Math.round((m.bids[0]?.[0] ?? m.bid) * 100)}¢ / ${Math.round((m.asks[0]?.[0] ?? m.ask) * 100)}¢`])
    : isIdea
      ? Object.entries(idea?.state?.scores_apr_pct ?? {}).map(([c, v]) => [c, `${num(v, 1)}% / yr funding`])
      : Object.entries(p.status.prices ?? {}).map(([c, px]) => [c, price(px)]);

  return (
    <main className={`page page--${isIdea ? "idea" : slideKey}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden>◆</span>
          <span className="brand__name">JEV<span className="brand__slash">/</span>AGENT</span>
          <span className="brand__sub">
            {isSniper
              ? "paper trading · Solana DEX memecoins · DexScreener radar"
              : isKalshi ? "paper trading · Kalshi prediction markets · public order books + trade tape"
              : isLot ? "paper trading · OKX spot · Rob's STRAFE HELM lot engine (run #5 rules) on live prices"
              : isCopy ? "paper trading · copy trading · fomo's top wallets on Solana, Robinhood Chain and Base → hard facts → Grok verdict"
              : isRug ? "paper trading · Solana memecoins · DexScreener profiles behind Rugcheck's fact checks"
              : isMeta ? "paper trading · Solana + Base memecoins · DexScreener profiles (description, website or X)"
              : isIdea ? `paper trading · idea lab · ${idea?.venue ?? "hyperliquid"}`
              : `paper trading · Hyperliquid perps · decisions by ${p.status.decider ?? (p.status.jev === "jev" ? "Jev" : "mock Jev")}`}
          </span>
        </div>
        <div className="status">
          {p.status.kill && <span className="badge badge--critical">⛔ KILL SWITCH ARMED</span>}
          <span className={`badge badge--${state}`}>
            <span className="badge__dot" aria-hidden>{state === "live" ? "●" : state === "offline" ? "○" : "◌"}</span>
            {stateLabel}
          </span>
          <span className="status__ago">{stateNote}</span>
        </div>
      </header>

      <Carousel slides={SLIDES} slide={slideIdx} onPrev={() => go(-1)} onNext={() => go(1)}
        equities={SLIDES.map((s) => s.key === "trend" ? data.perf.equity
          : s.key === "sniper" ? (sniperDemo ? null : sniperPerf.equity)
          : s.key === "kalshi" ? (kalshiPerf?.equity ?? null)
          : s.key === "metasniper" ? (metaPerf?.equity ?? null)
          : s.key === "rugsniper" ? (rugPerf?.equity ?? null)
          : s.key === "copydesk" ? (copyPerf?.equity ?? null)
          : s.key === "lotladder" ? (lotPerf?.equity ?? null)
            : data.perf.strategies?.[s.key as `idea:${string}`]?.equity ?? null)} />

      <div key={slideKey} className={`slide slide--from-${dir}`}>
        {tickerItems.length > 0 && (
          <div className="ticker" aria-label={isSniper ? "Radar" : "Latest prices"}>
            <div className="ticker__track">
              {[...tickerItems, ...tickerItems].map(([c, v], i) => (
                <span key={`${c}-${i}`} className="ticker__item"><b>{c}</b> {v}</span>
              ))}
            </div>
          </div>
        )}

        <section className="hero">
          <div>
            <div className="hero__label">{isSniper ? "Sniper paper equity" : isKalshi ? "Strategy 7 paper equity" : isRug ? "Strategy 23 paper equity" : isCopy ? "Strategy 25 paper equity" : isLot ? "Strategy 26 paper equity" : isMeta ? "Strategy 12 paper equity" : isIdea ? `Strategy ${idea?.n} paper equity` : "Paper equity"}</div>
            <div className="hero__equity">{usd(p.equity)}</div>
            <div className="hero__pnl">
              <Pol v={p.pnl}>{arrow(p.pnl)} {signedUsd(p.pnl)} ({pct(p.pnl_pct, 2, true)})</Pol>
              <span className="hero__since">since {when(since)} · started with {usd(p.start_balance, false)}</span>
            </div>
          </div>
          {isSniper ? (
            <div className="legend" aria-label="Legend">
              <span><i className="swatch swatch--score" /> snipe score low → high</span>
              <span><i className="swatch swatch--held" /> held</span>
              <span><i className="swatch swatch--zone" /> snipe zone</span>
              <span><i className="swatch swatch--reject" /> rejected</span>
              <span className="legend__note">x: pair age · y: 5-minute move · depth: buy pressure · size: liquidity · lines link nearest neighbours · drag to orbit, hover a token</span>
            </div>
          ) : isLot ? (
            <div className="legend" aria-label="Legend">
              <span><i className="swatch swatch--zone" /> live price</span>
              <span><i className="swatch swatch--gain" /> lot above price (waiting to sell)</span>
              <span><i className="swatch swatch--loss" /> bag (lot under water, held by never-loss)</span>
              <span><i className="swatch swatch--held" /> maker target</span>
              <span className="legend__note">one glass tube per coin · discs: $50 lots at their entry price, 2% per step from the live price · gold ticks: where each lot sells for +$0.40 net (lower as it ages) · green sparks: lots sold in the last 15 min · drag to orbit, hover a tube</span>
            </div>
          ) : isCopy ? (
            <div className="legend" aria-label="Legend">
              <span><i className="swatch swatch--held" /> leader (copied)</span>
              <span><i className="swatch swatch--carry-low" /> candidate (tape only)</span>
              <span><i className="swatch swatch--gain" /> buy copied</span>
              <span><i className="swatch swatch--loss" /> buy refused</span>
              <span className="legend__note">outer ring: every wallet watched (size = fomo followers) · comets: their buys flying to the gate · teal ring: Rugcheck facts · violet ring: Grok&apos;s verdict · planets above: our open copies (green up, orange down) · drag to orbit, hover a trader</span>
            </div>
          ) : isKalshi ? (
            <div className="legend" aria-label="Legend">
              <span><i className="swatch swatch--gain" /> YES bids</span>
              <span><i className="swatch swatch--loss" /> YES asks</span>
              <span><i className="swatch swatch--zone" /> the spread we harvest</span>
              <span><i className="swatch swatch--held" /> our offer / position</span>
              <span className="legend__note">one tower per market (0¢ floor → 100¢ top) · cyan ring: our resting bid · loops: finished round trips from entry to exit, green = profit, dashed = taker bail-out · drag to orbit, hover a tower</span>
            </div>
          ) : isIdea && p.scene?.kind === "channels" ? (
            <div className="legend" aria-label="Legend">
              <span><i className="swatch swatch--held" /> price, long</span>
              <span><i className="swatch swatch--zone" /> 20-day channel</span>
              <span><i className="swatch swatch--outer" /> 90-day channel</span>
              <span><i className="swatch swatch--loss" /> stop-out</span>
              <span className="legend__note">one lane per coin (strongest in front) · x: last 90 days · gold cones: breakouts (bigger = longer lookback) · right: nine breakout lights 5d→360d and today&apos;s weight · drag to orbit, hover a lane</span>
            </div>
          ) : isIdea && p.scene?.kind === "jumps" ? (
            <div className="legend" aria-label="Legend">
              <span><i className="swatch swatch--carry-high" /> coin-specific jump</span>
              <span><i className="swatch swatch--gain" /> drift after it, up</span>
              <span><i className="swatch swatch--loss" /> drift after it, down</span>
              <span><i className="swatch swatch--held" /> days held</span>
              <span className="legend__note">one lane per altcoin · depth: last 120 days, newest in front · line: each coin&apos;s move after stripping out Bitcoin, in sigmas · spires: jumps above the {p.scene.threshold}-sigma plane, arcs: the next {p.scene.hold_days} days · front row: today · drag to orbit, hover a spire</span>
            </div>
          ) : isIdea && p.scene?.kind === "echo" ? (
            <div className="legend" aria-label="Legend">
              <span><i className="swatch swatch--carry-high" /> market 4h move up</span>
              <span><i className="swatch swatch--loss" /> market 4h move down</span>
              <span><i className="swatch swatch--held" /> echo trade (arc from the bar 24h earlier)</span>
              <span><i className="swatch swatch--gain" /> trade won</span>
              <span className="legend__note">one row per UTC day (last 60 days, newest in front) · six columns: the 4h bars at 00-20 UTC · the bar behind each column is the same slot 24h earlier, the one leaving the &quot;24h change&quot; · when it was a {p.scene.thr}-sigma move the book trades against it for 4h at {p.scene.lev ?? 3}x · front ring: the live reading · drag to orbit, hover a column</span>
            </div>
          ) : isIdea && p.scene?.kind === "spotlight" ? (
            <div className="legend" aria-label="Legend">
              <span><i className="swatch swatch--carry-high" /> volume far above normal</span>
              <span><i className="swatch swatch--gain" /> move vs BTC after a spotlight, up</span>
              <span><i className="swatch swatch--loss" /> down</span>
              <span><i className="swatch swatch--held" /> days held</span>
              <span className="legend__note">one row per altcoin · depth: last 90 days, newest in front · column height: dollar volume vs its 30-day normal (log scale) · searchlights: top-20% coins above the {p.scene.threshold}x plane, arcs: the next {p.scene.hold_days} days vs Bitcoin · front row: today · drag to orbit, hover a beam</span>
            </div>
          ) : isIdea && p.scene?.kind === "rider" ? (
            <div className="legend" aria-label="Legend">
              <span><i className="swatch swatch--carry-high" /> rising (7-day momentum)</span>
              <span><i className="swatch swatch--loss" /> falling</span>
              <span><i className="swatch swatch--held" /> the one coin being ridden</span>
              <span className="legend__note">one lane per dev-vetted coin (purple Solana · blue Base · green Robinhood chain) · depth: last 30 days, every 6h, newest in front · the gold orb replays the ride and hops lanes when a trend breaks · front row: live scores · drag to orbit, hover a bar</span>
            </div>
          ) : isIdea ? (
            <div className="legend" aria-label="Legend">
              <span><i className="swatch swatch--carry-low" /> funding below baseline</span>
              <span><i className="swatch swatch--carry-high" /> rich funding</span>
              <span><i className="swatch swatch--held" /> weeks the strategy held it</span>
              <span><i className="swatch swatch--loss" /> negative funding</span>
              <span className="legend__note">x: coin · depth: week (newest in front, beacons = today) · height: {p.scene?.kind === "terrain" ? p.scene.y_label ?? "value" : "value"} · planes: 11.6% baseline and 15% entry line · drag to orbit, hover a bar</span>
            </div>
          ) : (
            <div className="legend" aria-label="Legend">
              <span><i className="swatch swatch--gain" /> ▲ gain</span>
              <span><i className="swatch swatch--loss" /> ▼ loss</span>
              <span className="legend__note">Ribbon: equity vs. the {usd(p.start_balance, false)} start · Pillars: net P&amp;L per coin · drag to orbit, hover for detail</span>
            </div>
          )}
        </section>

      </div>

      <section className={`scene ${isSniper ? "scene--sniper" : isIdea || isKalshi || isMeta ? "scene--idea" : ""}`}
        aria-label={isSniper ? "3D cluster map of Solana pairs the sniper is tracking"
          : isKalshi ? "3D order-book towers for the Kalshi markets the scalper works"
          : isLot ? "3D lot elevator: every coin's $50 lots at their entry prices around the live price"
          : isCopy ? "3D relay of fomo traders' buys flying through the Rugcheck and Grok gates"
          : isRug ? "3D market-cap elevator of the Solana memecoins Rugcheck let through"
          : isMeta ? "3D market-cap elevator of new memecoins with metadata, Solana and Base"
          : isIdea ? `3D view for strategy ${idea?.n}: ${p.scene?.title ?? idea?.name}`
            : "3D view of the equity curve and per-coin P&L"}>
        <div className={`scene__layer ${slideKey === "trend" ? "scene__layer--on" : ""}`} aria-hidden={slideKey !== "trend"}>
          <Scene perf={data.perf} active={slideKey === "trend"} />
        </div>
        {visited.sniper && sniperPerf.sniper && (
          <div className={`scene__layer ${isSniper ? "scene__layer--on" : ""}`} aria-hidden={!isSniper}>
            <SniperScene sniper={sniperPerf.sniper} demo={sniperDemo} active={isSniper} />
          </div>
        )}
        {visited.kalshi && kalshiPerf?.kalshi && (
          <div className={`scene__layer ${isKalshi ? "scene__layer--on" : ""}`} aria-hidden={!isKalshi}>
            <KalshiScene info={kalshiPerf.kalshi} active={isKalshi} />
          </div>
        )}
        {visited.metasniper && metaPerf?.sniper && (
          <div className={`scene__layer ${isMeta && !isRug && !isCopy ? "scene__layer--on" : ""}`} aria-hidden={!(isMeta && !isRug && !isCopy)}>
            <MetaScene info={metaPerf.sniper as unknown as MetaInfo} active={isMeta && !isRug && !isCopy} />
          </div>
        )}
        {visited.rugsniper && rugPerf?.sniper && (
          <div className={`scene__layer ${isRug ? "scene__layer--on" : ""}`} aria-hidden={!isRug}>
            <MetaScene info={rugPerf.sniper as unknown as MetaInfo} active={isRug} />
          </div>
        )}
        {visited.lotladder && lotInfo && (
          <div className={`scene__layer ${isLot ? "scene__layer--on" : ""}`} aria-hidden={!isLot}>
            <LotScene info={lotInfo} active={isLot} />
          </div>
        )}
        {visited.copydesk && copyPerf?.sniper && (
          <div className={`scene__layer ${isCopy ? "scene__layer--on" : ""}`} aria-hidden={!isCopy}>
            <CopyScene info={copyPerf.sniper as unknown as CopyInfo} active={isCopy} />
          </div>
        )}
        {SLIDES.filter((s) => s.key.startsWith("idea:") && visited[s.key]).map((s) => (
          <div key={s.key} className={`scene__layer ${slideKey === s.key ? "scene__layer--on" : ""}`} aria-hidden={slideKey !== s.key}>
            <IdeaScene scene={data.perf.strategies?.[s.key as `idea:${string}`]?.scene} active={slideKey === s.key} />
          </div>
        ))}
      </section>

      <div key={`${slideKey}-body`} className={`slide slide--from-${dir}`}>
        <section className="stats">
          <Stat label="Total P&L" value={signedUsd(p.pnl)} v={p.pnl} sub={pct(p.pnl_pct, 2, true)} />
          <Stat label="Realized" value={signedUsd(p.realized)} v={p.realized} sub="price P&L on closed size" />
          <Stat label="Unrealized" value={signedUsd(p.unrealized)} v={p.unrealized} sub={`${t.open} open position${t.open === 1 ? "" : "s"}`} />
          {isSniper || isMeta ? (
            <Stat label="Swap costs" value={signedUsd(-p.fees)} v={-p.fees} sub="DEX fee + priority fee (impact is in the price)" />
          ) : (
            <Stat label="Fees + funding" value={signedUsd(p.funding - p.fees)} v={p.funding - p.fees}
              sub={`fees ${usd(p.fees)} · funding ${signedUsd(p.funding)}`} />
          )}
          <Stat label="Max drawdown" value={pct(-p.max_drawdown, 2)} sub={`now ${pct(-p.current_drawdown, 2)} · kill switch ${p.risk_limits ? pct(-p.risk_limits.max_drawdown, 0) : "—"}`} />
          <Stat label="Win rate" value={t.win_rate === null ? "—" : pct(t.win_rate, 1)} sub={`${t.wins} W · ${t.losses} L of ${t.closed}`} />
          <Stat label="Profit factor" value={num(t.profit_factor, 2)}
            sub={`avg win ${t.avg_win === null ? "—" : usd(t.avg_win)} · avg loss ${t.avg_loss === null ? "—" : usd(t.avg_loss)}`} />
          <Stat label="Best / worst trade" value={`${t.best === null ? "—" : signedUsd(t.best)}`}
            sub={`worst ${t.worst === null ? "—" : signedUsd(t.worst)}`} v={t.best ?? undefined} />
        </section>

        <BacktestLab focus={SLIDE_TO_BACKTEST[slideKey] ?? null} />

        {isSniper && sn ? <SniperPanels p={p} sn={sn} demo={sniperDemo} now={now} />
          : isKalshi && kal ? <KalshiPanels k={kal} now={now} />
          : isLot && lotInfo ? <LotPanels p={p} L={lotInfo} now={now} />
          : isMeta && meta ? <MetaPanels p={p} m={meta} now={now} />
          : isIdea && idea ? <IdeaPanels p={p} idea={idea} /> : <TrendPanels p={p} />}

        {data.perf.ideas && data.perf.ideas.length > 0 && (
          <section className="panel">
            <h2>Idea lab <span className="panel__hint">one new crypto trading idea researched and tested every day</span></h2>
            <div className="ideas">
              {[...data.perf.ideas].reverse().map((idea) => (
                <div key={`${idea.date}-${idea.name}`} className="idea">
                  <div className="idea__head">
                    <span className="idea__date">{idea.date}</span>
                    <b>{idea.name}</b>
                    <span className="pill pill--watch">{idea.status}</span>
                  </div>
                  <p className="strategy__what">{idea.rule}</p>
                  <p className="empty">{idea.verdict}{idea.sharpe !== undefined && idea.sharpe !== null ? ` · out-of-sample Sharpe ${num(idea.sharpe, 2)}` : ""} · source: {idea.source}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {p.daily.length > 0 && (
          <section className="panel">
            <h2>Daily P&amp;L <span className="panel__hint">UTC days</span></h2>
            <div className="daily" role="list">
              {p.daily.map((d) => {
                const h = (Math.abs(d.pnl) / dailyMax) * 100;
                const pol = polarity(d.pnl);
                return (
                  <div key={d.day} className="daily__col" role="listitem"
                    title={`${d.day}: ${signedUsd(d.pnl)} · equity ${usd(d.equity)}`}>
                    <div className="daily__half daily__half--up">
                      {pol === "gain" && <div className="daily__bar daily__bar--gain" style={{ height: `${h}%` }} />}
                    </div>
                    <div className="daily__half daily__half--down">
                      {pol === "loss" && <div className="daily__bar daily__bar--loss" style={{ height: `${h}%` }} />}
                    </div>
                    <div className="daily__label">{d.day.slice(5)}</div>
                    <div className="daily__value"><Pol v={d.pnl}>{signedUsd(d.pnl, false)}</Pol></div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="grid2">
          <section className="panel">
            <h2>P&amp;L by {isSniper ? "token" : "coin"}</h2>
            {p.per_coin.length === 0 ? (
              <p className="empty">No trades yet.</p>
            ) : (
              <table>
                <thead><tr><th>{isSniper ? "Token" : "Coin"}</th><th className="r">Realized</th><th className="r">Unrealized</th><th className="r">Fees</th><th className="r">Net</th><th className="r">Trades</th></tr></thead>
                <tbody>
                  {p.per_coin.map((c) => (
                    <tr key={c.coin}>
                      <td className="coin">{c.coin}</td>
                      <td className="r"><Pol v={c.realized}>{signedUsd(c.realized)}</Pol></td>
                      <td className="r"><Pol v={c.unrealized}>{signedUsd(c.unrealized)}</Pol></td>
                      <td className="r muted">{usd(c.fees)}</td>
                      <td className="r"><b><Pol v={c.net}>{signedUsd(c.net)}</Pol></b></td>
                      <td className="r muted">{c.wins}/{c.trades}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <h2>Open positions</h2>
            {p.positions.length === 0 ? (
              <p className="empty">{isSniper ? "Flat — waiting for a pair that clears the filters." : "Flat — no open positions. The bot only enters when every gate passes."}</p>
            ) : (
              <table>
                <thead><tr><th>{isSniper ? "Token" : "Coin"}</th><th>Side</th><th className="r">Size</th><th className="r">Entry</th><th className="r">Mark</th><th className="r">Unrealized</th></tr></thead>
                <tbody>
                  {p.positions.map((o) => (
                    <tr key={o.coin}>
                      <td className="coin">{o.coin}</td>
                      <td>{o.side === "long" ? "▲ long" : "▼ short"}</td>
                      <td className="r">{num(Math.abs(o.size), Math.abs(o.size) > 1000 ? 0 : 4)}</td>
                      <td className="r">{price(o.entry)}</td>
                      <td className="r">{price(o.mark)}</td>
                      <td className="r"><Pol v={o.unrealized}>{signedUsd(o.unrealized)} ({pct(o.unrealized_pct, 2, true)})</Pol></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <div className="grid2">
          <section className="panel">
            <h2>Recent closed trades</h2>
            {p.recent_trades.length === 0 ? (
              <p className="empty">No round trips yet.</p>
            ) : (
              <table>
                <thead><tr><th>Closed</th><th>{isSniper ? "Token" : "Coin"}</th><th>Side</th><th className="r">Fees</th><th className="r">P&amp;L</th></tr></thead>
                <tbody>
                  {p.recent_trades.map((tr, i) => (
                    <tr key={`${tr.coin}-${tr.open_ts}-${i}`}>
                      <td className="muted">{tr.close_ts ? when(tr.close_ts) : "—"}</td>
                      <td className="coin">{tr.coin}</td>
                      <td>{tr.side === "long" ? "▲ long" : "▼ short"}</td>
                      <td className="r muted">{usd(tr.fees)}</td>
                      <td className="r"><b><Pol v={tr.pnl}>{signedUsd(tr.pnl)}</Pol></b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <h2>Recent fills</h2>
            {p.recent_fills.length === 0 ? (
              <p className="empty">No fills yet.</p>
            ) : (
              <table>
                <thead><tr><th>Time</th><th>{isSniper ? "Token" : "Coin"}</th><th>Side</th><th className="r">Size</th><th className="r">Price</th><th>Why</th></tr></thead>
                <tbody>
                  {p.recent_fills.map((f, i) => (
                    <tr key={`${f.ts}-${i}`}>
                      <td className="muted">{when(f.ts)}</td>
                      <td className="coin">{f.coin}</td>
                      <td>{f.side}</td>
                      <td className="r">{num(f.size, f.size > 1000 ? 0 : 4)}</td>
                      <td className="r">{price(f.px)}</td>
                      <td className="why" title={f.reason}>{f.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <footer className="foot">
          {isKalshi
            ? "Paper trading only — Kalshi orders are simulated against the public order books and trade tape with Kalshi's fee schedule; nothing is sent to Kalshi. Not investment advice."
            : isIdea
            ? `Paper trading only — idea-lab book with its own ${usd(p.start_balance, false)}. Both legs are simulated Hyperliquid market orders (perp 4.5 bp, spot 7 bp taker, plus spread and latency); funding is settled hourly at the exchange's rate. Not investment advice.`
            : isLot
            ? "Paper trading only — no order is sent to OKX. Lots are simulated against OKX's live best bid/ask: taker buys at the ask + 0.05% with a 0.35% fee, maker sells fill when the bid reaches the target, 0.20% fee. Never-loss means losses sit in held lots: equity marks every bag at the bid. Not investment advice."
            : isCopy
            ? "Paper trading only — no copyfomo, no Telegram, no real order. Leader wallets are read from public Solana transactions; our copies are simulated swaps priced from real DexScreener pool data with AMM price impact, DEX fee, priority fee and latency slippage. fomo's board is an unofficial public feed. Most copy traders lose money. Not investment advice."
            : isRug
            ? "Paper trading only — simulated Solana swaps priced from real DexScreener pool data with AMM price impact, DEX fee, priority fee and latency slippage. Rugcheck's report is a fact filter, not a guarantee: a coin that passes can still go to zero. Not investment advice."
            : isMeta
            ? "Paper trading only — simulated Solana/Base swaps priced from real DexScreener pool data with AMM price impact, DEX fee, gas/priority fee and latency slippage. Metadata is a visibility signal, not a safety check: most new memecoins still go to zero. Not investment advice."
            : isSniper
            ? "Paper trading only — simulated swaps priced from real DexScreener pool data with AMM price impact, DEX and priority fees and latency slippage. Most new memecoins go to zero; this measures whether filters and exits beat that. Not investment advice."
            : `Paper trading only — simulated fills against real Hyperliquid order books, including fees, slippage and funding. Not investment advice. Step ${p.status.step ?? "—"} · ${p.status.coins?.join(" · ") ?? ""}`}
        </footer>
      </div>
    </main>
  );
}
