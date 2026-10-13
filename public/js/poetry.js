import { escapeHTML as e, format } from "./ui.js";
import { pageHeading } from "./views.js";
const wordGroups = {
  jackpot: ["golden", "fortune", "gods", "treasure"],
  prime: ["indivisible", "alone", "singular", "whole"],
  palindrome: ["mirror", "reflection", "return", "echo"],
  square: ["foundation", "root", "corner", "solid"],
  cube: ["depth", "dimension", "within", "crystal"],
  zero: ["void", "silence", "nothing", "beginning"],
  even: ["balance", "rhythm", "paired", "harmony"],
  odd: ["wanderer", "uneven", "outsider", "wild"],
  contiguous: ["unbroken", "together", "connected", "seamless"],
  sequence: ["steps", "journey", "ascending", "order"],
  fibonacci: ["spiral", "growth", "bloom", "nature"],
  power: ["force", "lightning", "strength", "energy"],
  lucky: ["wish", "chance", "spark", "fortune"],
  digits: ["symbols", "stars", "fragments", "signs"],
};
export function wordsFor(badge, variant = 0) {
  const stem = Object.keys(wordGroups).find((key) =>
    `${badge.id} ${badge.name}`.toLowerCase().includes(key),
  );
  const words = stem
    ? wordGroups[stem]
    : badge.name
        .toLowerCase()
        .replace(/[^a-z ]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 2);
  return words.length
    ? [words[variant % words.length], words[(variant + 1) % words.length]]
    : ["possibility"];
}
export function poetry({ state }, composer) {
  const roll = state.today;
  if (!roll)
    return `<section class="page">${pageHeading("A poem in your number.", "Discover your words with today’s roll.")}<div class="empty-state"><span>✎</span><p>Your badges become the words of your poem.</p><a class="button primary" href="/" data-link>Roll your number</a></div></section>`;
  const badges = roll.badges.filter((b) =>
    `${b.name} ${b.description}`
      .toLowerCase()
      .includes(composer.filter.toLowerCase()),
  );
  return `<section class="page poetry-page">${pageHeading("A poem in your number.", "Choose up to ten words from your badges. See where they take you.", "/")}
    <div class="poem-preview panel"><span class="eyebrow">${roll.value} · ${format(roll.ep)} EP</span><p id="poem-text">${e(composer.words.join(" ")) || "Your words go here…"}</p><small>${composer.words.length} / 10 words</small></div>
    <div class="result-actions"><button class="button" data-action="poem-shuffle">Shuffle</button><button class="button" data-action="poem-variants">Word variants</button><button class="button" data-action="poem-clear">Clear</button></div>
    <label><span class="sr-only">Filter poetry badges</span><input id="poem-filter" type="search" value="${e(composer.filter)}" placeholder="Filter your badges…" aria-label="Filter poetry badges"></label>
    <div class="poetry-words">${badges
      .map(
        (b) =>
          `<div class="poetry-group"><span>${e(b.icon)} ${e(b.name)}</span><div>${wordsFor(
            b,
            composer.variant,
          )
            .map(
              (w) =>
                `<button class="word-button ${composer.words.includes(w) ? "selected" : ""}" data-word="${e(w)}">${e(w)}</button>`,
            )
            .join("")}</div></div>`,
      )
      .join("")}</div>
    <div class="selected-words">${composer.words.map((w, i) => `<button class="word-button selected" data-remove-word="${i}" title="Remove word">${e(w)} ×</button>`).join("")}</div>
    <div class="result-actions"><button class="button primary" data-action="poem-save"${!composer.words.length && !roll.poem ? " disabled" : ""}>Save poem</button><button class="button" data-action="poem-share"${!composer.words.length ? " disabled" : ""}>Copy poem</button></div>
    ${roll.poem ? `<p class="small-note">Saved poem: ${e(roll.poem)}</p>` : ""}
  </section>`;
}
