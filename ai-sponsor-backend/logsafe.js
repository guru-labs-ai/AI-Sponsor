/* What a log line may say about a person.

   Render keeps our logs, and anyone with access to the dashboard can read them.
   On this product a phone number is the person and their messages are their
   recovery, so neither belongs in a log. A log line needs to tell us WHICH
   conversation something happened in, never WHAT was said.

   maskPhone keeps the last four digits, enough to match a line to a person in
   the database when we need to, and drops the rest. It takes anything a phone
   can arrive as: "whatsapp:+923001234567", "+923001234567", or a WhatsApp user
   id like "wa-+923001234567". Ids that are not phone numbers (web user ids)
   come back unchanged. */

function maskPhone(value) {
  if (value === null || value === undefined || value === '') return '(none)';
  const s = String(value);
  const bare = s.trim().replace(/^(wa-|whatsapp:)/i, '');
  // Not a phone number: a web user id or similar. Nothing to hide.
  if (!/^\+?\d[\d\s().-]{6,}$/.test(bare)) return s;
  return '…' + bare.replace(/\D/g, '').slice(-4);
}

module.exports = { maskPhone };
