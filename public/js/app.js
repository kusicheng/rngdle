import { request, setCsrf, publicProfile } from "./api.js";
import {
  format,
  escapeHTML as e,
  dateLabel,
  badgeChip,
  badgeLevel,
  rollCard,
  toast,
  applyTheme,
  copyText,
} from "./ui.js?v=badge-cards-1";
import * as views from "./views.js?v=badge-cards-1";
import { authPage, settings } from "./account.js";
import { poetry, wordsFor } from "./poetry.js";
import { revealRoll } from "./reveal.js?v=badge-cards-1";

const main = document.querySelector("#main");
const dialog = document.querySelector("#detail-dialog");
let ctx = { state: null, catalog: [], missing: [] };
let filters = {
  search: "",
  tier: "all",
  sort: "ep",
  scope: "daily",
  metric: "total",
};
let composer = { words: [], filter: "", variant: 0, rollId: null };
let profileData = null,
  rolling = false,
  clockOffset = 0,
  navigation = 0;
let revealController = null;

function updateState(state) {
  ctx.state = state;
  setCsrf(state.csrf);
  clockOffset = Date.parse(state.serverTime) - Date.now();
  const user = state.user;
  document.querySelector("#account-nav").innerHTML = user
    ? `<a class="account-link" href="/u/${encodeURIComponent(user.username)}" data-link><span class="account-avatar">${e(user.username[0].toUpperCase())}</span>${e(user.username)}</a>`
    : '<a class="button small" href="/signin" data-link>⇥ Sign in</a>';
}
async function refresh() {
  updateState(await request("state"));
}
export function navigate(path) {
  history.pushState({}, "", path);
  render();
  window.scrollTo(0, 0);
}
async function render() {
  if (!ctx.state) return;
  revealController?.abort();
  revealController = null;
  const marker = ++navigation,
    path = location.pathname.replace(/\/$/, "") || "/";
  const params = new URLSearchParams(location.search);
  document
    .querySelectorAll(".bottom-nav a")
    .forEach((a) => a.classList.toggle("active", a.pathname === path));
  document.title = `${
    path === "/"
      ? "RNGdle"
      : path
          .split("/")[1]
          .replace(/-/g, " ")
          .replace(/^./, (s) => s.toUpperCase()) + " · RNGdle"
  }`;
  profileData = null;
  if (path === "/") {
    if (params.get("action") === "verifyEmail")
      main.innerHTML = authPage("verify", params.get("token") || "");
    else if (params.get("action") === "resetPassword")
      main.innerHTML = authPage("reset", params.get("token") || "");
    else main.innerHTML = views.home(ctx);
  } else if (path === "/badges")
    main.innerHTML = views.catalog(
      ctx,
      filters.search,
      filters.tier,
      filters.sort,
    );
  else if (path === "/collection") main.innerHTML = views.collection(ctx);
  else if (path === "/history") main.innerHTML = views.history(ctx);
  else if (path === "/leaderboard")
    main.innerHTML = views.leaderboard(ctx, filters.scope, filters.metric);
  else if (path === "/settings") main.innerHTML = settings(ctx);
  else if (path === "/about") main.innerHTML = views.about(ctx);
  else if (path === "/poetry") {
    if (composer.rollId !== (ctx.state.today?.id ?? null)) {
      composer = {
        words: ctx.state.today?.poem ? ctx.state.today.poem.split(" ") : [],
        filter: "",
        variant: 0,
        rollId: ctx.state.today?.id ?? null,
      };
    }
    main.innerHTML = poetry(ctx, composer);
  } else if (
    [
      "/signin",
      "/signup",
      "/forgot-password",
      "/reset-password",
      "/verify-email",
    ].includes(path)
  )
    main.innerHTML = authPage(
      {
        "/signin": "signin",
        "/signup": "signup",
        "/forgot-password": "forgot",
        "/reset-password": "reset",
        "/verify-email": "verify",
      }[path],
      params.get("token") || "",
    );
  else if (path.startsWith("/badges/")) {
    main.innerHTML = views.catalog(ctx);
    showBadge(decodeURIComponent(path.split("/")[2]));
  } else if (path.startsWith("/u/")) {
    main.innerHTML =
      '<div class="loading" role="status">Loading profile…</div>';
    try {
      const parts = path.split("/"),
        data = await publicProfile(decodeURIComponent(parts[2]));
      if (marker !== navigation) return;
      profileData = data;
      main.innerHTML = views.profile(ctx, data);
      if (parts[3] === "badges") showBadge(parts[4]);
      if (parts[3] === "roll") showRoll(parts[4]);
    } catch (error) {
      if (marker === navigation)
        main.innerHTML = `<section class="page empty-state"><h1>Profile unavailable</h1><p>${e(error.message)}</p><a href="/" data-link>Back to the game</a></section>`;
    }
  } else
    main.innerHTML =
      '<section class="page empty-state"><h1>Page not found</h1><a class="button" href="/" data-link>Back to the game</a></section>';
  countdown();
}
function openDialog(html) {
  document.querySelector("#dialog-content").innerHTML = html;
  if (!dialog.open) dialog.showModal();
}
function showBadge(id) {
  const badge = ctx.catalog.find(
    (b) => b.id === id || b.id === id?.replaceAll("_", "-"),
  );
  if (!badge) return;
  const data = profileData || ctx.state;
  const earned = data.stats.badges?.find((b) => b.id === badge.id),
    count = earned?.count || 0,
    level = badgeLevel(count);
  const matching = (data.history || []).filter((r) =>
    r.badges.some((b) => b.id === badge.id),
  );
  const contributed = matching.reduce(
    (sum, r) =>
      sum +
      r.badges
        .filter((b) => b.id === badge.id && b.isScoring !== false)
        .reduce((ep, b) => ep + b.ep, 0),
    0,
  );
  openDialog(
    `<div class="badge-detail tier-${e(badge.tier)}"><span class="detail-icon">${e(badge.icon)}</span><h2>${e(badge.name)}</h2><p>${e(badge.description)}</p><div class="detail-metrics"><span><strong>${format(badge.ep)}</strong> EP</span><span>${e(badge.odds)}</span><span class="tier-label">${e(badge.tier)}</span></div>${badge.family ? `<p class="small-note">Family: ${e(badge.family.toLowerCase().replaceAll("_", " "))}. Only the highest EP badge in this family scores.</p>` : ""}<hr><h3>${count ? "Level " + level.level : "Not discovered yet"}</h3><p>Earned ${format(count)} time${count === 1 ? "" : "s"}${count ? ` · first earned ${dateLabel(earned.firstEarned)}` : ""}</p><div class="progress-track"><div style="width:${level.progress * 100}%"></div></div><p class="small-note">${count ? `${Math.max(0, level.next - count)} more to the next level.` : "Your next roll could unlock this badge."}</p>${matching.length ? `<h3>Matching rolls</h3><div class="history-list">${matching.map((r) => `<button class="history-row panel" data-roll="${r.id}"><span>${dateLabel(r.day)}</span><strong class="mono">${r.value}</strong><strong>${format(r.ep)} EP</strong></button>`).join("")}</div>` : ""}</div>`,
  );
  if (count) {
    const contribution = document.createElement("p");
    contribution.textContent = `${format(contributed)} EP contributed to your total`;
    document.querySelector(".badge-detail h3").before(contribution);
  }
}
function showRoll(id) {
  const roll = (profileData?.history || ctx.state.history).find(
    (r) => String(r.id) === String(id),
  );
  if (!roll) return;
  openDialog(
    `<h2>Roll · ${dateLabel(roll.day)}</h2>${rollCard(roll)}${roll.poem ? `<p class="poem-line">${e(roll.poem)}</p>` : ""}<h3>EP breakdown</h3>${breakdown(roll)}`,
  );
}
function breakdown(roll) {
  return `<div class="breakdown">${roll.badges.map((b) => `<div class="breakdown-row"><span>${badgeChip(b)}</span><span>${b.isScoring === false ? '<small class="muted">Family badge scored</small>' : `<strong>${format(b.ep)} EP</strong>`}</span></div>`).join("")}<div class="breakdown-total"><strong>Total</strong><strong>${format(roll.ep)} EP</strong></div></div>`;
}
function countdown() {
  const left = Math.max(
    0,
    Date.parse(ctx.state.nextReset) - (Date.now() + clockOffset),
  );
  const seconds = Math.floor(left / 1000),
    text = [
      Math.floor(seconds / 3600),
      Math.floor(seconds / 60) % 60,
      seconds % 60,
    ]
      .map((n) => String(n).padStart(2, "0"))
      .join(":");
  document
    .querySelectorAll("[data-countdown]")
    .forEach((el) => (el.textContent = text));
  if (left === 0 && !rolling && document.visibilityState === "visible") {
    rolling = true;
    refresh()
      .then(() => render())
      .catch(() => {})
      .finally(() => (rolling = false));
  }
}
async function generate() {
  if (rolling || (ctx.state.user && ctx.state.today)) return;
  rolling = true;
  const button = main.querySelector('[data-action="roll"]');
  button.disabled = true;
  button.textContent = "Rolling…";
  const reduce =
    localStorage.getItem("rngdle_motion") === "reduced" ||
    matchMedia("(prefers-reduced-motion:reduce)").matches;
  if (!reduce)
    main
      .querySelector(".roll-card .roll-number")
      ?.classList.add("number-unrevealed");
  const startedNavigation = navigation;
  let timer;
  if (!reduce)
    timer = setInterval(() => {
      const el = main.querySelector(".unknown-number");
      if (el)
        el.textContent = String(Math.floor(Math.random() * 1000000)).padStart(
          6,
          "0",
        );
    }, 60);
  try {
    const start = Date.now(),
      result = await request("roll", {});
    if (!reduce)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, 800 - (Date.now() - start))),
      );
    updateState(result.state || (await request("state")));
    clearInterval(timer);
    const stayedOnRoll =
      startedNavigation === navigation && location.pathname === "/";
    await render();
    if (stayedOnRoll && !result.alreadyRolled && ctx.state.today) {
      await presentRoll(ctx.state.today, reduce);
    }
  } catch (error) {
    toast(error.message);
    render();
  } finally {
    clearInterval(timer);
    rolling = false;
  }
}
async function presentRoll(roll, reducedMotion) {
  const controller = new AbortController();
  revealController = controller;
  try {
    return await revealRoll(main, roll, {
      signal: controller.signal,
      reducedMotion,
    });
  } finally {
    if (revealController === controller) revealController = null;
  }
}
async function action(name) {
  try {
    if (name === "roll") return await generate();
    if (name === "replay") {
      if (rolling || !ctx.state.today || location.pathname !== "/") return;
      rolling = true;
      try {
        await presentRoll(
          ctx.state.today,
          localStorage.getItem("rngdle_motion") === "reduced" ||
            matchMedia("(prefers-reduced-motion:reduce)").matches,
        );
      } finally {
        rolling = false;
      }
      return;
    }
    if (name === "share") {
      const r = ctx.state.today;
      return copyText(
        `RNGdle · ${r.day}\n${r.value} · ${format(r.ep)} EP\n${r.badges
          .slice(0, 8)
          .map((b) => b.icon)
          .join(" ")}\n${r.poem || ""}\n${location.origin}`,
      );
    }
    if (name === "breakdown")
      return openDialog(
        `<h2>Your EP breakdown</h2><p class="muted">Every badge is earned. The best badge in each family scores.</p>${breakdown(ctx.state.today)}`,
      );
    if (name === "logout") {
      const result = await request("logout", {});
      updateState(result.state || (await request("state")));
      navigate("/");
      toast("Signed out.");
      return;
    }
    if (name === "resendVerification") {
      const result = await request(name, {});
      toast(result.message);
      return;
    }
    if (name === "export") {
      const data = {
        exportedAt: new Date().toISOString(),
        user: ctx.state.user,
        stats: ctx.state.stats,
        history: ctx.state.history,
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "rngdle-data.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (name === "poem-clear") composer.words = [];
    if (name === "poem-shuffle") {
      const available = [
        ...new Set(
          ctx.state.today.badges.flatMap((b) => wordsFor(b, composer.variant)),
        ),
      ];
      for (let i = available.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [available[i], available[j]] = [available[j], available[i]];
      }
      composer.words = available.slice(0, Math.min(6, available.length));
    }
    if (name === "poem-variants") composer.variant++;
    if (name === "poem-share")
      return copyText(
        `${composer.words.join(" ")}\nRNGdle · ${ctx.state.today.value} · ${format(ctx.state.today.ep)} EP`,
      );
    if (name === "poem-save") {
      const result = await request("savePoem", {
        rollId: ctx.state.today.id,
        text: composer.words.join(" "),
      });
      updateState(result.state || (await request("state")));
      toast("Poem saved to your roll.");
    }
    render();
  } catch (error) {
    toast(error.message);
  }
}
document.addEventListener("click", (event) => {
  const target = event.target.closest("a[data-link],button,[data-badge]");
  if (!target) return;
  if (target.matches("a[data-link]")) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    if (dialog.open) dialog.close();
    navigate(target.getAttribute("href"));
  } else if (target.dataset.action) action(target.dataset.action);
  else if (target.dataset.badge) showBadge(target.dataset.badge);
  else if (target.dataset.roll) showRoll(target.dataset.roll);
  else if (target.hasAttribute("data-tier")) {
    filters.tier = target.dataset.tier;
    render();
  } else if (target.dataset.scope) {
    filters.scope = target.dataset.scope;
    render();
  } else if (target.dataset.metric) {
    filters.metric = target.dataset.metric;
    render();
  } else if (target.dataset.word) {
    if (composer.words.length >= 10) toast("Choose up to ten words.");
    else {
      composer.words.push(target.dataset.word);
      render();
    }
  } else if (target.hasAttribute("data-remove-word")) {
    composer.words.splice(Number(target.dataset.removeWord), 1);
    render();
  }
});
document
  .querySelector(".dialog-close")
  .addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  }
});
main.addEventListener("input", (event) => {
  const el = event.target;
  if (el.id === "badge-search" || el.id === "poem-filter") {
    const start = el.selectionStart,
      id = el.id;
    if (id === "badge-search") filters.search = el.value;
    else composer.filter = el.value;
    render().then(() => {
      const input = document.getElementById(id);
      input?.focus();
      if (input?.type === "search") input.setSelectionRange(start, start);
    });
  }
});
main.addEventListener("change", (event) => {
  if (event.target.id === "theme-select") applyTheme(event.target.value);
  if (event.target.id === "reduce-motion")
    localStorage.setItem(
      "rngdle_motion",
      event.target.checked ? "reduced" : "normal",
    );
  if (event.target.id === "badge-sort") {
    filters.sort = event.target.value;
    render();
  }
});
main.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const kind = form.dataset.form,
    fields = new FormData(form),
    data = Object.fromEntries(fields),
    error = form.querySelector(".form-error"),
    button = form.querySelector('[type="submit"]');
  const actions = {
    signin: "login",
    signup: "register",
    forgot: "requestPasswordReset",
    reset: "resetPassword",
    verify: "verifyEmail",
    profile: "updateProfile",
    username: "changeUsername",
    password: "changePassword",
    delete: "deleteAccount",
  };
  if (kind === "profile")
    data.favoriteBadgeIds = fields.getAll("favoriteBadgeIds");
  error.textContent = "";
  button.disabled = true;
  try {
    const result = await request(actions[kind], data);
    if (result.state) updateState(result.state);
    toast(result.message || "Saved.");
    if (["signin", "signup", "delete"].includes(kind)) navigate("/");
    else if (kind === "reset") navigate("/signin");
    else if (kind === "verify") navigate("/settings");
    else if (kind === "forgot") {
      form.reset();
      error.classList.add("success");
      error.textContent = result.message;
    } else {
      await refresh();
      render();
    }
  } catch (err) {
    error.classList.remove("success");
    error.textContent = err.message;
  } finally {
    button.disabled = false;
  }
});
window.addEventListener("popstate", render);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if ((localStorage.getItem("rngdle_theme") || "system") === "system")
    applyTheme("system");
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !rolling)
    refresh()
      .then(render)
      .catch(() => {});
});
// Establish the session cookie first. Parallel first requests can create two sessions.
try {
  const state = await request("state");
  updateState(state);
  const catalog = await request("catalog");
  ctx.catalog = catalog.badges;
  ctx.missing = catalog.missing || [];
  await render();
  setInterval(countdown, 1000);
} catch (error) {
  main.innerHTML = `<section class="page empty-state"><h1>Couldn’t load your game.</h1><p>${e(error.message)}</p><button class="button" onclick="location.reload()">Try again</button></section>`;
}
