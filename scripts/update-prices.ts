// Fetch web prices for every "yahoo" holding and write them to the Holdings tab.
// Run by the daily GitHub Action; also runnable locally with `npm run update-prices`.
import { call } from "../src/lib/sheets-client";
import { HOLDINGS_SHEET, parseHoldings, priceUpdates } from "../src/lib/holdings";
import { fetchQuotes } from "../src/lib/prices";
import type { Cell } from "../src/lib/portfolio";

async function main() {
  const range = encodeURIComponent(`${HOLDINGS_SHEET}!A1:H200`);
  const { values = [] } = await call<{ values?: Cell[][] }>(`/values/${range}?valueRenderOption=UNFORMATTED_VALUE`);
  const holdings = parseHoldings(values);
  const symbols = [...new Set(holdings.filter((h) => h.source === "yahoo").map((h) => h.symbol))];
  if (!symbols.length) {
    console.log("No holdings with price source \"yahoo\". Nothing to do.");
    return;
  }

  const { quotes, errors } = await fetchQuotes(symbols);
  for (const [s, q] of Object.entries(quotes)) console.log(`${s}: ${q.priceEur.toFixed(4)} EUR (${q.price} ${q.currency}, ${q.date})`);
  for (const [s, e] of Object.entries(errors)) console.error(`${s}: FAILED – ${e}`);

  const data = priceUpdates(holdings, quotes);
  if (data.length) {
    await call(`/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
    console.log(`Updated ${data.length / 2} price(s) on the ${HOLDINGS_SHEET} tab.`);
  }
  if (Object.keys(errors).length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
