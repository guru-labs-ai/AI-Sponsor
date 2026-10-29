/* ─── Working out what time it is for somebody ───────────────────────────────
   Matt: "they should all get it Sundays ... between 9 am - 12 pm their local
   time". Every message this product sends today goes out at one instant, which
   reads as 8am in California and 5pm in South Africa. To land inside somebody's
   own morning we have to know where they are, and we never asked them.

   What we do have is the phone number they message us from. The country code
   gives the country, and for +1 the area code gives the state or province.
   That is a derivation rather than something they told us, so it is wrong for
   a person travelling or carrying a foreign SIM. It is right for almost
   everybody else, and the alternative is asking 27 people in recovery to fill
   in a timezone field.

   IANA names rather than fixed offsets on purpose: the offsets move twice a
   year, and a stored "-7" would silently send an hour early every November.
   Node resolves the name against real DST rules at send time.

   Anything we cannot place returns null, and the caller decides. Guessing a
   zone would produce a confident 6am message, which is worse on this product
   than not sending yet.                                                      */

/* The tables moved to countries.js on 4 Sep. They used to live here AND in
   phonerules.js, each knowing a different set of countries, and Bilal fell down
   the gap: his +92 number validated fine but could not be placed, so the Sunday
   weekly review held him back forever without saying so. One table now. */
const countries = require('./countries');

/* Give it whatever we hold: "+16614771953", "16614771953", "wa-+4479...".
   Returns an IANA zone, or null when we genuinely cannot tell. */
function zoneForPhone(phone) {
  return countries.place(phone).zone;
}

/* A zone they told us themselves, or null. 29 Oct: somebody wrote from a
   Georgian number "I moved to germany actually, so im 3 hours behind", the
   sponsor said "thanks for telling me", and nothing kept it, so every message
   after that was on Tbilisi time again. What somebody says about where they
   live beats what their number says. Only a real IANA name for a place
   ("Europe/Berlin") counts. "UTC", "Etc/GMT-1" (a fixed offset, wrong half the
   year) or a bad name from the model is no zone. */
function validZone(zone) {
  const z = String(zone || '').trim();
  if (!/^[A-Za-z]+\/[A-Za-z0-9_+\-\/]+$/.test(z) || /^Etc\//i.test(z)) return null;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: z }); return z; } catch { return null; }
}

/* Where somebody is: the place they told us they live, else their number. */
function zoneFor(savedZone, phone) {
  return validZone(savedZone) || zoneForPhone(phone);
}

/* What hour is it where they are, right now? Uses real DST rules rather than a
   stored offset, so it stays correct across a clock change without anyone
   remembering to update anything. */
function localHour(zone, now = new Date()) {
  if (!zone) return null;
  try {
    const h = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, hour: 'numeric', hour12: false,
    }).format(now);
    const n = parseInt(h, 10);
    return Number.isFinite(n) ? n % 24 : null;
  } catch {
    return null;   // an unknown zone name must not take the sweep down
  }
}

// Which day of the week is it for them? 0 = Sunday, to match getUTCDay.
function localDay(zone, now = new Date()) {
  if (!zone) return null;
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(now);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(s);
  } catch {
    return null;
  }
}

module.exports = { zoneForPhone, validZone, zoneFor, localHour, localDay };
