"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { demoSniperPerf } from "@/lib/demo-sniper";
import BacktestLab, { SLIDE_TO_BACKTEST } from "./BacktestLab";
import type { CopyBlock, CopyInfo } from "./CopyScene";
import type { LotInfo } from "./LotScene";
import { reachedAtLeast, type MoonInfo } from "./MoonshotScene";
import type { DeskInfo, DeskPosition } from "./DeskScene";
import { ago, arrow, num, pct, polarity, price, signedUsd, usd, when } from "@/lib/format";
import type { HiveGate, IdeaInfo, KalshiInfo, MetaInfo, Performance, PerfResponse, RadarItem, SniperInfo } from "@/lib/types";

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
const MoonshotScene = dynamic(() => import("./MoonshotScene"), { ssr: false });
const DeskScene = dynamic(() => import("./DeskScene"), { ssr: false });
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
  const hive: Slide[] = perf.strategies?.hivesniper?.sniper
    ? [{ key: "hivesniper", n: 33, name: "Hive Gate",
        blurb: "Strategy 12's Solana + Base memecoins, bought only if CrawlHive scores them CLEAN/OK and LarpCheck doesn't call them a larp or scam · flat $500 · −50% stop, half off at +100%" }]
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
  const moonPerf = (perf.strategies as Record<string, Performance | undefined> | undefined)?.moonshot;
  const moon: Slide[] = (moonPerf as unknown as { moonshot?: unknown } | undefined)?.moonshot
    ? [{ key: "moonshot", n: 30, name: "Moonshot",
        blurb: "$100 → $1M on Papertrade's exact rules (papertrade.xyz) · live Hyperliquid BTC mid · three all-in lanes: 100x ×10, 20x ×2, 1000x ×100 · every bust restarts at $100 and the tries are counted" }]
    : [];
  const deskPerf = (perf.strategies as Record<string, Performance | undefined> | undefined)?.grokdesk;
  const desk: Slide[] = (deskPerf as unknown as { desk?: unknown } | undefined)?.desk
    ? [{ key: "grokdesk", n: 34, name: "Grok Desk",
        blurb: "0xTimQ's desk: SCAN → VERIFY → EXECUTE → EXIT, one agent per step, nobody skips one · hard skips in code (Rugcheck + DexScreener), then Grok reads X · 10% of cash per entry · −25% stop, +40%/+100% ladder, 25% trail, 45-min time stop · paper, own $50" }]
    : [];
  return [...BASE_SLIDES, ...ideas, ...kalshi, ...meta, ...rug, ...hive, ...copy, ...lot, ...moon, ...desk];
}

function Pol({ v, children }: { v: number; children: React.ReactNode }) {
  return <span className={`pol pol--${polarity(v)}`}>{children}</span>;
}

// =============================================================================================
// Strategy 34 panels (Grok Desk): the funnel, the report screen, the agents, the exits, every task
// =============================================================================================
const DESK_STEP: Record<string, string> = { scan: "SCAN", verify: "VERIFY", execute: "EXECUTE", limits: "EXECUTE · limits", exit: "EXIT" };

function DeskPanels({ p, D, now }: { p: Performance; D: DeskInfo; now: number }) {
  const r = D.report;
  const c = D.config;
  const hardSkips = Math.max(0, r.verified - r.passed_hard);
  const grokSkips = Math.max(0, r.passed_hard - r.fills);
  const positions = (p.positions ?? []) as unknown as DeskPosition[];
  const funnel: [string, number, string][] = [
    ["SCAN · leads", r.leads, "fresh Solana pairs from DexScreener's newest profiles and boosts, 12 per run"],
    ["VERIFY · checked", r.verified, "each token once: a skip is final"],
    ["VERIFY · passed every hard check", r.passed_hard, "pool, LP lock, dev, top 10, authorities, Rugcheck score, age, sells"],
    ["VERIFY · Grok said GO on X", r.fills, `confidence ≥ ${c.min_x_confidence}`],
    ["EXECUTE · paper fills", r.fills, `${Math.round(c.size_pct * 100)}% of cash, $${c.min_ticket}-$${c.max_ticket}, ≤ ${c.skip_if.max_ticket_share * 100}% of the pool`],
    ["EXIT · sells", r.closes, "stop, ladder, trail, time stop, liquidity pull"],
  ];
  const top = Math.max(1, r.leads);
  return (
    <>
      <section className="panel">
        <h2>Strategy 34 <span className="panel__hint">Grok Desk · SCAN → VERIFY → EXECUTE → EXIT · paper · own {usd(c.start_balance, false)}</span></h2>
        <p className="strategy__what">
          0xTimQ&apos;s desk, built inside the bot. Each trade goes through four steps, and a different agent handles each
          one. Four scanners take turns finding fresh Solana pairs, and they never judge a coin. VERIFY then checks the
          facts in code, for free: pool size, LP lock, how much the dev holds, the top 10 holders, open mint or freeze
          authority, Rugcheck&apos;s score, age and whether anyone has sold. A missing number counts as a skip. Only a coin
          that passes all of that costs a Grok call. Grok searches X for copycat tickers, bought hype, who posted first
          and whether the dev rugged before. Unsure, zero posts, or no X search all mean skip. EXECUTE sizes the buy
          from the cash the desk has now, so wins grow the next ticket and losses shrink it. EXIT&apos;s rules exist
          before the entry. Most tasks end in a skip, and that is the desk working.
        </p>
        <div className="rules">
          <span className="rule">liquidity ≥ ${num(c.skip_if.min_liquidity_usd, 0)}</span>
          <span className="rule">LP locked ≥ {c.skip_if.min_lp_locked_pct}%</span>
          <span className="rule">dev ≤ {c.skip_if.max_dev_pct}%</span>
          <span className="rule">top 10 ≤ {c.skip_if.max_top10_pct}%</span>
          <span className="rule">Rugcheck score ≤ {c.skip_if.max_risk_score}</span>
          <span className="rule">age {c.skip_if.min_age_min} min - {c.skip_if.max_age_h} h</span>
          <span className="rule rule--loss">stop {c.exit.hard_stop_pct}%</span>
          <span className="rule rule--gain">{c.exit.ladder.map(([a, f]) => `+${a}% sells ${Math.round(f * 100)}%`).join(" · ")}</span>
          <span className="rule">trail {c.exit.trail_pct}% under the peak</span>
          <span className="rule">{c.exit.time_stop_min} min without +{c.exit.time_stop_min_pct}% → out</span>
          <span className="rule rule--loss">pool −{c.exit.liq_drop_pct}% → out</span>
          <span className="rule">max {c.max_open} open · halt at −{c.session_loss_halt_pct}% on the day</span>
        </div>
        <p className="muted">
          Grok: {D.grok.via} · {D.grok.calls_last_hour}/{D.grok.budget_per_hour} calls this hour
          {D.grok.calls !== null ? ` · ${D.grok.searched ?? 0} searched X, ${D.grok.no_search ?? 0} answered without searching (skipped)` : ""}
          {D.grok.errors ? ` · ${D.grok.errors} errors (last: ${D.grok.last_error})` : ""}
          {Object.keys(D.source_errors).length ? ` · source errors: ${Object.entries(D.source_errors).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}
          {D.session.halted ? ` · ⛔ session halted: equity under ${usd(D.session.halt_at)} today` : ""}
        </p>
      </section>

      <div className="grid2">
        <section className="panel">
          <h2>The funnel <span className="panel__hint">tasks against fills: most of it should be skips</span></h2>
          <div className="moon-bars">
            {funnel.map(([label, n, hint]) => (
              <div key={label} className="moon-bar" style={{ gridTemplateColumns: "220px 1fr 60px" }} title={hint}>
                <span>{label}</span>
                <div className="moon-bar__track"><div className="moon-bar__fill" style={{ width: `${Math.max(n ? 1.5 : 0, (n / top) * 100)}%` }} /></div>
                <span>{n}</span>
              </div>
            ))}
          </div>
          <p className="muted">{hardSkips} killed by a hard check, {grokSkips} turned down by Grok, {r.tasks} tasks logged in all.</p>
          <h2 style={{ marginTop: 14 }}>Top skip reasons</h2>
          <table>
            <tbody>
              {r.skip_reasons.length === 0 && <tr><td className="muted">no skips yet</td></tr>}
              {r.skip_reasons.slice(0, 10).map(([k, n]) => <tr key={k}><td>{k}</td><td className="r">{n}</td></tr>)}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Session report <span className="panel__hint">every number from tasks.csv and trades.csv · saved daily at 22:00 UTC</span></h2>
          <pre className="desk-report">{D.report_text}</pre>
          <h2 style={{ marginTop: 14 }}>Whose leads paid</h2>
          <table>
            <thead><tr><th>Agent</th><th className="r">Leads</th><th className="r">Fills</th><th className="r">Realized</th></tr></thead>
            <tbody>
              {c.scanners.map((a) => {
                const x = r.agents[a] ?? { leads: 0, fills: 0, pnl: 0 };
                return <tr key={a}><td>{a}</td><td className="r">{x.leads}</td><td className="r">{x.fills}</td><td className="r"><Pol v={x.pnl}>{signedUsd(x.pnl)}</Pol></td></tr>;
              })}
            </tbody>
          </table>
        </section>
      </div>

      <section className="panel">
        <h2>Open positions and their exits <span className="panel__hint">every exit exists before the entry</span></h2>
        {positions.length === 0 ? <p className="empty">Flat: nothing has passed every step yet.</p> : (
          <table>
            <thead><tr><th>Coin</th><th>Lead</th><th className="r">In</th><th className="r">Move</th><th className="r">Stop</th><th className="r">Next take</th><th className="r">Trail</th><th className="r">Pool floor</th><th className="r">Time stop</th></tr></thead>
            <tbody>
              {positions.map((o) => (
                <tr key={o.mint}>
                  <td className="coin">{o.url ? <a href={o.url} target="_blank" rel="noreferrer">{o.coin}</a> : o.coin}</td>
                  <td className="muted">{o.agent}</td>
                  <td className="r">{usd(o.cost)}</td>
                  <td className="r"><Pol v={o.unrealized}>{pct(o.unrealized_pct, 1, true)}</Pol></td>
                  <td className="r">{price(o.stop_px)}</td>
                  <td className="r">{o.next_take_px ? price(o.next_take_px) : "ladder done"}</td>
                  <td className="r">{o.trail_px ? price(o.trail_px) : "after 1st take"}</td>
                  <td className="r">${num(o.liq_floor, 0)}</td>
                  <td className="r">{o.time_stop_ms ? (o.time_stop_ms > now ? `in ${Math.round((o.time_stop_ms - now) / 60000)} min` : "due") : "off (took profit)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Every task <span className="panel__hint">newest first · if it isn&apos;t in tasks.csv, it didn&apos;t happen</span></h2>
        <table>
          <thead><tr><th>When</th><th>Agent</th><th>Step</th><th>Coin</th><th>Result</th><th>Why</th></tr></thead>
          <tbody>
            {D.tasks.length === 0 && <tr><td colSpan={6} className="muted">the first scan runs within 5 minutes of a restart</td></tr>}
            {D.tasks.slice(0, 40).map((t, i) => (
              <tr key={`${t.ts}-${i}`}>
                <td className="muted">{ago(Number(t.ts), now)}</td>
                <td>{t.agent}</td>
                <td className="muted">{DESK_STEP[t.step] ?? t.step}</td>
                <td className="coin">{t.symbol || t.mint.slice(0, 6)}</td>
                <td>{t.result === "paper_fill" || t.result === "go" ? <span className="pol pol--gain">{t.result}</span>
                  : t.result === "skip" ? <span className="pol pol--loss">skip</span> : t.result}</td>
                <td className="why" title={t.reason}>{t.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

// =============================================================================================
// Strategy 30 panels (Moonshot): $100 -> $1M on Papertrade's rules, tries counted
// =============================================================================================
const moneyShort = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k` : `$${v.toFixed(0)}`);
const durShort = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min`
  : ms < 172_800_000 ? `${(ms / 3_600_000).toFixed(1)} h` : `${(ms / 86_400_000).toFixed(1)} d`);

function MoonPanels({ M, now }: { M: MoonInfo; now: number }) {
  const lanes = M.lanes;
  const tries = lanes.reduce((a, l) => a + l.tries, 0);
  const busts = lanes.reduce((a, l) => a + l.busts, 0);
  const moons = lanes.reduce((a, l) => a + l.moons, 0);
  const paidIn = lanes.reduce((a, l) => a + l.paid_in, 0);
  const paidOut = lanes.reduce((a, l) => a + l.paid_out, 0);
  const net = paidOut - paidIn;
  const r = M.rules;
  const history = lanes
    .flatMap((l) => l.history.map((h) => ({ ...h, lane: l.key, lev: l.lev })))
    .sort((a, b) => b.end - a.end)
    .slice(0, 30);
  return (
    <>
      <section className="stats">
        <Stat label="Tries finished" value={num(tries, 0)} sub={`${busts} busts · ${moons} reached $1M`} />
        <Stat label="Paid in" value={usd(paidIn, false)} sub={`${usd(M.stake_usd, false)} for every try started`} />
        <Stat label="Paid out" value={usd(paidOut, false)} sub={moons ? `${moons} × $1M+` : "nothing has reached $1M yet"} />
        <Stat label="Net" value={signedUsd(net, false)} v={net} sub="what a real trader would be up or down" />
        <Stat label="Running since" value={M.started_ms ? when(M.started_ms) : "—"} sub={M.started_ms ? `${durShort(now - M.started_ms)} on live BTC` : "starting"} />
        <Stat label="BTC mid" value={M.mid ? price(M.mid) : "—"} sub={M.mid_ms ? `Hyperliquid best bid/ask · ${ago(M.mid_ms, now)}` : "waiting for the book"} />
      </section>

      <section className="panel">
        <h2>Strategy 30 <span className="panel__hint">Moonshot · Papertrade&apos;s rules on live BTC · paper only, nothing sent to Papertrade</span></h2>
        <p className="strategy__what">
          Can {usd(M.stake_usd, false)} become {usd(M.goal_usd, false)} on Papertrade? Each lane starts a try with{" "}
          {usd(M.stake_usd, false)} and puts all of it into one BTC position at its leverage, in the direction of
          BTC&apos;s 24-hour trend. Prices are Hyperliquid&apos;s live best bid/ask mid, the same price Papertrade uses.
          When the take-profit price is reached, the payout after Papertrade&apos;s win haircut and 2% win fee rolls into
          the next step. A bust loses the whole stake and the lane starts again with a fresh {usd(M.stake_usd, false)}.
          The counters show how many {usd(M.stake_usd, false)} tries it takes, and how far each one got.
        </p>
        <div className="rules">
          <span className="rule">price: Hyperliquid BBO mid</span>
          <span className="rule rule--loss">bust {r.bust_buffer_bp} bp before zero equity (1000x busts at a 0.05% move)</span>
          <span className="rule">wins: {r.deadband_bp} bp deadband, then a size- and move-based haircut</span>
          <span className="rule rule--loss">{Math.round(r.win_fee * 100)}% fee on winning closes</span>
          <span className="rule">no fees on losses · no funding · no spread</span>
          <span className="rule">{moneyShort(r.max_notional)} notional cap per position</span>
        </div>
        <p className="muted">Rules from {M.source}. Feed errors so far: {M.feed_errors}{M.last_error ? ` · last: ${M.last_error}` : ""}.</p>
      </section>

      <section className="panel">
        <h2>The three lanes <span className="panel__hint">the live try, its take-profit and bust prices, and the counters</span></h2>
        <div className="moon-lanes">
          {lanes.map((l) => {
            const p = l.position;
            const live = l.equity * (l.live_multiple ?? 1);
            const span = p ? p.tp - p.bust : 0;
            const at = p && span ? Math.max(0, Math.min(1, (M.mid - p.bust) / span)) : 0.5;
            const entryAt = p && span ? Math.max(0, Math.min(1, (p.entry - p.bust) / span)) : 0.5;
            const toTp = p && M.mid ? ((p.tp - M.mid) / M.mid) * p.side : null;
            const toBust = p && M.mid ? ((M.mid - p.bust) / M.mid) * p.side : null;
            const naive = (l.step_mult - 1) / l.lev;
            return (
              <div key={l.key} className="moon-lane">
                <div className="moon-lane__head">
                  <b>{l.key.toUpperCase()}</b>
                  <span className="muted">{l.name}</span>
                </div>
                <div className="moon-lane__big">
                  <Pol v={live - l.equity}>{moneyShort(live)}</Pol>{" "}
                  <span className="muted">step {l.step}/{l.steps_needed} · try {l.tries + 1}</span>
                </div>
                {p ? (
                  <>
                    <div className="moon-lane__row"><span>{p.side > 0 ? "▲ long" : "▼ short"} {moneyShort(p.margin)} × {num(p.lev, 0)}</span><b>entry {price(p.entry)}</b></div>
                    <div className="moon-meter" title="bust ← live price → take profit">
                      <i style={{ left: `${entryAt * 100}%`, background: "#9fb4d8", boxShadow: "none" }} />
                      <i style={{ left: `${at * 100}%` }} />
                    </div>
                    <div className="moon-meter__ends"><span>bust {price(p.bust)}</span><span>TP {price(p.tp)}</span></div>
                    <div className="moon-lane__row"><span>to take profit</span><b>{toTp === null ? "—" : pct(toTp, 2)}</b></div>
                    <div className="moon-lane__row"><span>to bust</span><b className={toBust !== null && toBust < 0.002 ? "pol pol--loss" : ""}>{toBust === null ? "—" : pct(toBust, 2)}</b></div>
                    <div className="moon-lane__row"><span>open for</span><b>{durShort(now - p.opened_ms)}</b></div>
                  </>
                ) : (
                  <p className="empty">opening the next position…</p>
                )}
                <div className="moon-lane__row"><span>BTC move to win a step</span><b>{pct(l.take_profit_move, 2)} <span className="muted">(not {pct(naive, 2)}: haircut + fee)</span></b></div>
                <div className="moon-lane__row"><span>BTC move to bust</span><b>{pct(l.bust_move, 2)}</b></div>
                <div className="moon-lane__row"><span>tries · busts · $1M</span><b>{l.tries} · {l.busts} · {l.moons}</b></div>
                <div className="moon-lane__row"><span>paid in → out</span><b><Pol v={l.net}>{usd(l.paid_in, false)} → {usd(l.paid_out, false)}</Pol></b></div>
                <div className="moon-lane__row"><span>best stake ever</span><b>{moneyShort(l.best_equity)}</b></div>
                <div className="moon-lane__row"><span>odds here · backtest</span><b>{l.tries ? `${l.moons} in ${l.tries}` : "—"} · {M.backtest[l.key] ?? "—"}</b></div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2>How far the tries got <span className="panel__hint">share of finished tries that reached each rung</span></h2>
        <div className="moon-lanes">
          {lanes.map((l) => {
            const total = Math.max(1, l.tries);
            const rows = Array.from({ length: l.steps_needed }, (_, i) => i + 1);
            return (
              <div key={l.key} className="moon-lane">
                <div className="moon-lane__head"><b>{l.key.toUpperCase()}</b><span className="muted">{l.tries} tries</span></div>
                <div className="moon-bars">
                  {rows.map((k) => {
                    const n = reachedAtLeast(l.steps_won, k);
                    const v = Math.min(M.goal_usd, M.stake_usd * Math.pow(l.step_mult, k));
                    const share = n / total;
                    return (
                      <div key={k} className="moon-bar" title={`${n} of ${l.tries} tries reached ${moneyShort(v)}`}>
                        <span>{moneyShort(v)}</span>
                        <div className="moon-bar__track">
                          <div className={`moon-bar__fill ${k === l.steps_needed ? "moon-bar__fill--goal" : ""}`} style={{ width: `${Math.max(n ? 2 : 0, share * 100)}%` }} />
                        </div>
                        <span>{n} · {l.tries ? pct(share, share > 0 && share < 0.01 ? 2 : 0) : "—"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2>Finished tries <span className="panel__hint">newest first · every bust restarts the lane at {usd(M.stake_usd, false)}</span></h2>
        <table>
          <thead><tr><th>Ended</th><th>Lane</th><th className="r">Lasted</th><th className="r">Steps won</th><th className="r">Peak stake</th><th>Result</th></tr></thead>
          <tbody>
            {history.length === 0 && <tr><td colSpan={6} className="muted">no try has finished yet: the first bust or $1M lands here</td></tr>}
            {history.map((h, i) => (
              <tr key={`${h.lane}-${h.end}-${i}`}>
                <td className="muted">{ago(h.end, now)}</td>
                <td>{h.lane} · {h.lev}x</td>
                <td className="r">{durShort(h.end - h.start)}</td>
                <td className="r">{h.steps}</td>
                <td className="r">{moneyShort(h.peak)}</td>
                <td>{h.result === "moon" ? <span className="pol pol--gain">$1M reached</span> : <span className="pol pol--loss">bust</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

// =============================================================================================
// Jev A/B: the control book vs its "+Jev" twin (same code, same candidates, one Jev risk gate before entries)
// =============================================================================================
type JevGateInfo = { source: string; counts: Record<string, number>; calls_last_hour: number; budget_per_hour: number;
  errors: number; last_error: string; rules: { skip_toxic: number; half_toxic: number; half_on_reduce: boolean; skip_on_crisis: boolean; ttl_min: number } };
type JevAB = { equity: number; pnl: number; pnl_pct: number; realized: number; unrealized: number; max_drawdown: number;
  closed: number; open: number; win_rate: number | null; gate: JevGateInfo;
  since?: { control_equity: number; twin_equity: number; ts: number }; control_change?: number; twin_change?: number };
type CopyJevAB = { by_verdict: Record<string, number>; control_pnl: number; gated_pnl: number;
  open_by_verdict: Record<string, number>; gate: JevGateInfo };

const JEV_VERDICT: Record<string, string> = { FULL: "full size", HALF: "half size", SKIP: "skipped", no_read: "no Jev read (full size)" };

function JevGateRules({ g }: { g: JevGateInfo }) {
  return (
    <div className="rules">
      <span className="rule rule--loss">toxic ≥ {g.rules.skip_toxic.toFixed(2)} → skip</span>
      <span className="rule">toxic ≥ {g.rules.half_toxic.toFixed(2)}{g.rules.half_on_reduce ? " or risk “reduce”" : ""} → half size</span>
      {g.rules.skip_on_crisis && <span className="rule rule--loss">regime “crisis” → skip</span>}
      <span className="rule rule--gain">otherwise full size</span>
      <span className="rule">one read per token per {g.rules.ttl_min} min · {g.calls_last_hour}/{g.budget_per_hour} calls this hour</span>
    </div>
  );
}

function JevABPanel({ p, now }: { p: Performance; now: number }) {
  const ab = (p as unknown as { jev_ab?: JevAB }).jev_ab;
  const cab = (p.sniper as unknown as { copy?: { jev_ab?: CopyJevAB } } | undefined)?.copy?.jev_ab;
  if (!ab && !cab) return null;
  const why = (
    <p className="strategy__what">
      Jev can&apos;t call direction: across 10,513 graded calls it was right 45% of the time an hour ahead, and its
      most confident calls did worse. But its toxic-flow read tracks how hard the next hour moves (0.2 → 47 bp, 0.5 →
      76 bp, 0.6 → 157 bp). So here Jev is asked right before each entry, and too-hot entries are skipped or halved.
    </p>
  );
  if (ab) {
    const g = ab.gate;
    const cc = ab.control_change ?? null;
    const tc = ab.twin_change ?? null;
    const edge = cc !== null && tc !== null ? tc - cc : null;
    return (
      <section className="panel">
        <h2>Jev A/B <span className="panel__hint">this book vs its “+Jev” twin · same code, same candidates, own $10k{ab.since ? ` · since ${ago(ab.since.ts, now)}` : ""}</span></h2>
        {why}
        <JevGateRules g={g} />
        <table>
          <thead><tr><th></th><th className="r">Change since the twin started</th><th className="r">Equity</th><th className="r">Closed</th><th className="r">Open</th><th className="r">Max drawdown</th></tr></thead>
          <tbody>
            <tr><td>Control (no Jev)</td><td className="r">{cc === null ? "—" : <Pol v={cc}>{signedUsd(cc)}</Pol>}</td><td className="r">{usd(p.equity)}</td><td className="r">{p.trades.closed}</td><td className="r">{p.trades.open}</td><td className="r">{pct(-p.max_drawdown, 1)}</td></tr>
            <tr><td><b>+Jev gate</b></td><td className="r">{tc === null ? "—" : <Pol v={tc}>{signedUsd(tc)}</Pol>}</td><td className="r">{usd(ab.equity)}</td><td className="r">{ab.closed ?? 0}</td><td className="r">{ab.open ?? 0}</td><td className="r">{pct(-(ab.max_drawdown ?? 0), 1)}</td></tr>
          </tbody>
        </table>
        <p className="muted">
          {edge === null ? "" : <>Jev&apos;s edge so far: <Pol v={edge}>{signedUsd(edge)}</Pol>. </>}
          Gate verdicts: {Object.entries(g.counts).map(([k, v]) => `${JEV_VERDICT[k] ?? k} ${v}`).join(" · ") || "none yet"}
          {g.errors ? ` · ${g.errors} Jev errors (last: ${g.last_error})` : ""}
        </p>
      </section>
    );
  }
  const c = cab as CopyJevAB;
  return (
    <section className="panel">
      <h2>Jev A/B <span className="panel__hint">every copy tagged with the Jev gate&apos;s verdict · P&amp;L split by verdict</span></h2>
      {why}
      <p className="strategy__what">Copy Desk books every copy either way (a twin would read fomo&apos;s tape twice). The
        gated result counts FULL copies, half of HALF copies, and none of the SKIP copies.</p>
      <JevGateRules g={c.gate} />
      <table>
        <thead><tr><th>Jev verdict</th><th className="r">Realized P&amp;L</th><th className="r">Open copies</th></tr></thead>
        <tbody>
          {["FULL", "HALF", "SKIP"].map((v) => (
            <tr key={v}><td>{JEV_VERDICT[v]}</td><td className="r"><Pol v={c.by_verdict[v] ?? 0}>{signedUsd(c.by_verdict[v] ?? 0)}</Pol></td><td className="r">{c.open_by_verdict[v] ?? 0}</td></tr>
          ))}
          <tr><td>Without Jev (all copies)</td><td className="r"><Pol v={c.control_pnl}>{signedUsd(c.control_pnl)}</Pol></td><td></td></tr>
          <tr><td><b>With the Jev gate</b></td><td className="r"><Pol v={c.gated_pnl}>{signedUsd(c.gated_pnl)}</Pol></td><td></td></tr>
        </tbody>
      </table>
    </section>
  );
}

// =============================================================================================
// Copy Desk x CrawlHive + LarpCheck: every copy tagged with the two tools' opinion, P&L split PASS / FAIL / NONE
// =============================================================================================
type CopyHiveAB = { by_class: Record<string, number>; booked: Record<string, number>; control_pnl: number;
  gated_pnl: number; gated_lenient_pnl: number; calls_window: number; budget: number; rule: string;
  open: { key: string; symbol: string; chain: string | null; class: string; why: string; hive_url: string | null; larp_url: string | null }[] };

const HIVE_CLASS: Record<string, string> = { PASS: "both tools pass", FAIL: "flagged (CrawlHive < 60 or LarpCheck larp/scam)", NONE: "no answer / too early" };

function HiveABPanel({ p }: { p: Performance }) {
  const h = (p.sniper as unknown as { copy?: { hive_ab?: CopyHiveAB | null } } | undefined)?.copy?.hive_ab;
  if (!h) return null;
  return (
    <section className="panel">
      <h2>CrawlHive + LarpCheck second opinion <span className="panel__hint">every copy tagged · P&amp;L split by their verdict · free scan, {h.calls_window}/{h.budget} used this 10 min</span></h2>
      <p className="strategy__what">
        Right before a copy is booked, CrawlHive scans the coin (holders, bundles, snipers, dev history, LP) and passes
        along LarpCheck&apos;s verdict on the project when it has one. The copy is booked either way, so this table shows
        what skipping the coins they flag would have earned. CrawlHive&apos;s own record over 3,383 scans: 46% of CLEAN
        coins dumped within 24 h, against 78% of RISKY and 92% of TOO EARLY.
      </p>
      <div className="rules"><span className="rule rule--gain">{h.rule}</span><span className="rule rule--loss">tag only: nothing is blocked</span></div>
      <table>
        <thead><tr><th>Their verdict</th><th className="r">Copies</th><th className="r">Realized P&amp;L</th></tr></thead>
        <tbody>
          {["PASS", "FAIL", "NONE"].map((v) => (
            <tr key={v}><td>{HIVE_CLASS[v]}</td><td className="r">{h.booked[v] ?? 0}</td><td className="r"><Pol v={h.by_class[v] ?? 0}>{signedUsd(h.by_class[v] ?? 0)}</Pol></td></tr>
          ))}
          <tr><td>All tagged copies (what the book did)</td><td></td><td className="r"><Pol v={h.control_pnl}>{signedUsd(h.control_pnl)}</Pol></td></tr>
          <tr><td><b>Only copies both tools passed</b></td><td></td><td className="r"><b><Pol v={h.gated_pnl}>{signedUsd(h.gated_pnl)}</Pol></b></td></tr>
          <tr><td>Passed + no answer</td><td></td><td className="r"><Pol v={h.gated_lenient_pnl}>{signedUsd(h.gated_lenient_pnl)}</Pol></td></tr>
        </tbody>
      </table>
      {h.open.length > 0 && (
        <p className="muted">
          Open copies: {h.open.map((o, i) => (
            <span key={o.key}>{i ? " · " : ""}{o.symbol} ({o.chain}) {o.class}: {o.why}
              {o.hive_url && <> · <a href={o.hive_url} target="_blank" rel="noreferrer">scan</a></>}
              {o.larp_url && <> · <a href={o.larp_url} target="_blank" rel="noreferrer">larpcheck</a></>}</span>
          ))}
        </p>
      )}
    </section>
  );
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

const HIVE_LABEL: Record<string, string> = {
  passed: "passed both → bought", no_answer: "no CrawlHive answer (down / rate limit)", no_score: "CrawlHive gave no score",
  hive_risky: "CrawlHive RISKY (score 40-59)", hive_danger: "CrawlHive DANGER (score < 40)",
  "larp:scam": "LarpCheck: SCAM", "larp:larp": "LarpCheck: LARP", "larp:likely_larp": "LarpCheck: LIKELY LARP",
  authority_open: "mint / freeze authority open",
};
const BOTH_LABEL: Record<string, string> = {
  "hive_ok+larp_none": "CrawlHive OK · LarpCheck has no check", "hive_ok+larp_real": "both say real / OK",
  "hive_ok+larp_unclear": "CrawlHive OK · LarpCheck unclear", "hive_ok+larp_bad": "CrawlHive OK · LarpCheck says larp/scam",
  "hive_bad+larp_none": "CrawlHive risky · LarpCheck has no check", "hive_bad+larp_real": "CrawlHive risky · LarpCheck says real",
  "hive_bad+larp_unclear": "CrawlHive risky · LarpCheck unclear", "hive_bad+larp_bad": "both say no",
};

function HiveGatePanel({ p, m, g }: { p: Performance; m: MetaInfo; g: HiveGate }) {
  const c = m.config;
  const r = g.rules;
  const total = Object.values(g.counts).reduce((a, b) => a + b, 0);
  const rows = Object.entries(g.counts).sort((a, b) => (a[0] === "passed" ? -1 : b[0] === "passed" ? 1 : b[1] - a[1]));
  const both = Object.entries(g.both ?? {}).sort((a, b) => b[1] - a[1]);
  const bothTotal = both.reduce((a, [, v]) => a + v, 0);
  return (
    <section className="panel">
      <h2>Strategy 33 <span className="panel__hint">Hive Gate · CrawlHive + LarpCheck · paper · own {usd(c.start_balance, false)}</span></h2>
      <p className="strategy__what">
        Two independent tools judge every coin before a buy. It watches the same new Solana and Base memecoins as
        Strategy 12 (a description, website or X link, {compactUsd(c.min_mc)}-{compactUsd(c.max_entry_mc)} market cap,{" "}
        {fmtAge(30)}+ old, pool of at least {compactUsd(c.min_liquidity)}). CrawlHive (open source) scans the chain:
        holders, bundles, snipers, the dev&apos;s history, linked wallets, LP lock. It gives a 0-100 score, and the coin
        needs CLEAN or OK ({r.min_hive_score}+). LarpCheck&apos;s second opinion on the project behind the coin comes back in
        the same answer, and a verdict of {r.larp_block.join(", ")} kills the coin. Most fresh coins have no LarpCheck check
        at all, and then CrawlHive decides alone. Too early to judge means it waits and asks again. No answer is a skip,
        never a pass. Survivors get a flat {usd(g.ticket_usd, false)} ticket, with at most {g.max_open} coins held and an
        hour between entries. Exits: a {pct(r.stop_loss, 0, true)} stop, then half sold at {pct(r.take_half_at, 0, true)},
        and the rest trails the peak.
      </p>
      <div className="rules">
        <span className="rule">CrawlHive ≥ {r.min_hive_score}</span>
        <span className="rule rule--loss">LarpCheck ≠ larp / scam</span>
        <span className="rule">flat {usd(g.ticket_usd, false)} · max {g.max_open}</span>
        <span className="rule">≤ {r.max_hive_calls} scans / {r.hive_window_min} min</span>
        <span className="rule rule--loss">stop {pct(r.stop_loss, 0, true)}</span>
        <span className="rule rule--gain">half off at {pct(r.take_half_at, 0, true)}</span>
      </div>
      <p className="empty">
        Neither tool keeps point-in-time history, so there is no backtest; this paper book is the test. Strategy 12 buys
        the same coins without a gate, and Strategy 23 puts Rugcheck in front of them. A clean scan is not a guarantee.
      </p>
      <table>
        <thead><tr><th>Gate verdict (since launch)</th><th className="r">Coins</th><th className="r">Share</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={3} className="muted">no coin checked yet</td></tr>}
          {rows.map(([k, v]) => (
            <tr key={k}><td>{HIVE_LABEL[k] ?? k}</td><td className="r">{v}</td><td className="r">{pct(total ? v / total : 0, 0)}</td></tr>
          ))}
        </tbody>
      </table>
      <table>
        <thead><tr><th>Do the two tools agree?</th><th className="r">Coins</th><th className="r">Share</th></tr></thead>
        <tbody>
          {both.length === 0 && <tr><td colSpan={3} className="muted">no verdict yet</td></tr>}
          {both.map(([k, v]) => (
            <tr key={k}><td>{BOTH_LABEL[k] ?? k}</td><td className="r">{v}</td><td className="r">{pct(bothTotal ? v / bothTotal : 0, 0)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted">{p.status.decider}</p>
    </section>
  );
}

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
      {m.mode === "hive" && m.gate && <HiveGatePanel p={p} m={m} g={m.gate as unknown as HiveGate} />}
      {(m.mode as string) === "copy" && (m as unknown as CopyInfo).copy && <CopyDeskPanels p={p} m={m} c={(m as unknown as CopyInfo).copy as CopyBlock} now={now} />}
      <section className="panel" style={m.mode === "rug" || m.mode === "hive" || (m.mode as string) === "copy" ? { display: "none" } : undefined}>
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
  const isHive = slideKey === "hivesniper";
  const isCopy = slideKey === "copydesk";
  const isLot = slideKey === "lotladder";
  const lotPerf = (data.perf.strategies as Record<string, Performance | undefined> | undefined)?.lotladder;
  const lotInfo = (lotPerf as unknown as { lots?: LotInfo } | undefined)?.lots;
  const isMoon = slideKey === "moonshot";
  const moonPerf = (data.perf.strategies as Record<string, Performance | undefined> | undefined)?.moonshot;
  const moonInfo = (moonPerf as unknown as { moonshot?: MoonInfo } | undefined)?.moonshot;
  const isDesk = slideKey === "grokdesk";
  const deskPerf = (data.perf.strategies as Record<string, Performance | undefined> | undefined)?.grokdesk;
  const deskInfo = (deskPerf as unknown as { desk?: DeskInfo } | undefined)?.desk;
  const isMeta = slideKey === "metasniper" || isRug || isHive || isCopy;
  const metaPerf = data.perf.strategies?.metasniper;
  const rugPerf = data.perf.strategies?.rugsniper;
  const hivePerf = data.perf.strategies?.hivesniper;
  const copyPerf = (data.perf.strategies as Record<string, Performance | undefined> | undefined)?.copydesk;
  const kalshiPerf = data.perf.strategies?.kalshi;
  const ideaPerf = slideKey.startsWith("idea:") ? data.perf.strategies?.[slideKey as `idea:${string}`] : undefined;
  const idea = ideaPerf?.idea;
  const isIdea = !!(ideaPerf && idea);
  const p: Performance = isSniper ? sniperPerf : isKalshi && kalshiPerf ? kalshiPerf : isRug && rugPerf ? rugPerf : isHive && hivePerf ? hivePerf : isCopy && copyPerf ? copyPerf : isLot && lotPerf ? lotPerf : isMoon && moonPerf ? moonPerf : isDesk && deskPerf ? deskPerf : isMeta && metaPerf ? metaPerf
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
              : isDesk ? "paper trading · Solana memecoins · four agents, four steps: scan, verify (code, then Grok on X), execute, exit"
              : isMoon ? "paper trading · Papertrade's rules (papertrade.xyz) on live Hyperliquid BTC · $100 tries, counted"
              : isLot ? "paper trading · OKX spot · Rob's STRAFE HELM lot engine (run #5 rules) on live prices"
              : isCopy ? "paper trading · copy trading · fomo's top wallets on Solana, Robinhood Chain and Base → hard facts → Grok verdict"
              : isRug ? "paper trading · Solana memecoins · DexScreener profiles behind Rugcheck's fact checks"
              : isHive ? "paper trading · Solana + Base memecoins · DexScreener profiles behind CrawlHive's scan + LarpCheck's second opinion"
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
          : s.key === "hivesniper" ? (hivePerf?.equity ?? null)
          : s.key === "copydesk" ? (copyPerf?.equity ?? null)
          : s.key === "lotladder" ? (lotPerf?.equity ?? null)
          : s.key === "moonshot" ? null
          : s.key === "grokdesk" ? (deskPerf?.equity ?? null)
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
            {isMoon && moonInfo ? (
              <>
                <div className="hero__label">Strategy 30 · $100 tries at $1M</div>
                <div className="hero__equity">{num(moonInfo.lanes.reduce((a, l) => a + l.tries, 0), 0)} tries</div>
                <div className="hero__pnl">
                  <Pol v={p.pnl}>{arrow(p.pnl)} {signedUsd(p.pnl)}</Pol>
                  <span className="hero__since">
                    paid in {usd(moonInfo.lanes.reduce((a, l) => a + l.paid_in, 0), false)} · paid out {usd(moonInfo.lanes.reduce((a, l) => a + l.paid_out, 0), false)} · {moonInfo.lanes.reduce((a, l) => a + l.moons, 0)} reached $1M
                  </span>
                </div>
              </>
            ) : (<>
            <div className="hero__label">{isSniper ? "Sniper paper equity" : isKalshi ? "Strategy 7 paper equity" : isRug ? "Strategy 23 paper equity" : isHive ? "Strategy 33 paper equity" : isDesk ? "Strategy 34 paper equity" : isCopy ? "Strategy 25 paper equity" : isLot ? "Strategy 26 paper equity" : isMeta ? "Strategy 12 paper equity" : isIdea ? `Strategy ${idea?.n} paper equity` : "Paper equity"}</div>
            <div className="hero__equity">{usd(p.equity)}</div>
            <div className="hero__pnl">
              <Pol v={p.pnl}>{arrow(p.pnl)} {signedUsd(p.pnl)} ({pct(p.pnl_pct, 2, true)})</Pol>
              <span className="hero__since">since {when(since)} · started with {usd(p.start_balance, false)}</span>
            </div>
            </>)}
          </div>
          {isSniper ? (
            <div className="legend" aria-label="Legend">
              <span><i className="swatch swatch--score" /> snipe score low → high</span>
              <span><i className="swatch swatch--held" /> held</span>
              <span><i className="swatch swatch--zone" /> snipe zone</span>
              <span><i className="swatch swatch--reject" /> rejected</span>
              <span className="legend__note">x: pair age · y: 5-minute move · depth: buy pressure · size: liquidity · lines link nearest neighbours · drag to orbit, hover a token</span>
            </div>
          ) : isDesk ? (
            <div className="legend" aria-label="Legend">
              <span><i className="swatch swatch--carry-low" /> lead from a scanner</span>
              <span><i className="swatch swatch--loss" /> killed by a hard check</span>
              <span><i className="swatch swatch--held" /> Grok&apos;s X read said no</span>
              <span><i className="swatch swatch--gain" /> filled · open position</span>
              <span className="legend__note">one rail, left to right: SCAN-1..4 → VERIFY in code → Grok on X → EXECUTE → EXIT · each bead is a recent lead and stops where its task ended · over EXIT: open positions at the height of their move, red plate = −25% stop, gold rungs = +40% / +100% takes · hover a bead or a position</span>
            </div>
          ) : isMoon ? (
            <div className="legend" aria-label="Legend">
              <span><i className="swatch swatch--zone" /> rocket: the stake&apos;s live value</span>
              <span><i className="swatch swatch--held" /> take-profit ring</span>
              <span><i className="swatch swatch--loss" /> bust plate · one ember per bust</span>
              <span><i className="swatch swatch--carry-low" /> rungs (brighter = more tries got there)</span>
              <span className="legend__note">one tower per lane · height: stake on a log scale, $100 on the pad to $1M at the moon · the rocket shakes and reddens as BTC nears the bust price · drag to orbit, hover a tower</span>
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
          : isDesk ? "3D trading desk rail: every recent lead riding from its scanner to the step where it ended"
          : isMoon ? "3D launch towers: each lane's $100 try climbing log-scale rungs toward $1M, with its bust and take-profit levels"
          : isLot ? "3D lot elevator: every coin's $50 lots at their entry prices around the live price"
          : isCopy ? "3D relay of fomo traders' buys flying through the Rugcheck and Grok gates"
          : isRug ? "3D market-cap elevator of the Solana memecoins Rugcheck let through"
          : isHive ? "3D market-cap elevator of the Solana and Base memecoins CrawlHive and LarpCheck let through"
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
          <div className={`scene__layer ${isMeta && !isRug && !isHive && !isCopy ? "scene__layer--on" : ""}`} aria-hidden={!(isMeta && !isRug && !isHive && !isCopy)}>
            <MetaScene info={metaPerf.sniper as unknown as MetaInfo} active={isMeta && !isRug && !isHive && !isCopy} />
          </div>
        )}
        {visited.rugsniper && rugPerf?.sniper && (
          <div className={`scene__layer ${isRug ? "scene__layer--on" : ""}`} aria-hidden={!isRug}>
            <MetaScene info={rugPerf.sniper as unknown as MetaInfo} active={isRug} />
          </div>
        )}
        {visited.hivesniper && hivePerf?.sniper && (
          <div className={`scene__layer ${isHive ? "scene__layer--on" : ""}`} aria-hidden={!isHive}>
            <MetaScene info={hivePerf.sniper as unknown as MetaInfo} active={isHive} />
          </div>
        )}
        {visited.lotladder && lotInfo && (
          <div className={`scene__layer ${isLot ? "scene__layer--on" : ""}`} aria-hidden={!isLot}>
            <LotScene info={lotInfo} active={isLot} />
          </div>
        )}
        {visited.grokdesk && deskInfo && (
          <div className={`scene__layer ${isDesk ? "scene__layer--on" : ""}`} aria-hidden={!isDesk}>
            <DeskScene info={deskInfo} positions={(deskPerf?.positions ?? []) as unknown as DeskPosition[]} active={isDesk} />
          </div>
        )}
        {visited.moonshot && moonInfo && (
          <div className={`scene__layer ${isMoon ? "scene__layer--on" : ""}`} aria-hidden={!isMoon}>
            <MoonshotScene info={moonInfo} active={isMoon} />
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
        {isMoon && moonInfo ? (
          <MoonPanels M={moonInfo} now={now} />
        ) : (<>
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

        <JevABPanel p={p} now={now} />

        {isCopy && <HiveABPanel p={p} />}

        {isSniper && sn ? <SniperPanels p={p} sn={sn} demo={sniperDemo} now={now} />
          : isKalshi && kal ? <KalshiPanels k={kal} now={now} />
          : isLot && lotInfo ? <LotPanels p={p} L={lotInfo} now={now} />
          : isMeta && meta ? <MetaPanels p={p} m={meta} now={now} />
          : isDesk && deskInfo ? <DeskPanels p={p} D={deskInfo} now={now} />
          : isIdea && idea ? <IdeaPanels p={p} idea={idea} /> : <TrendPanels p={p} />}

        </>)}

        {!isMoon && data.perf.ideas && data.perf.ideas.length > 0 && (
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

        {!isMoon && p.daily.length > 0 && (
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

        {!isMoon && (<>
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

        </>)}

        <footer className="foot">
          {isDesk
            ? "Paper trading only — the desk never holds a key, never connects a wallet and never signs. Fills are simulated against the real DexScreener pool: AMM price impact, 0.25% DEX fee, $0.10 priority fee and 2% latency slippage, so a paper fill is a ceiling, not a forecast. Most memecoins go to zero. Not investment advice."
            : isMoon
            ? "Paper trading only — nothing is sent to Papertrade and no wallet is connected. Papertrade's published rules (BBO mid pricing, bust 5 bp before zero equity, win haircut and 2% win fee, $10M cap) are replayed against Hyperliquid's live BTC book. Prices are checked once a second, so a real fill could land a little differently. Real money at 100x-1000x is lost far more often than it is multiplied. Not investment advice."
            : isKalshi
            ? "Paper trading only — Kalshi orders are simulated against the public order books and trade tape with Kalshi's fee schedule; nothing is sent to Kalshi. Not investment advice."
            : isIdea
            ? `Paper trading only — idea-lab book with its own ${usd(p.start_balance, false)}. Both legs are simulated Hyperliquid market orders (perp 4.5 bp, spot 7 bp taker, plus spread and latency); funding is settled hourly at the exchange's rate. Not investment advice.`
            : isLot
            ? "Paper trading only — no order is sent to OKX. Lots are simulated against OKX's live best bid/ask: taker buys at the ask + 0.05% with a 0.35% fee, maker sells fill when the bid reaches the target, 0.20% fee. Never-loss means losses sit in held lots: equity marks every bag at the bid. Not investment advice."
            : isCopy
            ? "Paper trading only — no copyfomo, no Telegram, no real order. Leader wallets are read from public Solana transactions; our copies are simulated swaps priced from real DexScreener pool data with AMM price impact, DEX fee, priority fee and latency slippage. fomo's board is an unofficial public feed. Most copy traders lose money. Not investment advice."
            : isHive
            ? "Paper trading only — simulated Solana/Base swaps priced from real DexScreener pool data with AMM price impact, DEX fee, gas/priority fee and latency slippage. CrawlHive's scan and LarpCheck's verdict are opinions, not guarantees: a coin both pass can still go to zero. Not investment advice."
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
