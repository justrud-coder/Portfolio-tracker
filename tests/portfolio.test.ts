import { describe, expect, it } from "vitest";
import { colIndex, colLetter, referencesColumn, shiftFormulaColumn } from "@/lib/columns";
import { parsePortfolio, parseHeaderDate, toNumber } from "@/lib/portfolio";
import { planSnapshot } from "@/lib/snapshot";
import { buildDashboard } from "@/lib/stats";
import { fetchQuote } from "@/lib/prices";
import { parseHoldings } from "@/lib/holdings";
import { formulas, values } from "./fixture";

describe("columns", () => {
  it("converts letters and indexes", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(25)).toBe("Z");
    expect(colLetter(26)).toBe("AA");
    expect(colLetter(56)).toBe("BE");
    expect(colLetter(57)).toBe("BF");
    expect(colIndex("BE")).toBe(56);
  });

  it("shifts only relative references to the given column", () => {
    expect(shiftFormulaColumn("=SUM(BE2:BE14)", "BE", "BF")).toBe("=SUM(BF2:BF14)");
    expect(shiftFormulaColumn("=BE3+BE4+BD3", "BE", "BF")).toBe("=BF3+BF4+BD3");
    expect(shiftFormulaColumn("=C23/$C$28", "C", "D")).toBe("=D23/$C$28");
    expect(shiftFormulaColumn("=$BE2+BE2", "BE", "BF")).toBe("=$BE2+BF2");
    expect(shiftFormulaColumn('="BE2"&BE2', "BE", "BF")).toBe('="BE2"&BF2');
    expect(shiftFormulaColumn("=Sheet1!BE2", "BE", "BF")).toBe("=Sheet1!BE2");
    expect(referencesColumn("=AQ3", "BE")).toBe(false);
  });
});

describe("parsePortfolio", () => {
  const p = parsePortfolio(values);

  it("reads snapshots, positions and summary rows", () => {
    expect(p.snapshots).toEqual([
      { col: 3, date: "2026-09-05" },
      { col: 4, date: "2026-10-05" },
    ]);
    expect(p.positions.map((x) => x.name)).toEqual([
      "III pillar", "Crypto", "Cash", "Savings account", "NT Titnago", "II pillar", "IBKR", "Vinted options", "Indeliai EUR",
    ]);
    expect(p.summary.map((s) => s.name)).toEqual(["Viso", "Liquid"]);
    expect(p.summaryEndRow).toBe(11);
    expect(p.totals[1]).toBe(230067);
  });

  it("maps groups", () => {
    const g = Object.fromEntries(p.positions.map((x) => [x.name, x.group]));
    expect(g["Vinted options"]).toBe("Options");
    expect(g["Savings account"]).toBe("Cash");
    expect(g["NT Titnago"]).toBe("Real estate");
    expect(g["IBKR"]).toBe("Stocks & funds");
  });

  it("parses numbers and headers", () => {
    expect(toNumber("7,920")).toBe(7920);
    expect(toNumber("")).toBeNull();
    expect(parseHeaderDate("Verte\n2022.02.07")).toBe("2022-02-07");
  });
});

describe("planSnapshot", () => {
  const p = parsePortfolio(values);
  const input = { date: "2026-11-05", values: { "III pillar": 13198.13, IBKR: 47000, Cash: 3600, Crypto: 0, "II pillar": null } };

  it("adds a new column with values and shifted summary formulas", () => {
    const plan = planSnapshot("Sheet1", p, formulas, 5, input);
    expect(plan.isNew).toBe(true);
    expect(plan.col).toBe(5);
    expect(plan.needsExtraColumn).toBe(true);
    expect(plan.copyFormatFrom).toBe(4);
    const byRange = Object.fromEntries(plan.updates.map((u) => [u.range, u.values[0][0]]));
    expect(byRange["Sheet1!F1"]).toBe("Verte\n2026.11.05");
    expect(byRange["Sheet1!F2"]).toBe(13198.13);
    expect(byRange["Sheet1!F8"]).toBe(47000);
    expect(byRange["Sheet1!F7"]).toBe("");
    expect(byRange["Sheet1!F11"]).toBe("=SUM(F2:F10)");
    expect(byRange["Sheet1!F12"]).toBe("=F2+F4+F5+F8+F10");
    // Split table now points at the new column, absolute refs untouched
    expect(byRange["Sheet1!C15"]).toBe("=F2+F8+$E$9");
    expect(byRange["Sheet1!C16"]).toBe("=F4+F5+F10");
    // Formulas that do not reference the last column are left alone
    expect(byRange["Sheet1!C17"]).toBeUndefined();
    expect(byRange["Sheet1!B15"]).toBeUndefined();
  });

  it("overwrites an existing snapshot without touching formulas", () => {
    const plan = planSnapshot("Sheet1", p, formulas, 5, { date: "2026-10-05", values: { IBKR: 46300 } });
    expect(plan.isNew).toBe(false);
    expect(plan.updates).toEqual([{ range: "Sheet1!E8", values: [[46300]] }]);
  });

  it("rejects older dates and unknown positions", () => {
    expect(() => planSnapshot("Sheet1", p, formulas, 5, { date: "2026-01-01", values: {} })).toThrow(/before the last/);
    expect(() => planSnapshot("Sheet1", p, formulas, 5, { date: "2026-11-05", values: { Nope: 1 } })).toThrow(/Unknown/);
  });
});

describe("buildDashboard", () => {
  it("computes totals, changes and allocation", () => {
    const d = buildDashboard(parsePortfolio(values));
    expect(d.total).toBe(230067);
    expect(d.vsPrevious?.abs).toBeCloseTo(230067 - 226012.5);
    expect(d.liquid).toBe(112500);
    expect(d.rows[0].name).toBe("Indeliai EUR");
    expect(d.closed).toEqual(["Crypto", "II pillar"]);
    expect(d.allocation.reduce((s, a) => s + a.share, 0)).toBeCloseTo(1);
  });
});

describe("holdings", () => {
  it("parses the Holdings tab", () => {
    const h = parseHoldings([
      ["Position", "Symbol", "Name", "Units", "Price source", "Last price", "Currency", "Price date"],
      ["IBKR", "VWCE.DE", "Vanguard", 179, "yahoo", "", "EUR", ""],
      ["III pillar", "ARTEA-AA16", "Artea", 18763.33, "manual", 0.7034, "EUR", "2026-06-30"],
      ["", "", "", "", "", "", "", ""],
    ]);
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ units: 179, source: "yahoo", lastPrice: null });
    expect(h[1]).toMatchObject({ source: "manual", lastPrice: 0.7034 });
  });
});

describe("prices", () => {
  const fake = (map: Record<string, object>) =>
    (async (url: string) => {
      const sym = decodeURIComponent(String(url).split("/chart/")[1].split("?")[0]);
      const meta = map[sym];
      return new Response(JSON.stringify({ chart: { result: meta ? [{ meta }] : null, error: meta ? null : { description: "Not found" } } }), {
        status: meta ? 200 : 404,
      });
    }) as unknown as typeof fetch;

  it("returns EUR prices directly", async () => {
    const q = await fetchQuote("VWCE.DE", fake({ "VWCE.DE": { regularMarketPrice: 140.5, currency: "EUR", regularMarketTime: 1793000000 } }));
    expect(q.priceEur).toBe(140.5);
  });

  it("converts USD and GBp to EUR", async () => {
    const f = fake({
      SCHD: { regularMarketPrice: 30, currency: "USD" },
      "EURUSD=X": { regularMarketPrice: 1.2 },
      "VHYL.L": { regularMarketPrice: 6000, currency: "GBp" },
      "EURGBP=X": { regularMarketPrice: 0.8 },
    });
    expect((await fetchQuote("SCHD", f)).priceEur).toBeCloseTo(25);
    expect((await fetchQuote("VHYL.L", f)).priceEur).toBeCloseTo(75);
  });

  it("throws for unknown symbols", async () => {
    await expect(fetchQuote("NOPE", fake({}))).rejects.toThrow();
  });
});
