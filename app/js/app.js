import { CONFIG } from "../config.js";
import { AuthError, Sheets, getToken, handleRedirect, signIn, signOut } from "./google.js";
import {
  COUNTED_OPTIONS,
  BROKER,
  BROKER_CASH,
  PENSION,
  OPTIONS,
  fundSymbol,
  holdingsRow,
  nextHoldingsRow,
  countedValue,
  nextFreeRow,
  parseRetirement,
  sameTransaction,
  retirementPlan,
  planVsActual,
  planGrowth,
  changedInputs,
  parseAccounts,
  parseHistory,
  historySeries,
  livePoint,
  pointsInRange,
  planSnapshot,
  parseHoldings,
  parseLists,
  parseMonthly,
  summarize,
  periodChanges,
  overviewGroups,
  moveToTotal,
  repeatForm,
  transactionRow,
  transactionValue,
  num,
  serialToIso,
  GROUP_NAMES,
  TARGET_CLASSES,
  currentMix,
  parseTargets,
  rebalancePlan,
  targetsGrid,
  INCOME_HEADER,
  incomeSources,
  markInterest,
  incomeRow,
  parseIncome,
  savingsByMonth,
  TX_CLASSES,
  txStart,
  unitPriceForTotal,
  changedValue,
} from "./model.js";
import { esc, eur, eurCents, pct, shortDate, signedEur, signedPct, todayIso, tone } from "./format.js";
import { ageChart, lineChart } from "./chart.js";

const RANGES = {
  accounts: "Accounts!A1:L300",
  holdings: "Holdings!A1:M300",
  monthly: "Monthly!A1:Z2000",
  lists: "Lists!A1:J60",
  history: "History!A:D",
  transactions: "Transactions!A1:I10000",
};
// Read on its own so a sheet without a Retirement tab still loads.
const RETIREMENT_RANGE = "Retirement!A1:C40";
// The target mix for the Rebalance tab; the tab is created on first save.
const TARGETS_RANGE = "Targets!A1:C40";
const DEPOSIT_KEY = "pt.deposit";
// Also on its own: the Income tab is made the first time income is saved.
const INCOME_RANGE = "Income!A1:D5000";
const CACHE_KEY = "pt.cache.v1";
const VIEW_KEY = "pt.view";
const RANGE_KEY = "pt.range";
const SPLIT_KEY = "pt.chartSplit";
const CLIENT_KEY = "pt.clientId";

const $ = (s, root = document) => root.querySelector(s);
const ls = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};

const state = {
  data: null, // parsed sheet data
  loadedAt: null,
  meta: null,
  view: ls.get(VIEW_KEY) || "home",
  range: ls.get(RANGE_KEY) || "all",
  split: ls.get(SPLIT_KEY) === "1",
  busy: false,
};

const clientId = () => CONFIG.clientId || ls.get(CLIENT_KEY) || "";
const sheets = new Sheets(CONFIG.sheetId);

// ---------- data ----------

function parseAll(raw) {
  const lists = parseLists(raw.lists);
  return {
    accounts: parseAccounts(raw.accounts),
    holdings: parseHoldings(raw.holdings),
    monthly: parseMonthly(raw.monthly),
    retirement: parseRetirement(raw.retirement ?? []),
    targets: parseTargets(raw.targets ?? []),
    income: parseIncome(raw.income ?? []),
    lists,
    history: parseHistory(raw.history),
    historyNext: nextFreeRow(raw.history),
    transactions: raw.transactions
      .slice(1)
      .map((row, i) => ({ row: i + 2, cells: row }))
      .filter((t) => t.cells?.[1]),
    transactionsNext: nextFreeRow(raw.transactions),
  };
}

async function load({ quiet = false } = {}) {
  if (state.busy) return;
  if (!getToken()) {
    needSignIn();
    return;
  }
  state.busy = true;
  setRefreshing(true);
  if (!quiet) setStatus("Updating…");
  try {
    const keys = Object.keys(RANGES);
    const optional = (range) =>
      sheets.batchGet([range]).then(
        ([g]) => g,
        (e) => {
          if (e instanceof AuthError) throw e;
          return [];
        },
      );
    const [values, meta, retirement, targets, income] = await Promise.all([
      sheets.batchGet(keys.map((k) => RANGES[k])),
      sheets.meta(),
      optional(RETIREMENT_RANGE),
      optional(TARGETS_RANGE),
      optional(INCOME_RANGE),
    ]);
    const raw = Object.fromEntries(keys.map((k, i) => [k, values[i]]));
    raw.retirement = retirement;
    raw.targets = targets;
    raw.income = income;
    state.data = parseAll(raw);
    state.meta = meta;
    state.loadedAt = Date.now();
    ls.set(CACHE_KEY, JSON.stringify({ raw, at: state.loadedAt }));
    if (!$("#banner").classList.contains("ok")) hideBanner();
    setStatus("");
    render();
  } catch (e) {
    if (e instanceof AuthError) needSignIn();
    else if (!navigator.onLine) showBanner("You're offline. Showing the last loaded data.");
    else showBanner(e.message || String(e), "error");
    setStatus("");
  } finally {
    state.busy = false;
    setRefreshing(false);
  }
}

function loadCache() {
  try {
    const c = JSON.parse(ls.get(CACHE_KEY) ?? "null");
    if (!c?.raw) return false;
    state.data = parseAll(c.raw);
    state.loadedAt = c.at;
    return true;
  } catch {
    return false;
  }
}

// ---------- chrome ----------

function setStatus(t) {
  $("#status").textContent = t;
}
function setRefreshing(on) {
  $("#refresh").classList.toggle("spin", on);
}
function showBanner(html, kind = "", action) {
  const b = $("#banner");
  b.className = `banner ${kind}`;
  b.innerHTML = `<span>${html}</span>`;
  if (action) {
    const btn = document.createElement("button");
    btn.className = "btn small";
    btn.textContent = action.label;
    btn.onclick = action.run;
    b.append(btn);
  }
  b.hidden = false;
  clearTimeout(showBanner.timer);
  if (kind === "ok") showBanner.timer = setTimeout(hideBanner, 5000);
}
function hideBanner() {
  $("#banner").hidden = true;
}

function needSignIn() {
  if (state.data) {
    showBanner("Sign in again to load the latest numbers.", "", { label: "Sign in", run: () => signIn(clientId()) });
    render();
  } else {
    $("#tabs").hidden = true;
    $("#view").innerHTML = `
      <div class="signin">
        <img class="app-icon" src="icons/icon-192.png" alt="">
        <h2>Portfolio</h2>
        <p>Sign in with the Google account that owns the <strong>Portfolio tracker</strong> sheet. The app reads and writes it directly; nothing goes anywhere else.</p>
        <button class="btn" id="signin">Sign in with Google</button>
      </div>`;
    $("#signin").onclick = () => signIn(clientId());
  }
}

function setupScreen() {
  $("#tabs").hidden = true;
  $("#refresh").hidden = true;
  $("#view").innerHTML = `
    <h1 class="large-title">Setup</h1>
    <div class="card">
      <h2>One-time setup</h2>
      <p class="small">Paste the OAuth client ID you created in Google Cloud. It ends in <code>.apps.googleusercontent.com</code>. It is saved on this phone only.</p>
      <form id="setup">
        <label class="field">Client ID<input name="id" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
        <button class="btn">Save</button>
      </form>
      <p class="small muted">The redirect URI to register is <code>${esc(location.origin + location.pathname.replace(/index\.html$/, ""))}</code></p>
    </div>`;
  $("#setup").onsubmit = (e) => {
    e.preventDefault();
    const id = new FormData(e.target).get("id").trim();
    if (!/\.apps\.googleusercontent\.com$/.test(id)) {
      alert("That doesn't look like a client ID. It should end in .apps.googleusercontent.com");
      return;
    }
    ls.set(CLIENT_KEY, id);
    signIn(id);
  };
}

function go(view) {
  state.view = view;
  ls.set(VIEW_KEY, view);
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (!state.data) return;
  $("#tabs").hidden = false;
  // "goals" was the old goals tab; the retirement plan is the Goals tab now.
  if (state.view === "goals") state.view = "retire";
  // The Snapshot tab was replaced by the monthly snapshot job.
  if (state.view === "snapshot") state.view = "home";
  for (const b of $("#tabs").querySelectorAll("button")) {
    if (b.dataset.view === state.view) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  const views = { home: renderHome, retire: renderRetire, rebalance: renderRebalance, savings: renderSavings, add: renderAdd };
  const view = views[state.view] ? state.view : "home";
  const root = $("#view");
  views[view](root);
  // iOS large title, which collapses into the navigation bar on scroll.
  root.insertAdjacentHTML("afterbegin", `<h1 class="large-title">${TITLES[view]}</h1>`);
  $("#title").textContent = TITLES[view];
  onScroll();
}

const TITLES = { home: "Portfolio", retire: "Goals", rebalance: "Rebalance", savings: "Savings", add: "Add/remove asset" };

function onScroll() {
  $(".top").classList.toggle("scrolled", window.scrollY > 36);
}

// ---------- overview ----------

function changeLine(v, p) {
  return `<span class="${tone(v)} num">${signedEur(v)}</span> <span class="${tone(v)} num">(${signedPct(p)})</span>`;
}

function renderHome(root) {
  const d = state.data;
  const s = summarize(d.accounts, d.monthly);
  const priceDates = d.holdings.filter((h) => h.source === "yahoo" && h.priceDate).map((h) => h.priceDate).sort();
  const pricesAt = priceDates[priceDates.length - 1];

  // Built from the History tab rather than Monthly, so daily snapshots and
  // the split by asset class need no extra formulas in the sheet.
  const today = todayIso();
  const series = d.history.length ? historySeries(d.history, d.accounts) : d.monthly;
  const points = series.map((p) => ({ date: p.date, value: p.total, parts: p.parts }));
  const last = points[points.length - 1];
  if (!last || today > last.date) points.push({ ...livePoint(d.accounts, today), value: s.total });

  const changes = periodChanges(series, s.total, today);
  const groups = overviewGroups(d.accounts, d.holdings, d.transactions, d.history, today);
  // Plan vs actual: what the Goals plan (return before pension plus
  // inflation, plus the monthly investment) expected over the same stretch.
  const plan = d.retirement.found ? d.retirement.values : null;
  const planLine = (c) => {
    if (!plan || c.value === null || !c.from) return "";
    const months = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${c.from}T00:00:00Z`)) / 86400000 / (365.25 / 12);
    const expected = planGrowth(plan, s.total - c.value, months).total;
    return `<div class="sub small">Plan <span class="num">${signedEur(expected)}</span> · ${vsPlan(c.value - expected)}</div>`;
  };
  const changeTile = (label, c, fromWord, wide = false) => `
      <div class="card stat${wide ? " wide" : ""}">
        <div class="label">${label}</div>
        <div class="value">${c.value === null ? "–" : `<span class="${tone(c.value)} num">${signedEur(c.value)}</span>`}</div>
        <div class="sub">${c.from ? `<span class="${tone(c.value)} num">${signedPct(c.pct)}</span> <span class="muted">${fromWord} ${shortDate(c.from)}</span>` : `<span class="muted">No snapshot yet</span>`}</div>
        ${planLine(c)}
      </div>`;

  root.innerHTML = `
    <section class="card hero">
      <div class="label">Total value</div>
      <div class="value num">${eur(s.total)}</div>
      <div class="sub muted">${pricesAt ? `Prices from ${shortDate(pricesAt)}` : "Live prices and latest snapshot"}</div>
    </section>

    <section class="stats">
      ${changeTile("Last month", changes.month, "since")}
      ${changeTile("This year", changes.ytd, "since")}
      ${changeTile("Last 12 months", changes.year, "since", true)}
    </section>

    <section class="card">
      <div class="card-head">
        <h2>Net worth</h2>
        <div class="seg" role="group" aria-label="Show">
          <button data-split="0" aria-pressed="${!state.split}">Total</button>
          <button data-split="1" aria-pressed="${state.split}">By class</button>
        </div>
      </div>
      <div class="chart-range">
        <span class="chart-change small" id="chart-change"></span>
        <div class="seg" role="group" aria-label="Time range">
          ${["1m", "1y", "3y", "all"].map((r) => `<button data-range="${r}" aria-pressed="${state.range === r}">${r === "all" ? "All" : r.toUpperCase()}</button>`).join("")}
        </div>
      </div>
      <div class="chart" id="chart"></div>
    </section>

    <section class="card">
      <h2>Allocation</h2>
      ${donut(groups.map((g) => ({ name: g.name, value: g.total })))}
    </section>

    ${groups
      .map(
        (g) => `
    <section class="card">
      <div class="card-head"><h2>${esc(g.name)}</h2><span class="group-total num">${eur(g.total)}</span></div>
      <ul class="list">${groupItems(g.items)}</ul>
    </section>`,
      )
      .join("")}

    <p class="footnote">${state.loadedAt ? `Loaded ${new Date(state.loadedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : ""}
    · <a href="#" id="signout">Sign out</a></p>
  `;

  const draw = () => {
    const shown = pointsInRange(points, state.range);
    lineChart($("#chart"), shown, { label: "Net worth", stack: state.split ? chartStack(shown) : null });
    const first = shown[0];
    const end = shown[shown.length - 1];
    const diff = first && end && shown.length > 1 ? end.value - first.value : null;
    $("#chart-change").innerHTML =
      diff === null ? "" : `<span class="${tone(diff)} num">${signedEur(diff)}${first.value ? ` (${signedPct(diff / first.value)})` : ""}</span> <span class="muted">since ${shortDate(first.date)}</span>`;
  };
  draw();
  const pick = (attr, apply) =>
    root.querySelectorAll(`[${attr}]`).forEach((b) =>
      b.addEventListener("click", () => {
        apply(b.getAttribute(attr));
        root.querySelectorAll(`[${attr}]`).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        draw();
      }),
    );
  pick("data-range", (v) => ls.set(RANGE_KEY, (state.range = v)));
  pick("data-split", (v) => {
    state.split = v === "1";
    ls.set(SPLIT_KEY, v);
  });
  $("#signout").onclick = (e) => {
    e.preventDefault();
    signOut();
    ls.del(CACHE_KEY);
    ls.del(PIN_KEY);
    ls.del(PASSKEY_KEY);
    ls.del("pt.privacy");
    document.documentElement.classList.remove("privacy");
    state.data = null;
    needSignIn();
  };
}

// Fixed colours per group to match the coral theme, readable on light and dark.
const GROUP_COLORS = { Stocks: "#e8475f", Cash: "#00a699", "Real estate": "#f26b3a", Options: "#8a5cf5", "III pillar pension": "#f5b400" };
const SPARE_COLORS = ["#c13584", "#717171", "#b08968", "#3fa9f5"];

/** Net worth chart bands, bottom to top: the steadiest classes at the bottom. */
const STACK_ORDER = ["Real estate", "Options", "Pension", "Cash", "Stocks", "Crypto"];
const STACK_COLORS = { Pension: "#d99a00", Crypto: "#3fa9f5", Other: "#717171" };

function chartStack(points) {
  const names = new Set(points.flatMap((p) => Object.keys(p.parts ?? {})));
  const rank = (n) => (STACK_ORDER.includes(n) ? STACK_ORDER.indexOf(n) : n === "Other" ? 99 : 50);
  let spare = 0;
  return [...names]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((name) => ({ name, color: STACK_COLORS[name] ?? GROUP_COLORS[name] ?? SPARE_COLORS[spare++ % SPARE_COLORS.length] }));
}

/** Donut of each group's share of the total, with a legend. */
function donut(items) {
  const shown = items.filter((i) => i.value > 0);
  const total = shown.reduce((s, i) => s + i.value, 0);
  if (!total) return `<p class="muted">Nothing to show yet.</p>`;
  let spare = 0;
  const colored = shown.map((i) => ({ ...i, color: GROUP_COLORS[i.name] ?? SPARE_COLORS[spare++ % SPARE_COLORS.length] }));
  const r = 15.9155; // circumference 100, so dash lengths are percentages
  let offset = 25; // start at 12 o'clock
  const arcs = colored
    .map((i) => {
      const len = (i.value / total) * 100;
      const gap = colored.length > 1 ? Math.min(0.6, len / 2) : 0;
      const arc = `<circle r="${r}" cx="21" cy="21" fill="none" stroke="${i.color}" stroke-width="6" stroke-dasharray="${(len - gap).toFixed(3)} ${(100 - len + gap).toFixed(3)}" stroke-dashoffset="${offset.toFixed(3)}"><title>${esc(i.name)} ${pct(i.value / total)}</title></circle>`;
      offset -= len;
      return arc;
    })
    .join("");
  return `
    <div class="donut">
      <svg viewBox="0 0 42 42" role="img" aria-label="Share by asset class">${arcs}</svg>
      <ul class="legend">${colored
        .map((i) => `<li><span class="swatch" style="background:${i.color}"></span><span class="name">${esc(i.name)}</span><span class="share">${pct(i.value / total)}</span><span class="amt num">${eur(i.value)}</span></li>`)
        .join("")}</ul>
    </div>`;
}

/** Rows of an overview group: stocks and funds from holdings, and manual accounts. */
function groupItems(items) {
  return items
    .map((i) => {
      const c = i.change;
      const gain = c
        ? `<div class="small"><span class="${tone(c.value)} num">${signedEur(c.value)}${c.pct !== null ? ` (${signedPct(c.pct)})` : ""}</span> <span class="muted">${c.basis === "year" ? "1 yr" : "vs cost"}</span></div>`
        : "";
      let meta;
      if (i.kind === "holding") {
        const h = i.holding;
        meta = i.name === "IBKR cash" ? "IBKR" : `${num(h.units)?.toLocaleString("en-GB", { maximumFractionDigits: 4 })} × ${h.price === null ? "no price" : eurCents(h.price)}${h.priceDate ? ` · ${shortDate(h.priceDate)}` : ""}`;
      } else {
        meta = i.updated ? `as of ${shortDate(i.updated)}` : "no snapshot";
      }
      return `<li><div class="row"><div><div class="name">${esc(i.name)}</div><div class="meta">${esc(meta)}</div></div><div class="right"><div class="num">${eur(i.value)}</div>${gain}</div></div></li>`;
    })
    .join("");
}

// ---------- retirement ----------

const RETIRE_FIELDS = [
  { key: "currentAge", label: "Current age", kind: "age" },
  { key: "retireAge", label: "Retire at age", kind: "age" },
  { key: "endAge", label: "Plan until age", kind: "age" },
  { key: "pensionAge", label: "Pension from age", kind: "age" },
  { key: "spend", label: "Spend (€/month, today's value)", kind: "eur" },
  { key: "pension", label: "Pension (€/month, today's value)", kind: "eur" },
  { key: "monthly", label: "Investing (€/month)", kind: "eur" },
  { key: "returnPre", label: "Real return before pension (%)", kind: "pct" },
  { key: "returnPost", label: "Real return after pension (%)", kind: "pct" },
  { key: "inflation", label: "Inflation (%)", kind: "pct" },
];

const STATUS_TONE = { Ahead: "up", "On track": "up", Behind: "down" };

const thisYear = () => new Date().getFullYear();
const retireYear = (plan) => thisYear() + plan.years;

function progressBar(share, caption, label) {
  const p = Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 0;
  return `<div class="progress" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p * 100)}"><div style="width:${(p * 100).toFixed(1)}%"></div></div>
      <div class="sub muted">${caption}</div>`;
}

function retireSummary(v, plan) {
  const t = STATUS_TONE[plan.status];
  const pace =
    plan.earliestAge === null
      ? `At this pace the portfolio doesn't reach ${eur(v.spend)}/month before ${v.endAge}.`
      : plan.earliestAge <= v.retireAge
        ? `At this pace you could retire at <strong>${plan.earliestAge}</strong>.`
        : `At this pace you reach ${eur(v.spend)}/month at age <strong>${plan.earliestAge}</strong>.`;
  return {
    hero: `
    <section class="card hero">
      <div class="label">Retire at ${esc(v.retireAge)} on ${eur(v.spend)}/month</div>
      <div class="value ${t}">${esc(plan.status)}</div>
      <div class="sub">Need <span class="num">${eur(plan.neededFuture)}</span> at ${esc(v.retireAge)}. Investing ${eur(v.monthly)}/month gets you to <span class="num">${eur(plan.projectedFuture)}</span>.</div>
      <div class="sub muted">In ${retireYear(plan)} euros.</div>
      ${progressBar(plan.progress, `Projected at ${esc(v.retireAge)}: <span class="num">${pct(plan.progress)}</span> of the target`, "Projected vs needed")}
      ${progressBar(plan.counted / plan.needed, `Today: <span class="num">${eur(plan.counted)}</span>, <span class="num">${pct(plan.counted / plan.needed)}</span> of the target in today's money (<span class="num">${eur(plan.needed)}</span>)`, "Today vs needed")}
    </section>`,
    details: `
    <section class="stats">
      <div class="card stat">
        <div class="label">Invest per month</div>
        <div class="value num">${plan.perMonth === null ? "–" : eur(plan.perMonth)}</div>
        <div class="sub muted">fixed, from now to ${esc(v.retireAge)} to hit the target</div>
      </div>
      <div class="card stat">
        <div class="label">If you retired today</div>
        <div class="value num">${eur(plan.todaySpend)}<span class="small muted">/mo</span></div>
        <div class="sub muted">from ${eur(plan.counted)} until ${esc(v.endAge)}</div>
      </div>
      <div class="card stat wide">
        <div class="label">Earliest you can retire</div>
        <div class="value num">${plan.earliestAge === null ? `Not before ${esc(v.endAge)}` : `Age ${plan.earliestAge}`}</div>
        <div class="sub muted">on ${eur(v.spend)}/month, investing ${eur(v.monthly)}/month until then</div>
      </div>
      <div class="card stat wide">
        <div class="label">At your current pace</div>
        <div class="value num">${eur(plan.supportedSpend)}<span class="small muted">/mo at ${esc(v.retireAge)}</span></div>
        <div class="sub muted">${pace}</div>
      </div>
    </section>

    ${byAgeCard(v, plan)}

    <section class="card goal">
      <h2>The numbers</h2>
      <dl class="figs">
        <div><dt>Amount needed at year ${retireYear(plan)}</dt><dd class="num">${eur(plan.neededFuture)}</dd></div>
        <div><dt>Counted now (${esc(v.counted.toLowerCase())})</dt><dd class="num">${eur(plan.counted)}</dd></div>
        <div><dt>At ${esc(v.retireAge)} with no new money (${retireYear(plan)} euros)</dt><dd class="num">${eur(plan.noNewMoneyFuture)}</dd></div>
      </dl>
      <p class="small muted" style="margin:6px 0 0">Targets and portfolio values are in the euros of the year you'd retire. Spending and pension are in today's money and rise with inflation; the monthly investment is a fixed amount. Spending runs from ${esc(v.retireAge)} to ${esc(v.endAge)} and uses the portfolio up; the pension covers ${eur(v.pension)} of it from ${esc(v.pensionAge)}. Taxes aren't included.</p>
    </section>`,
    readout: `
      <div><div class="label">Earliest age</div><div class="num">${plan.earliestAge === null ? `${esc(v.endAge)}+` : plan.earliestAge}</div></div>
      <div><div class="label">Funded at ${esc(v.retireAge)}</div><div class="num ${plan.progress >= 1 ? "up" : ""}">${pct(plan.progress)}</div></div>
      <div><div class="label">Need in ${retireYear(plan)}</div><div class="num">${eur(plan.neededFuture)}</div></div>`,
  };
}

// What-if sliders: each drives the matching field in "Your plan". Nothing is
// saved until "Save"; "Reset" puts the saved values back.
const WHAT_IF = [
  { key: "monthly", label: "Investing", step: 100, range: (s) => [0, Math.max(10000, Math.ceil((s.monthly * 2) / 1000) * 1000)], show: (x) => `${eur(x)}/mo` },
  { key: "retireAge", label: "Retire at", step: 1, range: (s) => [Math.ceil(s.currentAge) + 1, Math.max(Math.ceil(s.currentAge) + 1, s.endAge - 1)], show: (x) => `age ${x}` },
  { key: "spend", label: "Spend", step: 100, range: (s) => [500, Math.max(8000, Math.ceil((s.spend * 2) / 1000) * 1000)], show: (x) => `${eur(x)}/mo` },
  { key: "returnPre", label: "Return before pension", step: 0.25, range: () => [0, 10], show: (x) => `${+x.toFixed(2)}% real` },
  { key: "returnPost", label: "Return after pension", step: 0.25, range: () => [0, 10], show: (x) => `${+x.toFixed(2)}% real` },
];

function whatIfCard(saved) {
  const toSlider = (k, x) => (RETIRE_FIELDS.find((f) => f.key === k).kind === "pct" ? x * 100 : x);
  return `
    <section class="card whatif">
      <div class="card-head"><h2>What if</h2><button type="button" class="btn small secondary" id="whatIfReset" disabled>Reset</button></div>
      <div class="readout" id="whatIfReadout" aria-live="polite"></div>
      ${WHAT_IF.map((w) => {
        const [min, max] = w.range(saved);
        return `<label class="slider"><span class="slider-head"><span>${esc(w.label)}</span><span class="num" id="wi-${w.key}"></span></span><input type="range" name="wi-${w.key}" data-key="${w.key}" min="${min}" max="${max}" step="${w.step}" value="${esc(toSlider(w.key, saved[w.key]))}"></label>`;
      }).join("")}
      <p class="small muted" id="whatIfNote">Drag to try a different plan. Nothing is saved unless you tap Save.</p>
    </section>`;
}


function byAgeCard(v, plan) {
  const pick = plan.byAge.find((r) => r.age === plan.earliestAge);
  const goal = plan.byAge.find((r) => r.age === v.retireAge);
  const line = (r, what) =>
    r
      ? `<li><span>${what}: <strong>${r.age}</strong> (${thisYear() + r.age - v.currentAge})</span><span class="num">${eur(r.spendFuture)}/mo</span></li>`
      : "";
  return `
    <section class="card">
      <h2>Retire at each age</h2>
      <div class="chart" id="ageChart"></div>
      <ul class="age-picks">${line(goal, "Your goal")}${pick && pick !== goal ? line(pick, "Earliest") : ""}</ul>
      <p class="small muted" style="margin:8px 0 0">Tap the chart to see any age. Amounts are in the euros of the year you'd retire: what you'd have, what you'd need, and the monthly spend it pays until ${esc(v.endAge)}, if you keep investing ${eur(v.monthly)}/month until then.</p>
    </section>`;
}

function drawAgeChart(v, plan) {
  const host = $("#ageChart");
  if (!host) return;
  const anchor = Math.max(v.retireAge, plan.earliestAge ?? v.retireAge);
  const rows = plan.byAge
    .filter((r) => r.age <= anchor + 5)
    .map((r) => ({ age: r.age, have: r.portfolioFuture, need: r.neededFuture, spend: r.spendFuture, year: thisYear() + r.age - v.currentAge }));
  ageChart(host, rows, { goal: v.retireAge, earliest: plan.earliestAge });
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const periodName = (k) => (k.length === 4 ? k : `${MONTH_NAMES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`);
const shortDay = (iso) => shortDate(iso).replace(/ \d{4}$/, "");

/** "+€1,200 vs plan" / "€800 behind plan", coloured. */
function vsPlan(diff) {
  if (diff === null || !Number.isFinite(diff)) return "";
  const word = Math.abs(diff) < 0.5 ? "on plan" : diff > 0 ? "ahead of plan" : "behind plan";
  return `<span class="${tone(diff)} num">${eur(Math.abs(diff))}</span> <span class="muted">${word}</span>`;
}

function investedLine(r, tracking) {
  if (r.invested === null) return "";
  return `<div class="meta">Invested <span class="num">${eur(r.invested)}</span> of <span class="num">${eur(r.planInvested)}</span> planned${r.partial ? ` (recorded from ${shortDate(tracking)})` : ""}</div>`;
}

/** Plan vs actual by month and by year for the counted portfolio. */
function planVsActualCard(v) {
  const d = state.data;
  const r = planVsActual(v, d.monthly, d.transactions, { live: countedValue(d.accounts, v.counted), today: todayIso() });
  const row = (x) => `
        <li><div class="row"><div><div class="name">${esc(periodName(x.period))}</div><div class="meta">${shortDay(x.from)} – ${shortDate(x.to)} · plan <span class="num">${signedEur(x.plan)}</span></div>${investedLine(x, r.tracking)}</div><div class="right"><div class="num ${tone(x.actual)}">${signedEur(x.actual)}</div><div class="small">${vsPlan(x.diff)}</div></div></div></li>`;
  const tracked = r.tracking
    ? `New money (deposits minus withdrawals, plus III pillar contributions, without Rent cash) is counted from the Transactions tab, recorded since ${shortDate(r.tracking)}.`
    : "";
  return `
    ${r.months.length ? `<section class="card">
      <h2>Growth vs plan by month</h2>
      <p class="small muted" style="margin:0 0 6px">The plan grows ${esc(v.counted.toLowerCase())} by <span class="num">${pct(r.rate)}</span> a year (${pct(v.returnPre)} real return plus ${pct(v.inflation)} inflation) and adds ${eur(v.monthly)} a month.</p>
      <ul class="list">${r.months.slice(0, 12).map(row).join("")}</ul>
    </section>` : ""}
    ${r.years.length ? `<section class="card">
      <h2>Growth vs plan by year</h2>
      <ul class="list">${r.years.map(row).join("")}</ul>
      <p class="small muted" style="margin:0;padding:10px 16px 14px 0">Each period runs from the last snapshot of the one before to its own last snapshot, so older months, which were snapshotted around the 5th, cover mostly the month before. The plan scales with the days in between. ${tracked}</p>
    </section>` : ""}`;
}

function renderRetire(root) {
  const d = state.data;
  const r = d.retirement;
  if (!r.found) {
    root.innerHTML = `<div class="card"><p class="muted">The sheet has no <strong>Retirement</strong> tab yet. Add one with a Setting and a Value column to plan here.</p></div>`;
    return;
  }
  const show = (f, v) => (f.kind === "pct" ? +(v * 100).toFixed(2) : v);
  root.innerHTML = `
    <div id="retireHero"></div>
    ${whatIfCard(r.values)}
    <div id="retireSummary"></div>
    <div id="planVsActual"></div>
    <section class="card">
      <h2>Your plan</h2>
      <form id="retire" novalidate>
        <label class="field">Portfolio counted
          <select name="counted">${COUNTED_OPTIONS.map((o) => `<option ${o === r.values.counted ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>
        </label>
        <p class="small muted" style="margin:-8px 0 0">Liquid is cash, stocks and III pillar. Options adds Vinted options. Total adds real estate.</p>
        <div class="two">
          ${RETIRE_FIELDS.map((f) => `<label class="field">${esc(f.label)}<input name="${f.key}" inputmode="decimal" autocomplete="off" value="${esc(show(f, r.values[f.key]))}"></label>`).join("")}
        </div>
        <ul class="errors" id="retireErrors"></ul>
        <button class="btn" id="retireSave">Save</button>
      </form>
    </section>`;

  const form = $("#retire");
  const read = () => {
    const f = new FormData(form);
    const v = { ...r.values, counted: f.get("counted") };
    const errors = [];
    for (const field of RETIRE_FIELDS) {
      const raw = String(f.get(field.key) ?? "").trim().replace(",", ".");
      const n = num(raw);
      if (n === null) errors.push(`${field.label}: enter a number.`);
      else v[field.key] = field.kind === "pct" ? n / 100 : n;
    }
    if (!errors.length) {
      if (!(v.currentAge < v.retireAge)) errors.push("Retirement age must be after your current age.");
      if (!(v.retireAge < v.endAge)) errors.push("Plan until age must be after the retirement age.");
      if (v.spend < 0 || v.pension < 0 || v.monthly < 0) errors.push("Amounts can't be negative.");
    }
    return { v, errors };
  };
  const sliders = [...root.querySelectorAll('.whatif input[type="range"]')];
  const sync = () => {
    const { v, errors } = read();
    if (!errors.length) {
      const plan = retirementPlan(v, countedValue(d.accounts, v.counted));
      const out = retireSummary(v, plan);
      $("#retireHero").innerHTML = out.hero;
      $("#retireSummary").innerHTML = out.details;
      drawAgeChart(v, plan);
      $("#whatIfReadout").innerHTML = out.readout;
      $("#planVsActual").innerHTML = planVsActualCard(v);
      for (const s of sliders) {
        const k = s.dataset.key;
        const x = RETIRE_FIELDS.find((f) => f.key === k).kind === "pct" ? v[k] * 100 : v[k];
        if (document.activeElement !== s) s.value = x;
        $(`#wi-${k}`).textContent = WHAT_IF.find((w) => w.key === k).show(x);
      }
    }
    const changed = changedInputs(r.values, v);
    $("#whatIfReset").disabled = !changed.length;
    $("#whatIfNote").textContent = changed.length
      ? "Trying a different plan. Tap Save to keep it, or Reset to go back."
      : "Drag to try a different plan. Nothing is saved unless you tap Save.";
    $("#retireErrors").innerHTML = errors.map((x) => `<li>${esc(x)}</li>`).join("");
    return { v, errors };
  };
  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  for (const s of sliders) {
    s.addEventListener("input", () => {
      form.elements[s.dataset.key].value = +(+s.value).toFixed(2);
      sync();
    });
  }
  $("#whatIfReset").onclick = () => {
    for (const f of RETIRE_FIELDS) form.elements[f.key].value = show(f, r.values[f.key]);
    form.elements.counted.value = r.values.counted;
    sync();
  };
  sync();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const { v, errors } = sync();
    if (errors.length) return;
    const missing = Object.keys(v).filter((k) => !r.rows[k]);
    const btn = $("#retireSave");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const data = Object.entries(r.rows).map(([k, row]) => {
        const field = RETIRE_FIELDS.find((f) => f.key === k);
        const value = field?.kind === "pct" ? `${+(v[k] * 100).toFixed(4)}%` : v[k];
        return { range: `Retirement!B${row}`, values: [[value]] };
      });
      await sheets.write(data);
      showBanner(`Saved your plan to the Retirement tab.${missing.length ? ` Not saved (no row in the sheet): ${esc(missing.join(", "))}.` : ""}`, "ok");
      await load({ quiet: true });
    } catch (err) {
      if (err instanceof AuthError) needSignIn();
      else showBanner(esc(err.message || String(err)), "error");
      btn.disabled = false;
      btn.textContent = "Save";
    }
  };
}

// ---------- rebalance ----------

const className = (k) => GROUP_NAMES[k] ?? k;
const pctText = (v) => (v ? String(+(v * 100).toFixed(2)) : "");

/** A bar of the current share with a tick at the target share. */
function mixBar(share, target, color) {
  const w = (v) => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%`;
  return `<div class="mix-bar" aria-hidden="true"><div class="fill" style="width:${w(share)};background:${color}"></div>${target ? `<div class="tick" style="left:${w(target)}"></div>` : ""}</div>`;
}

function mixRows(items, colorOf, sell) {
  return items
    .map((i) => {
      const off = i.share - i.target;
      const status = !i.target ? "no target" : Math.abs(off) < 0.0025 ? "on target" : off > 0 ? `${pct(off)} over` : `${pct(-off)} under`;
      const moveText = i.move > 0.5 ? `<span class="up num">+${eur(i.move)}</span>` : sell && i.move < -0.5 ? `<span class="down num">−${eur(-i.move)}</span>` : `<span class="muted">nothing</span>`;
      return `<li class="mix-row">
        <div class="mix-top"><span class="name">${esc(i.label)}</span><span class="num">${eur(i.value)}</span></div>
        ${mixBar(i.share, i.target, colorOf(i))}
        <div class="mix-sub"><span><span class="num">${pct(i.share)}</span> now · target <span class="num">${pct(i.target)}</span> · ${status}</span><span>${moveText}</span></div>
      </li>`;
    })
    .join("");
}

/** The buy list: ETFs one by one when stock targets are set, then the other classes. */
function buyList(plan, sell) {
  const lines = [];
  for (const c of plan.classes) {
    if (c.key === "Stocks" && plan.hasStockTargets) {
      for (const s of plan.stocks) {
        if (!(s.move > 0.5 || (sell && s.move < -0.5))) continue;
        const units = s.move > 0 ? (s.units ? `≈ ${s.units} unit${s.units === 1 ? "" : "s"} at ${eurCents(s.price)}` : s.price ? `less than 1 unit at ${eurCents(s.price)}` : "") : s.price ? `≈ ${Math.floor(-s.move / s.price)} units` : "";
        lines.push({ name: s.fixed ? s.name : s.key, meta: s.fixed ? "Sell vested options" : [s.name, units].filter(Boolean).join(" · "), move: s.move });
      }
    } else if (c.move > 0.5 || (sell && c.move < -0.5)) {
      const where = { Stocks: "At IBKR", Cash: "Savings or a term deposit", Pension: "Artea, III pillar", "Real estate": "Mortgage overpayment or property" }[c.key] ?? "";
      lines.push({ name: className(c.key), meta: where, move: c.move, out: c.key === "Cash" ? "Move out" : "Sell" });
    }
  }
  if (!lines.length) return `<p class="muted" style="margin:0">Nothing to do: the mix is on target.</p>`;
  return `<ul class="list">${lines
    .sort((a, b) => b.move - a.move)
    .map((l) => `<li><div class="row"><div><div class="name">${esc(l.name)}</div>${l.meta ? `<div class="meta">${esc(l.meta)}</div>` : ""}</div><div class="right"><div class="num ${l.move < 0 ? "down" : ""}">${l.move < 0 ? `${l.out ?? "Sell"} ${eur(-l.move)}` : eur(l.move)}</div></div></div></li>`)
    .join("")}</ul>`;
}

function rebalanceResult(plan, sell) {
  const outside = plan.outside.length
    ? `<p class="small muted" style="margin:12px 0 0">Not in the plan: ${plan.outside.map((o) => `${esc(className(o.key))} <span class="num">${eur(o.value)}</span>`).join(", ")}. Give it a target below to count it.</p>`
    : "";
  const reach =
    !sell && plan.reachAll > 1
      ? `<p class="small muted" style="margin:12px 0 0">Deposits of <span class="num">${eur(plan.reachAll)}</span> in total would bring every class to target without selling.</p>`
      : "";
  const stockShown = plan.hasStockTargets && plan.stocks.length;
  return `
    <section class="card">
      <h2>${sell ? "Trades to reach the target" : `What to buy with ${eur(plan.deposit)}`}</h2>
      ${buyList(plan, sell)}
      ${reach}
    </section>

    <section class="card">
      <div class="card-head"><h2>Mix by class</h2><span class="group-total num">${eur(plan.base)}</span></div>
      <ul class="mix">${mixRows(
        plan.classes.map((c) => ({ ...c, label: className(c.key) })),
        (i) => GROUP_COLORS[i.label] ?? "var(--accent)",
        sell,
      )}</ul>
      ${outside}
    </section>

    ${
      stockShown
        ? `<section class="card">
      <div class="card-head"><h2>Stocks and options</h2><span class="group-total num">${eur(plan.stocks.reduce((s, x) => s + x.value, 0))}</span></div>
      <ul class="mix">${mixRows(
        plan.stocks.map((s) => ({ ...s, label: s.fixed ? s.name : s.key })),
        () => GROUP_COLORS.Stocks,
        sell,
      )}</ul>
      <p class="small muted" style="margin:12px 0 0">Shares are of the stocks total. ${sell ? "" : `The ${eur(plan.stockMoney)} for stocks is split so the most underweight ETF gets it first.`} Options can't be bought, so they only get sold to rebalance.</p>
    </section>`
        : ""
    }`;
}

function renderRebalance(root) {
  const d = state.data;
  const saved = d.targets;
  const mix = currentMix(d.accounts, d.holdings);
  const symbols = mix.stocks.map((s) => s.key);
  const stockKeys = [...new Set([...symbols, ...Object.keys(saved.stocks)])];
  const classKeys = [...new Set([...TARGET_CLASSES, ...Object.keys(saved.classes), ...Object.keys(mix.classes)])];
  const fallback = d.retirement.values.monthly > 0 ? d.retirement.values.monthly : 1000;
  const deposit = num(ls.get(DEPOSIT_KEY)) ?? fallback;
  const sell = ls.get("pt.rebalSell") === "1";

  const stockName = (k) => (mix.stocks.find((x) => x.key === k && x.fixed)?.name ?? k);
  const input = (prefix, k, v) =>
    `<label class="field">${esc(prefix === "c" ? className(k) : stockName(k))}<input name="${prefix}:${esc(k)}" inputmode="decimal" autocomplete="off" placeholder="–" value="${esc(pctText(v))}"><span class="unit">%</span></label>`;

  root.innerHTML = `
    <section class="card hero">
      <form id="deposit" novalidate>
        <label class="field">Next deposit (€)<input name="amount" inputmode="decimal" autocomplete="off" value="${esc(deposit)}"></label>
        <div class="field">Mode
          <div class="seg" role="radiogroup" aria-label="Mode">
            <label><input type="radio" name="mode" value="buy" ${sell ? "" : "checked"}><span>Buy only</span></label>
            <label><input type="radio" name="mode" value="sell" ${sell ? "checked" : ""}><span>Buy and sell</span></label>
          </div>
        </div>
      </form>
      ${saved.found ? "" : `<p class="small muted" style="margin:8px 0 0">These are starting targets. Change them below and save them to the sheet.</p>`}
    </section>
    <div id="rebalResult"></div>
    <section class="card">
      <h2>Target mix</h2>
      <form id="targets" novalidate>
        <p class="small muted">By asset class. Leave a class blank to keep it out of the plan.</p>
        ${classKeys.map((k) => input("c", k, saved.classes[k])).join("")}
        <div class="total-line"><span>Total</span><span id="classSum" class="num"></span></div>
        <p class="small muted" style="margin-top:14px">Within stocks: the IBKR ETFs and Vinted options, as shares of the stocks part.</p>
        ${stockKeys.map((k) => input("s", k, saved.stocks[k])).join("")}
        <div class="total-line"><span>Total</span><span id="stockSum" class="num"></span></div>
        <ul class="errors" id="targetErrors"></ul>
        <button class="btn" id="targetsSave">Save to sheet</button>
      </form>
    </section>`;

  const depForm = $("#deposit");
  const tForm = $("#targets");
  const read = () => {
    const f = new FormData(tForm);
    const targets = { classes: {}, stocks: {} };
    const errors = [];
    for (const [name, raw] of f.entries()) {
      const [prefix, ...rest] = name.split(":");
      const key = rest.join(":");
      const v = String(raw).trim().replace(",", ".").replace("%", "");
      if (!v) continue;
      const n = num(v);
      if (n === null || n < 0 || n > 100) {
        errors.push(`${prefix === "c" ? className(key) : key}: enter a share from 0 to 100.`);
        continue;
      }
      if (n > 0) (prefix === "c" ? targets.classes : targets.stocks)[key] = n / 100;
    }
    const sum = (m) => Object.values(m).reduce((s, x) => s + x, 0);
    const cs = sum(targets.classes);
    const ss = sum(targets.stocks);
    if (!cs) errors.push("Give at least one asset class a target.");
    else if (Math.abs(cs - 1) > 0.0001) errors.push(`The asset classes add up to ${+(cs * 100).toFixed(2)}%. Make them 100%.`);
    if (ss && Math.abs(ss - 1) > 0.0001) errors.push(`The stocks add up to ${+(ss * 100).toFixed(2)}%. Make them 100%.`);
    $("#classSum").textContent = `${+(cs * 100).toFixed(2)}%`;
    $("#stockSum").textContent = ss ? `${+(ss * 100).toFixed(2)}%` : "–";
    return { targets, errors };
  };
  const sync = () => {
    const { targets, errors } = read();
    const df = new FormData(depForm);
    const amount = Math.max(0, num(String(df.get("amount") ?? "").replace(",", ".")) ?? 0);
    const sellMode = df.get("mode") === "sell";
    ls.set(DEPOSIT_KEY, String(amount));
    ls.set("pt.rebalSell", sellMode ? "1" : "0");
    // Sums that don't reach 100% yet still show a plan, scaled to 100%.
    if (Object.keys(targets.classes).length) $("#rebalResult").innerHTML = rebalanceResult(rebalancePlan(mix, targets, amount, { sell: sellMode }), sellMode);
    $("#targetErrors").innerHTML = errors.map((x) => `<li>${esc(x)}</li>`).join("");
    return { targets, errors };
  };
  depForm.addEventListener("input", sync);
  depForm.addEventListener("change", sync);
  depForm.onsubmit = (e) => e.preventDefault();
  tForm.addEventListener("input", sync);
  sync();

  tForm.onsubmit = async (e) => {
    e.preventDefault();
    const { targets, errors } = sync();
    if (errors.length) return;
    const btn = $("#targetsSave");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const meta = await freshMeta();
      if (!meta.tabs.Targets) meta.tabs.Targets = await sheets.addTab("Targets");
      const grid = targetsGrid(targets, symbols, 40);
      await sheets.write([{ range: `Targets!A1:C${grid.length}`, values: grid }]);
      showBanner("Saved your target mix to the Targets tab.", "ok");
      await load({ quiet: true });
    } catch (err) {
      if (err instanceof AuthError) needSignIn();
      else showBanner(esc(err.message || String(err)), "error");
      btn.disabled = false;
      btn.textContent = "Save to sheet";
    }
  };
}

// ---------- savings rate ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym, long = true) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}${long ? ` ${ym.slice(0, 4)}` : ""}`;

/** Bars of the savings rate per month, one coral hue, negative months below the line. */
function rateBars(months) {
  const W = 340;
  const H = 170;
  const m = { t: 10, r: 4, b: 22, l: 36 };
  const rates = months.map((x) => x.rate ?? 0);
  const top = Math.max(0.5, Math.ceil(Math.max(...rates) * 4) / 4);
  const bottom = Math.min(0, Math.floor(Math.min(...rates) * 4) / 4);
  const ih = H - m.t - m.b;
  const y = (v) => m.t + ((top - v) / (top - bottom)) * ih;
  const slot = (W - m.l - m.r) / months.length;
  const bw = Math.max(4, slot - 2 * Math.max(2, slot * 0.18));
  const ticks = [];
  for (let v = bottom; v <= top + 1e-9; v += 0.25) ticks.push(+v.toFixed(2));
  const grid = ticks
    .map((t) => `<line class="${t === 0 ? "base" : "grid"}" x1="${m.l}" x2="${W - m.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="axis" x="${m.l - 6}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${Math.round(t * 100)}%</text>`)
    .join("");
  const bars = months
    .map((x, i) => {
      const cx = m.l + slot * i + slot / 2;
      const label = `<text class="axis" x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${monthName(x.month, false).slice(0, 1)}</text>`;
      if (x.rate === null) return `${label}<text class="axis" x="${cx.toFixed(1)}" y="${(y(0) - 4).toFixed(1)}" text-anchor="middle">·</text>`;
      const y0 = y(0);
      const y1 = y(x.rate);
      const h = Math.max(1, Math.abs(y1 - y0));
      const yTop = Math.min(y0, y1);
      const r = Math.min(4, bw / 2, h);
      // Rounded at the data end only, square on the zero line.
      const d =
        x.rate >= 0
          ? `M${cx - bw / 2},${y0}V${yTop + r}Q${cx - bw / 2},${yTop} ${cx - bw / 2 + r},${yTop}H${cx + bw / 2 - r}Q${cx + bw / 2},${yTop} ${cx + bw / 2},${yTop + r}V${y0}Z`
          : `M${cx - bw / 2},${y0}V${y0 + h - r}Q${cx - bw / 2},${y0 + h} ${cx - bw / 2 + r},${y0 + h}H${cx + bw / 2 - r}Q${cx + bw / 2},${y0 + h} ${cx + bw / 2},${y0 + h - r}V${y0}Z`;
      return `${label}<path class="bar${x.rate < 0 ? " neg" : ""}" data-i="${i}" d="${d}"/><rect class="hit" data-i="${i}" x="${(cx - slot / 2).toFixed(1)}" y="${m.t}" width="${slot.toFixed(1)}" height="${ih}"><title>${monthName(x.month)}: ${pct(x.rate)}</title></rect>`;
    })
    .join("");
  return `<svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Savings rate per month">${grid}${bars}</svg>`;
}

function renderSavings(root) {
  const d = state.data;
  const today = todayIso();
  const s = savingsByMonth(d.transactions, d.income, today, 12);
  const recent = [...s.months].reverse();
  const latest = recent.find((m) => m.income > 0) ?? null;
  const sources = incomeSources(d.income);
  const lastSource = ls.get(SOURCE_KEY);
  const incomeCard = `
    <section class="card" id="incomeCard">
      <h2 id="incomeTitle">Add income</h2>
      <form id="incomeForm" novalidate>
        <input type="hidden" name="editRow" value="">
        <label class="field">Date<input type="date" name="date" value="${today}" required></label>
        <label class="field">Source
          <select name="source">${sources.map((x) => `<option ${x === (lastSource ?? "Salary") ? "selected" : ""}>${esc(x)}</option>`).join("")}<option value="${NEW_SOURCE}">New source…</option></select>
        </label>
        <label class="field" data-for="newsource" hidden>Source name<input name="newSource" autocomplete="off" placeholder="e.g. Freelance"></label>
        <label class="field">Net amount (€)<input name="amount" inputmode="decimal" autocomplete="off" placeholder="after tax"></label>
        <label class="field">Note<input name="note" autocomplete="off"></label>
        <div class="preview" id="incomePreview"></div>
        <ul class="errors" id="incomeErrors"></ul>
        <button class="btn" id="incomeSave">Save income</button>
        <button type="button" class="btn secondary" id="incomeCancel" style="margin-top:10px" hidden>Cancel editing</button>
      </form>
    </section>`;
  const recentIncome = [...d.income].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.row < b.row ? 1 : -1)).slice(0, 12);
  const incomeList = recentIncome.length
    ? `<section class="card"><h2>Recent income</h2><ul class="list">${recentIncome
        .map(
          (i) =>
            `<li><div class="row"><div><div class="name">${esc(i.source || "Income")}</div><div class="meta">${shortDate(i.date)}${i.note ? ` · ${esc(i.note)}` : ""}</div></div><div class="right num">${eurCents(i.amount)}</div><button class="rep-btn" data-income-edit="${i.row}" aria-label="Edit this income" title="Edit">${EDIT_SVG}</button><button class="del-btn" data-income-del="${i.row}" aria-label="Remove this income" title="Remove">${REMOVE_SVG}</button></div></li>`,
        )
        .join("")}</ul></section>`
    : "";

  if (!d.income.length) {
    root.innerHTML = `
      <section class="card">
        <h2>Savings rate</h2>
        <p>Your savings rate is the share of your income that goes into your accounts each month. Add your net income below (salary, options or anything else), and it shows here next to what you put into your accounts that month. Rent isn't counted.</p>
      </section>
      ${incomeCard}`;
    wireIncomeForm();
    return;
  }

  root.innerHTML = `
    <section class="card hero">
      <div class="label">Savings rate, ${latest ? monthName(latest.month) : "this month"}</div>
      <div class="value num">${latest ? pct(latest.rate) : "–"}</div>
      <div class="sub">${latest ? `Saved <span class="num">${eur(latest.saved)}</span> of <span class="num">${eur(latest.income)}</span> income.` : ""}</div>
    </section>

    <section class="stats">
      <div class="card stat">
        <div class="label">12-month average</div>
        <div class="value num">${pct(s.average)}</div>
        <div class="sub muted">over ${s.monthsWithIncome} month${s.monthsWithIncome === 1 ? "" : "s"} with income</div>
      </div>
      <div class="card stat">
        <div class="label">Saved in 12 months</div>
        <div class="value num">${eur(s.saved)}</div>
        <div class="sub muted">of ${eur(s.income)} income</div>
      </div>
    </section>

    <section class="card">
      <h2>Rate per month</h2>
      <div class="chart" id="rateChart">${rateBars(s.months)}</div>
      <p class="small muted" id="ratePick" style="margin:8px 0 0">Tap a bar for that month.</p>
    </section>

    <section class="card">
      <h2>By month</h2>
      <ul class="list">${recent
        .map(
          (m) => `<li><div class="row"><div><div class="name">${monthName(m.month)}</div><div class="meta num">Saved ${eur(m.saved)} · income ${m.income ? eur(m.income) : "none"}</div></div><div class="right num ${tone(m.rate ?? 0)}">${m.rate === null ? "–" : pct(m.rate)}</div></div></li>`,
        )
        .join("")}</ul>
      <p class="small muted" style="margin:0;padding:10px 0 14px">Saved is what went into your accounts that month: deposits minus withdrawals (a move between two of your accounts cancels out) plus III pillar contributions. IBKR buys aren't added again, since they're paid from IBKR cash. Rent is left out: rent income and the Rent cash account. A "New total" deposit that only adds interest counts as saved too.</p>
    </section>

    ${incomeCard}
    ${incomeList}`;

  wireIncomeForm();
  wireIncomeList(root);
  const pick = (i) => {
    const m = s.months[i];
    $("#ratePick").innerHTML = `${monthName(m.month)}: <span class="num">${pct(m.rate)}</span>, saved <span class="num">${eur(m.saved)}</span> of <span class="num">${eur(m.income)}</span>`;
    root.querySelectorAll("#rateChart .bar").forEach((b) => b.classList.toggle("on", b.dataset.i === String(i)));
  };
  root.querySelectorAll("#rateChart .hit").forEach((h) => h.addEventListener("pointerdown", () => pick(Number(h.dataset.i))));
  root.querySelectorAll("#rateChart .hit").forEach((h) => h.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && pick(Number(h.dataset.i))));
}

const EDIT_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg>`;

/** Edit fills the form above with the entry; remove deletes its Income row after a check. */
function wireIncomeList(root) {
  const find = (row) => state.data.income.find((x) => x.row === Number(row));
  for (const b of root.querySelectorAll("[data-income-edit]")) {
    b.onclick = () => {
      const i = find(b.dataset.incomeEdit);
      if (!i) return;
      const form = $("#incomeForm");
      const select = form.elements.source;
      if (![...select.options].some((o) => o.value === i.source)) select.add(new Option(i.source, i.source), select.options.length - 1);
      select.value = i.source;
      form.elements.date.value = i.date;
      form.elements.amount.value = i.amount;
      form.elements.note.value = i.note;
      form.elements.editRow.value = i.row;
      $("#incomeTitle").textContent = "Edit income";
      $("#incomeSave").textContent = "Save changes";
      $("#incomeCancel").hidden = false;
      form.dispatchEvent(new Event("change"));
      $("#incomeCard").scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }
  for (const b of root.querySelectorAll("[data-income-del]")) {
    b.onclick = async () => {
      const i = find(b.dataset.incomeDel);
      if (!i) return;
      if (!confirm(`Remove ${i.source} of ${eurCents(i.amount)} on ${shortDate(i.date)}? This deletes row ${i.row} of the Income tab.`)) return;
      b.disabled = true;
      try {
        await checkIncomeRow(i);
        const meta = await freshMeta();
        await sheets.deleteRow(meta.tabs.Income, i.row);
        showBanner(`Removed ${esc(i.source.toLowerCase())} of ${eurCents(i.amount)}.`, "ok");
        await load({ quiet: true });
      } catch (err) {
        if (err instanceof AuthError) needSignIn();
        else showBanner(esc(err.message || String(err)), "error");
        b.disabled = false;
      }
    };
  }
}

/** Refuse to change an Income row that moved or changed since the app loaded it. */
async function checkIncomeRow(i) {
  const [grid] = await sheets.batchGet([INCOME_RANGE]);
  const now = parseIncome(grid).find((x) => x.row === i.row);
  if (!now || now.date !== i.date || now.source !== i.source || now.amount !== i.amount || now.note !== i.note) {
    throw new Error("The Income tab changed since the app loaded it. Refresh and try again.");
  }
}

const SOURCE_KEY = "pt.incomeSource";
const NEW_SOURCE = "__new";

/** The Add income form on the Savings tab: a new source shows a name field; the preview sums the month. */
function wireIncomeForm() {
  const form = $("#incomeForm");
  const sync = () => {
    const f = new FormData(form);
    form.querySelector('[data-for="newsource"]').hidden = f.get("source") !== NEW_SOURCE;
    const month = String(f.get("date") ?? "").slice(0, 7);
    const had = state.data.income.filter((x) => x.date.slice(0, 7) === month && x.source.toLowerCase() !== "rent" && x.row !== Number(f.get("editRow"))).reduce((sum, x) => sum + x.amount, 0);
    const amount = num(String(f.get("amount") ?? "").replace(",", "."));
    $("#incomePreview").textContent = /^\d{4}-\d{2}$/.test(month)
      ? `Counts toward ${monthName(month)}${had ? `, which has ${eurCents(had)} already` : ""}${amount ? `: ${eurCents(had + amount)} in total` : ""}.`
      : "";
  };
  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  sync();
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    saveIncome({ ...f, source: f.source === NEW_SOURCE ? f.newSource : f.source });
  };
  $("#incomeCancel").onclick = () => render();
}

/** Save an income row to the Income tab, making the tab first if the sheet has none. */
async function saveIncome(f) {
  const { row, errors } = incomeRow(f);
  $("#incomeErrors").innerHTML = errors.map((x) => `<li>${esc(x)}</li>`).join("");
  if (!row) return;
  const btn = $("#incomeSave");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const editing = state.data.income.find((x) => x.row === Number(f.editRow));
    if (editing) {
      await checkIncomeRow(editing);
      await sheets.write([{ range: `Income!A${editing.row}:D${editing.row}`, values: [row] }]);
      ls.set(SOURCE_KEY, row[1]);
      showBanner(`Updated ${esc(row[1].toLowerCase())}: ${eurCents(row[2])} on ${shortDate(row[0])}.`, "ok");
      await load({ quiet: true });
      return;
    }
    const meta = await freshMeta();
    let tab = meta.tabs.Income;
    let n;
    if (!tab) {
      tab = await sheets.addTab("Income");
      await sheets.write([{ range: "Income!A1:D1", values: [INCOME_HEADER] }]);
      n = 2;
    } else {
      const [grid] = await sheets.batchGet([INCOME_RANGE]);
      if (!grid.length) await sheets.write([{ range: "Income!A1:D1", values: [INCOME_HEADER] }]);
      n = nextFreeRow(grid.length ? grid : [INCOME_HEADER]);
    }
    await sheets.ensureRows(tab, n);
    await sheets.write([{ range: `Income!A${n}:D${n}`, values: [row] }]);
    ls.set(SOURCE_KEY, row[1]);
    showBanner(`Saved ${esc(row[1].toLowerCase())} of ${eurCents(row[2])} for ${monthName(row[0].slice(0, 7))}.`, "ok");
    await load({ quiet: true });
  } catch (err) {
    if (err instanceof AuthError) needSignIn();
    else showBanner(esc(err.message || String(err)), "error");
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------- add transaction ----------

const decimal = (v) => num(String(v ?? "").replace(",", "."));
const REPEAT_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.66-5.66L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.66 5.66L4 15.5M4 20v-4.5h4.5" /></svg>`;
const REMOVE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M7.5 12h9" /></svg>`;

function renderAdd(root) {
  const d = state.data;
  // Cash add/remove: the active cash accounts, plus cash held at IBKR.
  const cashAccounts = [
    ...d.accounts.filter((a) => a.active && a.assetClass === "Cash").map((a) => ({ value: a.name, label: a.name })),
    { value: BROKER, label: "IBKR cash" },
  ];
  const stocks = d.holdings.filter((h) => h.position === BROKER && h.symbol !== BROKER_CASH);
  const brokerCash = d.holdings.find((h) => h.position === BROKER && h.symbol === BROKER_CASH);
  const funds = d.holdings.filter((h) => h.position === PENSION);
  const options = d.holdings.find((h) => h.position === OPTIONS);
  const properties = d.accounts.filter((a) => a.active && a.assetClass === "Real estate");
  let last = {};
  try {
    last = JSON.parse(ls.get("pt.lastTx") ?? "{}") ?? {};
  } catch {}
  const start = txStart(last);
  const recent = d.transactions.slice(-10).reverse();
  const typeLabel = (t) => {
    const x = String(t ?? "").replace(/_/g, " ").toLowerCase();
    return x.charAt(0).toUpperCase() + x.slice(1);
  };
  const chips = (name, items, checked, label) =>
    `<div class="type-pick" role="radiogroup" aria-label="${label}" data-pick="${name}">${items
      .map(([v, l]) => `<label><input type="radio" name="${name}" value="${esc(v)}" ${v === checked ? "checked" : ""}><span>${esc(l)}</span></label>`)
      .join("")}</div>`;
  const property = properties.some((a) => a.name === last.property) ? last.property : properties[0]?.name;

  root.innerHTML = `
    <section class="card">
      <h2>What changed?</h2>
      <form id="tx" novalidate>
        ${chips("cls", TX_CLASSES.map((c) => [c.id, c.label]), start.cls, "Asset class")}
        <div data-for="estate">${
          properties.length
            ? chips("property", properties.map((a) => [a.name, a.name]), property, "Property")
            : `<p class="small">The sheet has no active Real estate accounts.</p>`
        }</div>
        ${TX_CLASSES.map((c) => `<div data-actions="${c.id}">${chips(`act_${c.id}`, c.actions, c.id === start.cls ? start.mode : c.actions[0][0], `${c.label} action`)}</div>`).join("")}
        <label class="field">Date<input type="date" name="date" value="${todayIso()}" required></label>
        <div class="two" data-for="trade">
          <label class="field">Account<span class="static">IBKR</span></label>
          <label class="field">Symbol<input name="symbol" list="symbols" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="e.g. VWCE.DE"></label>
          <datalist id="symbols">${stocks.map((h) => `<option value="${esc(h.symbol)}">${esc(h.name)}</option>`).join("")}</datalist>
          <label class="field">Units<input name="units" inputmode="decimal" autocomplete="off"></label>
          <label class="field">Price per unit (€)<input name="price" inputmode="decimal" autocomplete="off"></label>
        </div>
        <div class="two" data-for="cash">
          <label class="field">Account
            <select name="account">${cashAccounts.map((a) => `<option value="${esc(a.value)}" ${a.value === last.account ? "selected" : ""}>${esc(a.label)}</option>`).join("")}</select>
          </label>
          <div class="field" data-for="cashmode">How
            <div class="seg" role="radiogroup" aria-label="Add as">
              <label><input type="radio" name="cashMode" value="add" checked><span>Add amount</span></label>
              <label><input type="radio" name="cashMode" value="total"><span>New total</span></label>
            </div>
          </div>
          <label class="field"><span id="cashLabel">Amount (€)</span><input name="cash" inputmode="decimal" autocomplete="off"></label>
          <label class="field" data-for="interest">Interest, not new savings<input type="checkbox" name="interest" value="1" class="check"></label>
        </div>
        <div class="two" data-for="fund">
          <label class="field">Fund
            <select name="fund">${funds.map((h) => `<option value="${esc(h.symbol)}" ${h.symbol === last.fund ? "selected" : ""}>${esc(h.name || h.symbol)}</option>`).join("")}</select>
          </label>
        </div>
        <div class="two" data-for="newfund">
          <label class="field">Fund name<input name="fundName" autocomplete="off" placeholder="e.g. Artea Ambicingas Active 16+"></label>
          <label class="field">Units<input name="pensionUnits" inputmode="decimal" autocomplete="off"></label>
          <label class="field">Amount paid (€)<input name="pensionCash" inputmode="decimal" autocomplete="off"></label>
        </div>
        <div class="two" data-for="total">
          <label class="field">New total value (€)<input name="totalValue" inputmode="decimal" autocomplete="off"></label>
        </div>
        <div class="two" data-for="change">
          <label class="field"><span id="changeLabel">Increase by (€)</span><input name="change" inputmode="decimal" autocomplete="off"></label>
        </div>
        <label class="field">Note<input name="note" autocomplete="off"></label>
        <div class="preview" id="txPreview"></div>
        <ul class="errors" id="txErrors"></ul>
        <button class="btn" id="txSave">Save</button>
      </form>
    </section>
    ${
      recent.length
        ? `<section class="card"><h2>Recent</h2><ul class="list">${recent
            .map((t) => {
              const c = t.cells;
              const v = transactionValue(c);
              const repeat = repeatForm(c, todayIso())
                ? `<button class="rep-btn" data-row="${t.row}" aria-label="Repeat this transaction" title="Repeat">${REPEAT_SVG}</button>`
                : "";
              return `<li><div class="row"><div><div class="name">${esc(c[3] || c[1])}</div><div class="meta">${esc(typeLabel(c[2]))}${c[3] ? ` · ${esc(c[1])}` : ""} · ${
                serialToIso(c[0]) ? shortDate(serialToIso(c[0])) : "no date"
              }${c[4] ? ` · ${num(c[4])} units` : ""}</div></div><div class="right num">${Number.isFinite(v) ? eurCents(v) : "–"}</div>${repeat}<button class="del-btn" data-row="${t.row}" aria-label="Remove this transaction" title="Remove">${REMOVE_SVG}</button></div></li>`;
            })
            .join("")}</ul></section>`
        : ""
    }`;

  for (const b of root.querySelectorAll(".del-btn")) {
    b.onclick = async () => {
      const t = d.transactions.find((x) => x.row === Number(b.dataset.row));
      if (!t) return;
      const c = t.cells;
      const what = `${c[2]}${c[3] ? ` ${c[3]}` : ""} on ${c[1]}`;
      if (!confirm(`Remove ${what} from the sheet? This deletes row ${t.row} of the Transactions tab.`)) return;
      b.disabled = true;
      try {
        await deleteTransaction(t);
        showBanner(`Removed ${esc(what)}.`, "ok");
        await load({ quiet: true });
      } catch (err) {
        if (err instanceof AuthError) needSignIn();
        else showBanner(esc(err.message || String(err)), "error");
        b.disabled = false;
      }
    };
  }

  const form = $("#tx");
  const pick = (name, value) => {
    const el = form.querySelector(`input[name="${name}"][value="${CSS.escape(value)}"]`);
    if (el) el.checked = true;
  };
  for (const b of root.querySelectorAll(".rep-btn")) {
    b.onclick = () => {
      const t = d.transactions.find((x) => x.row === Number(b.dataset.row));
      const v = t && repeatForm(t.cells, todayIso());
      if (!v) return showBanner("This transaction can't be repeated from here.", "error");
      form.reset();
      const { cls, mode } = txStart({ type: v.type });
      pick("cls", cls);
      pick(`act_${cls}`, mode);
      for (const [k, val] of Object.entries(v)) {
        const el = form.elements[k];
        if (!el || k === "type") continue;
        if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === String(val))) continue;
        el.value = val;
      }
      sync();
      $("#txErrors").innerHTML = "";
      window.scrollTo({ top: 0, behavior: "smooth" });
      showBanner("Filled in from that transaction with today's date. Check it and tap Save.", "ok");
    };
  }

  const current = () => {
    const f = new FormData(form);
    const cls = f.get("cls");
    return { f, cls, mode: f.get(`act_${cls}`) };
  };
  const show = (key, on) => {
    for (const el of form.querySelectorAll(`[data-for="${key}"]`)) el.hidden = !on;
  };
  const unit = (x) => `${x.toLocaleString("en-IE", { maximumFractionDigits: 6 })} €`;
  const sync = () => {
    const { f, cls, mode } = current();
    for (const el of form.querySelectorAll("[data-actions]")) {
      // A class with one action needs no second row of chips.
      const c = TX_CLASSES.find((x) => x.id === el.dataset.actions);
      el.hidden = el.dataset.actions !== cls || c.actions.length < 2;
    }
    const trade = cls === "stocks";
    show("trade", trade);
    show("cash", cls === "cash");
    show("cashmode", mode === "DEPOSIT");
    show("interest", mode === "DEPOSIT");
    show("fund", mode === "PENSION_VALUE");
    show("newfund", mode === "PENSION_NEW");
    show("total", mode === "PENSION_VALUE" || mode === "OPTIONS_VALUE");
    show("estate", cls === "estate");
    show("change", cls === "estate");
    const toTotal = mode === "DEPOSIT" && f.get("cashMode") === "total";
    $("#cashLabel").textContent = toTotal ? "New total (€)" : "Amount (€)";
    $("#changeLabel").textContent = mode === "ESTATE_DOWN" ? "Decrease by (€)" : "Increase by (€)";
    let msg = "";
    if (trade) {
      const units = num(f.get("units"));
      const price = num(f.get("price"));
      const have = brokerCash?.value ?? 0;
      if (units && price) {
        const total = units * price;
        msg = `Total ${eurCents(total)}. ${mode === "BUY" ? `Paid from IBKR cash (${eurCents(have)} now, ${eurCents(have - total)} after).` : `Paid into IBKR cash (${eurCents(have + total)} after).`}`;
      }
    } else if (cls === "cash") {
      const acct = f.get("account");
      const now = acct === BROKER ? brokerCash?.value ?? 0 : d.accounts.find((a) => a.name === acct)?.value ?? 0;
      const amount = decimal(f.get("cash"));
      if (toTotal) {
        const move = amount === null ? null : moveToTotal(now, amount);
        msg = `Now ${eurCents(now)}.${amount === null ? "" : move ? ` Saves a ${move.type.toLowerCase()} of ${eurCents(move.amount)}.` : " No change."}`;
      } else {
        msg = `Now ${eurCents(now)}${amount ? `, ${eurCents(mode === "DEPOSIT" ? now + amount : now - amount)} after` : ""}.`;
      }
    } else if (mode === "PENSION_VALUE" || mode === "OPTIONS_VALUE") {
      const pos = mode === "OPTIONS_VALUE" ? options : funds.find((h) => h.symbol === f.get("fund"));
      const total = decimal(f.get("totalValue"));
      if (!pos) msg = mode === "OPTIONS_VALUE" ? "The sheet has no Vinted options position on the Holdings tab." : "No III pillar funds yet. Add a new fund first.";
      else {
        const price = unitPriceForTotal(total, pos.units);
        msg = `Now ${eurCents(pos.value ?? 0)}${
          price !== null ? `, ${eurCents(total)} after (${total >= pos.value ? "+" : "−"}${eurCents(Math.abs(total - pos.value))}). ${num(pos.units.toFixed(4))} units at ${unit(price)}.` : "."
        }`;
      }
    } else if (mode === "PENSION_NEW") {
      const units = num(f.get("pensionUnits"));
      const cash = num(f.get("pensionCash"));
      if (units && cash) msg = `Unit price ${unit(cash / units)}. It becomes the fund's latest price.`;
    } else if (cls === "estate") {
      const acct = properties.find((a) => a.name === f.get("property"));
      const amount = decimal(f.get("change"));
      if (acct) msg = `Now ${eurCents(acct.value)}${amount ? `, ${eurCents(changedValue(acct.value, amount, mode === "ESTATE_UP"))} after` : ""}.`;
    }
    $("#txPreview").textContent = msg;
  };
  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  sync();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const { cls, mode } = current();
    const f = Object.fromEntries(new FormData(form));
    // Interest grows the balance but isn't money saved: the note marks it for the savings rate.
    if (mode === "DEPOSIT" && f.interest) f.note = markInterest(f.note);
    if (mode === "OPTIONS_VALUE") return savePositionTotal(f, OPTIONS, options, "OPTIONS_VALUE");
    if (mode === "PENSION_VALUE") return savePositionTotal(f, PENSION, funds.find((h) => h.symbol === f.fund), "PENSION_VALUE");
    if (cls === "estate") return saveRealEstate(f, mode === "ESTATE_UP");
    if (mode === "DEPOSIT" && f.cashMode === "total") return saveNewTotal(f);
    const pension = mode === "PENSION_NEW";
    const input = pension ? { ...f, type: "PENSION", fund: f.fundName, units: f.pensionUnits, cash: f.pensionCash } : { ...f, type: mode };
    const { row, errors } = transactionRow(input);
    if (pension && !String(f.fundName ?? "").trim()) errors.unshift("Enter the fund's name.");
    $("#txErrors").innerHTML = errors.map((x) => `<li>${esc(x)}</li>`).join("");
    if (!row || errors.length) return;
    const btn = $("#txSave");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      let what;
      if (pension) {
        const fund = await savePension(row, String(f.fundName).trim());
        what = `${num(row[4])} units of ${esc(fund.name)}`;
        // Next time, open on the fund just made.
        ls.set("pt.lastTx", JSON.stringify({ mode: "PENSION_VALUE", fund: fund.symbol }));
      } else {
        await saveTransaction(row);
        what = `${esc(row[2].toLowerCase())}${row[3] && row[3] !== BROKER_CASH ? ` ${esc(row[3])}` : ""} on ${esc(row[1] === BROKER && row[3] === BROKER_CASH ? "IBKR cash" : row[1])}`;
        ls.set("pt.lastTx", JSON.stringify({ mode, account: f.account }));
      }
      showBanner(`Saved ${what}.`, "ok");
      await load({ quiet: true });
    } catch (err) {
      if (err instanceof AuthError) needSignIn();
      else showBanner(esc(err.message || String(err)), "error");
      btn.disabled = false;
      btn.textContent = "Save";
    }
  };
}

async function freshMeta() {
  state.meta = await sheets.meta();
  return state.meta;
}

async function saveTransaction(row) {
  // Re-read the column right before writing so two devices don't collide.
  const [grid] = await sheets.batchGet([RANGES.transactions]);
  const n = nextFreeRow(grid);
  const meta = await freshMeta();
  const tab = meta.tabs.Transactions;
  if (!tab) throw new Error("The sheet has no Transactions tab.");
  await sheets.ensureRows(tab, n);
  await sheets.write([{ range: `Transactions!A${n}:I${n}`, values: [row] }]);
}

/**
 * Save III pillar units. A new fund gets its own Holdings row first. The unit
 * price paid becomes the fund's latest price unless a newer one is already set.
 */
async function savePension(row, newFundName, unitValue = null) {
  const [holdings] = await sheets.batchGet([RANGES.holdings]);
  const meta = await freshMeta();
  const date = row[0];
  // A unit value typed in wins over the price worked out from the amount paid.
  const price = unitValue ?? row[5];
  let fund;
  if (newFundName) {
    const tab = meta.tabs.Holdings;
    if (!tab) throw new Error("The sheet has no Holdings tab.");
    const symbol = fundSymbol(newFundName, holdings.slice(1).map((r) => r?.[1] ?? ""));
    const r = nextHoldingsRow(holdings);
    await sheets.ensureRows(tab, r);
    const values = holdingsRow(r, { position: PENSION, symbol, name: newFundName, price, priceDate: date });
    await sheets.write([{ range: `Holdings!A${r}:M${r}`, values: [values] }]);
    fund = { symbol, name: newFundName };
  } else {
    const i = holdings.findIndex((r, k) => k > 0 && r?.[0] === PENSION && r?.[1] === row[3]);
    if (i < 0) throw new Error(`The fund ${row[3]} isn't on the Holdings tab any more. Refresh and try again.`);
    const r = i + 1;
    fund = { symbol: row[3], name: holdings[i][2] || row[3] };
    const known = serialToIso(holdings[i][7]);
    if (!known || date >= known) {
      await sheets.write([{ range: `Holdings!F${r}`, values: [[price]] }, { range: `Holdings!H${r}`, values: [[date]] }]);
    }
  }
  await saveTransaction([...row.slice(0, 3), fund.symbol, ...row.slice(4)]);
  return fund;
}

/**
 * Real estate: save the property's new value as a History snapshot dated on
 * the form's date (replacing one already saved for that day). The account's
 * value then starts from it.
 */
async function saveRealEstate(f, up) {
  const amount = num(String(f.change ?? "").replace(",", "."));
  const errors = [];
  if (!f.property) errors.push("The sheet has no active Real estate accounts.");
  if (amount === null || !(amount > 0)) errors.push(`Enter how much to ${up ? "increase" : "decrease"} the value by.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date ?? "")) errors.push("Pick a date.");
  if (f.date > todayIso()) errors.push("The date can't be in the future.");
  $("#txErrors").innerHTML = errors.map((x) => `<li>${esc(x)}</li>`).join("");
  if (errors.length) return;
  const btn = $("#txSave");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    // Re-read History so the row lands after whatever is there now, and the
    // account so the change is applied to its value as it is now.
    const [grid, accountsGrid] = await sheets.batchGet([RANGES.history, RANGES.accounts]);
    const acct = parseAccounts(accountsGrid).find((a) => a.name === f.property);
    if (!acct) throw new Error(`${f.property} isn't on the Accounts tab any more. Refresh and try again.`);
    const value = changedValue(acct.value, amount, up);
    if (value < 0) throw new Error(`${f.property} is ${eurCents(acct.value)}, so it can't go down by ${eurCents(amount)}.`);
    const note = String(f.note ?? "").trim() || "Set in the app";
    const plan = planSnapshot(f.date, [{ account: f.property, value, note }], parseHistory(grid), nextFreeRow(grid));
    const meta = await freshMeta();
    const tab = meta.tabs.History;
    if (!tab) throw new Error("The sheet has no History tab.");
    await sheets.ensureRows(tab, plan.lastRow);
    await sheets.write(plan.updates.map((u) => ({ range: `History!A${u.row}:D${u.row}`, values: [u.values] })));
    ls.set("pt.lastTx", JSON.stringify({ mode: up ? "ESTATE_UP" : "ESTATE_DOWN", property: f.property }));
    showBanner(`Saved ${esc(f.property)} at ${eurCents(value)} (${up ? "+" : "−"}${eurCents(amount)}).`, "ok");
    await load({ quiet: true });
  } catch (err) {
    if (err instanceof AuthError) needSignIn();
    else showBanner(esc(err.message || String(err)), "error");
    btn.disabled = false;
    btn.textContent = "Save";
  }
}

/**
 * III pillar fund or options: overwrite the position's total value. The units
 * stay as they are and the price per unit becomes total / units.
 */
async function savePositionTotal(f, position, pos, mode) {
  const total = num(String(f.totalValue ?? "").replace(",", "."));
  const errors = [];
  if (!pos) errors.push(position === OPTIONS ? "The sheet has no Vinted options position on the Holdings tab." : "Pick a fund.");
  if (total === null || total < 0) errors.push("Enter the new total value, 0 or more.");
  else if (pos && unitPriceForTotal(total, pos.units) === null) errors.push(`${esc(pos.name || pos.symbol)} has no units on the Holdings tab, so there's nothing to value.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date ?? "")) errors.push("Pick a date.");
  $("#txErrors").innerHTML = errors.map((x) => `<li>${esc(x)}</li>`).join("");
  if (errors.length) return;
  const btn = $("#txSave");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    // Re-read so the right Holdings row and the latest units are used even if rows moved.
    const [grid] = await sheets.batchGet([RANGES.holdings]);
    const fresh = parseHoldings(grid).find((h) => h.position === position && h.symbol === pos.symbol);
    if (!fresh) throw new Error(`${pos.name || pos.symbol} isn't on the Holdings tab any more. Refresh and try again.`);
    const price = unitPriceForTotal(total, fresh.units);
    if (price === null) throw new Error(`${pos.name || pos.symbol} has no units on the Holdings tab.`);
    await sheets.write([{ range: `Holdings!F${fresh.row}`, values: [[price]] }, { range: `Holdings!H${fresh.row}`, values: [[f.date]] }]);
    ls.set("pt.lastTx", JSON.stringify({ mode, fund: position === PENSION ? pos.symbol : undefined }));
    showBanner(`Saved ${esc(pos.name || pos.symbol)} at ${eurCents(total)}.`, "ok");
    await load({ quiet: true });
  } catch (err) {
    if (err instanceof AuthError) needSignIn();
    else showBanner(esc(err.message || String(err)), "error");
    btn.disabled = false;
    btn.textContent = "Save";
  }
}

/** Deposit form in "New total" mode: save the deposit or withdrawal that reaches the total. */
async function saveNewTotal(f) {
  const total = num(String(f.cash ?? "").replace(",", "."));
  const errors = [];
  if (total === null || total < 0) errors.push("Enter the new total, 0 or more.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date ?? "")) errors.push("Pick a date.");
  $("#txErrors").innerHTML = errors.map((x) => `<li>${esc(x)}</li>`).join("");
  if (errors.length) return;
  const btn = $("#txSave");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    // Re-read the balance so the difference is taken from the sheet as it is now.
    const [accountsGrid, holdingsGrid] = await sheets.batchGet([RANGES.accounts, RANGES.holdings]);
    const current =
      f.account === BROKER
        ? parseHoldings(holdingsGrid).find((h) => h.position === BROKER && h.symbol === BROKER_CASH)?.value ?? 0
        : parseAccounts(accountsGrid).find((a) => a.name === f.account)?.value ?? 0;
    const move = moveToTotal(current, total);
    const label = f.account === BROKER ? "IBKR cash" : f.account;
    if (!move) {
      showBanner(`${esc(label)} is already ${eurCents(total)}. Nothing saved.`, "ok");
    } else {
      const { row, errors: e2 } = transactionRow({ ...f, type: move.type, cash: move.amount });
      if (!row) throw new Error(e2.join(" "));
      await saveTransaction(row);
      showBanner(`Saved a ${move.type.toLowerCase()} of ${eurCents(move.amount)}: ${esc(label)} is now ${eurCents(total)}.`, "ok");
    }
    ls.set("pt.lastTx", JSON.stringify({ mode: "DEPOSIT", account: f.account }));
    await load({ quiet: true });
  } catch (err) {
    if (err instanceof AuthError) needSignIn();
    else showBanner(esc(err.message || String(err)), "error");
    btn.disabled = false;
    btn.textContent = "Save";
  }
}

async function deleteTransaction(t) {
  // Re-read first: if the row has changed or moved since the list was drawn
  // (another device edited the sheet), refuse rather than delete the wrong one.
  const [grid] = await sheets.batchGet([RANGES.transactions]);
  if (!sameTransaction(grid[t.row - 1], t.cells)) {
    throw new Error("The Transactions tab changed since the app loaded it. Refresh and try again.");
  }
  const meta = await freshMeta();
  const tab = meta.tabs.Transactions;
  if (!tab) throw new Error("The sheet has no Transactions tab.");
  await sheets.deleteRow(tab, t.row);
}

// ---------- privacy unlock (Face ID, with a PIN fallback) ----------
// A privacy screen against people looking over your shoulder, not real
// security: it gates the blur in this browser only. Face ID is used through
// WebAuthn: the phone checks your face and the app only asks "did it pass?".
const PASSKEY_KEY = "pt.passkey";
const PIN_KEY = "pt.pin";
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

async function faceIdAvailable() {
  try {
    return !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

async function pinHash(pin) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`portfolio-tracker:${pin}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Before the first blur: register Face ID, or choose a PIN where Face ID isn't available. */
async function setUpUnlock() {
  if (ls.get(PASSKEY_KEY) || ls.get(PIN_KEY)) return true;
  if (await faceIdAvailable()) {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: "Portfolio", id: location.hostname },
        user: { id: randomBytes(16), name: "portfolio-privacy", displayName: "Portfolio privacy screen" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
        timeout: 60000,
      },
    }).catch(() => null);
    if (!cred) return false;
    ls.set(PASSKEY_KEY, b64(cred.rawId));
    return true;
  }
  const pin = prompt("Face ID isn't available here. Choose a PIN to show the amounts again.");
  if (pin === null) return false;
  if (!/^\d{4,}$/.test(pin.trim())) throw new Error("Use at least 4 digits.");
  if (prompt("Enter the PIN again.") !== pin) throw new Error("The PINs didn't match. Nothing changed.");
  ls.set(PIN_KEY, await pinHash(pin.trim()));
  return true;
}

/** To unblur: Face ID (or the PIN). Returns true when it passed. */
async function unlock() {
  const id = ls.get(PASSKEY_KEY);
  if (id) {
    const ok = await navigator.credentials
      .get({
        publicKey: {
          challenge: randomBytes(32),
          rpId: location.hostname,
          allowCredentials: [{ type: "public-key", id: unb64(id) }],
          userVerification: "required",
          timeout: 60000,
        },
      })
      .then((c) => !!c && !!(new Uint8Array(c.response.authenticatorData)[32] & 0x04))
      .catch(() => false);
    if (!ok) alert("Face ID didn't pass. The amounts stay hidden. If it keeps failing, sign out and back in to reset it.");
    return ok;
  }
  const hash = ls.get(PIN_KEY);
  if (!hash) return true;
  const pin = prompt("Enter your PIN to show the amounts.");
  if (pin === null) return false;
  if ((await pinHash(pin.trim())) !== hash) {
    alert("Wrong PIN. If you forgot it, sign out and back in to reset it.");
    return false;
  }
  return true;
}

// ---------- boot ----------

function boot() {
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (b) go(b.dataset.view);
  });
  // Privacy: blur every amount on screen, remembered on this device.
  const setPrivacy = (on) => {
    document.documentElement.classList.toggle("privacy", on);
    const b = $("#privacy");
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? "Show amounts" : "Hide amounts");
    b.title = on ? "Show amounts" : "Hide amounts";
  };
  setPrivacy(ls.get("pt.privacy") === "1");
  $("#privacy").addEventListener("click", async () => {
    const on = !document.documentElement.classList.contains("privacy");
    try {
      if (on) {
        if (!(await setUpUnlock())) return;
      } else if (!(await unlock())) {
        return;
      }
    } catch (err) {
      return alert(err.message || String(err));
    }
    ls.set("pt.privacy", on ? "1" : "0");
    setPrivacy(on);
  });
  $("#refresh").addEventListener("click", () => (getToken() ? load() : signIn(clientId())));
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("online", () => getToken() && load({ quiet: true }));
  document.addEventListener("visibilitychange", () => {
    // Refresh when the app comes back to the foreground after a while.
    if (document.visibilityState === "visible" && state.loadedAt && Date.now() - state.loadedAt > 5 * 60 * 1000 && getToken()) load({ quiet: true });
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  const err = handleRedirect();
  if (!clientId()) return setupScreen();
  if (err) showBanner(esc(err), "error");

  const cached = loadCache();
  if (cached) render();
  if (getToken()) load({ quiet: !cached });
  else needSignIn();
}

boot();
