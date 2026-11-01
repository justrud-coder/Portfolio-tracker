import "server-only";
import { JWT } from "google-auth-library";
import { Cell, Portfolio, parsePortfolio } from "./portfolio";
import { HOLDINGS_SHEET, Holding, holdingsToRows, parseHoldings } from "./holdings";
import { SnapshotInput, SnapshotPlan, planSnapshot } from "./snapshot";

export const PORTFOLIO_SHEET = process.env.PORTFOLIO_SHEET_NAME || "Sheet1";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

let client: JWT | null = null;
function auth(): JWT {
  if (!client) {
    client = new JWT({
      email: env("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
      key: env("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  return client;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { token } = await auth().getAccessToken();
  const res = await fetch(`${API}/${env("SHEET_ID")}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google Sheets API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

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

export async function saveHoldings(holdings: Holding[]): Promise<void> {
  await call(`/values/${encodeURIComponent(`${HOLDINGS_SHEET}!A1:H200`)}:clear`, { method: "POST", body: "{}" });
  await call(`/values/${encodeURIComponent(`${HOLDINGS_SHEET}!A1`)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: holdingsToRows(holdings) }),
  });
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
