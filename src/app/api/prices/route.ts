import { NextResponse } from "next/server";
import { loadHoldings } from "@/lib/sheets";
import { fetchQuotes } from "@/lib/prices";

export const dynamic = "force-dynamic";

/** Latest web prices (in EUR) for every holding whose price source is "yahoo". */
export async function GET() {
  const holdings = await loadHoldings();
  const symbols = [...new Set(holdings.filter((h) => h.source === "yahoo").map((h) => h.symbol))];
  return NextResponse.json(await fetchQuotes(symbols));
}
