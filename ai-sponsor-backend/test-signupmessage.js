/* Offline tests for the first WhatsApp message after sign-up.
   Nothing here reaches Meta or the database: both are stubbed, and we assert
   on who gets the message and what is sent.

   Run: node test-signupmessage.js
*/

const assert = require('assert');
const { sendSignupMessage, decide, firstName, TEMPLATE, EVENT } = require('./signupmessage');
const language = require('./language');

function fakeDb({ history = [], sentBefore = false } = {}) {
  const calls = { events: [], outbound: [] };
  return {
    calls,
    getHistory: async () => history,
    hasEvent: async (id, ev) => sentBefore && ev === EVENT,
    recordEvent: async (id, ev, detail) => { calls.events.push({ id, ev, detail }); },
    recordOutbound: async (id, wamid, kind, via) => { calls.outbound.push({ id, wamid, kind, via }); },
  };
}

function fakeMeta({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    enabled: true,
    templateInfo: async () => ({ category: 'UTILITY', status: 'APPROVED' }),
    sendTemplate: async (to, name, params, url, code) => {
      if (fail) throw new Error('(#132001) Template name does not exist in the translation');
      sent.push({ to, name, params, url, code });
      return { messageId: 'wamid.TEST' };
    },
  };
}

const base = {
  waId: 'wa-+14155550123', phone: '+14155550123', name: 'Sam Rivera',
  email: 'sam@example.com', delivery: 'whatsapp', lang: 'en', returning: false, mirrored: true,
};

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('a new WhatsApp sign-up gets the message, by first name, in the approved template', async () => {
  const db = fakeDb();
  const mc = fakeMeta();
  const r = await sendSignupMessage({ db, language, metacloud: mc, ...base });
  assert.strictEqual(r.sent, true);
  assert.strictEqual(mc.sent.length, 1);
  assert.strictEqual(mc.sent[0].name, TEMPLATE);
  assert.strictEqual(mc.sent[0].to, '+14155550123');
  assert.deepStrictEqual(mc.sent[0].params, ['Sam']);
  assert.strictEqual(mc.sent[0].code, 'en_US');
  assert.deepStrictEqual(db.calls.outbound[0], { id: base.waId, wamid: 'wamid.TEST', kind: 'signup', via: 'template' });
  assert.strictEqual(db.calls.events[0].ev, EVENT);
});

test('a web chat sign-up gets nothing', async () => {
  const mc = fakeMeta();
  const r = await sendSignupMessage({ db: fakeDb(), language, metacloud: mc, ...base, delivery: 'web' });
  assert.strictEqual(r.sent, false);
  assert.strictEqual(r.reason, 'not-whatsapp');
  assert.strictEqual(mc.sent.length, 0);
});

test('somebody signing up a second time gets nothing', async () => {
  const mc = fakeMeta();
  const r = await sendSignupMessage({ db: fakeDb(), language, metacloud: mc, ...base, returning: true });
  assert.strictEqual(r.reason, 'returning');
  assert.strictEqual(mc.sent.length, 0);
});

test('a number that belongs to somebody else gets nothing', async () => {
  const mc = fakeMeta();
  const r = await sendSignupMessage({ db: fakeDb(), language, metacloud: mc, ...base, mirrored: false });
  assert.strictEqual(r.reason, 'number-belongs-to-someone-else');
  assert.strictEqual(mc.sent.length, 0);
});

test('a number that already talks to us gets nothing', async () => {
  const mc = fakeMeta();
  const r = await sendSignupMessage({ db: fakeDb({ history: [{ role: 'user', content: 'hi' }] }), language, metacloud: mc, ...base });
  assert.strictEqual(r.reason, 'already-talking');
  assert.strictEqual(mc.sent.length, 0);
});

test('it is never sent twice to the same number', async () => {
  const mc = fakeMeta();
  const r = await sendSignupMessage({ db: fakeDb({ sentBefore: true }), language, metacloud: mc, ...base });
  assert.strictEqual(r.reason, 'already-sent');
  assert.strictEqual(mc.sent.length, 0);
});

test('a QA Guru test sign-up gets nothing', async () => {
  const mc = fakeMeta();
  const r = await sendSignupMessage({ db: fakeDb(), language, metacloud: mc, ...base, email: 'qa-proj-x@reloulexei.resend.app' });
  assert.strictEqual(r.reason, 'qa-test');
  assert.strictEqual(mc.sent.length, 0);
});

test('a Spanish sign-up gets the English message while there is no approved Spanish one', async () => {
  const mc = fakeMeta();
  mc.templateInfo = async (name, code) => (code === 'en_US' ? { category: 'UTILITY', status: 'APPROVED' } : null);
  const r = await sendSignupMessage({ db: fakeDb(), language, metacloud: mc, ...base, lang: 'es' });
  assert.strictEqual(r.sent, true);
  assert.strictEqual(mc.sent[0].code, 'en_US');
});

test('when Meta refuses, the registration is not affected and nothing is thrown', async () => {
  const r = await sendSignupMessage({ db: fakeDb(), language, metacloud: fakeMeta({ fail: true }), ...base });
  assert.strictEqual(r.sent, false);
  assert.strictEqual(r.reason, 'error');
});

test('first names are safe to send', () => {
  assert.strictEqual(firstName('  Mariam G '), 'Mariam');
  assert.strictEqual(firstName(''), 'there');
  assert.strictEqual(firstName(undefined), 'there');
  assert.strictEqual(firstName('123'), 'there');
  assert.strictEqual(firstName('José'), 'José');
});

test('the rules on their own', () => {
  assert.strictEqual(decide({ ...base }).send, true);
  assert.strictEqual(decide({ ...base, phone: '' }).reason, 'no-phone');
  assert.strictEqual(decide({ ...base, delivery: 'WhatsApp' }).send, true);
  assert.strictEqual(decide({ ...base, delivery: '' }).reason, 'not-whatsapp');
});

(async () => {
  let pass = 0;
  let fail = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      pass++;
      console.log(`  ok  ${name}`);
    } catch (e) {
      fail++;
      console.log(`  FAIL ${name}\n       ${e.message}`);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
