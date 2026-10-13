"""Exercise the real local PHP API: python tests/backend_test.py.

Set BASE_URL to a loopback URL when using a different local port. These tests
create disposable accounts and clean them up; they refuse nonlocal hosts.
"""

import http.cookiejar
from contextlib import closing
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid


BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8080").rstrip("/")


def require_local_url():
    host = urllib.parse.urlsplit(BASE_URL).hostname
    if host == "localhost":
        return
    try:
        if ipaddress.ip_address(host or "").is_loopback:
            return
    except ValueError:
        pass
    raise RuntimeError("Mutation tests may only run against localhost.")


class Client:
    def __init__(self):
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies)
        )
        self.csrf = None

    def request(self, action, body=None, csrf=True, raw=None, method=None, query=None):
        headers = {"Accept": "application/json"}
        if body is not None or raw is not None:
            headers["Content-Type"] = "application/json"
        if csrf and self.csrf:
            headers["X-CSRF-Token"] = self.csrf
        data = raw if raw is not None else (
            json.dumps(body).encode() if body is not None else None
        )
        request = urllib.request.Request(
            BASE_URL + "/api.php?" + urllib.parse.urlencode({"action": action, **(query or {})}),
            data=data,
            headers=headers,
            method=method,
        )
        try:
            response = self.opener.open(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            payload = response.read().decode()
            result = json.loads(payload)
            if isinstance(result, dict) and result.get("csrf"):
                self.csrf = result["csrf"]
            if isinstance(result, dict) and result.get("state", {}).get("csrf"):
                self.csrf = result["state"]["csrf"]
            return response.status, result

    def state(self):
        status, state = self.request("state")
        if status != 200:
            raise AssertionError(f"State returned {status}: {state}")
        return state


class BackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        require_local_url()

    def setUp(self):
        self.client = Client()
        self.state = self.client.state()

    def assert_success(self, response):
        status, payload = response
        self.assertGreaterEqual(status, 200, payload)
        self.assertLess(status, 300, payload)
        self.assertNotIn("error", payload)
        return payload

    def test_state_and_complete_public_catalog(self):
        for field in ("user", "csrf", "today", "stats", "history", "leaderboard",
                      "nextReset", "day", "serverTime"):
            self.assertIn(field, self.state)
        self.assertIsNone(self.state["today"])
        self.assertEqual([], self.state["history"])
        self.assertTrue(self.state["csrf"])
        catalog = self.assert_success(self.client.request("catalog"))
        self.assertEqual(233, len(catalog["badges"]))
        self.assertEqual(233, len({badge["id"] for badge in catalog["badges"]}))
        self.assertIn("missing", catalog)

    def test_roll_rejects_missing_csrf_and_get(self):
        status, _ = self.client.request("roll", {}, csrf=False)
        self.assertEqual(403, status)
        self.assertIsNone(self.client.state()["today"])
        status, _ = self.client.request("roll", method="GET")
        self.assertIn(status, (404, 405))
        self.assertIsNone(self.client.state()["today"])

    def test_malformed_json_has_no_effect(self):
        status, _ = self.client.request("roll", raw=b'{"number":')
        self.assertEqual(400, status)
        self.assertIsNone(self.client.state()["today"])

    def test_guest_rolls_are_unlimited_server_generated_and_save_latest(self):
        result = self.assert_success(self.client.request("roll", {
            "number": -1, "value": -1, "score": 10**30,
            "day": "2099-01-01", "badges": ["fake-client-badge"],
        }))
        self.assertFalse(result["alreadyRolled"])
        first = self.client.state()
        self.assertIsNotNone(first["today"])
        number = first["today"]["value"]
        self.assertIsInstance(number, int)
        self.assertGreaterEqual(number, 0)
        self.assertLessEqual(number, 1_000_000)
        self.assertEqual(first["day"], first["today"]["day"])
        self.assertEqual(1, len(first["history"]))
        self.assertNotIn("fake-client-badge", [badge["id"] for badge in first["today"]["badges"]])
        self.assertNotEqual(10**30, first["today"]["ep"])
        self.assertEqual(first["today"], self.client.state()["today"],
                         "Reload must preserve the latest guest roll")
        ids = {first["today"]["id"]}
        for _ in range(8):
            result = self.assert_success(self.client.request("roll", {}))
            self.assertFalse(result["alreadyRolled"])
            roll = result["roll"]
            self.assertNotIn(roll["id"], ids)
            ids.add(roll["id"])
            self.assertGreaterEqual(roll["value"], 0)
            self.assertLessEqual(roll["value"], 1_000_000)
            self.assertEqual(first["day"], roll["day"])
            self.assertEqual(roll, result["state"]["today"])
            self.assertEqual([roll], result["state"]["history"],
                             "Guest rerolls save only the latest result per day")
            self.assertEqual(roll["ep"], result["state"]["stats"]["totalEP"])

    def test_signed_in_rolls_are_once_per_account_day_across_devices(self):
        suffix = uuid.uuid4().hex[:12]
        email = f"once-{suffix}@example.test"
        password = "Test-password-" + suffix
        registered = False
        try:
            self.assert_success(self.client.request("register", {
                "username": "once" + suffix, "email": email, "password": password,
            }))
            registered = True
            self.assertIsNone(self.client.state()["today"])
            first = self.assert_success(self.client.request("roll", {}))
            self.assertFalse(first["alreadyRolled"])
            for _ in range(3):
                again = self.assert_success(self.client.request("roll", {}))
                self.assertTrue(again["alreadyRolled"])
                self.assertEqual(first["roll"], again["roll"])
                self.assertEqual(first["state"]["history"], again["state"]["history"])
                self.assertEqual(first["state"]["stats"], again["state"]["stats"])
            second_device = Client()
            second_device.state()
            self.assert_success(second_device.request("login", {
                "identity": email, "password": password,
            }))
            again = self.assert_success(second_device.request("roll", {}))
            self.assertTrue(again["alreadyRolled"])
            self.assertEqual(first["roll"], again["roll"])
            self.assert_success(second_device.request("logout", {}))
            guest = second_device.state()
            self.assertIsNone(guest["today"])
            self.assertEqual([], guest["history"],
                             "Signing out must not expose the account's rolls")
            guest_roll = self.assert_success(second_device.request("roll", {}))
            self.assertFalse(guest_roll["alreadyRolled"])
            self.assertNotEqual(first["roll"]["id"], guest_roll["roll"]["id"])
            self.assert_success(second_device.request("login", {
                "identity": email, "password": password,
            }))
            signed_again = self.assert_success(second_device.request("roll", {}))
            self.assertTrue(signed_again["alreadyRolled"])
            self.assertEqual(first["roll"], signed_again["roll"])
            self.assertEqual(first["state"]["stats"], signed_again["state"]["stats"])
        finally:
            if registered:
                self.assert_success(self.client.request("deleteAccount", {
                    "password": password,
                }))

    def test_poem_ownership_length_and_persistence(self):
        self.assert_success(self.client.request("roll", {}))
        roll = self.client.state()["today"]
        stranger = Client()
        stranger.state()
        status, _ = stranger.request("savePoem", {"rollId": roll["id"], "text": "Not mine"})
        self.assertEqual(403, status)
        self.assertIsNone(self.client.state()["today"]["poem"])
        status, _ = self.client.request("savePoem", {
            "rollId": roll["id"], "text": "✦" * 301,
        })
        self.assertEqual(400, status)
        self.assert_success(self.client.request("savePoem", {
            "rollId": roll["id"], "text": "A quiet roll\nA brighter day ✦",
        }))
        self.assertEqual("A quiet roll\nA brighter day ✦", self.client.state()["today"]["poem"])
        self.assert_success(self.client.request("savePoem", {"rollId": roll["id"], "text": ""}))
        self.assertIsNone(self.client.state()["today"]["poem"])

    def test_account_migrates_guest_roll_and_authentication_lifecycle(self):
        suffix = uuid.uuid4().hex[:12]
        username = "qa" + suffix
        renamed = "qb" + suffix
        email = f"qa-{suffix}@example.test"
        password = "Test-password-" + suffix
        new_password = "Changed-password-" + suffix
        registered = False
        current_password = password
        last_guest_roll = None
        try:
            self.assert_success(self.client.request("roll", {}))
            first_guest_roll = self.client.state()["today"]
            self.assert_success(self.client.request("roll", {}))
            guest_roll = self.client.state()["today"]
            self.assertNotEqual(first_guest_roll["id"], guest_roll["id"])
            self.assert_success(self.client.request("register", {
                "username": username, "email": email, "password": password,
            }))
            registered = True
            account = self.client.state()
            self.assertEqual(username, account["user"]["username"])
            for secret in ("password", "password_hash", "passwordHash"):
                self.assertNotIn(secret, account["user"])
            self.assertEqual(guest_roll, account["today"])
            self.assertEqual(1, len(account["history"]))
            self.assertEqual(guest_roll["ep"], account["stats"]["totalEP"])
            repeat = self.assert_success(self.client.request("roll", {}))
            self.assertTrue(repeat["alreadyRolled"])
            self.assertEqual(guest_roll, repeat["roll"])
            duplicate = Client()
            duplicate.state()
            status, _ = duplicate.request("register", {
                "username": username, "email": f"duplicate-{suffix}@example.test",
                "password": password,
            })
            self.assertEqual(409, status)
            self.assertIsNone(duplicate.state()["user"])
            public_profile = self.assert_success(self.client.request(
                "profile", query={"username": username}
            ))
            self.assertNotIn("email", public_profile["user"])
            status, _ = self.client.request("updateProfile", {
                "nameColor": "#123456", "favoriteBadgeIds": ["fake-client-badge"],
            })
            self.assertEqual(400, status)
            self.assert_success(self.client.request("updateProfile", {
                "nameColor": "#123456", "favoriteBadgeIds": [],
            }))
            self.assertEqual("#123456", self.client.state()["user"]["nameColor"])
            mail_log = os.environ.get("RNGDLE_TEST_MAIL_LOG")
            if mail_log:
                message = Path(mail_log).read_text(encoding="utf-8")
                token = re.search(
                    re.escape(email) + r"[^\n]*\n.*?action=verifyEmail&token=([a-f0-9]{64})",
                    message, re.DOTALL,
                )
                self.assertIsNotNone(token, "Registration did not write verification mail")
                self.assert_success(self.client.request("verifyEmail", {"token": token[1]}))
                self.assertTrue(self.client.state()["user"]["verified"])
                status, _ = self.client.request("verifyEmail", {"token": token[1]})
                self.assertEqual(400, status, "Verification token must be single use")
            self.assert_success(self.client.request("changeUsername", {
                "username": renamed, "password": password,
            }))
            self.assertEqual(renamed, self.client.state()["user"]["username"])
            second_session = Client()
            second_session.state()
            self.assert_success(second_session.request("login", {
                "identity": email, "password": password,
            }))
            self.assert_success(self.client.request("changePassword", {
                "currentPassword": password, "password": new_password,
            }))
            current_password = new_password
            self.assertIsNone(second_session.state()["user"],
                              "Password change must invalidate other sessions")
            self.assert_success(self.client.request("logout", {}))
            self.assertIsNone(self.client.state()["user"])
            self.assertIsNone(self.client.state()["today"])
            self.assertEqual([], self.client.state()["history"])
            for _ in range(3):
                reroll = self.assert_success(self.client.request("roll", {}))
                self.assertFalse(reroll["alreadyRolled"])
                self.assertNotEqual(guest_roll["id"], reroll["roll"]["id"])
                last_guest_roll = reroll["roll"]
            self.assertEqual(1, len(self.client.state()["history"]))
            status, _ = self.client.request("login", {
                "identity": email, "password": password,
            })
            self.assertEqual(401, status)
            self.assert_success(self.client.request("login", {
                "identity": email, "password": new_password,
            }))
            signed_in = self.client.state()
            self.assertEqual(renamed, signed_in["user"]["username"])
            self.assertEqual(guest_roll, signed_in["today"])
            self.assertEqual(1, len(signed_in["history"]))
            self.assertEqual(account["stats"], signed_in["stats"],
                             "Logging in after guest rerolls must not add account EP")
            repeat = self.assert_success(self.client.request("roll", {}))
            self.assertTrue(repeat["alreadyRolled"])
            self.assertEqual(guest_roll, repeat["roll"])
            if mail_log:
                self.assert_success(self.client.request("requestPasswordReset", {"email": email}))
                message = Path(mail_log).read_text(encoding="utf-8")
                token = re.search(
                    re.escape(email) + r" Reset your RNGdle password\n.*?action=resetPassword&token=([a-f0-9]{64})",
                    message, re.DOTALL,
                )
                self.assertIsNotNone(token, "Password reset did not write mail")
                reset_password = "Reset-password-" + suffix
                self.assert_success(self.client.request("resetPassword", {
                    "token": token[1], "password": reset_password,
                }))
                current_password = reset_password
                status, _ = self.client.request("resetPassword", {
                    "token": token[1], "password": reset_password,
                })
                self.assertEqual(400, status, "Reset token must be single use")
                self.assertIsNone(self.client.state()["user"],
                                  "Password reset must invalidate existing sessions")
                self.assert_success(self.client.request("login", {
                    "identity": email, "password": reset_password,
                }))
        finally:
            if registered:
                if self.client.state()["user"] is None:
                    self.client.request("login", {
                        "identity": email, "password": current_password,
                    })
                self.assert_success(self.client.request("deleteAccount", {
                    "password": current_password,
                }))
                deleted = self.client.state()
                self.assertIsNone(deleted["user"])
                self.assertNotIn(guest_roll["id"], [r["id"] for r in deleted["history"]],
                                 "Deleted account history must be inaccessible")
                self.assertEqual([last_guest_roll] if last_guest_roll else [], deleted["history"])
                reroll = self.assert_success(self.client.request("roll", {}))
                self.assertFalse(reroll["alreadyRolled"])
                self.assertNotEqual(guest_roll["id"], reroll["roll"]["id"])
                self.assertEqual([reroll["roll"]], reroll["state"]["history"])

class DatabaseMigrationTests(unittest.TestCase):
    def test_existing_databases_keep_account_data_and_free_guest_slots(self):
        root = Path(__file__).resolve().parents[1]
        bundled_php = root / "cc_mnt/runtime/php/php.exe"
        php = os.environ.get("RNGDLE_TEST_PHP") or (
            str(bundled_php) if bundled_php.is_file() else shutil.which("php")
        )
        if not php:
            self.skipTest("Set RNGDLE_TEST_PHP to test existing SQLite migrations")
        php_command = [php]
        if Path(php).resolve() == bundled_php.resolve():
            php_command += ["-d", "extension_dir=" + str(bundled_php.parent / "ext"),
                            "-d", "extension=pdo_sqlite"]
        script = (
            "require " + json.dumps(str(root / "lib/database.php").replace("\\", "/")) + ";"
            "$db = database(); echo json_encode(['version' => (int) $db->query('PRAGMA user_version')->fetchColumn(),"
            " 'rolls' => $db->query('SELECT * FROM rolls ORDER BY id')->fetchAll(),"
            " 'users' => $db->query('SELECT * FROM users')->fetchAll()]);"
        )
        for version in (0, 1):
            with self.subTest(previous_version=version), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "rngdle.sqlite"
                with closing(sqlite3.connect(path)) as db:
                    session_column = ", session_version INTEGER NOT NULL DEFAULT 1" if version else ""
                    roll_columns = ", claimable INTEGER NOT NULL DEFAULT 1, poem TEXT" if version else ""
                    db.executescript(f"""
                        CREATE TABLE users (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                            email TEXT NOT NULL COLLATE NOCASE UNIQUE,
                            password_hash TEXT NOT NULL,
                            verified_at TEXT,
                            name_color TEXT NOT NULL DEFAULT '#a5b4fc',
                            favorite_badges_json TEXT NOT NULL DEFAULT '[]',
                            created_at TEXT NOT NULL {session_column}
                        );
                        CREATE TABLE rolls (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                            guest_id TEXT,
                            day TEXT NOT NULL,
                            value INTEGER NOT NULL CHECK(value >= 0 AND value <= 1000000),
                            ep INTEGER NOT NULL,
                            badges_json TEXT NOT NULL,
                            created_at TEXT NOT NULL {roll_columns},
                            UNIQUE(user_id, day), UNIQUE(guest_id, day)
                        );
                        INSERT INTO users(id, username, email, password_hash, created_at)
                            VALUES (42, 'existing', 'existing@example.test', 'saved-hash', '2026-10-01T00:00:00Z');
                        INSERT INTO rolls(id, user_id, guest_id, day, value, ep, badges_json, created_at)
                            VALUES (91, 42, 'signed-device', '2026-10-13', 123456, 999, '[]', '2026-10-13T00:00:00Z'),
                                   (92, NULL, 'guest-device', '2026-10-13', 654321, 777, '[]', '2026-10-13T00:00:01Z');
                        PRAGMA user_version = {version};
                    """)
                    if version:
                        db.execute("UPDATE users SET session_version = 7, favorite_badges_json = '[\"saved-badge\"]'")
                        db.execute("UPDATE rolls SET poem = 'Keep this poem' WHERE id = 91")
                        db.execute("INSERT INTO rolls(id, guest_id, claimable, day, value, ep, badges_json, created_at)"
                                   " VALUES (93, 'deleted-device', 0, '2026-10-13', 456789, 500, '[]', '2026-10-13T00:00:02Z')")
                    db.row_factory = sqlite3.Row
                    originals = [dict(row) for row in db.execute("SELECT * FROM rolls ORDER BY id")]
                    original_user = dict(db.execute("SELECT * FROM users").fetchone())
                    db.commit()
                environment = {**os.environ, "RNGDLE_STORAGE": directory}
                first = None
                for _ in range(2):
                    process = subprocess.run(php_command + ["-r", script], env=environment,
                                             capture_output=True, text=True, timeout=20)
                    self.assertEqual(0, process.returncode, process.stderr)
                    snapshot = json.loads(process.stdout)
                    self.assertEqual(2, snapshot["version"])
                    self.assertEqual(len(originals), len(snapshot["rolls"]),
                                     "Migrations must not delete existing saved rolls")
                    for before, after in zip(originals, snapshot["rolls"]):
                        for column, value in before.items():
                            if column == "guest_id" and (before["user_id"] or before.get("claimable") == 0):
                                self.assertIsNone(after[column])
                            else:
                                self.assertEqual(value, after[column], f"Saved roll field changed: {column}")
                    for column, value in original_user.items():
                        self.assertEqual(value, snapshot["users"][0][column])
                    if first is None:
                        first = snapshot
                    else:
                        self.assertEqual(first, snapshot, "Migration must be safe to run repeatedly")
                with closing(sqlite3.connect(path)) as db:
                    db.execute("INSERT INTO rolls(guest_id, day, value, ep, badges_json, created_at)"
                               " VALUES ('signed-device', '2026-10-13', 10, 0, '[]', '2026-10-13T00:00:03Z')")
                    with self.assertRaises(sqlite3.IntegrityError):
                        db.execute("INSERT INTO rolls(user_id, day, value, ep, badges_json, created_at)"
                                   " VALUES (42, '2026-10-13', 10, 0, '[]', '2026-10-13T00:00:03Z')")


if __name__ == "__main__":
    unittest.main(verbosity=2)
