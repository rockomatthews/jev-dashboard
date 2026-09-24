export const GAIN = "#1b9bd0"; // validated CVD-safe pair on the #070a12 surface
export const LOSS = "#d96b25";

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function usd(v: number, cents = true): string {
  return (cents ? usd2 : usd0).format(v);
}

/** Signed money with an explicit +/− so polarity never relies on color alone. */
export function signedUsd(v: number, cents = true): string {
  if (Math.abs(v) < 0.005) return usd(0, cents);
  return `${v > 0 ? "+" : "−"}${usd(Math.abs(v), cents)}`;
}

export function pct(v: number | null | undefined, digits = 2, signed = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = (Math.abs(v) * 100).toFixed(digits) + "%";
  if (!signed || Math.abs(v) < 1e-9) return (v < 0 && !signed ? "−" : "") + s;
  return (v > 0 ? "+" : "−") + s;
}

export function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function price(v: number): string {
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  return v.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

export function polarity(v: number): "gain" | "loss" | "flat" {
  if (v > 0.005) return "gain";
  if (v < -0.005) return "loss";
  return "flat";
}

export function arrow(v: number): string {
  const p = polarity(v);
  return p === "gain" ? "▲" : p === "loss" ? "▼" : "■";
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function when(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
