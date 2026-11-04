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

test("transactionRow builds IBKR trades, cash moves and III pillar units", () => {
  const buy = transactionRow({ date: "2026-11-04", account: "Cash", type: "BUY", symbol: " vwce.de ", units: "2", price: "169.5", fees: "1.25", note: "" });
  assert.deepEqual(buy.row, ["2026-11-04", "IBKR", "BUY", "VWCE.DE", 2, 169.5, "", "", ""]);
  assert.equal(transactionValue(buy.row), 339);

  const dep = transactionRow({ date: "2026-11-04", account: "Cash", type: "DEPOSIT", cash: "500", units: "9", price: "9" });
  assert.deepEqual(dep.row, ["2026-11-04", "Cash", "DEPOSIT", "", "", "", "", 500, ""]);
  const ibkr = transactionRow({ date: "2026-11-04", account: "IBKR", type: "WITHDRAWAL", cash: "250" });
  assert.deepEqual(ibkr.row, ["2026-11-04", "IBKR", "WITHDRAWAL", "CASH", "", "", "", 250, ""]);

  const pen = transactionRow({ date: "2026-11-04", type: "PENSION", fund: "ARTEA-AA16", units: "142.17", cash: "100" });
  assert.deepEqual(pen.row, ["2026-11-04", "III pillar", "BUY", "ARTEA-AA16", 142.17, 0.703383, "", "", ""]);

  const opt = transactionRow({ date: "2026-12-01", type: "OPTIONS", symbol: "VINTED", units: "40" });
  assert.deepEqual(opt.row, ["2026-12-01", "Vinted options", "BUY", "VINTED", 40, "", "", "", ""]);
  assert.equal(transactionRow({ date: "2026-12-01", type: "OPTIONS", symbol: "VINTED", units: "" }).row, undefined);

  assert.ok(transactionRow({ date: "2026-11-04", type: "BUY", symbol: "cash", units: "1", price: "1" }).errors.some((e) => /Deposit/.test(e)));
  assert.equal(transactionRow({ date: "2026-11-04", type: "DIVIDEND", cash: "5" }).row, undefined);
  const bad = transactionRow({ date: "", type: "BUY", units: "0" });
  assert.equal(bad.row, undefined);
  assert.ok(bad.errors.length >= 3);
});

test("new III pillar funds get a unique symbol and the sheet's Holdings formulas", async () => {
  const { fundSymbol, holdingsRow, nextHoldingsRow } = await import("../app/js/model.js");
  assert.equal(fundSymbol("Luminor pensija 1 – tvari ateitis", []), "LUMINOR-PENSIJA-1-TVARI");
  assert.equal(fundSymbol("Artea", ["ARTEA", "artea-2"]), "ARTEA-3");
  assert.equal(fundSymbol("  ", []), "FUND");
  assert.equal(nextHoldingsRow([["Position", "Symbol"], ["IBKR", "VWCE.DE"], ["", ""], ["X", "Y"]]), 3);
  assert.equal(nextHoldingsRow([["Position", "Symbol"], ["IBKR", "VWCE.DE"]]), 3);
  const row = holdingsRow(6, { position: "III pillar", symbol: "ARTEA-AA16", name: "Artea", price: 0.7034, priceDate: "2026-06-30" });
  // Formulas as they are on the sheet's Holdings row 6.
  assert.equal(row[3], '=IF($B6="","",SUMIFS(Transactions!$E:$E,Transactions!$B:$B,$A6,Transactions!$D:$D,$B6,Transactions!$C:$C,"BUY")-SUMIFS(Transactions!$E:$E,Transactions!$B:$B,$A6,Transactions!$D:$D,$B6,Transactions!$C:$C,"SELL"))');
  assert.equal(row[9], '=IF($B6="","",LET(u,SUMIFS(Transactions!$E:$E,Transactions!$B:$B,$A6,Transactions!$D:$D,$B6,Transactions!$C:$C,"BUY"),c,SUMIFS(Transactions!$J:$J,Transactions!$B:$B,$A6,Transactions!$D:$D,$B6,Transactions!$C:$C,"BUY"),IF(OR(u=0,c=0),"",c/u)))');
  assert.deepEqual(row.slice(4, 8), ["manual", 0.7034, "EUR", "2026-06-30"]);
  assert.equal(row.length, 13);
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

import { countedValue, parseRetirement, retirementPlan } from "../app/js/model.js";

const RETIREMENT = [
  ["Setting", "Value", "Notes"],
  ["Current age", 43],
  ["Retirement age", 50],
  ["Plan until age", 85],
  ["Monthly spend in retirement (EUR)", 3000],
  ["Public pension per month (EUR)", 600],
  ["Public pension from age", 65],
  ["Real return before retirement", 0.04],
  ["Real return in retirement", 0.03],
  ["Inflation", 0.025],
  ["Portfolio counted", "Liquid"],
  ["Monthly investment now (EUR)", 1250],
  [],
  ["Result", "Value"],
];

test("parseRetirement finds inputs by label and keeps their rows", () => {
  const r = parseRetirement(RETIREMENT);
  assert.equal(r.values.retireAge, 50);
  assert.equal(r.values.returnPost, 0.03);
  assert.equal(r.values.counted, "Liquid");
  assert.equal(r.rows.monthly, 12);
  assert.equal(parseRetirement([]).found, false);
  assert.equal(parseRetirement([["Setting"], ["Real return after retirement", 0.02]]).values.returnPost, 0.02);
  const renamed = parseRetirement([["Setting"], ["Real return before pension", 0.05], ["Real return after pension", 0.01]]).values;
  assert.equal(renamed.returnPre, 0.05);
  assert.equal(renamed.returnPost, 0.01);
});

test("retirementPlan matches the Retirement tab formulas", () => {
  const { values } = parseRetirement(RETIREMENT);
  // Inputs and results copied from the sheet on 2026-11-04.
  const v = { ...values, pension: 700, returnPre: 0.05, returnPost: 0.02, inflation: 0.03, monthly: 3000 };
  const p = retirementPlan(v, 244199);
  assert.equal(Math.round(p.needed), 806513);
  assert.equal(Math.round(p.neededFuture), 991910);
  assert.equal(Math.round(p.perMonth), 5105);
  assert.equal(Math.round(p.projected), 615659);
  assert.equal(Math.round(p.supportedSpend), 2371);
  assert.equal(Math.round(p.todaySpend), 975);
  assert.equal(p.status, "Behind");
  // The same target and projection in 2033 euros.
  assert.equal(Math.round(p.projectedFuture), 757183);
  assert.ok(Math.abs(p.noNewMoneyFuture - 343613 * 1.03 ** 7) < 2);
  assert.equal(Math.round(plan53(v).neededFuture), Math.round(744514 * 1.03 ** 10));
});

const plan53 = (v) => retirementPlan(v, 244199).byAge.find((r) => r.age === 53);

test("retirementPlan status bands", () => {
  const { values } = parseRetirement(RETIREMENT);
  assert.equal(retirementPlan({ ...values, monthly: 5836 }, 116283).status, "On track");
  assert.equal(retirementPlan({ ...values, monthly: 7000 }, 116283).status, "Ahead");
  assert.equal(retirementPlan(values, 900000).status, "Ahead");
});

test("countedValue picks liquid, options or total", () => {
  const accounts = parseAccounts(ACCOUNTS);
  assert.equal(countedValue(accounts, "Liquid"), 36944 + 13039);
  assert.equal(countedValue(accounts, "Liquid + options"), 36944 + 13039 + 58303);
  assert.equal(countedValue(accounts, "Total"), 36944 + 13039 + 58303);
});

test("credentials accepts the private key however it was pasted", async () => {
  const { generateKeyPairSync, createPrivateKey } = await import("node:crypto");
  const { credentials } = await import("../scripts/update-prices.mjs");
  const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
  const escaped = pem.replace(/\n/g, "\\n");
  const email = "bot@p.iam.gserviceaccount.com";
  const forms = [
    pem,
    escaped,
    `"${escaped}"`,
    `"private_key": "${escaped}",`,
    JSON.stringify({ type: "service_account", private_key: pem, client_email: email }),
    pem.replace(/\n/g, " "),
  ];
  for (const f of forms) {
    const c = credentials(`"${email}"`, f);
    assert.equal(c.email, email);
    assert.doesNotThrow(() => createPrivateKey(c.key));
  }
  assert.throws(() => credentials(email, "nope"), /BEGIN PRIVATE KEY/);
});

test("retirementByAge matches the Retirement tab table", () => {
  const { values } = parseRetirement(RETIREMENT);
  const v = { ...values, pension: 700, returnPre: 0.05, returnPost: 0.02, inflation: 0.03, monthly: 3000 };
  const plan = retirementPlan(v, 244199);
  const at = (age) => plan.byAge.find((r) => r.age === age);
  // Values the sheet computed for the same inputs.
  assert.equal(Math.round(at(43).needed), 937627);
  assert.equal(Math.round(at(50).portfolio), 615659);
  assert.equal(Math.round(at(52).spend), 2906);
  assert.equal(Math.round(at(53).portfolio), 802999);
  assert.equal(plan.earliestAge, 53);
  assert.equal(plan.byAge.at(-1).age, 84);
});

test("sameTransaction compares columns A to I only", async () => {
  const { sameTransaction } = await import("../app/js/model.js");
  const row = [46330, "IBKR", "BUY", "CASH", 1, 840, "", "", "", 840];
  assert.equal(sameTransaction([46330, "IBKR", "BUY", "CASH", "1", "840"], row.slice(0, 9)), true);
  assert.equal(sameTransaction(row, [...row.slice(0, 9), 999]), true);
  assert.equal(sameTransaction(row, [46330, "IBKR", "SELL", "CASH", 1, 840]), false);
  assert.equal(sameTransaction(undefined, row), false);
});

test("daily snapshot saves active accounts on the Vilnius date", async () => {
  const { snapshotValues, todayVilnius, snapshotDay } = await import("../scripts/snapshot.mjs");
  // 22:45 in Vilnius (winter) and 23:45 (summer) count for that day...
  assert.equal(snapshotDay(new Date("2026-11-04T20:45:00Z")), "2026-11-04");
  assert.equal(snapshotDay(new Date("2026-07-04T20:45:00Z")), "2026-07-04");
  // ...and a run delayed past midnight still counts for the evening before.
  assert.equal(snapshotDay(new Date("2026-07-04T21:30:00Z")), "2026-07-04");
  assert.equal(snapshotDay(new Date("2026-07-05T08:00:00Z")), "2026-07-05");
  assert.equal(todayVilnius(new Date("2026-11-30T22:30:00Z")), "2026-12-01");
  assert.equal(todayVilnius(new Date("2026-12-01T06:00:00Z")), "2026-12-01");
  const accounts = [
    { name: "IBKR", active: true, value: 44943.456 },
    { name: "Crypto", active: false, value: 0 },
    { name: "Cash", active: true, value: 3500 },
  ];
  assert.deepEqual(snapshotValues(accounts), [
    { account: "IBKR", value: 44943.46 },
    { account: "Cash", value: 3500 },
  ]);
});

test("overview changes, account groups, new-total deposits and repeats", async () => {
  const m = await import("../app/js/model.js");
  assert.equal(m.addMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(m.addMonths("2026-11-04", -1), "2026-10-04");
  const monthly = [
    { date: "2025-12-05", total: 195078 },
    { date: "2026-01-08", total: 201190 },
    { date: "2026-09-05", total: 237713 },
    { date: "2026-10-05", total: 242162 },
  ];
  const c = m.periodChanges(monthly, 250000, "2026-11-04");
  assert.equal(m.endOfPreviousMonth("2026-11-04"), "2026-10-31");
  assert.equal(m.endOfPreviousMonth("2026-03-15"), "2026-02-28");
  assert.equal(m.endOfPreviousMonth("2026-01-01"), "2025-12-31");
  // Last snapshot on or before 31 Oct: 5 Oct.
  assert.equal(c.month.from, "2026-10-05");
  assert.equal(c.month.value, 250000 - 242162);
  // With daily snapshots, the 31 Oct one wins over later ones.
  const daily = [...monthly, { date: "2026-10-31", total: 245000 }, { date: "2026-11-03", total: 248000 }];
  assert.equal(m.periodChanges(daily, 250000, "2026-11-04").month.from, "2026-10-31");
  // Closest snapshot to 31 Dec: 8 Jan (8 days) beats 5 Dec (26 days).
  assert.equal(c.ytd.from, "2026-01-08");
  assert.equal(c.ytd.value, 250000 - 201190);
  assert.equal(m.periodChanges(monthly.slice(0, 1), 250000, "2026-11-04").ytd.from, "2025-12-05");
  assert.equal(m.periodChanges([], 1, "2026-11-04").month.value, null);

  const og = m.overviewGroups(
    [
      { name: "IBKR", assetClass: "Stocks", valuation: "holdings", active: true, value: 150 },
      { name: "Cash", assetClass: "Cash", valuation: "manual", active: true, value: 10, lastSnapshot: "2026-10-05", gain: null },
      { name: "Deposit", assetClass: "Cash", valuation: "manual", active: true, value: 20, lastSnapshot: "2026-10-05", gain: null },
      { name: "III pillar", assetClass: "Pension", valuation: "holdings", active: true, value: 7 },
    ],
    [
      { position: "IBKR", symbol: "VWCE.DE", name: "Vanguard", units: 1, value: 100, gain: 5, gainPct: 0.05 },
      { position: "IBKR", symbol: "CASH", name: "Cash held at IBKR", units: 50, value: 50, gain: null },
      { position: "IBKR", symbol: "OLD", name: "Sold", units: 0, value: 0 },
      { position: "III pillar", symbol: "ARTEA-AA16", name: "Artea Ambicingas Active 16+", units: 10, value: 7, gain: null },
    ],
    [{ cells: [46330 /* 2026-11-04 */, "Deposit", "DEPOSIT", "", "", "", "", 5] }],
    [
      { date: "2025-10-05", account: "Deposit", value: 16 },
      { date: "2025-11-05", account: "Deposit", value: 1 },
      { date: "2025-11-04", account: "III pillar", value: 5 },
    ],
    "2026-11-04",
  );
  assert.deepEqual(og.map((g) => [g.name, g.total, g.items.map((i) => i.name)]), [
    ["Stocks", 100, ["Vanguard"]],
    ["Cash", 80, ["IBKR cash", "Deposit", "Cash"]],
    ["III pillar pension", 7, ["Artea Ambicingas Active 16+"]],
  ]);
  assert.equal(og[1].items.find((i) => i.name === "Deposit").updated, "2026-11-04");
  assert.equal(og[1].items.find((i) => i.name === "Cash").updated, "2026-10-05");
  // A year back from 4 Nov 2026: the last snapshot on or before 4 Nov 2025.
  assert.deepEqual(og[1].items.find((i) => i.name === "Deposit").change, { value: 4, pct: 0.25, from: "2025-10-05", basis: "year" });
  assert.equal(og[1].items.find((i) => i.name === "Cash").change, null);
  assert.equal(og[1].items.find((i) => i.name === "IBKR cash").change, null);
  // A holdings account's only holding uses the account's history...
  assert.deepEqual(og[2].items[0].change, { value: 2, pct: 0.4, from: "2025-11-04", basis: "year" });
  // ...and IBKR stocks, with no history of their own, show the gain against cost.
  assert.deepEqual(og[0].items[0].change, { value: 5, pct: 0.05, basis: "cost" });

  assert.deepEqual(m.moveToTotal(3500, 4200), { type: "DEPOSIT", amount: 700 });
  assert.deepEqual(m.moveToTotal(3500, 3000.5), { type: "WITHDRAWAL", amount: 499.5 });
  assert.equal(m.moveToTotal(3500, 3500), null);

  assert.deepEqual(m.repeatForm(["2026-11-01", "IBKR", "BUY", "VWCE.DE", 2, 170, "", "", "x"], "2026-12-01"), { date: "2026-12-01", note: "x", type: "BUY", symbol: "VWCE.DE", units: 2, price: 170 });
  assert.deepEqual(m.repeatForm(["", "Cash", "DEPOSIT", "", "", "", "", 500, ""], "2026-12-01"), { date: "2026-12-01", note: "", type: "DEPOSIT", account: "Cash", cash: 500 });
  assert.deepEqual(m.repeatForm(["", "III pillar", "BUY", "ARTEA-AA16", 142.17, 0.7034, "", "", ""], "2026-12-01"), { date: "2026-12-01", note: "", type: "PENSION", fund: "ARTEA-AA16", pensionUnits: 142.17, pensionCash: 100 });
  assert.deepEqual(m.repeatForm(["", "Vinted options", "BUY", "VINTED", 40, "", "", "", ""], "2026-12-01"), { date: "2026-12-01", note: "", type: "OPTIONS", optionUnits: 40 });
});
