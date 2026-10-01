"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import data from "@/lib/backtests.json";

// Backtest lab: what $10,000 became in each strategy's full history (same cost model for all),
// on one log-scale axis. Hover for the value of every visible line at that week.

type Row = {
  key: string; n: number; name: string;
  stats: { from: string; to: string; sharpe: number; ci95: [number, number]; ret_yr_pct: number; vol_pct: number;
    max_dd_pct: number; worst_day_pct: number; final_10k: number; last_12m_pct: number; by_year_pct: Record<string, number> };
  curve: [number, number][];
};

const ROWS = (data as unknown as { strategies: Row[] }).strategies;
const BY_KEY: Record<string, Row> = Object.fromEntries(ROWS.map((r) => [r.key, r]));

// fixed categorical order (validated dark-mode slots 1-5); BTC is the neutral benchmark
const SERIES: { key: string; label: string; color: string; dash?: string }[] = [
  { key: "S1", label: "S1 Trend", color: "#3987e5" },
  { key: "S6@80", label: "S6 Breakout Rocket", color: "#d95926" },
  { key: "S3", label: "S3 Funding carry", color: "#199e70" },
  { key: "S4", label: "S4 Alt/BTC trend", color: "#c98500" },
  { key: "S5", label: "S5 Vol-managed momentum", color: "#d55181" },
  { key: "BTC", label: "Bitcoin buy & hold", color: "#8a8f9c", dash: "5 4" },
];

export const SLIDE_TO_BACKTEST: Record<string, string> = {
  trend: "S1", "idea:donchian_breakout": "S6@80", "idea:funding_carry": "S3", "idea:alt_btc_trend": "S4",
  "idea:vol_managed_momentum": "S5",
};

function money(v: number) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1)}k`;
  return `$${v.toFixed(0)}`;
}
const pctS = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;

export default function BacktestLab({ focus }: { focus: string | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(320, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = w < 600 ? 260 : 340;
  const pad = { l: 56, r: w < 600 ? 12 : 150, t: 12, b: 28 };
  const visible = SERIES.filter((s) => BY_KEY[s.key] && !hidden[s.key]);
  const { t0, t1, vmin, vmax } = useMemo(() => {
    const all = SERIES.filter((s) => BY_KEY[s.key]).flatMap((s) => BY_KEY[s.key].curve);
    return {
      t0: Math.min(...all.map((p) => p[0])), t1: Math.max(...all.map((p) => p[0])),
      vmin: Math.max(1000, Math.min(...all.map((p) => p[1]))), vmax: Math.max(...all.map((p) => p[1])),
    };
  }, []);
  const lmin = Math.log10(vmin) - 0.05;
  const lmax = Math.log10(vmax) + 0.05;
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (Math.log10(Math.max(v, 1)) - lmin) / (lmax - lmin)) * (H - pad.t - pad.b);
  const yTicks = [1e3, 3e3, 1e4, 3e4, 1e5, 3e5, 1e6, 3e6, 1e7].filter((v) => Math.log10(v) >= lmin && Math.log10(v) <= lmax);
  const years = [2021, 2022, 2023, 2024, 2025, 2026].map((yy) => Date.UTC(yy, 0, 1)).filter((t) => t > t0 && t < t1);

  const path = (c: [number, number][]) => c.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const at = (c: [number, number][], t: number) => {
    if (t < c[0][0] || t > c[c.length - 1][0]) return null;
    let best = c[0];
    for (const p of c) { if (p[0] <= t) best = p; else break; }
    return best[1];
  };

  const focused = focus ? BY_KEY[focus] : null;
  const ends = visible.map((s) => {
    const c = BY_KEY[s.key].curve;
    return { ...s, v: c[c.length - 1][1], yy: y(c[c.length - 1][1]) };
  }).sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 14) ends[i].yy = ends[i - 1].yy + 14; // de-collide labels

  const hoverT = hover === null ? null : t0 + ((hover - pad.l) / (w - pad.l - pad.r)) * (t1 - t0);

  return (
    <section className="panel backtest">
      <h2>Backtest lab <span className="panel__hint">$10,000 through each strategy&apos;s full history · same costs for all: 4.5 bp taker + 1 bp latency + spread, real funding · log scale</span></h2>
      {focused ? (
        <p className="strategy__what">
          <b>{focused.name}</b>: $10,000 on {focused.stats.from} → <b>{money(focused.stats.final_10k)}</b> today
          ({pctS(focused.stats.ret_yr_pct)}/yr, Sharpe {focused.stats.sharpe.toFixed(2)}, 95% range {focused.stats.ci95[0]} … {focused.stats.ci95[1]}).
          Worst peak-to-trough <b>−{focused.stats.max_dd_pct}%</b>; last 12 months <b className={`pol pol--${focused.stats.last_12m_pct >= 0 ? "gain" : "loss"}`}>{pctS(focused.stats.last_12m_pct)}</b>.
        </p>
      ) : (
        <p className="strategy__what">This strategy has no historical data to backtest (its market data isn&apos;t archived), so its live paper run is the test. Here is how the backtestable strategies did.</p>
      )}
      <div className="bt-chips" role="group" aria-label="Show or hide strategies">
        {SERIES.filter((s) => BY_KEY[s.key]).map((s) => (
          <button key={s.key} type="button" className={`bt-chip ${hidden[s.key] ? "bt-chip--off" : ""}`}
            onClick={() => setHidden((h) => ({ ...h, [s.key]: !h[s.key] }))} aria-pressed={!hidden[s.key]}>
            <i style={{ background: s.color }} />{s.label}
          </button>
        ))}
      </div>
      <div ref={wrap} className="bt-chart">
        <svg width={w} height={H} onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = e.clientX - r.left;
          setHover(px >= pad.l && px <= w - pad.r ? px : null);
        }} onMouseLeave={() => setHover(null)} role="img" aria-label="Equity curves of $10,000 per strategy, log scale">
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="bt-grid" />
              <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="bt-axis">{money(v)}</text>
            </g>
          ))}
          {years.map((t) => (
            <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="bt-axis">{new Date(t).getUTCFullYear()}</text>
          ))}
          <line x1={pad.l} x2={w - pad.r} y1={y(10_000)} y2={y(10_000)} className="bt-base" />
          {visible.map((s) => {
            const dim = focus && SERIES.some((z) => z.key === focus) && s.key !== focus && s.key !== "BTC";
            return (
              <path key={s.key} d={path(BY_KEY[s.key].curve)} fill="none" stroke={s.color} strokeWidth={s.key === focus ? 2.5 : 2}
                strokeDasharray={s.dash} opacity={dim ? 0.35 : 1} strokeLinejoin="round" />
            );
          })}
          {w >= 600 && ends.map((e) => (
            <g key={e.key}>
              <circle cx={x(t1)} cy={y(e.v)} r={3} fill={e.color} />
              <text x={x(t1) + 8} y={e.yy + 4} className="bt-endlabel">{e.label.split(" ")[0]} {money(e.v)}</text>
            </g>
          ))}
          {hover !== null && hoverT !== null && (
            <line x1={hover} x2={hover} y1={pad.t} y2={H - pad.b} className="bt-cross" />
          )}
        </svg>
        {hover !== null && hoverT !== null && (
          <div className="tooltip bt-tip" style={{ left: Math.min(hover + 12, w - 210) }}>
            <div className="tooltip__time">{new Date(hoverT).toISOString().slice(0, 10)}</div>
            {visible.map((s) => {
              const v = at(BY_KEY[s.key].curve, hoverT);
              return v === null ? null : (
                <div key={s.key} className="tooltip__row"><span><i className="bt-dot" style={{ background: s.color }} />{s.label}</span><b>{money(v)}</b></div>
              );
            })}
          </div>
        )}
      </div>
      <table className="bt-table">
        <thead><tr><th>Strategy</th><th className="r">$10k became</th><th className="r">Return / yr</th><th className="r">Sharpe (95% range)</th><th className="r">Worst drawdown</th><th className="r">Last 12 months</th><th className="r">Since</th></tr></thead>
        <tbody>
          {["S1", "S6@60", "S6@80", "S6@100", "S6@120", "S6@150", "S3", "S4", "S5", "BTC"].filter((k) => BY_KEY[k]).map((k) => {
            const r = BY_KEY[k];
            return (
              <tr key={k} className={k === focus ? "row--live" : ""}>
                <td className="coin">{r.name}</td>
                <td className="r"><b>{money(r.stats.final_10k)}</b></td>
                <td className="r">{pctS(r.stats.ret_yr_pct)}</td>
                <td className="r">{r.stats.sharpe.toFixed(2)} <span className="muted">({r.stats.ci95[0]} … {r.stats.ci95[1]})</span></td>
                <td className="r">−{r.stats.max_dd_pct}%</td>
                <td className="r"><span className={`pol pol--${r.stats.last_12m_pct >= 0 ? "gain" : "loss"}`}>{pctS(r.stats.last_12m_pct)}</span></td>
                <td className="r muted">{r.stats.from}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="empty">
        Read this honestly: the big numbers come from 2021 and 2023, and every directional strategy lost money over the last
        12 months while Bitcoin fell 28.5%. The coin list is today&apos;s survivors, which flatters long-only results. Above ~100%
        target volatility the Breakout Rocket stops growing and only adds drawdown — that is why the live book sits at 80%.
        Funding carry only has two years of data. None of this is a promise about the next 12 months.
      </p>
    </section>
  );
}
