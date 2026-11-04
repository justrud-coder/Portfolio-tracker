import { CONFIG } from "../config.js";
import { AuthError, Sheets, getToken, handleRedirect, signIn, signOut } from "./google.js";
import {
  COUNTED_OPTIONS,
  TX_TYPES,
  countedValue,
  nextFreeRow,
  parseRetirement,
  retirementPlan,
  parseAccounts,
  parseHistory,
  parseHoldings,
  parseLists,
  parseMonthly,
  planSnapshot,
  summarize,
  transactionRow,
  transactionValue,
  num,
  serialToIso,
} from "./model.js";
import { esc, eur, eurCents, pct, shortDate, signedEur, signedPct, todayIso, tone } from "./format.js";
import { lineChart } from "./chart.js";

const RANGES = {
  accounts: "Accounts!A1:L300",
  holdings: "Holdings!A1:M300",
  monthly: "Monthly!A1:Z2000",
  lists: "Lists!A1:J60",
  history: "History!A1:D10000",
  transactions: "Transactions!A1:I10000",
};
// Read on its own so a sheet without a Retirement tab still loads.
const RETIREMENT_RANGE = "Retirement!A1:C40";
const CACHE_KEY = "pt.cache.v1";
const VIEW_KEY = "pt.view";
const RANGE_KEY = "pt.range";
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
    const [values, meta, retirement] = await Promise.all([
      sheets.batchGet(keys.map((k) => RANGES[k])),
      sheets.meta(),
      sheets.batchGet([RETIREMENT_RANGE]).then(
        ([g]) => g,
        (e) => {
          if (e instanceof AuthError) throw e;
          return [];
        },
      ),
    ]);
    const raw = Object.fromEntries(keys.map((k, i) => [k, values[i]]));
    raw.retirement = retirement;
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
  for (const b of $("#tabs").querySelectorAll("button")) {
    if (b.dataset.view === state.view) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  const views = { home: renderHome, retire: renderRetire, add: renderAdd, snapshot: renderSnapshot };
  const view = views[state.view] ? state.view : "home";
  const root = $("#view");
  views[view](root);
  // iOS large title, which collapses into the navigation bar on scroll.
  root.insertAdjacentHTML("afterbegin", `<h1 class="large-title">${TITLES[view]}</h1>`);
  $("#title").textContent = TITLES[view];
  onScroll();
}

const TITLES = { home: "Portfolio", retire: "Goals", add: "New Transaction", snapshot: "Snapshot" };

function onScroll() {
  $(".top").classList.toggle("scrolled", window.scrollY > 36);
}

// ---------- overview ----------

function changeLine(v, p) {
  return `<span class="${tone(v)} num">${signedEur(v)}</span> <span class="${tone(v)} num">(${signedPct(p)})</span>`;
}

function filterRange(points) {
  if (state.range === "all" || !points.length) return points;
  const years = state.range === "1y" ? 1 : 3;
  const end = new Date(points[points.length - 1].date);
  end.setUTCFullYear(end.getUTCFullYear() - years);
  const from = end.toISOString().slice(0, 10);
  return points.filter((p) => p.date >= from);
}

function renderHome(root) {
  const d = state.data;
  const s = summarize(d.accounts, d.monthly);
  const priceDates = d.holdings.filter((h) => h.source === "yahoo" && h.priceDate).map((h) => h.priceDate).sort();
  const pricesAt = priceDates[priceDates.length - 1];

  const points = d.monthly.map((m) => ({ date: m.date, value: m.total }));
  const today = todayIso();
  if (s.lastSnapshot && today > s.lastSnapshot.date) points.push({ date: today, value: s.total });

  const gainTile =
    s.gain === null
      ? `<div class="value muted">–</div><div class="sub muted">Add BUY transactions with prices to see this.</div>`
      : `<div class="value num ${tone(s.gain)}">${signedEur(s.gain)}</div>
         <div class="sub"><span class="${tone(s.gain)} num">${signedPct(s.gainPct)}</span> <span class="muted">on ${eur(s.invested)} invested</span></div>`;

  root.innerHTML = `
    <section class="card hero">
      <div class="label">Total value</div>
      <div class="value num">${eur(s.total)}</div>
      <div class="sub muted">${pricesAt ? `Prices from ${shortDate(pricesAt)}` : "Live prices and latest snapshot"}</div>
    </section>

    <section class="stats">
      <div class="card stat">
        <div class="label">Since last snapshot</div>
        <div class="value">${s.sinceSnapshot === null ? "–" : `<span class="${tone(s.sinceSnapshot)} num">${signedEur(s.sinceSnapshot)}</span>`}</div>
        <div class="sub">${s.lastSnapshot ? `<span class="${tone(s.sinceSnapshot)} num">${signedPct(s.sinceSnapshotPct)}</span> <span class="muted">since ${shortDate(s.lastSnapshot.date)}</span>` : ""}</div>
      </div>
      <div class="card stat">
        <div class="label">Last month</div>
        <div class="value">${s.lastMonth === null ? "–" : `<span class="${tone(s.lastMonth)} num">${signedEur(s.lastMonth)}</span>`}</div>
        <div class="sub">${s.prevSnapshot ? `<span class="${tone(s.lastMonth)} num">${signedPct(s.lastMonthPct)}</span> <span class="muted">to ${shortDate(s.lastSnapshot.date)}</span>` : ""}</div>
      </div>
      <div class="card stat wide">
        <div class="label">Gain vs cost</div>
        ${gainTile}
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>Value over time</h2>
        <div class="seg" role="group" aria-label="Time range">
          ${["1y", "3y", "all"].map((r) => `<button data-range="${r}" aria-pressed="${state.range === r}">${r === "all" ? "All" : r.toUpperCase()}</button>`).join("")}
        </div>
      </div>
      <div class="chart" id="chart"></div>
    </section>

    <section class="card">
      <h2>Allocation</h2>
      <div class="bars">${bars(s.allocation)}</div>
    </section>

    <section class="card">
      <h2>Liquidity</h2>
      <div class="bars">${bars(s.liquidity)}</div>
    </section>

    <section class="card">
      <h2>Accounts</h2>
      <ul class="list">${accountsList(d)}</ul>
    </section>

    <p class="footnote">${state.loadedAt ? `Loaded ${new Date(state.loadedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : ""}
    · <a href="#" id="signout">Sign out</a></p>
  `;

  const draw = () => lineChart($("#chart"), filterRange(points));
  draw();
  root.querySelectorAll("[data-range]").forEach((b) =>
    b.addEventListener("click", () => {
      state.range = b.dataset.range;
      ls.set(RANGE_KEY, state.range);
      root.querySelectorAll("[data-range]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      draw();
    }),
  );
  $("#signout").onclick = (e) => {
    e.preventDefault();
    signOut();
    ls.del(CACHE_KEY);
    state.data = null;
    needSignIn();
  };
}

function bars(items) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return items
    .map(
      (i) => `
    <div class="bar-row">
      <div class="bar-top"><span>${esc(i.name)}</span><span class="num">${eur(i.value)} · ${pct(i.share)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, (i.value / max) * 100).toFixed(1)}%"></div></div>
    </div>`,
    )
    .join("");
}

function accountsList(d) {
  return d.accounts
    .filter((a) => a.active)
    .sort((a, b) => b.value - a.value)
    .map((a) => {
      const holdings = d.holdings.filter((h) => h.position === a.name);
      const right = `<div class="right"><div class="num">${eur(a.value)}</div>${
        a.gain !== null ? `<div class="small ${tone(a.gain)} num">${signedEur(a.gain)} (${signedPct(a.gainPct)})</div>` : ""
      }</div>`;
      const meta = `${esc(a.assetClass)} · ${a.valuation === "holdings" ? "live prices" : a.lastSnapshot ? `as of ${shortDate(a.lastSnapshot)}` : "no snapshot"}`;
      const head = `<div><div class="name">${esc(a.name)}</div><div class="meta">${meta}</div></div>${right}`;
      if (!holdings.length) return `<li><div class="row">${head}</div></li>`;
      return `<li><details><summary class="row">${head}</summary><ul class="sublist">${holdings
        .map(
          (h) => `<li><div><div>${esc(h.symbol)}</div><div class="meta small muted">${num(h.units)?.toLocaleString("en-GB", { maximumFractionDigits: 4 })} × ${
            h.price === null ? "no price" : eurCents(h.price)
          }${h.priceDate ? ` · ${shortDate(h.priceDate)}` : ""}</div></div><div class="right"><div class="num">${eur(h.value)}</div>${
            h.gain !== null ? `<div class="small ${tone(h.gain)} num">${signedEur(h.gain)}</div>` : ""
          }</div></li>`,
        )
        .join("")}</ul></details></li>`;
    })
    .join("");
}

// ---------- retirement ----------

const RETIRE_FIELDS = [
  { key: "currentAge", label: "Current age", kind: "age" },
  { key: "retireAge", label: "Retire at age", kind: "age" },
  { key: "endAge", label: "Plan until age", kind: "age" },
  { key: "pensionAge", label: "Pension from age", kind: "age" },
  { key: "spend", label: "Spend (€/month)", kind: "eur" },
  { key: "pension", label: "Pension (€/month)", kind: "eur" },
  { key: "monthly", label: "Investing (€/month)", kind: "eur" },
  { key: "returnPre", label: "Real return before (%)", kind: "pct" },
  { key: "returnPost", label: "Real return after (%)", kind: "pct" },
  { key: "inflation", label: "Inflation (%)", kind: "pct" },
];

const STATUS_TONE = { Ahead: "up", "On track": "up", Behind: "down" };

function retireSummary(v, plan) {
  const t = STATUS_TONE[plan.status];
  const pace =
    plan.earliestAge === null
      ? `At this pace the portfolio doesn't reach ${eur(v.spend)}/month before ${v.endAge}.`
      : plan.earliestAge <= v.retireAge
        ? `At this pace you could retire at <strong>${plan.earliestAge}</strong>.`
        : `At this pace you reach ${eur(v.spend)}/month at age <strong>${plan.earliestAge}</strong>.`;
  return `
    <section class="card hero">
      <div class="label">Retire at ${esc(v.retireAge)} on ${eur(v.spend)}/month</div>
      <div class="value ${t}">${esc(plan.status)}</div>
      <div class="sub">Need <span class="num">${eur(plan.needed)}</span> at ${esc(v.retireAge)}. Investing ${eur(v.monthly)}/month gets you to <span class="num">${eur(plan.projected)}</span>.</div>
      <div class="progress" role="progressbar" aria-label="Projected vs needed" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(1, plan.progress) * 100)}"><div style="width:${(Math.max(0, Math.min(1, plan.progress)) * 100).toFixed(1)}%"></div></div>
      <div class="sub muted">${pct(plan.progress)} of the target at ${esc(v.retireAge)}</div>
    </section>

    <section class="stats">
      <div class="card stat">
        <div class="label">Invest per month</div>
        <div class="value num">${plan.perMonth === null ? "–" : eur(plan.perMonth)}</div>
        <div class="sub muted">from now to ${esc(v.retireAge)} to hit the target</div>
      </div>
      <div class="card stat">
        <div class="label">If you retired today</div>
        <div class="value num">${eur(plan.todaySpend)}<span class="small muted">/mo</span></div>
        <div class="sub muted">from ${eur(plan.counted)} until ${esc(v.endAge)}</div>
      </div>
      <div class="card stat wide">
        <div class="label">At your current pace</div>
        <div class="value num">${eur(plan.supportedSpend)}<span class="small muted">/mo at ${esc(v.retireAge)}</span></div>
        <div class="sub muted">${pace}</div>
      </div>
    </section>

    <section class="card goal">
      <h2>The numbers</h2>
      <dl class="figs">
        <div><dt>Needed at ${esc(v.retireAge)}</dt><dd class="num">${eur(plan.needed)}</dd></div>
        <div><dt>Same, in ${new Date().getFullYear() + plan.years} euros</dt><dd class="num">${eur(plan.neededFuture)}</dd></div>
        <div><dt>Counted now (${esc(v.counted.toLowerCase())})</dt><dd class="num">${eur(plan.counted)}</dd></div>
        <div><dt>At ${esc(v.retireAge)} with no new money</dt><dd class="num">${eur(plan.noNewMoney)}</dd></div>
      </dl>
      <p class="small muted" style="margin:6px 0 0">All amounts are in today's money: raise the monthly investment with inflation each year. Spending runs from ${esc(v.retireAge)} to ${esc(v.endAge)} and uses the portfolio up; the pension covers ${eur(v.pension)} of it from ${esc(v.pensionAge)}. Taxes aren't included.</p>
    </section>`;
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
    <div id="retireSummary"></div>
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
        <button class="btn" id="retireSave">Save to sheet</button>
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
  const sync = () => {
    const { v, errors } = read();
    if (!errors.length) $("#retireSummary").innerHTML = retireSummary(v, retirementPlan(v, countedValue(d.accounts, v.counted)));
    $("#retireErrors").innerHTML = errors.map((x) => `<li>${esc(x)}</li>`).join("");
    return { v, errors };
  };
  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
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
      btn.textContent = "Save to sheet";
    }
  };
}

// ---------- add transaction ----------

function renderAdd(root) {
  const d = state.data;
  const accounts = d.accounts.filter((a) => a.active).map((a) => a.name);
  const types = d.lists["Transaction type"]?.length ? d.lists["Transaction type"] : TX_TYPES;
  const last = JSON.parse(ls.get("pt.lastTx") ?? "{}");
  const recent = d.transactions.slice(-8).reverse();

  root.innerHTML = `
    <section class="card">
      <h2>Add a transaction</h2>
      <form id="tx" novalidate>
        <div class="type-pick" role="radiogroup" aria-label="Type">
          ${types.map((t) => `<label><input type="radio" name="type" value="${esc(t)}" ${t === (last.type || "BUY") ? "checked" : ""}><span>${esc(t[0] + t.slice(1).toLowerCase())}</span></label>`).join("")}
        </div>
        <div class="two">
          <label class="field">Date<input type="date" name="date" value="${todayIso()}" required></label>
          <label class="field">Account
            <select name="account">${accounts.map((a) => `<option ${a === last.account ? "selected" : ""}>${esc(a)}</option>`).join("")}</select>
          </label>
        </div>
        <label class="field" data-for="symbol">Symbol<input name="symbol" list="symbols" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="e.g. VWCE.DE"></label>
        <datalist id="symbols"></datalist>
        <div class="two" data-for="trade">
          <label class="field">Units<input name="units" inputmode="decimal" autocomplete="off"></label>
          <label class="field">Price per unit (€)<input name="price" inputmode="decimal" autocomplete="off"></label>
        </div>
        <label class="field" data-for="cash">Amount (€)<input name="cash" inputmode="decimal" autocomplete="off"></label>
        <label class="field">Fees (€)<input name="fees" inputmode="decimal" autocomplete="off" placeholder="0"></label>
        <label class="field">Note<input name="note" autocomplete="off"></label>
        <div class="preview" id="txPreview"></div>
        <ul class="errors" id="txErrors"></ul>
        <button class="btn" id="txSave">Save transaction</button>
      </form>
    </section>
    ${
      recent.length
        ? `<section class="card"><h2>Recent</h2><ul class="list">${recent
            .map((t) => {
              const c = t.cells;
              const v = transactionValue(c);
              return `<li><div class="row"><div><div class="name">${esc(c[2])} ${esc(c[3] || "")}</div><div class="meta">${esc(c[1])} · ${
                serialToIso(c[0]) ? shortDate(serialToIso(c[0])) : "no date"
              }${c[4] ? ` · ${num(c[4])} units` : ""}</div></div><div class="right num">${Number.isFinite(v) ? eurCents(v) : "–"}</div></div></li>`;
            })
            .join("")}</ul></section>`
        : ""
    }`;

  const form = $("#tx");
  const sync = () => {
    const f = new FormData(form);
    const type = f.get("type");
    const trade = type === "BUY" || type === "SELL";
    form.querySelector('[data-for="trade"]').hidden = !trade;
    form.querySelector('[data-for="cash"]').hidden = trade;
    form.querySelector('[data-for="symbol"]').hidden = !(trade || type === "DIVIDEND");
    const symbols = [...new Set(d.holdings.filter((h) => h.position === f.get("account")).map((h) => h.symbol))];
    $("#symbols").innerHTML = symbols.map((s) => `<option value="${esc(s)}">`).join("");
    const units = num(f.get("units"));
    const price = num(f.get("price"));
    const fees = num(f.get("fees")) ?? 0;
    $("#txPreview").textContent =
      trade && units && price ? `Total ${eurCents(type === "BUY" ? units * price + fees : units * price - fees)}` : "";
  };
  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  sync();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const { row, errors } = transactionRow(f);
    $("#txErrors").innerHTML = errors.map((x) => `<li>${esc(x)}</li>`).join("");
    if (!row) return;
    const btn = $("#txSave");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      await saveTransaction(row);
      ls.set("pt.lastTx", JSON.stringify({ type: f.type, account: f.account }));
      showBanner(`Saved ${esc(row[2].toLowerCase())}${row[3] ? ` ${esc(row[3])}` : ""} on ${esc(row[1])}.`, "ok");
      await load({ quiet: true });
    } catch (err) {
      if (err instanceof AuthError) needSignIn();
      else showBanner(esc(err.message || String(err)), "error");
      btn.disabled = false;
      btn.textContent = "Save transaction";
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

// ---------- monthly snapshot ----------

function renderSnapshot(root) {
  const d = state.data;
  const accounts = d.accounts.filter((a) => a.active);
  const lastDate = d.monthly[d.monthly.length - 1]?.date ?? "";

  root.innerHTML = `
    <section class="card">
      <h2>Monthly snapshot</h2>
      <p class="small muted" style="margin-top:-4px">Saves one value per account to the History tab. Accounts priced from holdings are filled in with today's live value. ${
        lastDate ? `Last snapshot: ${shortDate(lastDate)}.` : ""
      }</p>
      <form id="snap" novalidate>
        <label class="field">Date<input type="date" name="date" value="${todayIso()}" required></label>
        <div id="snapRows">
          ${accounts
            .map(
              (a, i) => `
            <div class="snap-row">
              <div><div>${esc(a.name)}</div><div class="meta">${
                a.valuation === "holdings" ? "Live value from prices" : a.lastSnapshot ? `Last: ${eur(a.value)} on ${shortDate(a.lastSnapshot)}` : "No earlier value"
              }</div></div>
              <input name="v${i}" inputmode="decimal" autocomplete="off" value="${Math.round(a.value * 100) / 100}" aria-label="${esc(a.name)} value in euros">
            </div>`,
            )
            .join("")}
        </div>
        <div class="total-line"><span>Total</span><span class="num" id="snapTotal"></span></div>
        <div class="preview" id="snapPreview"></div>
        <ul class="errors" id="snapErrors"></ul>
        <button class="btn" id="snapSave">Save snapshot</button>
      </form>
    </section>`;

  const form = $("#snap");
  const read = () => {
    const f = new FormData(form);
    const values = [];
    const errors = [];
    accounts.forEach((a, i) => {
      const raw = String(f.get(`v${i}`) ?? "").trim();
      if (raw === "") return;
      const v = num(raw.replace(",", "."));
      if (v === null) errors.push(`${a.name}: "${raw}" isn't a number.`);
      else values.push({ account: a.name, value: v });
    });
    return { date: f.get("date"), values, errors };
  };
  const sync = () => {
    const { date, values } = read();
    const total = values.reduce((s, v) => s + v.value, 0);
    $("#snapTotal").textContent = eur(total);
    const prev = d.monthly.filter((m) => m.date < date).pop();
    const same = d.monthly.find((m) => m.date === date);
    let msg = "";
    if (prev) msg = `${signedEur(total - prev.total)} (${signedPct(prev.total ? (total - prev.total) / prev.total : null)}) vs ${shortDate(prev.date)}.`;
    if (same) msg += ` A snapshot for ${shortDate(date)} exists and will be overwritten.`;
    $("#snapPreview").innerHTML = msg.replace(/^([+−][^ ]+)/, (m) => `<span class="${m.startsWith("+") ? "up" : "down"}">${m}</span>`);
  };
  form.addEventListener("input", sync);
  sync();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const { date, values, errors } = read();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("Pick a date.");
    if (!values.length) errors.push("Enter at least one value.");
    $("#snapErrors").innerHTML = errors.map((x) => `<li>${esc(x)}</li>`).join("");
    if (errors.length) return;
    if (lastDate && date < lastDate && !confirm(`${shortDate(date)} is before the last snapshot (${shortDate(lastDate)}). Save anyway?`)) return;
    const btn = $("#snapSave");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const plan = await saveSnapshot(date, values);
      showBanner(`Saved snapshot for ${shortDate(date)}: ${plan.updates.length} accounts${plan.appended < plan.updates.length ? `, ${plan.updates.length - plan.appended} overwritten` : ""}.`, "ok");
      await load({ quiet: true });
    } catch (err) {
      if (err instanceof AuthError) needSignIn();
      else showBanner(esc(err.message || String(err)), "error");
      btn.disabled = false;
      btn.textContent = "Save snapshot";
    }
  };
}

async function saveSnapshot(date, values) {
  const [grid] = await sheets.batchGet([RANGES.history]);
  const history = parseHistory(grid);
  const plan = planSnapshot(date, values, history, nextFreeRow(grid));
  const meta = await freshMeta();
  const tab = meta.tabs.History;
  if (!tab) throw new Error("The sheet has no History tab.");
  await sheets.ensureRows(tab, plan.lastRow);
  await sheets.write(plan.updates.map((u) => ({ range: `History!A${u.row}:D${u.row}`, values: [u.values] })));
  return plan;
}

// ---------- boot ----------

function boot() {
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (b) go(b.dataset.view);
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
