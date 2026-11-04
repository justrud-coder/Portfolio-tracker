import { Cell, toNumber } from "./portfolio";

/** google = the sheet prices it with a GOOGLEFINANCE formula; the app never overwrites it. */
export type PriceSource = "yahoo" | "manual" | "fixed" | "google";

export interface Holding {
  /** 0-based row in the Holdings tab */
  row?: number;
  /** Must match a position name in Sheet1 column B, e.g. "IBKR" */
  position: string;
  symbol: string;
  name: string;
  units: number;
  source: PriceSource;
  /** Last known price in EUR */
  lastPrice: number | null;
  currency: string;
  /** ISO date of lastPrice */
  priceDate: string;
}

export const HOLDINGS_SHEET = "Holdings";
export const HOLDINGS_HEADER = ["Position", "Symbol", "Name", "Units", "Price source", "Last price", "Currency", "Price date"];

export function parseHoldings(grid: Cell[][]): Holding[] {
  const out: Holding[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const position = String(row?.[0] ?? "").trim();
    const symbol = String(row?.[1] ?? "").trim();
    if (!position || !symbol) continue;
    const src = String(row[4] ?? "").trim().toLowerCase();
    out.push({
      row: r,
      position,
      symbol,
      name: String(row[2] ?? "").trim(),
      units: toNumber(row[3]) ?? 0,
      source: src === "yahoo" || src === "fixed" || src === "google" ? src : "manual",
      lastPrice: toNumber(row[5]),
      currency: String(row[6] ?? "EUR").trim() || "EUR",
      priceDate: String(row[7] ?? "").trim(),
    });
  }
  return out;
}

export function holdingsToRows(holdings: Holding[]): (string | number)[][] {
  return [
    HOLDINGS_HEADER,
    ...holdings.map((h) => [
      h.position,
      h.symbol,
      h.name,
      h.units,
      h.source,
      h.lastPrice ?? "",
      h.currency,
      h.priceDate,
    ]),
  ];
}

export function holdingValue(h: Holding, price: number | null = h.lastPrice): number {
  return h.units * (price ?? 0);
}

/** Cell writes for saving holdings. GOOGLEFINANCE-priced and fixed rows keep their price cells. */
export function holdingUpdates(holdings: Holding[]): { range: string; values: (string | number)[][] }[] {
  const out: { range: string; values: (string | number)[][] }[] = [];
  for (const h of holdings) {
    if (h.row === undefined) continue;
    const n = h.row + 1;
    out.push({ range: `${HOLDINGS_SHEET}!D${n}`, values: [[h.units]] });
    if (h.source === "manual" || h.source === "yahoo") {
      out.push({ range: `${HOLDINGS_SHEET}!F${n}`, values: [[h.lastPrice ?? ""]] });
      out.push({ range: `${HOLDINGS_SHEET}!H${n}`, values: [[h.priceDate]] });
    }
  }
  return out;
}

/** Cell writes that store fetched web prices (EUR) and their dates on the Holdings tab. */
export function priceUpdates(
  holdings: Holding[],
  quotes: Record<string, { priceEur: number; date: string }>,
): { range: string; values: (string | number)[][] }[] {
  const out: { range: string; values: (string | number)[][] }[] = [];
  for (const h of holdings) {
    const q = quotes[h.symbol];
    if (h.source !== "yahoo" || h.row === undefined || !q) continue;
    const n = h.row + 1;
    out.push({ range: `${HOLDINGS_SHEET}!F${n}`, values: [[Math.round(q.priceEur * 10000) / 10000]] });
    out.push({ range: `${HOLDINGS_SHEET}!H${n}`, values: [[q.date]] });
  }
  return out;
}
