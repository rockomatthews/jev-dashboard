"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { ago, arrow, num, pct, polarity, price, signedUsd, usd, when } from "@/lib/format";
import type { PerfResponse } from "@/lib/types";

const Scene = dynamic(() => import("./Scene"), {
  ssr: false,
  loading: () => <div className="scene-loading">Rendering…</div>,
});

const POLL_MS = 30_000;
const STALE_AFTER_MS = 5 * 60_000;

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

export default function Dashboard({ initial }: { initial: PerfResponse }) {
  const [data, setData] = useState<PerfResponse>(initial);
  const [now, setNow] = useState(() => Date.now());

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

  const p = data.perf;
  const t = p.trades;
  const age = now - p.updated_ms;
  const state = data.source === "demo" ? "demo" : age > STALE_AFTER_MS ? "offline" : "live";
  const stateLabel = { live: "LIVE", offline: "OFFLINE", demo: "DEMO DATA" }[state];

  const dailyMax = useMemo(() => Math.max(1, ...p.daily.map((d) => Math.abs(d.pnl))), [p.daily]);
  const prices = Object.entries(p.status.prices ?? {});
  const since = p.curve.length ? p.curve[0][0] : p.updated_ms;

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden>◆</span>
          <span className="brand__name">JEV<span className="brand__slash">/</span>AGENT</span>
          <span className="brand__sub">paper trading · Hyperliquid perps · decisions by {p.status.jev === "jev" ? "Jev" : "mock Jev"}</span>
        </div>
        <div className="status">
          {p.status.kill && <span className="badge badge--critical">⛔ KILL SWITCH ARMED</span>}
          <span className={`badge badge--${state}`}>
            <span className="badge__dot" aria-hidden>{state === "live" ? "●" : state === "offline" ? "○" : "◌"}</span>
            {stateLabel}
          </span>
          <span className="status__ago">
            {state === "demo" ? "bot hasn't reported yet — showing a simulated run" : `updated ${ago(p.updated_ms, now)}`}
          </span>
        </div>
      </header>

      {prices.length > 0 && (
        <div className="ticker" aria-label="Latest prices">
          <div className="ticker__track">
            {[...prices, ...prices].map(([c, px], i) => (
              <span key={`${c}-${i}`} className="ticker__item"><b>{c}</b> {price(px)}</span>
            ))}
          </div>
        </div>
      )}

      <section className="hero">
        <div>
          <div className="hero__label">Paper equity</div>
          <div className="hero__equity">{usd(p.equity)}</div>
          <div className="hero__pnl">
            <Pol v={p.pnl}>{arrow(p.pnl)} {signedUsd(p.pnl)} ({pct(p.pnl_pct, 2, true)})</Pol>
            <span className="hero__since">since {when(since)} · started with {usd(p.start_balance, false)}</span>
          </div>
        </div>
        <div className="legend" aria-label="Legend">
          <span><i className="swatch swatch--gain" /> ▲ gain</span>
          <span><i className="swatch swatch--loss" /> ▼ loss</span>
          <span className="legend__note">Ribbon: equity vs. the {usd(p.start_balance, false)} start · Pillars: net P&amp;L per coin · drag to orbit, hover for detail</span>
        </div>
      </section>

      <section className="scene" aria-label="3D view of the equity curve and per-coin P&L">
        <Scene perf={p} />
      </section>

      <section className="stats">
        <Stat label="Total P&L" value={signedUsd(p.pnl)} v={p.pnl} sub={pct(p.pnl_pct, 2, true)} />
        <Stat label="Realized" value={signedUsd(p.realized)} v={p.realized} sub="price P&L on closed size" />
        <Stat label="Unrealized" value={signedUsd(p.unrealized)} v={p.unrealized} sub={`${t.open} open position${t.open === 1 ? "" : "s"}`} />
        <Stat label="Fees + funding" value={signedUsd(p.funding - p.fees)} v={p.funding - p.fees}
          sub={`fees ${usd(p.fees)} · funding ${signedUsd(p.funding)}`} />
        <Stat label="Max drawdown" value={pct(-p.max_drawdown, 2)} sub={`now ${pct(-p.current_drawdown, 2)} · limit −15%`} />
        <Stat label="Win rate" value={t.win_rate === null ? "—" : pct(t.win_rate, 1)} sub={`${t.wins} W · ${t.losses} L of ${t.closed}`} />
        <Stat label="Profit factor" value={num(t.profit_factor, 2)}
          sub={`avg win ${t.avg_win === null ? "—" : usd(t.avg_win)} · avg loss ${t.avg_loss === null ? "—" : usd(t.avg_loss)}`} />
        <Stat label="Best / worst trade" value={`${t.best === null ? "—" : signedUsd(t.best)}`}
          sub={`worst ${t.worst === null ? "—" : signedUsd(t.worst)}`} v={t.best ?? undefined} />
      </section>

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
          <h2>P&amp;L by coin</h2>
          <table>
            <thead><tr><th>Coin</th><th className="r">Realized</th><th className="r">Unrealized</th><th className="r">Fees</th><th className="r">Net</th><th className="r">Trades</th></tr></thead>
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
        </section>

        <section className="panel">
          <h2>Open positions</h2>
          {p.positions.length === 0 ? (
            <p className="empty">Flat — no open positions. The bot only enters when every gate passes.</p>
          ) : (
            <table>
              <thead><tr><th>Coin</th><th>Side</th><th className="r">Size</th><th className="r">Entry</th><th className="r">Mark</th><th className="r">Unrealized</th></tr></thead>
              <tbody>
                {p.positions.map((o) => (
                  <tr key={o.coin}>
                    <td className="coin">{o.coin}</td>
                    <td>{o.side === "long" ? "▲ long" : "▼ short"}</td>
                    <td className="r">{num(Math.abs(o.size), 4)}</td>
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
              <thead><tr><th>Closed</th><th>Coin</th><th>Side</th><th className="r">Fees</th><th className="r">P&amp;L</th></tr></thead>
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
              <thead><tr><th>Time</th><th>Coin</th><th>Side</th><th className="r">Size</th><th className="r">Price</th><th>Why</th></tr></thead>
              <tbody>
                {p.recent_fills.map((f, i) => (
                  <tr key={`${f.ts}-${i}`}>
                    <td className="muted">{when(f.ts)}</td>
                    <td className="coin">{f.coin}</td>
                    <td>{f.side}</td>
                    <td className="r">{num(f.size, 4)}</td>
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
        Paper trading only — simulated fills against real Hyperliquid order books, including fees, slippage and funding.
        Not investment advice. Step {p.status.step ?? "—"} · {p.status.coins?.join(" · ")}
      </footer>
    </main>
  );
}
