/* American spelling on what members read.

   Matt, 21 Nov 2026: "you're all not using american english it's european so
   its super goofy for people to get that in the usa like 'favour' is 'favor'
   ... we need to address this across everything including in WA experience".
   The sponsor's instructions now spell the American way and tell it to, but a
   test on 24 Nov showed it still copies a member's own British word back: told
   "a friend asked me for a big favour", it answered "What's the favour?" in 2
   of 3 runs. So English text gets one last pass here before anyone reads it.

   Kept deliberately narrow, so it can never change what something means:
     - an explicit list of words, never a general "-ise to -ize" rule (that
       would turn "advise", "exercise" and "promise" into nonsense);
     - only English text; the callers decide that;
     - a capitalised word is changed only at the start of a sentence. In the
       middle of one it is most likely a name ("Rideau Centre", "Harbour Group",
       a meeting), and a name is left exactly as it is;
     - nothing inside a link or an email address. */

const PAIRS = {};
const add = (brit, amer) => { PAIRS[brit] = amer; };

// -our -> -or, with the forms people actually write.
[
  ['behaviour', 'behavior'], ['favour', 'favor'], ['colour', 'color'], ['honour', 'honor'],
  ['neighbour', 'neighbor'], ['humour', 'humor'], ['rumour', 'rumor'], ['endeavour', 'endeavor'],
  ['flavour', 'flavor'], ['savour', 'savor'], ['vigour', 'vigor'], ['odour', 'odor'],
  ['saviour', 'savior'], ['armour', 'armor'], ['valour', 'valor'], ['demeanour', 'demeanor'],
  ['labour', 'labor'], ['harbour', 'harbor'], ['candour', 'candor'],
].forEach(([b, a]) => {
  for (const end of ['', 's', 'ed', 'ing']) add(b + end, a + end);
});
add('behavioural', 'behavioral'); add('behaviourally', 'behaviorally');
add('favourite', 'favorite'); add('favourites', 'favorites');
add('favourable', 'favorable'); add('favourably', 'favorably'); add('unfavourable', 'unfavorable');
add('colourful', 'colorful'); add('honourable', 'honorable'); add('dishonour', 'dishonor');
add('neighbourhood', 'neighborhood'); add('neighbourhoods', 'neighborhoods');
add('humourous', 'humorous');

// -ise / -yse -> -ize / -yze, only for these words.
[
  'realis', 'recognis', 'apologis', 'organis', 'prioritis', 'summaris', 'minimis', 'maximis',
  'emphasis', 'criticis', 'memoris', 'normalis', 'personalis', 'visualis', 'sympathis',
  'empathis', 'agonis', 'categoris', 'energis', 'stabilis', 'utilis', 'finalis', 'optimis',
  'specialis', 'socialis', 'fantasis', 'romanticis', 'idolis', 'jeopardis', 'rationalis',
  'verbalis', 'internalis', 'catastrophis', 'traumatis', 'stigmatis', 'authoris', 'familiaris',
  'characteris', 'moralis', 'scrutinis', 'patronis', 'generalis', 'hospitalis',
  'institutionalis', 'neutralis', 'materialis', 'conceptualis', 'trivialis', 'humanis',
  'demonis', 'harmonis', 'customis', 'compartmentalis', 'sanitis', 'mobilis', 'penalis',
  'pressuris', 'desensitis', 'sensitis', 'reorganis', 'disorganis', 're-energis',
].forEach((stem) => {
  const us = stem.slice(0, -1) + 'z';
  for (const end of ['e', 'ed', 'es', 'ing', 'ation', 'ations', 'able', 'er', 'ers']) add(stem + end, us + end);
});
// "analyses" is also the plural of "analysis", the same in American English: left alone.
['analys', 'paralys', 'catalys'].forEach((stem) => {
  const us = stem.slice(0, -1) + 'z';
  for (const end of ['e', 'ed', 'ing']) add(stem + end, us + end);
});

// -re -> -er
[['centre', 'center'], ['theatre', 'theater'], ['fibre', 'fiber'], ['calibre', 'caliber'],
 ['sombre', 'somber'], ['spectre', 'specter']].forEach(([b, a]) => {
  add(b, a); add(b + 's', a + 's');
});
add('centred', 'centered');

// Doubled l
[
  ['counsellor', 'counselor'], ['counsellors', 'counselors'], ['counselling', 'counseling'], ['counselled', 'counseled'],
  ['travelling', 'traveling'], ['travelled', 'traveled'], ['traveller', 'traveler'], ['travellers', 'travelers'],
  ['cancelled', 'canceled'], ['cancelling', 'canceling'],
  ['modelling', 'modeling'], ['modelled', 'modeled'], ['labelled', 'labeled'], ['labelling', 'labeling'],
  ['fuelled', 'fueled'], ['fuelling', 'fueling'], ['levelled', 'leveled'], ['signalled', 'signaled'],
  ['signalling', 'signaling'], ['channelled', 'channeled'], ['spiralled', 'spiraled'], ['spiralling', 'spiraling'],
  ['dialled', 'dialed'], ['dialling', 'dialing'], ['unravelled', 'unraveled'], ['unravelling', 'unraveling'],
  ['quarrelled', 'quarreled'], ['marvellous', 'marvelous'], ['jewellery', 'jewelry'], ['grovelling', 'groveling'],
].forEach(([b, a]) => add(b, a));

// Everything else
[
  ['programme', 'program'], ['programmes', 'programs'],
  ['judgement', 'judgment'], ['judgements', 'judgments'], ['judgemental', 'judgmental'],
  ['acknowledgement', 'acknowledgment'], ['acknowledgements', 'acknowledgments'],
  ['licence', 'license'], ['licences', 'licenses'],
  ['defence', 'defense'], ['offence', 'offense'], ['offences', 'offenses'], ['pretence', 'pretense'],
  ['practise', 'practice'], ['practised', 'practiced'], ['practises', 'practices'], ['practising', 'practicing'],
  ['enrol', 'enroll'], ['enrolment', 'enrollment'], ['fulfil', 'fulfill'], ['fulfilment', 'fulfillment'],
  ['instil', 'instill'], ['skilful', 'skillful'], ['wilful', 'willful'],
  ['sceptic', 'skeptic'], ['sceptical', 'skeptical'], ['scepticism', 'skepticism'],
  ['ageing', 'aging'], ['pyjamas', 'pajamas'], ['manoeuvre', 'maneuver'],
  ['whilst', 'while'], ['learnt', 'learned'],
].forEach(([b, a]) => add(b, a));

const WORD = new RegExp(`\\b(${Object.keys(PAIRS).sort((x, y) => y.length - x.length).join('|')})\\b`, 'gi');
// Links and email addresses pass through untouched.
const PROTECTED = /(https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.-]+)/gi;
// Where a sentence starts: the very beginning, after . ! ? or a line break,
// with an optional bullet or opening quote/bracket in between.
const SENTENCE_START = /(^|[.!?]["'”’)]?\s+|\n)\s*(?:[-•*]\s+)?["'“‘(]?$/;

/* English text in, the same text with American spelling out. Anything that is
   not a string comes back as it was. */
function americanize(text) {
  if (typeof text !== 'string' || !text) return text;
  const links = [];
  PROTECTED.lastIndex = 0;
  let m;
  while ((m = PROTECTED.exec(text))) links.push([m.index, m.index + m[0].length]);
  const inLink = (at) => links.some(([a, b]) => at >= a && at < b);

  return text.replace(WORD, (word, _w, offset, whole) => {
    if (inLink(offset)) return word;
    const lower = word.toLowerCase();
    const us = PAIRS[lower];
    if (!us) return word;
    if (word === lower) return us;
    if (word === word.toUpperCase()) return word; // SHOUTING or an acronym: leave it
    if (word[0] === word[0].toUpperCase() && word.slice(1) === lower.slice(1)) {
      // Capitalised: change it only where a sentence starts, never a name.
      return SENTENCE_START.test(whole.slice(0, offset)) ? us[0].toUpperCase() + us.slice(1) : word;
    }
    return word; // mixed case: not ours to guess
  });
}

const isEnglish = (lang) => !lang || lang === 'en' || /^en[-_]/i.test(String(lang));

module.exports = { americanize, isEnglish, PAIRS };
