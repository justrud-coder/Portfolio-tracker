const eur0 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = new Intl.NumberFormat("en-GB", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const eur = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : eur0.format(v));
export const eurCents = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : eur2.format(v));
export const pct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : pct1.format(v));

/** "+€1,234" / "−€1,234" */
export const signedEur = (v) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const s = eur0.format(Math.abs(v));
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
};
export const signedPct = (v) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const s = pct1.format(Math.abs(v));
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
};

export function compactEur(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `€${+(v / 1e6).toFixed(1)}m`;
  if (a >= 1e3) return `€${Math.round(v / 1e3)}k`;
  return `€${Math.round(v)}`;
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${months[m - 1]} ${y}`;
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** CSS class for a gain or loss. */
export const tone = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
