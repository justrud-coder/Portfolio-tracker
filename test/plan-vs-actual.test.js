import { test } from "node:test";
import assert from "node:assert/strict";
import { countedHistory, planGrowth, planVsActual } from "../app/js/model.js";

const PLAN = { returnPre: 0.05, inflation: 0.03, monthly: 3000, counted: "Total" };
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test("planGrowth: start value growth at the plan rate plus the monthly investment per month", () => {
  const g = planGrowth({ ...PLAN, monthly: 0 }, 100000, 12);
  near(g.total, 8150);
  const two = planGrowth(PLAN, 100000, 2);
  near(two.returns, 100000 * (1.0815 ** (2 / 12) - 1));
  near(two.total, two.returns + 6000);
  assert.equal(two.invested, 6000);
});

const ACCOUNTS = [
  { name: "IBKR", assetClass: "Stocks", liquidity: "Super liquid" },
  { name: "Vinted options", assetClass: "Options", liquidity: "Locked" },
  { name: "Flat", assetClass: "Real estate", liquidity: "Locked" },
];
const H = (date, account, value) => ({ date, account, value });

test("countedHistory keeps accounts left out of a partial date at their last full value", () => {
  const history = [
    H("2026-11-04", "IBKR", 100), H("2026-11-04", "Vinted options", 50), H("2026-11-04", "Flat", 200),
    H("2026-11-05", "Flat", 210), // a value edited in the app, not a full snapshot
  ];
  assert.deepEqual(countedHistory(history, ACCOUNTS, "Total"), [
    { date: "2026-11-04", total: 350 },
    { date: "2026-11-05", total: 360 },
  ]);
  assert.deepEqual(countedHistory(history.slice(0, 3), ACCOUNTS, "Liquid").map((p) => p.total), [100]);
  assert.deepEqual(countedHistory(history.slice(0, 3), ACCOUNTS, "Liquid + options").map((p) => p.total), [150]);
});

test("planVsActual: months, year to date and the last 12 months against the plan", () => {
  const series = [
    ["2024-12-31", 90000],
    ["2025-11-05", 100000],
    ["2025-12-05", 105000],
    ["2026-01-08", 106000],
    ["2026-10-05", 150000],
    ["2026-10-20", 151000],
    ["2026-11-04", 154000],
  ].map(([date, total]) => ({ date, total }));
  const r = planVsActual(PLAN, series, { live: 155000, today: "2026-11-15" });
  assert.equal(r.value, 155000);
  near(r.rate, 0.0815);

  assert.deepEqual(r.months.slice(0, 2).map((m) => [m.period, m.from, m.to]), [
    ["2026-11", "2026-10-20", "2026-11-15"],
    ["2026-10", "2026-01-08", "2026-10-20"],
  ]);
  const nov = r.months[0];
  assert.equal(nov.actual, 4000);
  near(nov.plan, planGrowth(PLAN, 151000, 26 / (365.25 / 12)).total);
  near(nov.diff, nov.actual - nov.plan);

  // Year to date starts at the point closest to 31 December (8 Jan beats 5 Dec).
  assert.deepEqual(r.years.map((y) => [y.period, y.from, y.to, y.actual]), [
    ["2026", "2026-01-08", "2026-11-15", 49000],
    ["2025", "2024-12-31", "2026-01-08", 16000],
  ]);
  assert.equal(r.last12.from, "2025-11-05");
  assert.equal(r.last12.actual, 55000);
});

test("planVsActual without snapshots", () => {
  const r = planVsActual(PLAN, [], { live: 1000, today: "2026-11-15" });
  assert.deepEqual(r.months, []);
  assert.deepEqual(r.years, []);
  assert.equal(r.last12, null);
});
