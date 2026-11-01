import { colLetter } from "./columns";

export type Cell = string | number | boolean | null | undefined;

export interface Snapshot {
  /** 0-based column index in Sheet1 */
  col: number;
  /** ISO date, YYYY-MM-DD */
  date: string;
}

export interface Position {
  /** 0-based row index in Sheet1 */
  row: number;
  name: string;
  /** Raw asset class from column C ("Akcijos", "NT", ...). May be empty. */
  rawClass: string;
  /** Display group used by the dashboard */
  group: string;
  /** One value per snapshot, same order as `snapshots`. null = blank cell. */
  values: (number | null)[];
}

export interface SummaryRow {
  row: number;
  name: string;
  values: (number | null)[];
}

export interface Portfolio {
  snapshots: Snapshot[];
  positions: Position[];
  /** Rows such as "Viso", "Liquid", "Super liquid" */
  summary: SummaryRow[];
  /** Total per snapshot, computed from positions (matches the "Viso" row) */
  totals: number[];
  /** 0-based index of the last row of the summary block */
  summaryEndRow: number;
}

export const NAME_COL = 1; // column B
export const CLASS_COL = 2; // column C
export const FIRST_DATE_COL = 3; // column D
export const TOTAL_ROW_NAME = "Viso";

const HEADER_DATE = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/;

export function parseHeaderDate(header: Cell): string | null {
  if (typeof header !== "string") return null;
  const m = header.match(HEADER_DATE);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

export function formatHeader(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `Verte\n${y}.${m}.${d}`;
}

const GROUPS: Record<string, string> = {
  akcijos: "Stocks & funds",
  crypto: "Crypto",
  cash: "Cash",
  nt: "Real estate",
  "ii pakopa": "II pillar",
};

/** Map a position to a dashboard group. Blank class counts as cash (as the sheet's Split block does). */
export function groupFor(name: string, rawClass: string): string {
  if (/option/i.test(name)) return "Options";
  const key = rawClass.trim().toLowerCase();
  if (!key) return "Cash";
  return GROUPS[key] ?? rawClass.trim();
}

export function toNumber(v: Cell): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return null;
  const cleaned = v.replace(/\s/g, "").replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse Sheet1 values (UNFORMATTED_VALUE render) into a portfolio.
 * Layout: row 0 = headers, column B = position name, C = asset class,
 * D.. = one column per snapshot. Positions run until the "Viso" (total) row;
 * summary rows run from "Viso" until the first row with an empty name.
 */
export function parsePortfolio(grid: Cell[][]): Portfolio {
  const header = grid[0] ?? [];
  const snapshots: Snapshot[] = [];
  for (let c = FIRST_DATE_COL; c < header.length; c++) {
    const date = parseHeaderDate(header[c]);
    if (date) snapshots.push({ col: c, date });
  }

  const positions: Position[] = [];
  const summary: SummaryRow[] = [];
  let inSummary = false;
  let summaryEndRow = -1;

  const rowValues = (row: Cell[]) => snapshots.map((s) => toNumber(row[s.col]));

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const name = typeof row[NAME_COL] === "string" ? (row[NAME_COL] as string).trim() : "";
    if (!inSummary) {
      if (name === TOTAL_ROW_NAME) {
        inSummary = true;
        summary.push({ row: r, name, values: rowValues(row) });
        summaryEndRow = r;
        continue;
      }
      if (!name) continue;
      const rawClass = typeof row[CLASS_COL] === "string" ? (row[CLASS_COL] as string) : "";
      positions.push({ row: r, name, rawClass, group: groupFor(name, rawClass), values: rowValues(row) });
    } else {
      if (!name) break;
      summary.push({ row: r, name, values: rowValues(row) });
      summaryEndRow = r;
    }
  }

  if (!inSummary) throw new Error(`Could not find the "${TOTAL_ROW_NAME}" row in Sheet1`);

  const totals = snapshots.map((_, i) => positions.reduce((sum, p) => sum + (p.values[i] ?? 0), 0));
  return { snapshots, positions, summary, totals, summaryEndRow };
}

export function latestValue(p: Position): number {
  for (let i = p.values.length - 1; i >= 0; i--) {
    const v = p.values[i];
    if (v !== null) return v;
  }
  return 0;
}

/** Value at the last snapshot (blank counts as 0). */
export function currentValue(p: Position): number {
  return p.values[p.values.length - 1] ?? 0;
}

export function lastSnapshotLetter(p: Portfolio): string {
  const last = p.snapshots[p.snapshots.length - 1];
  return colLetter(last.col);
}
