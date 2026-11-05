import { test } from "node:test";
import assert from "node:assert/strict";
import { detailGroup, monthlyDetails } from "../app/js/model.js";

const accounts = [
  { name: "IBKR", assetClass: "Stocks", active: true, value: 1100 },
  { name: "Cash", assetClass: "Cash", active: true, value: 300 },
  { name: "Artea", assetClass: "Pension", active: true, value: 520 },
  { name: "II pillar", assetClass: "Pension", active: false, value: 0 },
];
const h = (date, account, value) => ({ date, account, value });

test("detailGroup puts III pillar funds together and II pillar on its own", () => {
  assert.equal(detailGroup("Artea", "Pension"), "III pillar");
  assert.equal(detailGroup("II pillar", "Pension"), "II pillar");
  assert.equal(detailGroup("IBKR", "Stocks"), "Stocks");
});

test("monthlyDetails gives each month's change by category and account, newest first", () => {
  const history = [
    h("2026-08-05", "IBKR", 900), h("2026-08-05", "Cash", 200), h("2026-08-05", "Artea", 500), h("2026-08-05", "II pillar", 3000),
    h("2026-09-05", "IBKR", 1000), h("2026-09-05", "Cash", 250), h("2026-09-05", "Artea", 510), h("2026-09-05", "II pillar", null),
    h("2026-09-20", "IBKR", 1050), h("2026-09-20", "Cash", 260), h("2026-09-20", "Artea", 515),
  ];
  const months = monthlyDetails(history, accounts, "2026-10-10");
  assert.deepEqual(months.map((m) => [m.period, m.from, m.to, m.live]), [
    ["2026-10", "2026-09-20", "2026-10-10", true],
    ["2026-09", "2026-08-05", "2026-09-20", false],
  ]);
  const [oct, sep] = months;
  assert.equal(oct.change, 1100 + 300 + 520 - (1050 + 260 + 515));
  assert.deepEqual(oct.groups.map((g) => g.name), ["Stocks", "Cash", "III pillar"]);
  // II pillar is withdrawn in September and gone after.
  assert.deepEqual(sep.groups.map((g) => [g.name, g.change]), [["Stocks", 150], ["Cash", 60], ["III pillar", 15], ["II pillar", -3000]]);
  assert.equal(sep.groups[0].accounts[0].pct, 150 / 900);
});

test("monthlyDetails folds a month without snapshots into the next and uses live values for today", () => {
  const history = [h("2026-06-05", "IBKR", 800), h("2026-08-05", "IBKR", 1000), h("2026-08-05", "Cash", 300)];
  const [aug, ...rest] = monthlyDetails(history, accounts, "2026-08-05");
  assert.equal(rest.length, 0);
  assert.equal(aug.from, "2026-06-05");
  assert.equal(aug.live, true); // today's snapshot gives way to the live Accounts values
  const cash = aug.groups.find((g) => g.name === "Cash");
  assert.deepEqual([cash.start, cash.end, cash.pct], [0, 300, null]);
});
