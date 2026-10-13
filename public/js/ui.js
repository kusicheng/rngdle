export const format = (number) => Number(number || 0).toLocaleString("en-US");
export const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const dateLabel = (date) =>
  new Date(date.length === 10 ? `${date}T12:00:00Z` : date).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
  );
export const badgeLevelThresholds = [
  1, 2, 4, 7, 12, 20, 33, 54, 88, 143, 232, 376, 609, 986, 1596, 2583, 4180,
  6764, 10945, 17710,
];
export function badgeLevel(count) {
  if (!count) return { level: 0, progress: 0, next: 1 };
  let level = badgeLevelThresholds.filter((n) => count >= n).length;
  const lower = badgeLevelThresholds[level - 1],
    next = badgeLevelThresholds[level] || lower;
  return {
    level,
    progress: next === lower ? 1 : (count - lower) / (next - lower),
    next,
  };
}
export function badgeChip(badge, options = {}) {
  const scoring = badge.isScoring !== false;
  return `<button class="badge-chip tier-${escapeHTML(badge.tier)} ${options.dim ? "unearned" : ""}" data-badge="${escapeHTML(badge.id)}" data-ep="${Number(badge.ep)}" data-scoring="${scoring}" title="${escapeHTML(badge.description)}${scoring ? "" : " · Another badge in this family scores"}"><span aria-hidden="true">${escapeHTML(badge.icon)}</span> ${escapeHTML(badge.name)}${options.ep ? ` <span class="chip-ep">${format(badge.ep)} EP</span>` : ""}</button>`;
}
export function rollCard(roll, { compact = false, username = "" } = {}) {
  const tier = String(
    roll.rarity?.tier || roll.rarity?.label || roll.rarity || "common",
  ).toLowerCase();
  const badges = compact
    ? roll.badges || []
    : [...(roll.badges || [])].sort((a, b) => a.ep - b.ep);
  return `<article class="roll-card ${compact ? "compact" : ""} tier-${escapeHTML(tier)}" aria-busy="false" data-reveal-phase="complete">
    <div class="roll-number" data-testid="${compact ? "best-roll-value" : "roll-value"}">${escapeHTML(roll.value)}</div>
    ${username ? `<p class="roll-by">rolled by <a href="/u/${encodeURIComponent(username)}" data-link>${escapeHTML(username)}</a></p>` : ""}
    <div class="badge-list">${badges
      .slice(0, compact ? 5 : 100)
      .map((b) => badgeChip(b))
      .join(
        "",
      )}${compact && (roll.badges || []).length > 5 ? `<span class="muted">+${roll.badges.length - 5} more</span>` : ""}</div>
    <div class="ep-pill"><span class="ep-number"${compact ? "" : ' data-testid="roll-ep"'} data-value="${Number(roll.ep)}">${format(roll.ep)}</span> <span class="ep-unit">EP</span></div>
  </article>`;
}
let toastTimer;
export function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("visible"), 4500);
}
export function applyTheme(theme) {
  localStorage.setItem("rngdle_theme", theme);
  document.documentElement.dataset.theme =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
}
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard.");
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    document.body.append(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    toast(ok ? "Copied to clipboard." : "Copy is unavailable in this browser.");
  }
}
