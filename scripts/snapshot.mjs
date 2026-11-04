// Record the daily snapshot: every active account's current value is saved to
// the History tab under today's date. Run by the GitHub Action late every
// evening; also runnable locally with `npm run snapshot`. Running it twice on
// the same day overwrites that day's rows instead of adding new ones.
import { nextFreeRow, parseAccounts, parseHistory, planSnapshot } from "../app/js/model.js";
import { DEFAULT_SHEET_ID, sheetsClient } from "./update-prices.mjs";

/** Today's date in Lithuania, as YYYY-MM-DD. */
export function todayVilnius(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vilnius", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The day a snapshot belongs to. A run that GitHub delays past midnight in
 * Vilnius (before 06:00) still counts for the evening before.
 */
export function snapshotDay(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vilnius", hour: "2-digit", hourCycle: "h23" }).format(now));
  return todayVilnius(hour < 6 ? new Date(now.getTime() - 6 * 3600 * 1000) : now);
}

/** The History rows to write for a snapshot of `accounts` on `date`. */
export function snapshotValues(accounts) {
  return accounts.filter((a) => a.active).map((a) => ({ account: a.name, value: Math.round(a.value * 100) / 100 }));
}

async function main() {
  const api = await sheetsClient(process.env.SHEET_ID || DEFAULT_SHEET_ID);
  const q = new URLSearchParams({ valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER" });
  q.append("ranges", "Accounts!A1:L300");
  q.append("ranges", "History!A:D");
  const { valueRanges } = await api(`/values:batchGet?${q}`);
  const [accountsGrid, historyGrid] = valueRanges.map((v) => v.values ?? []);

  const date = process.env.SNAPSHOT_DATE || snapshotDay();
  const values = snapshotValues(parseAccounts(accountsGrid));
  if (!values.length) throw new Error("No active accounts on the Accounts tab.");
  const plan = planSnapshot(date, values, parseHistory(historyGrid), nextFreeRow(historyGrid));

  // Grow the History tab if the new rows don't fit.
  const meta = await api(`?fields=sheets.properties(sheetId,title,gridProperties.rowCount)`);
  const tab = meta.sheets.find((s) => s.properties.title === "History")?.properties;
  if (!tab) throw new Error("The sheet has no History tab.");
  if (plan.lastRow > tab.gridProperties.rowCount) {
    await api(`:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: [{ appendDimension: { sheetId: tab.sheetId, dimension: "ROWS", length: plan.lastRow - tab.gridProperties.rowCount + 50 } }] }),
    });
  }

  await api(`/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: plan.updates.map((u) => ({ range: `History!A${u.row}:D${u.row}`, values: [u.values] })),
    }),
  });
  const total = values.reduce((s, v) => s + v.value, 0);
  for (const v of values) console.log(`${v.account}: ${v.value.toFixed(2)} EUR`);
  console.log(`Saved the ${date} snapshot: ${values.length} accounts, total ${total.toFixed(2)} EUR (${plan.updates.length - plan.appended} overwritten).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
