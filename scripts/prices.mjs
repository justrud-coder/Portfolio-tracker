// Web price lookups: Yahoo Finance first, Stooq as a fallback for Xetra (.DE) symbols.
// Prices are converted to EUR.

const UA = "Mozilla/5.0 (compatible; portfolio-tracker/1.0)";

async function chartMeta(symbol, fetcher) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const res = await fetcher(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Yahoo returned ${res.status} for ${symbol}`);
  const json = await res.json();
  const meta = json.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") {
    throw new Error(json.chart?.error?.description ?? `No price for ${symbol}`);
  }
  return meta;
}

/** Units of `currency` per 1 EUR. */
async function eurRate(currency, fetcher) {
  if (currency === "EUR") return 1;
  return (await chartMeta(`EUR${currency}=X`, fetcher)).regularMarketPrice;
}

export async function fetchYahooQuote(symbol, fetcher = fetch) {
  const meta = await chartMeta(symbol, fetcher);
  let price = meta.regularMarketPrice;
  let currency = (meta.currency ?? "EUR").trim();
  if (currency === "GBp" || currency === "GBX") {
    // London listings quote in pence
    price /= 100;
    currency = "GBP";
  }
  const rate = await eurRate(currency.toUpperCase(), fetcher);
  const date = new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString().slice(0, 10);
  return { symbol, price, currency, priceEur: price / rate, date };
}

/** Stooq CSV quote for Xetra listings, already in EUR. Format: Symbol,Date,Time,Close */
export async function fetchStooqQuote(symbol, fetcher = fetch) {
  if (!/\.DE$/i.test(symbol)) throw new Error(`No fallback source for ${symbol}`);
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol.toLowerCase())}&f=sd2t2c&h&e=csv`;
  const res = await fetcher(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Stooq returned ${res.status} for ${symbol}`);
  const [, line = ""] = (await res.text()).trim().split(/\r?\n/);
  const [, date, , close] = line.split(",");
  const price = Number(close);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !Number.isFinite(price) || price <= 0) {
    throw new Error(`Stooq has no price for ${symbol}`);
  }
  return { symbol, price, currency: "EUR", priceEur: price, date };
}

export async function fetchQuote(symbol, fetcher = fetch, source = "yahoo") {
  if (source === "artea") return fetchArteaQuote(symbol, fetcher);
  try {
    return await fetchYahooQuote(symbol, fetcher);
  } catch (yahooError) {
    try {
      return await fetchStooqQuote(symbol, fetcher);
    } catch {
      throw yahooError;
    }
  }
}

// ---------- Artea pension funds ----------

/** Fund pages on artea.lt, by the symbol used on the Holdings tab. */
export const ARTEA_PAGES = {
  "ARTEA-AA16": "https://www.artea.lt/lt/privatiems/pensija/iii-pakopos-pensija/artea-ambicingas-active-16",
};

/** Visible text of an HTML page, with tags dropped and whitespace collapsed. */
export function pageText(html) {
  return html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const toIso = (d) => {
  const m = d.match(/^(\d{4})[-.](\d{2})[-.](\d{2})$/) ?? d.match(/^(\d{2})[-.](\d{2})[-.](\d{4})$/);
  if (!m) return null;
  return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`;
};

/**
 * Unit value (vieneto vertė) and its date from an Artea fund page.
 * Returns null when the page doesn't show one.
 */
export function parseArteaPage(html) {
  const text = pageText(html);
  const label = /(vieneto\s+vert[eė]|VAV)/gi;
  for (let m; (m = label.exec(text)); ) {
    const after = text.slice(m.index, m.index + 160);
    const num = after.match(/(?<![\d.,])(\d{1,3}[.,]\d{3,6})(?![\d.,])/);
    if (!num) continue;
    const price = Number(num[1].replace(",", "."));
    if (!Number.isFinite(price) || price <= 0) continue;
    const near = text.slice(Math.max(0, m.index - 120), m.index + 200);
    const dm = near.match(/\b(\d{4}[-.]\d{2}[-.]\d{2}|\d{2}[-.]\d{2}[-.]\d{4})\b/);
    return { price, date: dm ? toIso(dm[1]) : null };
  }
  return null;
}

/** What the page looks like when no price was found, for the job log. */
function arteaClues(html) {
  const text = pageText(html);
  const clues = [];
  for (const m of text.matchAll(/vert|VAV|EUR/gi)) {
    clues.push(text.slice(Math.max(0, m.index - 60), m.index + 100));
    if (clues.length >= 5) break;
  }
  const urls = [...new Set(html.match(/https?:[^"'\s<>]+?(?:api|json|xlsx?|csv|graph|chart)[^"'\s<>]*/gi) ?? [])].slice(0, 10);
  return `${html.length} bytes, ${text.length} chars of text.\nText near keywords:\n  ${clues.join("\n  ") || "(none)"}\nData URLs:\n  ${urls.join("\n  ") || "(none)"}`;
}

export async function fetchArteaQuote(symbol, fetcher = fetch) {
  const url = ARTEA_PAGES[symbol];
  if (!url) throw new Error(`No artea.lt page known for ${symbol}`);
  const res = await fetcher(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", "Accept-Language": "lt,en;q=0.8" } });
  if (!res.ok) throw new Error(`artea.lt returned ${res.status} for ${symbol}`);
  const html = await res.text();
  const found = parseArteaPage(html);
  if (!found) throw new Error(`No unit value found on the ${symbol} page. ${arteaClues(html)}`);
  const date = found.date ?? new Date().toISOString().slice(0, 10);
  return { symbol, price: found.price, currency: "EUR", priceEur: found.price, date };
}

export async function fetchQuotes(symbols, fetcher = fetch) {
  // `symbols` is a list of symbols (Yahoo) or of [symbol, source] pairs.
  const list = symbols.map((s) => (Array.isArray(s) ? s : [s, "yahoo"]));
  const results = await Promise.allSettled(list.map(([s, src]) => fetchQuote(s, fetcher, src)));
  symbols = list.map(([s]) => s);
  const quotes = {};
  const errors = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") quotes[symbols[i]] = r.value;
    else errors[symbols[i]] = r.reason instanceof Error ? r.reason.message : String(r.reason);
  });
  return { quotes, errors };
}

/**
 * Cell writes for the Holdings tab: Last price and Price date for every
 * "yahoo" or "artea" holding that got a quote. Columns are found by header, so moving
 * them in the sheet doesn't break the action.
 */
/** Holdings price sources the price job updates. */
export const PRICED_SOURCES = ["yahoo", "artea"];

/**
 * A fetched price that moved more than this against the sheet's last price
 * is treated as a misread page and not written.
 */
export function plausible(previous, price, maxRatio = 1.5) {
  const p = Number(previous);
  if (!Number.isFinite(p) || p <= 0) return true;
  return price / p <= maxRatio && p / price <= maxRatio;
}

export function priceUpdates(grid, quotes, tab = "Holdings") {
  const header = (grid[0] ?? []).map((h) => String(h ?? "").trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const c = { symbol: col("symbol"), source: col("price source"), price: col("last price"), date: col("price date") };
  for (const [k, v] of Object.entries(c)) if (v < 0) throw new Error(`Holdings tab has no "${k}" column`);
  const letter = (i) => {
    let n = i + 1;
    let s = "";
    while (n > 0) {
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };
  const out = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const symbol = String(row[c.symbol] ?? "").trim();
    const source = String(row[c.source] ?? "").trim().toLowerCase();
    const q = quotes[symbol];
    if (!PRICED_SOURCES.includes(source) || !q) continue;
    out.push({ range: `${tab}!${letter(c.price)}${r + 1}`, values: [[Math.round(q.priceEur * 10000) / 10000]] });
    out.push({ range: `${tab}!${letter(c.date)}${r + 1}`, values: [[q.date]] });
  }
  return out;
}
