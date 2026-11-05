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

/** Chart series name for an account's asset class. */
export const seriesName = (assetClass) => assetClass || "Other";

/**
 * Total value on every History date, split by asset class:
 * [{date, total, parts: {Stocks: 1234, ...}}], oldest first.
 *
 * Each date is summed from its own rows, like the Monthly tab. A date with
 * only a few rows (a real estate value saved from the app between snapshots)
 * isn't a full snapshot: the accounts it leaves out keep their value from the
 * last full one, so the total doesn't dip. A date counts as full when it has
 * at least half as many accounts as the last full date.
 */
export function historySeries(history, accounts) {
  const classOf = new Map(accounts.map((a) => [a.name, a.assetClass]));
  const byDate = new Map();
  for (const h of history) {
    if (!h.date || !h.account) continue;
    if (!byDate.has(h.date)) byDate.set(h.date, new Map());
    byDate.get(h.date).set(h.account, h.value ?? 0);
  }
  const out = [];
  let full = null; // Map account -> value of the last full snapshot
  for (const date of [...byDate.keys()].sort()) {
    const rows = byDate.get(date);
    let values = rows;
    if (full && rows.size < full.size / 2) values = new Map([...full, ...rows]);
    else full = rows;
    const parts = {};
    let total = 0;
    for (const [account, value] of values) {
      const name = seriesName(classOf.get(account));
      parts[name] = (parts[name] ?? 0) + value;
      total += value;
    }
    out.push({ date, total, parts });
  }
  return out;
}

/** Today's live point for the series: active accounts' current values by class. */
export function livePoint(accounts, date) {
  const parts = {};
  let total = 0;
  for (const a of accounts.filter((x) => x.active)) {
    const name = seriesName(a.assetClass);
    parts[name] = (parts[name] ?? 0) + a.value;
    total += a.value;
  }
  return { date, total, parts };
}

/**
 * Points from `range` ("1m", "1y", "3y" or "all") before the last point. When
 * that leaves fewer than two, the snapshot before the start is kept too, so
 * the line still has somewhere to start from.
 */
export function pointsInRange(points, range) {
  if (range === "all" || !points.length) return points;
  const months = { "1m": 1, "1y": 12, "3y": 36 }[range] ?? 0;
  if (!months) return points;
  const from = addMonths(points[points.length - 1].date, -months);
  let start = points.findIndex((p) => p.date >= from);
  if (start < 0) start = points.length - 1;
  if (start > 0 && points.length - start < 2) start -= 1;
  return points.slice(start);
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
    year: changeNear(monthly, total, addMonths(today, -12), today),
  };
}

/** Overview groups for the accounts list, in display order. */
export const ACCOUNT_GROUPS = ["Stocks", "Cash", "Real estate", "Options"];

/** Overview group names: asset classes shown under another name. */
export const GROUP_NAMES = { Pension: "III pillar pension" };

/**
 * Change of an account's value over the last 12 months: against its History
 * snapshot closest to the same day a year ago (none from the last 6 months).
 * Null without one.
 */
export function annualChange(history, account, value, today) {
  const yearAgo = addMonths(today, -12);
  const cutoff = addMonths(today, -6);
  const gap = (d) => Math.abs(dayNumber(d) - dayNumber(yearAgo));
  let base = null;
  for (const h of history) {
    if (h.account !== account || !h.date || h.date > cutoff || h.value === null) continue;
    if (!base || gap(h.date) < gap(base.date)) base = h;
  }
  if (!base) return null;
  const change = value - base.value;
  return { value: change, pct: base.value ? change / base.value : null, from: base.date };
}

/**
 * Overview groups. Accounts valued from holdings are replaced by their
 * holdings (IBKR shows each stock; IBKR cash goes to Cash), and manual
 * accounts carry the date they last changed: their snapshot or a later
 * deposit or withdrawal. Each row's `change` is its value change over the
 * last year where History allows it (an account, or a holdings account's
 * only holding); IBKR stocks, which have no history of their own, show
 * their gain against cost instead (`change.basis` is "year" or "cost").
 */
export function overviewGroups(accounts, holdings, transactions = [], history = [], today = null) {
  const yearly = (account, value) => {
    const c = today ? annualChange(history, account, value, today) : null;
    return c ? { ...c, basis: "year" } : null;
  };
  const order = [...ACCOUNT_GROUPS, GROUP_NAMES.Pension];
  const groups = new Map(order.map((g) => [g, []]));
  const add = (cls, item) => {
    const name = GROUP_NAMES[cls] ?? cls;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  };
  const lastMove = new Map();
  for (const t of transactions) {
    const [date, account, type] = t.cells ?? t;
    const iso = serialToIso(date);
    if (!iso || (type !== "DEPOSIT" && type !== "WITHDRAWAL")) continue;
    if (!lastMove.has(account) || iso > lastMove.get(account)) lastMove.set(account, iso);
  }
  for (const a of accounts.filter((x) => x.active)) {
    if (a.valuation === "holdings") {
      const shown = holdings.filter((x) => x.position === a.name && (x.units || x.value));
      for (const h of shown) {
        const isCash = a.name === BROKER && h.symbol === BROKER_CASH;
        let change = null;
        if (shown.length === 1) change = yearly(a.name, h.value);
        else if (!isCash && h.gain !== null && h.gain !== undefined) change = { value: h.gain, pct: h.gainPct ?? null, basis: "cost" };
        add(isCash ? "Cash" : a.assetClass, {
          kind: "holding",
          name: isCash ? "IBKR cash" : h.name || h.symbol,
          account: a.name,
          holding: h,
          value: h.value,
          change,
        });
      }
    } else {
      const moved = lastMove.get(a.name);
      const updated = [a.lastSnapshot, moved].filter(Boolean).sort().pop() ?? null;
      add(a.assetClass, { kind: "account", name: a.name, account: a.name, value: a.value, change: yearly(a.name, a.value), updated });
    }
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length)
    .map(([name, items]) => ({ name, items: items.sort((x, y) => y.value - x.value), total: items.reduce((s, x) => s + x.value, 0) }));
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
  // III pillar and options are now set by their total value, so there's nothing to repeat.
  if (account === PENSION || account === OPTIONS) return null;
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
  returnPre: ["Real return before pension", "Real return before retirement"],
  returnPost: ["Real return after pension", "Real return after retirement", "Real return in retirement"],
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
      const names = Array.isArray(name) ? name : [name];
      if (rows[key] || !names.some((n) => label.startsWith(norm(n)))) continue;
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

/**
 * Value in today's money after `months` of growth at the pre-retirement return,
 * with a fixed `perMonth` (not raised with inflation) added at each month end.
 */
function grow(p, start, perMonth, months) {
  const i = nominalMonthly(p);
  const g = (1 + i) ** months;
  return (start * g + perMonth * (i === 0 ? months : (g - 1) / i)) / (1 + p.inflation) ** (months / 12);
}

/** Monthly nominal return before retirement: real return plus inflation. */
const nominalMonthly = (p) => ((1 + p.returnPre) * (1 + p.inflation)) ** (1 / 12) - 1;

/**
 * The whole plan, in today's money. Matches the formulas on the Retirement tab.
 * `counted` is the portfolio value the plan starts from.
 */
export function retirementPlan(p, counted) {
  const years = Math.max(0, p.retireAge - p.currentAge);
  const months = years * 12;
  const needed = neededAt(p, p.retireAge);
  const noNewMoney = counted * (1 + monthly(p.returnPre)) ** months;
  // A fixed monthly amount: grow it in nominal euros, then compare with the
  // target in the euros of the retirement year.
  const i = nominalMonthly(p);
  const g = (1 + i) ** months;
  const neededNominal = needed * (1 + p.inflation) ** years;
  const perMonth =
    months === 0 ? (needed > counted ? null : 0) : Math.max(0, (neededNominal - counted * g) / (i === 0 ? months : (g - 1) / i));
  const projected = grow(p, counted, p.monthly, months);
  let status = "Behind";
  if (perMonth === 0 || (perMonth !== null && p.monthly >= perMonth * 1.1)) status = "Ahead";
  else if (perMonth !== null && p.monthly >= perMonth * 0.9) status = "On track";

  const byAge = retirementByAge(p, counted);
  const earliestAge = byAge.find((r) => r.canRetire)?.age ?? null;

  return {
    years,
    needed,
    neededFuture: needed * (1 + p.inflation) ** years,
    projectedFuture: projected * (1 + p.inflation) ** years,
    noNewMoneyFuture: noNewMoney * (1 + p.inflation) ** years,
    counted,
    noNewMoney,
    perMonth,
    projected,
    progress: needed ? projected / needed : 1,
    supportedSpend: spendFrom(p, projected, p.retireAge),
    todaySpend: spendFrom(p, counted, p.currentAge),
    earliestAge,
    byAge,
    status,
  };
}

/**
 * One row per possible retirement age, from now until the plan ends: what the
 * portfolio would be at that age with the current monthly investment, what is
 * needed to retire then, and the monthly spend it would pay. Today's money,
 * with the portfolio and need also in the euros of that year (…Future).
 * Matches the table on the Retirement tab.
 */
export function retirementByAge(p, counted) {
  const out = [];
  for (let age = Math.ceil(p.currentAge); age < p.endAge; age++) {
    const portfolio = grow(p, counted, p.monthly, (age - p.currentAge) * 12);
    const needed = neededAt(p, age);
    const toFuture = (1 + p.inflation) ** (age - p.currentAge);
    out.push({
      age,
      portfolio,
      needed,
      portfolioFuture: portfolio * toFuture,
      neededFuture: needed * toFuture,
      spend: spendFrom(p, portfolio, age),
      spendFuture: spendFrom(p, portfolio, age) * toFuture,
      canRetire: portfolio >= needed,
    });
  }
  return out;
}

/** Plan inputs that differ from the saved ones (ignores float noise from sliders). */
export function changedInputs(saved, values) {
  return Object.keys(saved).filter((k) => {
    const a = saved[k];
    const b = values[k];
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) > 1e-9;
    return a !== b;
  });
}

// ---------- rebalancing ----------

/** Asset classes a target can be set for, in display order. */
export const TARGET_CLASSES = ["Stocks", "Real estate", "Cash", "Pension"];

/** Asset classes counted inside Stocks for rebalancing (Vinted options). */
export const STOCK_LIKE = ["Options"];

/**
 * Starting mix until targets are saved to the sheet. Options sit under
 * Stocks next to the IBKR ETFs; a deposit can't buy them, so they only
 * ever get sold to rebalance.
 */
export const TARGET_DEFAULTS = {
  classes: { Stocks: 0.6, "Real estate": 0.2, Cash: 0.1, Pension: 0.1 },
  stocks: { "VWCE.DE": 0.5, "VHYL.AS": 0.1, "ISPA.DE": 0.1, VINTED: 0.3 },
};

/** Shares as fractions: 70%, 0.7 and "70" all mean 70%. Blank is null. */
function share(v) {
  const n = typeof v === "string" ? num(v.replace("%", "")) : num(v);
  if (n === null) return null;
  return typeof v === "string" && v.includes("%") ? n / 100 : n > 1 ? n / 100 : n;
}

/**
 * Targets tab: Level | Name | Target %. Level "Class" rows hold the mix by
 * asset class; level "Stocks" rows split the stocks share by IBKR symbol.
 * A blank or zero target leaves that class or stock out of the plan.
 */
export function parseTargets(grid) {
  const c = columns(grid?.[0], { level: "Level", name: "Name", target: ["Target %", "Target"] });
  if (c.level < 0 || c.name < 0 || c.target < 0) return { ...structuredClone(TARGET_DEFAULTS), found: false };
  const out = { classes: {}, stocks: {}, found: true };
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const level = norm(cell(row, c.level));
    const name = text(row, c.name);
    const t = share(cell(row, c.target));
    if (!name || !t || t < 0) continue;
    if (level === "class") {
      if (!STOCK_LIKE.includes(name)) out.classes[name] = t;
    }
    else if (level === "stocks" || level === "stock") out.stocks[name.toUpperCase()] = t;
  }
  return out;
}

/** Rows for the Targets tab (header included), padded with blanks to `rows`. */
export function targetsGrid(targets, stockSymbols = [], rows = 30) {
  const pctText = (v) => (v ? `${+(v * 100).toFixed(2)}%` : "");
  const out = [["Level", "Name", "Target %"]];
  const classes = [...new Set([...TARGET_CLASSES, ...Object.keys(targets.classes)])];
  for (const k of classes) out.push(["Class", k, pctText(targets.classes[k])]);
  const symbols = [...new Set([...stockSymbols, ...Object.keys(targets.stocks)])];
  for (const s of symbols) out.push(["Stocks", s, pctText(targets.stocks[s])]);
  while (out.length < rows) out.push(["", "", ""]);
  return out;
}

/**
 * What the portfolio holds now, for rebalancing: active accounts by asset
 * class (IBKR cash counts as Cash), and the IBKR stocks one by one.
 */
export function currentMix(accounts, holdings) {
  const classes = {};
  const add = (k, v) => (classes[k] = (classes[k] ?? 0) + (v || 0));
  const stocks = [];
  for (const a of accounts.filter((x) => x.active)) {
    if (a.name === BROKER && a.valuation === "holdings") {
      for (const h of holdings.filter((x) => x.position === BROKER)) {
        if (h.symbol === BROKER_CASH) add("Cash", h.value);
        else {
          add(a.assetClass, h.value);
          stocks.push({ key: h.symbol, name: h.name || h.symbol, value: h.value || 0, price: h.price });
        }
      }
    } else if (STOCK_LIKE.includes(a.assetClass)) {
      // Options count as stocks, one item per holding (or the account).
      const own = holdings.filter((x) => x.position === a.name && (x.units || x.value));
      const items = a.valuation === "holdings" && own.length ? own.map((h) => ({ key: h.symbol, name: h.name || h.symbol, value: h.value || 0 })) : [{ key: a.name, name: a.name, value: a.value }];
      for (const i of items) {
        add("Stocks", i.value);
        stocks.push({ ...i, price: null, fixed: true });
      }
    } else {
      add(a.assetClass, a.value);
    }
  }
  return { classes, stocks };
}

/**
 * Split `amount` across items without selling anything: money goes to the
 * items furthest below target first, filling them up to the same share of
 * target, so the mix ends as close to the targets as a buy-only deposit can.
 * Items: [{ key, value, target }] with targets summing to 1. Returns key -> buy.
 */
export function buyOnly(items, amount) {
  const out = Object.fromEntries(items.map((i) => [i.key, 0]));
  const live = items.filter((i) => i.target > 0 && !i.fixed);
  if (!(amount > 0) || !live.length) return out;
  // Find the level L with sum(max(0, target*L - value)) = amount.
  const sorted = [...live].sort((a, b) => a.value / a.target - b.value / b.target);
  let tSum = 0;
  let vSum = 0;
  let level = 0;
  for (let k = 0; k < sorted.length; k++) {
    tSum += sorted[k].target;
    vSum += sorted[k].value;
    level = (amount + vSum) / tSum;
    const next = sorted[k + 1];
    if (!next || level <= next.value / next.target) break;
  }
  for (const i of live) out[i.key] = Math.max(0, i.target * level - i.value);
  return out;
}

/** Buys (positive) and sells (negative) that put the items exactly on target. */
export function fullRebalance(items, amount) {
  const total = items.reduce((s, i) => s + i.value, 0) + amount;
  const out = Object.fromEntries(items.map((i) => [i.key, (i.target || 0) * total - i.value]));
  // Items that can't be bought (options) and sit below target stay as they
  // are; the rest are rebalanced over what's left.
  const stuck = items.filter((i) => i.fixed && out[i.key] > 0);
  if (!stuck.length) return out;
  const rest = items.filter((i) => !stuck.includes(i));
  const tSum = rest.reduce((s, i) => s + (i.target || 0), 0);
  const sub = fullRebalance(
    rest.map((i) => ({ ...i, target: tSum ? (i.target || 0) / tSum : 0 })),
    amount,
  );
  for (const i of stuck) sub[i.key] = 0;
  return sub;
}

const normalize = (map) => {
  const sum = Object.values(map).reduce((s, v) => s + (v > 0 ? v : 0), 0);
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, sum && v > 0 ? v / sum : 0]));
};

/**
 * The rebalancing plan for a deposit. Only classes with a target are in the
 * plan; the rest are listed as `outside`. The stocks share is then split by
 * IBKR symbol. `sell` true puts everything exactly on target instead.
 */
export function rebalancePlan(mix, targets, deposit, { sell = false } = {}) {
  const split = sell ? fullRebalance : buyOnly;
  const classT = normalize(targets.classes);
  const inPlan = Object.keys(classT).filter((k) => classT[k] > 0);
  const classItems = inPlan.map((k) => ({ key: k, value: mix.classes[k] ?? 0, target: classT[k] }));
  const base = classItems.reduce((s, i) => s + i.value, 0);
  const after = base + deposit;
  const classMoves = split(classItems, deposit);
  const classes = classItems.map((i) => ({
    ...i,
    share: base ? i.value / base : 0,
    move: classMoves[i.key],
    afterShare: after ? (i.value + classMoves[i.key]) / after : 0,
  }));
  const outside = Object.entries(mix.classes)
    .filter(([k, v]) => !inPlan.includes(k) && v)
    .map(([key, value]) => ({ key, value }));

  // Within stocks: symbols with a target; held ones without one are shown too.
  const stockT = normalize(targets.stocks);
  const known = new Map(mix.stocks.map((s) => [s.key, s]));
  const keys = [...new Set([...mix.stocks.map((s) => s.key), ...Object.keys(stockT).filter((k) => stockT[k] > 0)])];
  const stockItems = keys.map((k) => ({ key: k, name: known.get(k)?.name ?? k, price: known.get(k)?.price ?? null, value: known.get(k)?.value ?? 0, target: stockT[k] ?? 0, fixed: !!known.get(k)?.fixed }));
  const stockBase = stockItems.reduce((s, i) => s + i.value, 0);
  const stockMoney = classMoves.Stocks ?? 0;
  const hasStockTargets = stockItems.some((i) => i.target > 0);
  const stockMoves = hasStockTargets ? split(stockItems, stockMoney) : {};
  const stockAfter = stockBase + stockMoney;
  const stocks = stockItems.map((i) => {
    const move = stockMoves[i.key] ?? 0;
    return {
      ...i,
      share: stockBase ? i.value / stockBase : 0,
      move,
      afterShare: stockAfter ? (i.value + move) / stockAfter : 0,
      units: i.price > 0 && move > 0 ? Math.floor(move / i.price) : null,
    };
  });

  // Deposits needed to reach the target mix without selling anything.
  const reachAll = classItems.length ? Math.max(0, Math.max(...classItems.map((i) => i.value / i.target)) - base) : 0;

  return { base, deposit, classes, outside, stocks, stockMoney, hasStockTargets, reachAll };
}

// ---------- savings rate ----------

/** Income tab: Date | Source | Amount (EUR) | Note. */
export const INCOME_HEADER = ["Date", "Source", "Amount (EUR)", "Note"];
export const INCOME_SOURCES = ["Salary", "Options", "Other"];
/** Rent isn't counted: not as income, and the Rent cash account's deposits aren't savings. */
export const RENT_ACCOUNT = "Rent cash";
const isRent = (s) => norm(s) === "rent";

/** Sources to offer: the standard ones, then any others already on the Income tab. */
export function incomeSources(income = []) {
  const out = [...INCOME_SOURCES];
  for (const i of income) {
    const src = String(i.source ?? "").trim();
    if (src && !isRent(src) && !out.some((x) => norm(x) === norm(src))) out.push(src);
  }
  return out;
}

/** Income tab rows with a date and an amount, with their 1-based sheet row. */
export function parseIncome(grid) {
  const c = columns(grid?.[0], { date: "Date", source: "Source", amount: "Amount", note: "Note" });
  const out = [];
  for (let r = 1; r < (grid?.length ?? 0); r++) {
    const row = grid[r];
    const date = serialToIso(cell(row, c.date));
    const amount = num(cell(row, c.amount));
    if (!date || amount === null) continue;
    out.push({ row: r + 1, date, source: text(row, c.source), amount, note: text(row, c.note) });
  }
  return out;
}

/** Validate an income form and return the Income row (A:D). */
export function incomeRow(t) {
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date ?? "")) errors.push("Pick a date.");
  const amount = num(String(t.amount ?? "").replace(",", "."));
  if (!(amount > 0)) errors.push("Amount must be more than 0.");
  const source = String(t.source ?? "").trim();
  if (!source) errors.push("Enter the new source's name.");
  else if (isRent(source)) errors.push("Rent isn't counted as income for the savings rate.");
  if (errors.length) return { errors };
  return { errors, row: [t.date, source, amount, String(t.note ?? "").trim()] };
}

/**
 * New money a Transactions row puts into the portfolio, or null when it moves
 * nothing in from outside. Deposits add and withdrawals take away (a transfer
 * between two of your own accounts nets to zero); III pillar buys add what was
 * paid. IBKR buys and sells are left out because they are paid from and into
 * IBKR cash, whose deposits already count. Option grants cost nothing, and
 * starting positions aren't savings.
 */
export function savedBy(cells) {
  const [date, account, type, , units, price, fees, cash, note] = cells ?? [];
  if (!serialToIso(date) || /^starting position/i.test(String(note ?? "").trim())) return null;
  if (norm(account) === norm(RENT_ACCOUNT)) return null;
  if (type === "DEPOSIT") return num(cash) ?? 0;
  if (type === "WITHDRAWAL") return -(num(cash) ?? 0);
  if (account === PENSION && (type === "BUY" || type === "SELL")) {
    const v = (num(units) ?? 0) * (num(price) ?? 0) + (num(fees) ?? 0);
    return type === "BUY" ? v : -v;
  }
  return null;
}

/**
 * Savings rate per calendar month, oldest first, for the `count` months up to
 * and including `today`'s month: income, money saved, and saved / income
 * (null without income). `average` is the rate over the months with income.
 */
export function savingsByMonth(transactions, income, today, count = 12) {
  const end = today.slice(0, 7);
  const months = [];
  for (let i = count - 1; i >= 0; i--) months.push(addMonths(`${end}-01`, -i).slice(0, 7));
  const by = new Map(months.map((m) => [m, { month: m, income: 0, saved: 0, rate: null }]));
  for (const i of income) if (!isRent(i.source) && by.get(i.date.slice(0, 7))) by.get(i.date.slice(0, 7)).income += i.amount;
  for (const t of transactions) {
    const cells = t.cells ?? t;
    const v = savedBy(cells);
    const m = by.get(serialToIso(cells[0]).slice(0, 7));
    if (v !== null && m) m.saved += v;
  }
  const list = [...by.values()];
  for (const m of list) {
    m.saved = Math.round(m.saved * 100) / 100;
    m.rate = m.income > 0 ? m.saved / m.income : null;
  }
  const withIncome = list.filter((m) => m.income > 0);
  const inc = withIncome.reduce((s, m) => s + m.income, 0);
  const saved = withIncome.reduce((s, m) => s + m.saved, 0);
  return { months: list, income: inc, saved, average: inc ? saved / inc : null, monthsWithIncome: withIncome.length };
}

// ---------- plan vs actual ----------

/** Portfolio value a Monthly row holds for the plan's "Portfolio counted" setting. */
export function countedSnapshot(m, mode) {
  const liquid = m.parts?.["Liquid (all)"];
  if (mode === "Total" || liquid === undefined) return m.total;
  if (mode === "Liquid + options") return liquid + (m.parts?.Options ?? 0);
  return liquid;
}

const MONTH_DAYS = 365.25 / 12;

/**
 * New money put in between `from` (exclusive) and `to` (inclusive): deposits
 * minus withdrawals on any account, plus III pillar contributions (fund units
 * bought or sold there), as `savedBy` counts them.
 */
export function netInvested(transactions, from, to) {
  let sum = 0;
  for (const t of transactions) {
    const cells = t.cells ?? t;
    const iso = serialToIso(cells[0]);
    const v = savedBy(cells);
    if (v !== null && iso > from && iso <= to) sum += v;
  }
  return sum;
}

/** First day new money was recorded (a dated deposit, withdrawal or III pillar contribution). */
export function investTrackingStart(transactions) {
  let first = null;
  for (const t of transactions) {
    const cells = t.cells ?? t;
    const iso = serialToIso(cells[0]);
    if (savedBy(cells) !== null && (!first || iso < first)) first = iso;
  }
  return first;
}

/**
 * Growth the plan expects from a start value over `months`: the nominal
 * return before retirement on the value, plus the fixed monthly investment
 * (added at each month end, earning the same return).
 */
export function planGrowth(p, start, months) {
  const i = nominalMonthly(p);
  const g = (1 + i) ** months;
  const invested = p.monthly * months;
  const total = start * (g - 1) + p.monthly * (i === 0 ? months : (g - 1) / i);
  return { total, invested, returns: total - invested };
}

/** Last point of each calendar period (`len` 7 = month, 4 = year), oldest first. */
function periodEnds(points, len) {
  const out = [];
  for (const pt of points) {
    const last = out[out.length - 1];
    if (last && last.date.slice(0, len) === pt.date.slice(0, len)) out[out.length - 1] = pt;
    else out.push(pt);
  }
  return out;
}

/**
 * Plan vs actual growth of the counted portfolio, from the Monthly snapshots
 * (plus today's live value when it's newer than the last snapshot).
 *
 * - `perMonth` / `perYear`: what the plan expects from today's value over the
 *   next month and year, split into the return and the money invested.
 * - `months` / `years`: one row per calendar month and year, newest first,
 *   from the previous period's last snapshot to this period's last snapshot.
 *   `plan` scales with the days in between, so gaps in the history compare
 *   fairly. `invested` is null before new money was recorded on the
 *   Transactions tab, and `partial` marks the period recording started in.
 * - `last12`: change since the snapshot closest to a year ago, against the plan
 *   for the same stretch.
 * Matches the Plan vs actual tab of the sheet.
 */
export function planVsActual(p, monthly, transactions = [], { live = null, today = null } = {}) {
  const points = monthly.map((m) => ({ date: m.date, value: countedSnapshot(m, p.counted) }));
  if (live !== null && today && (!points.length || today > points[points.length - 1].date)) points.push({ date: today, value: live });
  const now = points[points.length - 1] ?? null;
  const value = now?.value ?? live ?? 0;
  const tracking = investTrackingStart(transactions);
  const rows = (len) => {
    const ends = periodEnds(points, len);
    const out = [];
    for (let k = ends.length - 1; k >= 1; k--) {
      const a = ends[k - 1];
      const b = ends[k];
      const months = (dayNumber(b.date) - dayNumber(a.date)) / MONTH_DAYS;
      const plan = planGrowth(p, a.value, months);
      const counted = tracking !== null && b.date >= tracking;
      out.push({
        period: b.date.slice(0, len),
        from: a.date,
        to: b.date,
        start: a.value,
        end: b.value,
        months,
        actual: b.value - a.value,
        plan: plan.total,
        planInvested: plan.invested,
        diff: b.value - a.value - plan.total,
        invested: counted ? netInvested(transactions, a.date, b.date) : null,
        partial: counted && a.date < tracking,
      });
    }
    return out;
  };

  let last12 = null;
  if (now) {
    const yearAgo = addMonths(now.date, -12);
    const cutoff = addMonths(now.date, -6);
    const gap = (d) => Math.abs(dayNumber(d) - dayNumber(yearAgo));
    let base = null;
    for (const pt of points) if (pt.date <= cutoff && (!base || gap(pt.date) < gap(base.date))) base = pt;
    if (base) {
      const months = (dayNumber(now.date) - dayNumber(base.date)) / MONTH_DAYS;
      const plan = planGrowth(p, base.value, months);
      const counted = tracking !== null;
      last12 = {
        from: base.date,
        to: now.date,
        months,
        actual: now.value - base.value,
        plan: plan.total,
        planInvested: plan.invested,
        diff: now.value - base.value - plan.total,
        invested: counted ? netInvested(transactions, base.date, now.date) : null,
        partial: counted && base.date < tracking,
      };
    }
  }

  return {
    value,
    asOf: now?.date ?? null,
    rate: (1 + p.returnPre) * (1 + p.inflation) - 1,
    perMonth: planGrowth(p, value, 1),
    perYear: planGrowth(p, value, 12),
    months: rows(7),
    years: rows(4),
    last12,
    tracking,
  };
}

/**
 * The Transaction tab's two-level picker: an asset class, then an action.
 * Each pair maps to one form `mode` that decides the fields and the save.
 */
export const TX_CLASSES = [
  { id: "stocks", label: "Stocks", actions: [["BUY", "Buy"], ["SELL", "Sell"]] },
  { id: "cash", label: "Cash", actions: [["DEPOSIT", "Add"], ["WITHDRAWAL", "Remove"]] },
  { id: "pension", label: "III pillar", actions: [["PENSION_VALUE", "Current funds"], ["PENSION_NEW", "Add new fund"]] },
  { id: "options", label: "Options", actions: [["OPTIONS_VALUE", "New total value"]] },
  { id: "estate", label: "Real estate", actions: [["ESTATE_UP", "Increase"], ["ESTATE_DOWN", "Decrease"]] },
];

/** Class and mode to open the form on, from what was saved last (older saves used a single type). */
export function txStart(last = {}) {
  const legacy = { PENSION: "PENSION_VALUE", OPTIONS: "OPTIONS_VALUE", REAL_ESTATE: "ESTATE_UP" };
  const mode = legacy[last.type] ?? last.mode ?? last.type;
  for (const c of TX_CLASSES) if (c.actions.some(([m]) => m === mode)) return { cls: c.id, mode };
  return { cls: "stocks", mode: "BUY" };
}

/**
 * Price per unit that makes a position worth `total` with `units` held.
 * Null when there are no units to spread the value over.
 */
export function unitPriceForTotal(total, units) {
  const u = num(units);
  if (!(u > 0) || total === null || !Number.isFinite(total) || total < 0) return null;
  return total / u;
}

/** A property's value after an increase or decrease of `amount`, rounded to cents. */
export function changedValue(current, amount, up) {
  return Math.round(((current ?? 0) + (up ? amount : -amount)) * 100) / 100;
}
