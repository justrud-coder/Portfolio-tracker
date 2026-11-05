// Colour and icons on top of the rendered views. Sets data attributes and CSS
// variables only (never adds elements), so the views stay as they are and the
// observer below doesn't trigger itself.

const PALETTE = { coral: "#e8475f", violet: "#8a5cf5", teal: "#00a699", orange: "#f26b3a", amber: "#e0a100", green: "#1f9d55" };

// Section headings by how they start: [prefix, icon, colour].
const SECTIONS = [
  ["net worth", "chart", PALETTE.coral],
  ["allocation", "pie", PALETTE.violet],
  ["what if", "sliders", PALETTE.teal],
  ["retire at each age", "flag", PALETTE.orange],
  ["the numbers", "calc", PALETTE.violet],
  ["growth vs plan", "calendar", PALETTE.teal],
  ["your plan", "pencil", PALETTE.coral],
  ["what to buy", "cart", PALETTE.teal],
  ["trades to reach", "cart", PALETTE.teal],
  ["mix by class", "pie", PALETTE.violet],
  ["within stocks", "trend", PALETTE.coral],
  ["target mix", "target", PALETTE.orange],
  ["what changed", "plus", PALETTE.coral],
  ["recent", "clock", PALETTE.violet],
];
const GROUP_ICONS = { stocks: "trend", cash: "wallet", "real estate": "home", options: "star", "iii pillar pension": "umbrella" };
const KIND_COLORS = { buy: PALETTE.green, sell: PALETTE.coral, deposit: PALETTE.teal, withdrawal: PALETTE.orange, pension: PALETTE.amber, options: PALETTE.violet };

const norm = (s) => String(s ?? "").trim().toLowerCase();

function decorateCard(card, groupColors) {
  const h2 = card.querySelector(":scope > h2, :scope > .card-head > h2");
  if (!h2) return;
  const title = norm(h2.textContent);
  const group = Object.keys(groupColors).find((g) => norm(g) === title);
  if (group) {
    card.dataset.group = "";
    card.style.setProperty("--g", groupColors[group]);
    h2.dataset.icon = GROUP_ICONS[title] ?? "dot";
    for (const name of card.querySelectorAll(".list > li > .row .name, .list > li > details > .row .name")) {
      name.closest(".row").dataset.initial = (name.textContent.trim()[0] ?? "").toUpperCase();
    }
    return;
  }
  const hit = SECTIONS.find(([prefix]) => title.startsWith(prefix));
  if (!hit) return;
  h2.dataset.icon = hit[1];
  card.style.setProperty("--g", hit[2]);
  if (hit[0] === "recent") {
    for (const row of card.querySelectorAll(".list > li > .row")) {
      const kind = norm(row.querySelector(".meta")?.textContent.split("·")[0]);
      row.dataset.initial = (row.querySelector(".name")?.textContent.trim()[0] ?? "").toUpperCase();
      row.style.setProperty("--g", KIND_COLORS[kind] ?? PALETTE.violet);
    }
  }
}

/** Decorate the view now and again whenever its content changes. */
export function decorate(root, groupColors) {
  const run = () => root.querySelectorAll(".card").forEach((c) => decorateCard(c, groupColors));
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      run();
    });
  }).observe(root, { childList: true, subtree: true });
  run();
}
