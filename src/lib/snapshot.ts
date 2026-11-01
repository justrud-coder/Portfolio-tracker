import { colLetter, referencesColumn, shiftFormulaColumn } from "./columns";
import { Cell, FIRST_DATE_COL, Portfolio, formatHeader } from "./portfolio";

export interface SnapshotInput {
  /** ISO date YYYY-MM-DD */
  date: string;
  /** Position name -> value in EUR. Positions not listed are written as blank. */
  values: Record<string, number | null>;
}

export interface ValueUpdate {
  range: string;
  values: (string | number)[][];
}

export interface SnapshotPlan {
  /** 0-based column the snapshot is written to */
  col: number;
  /** True if a new column is created, false if an existing one with the same date is overwritten */
  isNew: boolean;
  /** True if the sheet grid needs one more column before writing */
  needsExtraColumn: boolean;
  /** Copy number formats from this column into the new one (null when overwriting) */
  copyFormatFrom: number | null;
  updates: ValueUpdate[];
}

/**
 * Work out every cell write needed to save a snapshot.
 *
 * - A new date goes in a new column right after the last snapshot.
 *   Summary formulas ("Viso", "Liquid", ...) are copied from the previous
 *   column with references shifted, and formulas below the summary block
 *   (the Split table) that point at the previous column are re-pointed.
 * - A date that already exists overwrites that column's position values only.
 *
 * `formulas` is Sheet1 read with valueRenderOption=FORMULA.
 */
export function planSnapshot(
  sheet: string,
  portfolio: Portfolio,
  formulas: Cell[][],
  columnCount: number,
  input: SnapshotInput,
): SnapshotPlan {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error(`Invalid date: ${input.date}`);
  const unknown = Object.keys(input.values).filter((n) => !portfolio.positions.some((p) => p.name === n));
  if (unknown.length) throw new Error(`Unknown positions: ${unknown.join(", ")}`);

  const existing = portfolio.snapshots.find((s) => s.date === input.date);
  const last = portfolio.snapshots[portfolio.snapshots.length - 1];
  if (!existing && last && input.date < last.date) {
    throw new Error(`Date ${input.date} is before the last snapshot (${last.date}). Only the latest month can be added.`);
  }

  const col = existing ? existing.col : last ? last.col + 1 : FIRST_DATE_COL;
  const L = colLetter(col);
  const updates: ValueUpdate[] = [];

  if (!existing) updates.push({ range: `${sheet}!${L}1`, values: [[formatHeader(input.date)]] });

  for (const p of portfolio.positions) {
    if (!(p.name in input.values) && existing) continue; // leave untouched when overwriting
    const v = input.values[p.name];
    updates.push({ range: `${sheet}!${L}${p.row + 1}`, values: [[v === null || v === undefined ? "" : round2(v)]] });
  }

  if (!existing && last) {
    const prev = colLetter(last.col);
    for (const s of portfolio.summary) {
      const f = formulas[s.row]?.[last.col];
      if (typeof f === "string" && f.startsWith("=")) {
        updates.push({ range: `${sheet}!${L}${s.row + 1}`, values: [[shiftFormulaColumn(f, prev, L)]] });
      }
    }
    // Re-point formulas below the summary block (e.g. the Split table) to the new column.
    for (let r = portfolio.summaryEndRow + 1; r < formulas.length; r++) {
      const row = formulas[r] ?? [];
      for (let c = 0; c < row.length; c++) {
        const f = row[c];
        if (typeof f === "string" && f.startsWith("=") && referencesColumn(f, prev)) {
          updates.push({ range: `${sheet}!${colLetter(c)}${r + 1}`, values: [[shiftFormulaColumn(f, prev, L)]] });
        }
      }
    }
  }

  return {
    col,
    isNew: !existing,
    needsExtraColumn: !existing && col >= columnCount,
    copyFormatFrom: !existing && last ? last.col : null,
    updates,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
