import { Portfolio, currentValue } from "./portfolio";

export interface Change {
  abs: number;
  pct: number;
  since: string;
}

export interface DashboardData {
  asOf: string;
  total: number;
  liquid: number | null;
  vsPrevious: Change | null;
  ytd: Change | null;
  vsYearAgo: Change | null;
  /** One point per snapshot: date, total, and one key per group */
  series: Record<string, number | string>[];
  groups: string[];
  allocation: { group: string; value: number; share: number }[];
  rows: {
    name: string;
    group: string;
    value: number;
    previous: number;
    change: number;
    share: number;
  }[];
  closed: string[];
}

function change(now: number, then: number, since: string): Change {
  return { abs: now - then, pct: then ? (now - then) / then : 0, since };
}

export function buildDashboard(p: Portfolio): DashboardData {
  const n = p.snapshots.length;
  if (n === 0) throw new Error("No snapshots found in the sheet");
  const last = n - 1;
  const total = p.totals[last];
  const asOf = p.snapshots[last].date;

  const groups = [...new Set(p.positions.map((x) => x.group))];
  const series = p.snapshots.map((s, i) => {
    const point: Record<string, number | string> = { date: s.date, total: p.totals[i] };
    for (const g of groups) point[g] = 0;
    for (const pos of p.positions) point[pos.group] = (point[pos.group] as number) + (pos.values[i] ?? 0);
    return point;
  });

  const vsPrevious = n > 1 ? change(total, p.totals[last - 1], p.snapshots[last - 1].date) : null;

  const year = asOf.slice(0, 4);
  let ytdIdx = -1;
  for (let i = 0; i < n; i++) if (p.snapshots[i].date.slice(0, 4) < year) ytdIdx = i;
  const ytd = ytdIdx >= 0 ? change(total, p.totals[ytdIdx], p.snapshots[ytdIdx].date) : null;

  const yearAgo = new Date(asOf);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const yaIso = yearAgo.toISOString().slice(0, 10);
  let yaIdx = -1;
  for (let i = 0; i < n; i++) if (p.snapshots[i].date <= yaIso) yaIdx = i;
  const vsYearAgo = yaIdx >= 0 && yaIdx < last ? change(total, p.totals[yaIdx], p.snapshots[yaIdx].date) : null;

  const liquidRow = p.summary.find((s) => s.name.toLowerCase() === "liquid");
  const liquid = liquidRow ? liquidRow.values[last] : null;

  const allocation = groups
    .map((g) => ({ group: g, value: series[last][g] as number, share: total ? (series[last][g] as number) / total : 0 }))
    .filter((a) => a.value !== 0)
    .sort((a, b) => b.value - a.value);

  const rows = p.positions
    .filter((pos) => currentValue(pos) !== 0)
    .map((pos) => {
      const value = currentValue(pos);
      const previous = last > 0 ? pos.values[last - 1] ?? 0 : 0;
      return { name: pos.name, group: pos.group, value, previous, change: value - previous, share: total ? value / total : 0 };
    })
    .sort((a, b) => b.value - a.value);

  const closed = p.positions.filter((pos) => currentValue(pos) === 0).map((pos) => pos.name);

  return { asOf, total, liquid, vsPrevious, ytd, vsYearAgo, series, groups, allocation, rows, closed };
}
