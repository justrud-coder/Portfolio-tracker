"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { colorFor, fmtEur } from "@/lib/format";

type Point = Record<string, number | string>;

const short = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v));

export function ValueChart({ series, groups }: { series: Point[]; groups: string[] }) {
  const [mode, setMode] = useState<"total" | "groups">("total");
  const [range, setRange] = useState<"all" | "3y" | "1y">("all");
  const cutoff = range === "all" ? "" : `${new Date().getFullYear() - (range === "1y" ? 1 : 3)}${new Date().toISOString().slice(4, 10)}`;
  const data = series.filter((p) => String(p.date) >= cutoff);
  const order = [...groups].sort((a, b) => Number(data.at(-1)?.[b] ?? 0) - Number(data.at(-1)?.[a] ?? 0));

  return (
    <>
      <div className="row-actions" style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button className={`btn ${mode === "total" ? "primary" : ""}`} onClick={() => setMode("total")}>Total</button>
          <button className={`btn ${mode === "groups" ? "primary" : ""}`} onClick={() => setMode("groups")}>By asset class</button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["1y", "3y", "all"] as const).map((r) => (
            <button key={r} className={`btn ${range === r ? "primary" : ""}`} onClick={() => setRange(r)}>{r === "all" ? "All" : r.toUpperCase()}</button>
          ))}
        </div>
      </div>
      <div style={{ width: "100%", height: 300 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "var(--muted)", fontSize: 12 }} tickFormatter={(d: string) => d.slice(0, 7)} minTickGap={40} stroke="var(--border)" />
            <YAxis tick={{ fill: "var(--muted)", fontSize: 12 }} tickFormatter={short} width={44} stroke="var(--border)" />
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}
              formatter={(v: number, name: string) => [fmtEur(v), name === "total" ? "Total" : name]}
            />
            {mode === "total" ? (
              <Area type="monotone" dataKey="total" stroke="var(--c1)" fill="var(--c1)" fillOpacity={0.15} strokeWidth={2} />
            ) : (
              order.map((g) => (
                <Area key={g} type="monotone" dataKey={g} stackId="1" stroke={colorFor(g)} fill={colorFor(g)} fillOpacity={0.55} />
              ))
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {mode === "groups" && (
        <div className="legend">
          {order.map((g) => (
            <span key={g}><i style={{ background: colorFor(g) }} />{g}</span>
          ))}
        </div>
      )}
    </>
  );
}
