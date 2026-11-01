import { Header } from "@/components/Header";
import { ValueChart } from "@/components/Charts";
import { loadPortfolio } from "@/lib/sheets";
import { buildDashboard, Change } from "@/lib/stats";
import { colorFor, fmtEur, fmtPct, signed, trend } from "@/lib/format";

export const dynamic = "force-dynamic";

function ChangeTile({ label, c }: { label: string; c: Change | null }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      {c ? (
        <>
          <div className={`value ${trend(c.abs)}`}>{signed(c.abs, fmtEur)}</div>
          <div className={`sub ${trend(c.abs)}`}>{signed(c.pct, fmtPct)} <span className="muted">since {c.since}</span></div>
        </>
      ) : (
        <div className="value muted">–</div>
      )}
    </div>
  );
}

export default async function Dashboard() {
  let d;
  try {
    d = buildDashboard(await loadPortfolio());
  } catch (e) {
    return (
      <div className="container">
        <Header active="dashboard" />
        <div className="msg error">Could not load the sheet: {e instanceof Error ? e.message : String(e)}</div>
      </div>
    );
  }

  return (
    <div className="container">
      <Header active="dashboard" />
      <div className="tiles">
        <div className="tile">
          <div className="label">Total value</div>
          <div className="value">{fmtEur(d.total)}</div>
          <div className="sub muted">as of {d.asOf}</div>
        </div>
        <ChangeTile label="Since last update" c={d.vsPrevious} />
        <ChangeTile label="Year to date" c={d.ytd} />
        <ChangeTile label="Last 12 months" c={d.vsYearAgo} />
        {d.liquid !== null && (
          <div className="tile">
            <div className="label">Liquid</div>
            <div className="value">{fmtEur(d.liquid)}</div>
            <div className="sub muted">{fmtPct(d.total ? d.liquid / d.total : 0)} of total</div>
          </div>
        )}
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Value over time</h2>
          <ValueChart series={d.series} groups={d.groups} />
        </div>
        <div className="card">
          <h2>Allocation</h2>
          {d.allocation.map((a) => (
            <div className="bar-row" key={a.group}>
              <span>{a.group}</span>
              <div className="bar"><span style={{ width: `${Math.max(0, a.share) * 100}%`, background: colorFor(a.group) }} /></div>
              <span className="muted" style={{ textAlign: "right" }}>{fmtPct(a.share)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Positions</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Position</th>
                <th>Asset class</th>
                <th className="num">Value</th>
                <th className="num">Change</th>
                <th className="num">Share</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className="muted">{r.group}</td>
                  <td className="num">{fmtEur(r.value)}</td>
                  <td className={`num ${trend(r.change)}`}>{signed(r.change, fmtEur)}</td>
                  <td className="num muted">{fmtPct(r.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.closed.length > 0 && <p className="muted" style={{ fontSize: 13 }}>Closed or empty: {d.closed.join(", ")}</p>}
      </div>
    </div>
  );
}
