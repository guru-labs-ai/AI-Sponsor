/* ─── QA Guru test runs, told apart from real people ─────────────────────────
   QA Guru runs automated tests on getaisponsor.com. Each run fills in the
   Amends form, sends support tickets and signs up, all from a test inbox
   (qa-proj-...@reloulexei.resend.app). Before this, every run looked like
   real people: support tickets @-mentioned Mariam, Mubashir and Abdul, the
   sign-up alert read like a new member, and GHL tagged the address amends-tv
   so it sat among the Amends TV candidates (4 and 6 Nov 2026).

   Now an address on a test domain is still saved, so the test can check its
   own run, but it is tagged qa-test (the tag the older test contacts already
   carry), never amends-tv. Its Slack alerts first said plainly that it was a
   test and mentioned nobody; since 9 Nov they are not posted at all (Mariam:
   "can we just stop getting these messages").
──────────────────────────────────────────────────────────────────────────── */

const QA_TEST_DOMAINS = ['reloulexei.resend.app'];
const QA_TEST_TAG = 'qa-test';

function isQaTest(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  return at > 0 && QA_TEST_DOMAINS.includes(e.slice(at + 1));
}

module.exports = { isQaTest, QA_TEST_DOMAINS, QA_TEST_TAG };
