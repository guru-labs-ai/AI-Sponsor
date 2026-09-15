/* The sponsor in other languages. Run: node test-languages.js

   Four things, none of which need a database, a Meta token or a model:

   1. Crisis lines are recognised in every language the sponsor speaks, the
      same way 988 is in English. The two copies of the pattern (server.js and
      whatsapp.js) are read out of the shipped source and must stay identical.
   2. Every translated automatic message is complete: a body, a template text
      with its variables, a button, and words for a missing name.
   3. A translated template that Meta has not approved yet drops to English,
      with English variables, and nothing else is swallowed.
   4. English is untouched: the same wording and dates it had before. */
const fs = require('fs');
const path = require('path');
const language = require('./language');
const copy = require('./notice-copy');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n— ${t}`);

function crisisPattern(file, endMark) {
  const src = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
  const a = src.indexOf('const CRISIS_RESOURCE');
  const b = src.indexOf(endMark, a);
  return { text: src.slice(a, b).replace(/\r\n/g, '\n').trim(), re: new Function(`${src.slice(a, b)}; return CRISIS_RESOURCE;`)() };
}

(async () => {
  group('crisis lines in every language');
  const wa = crisisPattern('whatsapp.js', 'const HAS_LINK');
  const sv = crisisPattern('server.js', 'const ANY_EMOJI');
  check('server.js and whatsapp.js carry the same pattern', wa.text === sv.text, true);

  [
    'Please call or text 988 right now.',
    'Samaritans are on 116 123, any time.',
    'Llama a la Línea de la Vida al 800 911 2000.',
    'En España puedes llamar al 024.',
    'Ligue para o CVV no 188, é gratuito.',
    'Appelle le 3114, c’est gratuit et anonyme.',
    'Ruf die Telefonseelsorge an: 0800 111 0 111.',
    'Chiama Telefono Amico, adesso.',
    'Позвони на телефон доверия прямо сейчас.',
    'Hemen intihar önleme hattını ara.',
    'اتصل بخط المساعدة الآن.',
    'कृपया अभी Tele-MANAS हेल्पलाइन 14416 पर कॉल करें।',
    '请现在拨打心理援助热线 12356。',
    'いのちの電話に電話してください。',
    '자살예방 상담전화 109에 지금 전화하세요.',
    'Hubungi hotline kesehatan jiwa 119 ext 8.',
    'Gọi đường dây nóng ngay nhé.',
  ].forEach((t) => check(`recognised: ${t.slice(0, 40)}`, wa.re.test(t), true));

  [
    'That sounds hard. What happened after work?',
    'Hoy fue un día difícil, ¿qué pasó?',
    'Ich bin stolz auf dich.',
    'Я рядом.',
    '今日はどうだった？',
    'In 2024 I went to 3 meetings.',
  ].forEach((t) => check(`left alone: ${t.slice(0, 40)}`, wa.re.test(t), false));

  group('every translated automatic message is complete');
  const others = language.NOTICE_LANGUAGES.filter((l) => l !== 'en');
  for (const l of others) {
    const L = copy.LEAVING[l], T = copy.TRIAL[l], W = copy.WEEKLY[l], C = copy.CHECKIN[l];
    const twoVars = (s) => /\{\{1\}\}/.test(s) && /\{\{2\}\}/.test(s);
    check(`${l}: leaving templates take name and date`, twoVars(L.templateBeta) && twoVars(L.templatePaid), true);
    check(`${l}: trial template takes name and date`, twoVars(T.template), true);
    check(`${l}: weekly templates take a name`, ['hard', 'quiet', 'good'].every((k) => /\{\{1\}\}/.test(W.templates[k])), true);
    check(`${l}: check-in template takes a name`, /\{\{1\}\}/.test(C.template), true);
    // Meta rejects a body that ends on a variable.
    const all = [L.templateBeta, L.templatePaid, T.template, C.template, ...Object.values(W.templates)];
    check(`${l}: no template ends on a variable`, all.every((s) => !/\}\}\s*$/.test(s)), true);
    check(`${l}: buttons are labelled`, [L.button, T.button, W.button].every((s) => s && s.length <= 25), true);
    check(`${l}: missing names have stand-ins`, !!copy.SERVICE_NAME_FALLBACK[l] && !!copy.SPONSOR_NAME_FALLBACK[l], true);
    check(`${l}: the leaving notice carries the date and link`,
      copy.leavingBody(l, true, { first: 'Ana', when: 'DATE', link: 'LINK' }).includes('DATE')
      && copy.leavingBody(l, false, { first: '', when: 'DATE', link: 'LINK' }).includes('LINK'), true);
    check(`${l}: the trial notice keeps the price`, /5/.test(copy.trialBody(l, { first: 'Ana', when: 'D', link: 'L' })), true);
    check(`${l}: a nameless weekly nudge starts with a capital`,
      /^\p{Lu}/u.test(copy.weeklyBody(l, 'good', { first: '', link: 'L' })), true);
  }

  group('dates');
  check('English is unchanged', language.formatDay('2026-09-29T00:00:00Z', 'en'), '29 September');
  check('Spanish', language.formatDay('2026-09-29T00:00:00Z', 'es'), '29 de septiembre');
  check('German', language.formatDay('2026-09-29T00:00:00Z', 'de'), '29. September');
  check('a language without translated notices falls back to English dates', language.formatDay('2026-09-29T00:00:00Z', 'ja'), '29 September');

  group('templates fall back to English while a translation waits on Meta');
  const calls = [];
  const mc = (failWith) => ({
    sendTemplate: async (to, name, params, url, code) => {
      calls.push({ name, params, code });
      if (failWith && code !== 'en_US') throw new Error(failWith);
      return { messageId: 'x' };
    },
  });
  const paramsFor = (l) => [copy.SPONSOR_NAME_FALLBACK[l], language.formatDay('2026-09-29', l)];

  calls.length = 0;
  await language.sendTemplateIn(mc(null), 'to', 'trial_ending', 'es', paramsFor, 't#plan');
  check('an approved translation is used, with Spanish variables', calls, [{ name: 'trial_ending', params: ['a ti', '29 de septiembre'], code: 'es' }]);

  calls.length = 0;
  await language.sendTemplateIn(mc('Meta 404 (132001): template name does not exist in the translation'), 'to', 'trial_ending', 'pt', paramsFor);
  check('an unapproved one drops to English, with English variables',
    calls.map((c) => c.code).concat(calls[1] ? calls[1].params : []), ['pt_BR', 'en_US', 'there', '29 September']);

  calls.length = 0;
  let thrown = null;
  try { await language.sendTemplateIn(mc('Meta 400 (131047): outside window'), 'to', 'trial_ending', 'fr', paramsFor); } catch (e) { thrown = e.message; }
  check('any other error is thrown, not hidden behind English', [calls.length, /131047/.test(thrown || '')], [1, true]);

  calls.length = 0;
  await language.sendTemplateIn(mc(null), 'to', 'weekly_review', 'ja', paramsFor);
  check('a language with no translated templates goes straight to English', calls.map((c) => c.code), ['en_US']);

  group('English is untouched');
  const trial = require('./trialnotice');
  check('the English trial notice has its old wording',
    trial.trialEndingBody({ first: 'Lindsay', when: '29 September', link: 'L' }).startsWith('Lindsay, quick note about your account, not a message from your sponsor.'), true);
  check('the English check-in has its old wording', require('./checkin').checkinText('Dara Nwosu'),
    'Hi Dara, it has been a few days. No agenda, I just wanted to see how you are.');

  group('reading a message never blocks anything');
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  check('with no key it returns null, and callers carry on', await language.readMessage('Hola, mándame un audio'), null);
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
  check('an unknown person is English', await language.languageOf({ getProfile: async () => null, findAllIdentities: async (id) => [id] }, 'wa-1'), 'en');
  check('a remembered language is found on another identity',
    await language.languageOf({ getProfile: async (id) => (id === 'reg-1' ? { language: 'ru' } : {}), findAllIdentities: async () => ['wa-1', 'reg-1'] }, 'wa-1'), 'ru');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
