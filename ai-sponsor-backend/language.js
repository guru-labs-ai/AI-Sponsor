/* ─── Languages ───────────────────────────────────────────────────────────────
   Mariam, Sep 15: the sponsor talks, writes and speaks in the same languages,
   the 20 xAI can voice. Its automatic messages (trial ending, leaving, weekly
   note, check-in) come in a smaller set that has been written out by hand and
   approved by Meta as templates.

   Three things live here so every module answers them the same way:

   1. What a message says about the person. One Claude call per incoming
      WhatsApp message names its language and whether they are asking for a
      voice note or for text only. The English phrase lists in whatsapp.js stay
      exactly as they are for English; this is what makes the same requests
      work in Spanish or Japanese.

   2. Which language a person is in. Remembered on their profile, across every
      identity they hold, so a Stripe webhook that only knows their reg- row
      still writes to them in the language they talk to their sponsor in.

   3. How to send an approved template in that language, falling back to
      English while a translation is still waiting on Meta.

   The master prompt's LANGUAGES section in server.js lists the same 20. Change
   one, change the other. */

/* Base codes. xAI's regional variants (es-MX / es-ES, pt-BR / pt-PT, three
   Arabics) all collapse onto these; the voice call itself sends 'auto'. */
const SUPPORTED = ['en', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'tr', 'ar', 'hi',
  'bn', 'zh', 'ja', 'ko', 'id', 'vi'];

/* The languages automatic messages are written in, and the code Meta files
   each template translation under. Everyone else gets English. */
const NOTICE_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru'];
const META_TEMPLATE_CODE = { en: 'en_US', es: 'es', fr: 'fr', de: 'de', it: 'it', pt: 'pt_BR', ru: 'ru' };
const DATE_LOCALE = { en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-BR', ru: 'ru-RU' };

/* For telling a model which language to write in. */
const LANGUAGE_NAMES = {
  en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian',
  ru: 'Russian', tr: 'Turkish', ar: 'Arabic', hi: 'Hindi', bn: 'Bengali', zh: 'Chinese',
  ja: 'Japanese', ko: 'Korean', id: 'Indonesian', vi: 'Vietnamese',
};

const noticeLanguage = (lang) => (NOTICE_LANGUAGES.includes(lang) ? lang : 'en');

/* "9 September", "9 de septiembre", "9. September", "9 сентября". No year,
   UTC, same reasoning as the English original in notices.js. */
function formatDay(value, lang = 'en') {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(DATE_LOCALE[noticeLanguage(lang)], { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/* ─── Reading a message ──────────────────────────────────────────────────────
   Claude rather than word lists, because word lists for sixteen languages are
   sixteen chances to miss "mándame un audio". Thinking is off: three fields
   forced by a schema, and the check sits in front of a reply somebody is
   waiting on. Measured Sep 15 at about two seconds, which is small next to the
   fifteen the webhook already waits for them to finish typing.

   Returns null when it cannot tell (no key, an error, a refusal). Every caller
   treats null as "carry on exactly as before this existed". */
let client = null;

async function readMessage(text) {
  const t = String(text || '').trim();
  if (!t || !process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 8000, maxRetries: 1 });
  }
  try {
    const res = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 128,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'disabled' },
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              language: { type: 'string', enum: [...SUPPORTED, 'other', 'unclear'] },
              asksForVoice: { type: 'boolean' },
              asksForTextOnly: { type: 'boolean' },
              asksForLanguage: { type: 'string', enum: [...SUPPORTED, 'other', 'none'] },
            },
            required: ['language', 'asksForVoice', 'asksForTextOnly', 'asksForLanguage'],
            additionalProperties: false,
          },
        },
      },
      system: [
        'You read one message somebody sent to their recovery sponsor, or one message the sponsor wrote.',
        'language: the code of the main language it is written in. "other" if it is clearly a language not in the list. "unclear" if there is too little to tell, such as an emoji, a number, a name, or a single word that several languages share.',
        'asksForVoice: true only if they are asking to be sent a voice note or audio, or to hear the sponsor speak. Saying they sent one, or asking for something else, is false.',
        'asksForTextOnly: true only if they are asking the sponsor to stop sending voice notes or to only write to them.',
        'asksForLanguage: the code of the language they are asking the sponsor to talk to them in from now on, whatever language the request itself is written in. "Can we talk in English?" and "¿Me puedes escribir en inglés?" are both "en". "other" if they ask for a language not in the list. "none" if they are not asking to change language: mentioning a language, saying they speak it, or asking what a word means is "none".',
      ].join('\n'),
      messages: [{ role: 'user', content: t }],
    });
    if (res.stop_reason !== 'end_turn') return null;
    const block = res.content.find((b) => b.type === 'text');
    const out = JSON.parse(block.text);
    return {
      language: out.language,
      asksForVoice: out.asksForVoice === true,
      asksForTextOnly: out.asksForTextOnly === true,
      asksForLanguage: out.asksForLanguage || 'none',
    };
  } catch (e) {
    console.warn('[language] could not read message, carrying on without it:', e.message);
    return null;
  }
}

/* ─── A person's language ────────────────────────────────────────────────────
   The first identity with a language wins. Anything unknown is English, which
   is what every one of these messages was before. */
async function languageOf(db, userId) {
  // Test stubs and a box with no database have no profiles to read.
  if (!db || !userId || typeof db.getProfile !== 'function') return 'en';
  try {
    const ids = db.findAllIdentities ? await db.findAllIdentities(userId) : [userId];
    for (const id of [userId, ...ids.filter((x) => x !== userId)]) {
      const p = await db.getProfile(id);
      if (p && SUPPORTED.includes(p.language)) return p.language;
    }
  } catch (e) {
    console.warn('[language] could not read language, using English:', e.message);
  }
  return 'en';
}

/* Written to every identity, the same way "just text me" is, and only when it
   changed, so a conversation does not rewrite the profile on every message. */
async function rememberLanguage(db, userId, lang, known) {
  if (!db || !userId || !SUPPORTED.includes(lang) || lang === known) return;
  try {
    const ids = await db.findAllIdentities(userId);
    await Promise.all(ids.map((id) => db.saveProfile(id, { language: lang })));
    console.log(`[language] ${userId} now ${lang}`);
  } catch (e) {
    console.warn('[language] could not save language:', e.message);
  }
}

/* ─── Changing language after they have joined ───────────────────────────────
   Mariam, Sep 16: English is the default, and anybody can change language
   whenever they like, after registering as much as before. Somebody who signed
   up in German and then writes in English, or asks for English, has to get
   English from then on: the replies and the automatic messages both.

   Two ways in:

   - They just write in another language. The sponsor already follows them
     (LANGUAGES in the master prompt), and the automatic messages follow from
     the first message long enough to be sure of.
   - They ask. "Können wir auf Englisch reden?" is the case following alone gets
     wrong: the request is written in German, and so is everything after it, so
     their next message would pull the replies and the weekly note straight back
     to German. So a request is kept on the profile together with the language
     it was asked from. Writing in either of those two keeps it. Writing a proper
     message in a third language ends it, and so does asking for another one.

   Pure, so every case can be tested without a database or a model. `read` is
   what readMessage returned, or null when that failed. */
const SURE_LENGTH = 12;

function decideLanguage(read, text, profile) {
  const p = profile || {};
  const current = SUPPORTED.includes(p.language) ? p.language : 'en';
  const asked = p.languageAsked && SUPPORTED.includes(p.languageAsked.want) ? p.languageAsked : null;
  const out = { language: current, languageAsked: asked, replyLanguage: asked ? asked.want : null };
  if (!read) return out;

  const wrote = SUPPORTED.includes(read.language) ? read.language : null;
  const want = SUPPORTED.includes(read.asksForLanguage) ? read.asksForLanguage : null;

  // Asking is enough, however short the message. "English please" is clear.
  if (want) {
    const from = wrote || current;
    out.language = want;
    // Asked in the language they want: following them already does the job.
    out.languageAsked = want === from ? null : { want, from };
    out.replyLanguage = out.languageAsked ? want : null;
    return out;
  }

  // An "ok" or a name tells us nothing, so it changes nothing.
  if (!wrote || String(text || '').trim().length < SURE_LENGTH) return out;

  if (asked && (wrote === asked.from || wrote === asked.want)) return out;

  out.language = wrote;
  out.languageAsked = null;
  out.replyLanguage = null;
  return out;
}

/* Reads the message, decides, and saves what changed to every identity they
   hold, the same way "just text me" is saved. The save is not waited on: the
   reply only needs the decision, and a failed write costs one automatic
   message in the old language, not the conversation. */
/* A standing request, read from the database across every identity. Not from
   the profile the caller holds: the web chat keeps profiles in memory, and a
   request saved a message ago would not be in that copy yet. */
async function askedLanguageOf(db, userId, fallbackProfile) {
  if (!db || !userId || typeof db.getProfile !== 'function') {
    return (fallbackProfile && fallbackProfile.languageAsked) || null;
  }
  try {
    const ids = db.findAllIdentities ? await db.findAllIdentities(userId) : [userId];
    for (const id of [userId, ...ids.filter((x) => x !== userId)]) {
      const p = await db.getProfile(id);
      if (p && p.languageAsked && SUPPORTED.includes(p.languageAsked.want)) return p.languageAsked;
    }
  } catch (e) {
    console.warn('[language] could not read a language request:', e.message);
  }
  return null;
}

async function noteLanguage(db, userId, text, profile) {
  /* The language the automatic messages would use right now, read across
     every identity. Not just the row passed in: somebody who registered in
     German on the website can have 'de' on their reg- row and nothing on their
     wa- row, and deciding from the wa- row alone would see English, see
     nothing to change, and leave the weekly note in German. */
  const [read, known, asked] = await Promise.all([
    readMessage(text), languageOf(db, userId), askedLanguageOf(db, userId, profile),
  ]);
  const before = { language: known, languageAsked: asked };
  const next = decideLanguage(read, text, before);
  const languageChanged = next.language !== before.language;
  const askedChanged = JSON.stringify(before.languageAsked) !== JSON.stringify(next.languageAsked);

  if (db && userId && typeof db.findAllIdentities === 'function' && (languageChanged || askedChanged)) {
    db.findAllIdentities(userId)
      .then((ids) => Promise.all(ids.map(async (id) => {
        const change = {};
        if (languageChanged) change.language = next.language;
        if (next.languageAsked) change.languageAsked = next.languageAsked;
        if (Object.keys(change).length) await db.saveProfile(id, change);
        if (!next.languageAsked && before.languageAsked) await db.clearProfileField(id, 'languageAsked');
      })))
      .then(() => {
        const note = next.languageAsked ? ` (asked for it, writing in ${next.languageAsked.from})` : '';
        console.log(`[language] ${userId} now ${next.language}${note}`);
      })
      .catch((e) => console.warn('[language] could not save language:', e.message));
  }
  return { read, replyLanguage: next.replyLanguage };
}

/* ─── Sending a template in their language ───────────────────────────────────
   paramsFor(lang) builds the variables for that language, because the English
   fallback needs English variables too: a Spanish date inside the English
   template reads as broken. Meta answers 132001 when a name has no approved
   translation in that language, which is the normal state for a few minutes
   to a day after submitting one, so that one error drops to English. Anything
   else is thrown to the caller exactly as before. */
async function sendTemplateIn(mc, to, name, lang, paramsFor, urlParam = null) {
  const l = noticeLanguage(lang);
  if (l !== 'en') {
    try {
      return await mc.sendTemplate(to, name, paramsFor(l), urlParam, META_TEMPLATE_CODE[l]);
    } catch (e) {
      if (!/\b132001\b/.test(e.message || '')) throw e;
      console.warn(`[language] template ${name} has no approved ${l} translation yet, sending English`);
    }
  }
  return mc.sendTemplate(to, name, paramsFor('en'), urlParam, META_TEMPLATE_CODE.en);
}

module.exports = {
  SUPPORTED, NOTICE_LANGUAGES, META_TEMPLATE_CODE, LANGUAGE_NAMES,
  noticeLanguage, formatDay, readMessage, languageOf, rememberLanguage, sendTemplateIn,
  decideLanguage, noteLanguage,
};
