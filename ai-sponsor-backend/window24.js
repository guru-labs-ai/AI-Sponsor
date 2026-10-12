/* Is this person still inside WhatsApp's 24-hour window?

   Free text only reaches somebody who wrote to us in the last 24 hours. Outside
   it, only an approved template gets through. The weekly review and the trial
   notice both used to find out by trying text first and catching 131047, but on
   Meta's Cloud API that never throws: the send is accepted with a message id and
   the refusal arrives minutes later as a delivery receipt. So the catch never
   ran, the template was never tried, and the row was marked delivered. Read
   from the DB, 11 Oct 2026: 8 weekly reviews went that way, Matt's among them,
   and both tracked trial notices before it.

   So ask before sending instead. Their last WhatsApp message is in `messages`
   under the wa- id, the same row the webhook writes.

   Returns true (open), false (closed) or null (cannot tell). null keeps the old
   behaviour, text first, so a DB blip never stops a message going out. */

/* An hour short of Meta's 24, so a send that lands a little late is not the
   one that misses. Erring towards the template costs nothing: it says the same
   thing more plainly. */
const WINDOW_MS = 23 * 60 * 60 * 1000;

async function insideWindow(db, phone, now = Date.now()) {
  if (!db || typeof db.getLastMessageAt !== 'function') return null;
  const p = String(phone || '').trim();
  if (!p) return null;
  const waId = `wa-${p.startsWith('+') ? p : '+' + p}`;
  let last;
  try { last = await db.getLastMessageAt(waId); } catch { return null; }
  if (!last) return false;   // never wrote on WhatsApp: no window to be inside
  const t = new Date(last).getTime();
  if (!Number.isFinite(t)) return null;
  return now - t < WINDOW_MS;
}

module.exports = { insideWindow, WINDOW_MS };
