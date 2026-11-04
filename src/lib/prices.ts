export interface Quote {
  symbol: string;
  /** Price converted to EUR */
  priceEur: number;
  /** Price in the listing currency */
  price: number;
  currency: string;
  /** ISO date of the quote */
  date: string;
}

type Fetcher = typeof fetch;

const UA = "Mozilla/5.0 (compatible; portfolio-tracker/1.0)";

interface ChartMeta {
  regularMarketPrice?: number;
  currency?: string;
  regularMarketTime?: number;
}

async function chartMeta(symbol: string, fetcher: Fetcher): Promise<ChartMeta> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const res = await fetcher(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`Yahoo returned ${res.status} for ${symbol}`);
  const json = (await res.json()) as { chart?: { result?: { meta: ChartMeta }[]; error?: { description?: string } } };
  const meta = json.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") {
    throw new Error(json.chart?.error?.description ?? `No price for ${symbol}`);
  }
  return meta;
}

/** Units of `currency` per 1 EUR. */
async function eurRate(currency: string, fetcher: Fetcher): Promise<number> {
  if (currency === "EUR") return 1;
  const meta = await chartMeta(`EUR${currency}=X`, fetcher);
  return meta.regularMarketPrice!;
}

/**
 * Fallback for Xetra listings (symbols ending in .DE): Stooq's CSV quote, already in EUR.
 * Format: Symbol,Date,Time,Close
 */
export async function fetchStooqQuote(symbol: string, fetcher: Fetcher = fetch): Promise<Quote> {
  if (!/\.DE$/i.test(symbol)) throw new Error(`No fallback source for ${symbol}`);
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol.toLowerCase())}&f=sd2t2c&h&e=csv`;
  const res = await fetcher(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`Stooq returned ${res.status} for ${symbol}`);
  const lines = (await res.text()).trim().split(/\r?\n/);
  const [, date, , close] = (lines[1] ?? "").split(",");
  const price = Number(close);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !Number.isFinite(price) || price <= 0) {
    throw new Error(`Stooq has no price for ${symbol}`);
  }
  return { symbol, price, currency: "EUR", priceEur: price, date };
}

/** Yahoo first, then Stooq for Xetra listings. */
export async function fetchQuoteWithFallback(symbol: string, fetcher: Fetcher = fetch): Promise<Quote> {
  try {
    return await fetchQuote(symbol, fetcher);
  } catch (yahooError) {
    try {
      return await fetchStooqQuote(symbol, fetcher);
    } catch {
      throw yahooError;
    }
  }
}

/** Fetch the latest price for a Yahoo Finance symbol (e.g. VWCE.DE) and convert it to EUR. */
export async function fetchQuote(symbol: string, fetcher: Fetcher = fetch): Promise<Quote> {
  const meta = await chartMeta(symbol, fetcher);
  let price = meta.regularMarketPrice!;
  let currency = (meta.currency ?? "EUR").trim();
  // London listings quote in pence
  if (currency === "GBp" || currency === "GBX") {
    price = price / 100;
    currency = "GBP";
  }
  const rate = await eurRate(currency.toUpperCase(), fetcher);
  const date = meta.regularMarketTime
    ? new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return { symbol, price, currency, priceEur: price / rate, date };
}

export async function fetchQuotes(symbols: string[], fetcher: Fetcher = fetch) {
  const results = await Promise.allSettled(symbols.map((s) => fetchQuoteWithFallback(s, fetcher)));
  const quotes: Record<string, Quote> = {};
  const errors: Record<string, string> = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") quotes[symbols[i]] = r.value;
    else errors[symbols[i]] = r.reason instanceof Error ? r.reason.message : String(r.reason);
  });
  return { quotes, errors };
}
