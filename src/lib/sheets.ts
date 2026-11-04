import "server-only";
import { call } from "./sheets-client";
import { Cell, Portfolio, parsePortfolio } from "./portfolio";
import { HOLDINGS_SHEET, Holding, holdingUpdates, parseHoldings } from "./holdings";
import { SnapshotInput, SnapshotPlan, planSnapshot } from "./snapshot";

export const PORTFOLIO_SHEET = process.env.PORTFOLIO_SHEET_NAME || "Sheet1";
async function getValues(range: string, render: "UNFORMATTED_VALUE" | "FORMULA"): Promise<Cell[][]> {
  const q = new URLSearchParams({ valueRenderOption: render, dateTimeRenderOption: "FORMATTED_STRING" });
  const data = await call<{ values?: Cell[][] }>(`/values/${encodeURIComponent(range)}?${q}`);
  return data.values ?? [];
}

interface SheetMeta {
  sheetId: number;
  title: string;
  columnCount: number;
}

async function sheetMeta(title: string): Promise<SheetMeta> {
  const data = await call<{ sheets: { properties: { sheetId: number; title: string; gridProperties: { columnCount: number } } }[] }>(
    `?fields=sheets.properties(sheetId,title,gridProperties.columnCount)`,
  );
  const s = data.sheets.find((x) => x.properties.title === title);
  if (!s) throw new Error(`Sheet "${title}" not found`);
  return { sheetId: s.properties.sheetId, title, columnCount: s.properties.gridProperties.columnCount };
}

const READ_RANGE = (sheet: string) => `${sheet}!A1:ZZ200`;

export async function loadPortfolio(): Promise<Portfolio> {
  return parsePortfolio(await getValues(READ_RANGE(PORTFOLIO_SHEET), "UNFORMATTED_VALUE"));
}

export async function loadHoldings(): Promise<Holding[]> {
  try {
    return parseHoldings(await getValues(`${HOLDINGS_SHEET}!A1:H200`, "UNFORMATTED_VALUE"));
  } catch (e) {
    if (e instanceof Error && /Unable to parse range/.test(e.message)) return [];
    throw e;
  }
}

/** Write units (and, for typed or web prices, price and price date) back to each holding's own row. */
export async function saveHoldings(holdings: Holding[]): Promise<void> {
  const data = holdingUpdates(holdings);
  if (!data.length) return;
  await call(`/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
}

export async function saveSnapshot(input: SnapshotInput): Promise<SnapshotPlan> {
  const [values, formulas, meta] = await Promise.all([
    getValues(READ_RANGE(PORTFOLIO_SHEET), "UNFORMATTED_VALUE"),
    getValues(READ_RANGE(PORTFOLIO_SHEET), "FORMULA"),
    sheetMeta(PORTFOLIO_SHEET),
  ]);
  const plan = planSnapshot(PORTFOLIO_SHEET, parsePortfolio(values), formulas, meta.columnCount, input);

  const requests: object[] = [];
  if (plan.needsExtraColumn) {
    requests.push({ appendDimension: { sheetId: meta.sheetId, dimension: "COLUMNS", length: 1 } });
  }
  if (plan.copyFormatFrom !== null) {
    requests.push({
      copyPaste: {
        source: { sheetId: meta.sheetId, startColumnIndex: plan.copyFormatFrom, endColumnIndex: plan.copyFormatFrom + 1 },
        destination: { sheetId: meta.sheetId, startColumnIndex: plan.col, endColumnIndex: plan.col + 1 },
        pasteType: "PASTE_FORMAT",
      },
    });
  }
  if (requests.length) await call(`:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });

  await call(`/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: plan.updates }),
  });
  return plan;
}
