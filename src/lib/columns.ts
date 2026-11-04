/** Convert a 0-based column index to A1 letters (0 -> A, 26 -> AA). */
export function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Convert A1 column letters to a 0-based index (A -> 0, AA -> 26). */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Rewrite relative cell references that point at column `from` so they point
 * at column `to`. Absolute column refs ($BE2) and other columns are left alone.
 * Text inside double quotes is not touched.
 */
export function shiftFormulaColumn(formula: string, from: string, to: string): string {
  const parts = formula.split(/("(?:[^"]|"")*")/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // quoted string literal
      return part.replace(
        /(^|[^A-Za-z0-9_$!])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g,
        (m, pre, colAbs, letters, rowAbs, row) =>
          !colAbs && letters === from ? `${pre}${to}${rowAbs}${row}` : m,
      );
    })
    .join("");
}

/** True if the formula has a relative reference to the given column. */
export function referencesColumn(formula: string, col: string): boolean {
  return shiftFormulaColumn(formula, col, "\u0000") !== formula;
}
