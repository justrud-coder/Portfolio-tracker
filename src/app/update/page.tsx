import { Header } from "@/components/Header";
import { UpdateForm } from "@/components/UpdateForm";
import { loadHoldings, loadPortfolio } from "@/lib/sheets";
import { currentValue } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export default async function UpdatePage() {
  try {
    const [portfolio, holdings] = await Promise.all([loadPortfolio(), loadHoldings()]);
    const last = portfolio.snapshots.at(-1)!;
    const positions = portfolio.positions.map((p) => ({
      name: p.name,
      group: p.group,
      previous: p.values.at(-1) ?? null,
      closed: currentValue(p) === 0,
    }));
    return (
      <div className="container">
        <Header active="update" />
        <UpdateForm lastDate={last.date} positions={positions} holdings={holdings} />
      </div>
    );
  } catch (e) {
    return (
      <div className="container">
        <Header active="update" />
        <div className="msg error">Could not load the sheet: {e instanceof Error ? e.message : String(e)}</div>
      </div>
    );
  }
}
