#!/usr/bin/env python3
"""
AI Sponsor — local smoke tests for:
  1. The "forget me" deletion path (Stripe -> DB -> GHL, admin-only)
  2. The rolling memory digest (sanity check that it still holds up)

RUN THIS AGAINST A LOCAL DEV SERVER ONLY. Point it at Stripe TEST-mode keys
and a throwaway/dev DATABASE_URL. Never run this against production data —
several tests genuinely delete rows.

Setup:
    pip install requests python-dotenv
    # optional, unlocks the DB-backed and Stripe-backed tests:
    pip install psycopg2-binary stripe

    # in ai-sponsor-backend/.env (or wherever your server reads its env from):
    ADMIN_API_KEY=some-long-random-dev-only-value

Usage:
    # from the ai-sponsor-backend folder (so .env is picked up), with the
    # server already running in another terminal:
    python test_deletion_and_memory.py

    # to also test the memory digest, restart the server first with small
    # thresholds so a short test conversation is enough to trigger a fold:
    #   MEMORY_RECENT_TURNS=6 MEMORY_SUMMARY_BATCH=2 npm start
    python test_deletion_and_memory.py --with-memory

    # to also test the full real-Stripe cancel path (test mode, costs nothing):
    python test_deletion_and_memory.py --with-stripe
"""

import argparse
import json
import os
import sys
import time
import uuid

import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("NOTE: python-dotenv not installed — reading os.environ as-is. "
          "pip install python-dotenv to auto-load ai-sponsor-backend/.env")

try:
    import psycopg2
    import psycopg2.extras
    HAVE_PSYCOPG2 = True
except ImportError:
    HAVE_PSYCOPG2 = False

try:
    import stripe as stripe_sdk
    HAVE_STRIPE_SDK = True
except ImportError:
    HAVE_STRIPE_SDK = False


# ─── Config ───────────────────────────────────────────────────────────────

BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:3001")
ADMIN_API_KEY = os.environ.get("ADMIN_API_KEY", "")
DATABASE_URL = os.environ.get("DATABASE_URL", "")
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PRICE_MONTHLY = os.environ.get("STRIPE_PRICE_MONTHLY", "")


# ─── Tiny test runner ─────────────────────────────────────────────────────

class Skip(Exception):
    """Raise inside a test to mark it skipped rather than failed."""


RESULTS = []  # (name, "PASS" | "FAIL" | "SKIP", detail)


def run(name, fn, *args, **kwargs):
    print(f"\n--- {name} " + "-" * max(1, 60 - len(name)))
    try:
        fn(*args, **kwargs)
        print(f"[PASS] {name}")
        RESULTS.append((name, "PASS", ""))
    except Skip as e:
        print(f"[SKIP] {name} — {e}")
        RESULTS.append((name, "SKIP", str(e)))
    except AssertionError as e:
        print(f"[FAIL] {name} — {e}")
        RESULTS.append((name, "FAIL", str(e)))
    except Exception as e:  # noqa: BLE001 — a smoke test, we want to see everything
        print(f"[FAIL] {name} — unexpected error: {e!r}")
        RESULTS.append((name, "FAIL", repr(e)))


def summary():
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    for name, status, detail in RESULTS:
        line = f"{status:5s} {name}"
        if detail and status != "PASS":
            line += f"  ({detail})"
        print(line)
    passed = sum(1 for _, s, _ in RESULTS if s == "PASS")
    failed = sum(1 for _, s, _ in RESULTS if s == "FAIL")
    skipped = sum(1 for _, s, _ in RESULTS if s == "SKIP")
    print("-" * 70)
    print(f"{passed} passed, {failed} failed, {skipped} skipped")
    return failed == 0


# ─── HTTP helpers ─────────────────────────────────────────────────────────

def new_user_id(prefix="reg-test"):
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def admin_delete(user_id, key=None):
    """POST /api/admin/delete-user. Returns (status_code, json_body)."""
    resp = requests.post(
        f"{BASE_URL}/api/admin/delete-user",
        headers={"X-Admin-Key": key if key is not None else ADMIN_API_KEY,
                 "X-Admin-User": "test-script"},
        json={"userId": user_id},
        timeout=30,
    )
    try:
        body = resp.json()
    except ValueError:
        body = {"raw": resp.text}
    return resp.status_code, body


def get_history(user_id):
    resp = requests.get(f"{BASE_URL}/api/history/{user_id}", timeout=15)
    resp.raise_for_status()
    return resp.json()


def save_session(user_id, profile):
    resp = requests.post(
        f"{BASE_URL}/api/session",
        json={"userId": user_id, "profile": profile},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def chat(user_id, message, timeout=60):
    """POST /api/chat, consume the SSE stream, return the full reply text."""
    resp = requests.post(
        f"{BASE_URL}/api/chat",
        json={"userId": user_id, "message": message},
        stream=True,
        timeout=timeout,
    )
    resp.raise_for_status()
    full_text = []
    for raw_line in resp.iter_lines(decode_unicode=True):
        if not raw_line or not raw_line.startswith("data: "):
            continue
        payload = raw_line[len("data: "):]
        if payload == "[DONE]":
            break
        chunk = json.loads(payload)
        if "error" in chunk:
            raise RuntimeError(f"chat stream error: {chunk['error']}")
        full_text.append(chunk.get("text", ""))
    return "".join(full_text)


def check_health():
    resp = requests.get(f"{BASE_URL}/health", timeout=10)
    resp.raise_for_status()
    return resp.json()


# ─── Optional DB helper (direct Postgres access for setup/verification) ───

class DB:
    def __init__(self, url):
        if not HAVE_PSYCOPG2:
            raise Skip("psycopg2 not installed — pip install psycopg2-binary")
        if not url:
            raise Skip("DATABASE_URL not set — can't reach the DB directly")
        self.conn = psycopg2.connect(url, sslmode="require")
        self.conn.autocommit = True

    def cursor(self):
        return self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    def row_counts(self, user_id):
        """Row count for this user_id across every table deletion should touch."""
        counts = {}
        with self.cursor() as cur:
            for table in ("messages", "profiles", "activity_days", "users"):
                cur.execute(f"SELECT COUNT(*) AS n FROM {table} WHERE user_id = %s", (user_id,))
                counts[table] = cur.fetchone()["n"]
        return counts

    def insert_test_user(self, user_id, stripe_subscription_id=None,
                          stripe_customer_id=None, ghl_contact_id=None, access="Paid"):
        with self.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (user_id, access, stripe_subscription_id,
                                    stripe_customer_id, ghl_contact_id)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (user_id) DO UPDATE SET
                    access = EXCLUDED.access,
                    stripe_subscription_id = EXCLUDED.stripe_subscription_id,
                    stripe_customer_id = EXCLUDED.stripe_customer_id,
                    ghl_contact_id = EXCLUDED.ghl_contact_id
                """,
                (user_id, access, stripe_subscription_id, stripe_customer_id, ghl_contact_id),
            )

    def force_cleanup(self, user_id):
        """Test-teardown only — bypasses the app entirely. Use to reset state
        a test intentionally left behind (e.g. the 'stopped' case)."""
        with self.cursor() as cur:
            for table in ("messages", "profiles", "activity_days", "users"):
                cur.execute(f"DELETE FROM {table} WHERE user_id = %s", (user_id,))

    def close(self):
        self.conn.close()


# ─── Optional Stripe helper (real test-mode subscription) ─────────────────

def create_test_subscription():
    """Creates a genuine Stripe TEST-mode customer + subscription using
    Stripe's standard test payment method (pm_card_visa) — no checkout UI
    needed, costs nothing, only works with a sk_test_ key. Returns
    (customer_id, subscription_id)."""
    if not HAVE_STRIPE_SDK:
        raise Skip("stripe package not installed — pip install stripe")
    if not STRIPE_SECRET_KEY:
        raise Skip("STRIPE_SECRET_KEY not set")
    if not STRIPE_SECRET_KEY.startswith("sk_test_"):
        raise Skip("STRIPE_SECRET_KEY is not a test-mode key (sk_test_...) — refusing to touch live Stripe")
    if not STRIPE_PRICE_MONTHLY:
        raise Skip("STRIPE_PRICE_MONTHLY not set")

    stripe_sdk.api_key = STRIPE_SECRET_KEY
    customer = stripe_sdk.Customer.create(
        email=f"deletion-test-{uuid.uuid4().hex[:8]}@example.com",
        payment_method="pm_card_visa",
        invoice_settings={"default_payment_method": "pm_card_visa"},
    )
    subscription = stripe_sdk.Subscription.create(
        customer=customer.id,
        items=[{"price": STRIPE_PRICE_MONTHLY}],
        trial_period_days=30,  # avoid an actual charge during the test
    )
    return customer.id, subscription.id


def get_stripe_subscription_status(subscription_id):
    stripe_sdk.api_key = STRIPE_SECRET_KEY
    return stripe_sdk.Subscription.retrieve(subscription_id).status


# ─── Tests: HTTP-only (no special setup needed) ────────────────────────────

def test_server_reachable():
    data = check_health()
    assert data.get("status") == "ok", f"unexpected /health body: {data}"


def test_admin_key_required():
    user_id = new_user_id()
    status, body = admin_delete(user_id, key="")
    assert status == 401, f"expected 401 with no key, got {status}: {body}"

    status, body = admin_delete(user_id, key="definitely-not-the-real-key")
    assert status == 401, f"expected 401 with a wrong key, got {status}: {body}"


def test_delete_basic_user_no_stripe_no_ghl():
    """A user who only ever chatted (no /register, no Stripe, no GHL). This is
    the simplest real-world case: v1 should purge them cleanly with no
    Stripe/GHL involvement at all."""
    if not ADMIN_API_KEY:
        raise Skip("ADMIN_API_KEY not set in the test environment")

    user_id = new_user_id()
    save_session(user_id, {"name": "TestUser", "program": "AA", "stage": "Under 3 months"})
    reply = chat(user_id, "Hi, just wanted to check in today.")
    assert reply, "expected a non-empty sponsor reply"

    before = get_history(user_id)
    assert len(before["history"]) > 0, "expected chat history to exist before deletion"

    status, body = admin_delete(user_id)
    assert status == 200, f"expected 200, got {status}: {body}"
    assert body.get("stopped") is False, f"did not expect this deletion to stop: {body}"
    assert body.get("db") in ("purged", "purged_orphaned_only"), f"unexpected db result: {body}"

    after = get_history(user_id)
    assert after["history"] == [], f"expected empty history after deletion, got: {after['history']}"
    assert after["profile"] == {}, f"expected empty profile after deletion, got: {after['profile']}"


def test_delete_is_idempotent():
    """Deleting an identity that's already gone should succeed harmlessly,
    not error — this matters for safely re-running after a partial failure."""
    if not ADMIN_API_KEY:
        raise Skip("ADMIN_API_KEY not set in the test environment")

    user_id = new_user_id()
    save_session(user_id, {"name": "GoneTwice"})
    chat(user_id, "One message so there's something to delete.")

    status1, body1 = admin_delete(user_id)
    assert status1 == 200, f"first delete failed: {status1} {body1}"

    status2, body2 = admin_delete(user_id)
    assert status2 == 200, f"second delete on an already-gone user should still be 200, got {status2}: {body2}"


def test_delete_missing_user_id_is_400():
    resp = requests.post(
        f"{BASE_URL}/api/admin/delete-user",
        headers={"X-Admin-Key": ADMIN_API_KEY},
        json={},
        timeout=15,
    )
    assert resp.status_code == 400, f"expected 400 for missing userId, got {resp.status_code}"


# ─── Tests: require direct DB access (setup a users row + verify rows) ────

def test_delete_purges_all_four_tables():
    if not ADMIN_API_KEY:
        raise Skip("ADMIN_API_KEY not set in the test environment")
    db = DB(DATABASE_URL)
    try:
        user_id = new_user_id()
        save_session(user_id, {"name": "FullPurgeCheck"})
        chat(user_id, "Message one.")
        chat(user_id, "Message two.")
        db.insert_test_user(user_id)  # gives it a users row too, no stripe/ghl ids

        before = db.row_counts(user_id)
        assert before["messages"] > 0, "expected message rows before deletion"
        assert before["users"] == 1, "expected a users row before deletion"

        status, body = admin_delete(user_id)
        assert status == 200, f"expected 200, got {status}: {body}"

        after = db.row_counts(user_id)
        assert after == {"messages": 0, "profiles": 0, "activity_days": 0, "users": 0}, \
            f"expected all four tables empty, got {after}"
    finally:
        db.close()


def test_delete_stops_on_unresolvable_stripe_subscription():
    """A users row with a bogus stripe_subscription_id on file. Per Mariam's
    fix: this must NOT be treated as 'fine, nothing to cancel' — it must stop
    and flag for manual review, and must NOT delete anything."""
    if not ADMIN_API_KEY:
        raise Skip("ADMIN_API_KEY not set in the test environment")
    db = DB(DATABASE_URL)
    try:
        user_id = new_user_id()
        save_session(user_id, {"name": "BadSubCheck"})
        chat(user_id, "A message that should survive because deletion should stop.")
        db.insert_test_user(user_id, stripe_subscription_id="sub_this_id_does_not_exist_12345")

        status, body = admin_delete(user_id)
        assert status == 409, f"expected 409 (stopped), got {status}: {body}"
        assert body.get("stopped") is True, f"expected stopped=True, got: {body}"
        print(f"    stripe.reason reported: {body.get('stripe', {}).get('reason')}")

        after = db.row_counts(user_id)
        assert after["users"] == 1, "user row must NOT be deleted when Stripe wasn't confirmed cancelled"
        assert after["messages"] > 0, "messages must NOT be deleted when Stripe wasn't confirmed cancelled"
    finally:
        # This test deliberately leaves data behind (that's the point) —
        # clean it up directly since the app correctly refused to.
        db.force_cleanup(user_id)
        db.close()


# ─── Test: full real Stripe cancel path (opt-in, --with-stripe) ───────────

def test_delete_cancels_real_stripe_subscription():
    if not ADMIN_API_KEY:
        raise Skip("ADMIN_API_KEY not set in the test environment")
    db = DB(DATABASE_URL)
    try:
        customer_id, subscription_id = create_test_subscription()
        user_id = new_user_id()
        save_session(user_id, {"name": "RealStripeCheck"})
        chat(user_id, "Testing the real Stripe cancel path.")
        db.insert_test_user(user_id, stripe_subscription_id=subscription_id,
                             stripe_customer_id=customer_id)

        status, body = admin_delete(user_id)
        assert status == 200, f"expected 200, got {status}: {body}"
        assert body.get("stripe", {}).get("ok") is True, f"expected stripe.ok=True: {body}"

        live_status = get_stripe_subscription_status(subscription_id)
        assert live_status == "canceled", f"expected Stripe subscription canceled, got '{live_status}'"

        after = db.row_counts(user_id)
        assert after == {"messages": 0, "profiles": 0, "activity_days": 0, "users": 0}, \
            f"expected all four tables empty after a successful delete, got {after}"
    finally:
        db.close()


# ─── Test: memory digest sanity check (opt-in, --with-memory) ─────────────

def test_memory_digest_survives_window(recent_turns_hint=6, summary_batch_hint=2):
    """Plants a distinctive fact, pushes it out of the recent window with
    filler messages, waits for the background summarizer, then asks for the
    fact back. Restart the server first with small thresholds, e.g.:
        MEMORY_RECENT_TURNS=6 MEMORY_SUMMARY_BATCH=2 npm start
    Otherwise this needs ~25+ real exchanges to exercise the default window
    (40), so it's opt-in rather than run by default.
    """
    user_id = new_user_id(prefix="wa-memtest")
    fact_keyword = f"Zylo{uuid.uuid4().hex[:6]}"  # a token the model can't already know

    reply = chat(user_id, f"My sponsor's name that I look up to is {fact_keyword}. Please remember that.")
    assert reply, "expected a reply after planting the fact"

    filler = [
        "Just checking in today.",
        "Had a decent day, one day at a time.",
        "Went to a meeting this morning.",
        "Feeling a bit anxious about a family thing this week.",
        "Trying to stick to my routine.",
        "Thinking about step work this weekend.",
        "Nothing major to report, just staying steady.",
        "Grateful for a quiet day today.",
    ]
    for msg in filler:
        chat(user_id, msg)

    # The summarizer is fire-and-forget after each reply — give it a moment.
    time.sleep(8)

    final_reply = chat(user_id, "Quick one — who's the sponsor I look up to that I mentioned earlier?")
    assert fact_keyword in final_reply, (
        f"expected the planted fact '{fact_keyword}' to survive in the reply, "
        f"got: {final_reply!r}. If MEMORY_RECENT_TURNS/MEMORY_SUMMARY_BATCH "
        f"are still at their defaults (40/12), this conversation was too short "
        f"to push the fact out of the verbatim window — restart the server with "
        f"MEMORY_RECENT_TURNS=6 MEMORY_SUMMARY_BATCH=2 and re-run with --with-memory."
    )


# ─── Main ───────────────────────────────────────────────────────────────

def main():
    global BASE_URL
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--with-memory", action="store_true",
                         help="also run the memory-digest test (needs small MEMORY_* thresholds on the server)")
    parser.add_argument("--with-stripe", action="store_true",
                         help="also run the real Stripe test-mode cancel path (needs sk_test_ key + STRIPE_PRICE_MONTHLY)")
    parser.add_argument("--base-url", default=None, help=f"override server base URL (default: {BASE_URL})")
    args = parser.parse_args()

    if args.base_url:
        BASE_URL = args.base_url

    print(f"Testing against: {BASE_URL}")
    print(f"ADMIN_API_KEY set: {bool(ADMIN_API_KEY)}")
    print(f"DATABASE_URL set: {bool(DATABASE_URL)}  (psycopg2 installed: {HAVE_PSYCOPG2})")
    print(f"STRIPE_SECRET_KEY set: {bool(STRIPE_SECRET_KEY)}  (stripe sdk installed: {HAVE_STRIPE_SDK})")

    run("server reachable (/health)", test_server_reachable)
    run("admin route requires a valid key", test_admin_key_required)
    run("delete: missing userId -> 400", test_delete_missing_user_id_is_400)
    run("delete: basic user, no stripe/ghl", test_delete_basic_user_no_stripe_no_ghl)
    run("delete: idempotent on re-run", test_delete_is_idempotent)
    run("delete: purges all four tables (DB check)", test_delete_purges_all_four_tables)
    run("delete: stops on unresolvable Stripe subscription", test_delete_stops_on_unresolvable_stripe_subscription)

    if args.with_stripe:
        run("delete: cancels a real Stripe test-mode subscription", test_delete_cancels_real_stripe_subscription)
    else:
        print("\n(skipping real-Stripe cancel test — pass --with-stripe to include it)")
        RESULTS.append(("delete: cancels a real Stripe test-mode subscription", "SKIP", "not requested (--with-stripe)"))

    if args.with_memory:
        run("memory digest survives past the recent window", test_memory_digest_survives_window)
    else:
        print("(skipping memory digest test — pass --with-memory to include it)")
        RESULTS.append(("memory digest survives past the recent window", "SKIP", "not requested (--with-memory)"))

    ok = summary()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()