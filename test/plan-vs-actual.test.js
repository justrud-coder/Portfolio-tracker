import { test } from "node:test";
import assert from "node:assert/strict";
import { countedSnapshot, investTrackingStart, netInvested, planGrowth, planVsActual } from "../app/js/model.js";

const PLAN = { returnPre: 0.05, inflation: 0.03, monthly: 3000, counted: "Total" };
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test("planGrowth: one year at 5% real + 3% inflation grows the value by 8.15%", () => {
  const g = planGrowth({ ...PLAN, monthly: 0 }, 100000, 12);
  near(g.total, 8150);
  assert.equal(g.invested, 0);
  const m = planGrowth(PLAN, 100000, 1);
  near(m.total, 100000 * (1.0815 ** (1 / 12) - 1) + 3000);
  assert.equal(m.invested, 3000);
  // Two months: €3,000 a month plus the start value's growth, nothing more.
  const two = planGrowth(PLAN, 100000, 2);
  near(two.total, 100000 * (1.0815 ** (2 / 12) - 1) + 6000);
  near(two.returns, 100000 * (1.0815 ** (2 / 12) - 1));
});

test("countedSnapshot follows the plan's Portfolio counted setting", () => {
  const m = { total: 100, parts: { "Liquid (all)": 60, Options: 25 } };
  assert.equal(countedSnapshot(m, "Total"), 100);
  assert.equal(countedSnapshot(m, "Liquid"), 60);
  assert.equal(countedSnapshot(m, "Liquid + options"), 85);
});

const TX = [
  ["", "IBKR", "BUY", "VWCE.DE", 10, 100, "", "", "Starting position"],
  ["2026-06-30", "III pillar", "BUY", "ARTEA", 1000, 0.7, "", "", "Starting position at the unit price"],
  ["2026-11-04", "Cash", "DEPOSIT", "", "", "", "", 650, ""],
  ["2026-11-10", "IBKR", "WITHDRAWAL", "CASH", "", "", "", 100, ""],
  ["2026-11-12", "III pillar", "BUY", "ARTEA", 500, 0.7, "", "", ""],
  ["2026-11-13", "IBKR", "BUY", "VWCE.DE", 2, 120, "", "", ""],
];

test("netInvested counts deposits, withdrawals and III pillar contributions, not starting rows or stock buys", () => {
  assert.equal(netInvested(TX, "2026-01-01", "2026-12-31"), 650 - 100 + 350);
  assert.equal(netInvested(TX, "2026-11-04", "2026-11-30"), -100 + 350);
  assert.equal(investTrackingStart(TX), "2026-11-04");
  assert.equal(investTrackingStart([]), null);
});

test("planVsActual compares each month's and year's growth with the plan", () => {
  const monthly = [
    ["2025-11-05", 100000],
    ["2025-12-05", 105000],
    ["2026-10-05", 150000],
    ["2026-10-20", 151000],
    ["2026-11-04", 154000],
  ].map(([date, total]) => ({ date, total, parts: {} }));
  const r = planVsActual(PLAN, monthly, TX, { live: 155000, today: "2026-11-15" });
  assert.equal(r.value, 155000);
  assert.equal(r.asOf, "2026-11-15");
  near(r.rate, 0.0815);
  near(r.perMonth.total, planGrowth(PLAN, 155000, 1).total);

  // Months: last snapshot of each month, newest first.
  assert.deepEqual(r.months.map((m) => m.period), ["2026-11", "2026-10", "2025-12"]);
  const nov = r.months[0];
  assert.equal(nov.from, "2026-10-20");
  assert.equal(nov.to, "2026-11-15");
  assert.equal(nov.actual, 4000);
  near(nov.plan, planGrowth(PLAN, 151000, 26 / (365.25 / 12)).total);
  near(nov.diff, nov.actual - nov.plan);
  assert.equal(nov.invested, 650 - 100 + 350);
  assert.equal(nov.partial, true);
  assert.equal(r.months[1].invested, null);

  assert.deepEqual(r.years.map((y) => [y.period, y.from, y.to, y.actual]), [["2026", "2025-12-05", "2026-11-15", 50000]]);

  assert.equal(r.last12.from, "2025-11-05");
  assert.equal(r.last12.actual, 55000);
});

test("planVsActual without snapshots", () => {
  const r = planVsActual(PLAN, [], [], { live: 1000, today: "2026-11-15" });
  assert.deepEqual(r.months, []);
  assert.equal(r.last12, null);
  assert.equal(r.tracking, null);
});
