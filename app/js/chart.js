// A small SVG line chart with an area wash and a touch/hover crosshair.
import { eur, shortDate, compactEur } from "./format.js";

const NS = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

function niceTicks(min, max, count = 4) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return ticks;
}

/**
 * points: [{date: "YYYY-MM-DD", value: number}], sorted by date.
 * Renders into `host`, replacing what was there.
 */
export function lineChart(host, points, { label = "Total" } = {}) {
  host.replaceChildren();
  if (points.length < 2) {
    host.innerHTML = `<p class="muted small">Not enough snapshots to draw a chart yet.</p>`;
    return;
  }
  const W = Math.max(280, host.clientWidth || 320);
  const H = 200;
  const m = { t: 12, r: 8, b: 24, l: 44 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  const t0 = Date.parse(points[0].date);
  const t1 = Date.parse(points[points.length - 1].date);
  const vals = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(0, ...vals) < 0 ? Math.min(...vals) : Math.min(...vals) * 0.9, Math.max(...vals));
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const x = (d) => m.l + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * iw;
  const y = (v) => m.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": `${label} over time` });

  for (const t of ticks) {
    svg.append(el("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: "grid" }));
    const lbl = el("text", { x: m.l - 6, y: y(t) + 4, class: "axis", "text-anchor": "end" });
    lbl.textContent = compactEur(t);
    svg.append(lbl);
  }

  // Year labels along the bottom
  const firstYear = new Date(t0).getUTCFullYear();
  const lastYear = new Date(t1).getUTCFullYear();
  const yearStep = Math.max(1, Math.ceil((lastYear - firstYear + 1) / 5));
  for (let yr = firstYear + 1; yr <= lastYear; yr += yearStep) {
    const d = `${yr}-01-01`;
    if (Date.parse(d) <= t0) continue;
    const lbl = el("text", { x: x(d), y: H - 6, class: "axis", "text-anchor": "middle" });
    lbl.textContent = String(yr);
    svg.append(lbl);
  }
  if (lastYear === firstYear) {
    const lbl = el("text", { x: m.l, y: H - 6, class: "axis" });
    lbl.textContent = shortDate(points[0].date);
    svg.append(lbl);
  }

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const base = y(Math.max(y0, 0));
  svg.append(el("path", { d: `${line}L${x(points[points.length - 1].date)},${base}L${x(points[0].date)},${base}Z`, class: "area" }));
  svg.append(el("path", { d: line, class: "line" }));

  const last = points[points.length - 1];
  svg.append(el("circle", { cx: x(last.date), cy: y(last.value), r: 4, class: "dot" }));

  // Crosshair + tooltip
  const cross = el("line", { y1: m.t, y2: m.t + ih, class: "cross", visibility: "hidden" });
  const hoverDot = el("circle", { r: 5, class: "dot", visibility: "hidden" });
  svg.append(cross, hoverDot);
  const hit = el("rect", { x: m.l, y: 0, width: iw, height: H, fill: "transparent" });
  svg.append(hit);

  const tip = document.createElement("div");
  tip.className = "tip";
  tip.hidden = true;
  host.append(svg, tip);

  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    let best = points[0];
    for (const p of points) if (Math.abs(x(p.date) - px) < Math.abs(x(best.date) - px)) best = p;
    const bx = x(best.date);
    cross.setAttribute("x1", bx);
    cross.setAttribute("x2", bx);
    hoverDot.setAttribute("cx", bx);
    hoverDot.setAttribute("cy", y(best.value));
    cross.setAttribute("visibility", "visible");
    hoverDot.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.innerHTML = `<span class="muted">${shortDate(best.date)}</span><strong>${eur(best.value)}</strong>`;
    const left = (bx / W) * r.width;
    tip.style.left = `${Math.min(Math.max(left, 60), r.width - 60)}px`;
  };
  const hide = () => {
    cross.setAttribute("visibility", "hidden");
    hoverDot.setAttribute("visibility", "hidden");
    tip.hidden = true;
  };
  hit.addEventListener("pointermove", (e) => show(e.clientX));
  hit.addEventListener("pointerdown", (e) => show(e.clientX));
  // On touch the pointer "leaves" right after the finger lifts, so keep the
  // reading on screen until the next tap outside the chart.
  hit.addEventListener("pointerleave", (e) => e.pointerType === "mouse" && hide());
  document.addEventListener("pointerdown", (e) => !host.contains(e.target) && hide(), { capture: true });
}
