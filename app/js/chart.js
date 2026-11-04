// A small SVG line chart with an area wash and a touch/hover crosshair. With
// `stack` it draws stacked areas instead, one band per series.
import { eur, shortDate, compactEur } from "./format.js";

const NS = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const html = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * Date labels for the bottom axis, [{t, text}]: years over long spans, months
 * over a few months to a couple of years, days over the last weeks.
 */
export function timeTicks(t0, t1) {
  const days = (t1 - t0) / DAY;
  const out = [];
  if (days > 900) {
    const first = new Date(t0).getUTCFullYear();
    const last = new Date(t1).getUTCFullYear();
    const step = Math.max(1, Math.ceil((last - first + 1) / 5));
    for (let yr = first + 1; yr <= last; yr += step) out.push({ t: Date.UTC(yr, 0, 1), text: String(yr) });
  } else if (days > 75) {
    const months = days / 30.44;
    const step = [1, 2, 3, 6].find((s) => months / s <= 5) ?? 6;
    const d = new Date(t0);
    for (let k = 1; ; k++) {
      const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1);
      if (t > t1) break;
      const month = new Date(t).getUTCMonth();
      if (month % step) continue;
      out.push({ t, text: month === 0 ? String(new Date(t).getUTCFullYear()) : MONTHS[month] });
    }
  } else {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const t = t0 + ((t1 - t0) * i) / (n - 1);
      const [, mm, dd] = iso(t).split("-").map(Number);
      out.push({ t, text: `${dd} ${MONTHS[mm - 1]}` });
    }
  }
  return out.filter((x) => x.t >= t0 && x.t <= t1);
}

/**
 * points: [{date: "YYYY-MM-DD", value: number, parts?: {name: number}}], sorted by date.
 * stack: [{name, color}] bottom to top, to draw `parts` as stacked areas.
 * Renders into `host`, replacing what was there.
 */
export function lineChart(host, points, { label = "Total", stack = null } = {}) {
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
  const lowest = Math.min(...vals);
  const ticks = stack ? niceTicks(Math.min(0, lowest), Math.max(...vals)) : niceTicks(lowest < 0 ? lowest : lowest * 0.9, Math.max(...vals));
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const xt = (t) => m.l + ((t - t0) / (t1 - t0 || 1)) * iw;
  const x = (d) => xt(Date.parse(d));
  const y = (v) => m.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": `${label} over time` });

  for (const t of ticks) {
    svg.append(el("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: "grid" }));
    const lbl = el("text", { x: m.l - 6, y: y(t) + 4, class: "axis", "text-anchor": "end" });
    lbl.textContent = compactEur(t);
    svg.append(lbl);
  }

  for (const tick of timeTicks(t0, t1)) {
    const px = xt(tick.t);
    const anchor = px < m.l + 16 ? "start" : px > W - m.r - 16 ? "end" : "middle";
    const lbl = el("text", { x: px, y: H - 6, class: "axis", "text-anchor": anchor });
    lbl.textContent = tick.text;
    svg.append(lbl);
  }

  const path = (pts) => pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
  let topLine;
  if (stack) {
    // Bands bottom to top; a surface-coloured edge on each keeps them apart.
    const lower = points.map(() => 0);
    const edges = [];
    for (const s of stack) {
      const upper = points.map((p, i) => lower[i] + Math.max(0, p.parts?.[s.name] ?? 0));
      const top = points.map((p, i) => [x(p.date), y(upper[i])]);
      const bottom = points.map((p, i) => [x(p.date), y(lower[i])]).reverse();
      svg.append(el("path", { d: `${path(top)}${path(bottom).replace("M", "L")}Z`, class: "band", fill: s.color }));
      edges.push(path(top));
      upper.forEach((v, i) => (lower[i] = v));
    }
    edges.slice(0, -1).forEach((d) => svg.append(el("path", { d, class: "band-edge" })));
    topLine = points.map((p, i) => [x(p.date), y(lower[i])]);
  } else {
    topLine = points.map((p) => [x(p.date), y(p.value)]);
    const base = y(Math.max(y0, 0));
    svg.append(el("path", { d: `${path(topLine)}L${topLine[topLine.length - 1][0]},${base}L${topLine[0][0]},${base}Z`, class: "area" }));
    svg.append(el("path", { d: path(topLine), class: "line" }));
    const [lx, ly] = topLine[topLine.length - 1];
    svg.append(el("circle", { cx: lx, cy: ly, r: 4, class: "dot" }));
  }

  // Crosshair + tooltip
  const cross = el("line", { y1: m.t, y2: m.t + ih, class: "cross", visibility: "hidden" });
  const hoverDot = el("circle", { r: 5, class: "dot", visibility: "hidden" });
  svg.append(cross, hoverDot);
  const hit = el("rect", { x: m.l, y: 0, width: iw, height: H, fill: "transparent" });
  svg.append(hit);

  const tip = html("div", stack ? "tip tip-card" : "tip");
  tip.hidden = true;
  host.append(svg, tip);

  if (stack) {
    const present = stack.filter((s) => points.some((p) => (p.parts?.[s.name] ?? 0) > 0));
    const legend = html("ul", "chart-legend");
    for (const s of [...present].reverse()) {
      const li = html("li");
      const sw = html("span", "swatch");
      sw.style.background = s.color;
      li.append(sw, html("span", "", s.name));
      legend.append(li);
    }
    host.append(legend);
  }

  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    let bi = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.date) - px) < Math.abs(x(points[bi].date) - px)) bi = i;
    });
    const best = points[bi];
    const [bx, by] = topLine[bi];
    cross.setAttribute("x1", bx);
    cross.setAttribute("x2", bx);
    hoverDot.setAttribute("cx", bx);
    hoverDot.setAttribute("cy", by);
    cross.setAttribute("visibility", "visible");
    hoverDot.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.replaceChildren(html("span", "muted", shortDate(best.date)), html("strong", "", eur(best.value)));
    const left = (bx / W) * r.width;
    if (stack) {
      const rows = html("ul");
      for (const s of [...stack].reverse()) {
        const v = best.parts?.[s.name] ?? 0;
        if (!v) continue;
        const li = html("li");
        const key = html("span", "key");
        key.style.background = s.color;
        li.append(key, html("span", "name", s.name), html("span", "amt", eur(v)));
        rows.append(li);
      }
      tip.append(rows);
      // Sit on the side away from the crosshair so the bands stay visible.
      tip.style.left = left > r.width / 2 ? "0px" : "auto";
      tip.style.right = left > r.width / 2 ? "auto" : "0px";
    } else {
      tip.style.left = `${Math.min(Math.max(left, 60), r.width - 60)}px`;
    }
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
