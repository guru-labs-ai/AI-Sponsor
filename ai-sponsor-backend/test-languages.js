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

  group('a message that must arrive never rides a MARKETING translation (Mariam, Sep 17)');
  const withCategory = (category, fail) => {
    const m = mc(null);
    m.templateCategory = async (n, code) => { if (fail) throw new Error('Meta 500'); return typeof category === 'function' ? category(code) : category; };
    return m;
  };
  calls.length = 0;
  await language.sendTemplateIn(withCategory('UTILITY'), 'to', 'trial_ending', 'ru', paramsFor, null, { mustArrive: true });
  check('a translation Meta kept as UTILITY is used', calls.map((c) => c.code), ['ru']);
  calls.length = 0;
  await language.sendTemplateIn(withCategory('MARKETING'), 'to', 'trial_ending', 'es', paramsFor, null, { mustArrive: true });
  check('a translation Meta moved to MARKETING sends the English instead, with English variables',
    calls, [{ name: 'trial_ending', params: ['there', '29 September'], code: 'en_US' }]);
  calls.length = 0;
  await language.sendTemplateIn(withCategory(null, true), 'to', 'trial_ending', 'de', paramsFor, null, { mustArrive: true });
  check('when the category cannot be read, English goes', calls.map((c) => c.code), ['en_US']);
  calls.length = 0;
  await language.sendTemplateIn(mc(null), 'to', 'trial_ending', 'fr', paramsFor, null, { mustArrive: true });
  check('a sender that cannot tell categories sends English', calls.map((c) => c.code), ['en_US']);
  calls.length = 0;
  await language.sendTemplateIn(withCategory('MARKETING'), 'to', 'weekly_review_quiet', 'es', paramsFor);
  check('messages that do not have to arrive are unchanged: the translation is still used', calls.map((c) => c.code), ['es']);

  // The rewrite under its own name (trial_ending_v2), because Meta will not recategorise the original.
  const withInfo = (table) => {
    const m = mc(null);
    m.templateInfo = async (n, code) => table[`${n}|${code}`] || null;
    return m;
  };
  calls.length = 0;
  await language.sendTemplateIn(withInfo({
    'trial_ending|es': { category: 'MARKETING', status: 'APPROVED' },
    'trial_ending_v2|es': { category: 'UTILITY', status: 'APPROVED' },
  }), 'to', 'trial_ending', 'es', paramsFor, null, { mustArrive: true, alsoTry: ['trial_ending_v2'] });
  check('original MARKETING, rewrite approved as UTILITY: the rewrite goes, in Spanish',
    calls.map((c) => [c.name, c.code]), [['trial_ending_v2', 'es']]);
  calls.length = 0;
  await language.sendTemplateIn(withInfo({
    'trial_ending|es': { category: 'MARKETING', status: 'APPROVED' },
    'trial_ending_v2|es': { category: 'UTILITY', status: 'PENDING' },
  }), 'to', 'trial_ending', 'es', paramsFor, null, { mustArrive: true, alsoTry: ['trial_ending_v2'] });
  check('rewrite still in review: English goes, and nothing is attempted in review',
    calls.map((c) => [c.name, c.code]), [['trial_ending', 'en_US']]);
  calls.length = 0;
  await language.sendTemplateIn(withInfo({ 'trial_ending|ru': { category: 'UTILITY', status: 'APPROVED' } }),
    'to', 'trial_ending', 'ru', paramsFor, null, { mustArrive: true, alsoTry: ['trial_ending_v2'] });
  check('an original still UTILITY is used first', calls.map((c) => [c.name, c.code]), [['trial_ending', 'ru']]);
  calls.length = 0;
  let mustThrown = null;
  try {
    const m = mc('Meta 400 (131026): message undeliverable');
    m.templateCategory = async () => 'UTILITY';
    await language.sendTemplateIn(m, 'to', 'trial_ending', 'it', paramsFor, null, { mustArrive: true });
  } catch (e) { mustThrown = e.message; }
  check('a must-arrive translation that fails for any reason is retried in English, not given up on',
    [calls.map((c) => c.code), mustThrown], [['it', 'en_US'], null]);

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

  group('changing language after joining (Mariam, Sep 16)');
  const R = (lang, asks = 'none') => ({ language: lang, asksForVoice: false, asksForTextOnly: false, asksForLanguage: asks });
  const decide = language.decideLanguage;
  const long = 'this is a proper sentence';

  check('signed up in German, just writes in English: English, nothing kept',
    decide(R('en'), long, { language: 'de' }), { language: 'en', languageAsked: null, replyLanguage: null });
  check('signed up in German, asks in English for English: English, nothing to keep',
    decide(R('en', 'en'), 'Can we talk in English?', { language: 'de' }), { language: 'en', languageAsked: null, replyLanguage: null });
  check('signed up in German, asks in German for English: English, and the request is kept',
    decide(R('de', 'en'), 'Können wir auf Englisch reden?', { language: 'de' }),
    { language: 'en', languageAsked: { want: 'en', from: 'de' }, replyLanguage: 'en' });
  check('after asking, more German does not pull it back to German',
    decide(R('de'), 'Heute war ein schwerer Tag für mich', { language: 'en', languageAsked: { want: 'en', from: 'de' } }),
    { language: 'en', languageAsked: { want: 'en', from: 'de' }, replyLanguage: 'en' });
  check('after asking, writing in English keeps English',
    decide(R('en'), long, { language: 'en', languageAsked: { want: 'en', from: 'de' } }),
    { language: 'en', languageAsked: { want: 'en', from: 'de' }, replyLanguage: 'en' });
  check('after asking, a proper message in a third language switches to it',
    decide(R('es'), 'Hoy fue un día muy difícil para mí', { language: 'en', languageAsked: { want: 'en', from: 'de' } }),
    { language: 'es', languageAsked: null, replyLanguage: null });
  check('asking to go back to German works the same way',
    decide(R('en', 'de'), 'Can we go back to German?', { language: 'en', languageAsked: { want: 'en', from: 'de' } }),
    { language: 'de', languageAsked: { want: 'de', from: 'en' }, replyLanguage: 'de' });
  check('a one-word request with no clear language is kept against the language they were in',
    decide(R('unclear', 'en'), 'English?', { language: 'de' }),
    { language: 'en', languageAsked: { want: 'en', from: 'de' }, replyLanguage: 'en' });
  check('an "ok" changes nothing',
    decide(R('en'), 'ok', { language: 'de' }), { language: 'de', languageAsked: null, replyLanguage: null });
  check('asking for a language we do not support changes nothing',
    decide(R('en', 'other'), 'Can we speak Polish?', { language: 'en' }), { language: 'en', languageAsked: null, replyLanguage: null });
  check('when the message could not be read, a standing request still holds',
    decide(null, long, { language: 'en', languageAsked: { want: 'en', from: 'de' } }),
    { language: 'en', languageAsked: { want: 'en', from: 'de' }, replyLanguage: 'en' });
  check('nobody who never chose anything is English',
    decide(R('unclear'), '👍', {}), { language: 'en', languageAsked: null, replyLanguage: null });

  /* noteLanguage against a fake database: what gets saved, and to whom. The
     model is not called (no key), so these run the "read failed" path with the
     language already on the profile. */
  const fakeDb = (rows) => {
    const writes = [];
    return {
      writes,
      getProfile: async (id) => rows[id] || null,
      findAllIdentities: async () => Object.keys(rows),
      saveProfile: async (id, change) => { writes.push(['save', id, change]); rows[id] = { ...(rows[id] || {}), ...change }; },
      clearProfileField: async (id, key) => { writes.push(['clear', id, key]); if (rows[id]) delete rows[id][key]; },
    };
  };
  delete process.env.ANTHROPIC_API_KEY;
  const d1 = fakeDb({ 'wa-1': {}, 'reg-1': { language: 'en', languageAsked: { want: 'en', from: 'de' } } });
  const n1 = await language.noteLanguage(d1, 'wa-1', long, { /* stale copy, no request on it */ });
  check('a request saved on another identity is honoured even when the caller holds a stale profile', n1.replyLanguage, 'en');
  await new Promise((r) => setTimeout(r, 10));
  check('and nothing is rewritten when nothing changed', d1.writes, []);
  if (saved) process.env.ANTHROPIC_API_KEY = saved;

  group('choosing a language on the settings page (Bilal, Sep 16)');
  const d2 = fakeDb({ 'wa-2': {}, 'reg-2': { language: 'de' } });
  const c2 = await language.chooseLanguage(d2, 'wa-2', 'en');
  check('signed up in German, picks English: English, kept as a request', [c2.language, c2.languageAsked], ['en', { want: 'en', from: 'de' }]);
  check('and it is written to every identity they hold',
    d2.writes.filter((w) => w[0] === 'save').map((w) => w[1]).sort(), ['reg-2', 'wa-2']);
  const d3 = fakeDb({ 'wa-3': { language: 'es' } });
  const c3 = await language.chooseLanguage(d3, 'wa-3', 'es');
  check('picking the language they already have changes nothing', [c3.languageAsked, d3.writes], [null, []]);
  const d4 = fakeDb({ 'wa-4': { language: 'en', languageAsked: { want: 'en', from: 'de' } } });
  const c4 = await language.chooseLanguage(d4, 'wa-4', 'es');
  check('a new choice replaces an older request', [c4.language, c4.languageAsked], ['es', { want: 'es', from: 'en' }]);
  let refused = null;
  try { await language.chooseLanguage(d4, 'wa-4', 'xx'); } catch (e) { refused = e.message; }
  check('a language we do not have is refused', refused, 'unsupported language');

  group('the reply is told, and the note is never stored');
  const serverSrc = fs.readFileSync(path.resolve(__dirname, 'server.js'), 'utf8').replace(/\r\n/g, '\n');
  const cut = (name) => {
    const at = serverSrc.indexOf(`function ${name}(`);
    return serverSrc.slice(at, serverSrc.indexOf('\n}\n', at) + 3);
  };
  const { buildLanguageBlock, withLanguageNote } = new Function('language',
    `${cut('buildLanguageBlock')}\n${cut('withLanguageNote')}\nreturn { buildLanguageBlock, withLanguageNote };`)(language);

  check('no request, no block', buildLanguageBlock(null), '');
  check('a request names the language in the block', /talk to them in English/.test(buildLanguageBlock('en')), true);
  const convo = [{ role: 'user', content: 'Hallo' }, { role: 'assistant', content: 'Hallo Anna' }, { role: 'user', content: 'Heute war schwer' }];
  const frozen = JSON.stringify(convo);
  check('no request, the messages go out untouched', withLanguageNote(convo, null), convo);
  const noted = withLanguageNote(convo, 'en');
  check('a request adds the note beside the message being answered',
    noted[2].content.map((p) => p.text), ['Heute war schwer', '(A note from the app, not from them: earlier they asked you to talk to them in English. Reply in English. Do not mention this note.)']);
  check('the earlier turns are the same objects', [noted[0] === convo[0], noted[1] === convo[1]], [true, true]);
  check('the stored history is not changed', JSON.stringify(convo), frozen);
  const cached = [{ role: 'user', content: [{ type: 'text', text: 'Heute war schwer', cache_control: { type: 'ephemeral' } }] }];
  check('a message already split into parts keeps its parts',
    withLanguageNote(cached, 'de')[0].content.length === 2 && cached[0].content.length === 1, true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
