import { escapeHTML as e, badgeChip } from "./ui.js";
import { pageHeading } from "./views.js";
export function authPage(mode, token = "") {
  const config = {
    signin: ["Welcome back.", "Sign in to your daily luck.", "Sign in"],
    signup: [
      "Save a little luck.",
      "Keep your rolls, collect badges, and climb the leaderboard.",
      "Create account",
    ],
    forgot: [
      "Reset your password.",
      "We’ll email you a link to choose a new password.",
      "Send reset link",
    ],
    reset: [
      "A fresh start.",
      "Choose a new password for your account.",
      "Save password",
    ],
    verify: [
      "Verify your email.",
      "Confirm your email to finish setting up your account.",
      "Verify email",
    ],
  }[mode];
  return `<section class="page auth-page">${pageHeading(config[0], config[1])}
    <form class="panel auth-form" data-form="${mode}">
      ${token ? `<input type="hidden" name="token" value="${e(token)}">` : ""}
      ${mode === "signup" ? '<label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" placeholder="Your lucky name"><small>3–24 letters, numbers, or underscores</small></label>' : ""}
      ${mode === "signin" ? '<label>Email or username<input name="identity" autocomplete="username" required placeholder="you@example.com"></label>' : ""}
      ${["signup", "forgot"].includes(mode) ? '<label>Email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>' : ""}
      ${["signin", "signup", "reset"].includes(mode) ? `<label>Password<input name="password" type="password" autocomplete="${mode === "signin" ? "current-password" : "new-password"}" required minlength="${mode === "signin" ? 1 : 8}" maxlength="72" placeholder="${mode === "signin" ? "Your password" : "At least 8 characters"}"></label>` : ""}
      ${mode === "verify" && !token ? '<label>Verification token<input name="token" required placeholder="Token from your email"></label>' : ""}
      <p class="form-error" role="alert"></p>
      <button class="button primary" type="submit">${config[2]}</button>
      ${mode === "signup" ? '<p class="small-note">Your username and rolls will be public. Your email stays private.</p>' : ""}
    </form>
    <p class="auth-links">${mode === "signin" ? '<a href="/forgot-password" data-link>Forgot password?</a><br>New here? <a href="/signup" data-link>Create an account</a>' : mode === "signup" ? 'Already have an account? <a href="/signin" data-link>Sign in</a>' : '<a href="/signin" data-link>Back to sign in</a>'}</p>
  </section>`;
}
export function settings({ state, catalog }) {
  const user = state.user;
  const theme = localStorage.getItem("rngdle_theme") || "system";
  return `<section class="page settings-page">${pageHeading("Settings", "Make yourself at home.")}
    <section class="panel settings-section"><h2>Appearance</h2><label class="setting-row"><span>Theme<small>Choose the look of your game.</small></span><select id="theme-select" aria-label="Theme">${["light", "system", "dark"].map((t) => `<option value="${t}"${theme === t ? " selected" : ""}>${t[0].toUpperCase() + t.slice(1)}</option>`).join("")}</select></label><label class="setting-row"><span>Reduce motion<small>Skip the rolling animation.</small></span><input id="reduce-motion" type="checkbox"${localStorage.getItem("rngdle_motion") === "reduced" ? " checked" : ""}></label></section>
    ${
      user
        ? `<section class="panel settings-section"><h2>Your account</h2><p><strong>${e(user.username)}</strong> · ${e(user.email)}</p><p class="muted">${user.verified ? "✓ Email verified" : "Email not verified yet."}${user.verified ? "" : ' <button class="text-button" data-action="resendVerification">Resend verification email</button>'}</p>
      <form data-form="profile" class="settings-form"><label>Name color<input name="nameColor" type="color" value="${/^#[a-fA-F0-9]{6}$/.test(user.nameColor || "") ? user.nameColor : "#111827"}"></label><fieldset><legend>Favorite badges <small>Choose up to two badges you have earned.</small></legend><div class="favorite-options">${(state.stats.badges || []).map((b) => `<label class="favorite-option"><input type="checkbox" name="favoriteBadgeIds" value="${e(b.id)}"${(user.favoriteBadgeIds || []).includes(b.id) ? " checked" : ""}><span>${e(b.icon)} ${e(b.name)}</span></label>`).join("") || '<p class="muted">Roll to discover your first badges.</p>'}</div></fieldset><p class="form-error" role="alert"></p><button class="button" type="submit">Save profile</button></form>
      <a class="button small" href="/u/${encodeURIComponent(user.username)}" data-link>View your profile →</a>
    </section>
    <section class="panel settings-section"><h2>Change username</h2><form data-form="username" class="settings-form"><label>New username<input name="username" value="${e(user.username)}" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+"></label><label>Current password<input name="password" type="password" required autocomplete="current-password"></label><p class="form-error" role="alert"></p><button class="button" type="submit">Change username</button></form></section>
    <section class="panel settings-section"><h2>Change password</h2><form data-form="password" class="settings-form"><label>Current password<input name="currentPassword" type="password" required autocomplete="current-password"></label><label>New password<input name="password" type="password" required minlength="8" maxlength="72" autocomplete="new-password"></label><p class="form-error" role="alert"></p><button class="button" type="submit">Change password</button></form></section>
    <section class="panel settings-section"><h2>Your data</h2><p>Download your rolls and badge collection as a JSON file.</p><button class="button" data-action="export">Download my data</button></section>
    <section class="panel settings-section"><button class="button" data-action="logout">Sign out</button></section>
    <details class="panel settings-section danger-zone"><summary>Delete account</summary><p>This removes your account, email, password, and access to your history. Your rolls remain anonymous. This cannot be undone.</p><form data-form="delete" class="settings-form"><label>Current password<input name="password" type="password" required autocomplete="current-password"></label><label class="check-label"><input type="checkbox" required> I understand that my account will be deleted.</label><p class="form-error" role="alert"></p><button class="button danger" type="submit">Delete my account</button></form></details>`
        : `<section class="panel settings-section"><h2>Keep your discoveries</h2><p>Create an account to save rolls across devices and personalize your profile.</p><a class="button primary" href="/signup" data-link>Create an account</a> <a class="button" href="/signin" data-link>Sign in</a></section>`
    }
  </section>`;
}
