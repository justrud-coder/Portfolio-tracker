import { NextResponse } from "next/server";
import { loadHoldings, saveHoldings, saveSnapshot } from "@/lib/sheets";
import type { Holding } from "@/lib/holdings";

export const dynamic = "force-dynamic";

interface Body {
  date: string;
  values: Record<string, number | null>;
  holdings?: Holding[];
}

/** Save a monthly snapshot to Sheet1 and (optionally) the updated Holdings tab. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body?.date || typeof body.values !== "object") {
      return NextResponse.json({ error: "date and values are required" }, { status: 400 });
    }
    for (const [k, v] of Object.entries(body.values)) {
      if (v !== null && !Number.isFinite(v)) {
        return NextResponse.json({ error: `Invalid value for ${k}` }, { status: 400 });
      }
    }
    const plan = await saveSnapshot({ date: body.date, values: body.values });
    if (Array.isArray(body.holdings)) {
      const current = await loadHoldings();
      // Only accept holdings for known rows; keep anything the form did not send.
      const sent = new Map(body.holdings.map((h) => [`${h.position}|${h.symbol}`, h]));
      const merged = current.map((h) => {
        const n = sent.get(`${h.position}|${h.symbol}`);
        return n ? { ...h, units: Number(n.units) || 0, lastPrice: n.lastPrice, priceDate: n.priceDate } : h;
      });
      await saveHoldings(merged);
    }
    return NextResponse.json({ ok: true, column: plan.col, isNew: plan.isNew });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
