/* ─── Is this actually a phone number in the country they picked? ────────────
   On this product the phone number IS the person. It is how their sponsor
   reaches them on WhatsApp, so a wrong number does not fail politely: it sends
   somebody's name, their programme and eventually their recovery conversations
   to a stranger's handset.

   The old check only asked for 6 to 15 digits, which is the outer bound of
   E.164 and almost nothing else. Pick +1 and type seven digits and it passed,
   even though every North American number is exactly ten.

   ── The rule, and its deliberate limit ────────────────────────────────────
   Only countries we are confident about are listed below. Anything absent keeps
   the old permissive bound. That asymmetry is on purpose: letting a wrong
   number through is bad, but blocking somebody with a perfectly good number
   because we invented a rule for a country we have no data on is worse, and it
   fails in a way nobody would ever report to us. Add a country here when
   somebody has checked it, not to make the table look complete.

   Lengths are the NATIONAL number, with the country code and any trunk 0
   already stripped.                                                          */

/* The lengths moved to countries.js on 4 Sep, alongside the country name and
   its timezone, because they used to be maintained here while the timezone
   table was maintained separately and the two knew different countries. */
const countries = require('./countries');
const NATIONAL_LENGTHS = Object.fromEntries(
  Object.entries(countries.COUNTRIES)
    .filter(([, v]) => v[2])
    .map(([code, v]) => [code, v[2]])
);

/* Absolute bounds from E.164 itself. These apply to every number, including
   countries missing from the table above. */
const MIN_NATIONAL = 6;
const MAX_TOTAL = 15;

/* Strip the country code and any trunk prefix, so what is left is the national
   number. Mirrors phoneNational() on the registration page. */
function nationalPart(digits, cc) {
  let n = String(digits || '').replace(/\D/g, '').replace(/^00/, '').replace(/^0/, '');
  const code = String(cc || '').replace(/\D/g, '');
  if (code && n.startsWith(code) && n.length > code.length + MIN_NATIONAL) {
    n = n.slice(code.length).replace(/^0/, '');
  }
  return n;
}

/* What lengths are valid for this country code, or null when we do not know.
   The +1 caribbean and pacific codes (+1246 Barbados, +1876 Jamaica and so on)
   are four digits long in the picker, and the seven that follow complete the
   same ten-digit NANP number. */
function expectedLengths(cc) {
  const code = String(cc || '').replace(/\D/g, '');
  if (code === '1') return [10];                       // US, Canada, main NANP
  if (NATIONAL_LENGTHS[code]) return NATIONAL_LENGTHS[code];
  if (code.length === 4 && code[0] === '1') return [7]; // the NANP islands
  return null;
}

/* Somebody filling the box in rather than giving us their number. Kept from the
   original check, which was right about this. */
function looksMadeUp(national) {
  if (/^(\d)\1+$/.test(national)) return true;
  return '01234567890123'.includes(national) || '09876543210987'.includes(national);
}

/* Returns { ok } or { ok:false, reason, expected, got } so the caller can say
   something specific. "That number doesn't look right" teaches nobody anything;
   "a United States number is 10 digits after +1, you entered 7" does. */
function checkPhone(rawDigits, cc) {
  const code = String(cc || '').replace(/\D/g, '');
  const national = nationalPart(rawDigits, code);

  if (!national) return { ok: false, reason: 'empty', expected: null, got: 0 };
  if (looksMadeUp(national)) return { ok: false, reason: 'made-up', expected: null, got: national.length };
  if (code.length + national.length > MAX_TOTAL) {
    return { ok: false, reason: 'too-long', expected: null, got: national.length };
  }

  const lens = expectedLengths(code);
  if (lens) {
    if (!lens.includes(national.length)) {
      return { ok: false, reason: 'wrong-length', expected: lens, got: national.length };
    }
    return { ok: true, national };
  }

  // Country we have no data for: fall back to the E.164 bound only.
  if (national.length < MIN_NATIONAL) {
    return { ok: false, reason: 'too-short', expected: null, got: national.length };
  }
  return { ok: true, national };
}

module.exports = { checkPhone, expectedLengths, nationalPart, NATIONAL_LENGTHS, MIN_NATIONAL, MAX_TOTAL };
