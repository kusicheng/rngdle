"""Exercise the real local PHP API: python tests/backend_test.py.

Set BASE_URL to a loopback URL when using a different local port. These tests
create disposable accounts and clean them up; they refuse nonlocal hosts.
"""

import http.cookiejar
import ipaddress
import json
import os
from pathlib import Path
import re
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

    def test_roll_is_server_generated_and_persistent_once_per_day(self):
        self.assert_success(self.client.request("roll", {
            "number": -1, "value": -1, "score": 10**30,
            "day": "2099-01-01", "badges": ["fake-client-badge"],
        }))
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
        status, _ = self.client.request("roll", {})
        self.assertIn(status, (200, 409))
        again = self.client.state()
        self.assertEqual(first["today"], again["today"])
        self.assertEqual(first["history"], again["history"])

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
        try:
            self.assert_success(self.client.request("roll", {}))
            guest_roll = self.client.state()["today"]
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
            self.assertEqual(guest_roll["value"], self.client.state()["today"]["value"])
            self.assert_success(self.client.request("roll", {}))
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
                self.assertEqual([], deleted["history"], "Deleted account history must be inaccessible")
                self.assertEqual(0, deleted["stats"]["rolls"])
                self.assertEqual(guest_roll["id"], deleted["today"]["id"])
                self.assert_success(self.client.request("roll", {}))
                locked = self.client.state()
                self.assertEqual(guest_roll["id"], locked["today"]["id"],
                                 "Deleting an account must not permit another roll today")
                self.assertEqual([], locked["history"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
