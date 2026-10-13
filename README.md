# RNGdle

A random number game, adapted from rngdle.com for **https://kevincheng.web.illinois.edu**. Signed-in players get one number each day; guests can roll as often as they like. All 233 supplied badges are included. Social and feed features are excluded.

The app uses plain JavaScript, PHP 8.3, and SQLite. There is no JavaScript build step and no application package installation. Source files are split by purpose so you can find and change things quickly.

## What works

- A server-generated roll from **0 through 1,000,000**, inclusive. Every number is equally likely.
- One roll per account each UTC day, enforced even across devices and logout/login. Guests have unlimited rolls; only their latest result per UTC day is retained. Signing up saves that latest guest result. Signing in preserves any existing account roll for the day.
- All 233 badges, their original predicates, EP, scoring families, and tie order. Every matching badge is earned; only the highest EP badge in each family scores.
- Original score percentiles and roll rarity, a reset countdown, EP breakdown, and result copying.
- A slower staged reveal: digits settle from left to right in neutral colors, then the full number pauses and pops in its rarity color. Badge cards include small emojis and descriptions. They arrive from lowest to highest EP, with each new card pushing older ones down. The EP odometer counts only scoring badges. **Replay reveal** replays the same result. Reduced motion shows the result immediately; navigation safely ends the presentation.
- A prominent rarity-colored percentile line, twice its earlier size, below the rarity word. Lower rolls show “Bottom X%”; higher rolls show “Better than X%”.
- Accounts, sign in/out, verification email, password reset, username/password changes, and account deletion.
- Persistent history, public profiles, badge collections, badge levels and progress, badge/roll details, favorite badges, and name colors.
- Today, this week, all-time, and badge leaderboards; total and average EP rankings.
- A badge-word poem composer with selection, shuffle, variants, filtering, saving to a roll, and copying.
- Light/system/dark themes, reduced motion, mobile layouts, and a personal JSON export.

No leaderboard entries or rolls are seeded. A new deployment starts empty.

## Run locally

You need PHP 8.3 or newer with **PDO SQLite**. The server also uses `mbstring` when available. JavaScript runs directly in the browser.

From the project root:

```sh
php -S 127.0.0.1:8080 -t public public/router.php
```

Open **http://127.0.0.1:8080**. The default database and signing key are created in `rngdle-storage/`, outside the public directory. That directory is ignored by Git.

For local email tests, set `RNGDLE_DEV=1`. Verification and reset links are written to the private storage directory's `mail.log`. Production sends them through PHP `mail()` and does not write a development email log.

This Windows workspace has PHP and Node runtimes in the ignored `cc_mnt/runtime/` directory. This is the working PowerShell preview command:

```powershell
$env:RNGDLE_DEV = '1'
$env:RNGDLE_STORAGE = 'D:/rngdle/cc_mnt/runtime/local-storage'
& './cc_mnt/runtime/php/php.exe' `
  -d extension_dir='D:/rngdle/cc_mnt/runtime/php/ext' `
  -d extension=pdo_sqlite -d extension=sqlite3 -d extension=mbstring `
  -S 127.0.0.1:8080 -t public public/router.php
```

## Add a badge

Append a record to **`data/badges.json`**. That is the only file required for a badge using an existing rule type. For example:

```json
{
  "id": "year-2026",
  "name": "Class of 2026",
  "icon": "🎓",
  "tier": "rare",
  "ep": 12000,
  "description": "Contains 2026.",
  "odds": "1 in 333",
  "family": null,
  "rule": { "type": "contains", "patterns": ["2026"] }
}
```

The sample EP and odds are illustrative; use calculated values for your badge. IDs must be unique. Put commas between records, with no comma after the last record.

`family: null` means the badge always scores when earned. Use a shared family string when only the highest EP badge in that group should score. Optional `sourceOrder` gives an explicit tie priority. Existing records provide examples of every supported rule.

Common rules:

| Rule              | Example                                            |
| ----------------- | -------------------------------------------------- |
| Exact numbers     | `{ "type": "equals", "values": [2026] }`           |
| Contains digits   | `{ "type": "contains", "patterns": ["2026"] }`     |
| Ends with digits  | `{ "type": "suffix", "pattern": "26" }`            |
| Number of digits  | `{ "type": "length", "length": 4 }`                |
| Perfect power     | `{ "type": "integerPower", "exponent": 2 }`        |
| Exact digit count | `{ "type": "digitCount", "digit": 7, "count": 3 }` |

Refresh after editing. New rolls use the updated rules; saved rolls keep their original badges and EP. There is no frontend rebuild.

For a new rule type, add a matching switch case to **both** `public/js/badges.js` and `lib/badges.php`, then add a meaningful matcher test. Unsupported rules fail explicitly.

`data/score-distribution.json` calibrates rarity against the original 233-badge game. Changes to EP rules keep that original comparison scale. Exact percentiles for a changed catalog require recalculating the distribution across all 1,000,001 outcomes.

Record missing or unsupported source badges in **`data/missing-badges.json`**. The source audit currently records **233 implemented, zero missing**.

## Find the code

- `public/index.html` — shell, header, and navigation.
- `public/css/style.css` — layout, themes, badge colors, and animation.
- `public/js/app.js` — routing, state, daily rolling, and event handling.
- `public/js/reveal.js` — cancellable digit reels, number pop, ascending badge reveals, and EP odometer. Timing values are next to each reveal step.
- `public/js/views.js` — game, collection, history, leaderboard, profile, and about views.
- `public/js/account.js` — account and settings forms.
- `public/js/poetry.js` — poem words and composer view.
- `public/js/ui.js`, `api.js` — shared presentation and HTTP client.
- `data/badges.json`, `public/js/badges.js`, `lib/badges.php` — catalog and matching rules.
- `public/api.php` — JSON API actions.
- `lib/database.php` — SQLite schema, migrations, history, stats, and rankings.
- `lib/auth.php` — passwords, sessions, guest identity, CSRF, and email tokens.
- `public/router.php` — localhost routing; Apache uses `public/.htaccess`.

The browser never chooses a daily number or score. Server rolls use PHP `random_int`. Passwords use PHP's password hashing API. Email tokens are stored as hashes, expire, and work once. All state changes require a CSRF token.

## Test

Matcher checks need Node; PHP parity also needs PHP:

```sh
node tests/badges.test.mjs
node tests/badges.test.mjs --php php
php tests/badges.test.php
```

Optional `--reference cc_mnt/reference/d38724ddf7b90968.js` compares the clone with the retained public reference bundle. That bundle is never deployed.

With localhost running:

```sh
python tests/backend_test.py
python tests/browser_test.py
```

Browser tests need Python Playwright and a browser. Set `BROWSER_CHANNEL=chrome` for installed Chrome. `BASE_URL` changes the localhost port. `RNGDLE_TEST_MAIL_LOG` points to the development email log for verification/reset tests. Mutation tests refuse public hosts and remove temporary accounts.

Initial validation covered **11,529 reference/PHP/JS matcher comparisons**, six backend cases, and four browser cases, including mobile overflow and theme persistence.

## Deploy on Illinois hosting

Keep private code and data outside `public_html`. Deploy a dated private release containing `lib/` and `data/`, upload only `public/` into `public_html`, and retain cPanel's PHP configuration. Never upload credentials, `cc_mnt/`, tests, or local databases.

Merge `public/.htaccess` with the host configuration and set:

```apache
SetEnv RNGDLE_APP_ROOT /home/kevincheng/rngdle-releases/RELEASE_NAME
SetEnv RNGDLE_STORAGE /home/kevincheng/rngdle-storage
SetEnv RNGDLE_URL https://kevincheng.web.illinois.edu
SetEnv RNGDLE_MAIL_FROM no-reply@kevincheng.web.illinois.edu
```

Do not set `RNGDLE_DEV` in production. The host needs PHP with PDO SQLite, Apache rewrite support, and a working mail transport. `.htaccess` serves routes such as `/badges` and `/settings`, denies private paths, and disables directory listings.

Back up the public files and private database before an update. Changing the release path does not move the database. Existing rows remain intact; schema additions run automatically. Keep the previous release and public backup until a live smoke test passes.

## Data and attribution

Emails and password hashes are private. Usernames, rolls, badges, and EP are public. Deleting an account removes its identity, credentials, profile, preferences, tokens, and saved poems. Rolls remain anonymous and cannot be reclaimed. There is no 2FA and no option to delete individual rolls. No friend or feed data is stored.

This project adapts RNGdle's public rules and the supplied badge table. It is not affiliated with the original service. The repository retains its existing license. Inter and Space Mono use the SIL Open Font License; texts are in `public/fonts/`. For copyright claims, contact Nynst on Discord, as specified in the original repository notes.
