import { test } from "node:test";
import assert from "node:assert/strict";
import { buyOnly, currentMix, fullRebalance, parseAccounts, parseHoldings, parseTargets, rebalancePlan, targetsGrid, TARGET_DEFAULTS } from "../app/js/model.js";

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("buyOnly fills the most underweight first and never sells", () => {
  const items = [
    { key: "A", value: 100, target: 0.5 },
    { key: "B", value: 0, target: 0.5 },
  ];
  // 50 is not enough to catch B up: all of it goes to B.
  assert.deepEqual(buyOnly(items, 50), { A: 0, B: 50 });
  // 300: total 400, both end at 200.
  const big = buyOnly(items, 300);
  close(big.A, 100);
  close(big.B, 200);
  // Overweight items get nothing, and the buys add up to the deposit.
  const three = buyOnly(
    [
      { key: "S", value: 45, target: 0.7 },
      { key: "C", value: 67, target: 0.2 },
      { key: "P", value: 13, target: 0.1 },
    ],
    10,
  );
  assert.equal(three.C, 0);
  close(three.S + three.P, 10);
  assert.ok(three.S > three.P);
});

test("buyOnly ignores items with no target and a zero deposit", () => {
  assert.deepEqual(buyOnly([{ key: "A", value: 1, target: 0 }, { key: "B", value: 5, target: 1 }], 10), { A: 0, B: 10 });
  assert.deepEqual(buyOnly([{ key: "A", value: 1, target: 1 }], 0), { A: 0 });
});

test("fullRebalance lands exactly on target", () => {
  const m = fullRebalance([{ key: "A", value: 80, target: 0.5 }, { key: "B", value: 20, target: 0.5 }], 0);
  assert.deepEqual(m, { A: -30, B: 30 });
});

test("parseTargets reads percents and falls back to defaults", () => {
  assert.deepEqual(parseTargets([]), { ...TARGET_DEFAULTS, found: false });
  const t = parseTargets([
    ["Level", "Name", "Target %"],
    ["Class", "Stocks", 0.6],
    ["Class", "Cash", "30%"],
    ["Class", "Real estate", ""],
    ["Class", "Options", 0.2],
    ["Class", "Pension", 10],
    ["Class", "Real estate", 0.1],
    ["Stocks", "vwce.de", 1],
  ]);
  assert.deepEqual(t, { classes: { Stocks: 0.6, Cash: 0.3, "Real estate": 0.1 }, stocks: { "VWCE.DE": 1 }, found: true });
});

test("targetsGrid round-trips through parseTargets", () => {
  const grid = targetsGrid(TARGET_DEFAULTS, ["VWCE.DE", "NEW.DE"]);
  assert.equal(grid.length, 30);
  assert.deepEqual(grid[1], ["Class", "Real estate", "50%"]);
  assert.ok(grid.some((r) => r[1] === "NEW.DE" && r[2] === ""));
  const back = parseTargets(grid.map((r) => r.map((v) => (typeof v === "string" && v.endsWith("%") ? v : v))));
  assert.deepEqual(back.classes, TARGET_DEFAULTS.classes);
  assert.deepEqual(back.stocks, TARGET_DEFAULTS.stocks);
});

const accounts = parseAccounts([
  ["Account", "Asset class", "Liquidity", "Valuation", "Active", "Notes", "Current value (EUR)"],
  ["IBKR", "Stocks", "Super liquid", "holdings", true, "", 45261],
  ["III pillar", "Pension", "Liquid", "holdings", true, "", 13198],
  ["Vinted options", "Options", "Locked", "holdings", true, "", 60466],
  ["NT Titnago", "Real estate", "Locked", "manual", true, "", 47347],
  ["Deposit", "Cash", "Super liquid", "manual", true, "", 61422],
  ["Old", "Cash", "Super liquid", "manual", false, "", 999],
]);
const holdings = parseHoldings([
  ["Position", "Symbol", "Name", "Units", "Price source", "Last price", "Currency", "Price date", "Cost basis (EUR)", "Avg cost (EUR)", "Market value (EUR)"],
  ["IBKR", "VWCE.DE", "All-World", 179, "yahoo", 169.86, "EUR", "", "", "", 30405],
  ["IBKR", "VHYL.AS", "High Div", 80, "yahoo", 83.6, "EUR", "", "", "", 6689],
  ["IBKR", "ISPA.DE", "Select Div", 200, "yahoo", 40.8, "EUR", "", "", "", 8167],
  ["IBKR", "CASH", "Cash", 500, "fixed", 1, "EUR", "", "", "", 500],
  ["III pillar", "ARTEA-AA16", "Artea", 18763, "manual", 0.7034, "EUR", "", "", "", 13198],
  ["Vinted options", "VINTED", "Vinted share options", 855, "manual", 70.72, "EUR", "", "", "", 60466],
]);

test("currentMix counts IBKR cash as cash, options and III pillar as stocks", () => {
  const mix = currentMix(accounts, holdings);
  assert.deepEqual(mix.classes, { Stocks: 45261 + 13198 + 60466, Cash: 61922, "Real estate": 47347 });
  assert.deepEqual(mix.stocks.map((s) => s.key), ["VWCE.DE", "VHYL.AS", "ISPA.DE", "ARTEA-AA16", "VINTED"]);
  assert.equal(mix.stocks.find((s) => s.key === "VINTED").fixed, true);
  const artea = mix.stocks.find((s) => s.key === "ARTEA-AA16");
  assert.equal(artea.fixed, false);
  assert.equal(artea.label, "III pillar pension");
});

test("buyOnly never buys a fixed item, fullRebalance only sells one", () => {
  const items = [
    { key: "A", value: 0, target: 0.5 },
    { key: "O", value: 0, target: 0.5, fixed: true },
  ];
  assert.deepEqual(buyOnly(items, 100), { A: 100, O: 0 });
  assert.deepEqual(fullRebalance(items, 100), { A: 100, O: 0 });
  assert.deepEqual(fullRebalance([{ key: "A", value: 0, target: 0.5 }, { key: "O", value: 100, target: 0.5, fixed: true }], 0), { A: 50, O: -50 });
});

test("rebalancePlan includes real estate and splits stocks without buying options", () => {
  // With the default 50% real estate target, a deposit goes to real estate.
  const def = rebalancePlan(currentMix(accounts, holdings), TARGET_DEFAULTS, 1000);
  close(def.classes.find((c) => c.key === "Real estate").move, 1000);
  // A stocks-heavy mix sends it to stocks, split without buying options.
  const targets = { classes: { Stocks: 0.7, "Real estate": 0.2, Cash: 0.1 }, stocks: TARGET_DEFAULTS.stocks };
  const plan = rebalancePlan(currentMix(accounts, holdings), targets, 30000);
  assert.deepEqual(plan.outside, []);
  const by = Object.fromEntries(plan.classes.map((c) => [c.key, c]));
  assert.equal(by.Cash.move, 0);
  close(Object.values(by).reduce((s, c) => s + c.move, 0), 30000);
  assert.ok(by.Stocks.move > 0);
  assert.equal(plan.stocks.find((s) => s.key === "VINTED").move, 0);
  close(plan.stockMoney, by.Stocks.move);
  close(plan.stocks.reduce((s, x) => s + x.move, 0), plan.stockMoney);
  const vwce = plan.stocks.find((s) => s.key === "VWCE.DE");
  assert.ok(vwce.move > 0);
  assert.equal(vwce.units, Math.floor(vwce.move / 169.86));
  close(plan.reachAll, Math.max(...plan.classes.map((c) => c.value / c.target)) - plan.base, 1);
});

test("rebalancePlan with selling lands every class on target", () => {
  const plan = rebalancePlan(currentMix(accounts, holdings), TARGET_DEFAULTS, 0, { sell: true });
  for (const c of plan.classes) close(c.afterShare, TARGET_DEFAULTS.classes[c.key], 1e-9);
  assert.ok(plan.classes.find((c) => c.key === "Cash").move < 0);
});
