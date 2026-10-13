import {
  format,
  escapeHTML as e,
  dateLabel,
  badgeChip,
  badgeLevel,
  rollCard,
} from "./ui.js?v=badge-cards-1";
const tiers = [
  "mythic",
  "anomaly",
  "epic",
  "rare",
  "uncommon",
  "common",
  "trash",
];
export function pageHeading(title, description, back = "") {
  return `<div class="page-heading">${back ? `<a class="back-link" href="${back}" data-link>← Back</a>` : ""}<h1>${title}</h1>${description ? `<p>${description}</p>` : ""}</div>`;
}
export function home({ state }) {
  const roll = state.today;
  const best = state.leaderboard?.daily?.[0];
  const bestRoll = best?.bestRoll;
  if (!roll)
    return `<section class="home pre-roll">
    <div class="unknown-number" aria-label="Your number is waiting">??????</div>
    <p class="hero-caption">${state.user ? "One roll per day. One number. What will yours be?" : "Roll as often as you like. Find your next lucky number."}</p>
    <button class="generate" data-action="roll" data-testid="roll-button">Generate</button>
    ${state.user ? "" : `<p class="signup-hint"><a href="/signup" data-link>Sign up</a> before rolling to save your roll and climb the leaderboard</p>`}
    <section class="today-best panel"><h2>Today’s best roll</h2>
      ${bestRoll ? rollCard(bestRoll, { compact: true, username: best.username }) : best ? `<a class="best-score" href="/u/${encodeURIComponent(best.username)}" data-link>${e(best.username)}</a><div class="ep-pill">${format(best.bestEP || best.totalEP)} EP</div>` : '<div class="empty-dice" aria-hidden="true">⚄</div><p>No account rolls yet today.</p><p class="muted">Your number could be the first.</p>'}
      <a class="muted" href="/leaderboard" data-link>${format((state.leaderboard?.daily || []).reduce((n, r) => n + r.rolls, 0))} account rolls today →</a>
    </section>
    <p class="home-links"><a href="/badges" data-link>Explore all badges</a><span>·</span><a href="/about" data-link>How it works</a></p>
  </section>`;
  const scoring = roll.badges.filter((b) => b.isScoring !== false);
  return `<section class="home result">
    <p class="eyebrow">Your roll · ${dateLabel(roll.day)}</p>
    ${rollCard(roll, { showRarity: true })}
    <div class="result-actions"><button class="button" data-action="replay">↻ Replay reveal</button><button class="button" data-action="share">↗ Share result</button><button class="button" data-action="breakdown">EP breakdown</button></div>
    <p class="muted">${scoring.length} scoring badge${scoring.length === 1 ? "" : "s"} · ${roll.badges.length} badges earned</p>
    ${state.user ? `<div class="reset-panel panel"><p>Your next number is waiting.</p><strong class="countdown" data-countdown>00:00:00</strong><small>Next roll at midnight UTC</small><button class="button small" data-testid="roll-button" disabled>Rolled for today ✓</button></div>` : `<div class="guest-roll-panel"><button class="generate generate-again" data-action="roll" data-testid="roll-button">Roll again</button><p class="muted">Unlimited guest rolls. Signed-in players get one roll per day.</p></div>`}
    ${state.user ? `<p class="lifetime">Lifetime <strong>${format(state.stats.totalEP)} EP</strong> · ${state.stats.streak} day streak</p>` : `<p class="signup-hint"><a href="/signup" data-link>Create an account</a> to keep today’s roll and your badge collection.</p>`}
    <a href="/poetry" class="poetry-link" data-link>✎ Make a poem from your badges</a>
  </section>`;
}
export function catalog(
  { catalog, missing },
  query = "",
  tier = "all",
  sort = "ep",
) {
  const found = catalog.filter(
    (b) =>
      (tier === "all" || b.tier === tier) &&
      `${b.name} ${b.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  found.sort(
    sort === "name"
      ? (a, b) => a.name.localeCompare(b.name)
      : (a, b) => b.ep - a.ep,
  );
  return `<section class="page wide">${pageHeading("All badges", "Every number has a story. Find out what makes yours special.")}
    <div class="catalog-toolbar"><label class="search-label"><span class="sr-only">Search badges</span><input id="badge-search" type="search" placeholder="Search badges or descriptions…" value="${e(query)}" aria-label="Search badges"></label><label><span class="sr-only">Sort badges</span><select id="badge-sort" aria-label="Sort badges"><option value="ep"${sort === "ep" ? " selected" : ""}>Highest EP</option><option value="name"${sort === "name" ? " selected" : ""}>Name A–Z</option></select></label></div>
    <div class="filter-tabs" aria-label="Badge rarity"><button data-tier="all" class="${tier === "all" ? "active" : ""}">All</button>${tiers
      .filter((t) => catalog.some((b) => b.tier === t))
      .map(
        (t) =>
          `<button class="tier-${t} ${tier === t ? "active" : ""}" data-tier="${t}">${t}</button>`,
      )
      .join("")}</div>
    <p class="catalog-count">${found.length} of ${catalog.length} badges${missing.length ? ` · ${missing.length} recorded as missing` : ""}</p>
    <div class="badge-grid">${found.map((b) => `<button class="badge-card tier-${e(b.tier)}" data-badge="${e(b.id)}" data-testid="badge-card"><span class="badge-card-icon">${e(b.icon)}</span><div><div class="badge-card-top"><h2>${e(b.name)}</h2><strong>${format(b.ep)} <small>EP</small></strong></div><p>${e(b.description)}</p><div class="badge-card-bottom"><span class="tier-label">${e(b.tier)}</span><span>${e(b.odds)}</span></div></div></button>`).join("")}</div>
    ${!found.length ? '<div class="empty-state">No badges match your search.</div>' : ""}
    <p class="small-note">All ${catalog.length} badge rules are evaluated on the full, unpadded number. Within each family, the highest EP badge scores.</p>
  </section>`;
}
export function collection({ state, catalog }) {
  const earned = state.stats.badges || [];
  const count = earned.length;
  const sorted = [...earned].sort((a, b) => (b.ep || 0) - (a.ep || 0));
  return `<section class="page wide">${pageHeading("Your collection", "Little patterns. Big discoveries.")}
    <div class="collection-summary panel"><div><strong>${count}<span> / ${catalog.length}</span></strong><p>unique badges discovered</p></div><div><strong>${format(state.stats.totalEP)}</strong><p>lifetime EP</p></div><div><strong>${state.stats.streak || 0}</strong><p>day streak</p></div></div>
    <div class="progress-track" aria-label="Collection progress"><div style="width:${(count / catalog.length) * 100}%"></div></div>
    ${!state.user ? '<p class="notice">Only your latest guest roll per UTC day is kept for this browser. <a href="/signup" data-link>Create an account</a> to keep a permanent daily collection.</p>' : ""}
    ${
      count
        ? `<div class="badge-grid">${sorted
            .map((b) => {
              const level = badgeLevel(b.count);
              return `<button class="badge-card tier-${e(b.tier)}" data-badge="${e(b.id)}" data-testid="badge-card"><span class="badge-card-icon">${e(b.icon)}</span><div><div class="badge-card-top"><h2>${e(b.name)}</h2><strong>${format(b.ep)} <small>EP</small></strong></div><p>${e(b.description)}</p><div class="badge-card-bottom"><span class="stars">${level.level <= 5 ? "★".repeat(level.level) : `★ × ${level.level}`}</span><span>Earned ${format(b.count)} time${b.count === 1 ? "" : "s"}</span></div><div class="mini-progress"><div style="width:${Math.round(level.progress * 100)}%"></div></div></div></button>`;
            })
            .join("")}</div>`
        : '<div class="empty-state"><span>✧</span><h2>A collection starts with one roll.</h2><p>Generate today’s number to discover your first badges.</p><a class="button primary" href="/" data-link>Roll your number</a></div>'
    }
    <a class="button" href="/badges" data-link>Explore undiscovered badges →</a>
  </section>`;
}
export function history({ state }, override) {
  const data = override || state;
  return `<section class="page">${pageHeading(override ? `${e(data.user.username)}’s roll history` : "Your roll history", "A new number, every day. All dates use UTC.")}
    <div class="stats-grid"><div class="panel"><strong>${format(data.stats.rolls)}</strong><span>Rolls</span></div><div class="panel"><strong>${format(data.stats.totalEP)}</strong><span>Total EP</span></div><div class="panel"><strong>${format(data.stats.bestEP)}</strong><span>Best EP</span></div><div class="panel"><strong>${format(Math.round(data.stats.averageEP || 0))}</strong><span>Average EP</span></div></div>
    ${
      (data.history || []).length
        ? `<div class="history-list">${data.history
            .map(
              (r) =>
                `<button class="history-row panel" data-roll="${r.id}"><span class="history-date">${dateLabel(r.day)}</span><strong class="mono">${e(r.value)}</strong><span class="history-badges">${(
                  r.badges || []
                )
                  .slice(0, 3)
                  .map((b) => `<span title="${e(b.name)}">${e(b.icon)}</span>`)
                  .join(
                    "",
                  )}</span><strong>${format(r.ep)} EP</strong><span aria-hidden="true">→</span></button>`,
            )
            .join("")}</div>`
        : '<div class="empty-state"><span>◷</span><h2>No rolls yet.</h2><p>Today’s number is waiting for you.</p><a class="button primary" href="/" data-link>Roll your number</a></div>'
    }
    ${!state.user && !override ? '<p class="small-note">Create an account to keep your history across devices.</p>' : ""}
  </section>`;
}
export function leaderboard({ state }, scope = "daily", metric = "total") {
  const rows = [
    ...(state.leaderboard?.[
      metric === "average" && scope !== "badges" ? scope + "Average" : scope
    ] ||
      state.leaderboard?.[scope] ||
      []),
  ];
  if (metric === "average") rows.sort((a, b) => b.averageEP - a.averageEP);
  const title =
    scope === "badges"
      ? "Badges collected"
      : metric === "average"
        ? "Average EP"
        : "Total EP";
  return `<section class="page">${pageHeading("Leaderboard", "A little luck. A lot of possibility.")}
    <div class="filter-tabs leaderboard-tabs">${[
      ["daily", "Today"],
      ["weekly", "This week"],
      ["allTime", "All-time"],
      ["badges", "Badges"],
    ]
      .map(
        ([key, label]) =>
          `<button class="${scope === key ? "active" : ""}" data-scope="${key}">${label}</button>`,
      )
      .join("")}</div>
    ${scope !== "badges" ? `<div class="segmented metric-tabs"><button data-metric="total" class="${metric === "total" ? "active" : ""}">Total</button><button data-metric="average" class="${metric === "average" ? "active" : ""}">Average</button></div>` : ""}
    <div class="leaderboard-table panel"><div class="leaderboard-head"><span>Rank</span><span>Player</span><span>${title}</span></div>${rows.length ? rows.map((r, i) => `<a class="leaderboard-row ${state.user?.id === r.userId ? "you" : ""}" href="/u/${encodeURIComponent(r.username)}" data-link><span class="rank ${i < 3 ? "podium" : ""}">${i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span><span class="player"><strong style="color:${/^#[a-fA-F0-9]{6}$/.test(r.nameColor || "") ? r.nameColor : "inherit"}">${e(r.username)}</strong>${state.user?.id === r.userId ? "<small>You</small>" : ""}<small>${format(r.rolls)} roll${r.rolls === 1 ? "" : "s"}</small></span><strong>${format(scope === "badges" ? r.uniqueBadges : metric === "average" ? Math.round(r.averageEP) : r.totalEP)}${scope === "badges" ? "" : " EP"}</strong></a>`).join("") : '<div class="empty-state"><span>♜</span><h2>A fresh leaderboard.</h2><p>Sign up and roll to claim your place.</p><a class="button" href="/signup" data-link>Create an account</a></div>'}</div>
    <p class="small-note">Today resets at 00:00 UTC. This week starts Monday at 00:00 UTC. Only account rolls appear here.</p>
  </section>`;
}
export function profile(ctx, data) {
  const username = data.user.username;
  return `<section class="page"><div class="profile-heading"><div class="avatar">${e(username[0].toUpperCase())}</div>${pageHeading(e(username), `Joined ${dateLabel(data.user.createdAt)}`)}</div>
    ${
      data.user.favoriteBadgeIds?.length
        ? `<div class="badge-list">${data.user.favoriteBadgeIds
            .map((id) => ctx.catalog.find((b) => b.id === id))
            .filter(Boolean)
            .map((b) => badgeChip(b))
            .join("")}</div>`
        : ""
    }
    <div class="stats-grid"><div class="panel"><strong>${format(data.stats.totalEP)}</strong><span>Lifetime EP</span></div><div class="panel"><strong>${format(data.stats.rolls)}</strong><span>Rolls</span></div><div class="panel"><strong>${data.stats.uniqueBadges}</strong><span>Unique badges</span></div><div class="panel"><strong>${data.stats.streak}</strong><span>Day streak</span></div></div>
    <h2 class="section-title">Best roll</h2>${data.stats.bestRoll ? rollCard(data.stats.bestRoll, { compact: true }) : '<p class="muted">No rolls yet.</p>'}
    <h2 class="section-title">Top badges</h2><div class="badge-list">${
      (data.stats.badges || [])
        .slice()
        .sort((a, b) => b.ep - a.ep)
        .slice(0, 12)
        .map((b) => badgeChip(b))
        .join("") || '<p class="muted">The first discovery is still ahead.</p>'
    }</div>
    <h2 class="section-title">Roll history</h2><div class="history-list">${(data.history || []).map((r) => `<button class="history-row panel" data-roll="${r.id}"><span>${dateLabel(r.day)}</span><strong class="mono">${r.value}</strong><strong>${format(r.ep)} EP</strong><span>→</span></button>`).join("") || '<p class="muted">No rolls yet.</p>'}</div>
  </section>`;
}
export function about({ catalog }) {
  return `<article class="page prose">${pageHeading("One roll. Endless possibility.", "A daily random number game.")}
    <h2>How to play</h2><p>Press <strong>Generate</strong> to roll a number between <strong>0 and 1,000,000</strong>, inclusive. Every number is equally likely. Guests can roll as often as they like. Signed-in players get one daily roll, with the next roll unlocking at midnight UTC.</p>
    <h2>Find the patterns</h2><p>Your number is checked against ${catalog.length} badges. Palindromes, primes, repeated digits, perfect powers, and strange coincidences all have a place. Badges use the number as written, without leading zeros.</p>
    <h2>Earn EP</h2><p>Every matching badge joins your collection. EP means Expected Points. Rarer patterns generally award more EP. Related badges belong to families; only the badge worth the most EP in a family scores for that roll. Badges outside families all score.</p>
    <p>For example, a roll containing four 7s can earn several Jackpot badges. You keep all of them, and the highest scoring Jackpot contributes EP.</p>
    <h2>Build your collection</h2><p>Create an account to save rolls across devices. A badge levels up as you earn it again. Your history, total EP, and best roll grow with each daily visit.</p>
    <h2>Your rolls</h2><p>The server generates and scores every roll. Guests can keep trying, and only their latest result per UTC day is retained. Creating an account saves that latest result. Once an account has rolled, its daily number stays fixed even if you sign out, roll as a guest, and sign back in.</p>
    <h2>Your data</h2><p>Passwords are hashed. Your email stays private. Your username, rolls, badges, and EP appear on public profiles and leaderboards. Deleting your account removes your identity and access; anonymous roll records remain.</p>
    <h2>About this version</h2><p>This is an independent adaptation of <a href="https://www.rngdle.com/" target="_blank" rel="noopener">RNGdle</a>, built for the Illinois host. The supplied badge catalog is included. Social and feed features are outside this version.</p>
    <p><a class="button primary" href="/" data-link>Roll your number</a> <a class="button" href="/badges" data-link>Explore the badges</a></p>
  </article>`;
}
