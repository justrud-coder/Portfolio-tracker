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

export async function fetchQuote(symbol, fetcher = fetch) {
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

export async function fetchQuotes(symbols, fetcher = fetch) {
  const results = await Promise.allSettled(symbols.map((s) => fetchQuote(s, fetcher)));
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
 * "yahoo" holding that got a quote. Columns are found by header, so moving
 * them in the sheet doesn't break the action.
 */
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
    if (source !== "yahoo" || !q) continue;
    out.push({ range: `${tab}!${letter(c.price)}${r + 1}`, values: [[Math.round(q.priceEur * 10000) / 10000]] });
    out.push({ range: `${tab}!${letter(c.date)}${r + 1}`, values: [[q.date]] });
  }
  return out;
}
