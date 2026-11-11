/* ─── Where somebody is in the steps, saved ──────────────────────────────────
   Mariam, 11 Nov 2026: walking somebody through the Twelve Steps is the main
   job of a sponsor, and the sponsor already does it (WORKING THE STEPS WITH
   THEM in the master prompt). What it did not have was a fixed record. Which
   step and which piece of work lived only in the last 40 messages and, once
   they aged out, inside a 250-word memory note that is rewritten every twelve
   messages. A long patch of talking about other things could squeeze it out,
   and nothing outside the chat could see it: not the person, not Matt.

   So the sponsor now keeps the record itself. When the step work moves on, it
   ends its reply with one line

     [[step: <programme> | <step 1-12> | <where in the step> | <the piece of work, or none>]]

   which is taken out before anybody sees it (the same pattern as
   [[meeting-problem: ...]] in meetings.js) and saved. The saved record is put
   in front of it on every reply, it shows on the settings page as "Your
   steps", and the counts go to the North Star page.

   Everything here is pure, so test-steps.js can run it without a database. */

const MAX_TEXT = 200;
const MARKER = /\[\[\s*step\s*:\s*([^\]]*?)\s*\]\]/gi;

/* "none", "-", "n/a" and friends mean there is no piece of work right now. */
const NOTHING = /^(none|no|nothing|n\/?a|-+|—|no work|no piece of work|keine|nichts|ninguna|ninguno|nada|aucune|aucun|rien)(\s+(yet|so far|for now|right now))?\.?$/i;

function tidy(s) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim().replace(/^["“']|["”']$/g, '').trim();
  return t ? t.slice(0, MAX_TEXT) : '';
}

/* A step number, from "4", "Step 4", "step four"... only 1 to 12 counts. */
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
function stepNumber(s) {
  const t = String(s == null ? '' : s).toLowerCase();
  const d = t.match(/\d+/);
  let n = d ? parseInt(d[0], 10) : null;
  if (n === null) {
    const w = Object.keys(WORDS).find((k) => new RegExp(`\\b${k}\\b`).test(t));
    n = w ? WORDS[w] : null;
  }
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

/* One marker's inside, split on |. The programme is optional, so both
   "DA | 4 | ..." and "4 | ..." are read: the model drops the first field now
   and then, and losing the whole record over that would be worse than
   falling back to the programme on file. */
function parseMarker(inner, fallbackProgram) {
  const parts = String(inner || '').split('|').map((x) => x.trim());
  let program = '';
  let rest = parts;
  if (parts.length >= 2 && stepNumber(parts[0]) === null) {
    program = tidy(parts[0]);
    rest = parts.slice(1);
  }
  const step = stepNumber(rest[0]);
  if (step === null) return null;
  const part = tidy(rest[1]);
  const workRaw = tidy(rest.slice(2).join(' | '));
  const work = workRaw && !NOTHING.test(workRaw) ? workRaw : null;
  return {
    program: program || tidy(firstProgram(fallbackProgram)) || null,
    step,
    part: part && !NOTHING.test(part) ? part : null,
    work,
  };
}

/* Profiles can hold several programmes ("DA, BDA, UA"). The step record is for
   one of them, so without a programme in the marker the first one is used. */
function firstProgram(program) {
  return String(program || '').split(/[,/&]| and /i)[0].trim();
}

/* Takes every marker out of a reply. The last valid one wins: a reply that
   starts step 2 and then hands out its first piece of work describes where
   they are at the end of it. */
function stepsIn(reply, fallbackProgram) {
  let step = null;
  const clean = String(reply || '').replace(MARKER, (all, inner) => {
    const s = parseMarker(inner, fallbackProgram);
    if (s) step = s;
    return '';
  }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { clean, step };
}

/* "I'm on step 6", said in so many words. The sponsor is told to save that
   itself, and in replays it did 5 times out of 6: the miss was a reply busy
   asking good questions about the step, which forgot the line. So the plain
   statement is also read here, and saved when the reply did not save
   anything. Deliberately narrow: only a person saying where THEY are, never
   "what is step 6?" or "my friend is on step 4". */
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
function ordinalStep(w) {
  const t = String(w || '').toLowerCase().replace(/(st|nd|rd|th)$/, '');
  if (ORDINALS[String(w || '').toLowerCase()]) return ORDINALS[String(w || '').toLowerCase()];
  return stepNumber(t);
}
const NUM = '(\\d{1,2}(?:st|nd|rd|th)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const ORD = '(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\\d{1,2}(?:st|nd|rd|th))';
const TOLD = [
  new RegExp(`\\b(?:i'?m|i am|im|i've been|i have been|currently|now)\\s+(?:on|at|working(?: on)?|doing|starting|in)\\s+(?:step|steps?)\\s+${NUM}\\b`, 'i'),
  new RegExp(`\\b(?:i'?m|i am|im|i've been|i have been|currently|now)\\s+(?:on|at|working(?: on)?|doing|starting|in)\\s+(?:my|the)\\s+${ORD}\\s+step\\b`, 'i'),
  new RegExp(`\\bmy sponsor and i are (?:on|working(?: on)?|doing)\\s+(?:step\\s+${NUM}|the\\s+${ORD}\\s+step)`, 'i'),
];
function toldStep(message) {
  const t = String(message || '');
  for (const re of TOLD) {
    const m = t.match(re);
    if (m) {
      const n = ordinalStep(m[1] || m[2]);
      if (n) return n;
    }
  }
  return null;
}

/* Last line of defence before anything is sent or saved: a marker that slipped
   through a rewrite must never reach a person. */
function stripAll(text) {
  return String(text || '').replace(MARKER, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function dayLabel(at) {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/* What the sponsor is shown on every reply. Only facts it wrote itself, with
   the dates, so "last week you said you'd write down three times..." is
   something it can actually say. */
function buildStepsBlock(record) {
  if (!record || !record.step) return null;
  const lines = ['## WHERE THEY ARE IN THE STEPS (your own saved record)'];
  if (record.program) lines.push(`Programme: ${record.program}`);
  const since = dayLabel(record.since);
  lines.push(`Step ${record.step} of 12${since ? `, since ${since}` : ''}.`);
  if (record.part) lines.push(`Where they are in it: ${record.part}`);
  if (record.work) {
    const given = dayLabel(record.workAt);
    lines.push(`The last piece of step work you gave them${given ? `, on ${given}` : ''}: ${record.work}`);
  } else {
    lines.push('No piece of step work is open right now.');
  }
  lines.push(
    'This is your own record from earlier conversations, and it is right unless they tell you otherwise. ' +
    'When they come back, ask about that exact piece of work, by name, the way "Keeping the thread" in your instructions says, ' +
    'unless they arrive with something heavier. Never read this record out to them like a list.'
  );
  return lines.join('\n');
}

/* How the sponsor keeps the record up to date. Static, so it sits in the
   cached part of the prompt. Only on the paths that take the marker out of the
   reply before it is sent (not the streaming web chat, where every word is on
   the screen the moment it is written). */
const KEEPING_BLOCK = [
  '## KEEPING YOUR STEP RECORD',
  'You keep a short record of where they are in the steps. When there is one, it is shown to you above as WHERE THEY ARE IN THE STEPS.',
  'You update it yourself by ending your reply with one line in exactly this form:',
  '[[step: <their programme> | <the step they are on now, 1 to 12> | <where they are in that step, a few words> | <the piece of step work you just gave them, a few words, or none>]]',
  'It is taken out before they see it. Write it only in a reply where one of these happens:',
  '- you start a step with them',
  '- you give them a new piece of step work',
  '- they finish a piece of work or a whole step and you move them on (the number is the step they are on now)',
  '- they tell you which step they are on, for example with a human sponsor',
  '- nothing is saved yet, but this conversation or your notes already show which step they are on',
  'Write it in the same reply where it happens, even when that reply also asks them a question. When they tell you which step they are on, that reply carries the line, whatever else you say.',
  'The test: if you left the line out, would the record you are shown next time be wrong or missing something from this reply? Then write it.',
  'They read this record on their own settings page, so write the piece of work the way you would say it to them ("write down three times you..."), never "he" or "they", and never anything they have not told you.',
  'Never write it in any other reply, and never just to repeat what is already saved. Write the words in the language you are speaking with them. It is only for the Twelve Steps of their programme, never for anything else.',
].join('\n');

module.exports = { stepsIn, stripAll, parseMarker, stepNumber, toldStep, buildStepsBlock, KEEPING_BLOCK, firstProgram, MARKER };
