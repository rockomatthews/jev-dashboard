"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { demoSniperPerf } from "@/lib/demo-sniper";
import { ago, arrow, num, pct, polarity, price, signedUsd, usd, when } from "@/lib/format";
import type { Performance, PerfResponse, RadarItem, SniperInfo } from "@/lib/types";

const Scene = dynamic(() => import("./Scene"), {
  ssr: false,
  loading: () => <div className="scene-loading">Rendering…</div>,
});

const SniperScene = dynamic(() => import("./SniperScene"), {
  ssr: false,
  loading: () => <div className="scene-loading">Spinning up the radar…</div>,
});

const POLL_MS = 30_000;
const STALE_AFTER_MS = 5 * 60_000;

type SlideKey = "trend" | "sniper";

const SLIDES: { key: SlideKey; n: number; name: string; blurb: string }[] = [
  { key: "trend", n: 1, name: "Trend ensemble", blurb: "Hyperliquid perps · daily trend · long only" },
  { key: "sniper", n: 2, name: "Memecoin sniper", blurb: "Solana DEX pairs · scans every minute · aggressive" },
];

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
function Carousel({ slide, onPrev, onNext, equities }: {
  slide: number; onPrev: () => void; onNext: () => void; equities: (number | null)[];
}) {
  const s = SLIDES[slide];
  return (
    <nav className="carousel" aria-label="Strategies">
      <button type="button" className="carousel__btn" onClick={onPrev} aria-label="Previous strategy">
        <span aria-hidden>◀</span>
      </button>
      <div className="carousel__body" aria-live="polite">
        <div className="carousel__kicker">STRATEGY {s.n} / {SLIDES.length}</div>
        <div className="carousel__name">{s.name}</div>
        <div className="carousel__blurb">{s.blurb}</div>
        <div className="carousel__dots">
          {SLIDES.map((x, i) => (
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
          It buys the best pair scoring {num(c.min_score, 2)} or more with {pct(c.position_frac, 0)} of equity, up to {c.max_open} at once.
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
// Page
// =============================================================================================
export default function Dashboard({ initial }: { initial: PerfResponse }) {
  const [data, setData] = useState<PerfResponse>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [slide, setSlide] = useState(0);
  const [dir, setDir] = useState<"left" | "right">("right");
  // Both 3D scenes stay mounted once visited (unmounting a canvas with HTML overlays mid-render
  // breaks React's DOM bookkeeping); the hidden one stops rendering frames.
  const [visited, setVisited] = useState<Record<SlideKey, boolean>>({ trend: true, sniper: false });

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

  const isSniper = SLIDES[slide].key === "sniper";
  const p: Performance = isSniper ? sniperPerf : data.perf;
  const sn = isSniper ? p.sniper : undefined;
  const t = p.trades;

  const go = (step: number) => {
    const next = (slide + step + SLIDES.length) % SLIDES.length;
    setDir(step > 0 ? "right" : "left");
    setVisited((v) => ({ ...v, [SLIDES[next].key]: true }));
    setSlide(next);
  };

  const age = now - p.updated_ms;
  const staleAfter = data.source === "snapshot" ? 90 * 60_000 : STALE_AFTER_MS;
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
    : Object.entries(p.status.prices ?? {}).map(([c, px]) => [c, price(px)]);

  return (
    <main className={`page page--${SLIDES[slide].key}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden>◆</span>
          <span className="brand__name">JEV<span className="brand__slash">/</span>AGENT</span>
          <span className="brand__sub">
            {isSniper
              ? "paper trading · Solana DEX memecoins · DexScreener radar"
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

      <Carousel slide={slide} onPrev={() => go(-1)} onNext={() => go(1)}
        equities={[data.perf.equity, sniperDemo ? null : sniperPerf.equity]} />

      <div key={SLIDES[slide].key} className={`slide slide--from-${dir}`}>
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
            <div className="hero__label">{isSniper ? "Sniper paper equity" : "Paper equity"}</div>
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
          ) : (
            <div className="legend" aria-label="Legend">
              <span><i className="swatch swatch--gain" /> ▲ gain</span>
              <span><i className="swatch swatch--loss" /> ▼ loss</span>
              <span className="legend__note">Ribbon: equity vs. the {usd(p.start_balance, false)} start · Pillars: net P&amp;L per coin · drag to orbit, hover for detail</span>
            </div>
          )}
        </section>

      </div>

      <section className={`scene ${isSniper ? "scene--sniper" : ""}`}
        aria-label={isSniper ? "3D cluster map of Solana pairs the sniper is tracking" : "3D view of the equity curve and per-coin P&L"}>
        <div className={`scene__layer ${!isSniper ? "scene__layer--on" : ""}`} aria-hidden={isSniper}>
          <Scene perf={data.perf} active={!isSniper} />
        </div>
        {visited.sniper && sniperPerf.sniper && (
          <div className={`scene__layer ${isSniper ? "scene__layer--on" : ""}`} aria-hidden={!isSniper}>
            <SniperScene sniper={sniperPerf.sniper} demo={sniperDemo} active={isSniper} />
          </div>
        )}
      </section>

      <div key={`${SLIDES[slide].key}-body`} className={`slide slide--from-${dir}`}>
        <section className="stats">
          <Stat label="Total P&L" value={signedUsd(p.pnl)} v={p.pnl} sub={pct(p.pnl_pct, 2, true)} />
          <Stat label="Realized" value={signedUsd(p.realized)} v={p.realized} sub="price P&L on closed size" />
          <Stat label="Unrealized" value={signedUsd(p.unrealized)} v={p.unrealized} sub={`${t.open} open position${t.open === 1 ? "" : "s"}`} />
          {isSniper ? (
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

        {isSniper && sn ? <SniperPanels p={p} sn={sn} demo={sniperDemo} now={now} /> : <TrendPanels p={p} />}

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
          {isSniper
            ? "Paper trading only — simulated swaps priced from real DexScreener pool data with AMM price impact, DEX and priority fees and latency slippage. Most new memecoins go to zero; this measures whether filters and exits beat that. Not investment advice."
            : `Paper trading only — simulated fills against real Hyperliquid order books, including fees, slippage and funding. Not investment advice. Step ${p.status.step ?? "—"} · ${p.status.coins?.join(" · ") ?? ""}`}
        </footer>
      </div>
    </main>
  );
}
