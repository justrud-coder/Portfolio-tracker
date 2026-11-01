import { Cell, toNumber } from "./portfolio";

export type PriceSource = "yahoo" | "manual" | "fixed";

export interface Holding {
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
  for (const row of grid.slice(1)) {
    const position = String(row?.[0] ?? "").trim();
    const symbol = String(row?.[1] ?? "").trim();
    if (!position || !symbol) continue;
    const src = String(row[4] ?? "").trim().toLowerCase();
    out.push({
      position,
      symbol,
      name: String(row[2] ?? "").trim(),
      units: toNumber(row[3]) ?? 0,
      source: src === "yahoo" || src === "fixed" ? src : "manual",
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
