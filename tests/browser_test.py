"""Check the actual UI on localhost: python tests/browser_test.py.

Requires Playwright and Chromium. BASE_URL defaults to 127.0.0.1:8080.
Set BROWSER_CHANNEL=chrome or msedge to use an installed browser.
"""

import ipaddress
import copy
import json
import os
import re
import unittest
import urllib.parse
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8080").rstrip("/")


class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        host = urllib.parse.urlsplit(BASE_URL).hostname
        if host != "localhost" and not ipaddress.ip_address(host or "").is_loopback:
            raise RuntimeError("Browser mutation tests may only run on localhost.")
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            channel=os.environ.get("BROWSER_CHANNEL") or None
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 1000})
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.context.close()
        self.assertEqual([], self.errors, "Uncaught JavaScript errors")

    def visit(self, path="/"):
        response = self.page.goto(BASE_URL + path)
        self.assertEqual(200, response.status)
        self.page.wait_for_load_state("networkidle")

    def mock_reveal_roll(self, hold_response=False, rarity="rare", percentile=85):
        """Drive presentation with a fixed server result, without creating a roll."""
        catalog = json.loads((Path(__file__).resolve().parents[1] / "data/badges.json")
                             .read_text(encoding="utf-8"))
        badges = []
        for badge_id, ep, scoring in (("clean", 20000, True), ("even", 200, True),
                                       ("semi-clean", 5000, True),
                                       ("equilibrium", 1000, False)):
            badge = copy.deepcopy(next(b for b in catalog if b["id"] == badge_id))
            badge.update(ep=ep, isScoring=scoring)
            badges.append(badge)
        initial = self.context.request.get(BASE_URL + "/api.php?action=state").json()
        initial.update(user=None, today=None, history=[], bestRoll=None,
                       leaderboard={"daily": [], "weekly": [], "allTime": [], "badges": []})
        initial["stats"] = {"rolls": 0, "totalEP": 0, "bestEP": 0,
                            "averageEP": 0, "uniqueBadges": 0, "streak": 0, "badges": []}
        roll = {"id": 987654321, "value": 1000000, "ep": 25200, "badges": badges,
                "day": initial["day"], "createdAt": initial["serverTime"],
                "rarity": rarity, "percentile": percentile, "poem": None}
        completed = copy.deepcopy(initial)
        completed.update(today=roll, history=[roll])
        completed["stats"].update(rolls=1, totalEP=roll["ep"], bestEP=roll["ep"],
                                  averageEP=roll["ep"], uniqueBadges=len(badges),
                                  streak=1, badges=badges)
        fixture = {"roll": roll, "requests": 0, "pending": None, "rolled": False}

        def route_api(route):
            action = urllib.parse.parse_qs(urllib.parse.urlsplit(route.request.url).query)
            action = action.get("action", [""])[0]
            if action == "state":
                route.fulfill(json=completed if fixture["rolled"] else initial)
            elif action == "roll":
                fixture["requests"] += 1
                fixture["rolled"] = True
                body = {"roll": roll, "state": completed, "alreadyRolled": False}
                if hold_response:
                    fixture["pending"] = (route, body)
                else:
                    route.fulfill(json=body)
            else:
                route.continue_()

        self.page.route("**/api.php?action=*", route_api)
        return fixture

    def wait_for_reveal(self):
        card = self.page.locator(".home.result .roll-card").first
        expect(card).to_be_visible()
        expect(card).to_have_attribute("aria-busy", "false", timeout=60000)
        return card

    def test_guest_can_generate_repeatedly_and_reload_keeps_latest_result(self):
        self.page.add_init_script("localStorage.setItem('rngdle_motion', 'reduced')")
        self.visit()
        expect(self.page.get_by_role("link", name=re.compile("Sign in")).first).to_be_visible()
        button = self.page.get_by_test_id("roll-button")
        expect(button).to_be_enabled()
        roll_ids = []
        for _ in range(3):
            with self.page.expect_response("**/api.php?action=roll") as response:
                button.click()
            self.assertEqual(200, response.value.status)
            body = response.value.json()
            self.assertFalse(body["alreadyRolled"])
            roll_ids.append(body["roll"]["id"])
            self.wait_for_reveal()
            value = self.page.get_by_test_id("roll-value")
            expect(value).to_have_text(re.compile(r"^[\d,]+$"))
            number = int(value.inner_text().replace(",", ""))
            self.assertGreaterEqual(number, 0)
            self.assertLessEqual(number, 1_000_000)
            self.assertEqual(body["roll"]["value"], number)
            expect(button).to_be_enabled()
        self.assertEqual(3, len(set(roll_ids)), "Each guest Generate should create a fresh roll")
        self.page.reload()
        expect(value).to_have_text(re.compile(r"^[\d,]+$"))
        self.assertEqual(number, int(value.inner_text().replace(",", "")))
        expect(self.page.get_by_test_id("roll-button")).to_be_enabled()

    def test_routes_and_badge_search(self):
        for path in ("/collection", "/history", "/leaderboard", "/settings", "/about"):
            self.visit(path)
            expect(self.page.locator("main")).to_be_visible()
        self.visit("/badges")
        cards = self.page.get_by_test_id("badge-card")
        expect(cards).to_have_count(233)
        search = self.page.get_by_label("Search badges", exact=True)
        search.fill("prime")
        self.assertGreater(cards.count(), 0)
        self.assertLess(cards.count(), 233)
        search.fill("missing-badge-that-does-not-exist")
        expect(cards).to_have_count(0)
        search.fill("")
        expect(cards).to_have_count(233)
        cards.first.click()
        expect(self.page.locator("#detail-dialog")).to_be_visible()
        expect(self.page.locator("#detail-dialog h2")).not_to_be_empty()
        self.page.locator(".dialog-close").click()
        expect(self.page.locator("#detail-dialog")).not_to_be_visible()

    def test_mobile_layout_and_theme_persistence(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        for path in ("/", "/badges", "/collection", "/history", "/settings",
                     "/leaderboard", "/about", "/poetry", "/signin", "/signup"):
            self.visit(path)
            self.assertTrue(self.page.evaluate(
                "document.documentElement.scrollWidth <= window.innerWidth"
            ), f"Horizontal overflow on {path}")
        self.visit("/settings")
        theme = self.page.get_by_label("Theme", exact=True)
        theme.select_option("dark")
        expect(self.page.locator("html")).to_have_attribute("data-theme", "dark")
        self.page.reload()
        expect(self.page.locator("html")).to_have_attribute("data-theme", "dark")

    def test_account_forms_migrate_roll_and_save_poem(self):
        # Account persistence does not need to replay the full presentation sequence.
        self.page.add_init_script("localStorage.setItem('rngdle_motion', 'reduced')")
        suffix = uuid.uuid4().hex[:12]
        username = "ui" + suffix
        email = f"ui-{suffix}@example.test"
        password = "UI-password-" + suffix
        registered = False
        try:
            self.visit()
            self.page.get_by_test_id("roll-button").click()
            value = self.page.get_by_test_id("roll-value")
            expect(value).to_have_text(re.compile(r"^[\d,]+$"), timeout=15000)
            number = value.inner_text()
            self.visit("/signup")
            form = self.page.locator('[data-form="signup"]')
            form.get_by_label("Username", exact=False).fill(username)
            form.get_by_label("Email", exact=True).fill(email)
            form.get_by_label("Password", exact=True).fill(password)
            with self.page.expect_response("**/api.php?action=register") as response:
                form.get_by_role("button", name="Create account", exact=True).click()
            self.assertEqual(201, response.value.status)
            registered = True
            expect(self.page.locator("#account-nav")).to_contain_text(username)
            expect(self.page.get_by_test_id("roll-value")).to_have_text(number)
            expect(self.page.get_by_test_id("roll-button")).to_be_disabled()
            self.page.reload()
            expect(self.page.get_by_test_id("roll-button")).to_be_disabled()
            expect(self.page.get_by_test_id("roll-value")).to_have_text(number)
            self.visit("/collection")
            self.assertGreater(self.page.get_by_test_id("badge-card").count(), 0)
            self.visit("/history")
            expect(self.page.locator(".history-row")).to_have_count(1)
            self.page.locator(".history-row").click()
            expect(self.page.locator("#detail-dialog")).to_be_visible()
            self.page.locator(".dialog-close").click()
            self.visit("/poetry")
            self.page.locator("[data-word]").first.click()
            poem = self.page.locator("#poem-text").inner_text()
            with self.page.expect_response("**/api.php?action=savePoem") as response:
                self.page.get_by_role("button", name="Save poem", exact=True).click()
            self.assertEqual(200, response.value.status)
            self.page.reload()
            expect(self.page.locator("#poem-text")).to_have_text(poem)
            self.page.get_by_role("button", name="Clear", exact=True).click()
            expect(self.page.locator("#poem-text")).to_have_text("Your words go here…")
            expect(self.page.locator("[data-remove-word]")).to_have_count(0)
            expect(self.page.get_by_role("button", name="Save poem", exact=True)).to_be_enabled()
            with self.page.expect_response("**/api.php?action=savePoem") as response:
                self.page.get_by_role("button", name="Save poem", exact=True).click()
            self.assertEqual(200, response.value.status)
            self.page.reload()
            expect(self.page.locator("#poem-text")).to_have_text("Your words go here…")
            self.page.locator("[data-word]").first.click()
            with self.page.expect_response("**/api.php?action=savePoem") as response:
                self.page.get_by_role("button", name="Save poem", exact=True).click()
            self.assertEqual(200, response.value.status)
            self.page.reload()
            expect(self.page.locator("[data-remove-word]")).to_have_count(1)
            self.page.locator("[data-remove-word]").click()
            expect(self.page.locator("#poem-text")).to_have_text("Your words go here…")
            with self.page.expect_response("**/api.php?action=savePoem") as response:
                self.page.get_by_role("button", name="Save poem", exact=True).click()
            self.assertEqual(200, response.value.status)
            self.page.reload()
            expect(self.page.locator("#poem-text")).to_have_text("Your words go here…")
            self.visit("/settings")
            self.page.get_by_role("button", name="Sign out", exact=True).click()
            expect(self.page.get_by_test_id("roll-value")).to_have_count(0)
            expect(self.page.get_by_test_id("roll-button")).to_be_enabled()
            self.visit("/signin")
            form = self.page.locator('[data-form="signin"]')
            form.get_by_label("Email or username", exact=True).fill(username)
            form.get_by_label("Password", exact=True).fill(password)
            form.get_by_role("button", name="Sign in", exact=True).click()
            expect(self.page.locator("#account-nav")).to_contain_text(username)
            expect(self.page.get_by_test_id("roll-button")).to_be_disabled()
            expect(self.page.get_by_test_id("roll-value")).to_have_text(number)
            self.visit("/settings")
            self.page.get_by_text("Delete account", exact=True).click()
            form = self.page.locator('[data-form="delete"]')
            form.get_by_label("Current password", exact=True).fill(password)
            form.get_by_role("checkbox").check()
            with self.page.expect_response("**/api.php?action=deleteAccount") as response:
                form.get_by_role("button", name="Delete my account", exact=True).click()
            self.assertEqual(200, response.value.status)
            registered = False
            expect(self.page.locator("#account-nav")).to_contain_text("Sign in")
        finally:
            if registered:
                # Clean up this test's account even if a UI assertion failed.
                state = self.context.request.get(BASE_URL + "/api.php?action=state").json()
                if state["user"] is None:
                    response = self.context.request.post(BASE_URL + "/api.php?action=login",
                        data={"identity": email, "password": password},
                        headers={"X-CSRF-Token": state["csrf"]})
                    self.assertEqual(200, response.status)
                    state = response.json()["state"]
                response = self.context.request.post(BASE_URL + "/api.php?action=deleteAccount",
                    data={"password": password}, headers={"X-CSRF-Token": state["csrf"]})
                self.assertEqual(200, response.status, "Disposable QA account cleanup failed")

    def test_reveal_digits_badges_and_score_progress_in_order(self):
        fixture = self.mock_reveal_roll()
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.visit()
        self.page.evaluate(r"""() => {
          window.revealSamples = [];
          window.observeReveal = true;
          function observe(time) {
            const card = document.querySelector('.home.result .roll-card');
            const number = card?.querySelector('[data-testid="roll-value"]');
            const ep = card?.querySelector('[data-testid="roll-ep"]');
            const digits = [...(number?.querySelectorAll('.number-reel') || [])];
            const visible = [...(card?.querySelectorAll('.roll-badge') || [])]
              .filter(b => !b.hidden && getComputedStyle(b).visibility !== 'hidden'
                && getComputedStyle(b).display !== 'none');
            const rarityWord = document.querySelector('.home.result .rarity-word');
            const percentile = document.querySelector('.home.result .rarity-percentile');
            window.revealSamples.push({time, phase: card?.dataset.revealPhase,
              busy: card?.getAttribute('aria-busy'),
              pop: number?.classList.contains('number-pop') || false,
              neutral: number?.classList.contains('number-unrevealed') || false,
              numberColor: number ? getComputedStyle(number).color : null,
              rarityBottom: percentile?.getBoundingClientRect().bottom,
              epBottom: ep?.getBoundingClientRect().bottom,
              rarityColor: rarityWord ? getComputedStyle(rarityWord).color : null,
              settled: digits.map(d => d.dataset.settled === 'true'
                || d.classList.contains('digit-settled')),
              digits: digits.map(d => d.dataset.final),
              badgeIds: visible.map(b => b.dataset.badge),
              badgePositions: visible.map(b => ({id: b.dataset.badge,
                top: b.getBoundingClientRect().top, bottom: b.getBoundingClientRect().bottom})),
              overflow: document.documentElement.scrollWidth > innerWidth,
              epRows: [...(ep?.querySelectorAll('.ep-reel') || [])]
                .filter(r => getComputedStyle(r).display !== 'none')
                .map(r => Math.abs(Number(r.firstElementChild.style.transform
                  .match(/translateY\(([-.0-9]+)em\)/)?.[1] || 0)) / 1.15),
              ep: ep ? Number(ep.dataset.value ?? ep.textContent.replace(/[^0-9]/g, '')) : 0});
            if (window.observeReveal) requestAnimationFrame(observe);
          }
          requestAnimationFrame(observe);
        }""")
        self.page.get_by_test_id("roll-button").click()
        card = self.wait_for_reveal()
        samples = self.page.evaluate("""() => new Promise(resolve => requestAnimationFrame(() => {
          window.observeReveal = false;
          resolve(window.revealSamples);
        }))""")
        samples = [s for s in samples if s.get("phase")]
        self.assertTrue(samples, "The result should expose its live reveal state")
        self.assertFalse(any(s["overflow"] for s in samples),
                         "The maximum seven-digit reveal should fit on a phone")
        digit_samples = [s for s in samples if len(s["settled"]) == 7]
        self.assertTrue(digit_samples, "Seven-digit maximum roll must not be truncated")
        self.assertTrue(any(0 < sum(s["settled"]) < 7 for s in digit_samples),
                        "Players should see the number resolve one digit at a time")
        settled_times = []
        for index in range(7):
            settled = next(s for s in digit_samples if s["settled"][index])
            settled_times.append(settled["time"])
            self.assertEqual(list("1000000"), settled["digits"])
        self.assertEqual(sorted(settled_times), settled_times)
        self.assertTrue(all(b > a for a, b in zip(settled_times, settled_times[1:])),
                        "Each digit should settle after the preceding digit")
        spinning = next(s for s in samples if s["phase"] == "spinning")
        self.assertGreater(settled_times[0] - spinning["time"], 1000,
                           "The initial rolling sequence should be slower")
        self.assertGreater(settled_times[-1] - settled_times[0], 5500,
                           "Successive digit reveals should take roughly twice as long")
        self.assertTrue(all(s["neutral"] for s in samples
                            if s["phase"] in ("spinning", "digits", "pause")),
                        "Rarity color should stay hidden until the full number reveal")
        neutral_color = self.page.evaluate("""() => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--text)';
          document.body.append(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return color;
        }""")
        self.assertTrue(all(s["numberColor"] == neutral_color for s in samples
                            if s["phase"] in ("spinning", "digits", "pause")),
                        "Every unresolved digit must use the normal neutral text color")
        for sample in digit_samples:
            count = sum(sample["settled"])
            self.assertEqual([True] * count + [False] * (7 - count), sample["settled"])
        pop = next(s for s in samples if s["pop"])
        self.assertGreater(pop["time"] - settled_times[-1], 1100,
                           "The full number should pause before its final pop")
        self.assertTrue(all(all(s["settled"]) for s in digit_samples
                            if s["time"] >= pop["time"]))
        expected_ids = [b["id"] for b in sorted(fixture["roll"]["badges"],
                                                key=lambda b: b["ep"])]
        reveal_times = []
        for count in range(1, 5):
            sample = next(s for s in samples if len(s["badgeIds"]) == count)
            reveal_times.append(sample["time"])
            self.assertEqual(list(reversed(expected_ids[:count])), sample["badgeIds"],
                             "The newest badge should appear above the older badges")
            self.assertGreaterEqual(sample["time"], pop["time"])
            self.assertGreaterEqual(sample["badgePositions"][0]["top"],
                                    max(sample["epBottom"], sample["rarityBottom"]),
                                    "The badge stack should appear beneath the EP and rarity")
        stack_samples = [next(s for s in reversed(samples)
                              if len(s["badgeIds"]) == count) for count in range(1, 5)]
        for before, after in zip(stack_samples, stack_samples[1:]):
            old_positions = {b["id"]: b["top"] for b in before["badgePositions"]}
            new_positions = {b["id"]: b["top"] for b in after["badgePositions"]}
            self.assertTrue(all(new_positions[badge_id] > top + 10
                                for badge_id, top in old_positions.items()),
                            "A new badge should visibly push each existing badge down")
        gaps = [b - a for a, b in zip(reveal_times, reveal_times[1:])]
        self.assertGreater(gaps[-1], gaps[0] + 70,
                           "Higher-value badges should arrive with a longer wait")
        ep_values = [s["ep"] for s in samples]
        decreases = [(a["time"], a["ep"], b["time"], b["ep"], b["phase"])
                     for a, b in zip(samples, samples[1:]) if b["ep"] < a["ep"]]
        self.assertFalse(decreases, "EP must always count upward")
        badge_by_id = {b["id"]: b for b in fixture["roll"]["badges"]}
        for sample in samples:
            target = sum(badge_by_id[b]["ep"] for b in sample["badgeIds"]
                         if badge_by_id[b]["isScoring"])
            self.assertLessEqual(sample["ep"], target,
                                 "Unrevealed and non-scoring badges cannot add EP")
        self.assertTrue(any(200 < ep < 5200 for ep in ep_values),
                        "EP should visibly count between badge totals")
        for count, target in ((1, 200), (3, 5200)):
            pauses = [s for s in samples if len(s["badgeIds"]) == count
                      and s["ep"] == target and s["epRows"]]
            self.assertTrue(pauses, "EP should reach the badge subtotal before advancing")
            for sample in pauses:
                self.assertEqual(len(str(target)), len(sample["epRows"]))
                for row, digit in zip(sample["epRows"], str(target)):
                    self.assertAlmostEqual(int(digit), row, places=5,
                                           msg="Visible EP reels must display the settled subtotal")
        self.assertEqual(25200, ep_values[-1])
        expect(card.locator("[data-testid=roll-value]")).to_have_text("1000000")
        expect(card.locator("[data-testid=roll-ep]")).to_have_text("25,200")
        self.assertFalse(samples[-1]["neutral"])
        self.assertEqual(samples[-1]["rarityColor"], samples[-1]["numberColor"])
        for badge in fixture["roll"]["badges"]:
            node = card.locator(f'.roll-badge[data-badge="{badge["id"]}"]')
            expect(node.locator(".badge-emoji")).to_have_text(badge["icon"])
            expect(node.locator(".badge-description")).to_have_text(badge["description"])
        self.assertEqual(1, fixture["requests"])

        self.page.get_by_role("button", name=re.compile("Replay reveal")).click()
        expect(card).to_have_attribute("data-reveal-phase", "spinning")
        expect(card).to_have_attribute("aria-busy", "true")
        expect(card.locator("[data-testid=roll-ep]")).to_have_attribute("data-value", "0")
        self.assertEqual(1, fixture["requests"], "Replay must reuse the saved roll")
        self.page.locator('.bottom-nav a[href="/history"]').click()
        expect(self.page.locator(".history-row")).to_have_count(1)
        expect(self.page.locator(".history-row")).to_contain_text("1000000")
        expect(self.page.locator(".history-row")).to_contain_text("25,200 EP")
        self.page.locator(".brand").click()
        card = self.wait_for_reveal()
        expect(card.locator("[data-testid=roll-value]")).to_have_text("1000000")
        expect(card.locator("[data-testid=roll-ep]")).to_have_text("25,200")
        self.assertEqual(4, card.locator(".roll-badge:visible").count())
        self.assertEqual(1, fixture["requests"])

    def check_reduced_reveal(self, system):
        fixture = self.mock_reveal_roll()
        if system:
            self.page.emulate_media(reduced_motion="reduce")
        else:
            self.page.add_init_script("localStorage.setItem('rngdle_motion', 'reduced')")
        self.visit()
        self.page.get_by_test_id("roll-button").click()
        card = self.page.locator(".home.result .roll-card").first
        expect(card).to_have_attribute("aria-busy", "false", timeout=1500)
        expect(card.locator("[data-testid=roll-value]")).to_have_text("1000000")
        expect(card.locator("[data-testid=roll-ep]")).to_have_text("25,200")
        self.assertEqual(4, card.locator(".roll-badge:visible").count())
        expect(card.locator(".number-pop")).to_have_count(0)
        expect(card.locator(".number-unrevealed")).to_have_count(0)
        expect(card.locator(".badge-pending:visible")).to_have_count(0)
        expected_ids = [b["id"] for b in sorted(fixture["roll"]["badges"],
                                                key=lambda b: b["ep"], reverse=True)]
        self.assertEqual(expected_ids, card.locator(".roll-badge").evaluate_all(
            "nodes => nodes.map(node => node.dataset.badge)"))
        expect(self.page.get_by_test_id("roll-button")).to_be_enabled()
        self.assertEqual(1, fixture["requests"])

    def test_system_reduced_motion_finishes_reveal_immediately(self):
        self.check_reduced_reveal(system=True)

    def test_setting_reduced_motion_finishes_reveal_immediately(self):
        self.check_reduced_reveal(system=False)

    def test_navigation_during_reveal_keeps_saved_result_without_replaying(self):
        fixture = self.mock_reveal_roll()
        self.visit()
        self.page.get_by_test_id("roll-button").click()
        card = self.page.locator(".home.result .roll-card").first
        expect(card).to_have_attribute("data-reveal-phase", "digits", timeout=5000)
        self.page.locator('.bottom-nav a[href="/history"]').click()
        expect(self.page.get_by_role("heading", name="Your roll history")).to_be_visible()
        expect(self.page.locator(".history-row")).to_have_count(1)
        self.page.locator(".brand").click()
        card = self.wait_for_reveal()
        expect(card.locator("[data-testid=roll-value]")).to_have_text("1000000")
        expect(card.locator("[data-testid=roll-ep]")).to_have_text("25,200")
        self.assertEqual(4, card.locator(".roll-badge:visible").count())
        self.page.reload()
        card = self.wait_for_reveal()
        expect(card.locator("[data-testid=roll-value]")).to_have_text("1000000")
        expect(card.locator("[data-testid=roll-ep]")).to_have_text("25,200")
        expect(self.page.get_by_test_id("roll-button")).to_be_enabled()
        self.assertEqual(1, fixture["requests"])

    def test_navigation_while_roll_request_pending_stays_on_selected_page(self):
        fixture = self.mock_reveal_roll(hold_response=True)
        self.visit()
        self.page.get_by_test_id("roll-button").click()
        self.assertIsNotNone(fixture["pending"])
        self.page.locator('.bottom-nav a[href="/badges"]').click()
        expect(self.page.get_by_role("heading", name="All badges", exact=True)).to_be_visible()
        route, body = fixture["pending"]
        route.fulfill(json=body)
        # Wait for fetch continuation, then verify it does not replace the chosen page.
        self.page.wait_for_timeout(1100)
        expect(self.page.get_by_role("heading", name="All badges", exact=True)).to_be_visible()
        self.page.locator(".brand").click()
        card = self.wait_for_reveal()
        expect(card.locator("[data-testid=roll-value]")).to_have_text("1000000")
        self.assertEqual(1, fixture["requests"])

    def test_percentile_is_large_colored_and_below_rarity_word(self):
        self.page.add_init_script("localStorage.setItem('rngdle_motion', 'reduced')")
        for tier, percentile, expected in (
                ("trash", 0, "Bottom 0.00%"),
                ("common", 15, "Bottom 15.00%"),
                ("uncommon", 49.5, "Bottom 49.50%"),
                ("rare", 50, "Better than 50.00%"),
                ("epic", 85, "Better than 85.00%"),
                ("anomaly", 99, "Better than 99.00%"),
                ("mythic", 100, "Better than 100.0000%")):
            with self.subTest(tier=tier, percentile=percentile):
                self.page.unroute("**/api.php?action=*")
                self.mock_reveal_roll(rarity=tier, percentile=percentile)
                self.visit()
                self.page.get_by_test_id("roll-button").click()
                self.wait_for_reveal()
                word = self.page.locator(".home.result .rarity-word")
                line = self.page.locator(".home.result .rarity-percentile")
                expect(word).to_have_text(tier)
                expect(line).to_contain_text(expected)
                layout = self.page.evaluate("""() => {
                  const word = document.querySelector('.home.result .rarity-word');
                  const line = document.querySelector('.home.result .rarity-percentile');
                  const number = document.querySelector('.home.result .roll-number');
                  return {wordBottom: word.getBoundingClientRect().bottom,
                    lineTop: line.getBoundingClientRect().top,
                    fontSize: parseFloat(getComputedStyle(line).fontSize),
                    wordColor: getComputedStyle(word).color,
                    lineColor: getComputedStyle(line).color,
                    numberColor: getComputedStyle(number).color};
                }""")
                self.assertGreaterEqual(layout["lineTop"], layout["wordBottom"])
                self.assertEqual(24, layout["fontSize"], "The 12px percentile should be doubled")
                self.assertEqual(layout["wordColor"], layout["lineColor"])
                self.assertEqual(layout["wordColor"], layout["numberColor"])
                self.assertTrue(self.page.evaluate(
                    "document.documentElement.scrollWidth <= window.innerWidth"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
