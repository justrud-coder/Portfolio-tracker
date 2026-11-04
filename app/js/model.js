// Pure functions that turn sheet values into the app's data. No DOM, no network,
// so they run in the browser and under `node --test`.

/** Google Sheets date serial (days since 1899-12-30) -> "YYYY-MM-DD". */
export function serialToIso(v) {
  if (typeof v === "string") {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
  }
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return "";
  const ms = Date.UTC(1899, 11, 30) + Math.round(v * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

/** Number or null. Accepts numbers and plain numeric strings. */
export function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.replace(/[€\s,]/g, "");
    if (s === "" || s === "-") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const norm = (s) => String(s ?? "").trim().toLowerCase();

/**
 * Map wanted keys to column indexes by header text, so the app keeps working
 * when columns move. A header matches a name if it equals it or starts with
 * "<name> (" (e.g. "Total (EUR)" matches "total").
 */
export function columns(header, spec) {
  const h = (header ?? []).map(norm);
  const out = {};
  for (const [key, names] of Object.entries(spec)) {
    const list = Array.isArray(names) ? names : [names];
    out[key] = -1;
    for (const name of list) {
      const n = norm(name);
      const i = h.findIndex((x) => x === n || x.startsWith(n + " ("));
      if (i >= 0) {
        out[key] = i;
        break;
      }
    }
  }
  return out;
}

const cell = (row, i) => (i >= 0 ? row?.[i] : undefined);
const text = (row, i) => String(cell(row, i) ?? "").trim();

export function parseAccounts(grid) {
  const c = columns(grid[0], {
    name: "Account",
    assetClass: "Asset class",
    liquidity: "Liquidity",
    valuation: "Valuation",
    active: "Active",
    notes: "Notes",
    value: "Current value",
    lastSnapshot: "Last snapshot",
    invested: "Invested",
    gain: "Gain",
    gainPct: "Gain %",
  });
  const out = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const name = text(row, c.name);
    if (!name) continue;
    const active = cell(row, c.active);
    out.push({
      name,
      assetClass: text(row, c.assetClass) || "Other",
      liquidity: text(row, c.liquidity),
      valuation: norm(cell(row, c.valuation)) === "holdings" ? "holdings" : "manual",
      active: !(active === false || norm(active) === "false"),
      notes: text(row, c.notes),
      value: num(cell(row, c.value)) ?? 0,
      lastSnapshot: serialToIso(cell(row, c.lastSnapshot)),
      invested: num(cell(row, c.invested)),
      gain: num(cell(row, c.gain)),
      gainPct: num(cell(row, c.gainPct)),
    });
  }
  return out;
}

export function parseHoldings(grid) {
  const c = columns(grid[0], {
    position: "Position",
    symbol: "Symbol",
    name: "Name",
    units: "Units",
    source: "Price source",
    price: "Last price",
    currency: "Currency",
    priceDate: "Price date",
    cost: "Cost basis",
    value: "Market value",
    gain: "Gain",
    gainPct: "Gain %",
  });
  const out = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const position = text(row, c.position);
    const symbol = text(row, c.symbol);
    if (!position || !symbol) continue;
    out.push({
      row: r + 1,
      position,
      symbol,
      name: text(row, c.name),
      units: num(cell(row, c.units)) ?? 0,
      source: norm(cell(row, c.source)) || "manual",
      price: num(cell(row, c.price)),
      currency: text(row, c.currency) || "EUR",
      priceDate: serialToIso(cell(row, c.priceDate)),
      cost: num(cell(row, c.cost)),
      value: num(cell(row, c.value)) ?? 0,
      gain: num(cell(row, c.gain)),
      gainPct: num(cell(row, c.gainPct)),
    });
  }
  return out;
}

/** Monthly tab: one row per snapshot date with the total and per-class columns. */
export function parseMonthly(grid) {
  const header = grid[0] ?? [];
  const c = columns(header, { date: "Date", total: "Total", change: "Change", changePct: "Change %" });
  const out = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const date = serialToIso(cell(row, c.date));
    const total = num(cell(row, c.total));
    if (!date || total === null) continue;
    const parts = {};
    header.forEach((h, i) => {
      if (i === c.date || i === c.total || i === c.change || i === c.changePct) return;
      const name = String(h ?? "").trim();
      if (name) parts[name] = num(row?.[i]) ?? 0;
    });
    out.push({ date, total, parts });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

export function parseGoals(grid) {
  const c = columns(grid[0], {
    goal: "Goal",
    measure: "Measure",
    target: "Target",
    targetDate: "Target date",
    current: "Current",
    progress: "Progress %",
    remaining: "Remaining",
    monthsLeft: "Months left",
    perMonth: "Needed per month",
  });
  const out = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const goal = text(row, c.goal);
    if (!goal) continue;
    const target = num(cell(row, c.target));
    const current = num(cell(row, c.current));
    out.push({
      goal,
      measure: text(row, c.measure),
      target,
      targetDate: serialToIso(cell(row, c.targetDate)),
      current,
      progress: num(cell(row, c.progress)) ?? (target ? (current ?? 0) / target : null),
      remaining: num(cell(row, c.remaining)),
      monthsLeft: num(cell(row, c.monthsLeft)),
      perMonth: num(cell(row, c.perMonth)),
    });
  }
  return out;
}

/** Lists tab: each header becomes a key holding the non-empty values below it. */
export function parseLists(grid) {
  const header = grid[0] ?? [];
  const out = {};
  header.forEach((h, i) => {
    const key = String(h ?? "").trim();
    if (!key) return;
    out[key] = grid
      .slice(1)
      .map((row) => String(row?.[i] ?? "").trim())
      .filter(Boolean);
  });
  return out;
}

/** History tab rows: date, account, value, with their 1-based sheet row. */
export function parseHistory(grid) {
  const c = columns(grid[0], { date: "Date", account: "Account", value: "Value", note: "Note" });
  const out = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const account = text(row, c.account);
    const date = serialToIso(cell(row, c.date));
    if (!account && !date) continue;
    out.push({ row: r + 1, date, account, value: num(cell(row, c.value)), note: text(row, c.note) });
  }
  return out;
}

/** 1-based row after the last row that has anything in it (header counts). */
export function nextFreeRow(grid) {
  let last = 0;
  grid.forEach((row, i) => {
    if ((row ?? []).some((v) => v !== "" && v !== null && v !== undefined)) last = i + 1;
  });
  return Math.max(last, 1) + 1;
}

const rank = (order, name) => {
  const i = order.indexOf(name);
  return i < 0 ? order.length : i;
};

/** Shift an ISO date by whole months, clamping the day (31 Mar - 1 month = 28/29 Feb). */
export function addMonths(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

const dayNumber = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000;

/**
 * Change of `total` since the snapshot closest to `target` (either side),
 * ignoring snapshots from `today` on. Ties go to the earlier snapshot.
 */
function changeNear(monthly, total, target, today) {
  let base = null;
  for (const m of monthly) {
    if (m.date >= today) continue;
    if (!base || Math.abs(dayNumber(m.date) - dayNumber(target)) < Math.abs(dayNumber(base.date) - dayNumber(target))) base = m;
  }
  if (!base) return { value: null, pct: null, from: null };
  const value = total - base.total;
  return { value, pct: base.total ? value / base.total : null, from: base.date };
}

/** Last day of the month before `iso`'s month. */
export function endOfPreviousMonth(iso) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
}

/** Change of `total` since the last snapshot on or before `date`. */
function changeSince(monthly, total, date) {
  let base = null;
  for (const m of monthly) if (m.date <= date) base = m;
  if (!base) return { value: null, pct: null, from: null };
  const value = total - base.total;
  return { value, pct: base.total ? value / base.total : null, from: base.date };
}

/**
 * Change this month (against the last snapshot on or before the last day of
 * the previous month) and year to date (against the snapshot closest to
 * 31 December of the previous year, since older history isn't daily).
 */
export function periodChanges(monthly, total, today) {
  const year = Number(today.slice(0, 4));
  return {
    month: changeSince(monthly, total, endOfPreviousMonth(today)),
    ytd: changeNear(monthly, total, `${year - 1}-12-31`, today),
  };
}

/** Overview groups for the accounts list, in display order. */
export const ACCOUNT_GROUPS = ["Stocks", "Cash", "Real estate", "Options"];

/** Active accounts grouped by asset class: the four main groups first, then any others. */
export function groupAccounts(accounts) {
  const groups = new Map(ACCOUNT_GROUPS.map((g) => [g, []]));
  for (const a of accounts.filter((x) => x.active)) {
    if (!groups.has(a.assetClass)) groups.set(a.assetClass, []);
    groups.get(a.assetClass).push(a);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length)
    .map(([name, list]) => ({ name, accounts: list.sort((a, b) => b.value - a.value), total: list.reduce((s, a) => s + a.value, 0) }));
}

/**
 * Deposit or withdrawal that takes an account from `current` to `newTotal`.
 * Returns null when nothing changes.
 */
export function moveToTotal(current, newTotal) {
  const diff = Math.round((newTotal - current) * 100) / 100;
  if (!diff) return null;
  return diff > 0 ? { type: "DEPOSIT", amount: diff } : { type: "WITHDRAWAL", amount: -diff };
}

/**
 * Form values that repeat a Transactions row, dated today. Maps the row back
 * to the form type it came from.
 */
export function repeatForm(cells, today) {
  const [, account, type, symbol, units, price, , cash, note] = cells;
  const base = { date: today, note: String(note ?? "") };
  if (account === PENSION && type === "BUY") {
    const u = num(units);
    const p = num(price);
    return { ...base, type: "PENSION", fund: symbol, pensionUnits: u ?? "", pensionCash: u && p ? Math.round(u * p * 100) / 100 : "" };
  }
  if (account === OPTIONS && type === "BUY") return { ...base, type: "OPTIONS", optionUnits: num(units) ?? "" };
  if (type === "BUY" || type === "SELL") return { ...base, type, symbol, units: num(units) ?? "", price: num(price) ?? "" };
  if (type === "DEPOSIT" || type === "WITHDRAWAL") return { ...base, type, account, cash: num(cash) ?? "" };
  return null;
}

/** Headline numbers for the dashboard. */
export function summarize(accounts, monthly) {
  const live = accounts.filter((a) => a.active);
  const total = live.reduce((s, a) => s + a.value, 0);

  const byClass = new Map();
  for (const a of live) byClass.set(a.assetClass, (byClass.get(a.assetClass) ?? 0) + a.value);
  const allocation = [...byClass.entries()]
    .map(([name, value]) => ({ name, value, share: total ? value / total : 0 }))
    .filter((x) => x.value !== 0)
    .sort((a, b) => b.value - a.value);

  const byLiquidity = new Map();
  for (const a of live) {
    const k = a.liquidity || "Other";
    byLiquidity.set(k, (byLiquidity.get(k) ?? 0) + a.value);
  }
  const order = ["Super liquid", "Liquid", "Locked"];
  const liquidity = [...byLiquidity.entries()]
    .map(([name, value]) => ({ name, value, share: total ? value / total : 0 }))
    .sort((a, b) => rank(order, a.name) - rank(order, b.name));

  const withCost = live.filter((a) => a.invested !== null && a.invested !== 0);
  const invested = withCost.reduce((s, a) => s + a.invested, 0);
  const costValue = withCost.reduce((s, a) => s + a.value, 0);
  const gain = withCost.length ? costValue - invested : null;

  const last = monthly[monthly.length - 1] ?? null;
  const prev = monthly[monthly.length - 2] ?? null;
  const sinceSnapshot = last ? total - last.total : null;
  const lastMonth = last && prev ? last.total - prev.total : null;

  return {
    total,
    allocation,
    liquidity,
    invested: withCost.length ? invested : null,
    gain,
    gainPct: gain !== null && invested ? gain / invested : null,
    gainAccounts: withCost.map((a) => a.name),
    lastSnapshot: last,
    sinceSnapshot,
    sinceSnapshotPct: last && last.total ? sinceSnapshot / last.total : null,
    lastMonth,
    lastMonthPct: lastMonth !== null && prev.total ? lastMonth / prev.total : null,
    prevSnapshot: prev,
  };
}

export const TX_TYPES = ["BUY", "SELL", "DEPOSIT", "WITHDRAWAL"];
/** Account that holds stocks and IBKR cash, and the symbol of that cash. */
export const BROKER = "IBKR";
export const BROKER_CASH = "CASH";
/** Account that holds the III pillar pension funds. */
export const PENSION = "III pillar";
/** Account that holds the Vinted share options (units x value per option). */
export const OPTIONS = "Vinted options";

/**
 * Validate a transaction form and return the A:I row for the Transactions tab:
 * Date, Account, Type, Symbol, Units, Price (EUR), Fees (EUR), Cash amount (EUR), Note.
 *
 * Types:
 * - BUY / SELL: stocks at IBKR (paid from / paid into IBKR cash on the sheet).
 * - DEPOSIT / WITHDRAWAL: a cash account, or IBKR cash (account "IBKR").
 * - PENSION: units bought in a III pillar fund, written as a BUY in "III pillar"
 *   with the unit price worked out from the amount paid.
 * - OPTIONS: Vinted options received, written as a BUY with no cost.
 */
export function transactionRow(t) {
  const errors = [];
  const type = String(t.type ?? "").toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date ?? "")) errors.push("Pick a date.");
  const units = num(t.units);
  const price = num(t.price);
  const cash = num(t.cash);
  const note = (t.note ?? "").trim();
  let row = null;
  if (type === "BUY" || type === "SELL") {
    const symbol = String(t.symbol ?? "").trim().toUpperCase();
    if (!symbol) errors.push("Enter the symbol.");
    else if (symbol === BROKER_CASH) errors.push("Use Deposit or Withdraw for IBKR cash.");
    if (!(units > 0)) errors.push("Units must be more than 0.");
    if (!(price > 0)) errors.push("Price must be more than 0.");
    row = [t.date, BROKER, type, symbol, units, price, "", "", note];
  } else if (type === "DEPOSIT" || type === "WITHDRAWAL") {
    if (!t.account) errors.push("Pick an account.");
    if (!(cash > 0)) errors.push("Amount must be more than 0.");
    row = [t.date, t.account, type, t.account === BROKER ? BROKER_CASH : "", "", "", "", cash, note];
  } else if (type === "PENSION") {
    const fund = String(t.fund ?? "").trim();
    if (!fund) errors.push("Pick a fund, or enter the new fund's name.");
    if (!(units > 0)) errors.push("Units must be more than 0.");
    if (!(cash > 0)) errors.push("Amount paid must be more than 0.");
    const unitPrice = units > 0 && cash > 0 ? Math.round((cash / units) * 1e6) / 1e6 : "";
    row = [t.date, PENSION, "BUY", fund, units, unitPrice, "", "", note];
  } else if (type === "OPTIONS") {
    const symbol = String(t.symbol ?? "").trim();
    if (!symbol) errors.push("The sheet has no Vinted options position on the Holdings tab.");
    if (!(units > 0)) errors.push("Options received must be more than 0.");
    row = [t.date, OPTIONS, "BUY", symbol, units, "", "", "", note];
  } else {
    errors.push("Pick a type.");
  }
  if (errors.length) return { errors };
  return { errors, row };
}

/** A short unique symbol for a new fund, made from its name. */
export function fundSymbol(name, taken = []) {
  const base =
    String(name ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24)
      .replace(/-+$/, "") || "FUND";
  const used = new Set(taken.map((x) => String(x).toUpperCase()));
  let sym = base;
  for (let i = 2; used.has(sym); i++) sym = `${base}-${i}`;
  return sym;
}

/** First Holdings row (1-based) with no symbol, after the header. */
export function nextHoldingsRow(grid) {
  for (let i = 1; i < grid.length; i++) if (!String(grid[i]?.[1] ?? "").trim()) return i + 1;
  return Math.max(grid.length, 1) + 1;
}

/**
 * A full Holdings row (A:M) for a new position, with the same formulas as the
 * rows above it: units from Transactions, cost basis, value and gain.
 */
export function holdingsRow(r, { position, symbol, name, source = "manual", price = "", currency = "EUR", priceDate = "" }) {
  const tx = (col, type) =>
    `SUMIFS(Transactions!$${col}:$${col},Transactions!$B:$B,$A${r},Transactions!$D:$D,$B${r},Transactions!$C:$C,"${type}")`;
  return [
    position,
    symbol,
    name,
    `=IF($B${r}="","",${tx("E", "BUY")}-${tx("E", "SELL")})`,
    source,
    price,
    currency,
    priceDate,
    `=IF(OR($B${r}="",$J${r}="",$F${r}=""),"",$J${r}*$D${r})`,
    `=IF($B${r}="","",LET(u,${tx("E", "BUY")},c,${tx("J", "BUY")},IF(OR(u=0,c=0),"",c/u)))`,
    `=IF(OR($B${r}="",$F${r}=""),"",$D${r}*$F${r})`,
    `=IF(OR($B${r}="",$I${r}=""),"",$K${r}-$I${r})`,
    `=IF(OR($B${r}="",N($I${r})=0),"",$L${r}/$I${r})`,
  ];
}

/** Value a transaction adds, as the sheet's Value column computes it. */
/** True when two Transactions rows hold the same entry (columns A–I). */
export function sameTransaction(a, b) {
  const cell = (r, i) => String(r?.[i] ?? "").trim();
  for (let i = 0; i < 9; i++) if (cell(a, i) !== cell(b, i)) return false;
  return true;
}

export function transactionValue(row) {
  const [, , type, , units, price, fees, cash] = row;
  const f = num(fees) ?? 0;
  if (type === "BUY") return num(units) * num(price) + f;
  if (type === "SELL") return num(units) * num(price) - f;
  return num(cash) ?? 0;
}

/**
 * Plan the History writes for a snapshot: rows already present for the same
 * date and account are overwritten, the rest are appended from `nextRow`.
 */
export function planSnapshot(date, values, history, nextRow) {
  const updates = [];
  let row = nextRow;
  for (const { account, value, note } of values) {
    const existing = history.find((h) => h.date === date && h.account === account);
    const target = existing ? existing.row : row++;
    updates.push({ row: target, values: [date, account, value, note ?? (existing?.note || "")], replaced: !!existing });
  }
  return { updates, appended: row - nextRow, lastRow: row - 1 };
}

// ---------- retirement ----------

/** Retirement tab inputs: key -> label the row starts with. */
export const RETIREMENT_INPUTS = {
  currentAge: "Current age",
  retireAge: "Retirement age",
  endAge: "Plan until age",
  spend: "Monthly spend in retirement",
  pension: "Public pension per month",
  pensionAge: "Public pension from age",
  returnPre: "Real return before retirement",
  returnPost: "Real return in retirement",
  inflation: "Inflation",
  counted: "Portfolio counted",
  monthly: "Monthly investment now",
};

export const RETIREMENT_DEFAULTS = {
  currentAge: 43,
  retireAge: 50,
  endAge: 85,
  spend: 3000,
  pension: 600,
  pensionAge: 65,
  returnPre: 0.04,
  returnPost: 0.03,
  inflation: 0.025,
  counted: "Liquid",
  monthly: 0,
};

export const COUNTED_OPTIONS = ["Liquid", "Liquid + options", "Total"];

/**
 * Retirement tab: Setting | Value | Notes. Finds each input by its label, so
 * rows can move. Returns the values (defaults where missing) and their sheet rows.
 */
export function parseRetirement(grid) {
  const values = { ...RETIREMENT_DEFAULTS };
  const rows = {};
  for (let r = 1; r < (grid?.length ?? 0); r++) {
    const label = norm(grid[r]?.[0]);
    if (!label) continue;
    for (const [key, name] of Object.entries(RETIREMENT_INPUTS)) {
      if (rows[key] || !label.startsWith(norm(name))) continue;
      rows[key] = r + 1;
      const v = grid[r]?.[1];
      if (key === "counted") {
        const hit = COUNTED_OPTIONS.find((o) => norm(o) === norm(v));
        if (hit) values.counted = hit;
      } else if (num(v) !== null) {
        values[key] = num(v);
      }
      break;
    }
  }
  return { values, rows, found: Object.keys(rows).length > 0 };
}

/** Portfolio value the plan counts: liquid accounts, plus options, or everything. */
export function countedValue(accounts, mode) {
  const live = accounts.filter((a) => a.active);
  const sum = (list) => list.reduce((s, a) => s + a.value, 0);
  const liquid = sum(live.filter((a) => ["super liquid", "liquid"].includes(norm(a.liquidity))));
  if (mode === "Total") return sum(live);
  if (mode === "Liquid + options") return liquid + sum(live.filter((a) => norm(a.assetClass) === "options"));
  return liquid;
}

const monthly = (r) => (1 + r) ** (1 / 12) - 1;
/** Present value of 1 paid at the start of each month for n months. */
const annuityDue = (i, n) => (n <= 0 ? 0 : i === 0 ? n : ((1 - (1 + i) ** -n) / i) * (1 + i));

/** Spending and pension annuity factors for drawing down from `fromAge`. */
function drawdown(p, fromAge) {
  const i = monthly(p.returnPost);
  const total = Math.max(0, p.endAge - fromAge) * 12;
  const before = Math.max(0, p.pensionAge - fromAge) * 12;
  const during = Math.max(0, p.endAge - Math.max(p.pensionAge, fromAge)) * 12;
  return { spend: annuityDue(i, total), pension: annuityDue(i, during) * (1 + i) ** -before };
}

/** Portfolio needed at `age` to pay the spend until the plan ends (today's money). */
export function neededAt(p, age) {
  const f = drawdown(p, age);
  return Math.max(0, p.spend * f.spend - p.pension * f.pension);
}

/** Monthly spend a portfolio of `value` supports from `age` to the end (today's money). */
export function spendFrom(p, value, age) {
  const f = drawdown(p, age);
  return f.spend ? (value + p.pension * f.pension) / f.spend : null;
}

/** Value after `months` of growth at the pre-retirement return with `perMonth` added at each month end. */
function grow(p, start, perMonth, months) {
  const i = monthly(p.returnPre);
  const g = (1 + i) ** months;
  return start * g + perMonth * (i === 0 ? months : (g - 1) / i);
}

/**
 * The whole plan, in today's money. Matches the formulas on the Retirement tab.
 * `counted` is the portfolio value the plan starts from.
 */
export function retirementPlan(p, counted) {
  const years = Math.max(0, p.retireAge - p.currentAge);
  const months = years * 12;
  const needed = neededAt(p, p.retireAge);
  const i = monthly(p.returnPre);
  const g = (1 + i) ** months;
  const noNewMoney = counted * g;
  const perMonth = months === 0 ? (needed > counted ? null : 0) : Math.max(0, (needed - noNewMoney) / (i === 0 ? months : (g - 1) / i));
  const projected = grow(p, counted, p.monthly, months);
  let status = "Behind";
  if (perMonth === 0 || (perMonth !== null && p.monthly >= perMonth * 1.1)) status = "Ahead";
  else if (perMonth !== null && p.monthly >= perMonth * 0.9) status = "On track";

  let earliestAge = null;
  for (let age = Math.ceil(p.currentAge); age < p.endAge; age++) {
    if (grow(p, counted, p.monthly, (age - p.currentAge) * 12) >= neededAt(p, age)) {
      earliestAge = age;
      break;
    }
  }

  return {
    years,
    needed,
    neededFuture: needed * (1 + p.inflation) ** years,
    counted,
    noNewMoney,
    perMonth,
    projected,
    progress: needed ? projected / needed : 1,
    supportedSpend: spendFrom(p, projected, p.retireAge),
    todaySpend: spendFrom(p, counted, p.currentAge),
    earliestAge,
    status,
  };
}
