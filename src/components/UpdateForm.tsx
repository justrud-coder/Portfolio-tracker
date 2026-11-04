"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Holding } from "@/lib/holdings";
import type { Quote } from "@/lib/prices";
import { fmtEur, fmtPrice, signed, trend } from "@/lib/format";

interface PositionInfo {
  name: string;
  group: string;
  previous: number | null;
  closed: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);
const parse = (s: string): number | null => {
  if (s.trim() === "") return null;
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export function UpdateForm({ lastDate, positions, holdings: initial }: { lastDate: string; positions: PositionInfo[]; holdings: Holding[] }) {
  const [date, setDate] = useState(today());
  const [holdings, setHoldings] = useState<Holding[]>(initial);
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  // Manual values per position (string so the input can be empty)
  const [manual, setManual] = useState<Record<string, string>>(() =>
    Object.fromEntries(positions.map((p) => [p.name, p.previous === null ? "" : String(p.previous)])),
  );
  // Positions that have holdings use the computed value unless overridden
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const byPosition = useMemo(() => {
    const m = new Map<string, { h: Holding; i: number }[]>();
    holdings.forEach((h, i) => m.set(h.position, [...(m.get(h.position) ?? []), { h, i }]));
    return m;
  }, [holdings]);

  async function refreshPrices() {
    setLoadingPrices(true);
    try {
      const res = await fetch("/api/prices", { cache: "no-store" });
      const data = (await res.json()) as { quotes: Record<string, Quote>; errors: Record<string, string> };
      setPriceErrors(data.errors ?? {});
      setHoldings((hs) =>
        hs.map((h) => {
          const q = data.quotes?.[h.symbol];
          return q ? { ...h, lastPrice: Math.round(q.priceEur * 10000) / 10000, priceDate: q.date } : h;
        }),
      );
    } catch (e) {
      setPriceErrors({ all: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoadingPrices(false);
    }
  }

  useEffect(() => {
    if (initial.some((h) => h.source === "yahoo")) void refreshPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setHolding = (i: number, patch: Partial<Holding>) =>
    setHoldings((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  const computed = (name: string) =>
    (byPosition.get(name) ?? []).reduce((s, { h }) => s + h.units * (h.lastPrice ?? 0), 0);

  /** Holdings drive the value only when every holding has a price. */
  const isAuto = (name: string) =>
    byPosition.has(name) && !override[name] && (byPosition.get(name) ?? []).every(({ h }) => h.lastPrice !== null);

  const valueOf = (p: PositionInfo): number | null =>
    isAuto(p.name) ? Math.round(computed(p.name)) : parse(manual[p.name] ?? "");

  const total = positions.reduce((s, p) => s + (valueOf(p) ?? 0), 0);
  const prevTotal = positions.reduce((s, p) => s + (p.previous ?? 0), 0);
  const overwriting = date === lastDate;
  const tooEarly = date < lastDate;

  async function save() {
    setSaving(true);
    setResult(null);
    try {
      const values = Object.fromEntries(positions.map((p) => [p.name, valueOf(p)]));
      const res = await fetch("/api/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, values, holdings }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult({ ok: true, text: data.isNew ? `Saved a new snapshot for ${date}.` : `Updated the ${date} snapshot.` });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  const row = (p: PositionInfo) => {
    const hasHoldings = byPosition.has(p.name);
    const auto = isAuto(p.name);
    const v = valueOf(p);
    const diff = (v ?? 0) - (p.previous ?? 0);
    return (
      <tr key={p.name}>
        <td>
          {p.name}
          <div className="muted" style={{ fontSize: 12 }}>{p.group}{hasHoldings ? (auto ? " · from holdings" : " · manual override") : ""}</div>
        </td>
        <td className="num muted">{p.previous === null ? "–" : fmtEur(p.previous)}</td>
        <td className="num">
          {auto ? (
            <strong>{fmtEur(v ?? 0)}</strong>
          ) : (
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={manual[p.name] ?? ""}
              onChange={(e) => setManual((m) => ({ ...m, [p.name]: e.target.value }))}
            />
          )}
          {hasHoldings && (
            <div>
              <button
                type="button"
                className="btn"
                style={{ padding: "2px 8px", fontSize: 12, marginTop: 4 }}
                onClick={() => {
                  if (auto) setManual((m) => ({ ...m, [p.name]: String(Math.round(computed(p.name))) }));
                  setOverride((o) => ({ ...o, [p.name]: auto }));
                }}
              >
                {auto ? "Override" : "Use holdings"}
              </button>
            </div>
          )}
        </td>
        <td className={`num ${trend(diff)}`}>{signed(diff, fmtEur)}</td>
      </tr>
    );
  };

  const open = positions.filter((p) => !p.closed);
  const closed = positions.filter((p) => p.closed);

  return (
    <>
      <div className="card">
        <div className="row-actions">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label htmlFor="date" className="muted">Snapshot date</label>
            <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} />
          </div>
          <span className="muted" style={{ fontSize: 13 }}>Last snapshot: {lastDate}</span>
        </div>
        {overwriting && <div className="msg" style={{ marginTop: 12 }}>A snapshot for this date already exists. Saving will overwrite its values.</div>}
        {tooEarly && <div className="msg error" style={{ marginTop: 12 }}>The date is before the last snapshot. Pick {lastDate} or later.</div>}
      </div>

      {holdings.length > 0 && (
        <div className="card">
          <div className="row-actions" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Holdings</h2>
            <button className="btn" type="button" onClick={refreshPrices} disabled={loadingPrices}>
              {loadingPrices ? "Fetching prices…" : "Refresh prices"}
            </button>
          </div>
          {Object.keys(priceErrors).length > 0 && (
            <div className="msg error">
              Some prices could not be fetched, so the last known price is used. Enter it manually if needed.
              <div style={{ fontSize: 12 }}>{Object.entries(priceErrors).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Holding</th>
                  <th className="num">Units</th>
                  <th className="num">Price (EUR)</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h, i) => (
                  <tr key={`${h.position}-${h.symbol}`}>
                    <td className="muted">{h.position}</td>
                    <td>
                      {h.symbol}
                      <div className="muted" style={{ fontSize: 12 }}>{h.name}</div>
                    </td>
                    <td className="num">
                      <input type="number" step="any" value={h.units} onChange={(e) => setHolding(i, { units: parse(e.target.value) ?? 0 })} />
                    </td>
                    <td className="num">
                      {h.source === "yahoo" ? (
                        <>
                          {h.lastPrice === null ? "–" : fmtPrice(h.lastPrice)}
                          <div className="muted" style={{ fontSize: 12 }}>web · {h.priceDate || "not fetched"}</div>
                        </>
                      ) : h.source === "google" ? (
                        <>
                          {h.lastPrice === null ? "–" : fmtPrice(h.lastPrice)}
                          <div className="muted" style={{ fontSize: 12 }}>live · Google Finance</div>
                        </>
                      ) : h.source === "fixed" ? (
                        <span className="muted">{fmtPrice(h.lastPrice ?? 1)}</span>
                      ) : (
                        <>
                          <input
                            type="number"
                            step="any"
                            value={h.lastPrice ?? ""}
                            onChange={(e) => setHolding(i, { lastPrice: parse(e.target.value), priceDate: date })}
                          />
                          <div className="muted" style={{ fontSize: 12 }}>manual · {h.priceDate || "–"}</div>
                        </>
                      )}
                    </td>
                    <td className="num">{fmtEur(h.units * (h.lastPrice ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Positions</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Position</th>
                <th className="num">Previous</th>
                <th className="num">New value</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>{open.map(row)}</tbody>
          </table>
        </div>
        {closed.length > 0 && (
          <details>
            <summary>Closed or empty positions ({closed.length})</summary>
            <div className="table-wrap">
              <table>
                <tbody>{closed.map(row)}</tbody>
              </table>
            </div>
          </details>
        )}
      </div>

      <div className="card">
        {result && <div className={`msg ${result.ok ? "ok" : "error"}`}>{result.text} {result.ok && <Link href="/">View dashboard</Link>}</div>}
        <div className="row-actions">
          <div>
            <div className="muted" style={{ fontSize: 13 }}>New total</div>
            <div style={{ fontSize: 22, fontWeight: 650 }}>{fmtEur(total)}</div>
            <div className={trend(total - prevTotal)} style={{ fontSize: 13 }}>{signed(total - prevTotal, fmtEur)} vs {lastDate}</div>
          </div>
          <button className="btn primary" type="button" onClick={save} disabled={saving || tooEarly}>
            {saving ? "Saving…" : overwriting ? "Overwrite snapshot" : "Save snapshot to sheet"}
          </button>
        </div>
      </div>
    </>
  );
}
