import { test } from "node:test";
import assert from "node:assert/strict";
import {
  columns,
  nextFreeRow,
  num,
  parseAccounts,
  parseGoals,
  parseHistory,
  parseHoldings,
  parseMonthly,
  planSnapshot,
  serialToIso,
  summarize,
  transactionRow,
  transactionValue,
} from "../app/js/model.js";
import { priceUpdates } from "../scripts/prices.mjs";

const ACCOUNTS = [
  ["Account", "Asset class", "Liquidity", "Valuation", "Active", "Notes", "Current value (EUR)", "Last snapshot", "Invested (EUR)", "Gain (EUR)", "Gain %"],
  ["IBKR", "Stocks", "Super liquid", "holdings", true, "", 36944, 46300, 25076, 11868, 0.473],
  ["III pillar", "Pension", "Liquid", "manual", true, "", 13039, 46300, "", "", ""],
  ["Vinted options", "Options", "Locked", "manual", true, "", 58303, 46300, "", "", ""],
  ["II pillar", "Pension", "Locked", "manual", false, "", 0, 46147, "", "", ""],
  ["", "", "", "", false],
];

test("serialToIso handles serials and ISO strings", () => {
  assert.equal(serialToIso(46300), "2026-10-05");
  assert.equal(serialToIso("2026-11-04"), "2026-11-04");
  assert.equal(serialToIso(""), "");
});

test("num parses numbers and formatted strings", () => {
  assert.equal(num(12.5), 12.5);
  assert.equal(num("€1,234"), 1234);
  assert.equal(num("-"), null);
  assert.equal(num(""), null);
});

test("columns matches headers with units in brackets", () => {
  const c = columns(["Date", "Total (EUR)", "Change %"], { date: "Date", total: "Total", pct: "Change %", missing: "Nope" });
  assert.deepEqual(c, { date: 0, total: 1, pct: 2, missing: -1 });
});

test("parseAccounts reads by header and skips blank rows", () => {
  const a = parseAccounts(ACCOUNTS);
  assert.equal(a.length, 4);
  assert.equal(a[0].valuation, "holdings");
  assert.equal(a[0].lastSnapshot, "2026-10-05");
  assert.equal(a[1].invested, null);
  assert.equal(a[3].active, false);
});

test("summarize totals active accounts and gain on accounts with cost", () => {
  const monthly = parseMonthly([
    ["Date", "Total (EUR)", "Change (EUR)", "Change %", "Stocks"],
    [46270, 237712, "", "", 1],
    [46300, 242162, 4450, 0.019, 2],
  ]);
  const s = summarize(parseAccounts(ACCOUNTS), monthly);
  assert.equal(s.total, 36944 + 13039 + 58303);
  assert.equal(s.invested, 25076);
  assert.equal(s.gain, 36944 - 25076);
  assert.equal(s.lastMonth, 4450);
  assert.equal(s.sinceSnapshot, s.total - 242162);
  assert.deepEqual(s.allocation.map((x) => x.name), ["Options", "Stocks", "Pension"]);
  assert.deepEqual(s.liquidity.map((x) => x.name), ["Super liquid", "Liquid", "Locked"]);
  assert.deepEqual(monthly[1].parts, { Stocks: 2 });
});

test("parseHoldings and parseGoals", () => {
  const h = parseHoldings([
    ["Position", "Symbol", "Name", "Units", "Price source", "Last price", "Currency", "Price date", "Cost basis (EUR)", "Avg cost (EUR)", "Market value (EUR)", "Gain (EUR)", "Gain %"],
    ["IBKR", "VWCE.DE", "Vanguard", 179, "yahoo", 169.22, "EUR", "2026-11-04", 19858, 110.94, 30290, 10432, 0.525],
    ["IBKR", "", "", "", ""],
  ]);
  assert.equal(h.length, 1);
  assert.equal(h[0].row, 2);
  assert.equal(h[0].value, 30290);
  const g = parseGoals([
    ["Goal", "Measure", "Target (EUR)", "Target date", "Current (EUR)", "Progress %", "Remaining (EUR)", "Months left", "Needed per month (EUR)"],
    ["Reach 300k", "Total", 300000, 47118, 232906, 0.776, 67094, 25, 2684],
  ]);
  assert.equal(g[0].targetDate, "2028-12-31");
  assert.equal(g[0].perMonth, 2684);
});

test("transactionRow builds trade and cash rows and validates", () => {
  const buy = transactionRow({ date: "2026-11-04", account: "IBKR", type: "BUY", symbol: " VWCE.DE ", units: "2", price: "169.5", fees: "1.25", note: "" });
  assert.deepEqual(buy.row, ["2026-11-04", "IBKR", "BUY", "VWCE.DE", 2, 169.5, 1.25, "", ""]);
  assert.equal(transactionValue(buy.row), 340.25);

  const dep = transactionRow({ date: "2026-11-04", account: "IBKR", type: "DEPOSIT", cash: "500", units: "9", price: "9" });
  assert.deepEqual(dep.row, ["2026-11-04", "IBKR", "DEPOSIT", "", "", "", "", 500, ""]);

  const bad = transactionRow({ date: "", account: "IBKR", type: "BUY", units: "0" });
  assert.equal(bad.row, undefined);
  assert.ok(bad.errors.length >= 3);
});

test("nextFreeRow finds the row after the last filled one", () => {
  assert.equal(nextFreeRow([["h"]]), 2);
  assert.equal(nextFreeRow([["h"], ["", "IBKR"], [], ["x"]]), 5);
  assert.equal(nextFreeRow([]), 2);
});

test("planSnapshot overwrites same-date rows and appends the rest", () => {
  const history = parseHistory([
    ["Date", "Account", "Value (EUR)", "Note"],
    [46300, "Cash", 3500, "old"],
    ["2026-11-04", "Cash", 3400, "typed"],
  ]);
  const plan = planSnapshot("2026-11-04", [
    { account: "Cash", value: 3600 },
    { account: "IBKR", value: 37000 },
  ], history, 4);
  assert.deepEqual(plan.updates, [
    { row: 3, values: ["2026-11-04", "Cash", 3600, "typed"], replaced: true },
    { row: 4, values: ["2026-11-04", "IBKR", 37000, ""], replaced: false },
  ]);
  assert.equal(plan.lastRow, 4);
});

test("priceUpdates writes price and date for yahoo rows only", () => {
  const grid = [
    ["Position", "Symbol", "Name", "Units", "Price source", "Last price", "Currency", "Price date"],
    ["IBKR", "VWCE.DE", "", 1, "yahoo", 100, "EUR", ""],
    ["IBKR", "CASH", "", 0, "fixed", 1, "EUR", ""],
  ];
  const out = priceUpdates(grid, { "VWCE.DE": { priceEur: 169.123456, date: "2026-11-04" }, CASH: { priceEur: 2, date: "x" } });
  assert.deepEqual(out, [
    { range: "Holdings!F2", values: [[169.1235]] },
    { range: "Holdings!H2", values: [["2026-11-04"]] },
  ]);
});
