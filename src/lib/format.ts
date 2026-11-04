const eur0 = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const pct1 = new Intl.NumberFormat("en-IE", { style: "percent", maximumFractionDigits: 1 });

export const fmtEur = (n: number) => eur0.format(n);
export const fmtPrice = (n: number) => eur2.format(n);
export const fmtPct = (n: number) => pct1.format(n);
export const signed = (n: number, f: (n: number) => string) => (n > 0 ? "+" : n < 0 ? "−" : "") + f(Math.abs(n));
export const trend = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "muted");

/** Stable colour per dashboard group. */
export const GROUP_COLORS: Record<string, string> = {
  "Stocks & funds": "var(--c1)",
  Options: "var(--c2)",
  "Real estate": "var(--c3)",
  Cash: "var(--c6)",
  "II pillar": "var(--c4)",
  Crypto: "var(--c5)",
};
export const colorFor = (group: string) => GROUP_COLORS[group] ?? "var(--c7)";
