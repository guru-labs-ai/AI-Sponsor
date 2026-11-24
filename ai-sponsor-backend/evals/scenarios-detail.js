/* Test conversations for asking for more: a question typed without the
   question mark, and asking for an answer in depth.

   Added 24 Nov 2026, from the 21 Nov review of the first people who joined
   from an AA WhatsApp group. One of them asked "what is the meaning of third
   step prayer" with no question mark and got one line that did not answer it;
   then asked for an answer "in depth" three times and got one or two lines each
   time, because every longer answer was cut back to a small-talk length. Their
   last message, "please explain me down below", was read as nothing having
   come through. They have not written since.

   Every conversation here is invented. Nothing is copied from a real person.
   Same shape as scenarios-da-ua-aca.js, plus
     minWords / maxWords   the reply's length, checked without the judge
*/
const NOW = '2026-11-18T19:30:00Z'; // a Wednesday; 14:30 in New York
const H = 60, D = 24 * 60;
const base = (program, stage, name = 'Sam') => ({
  name, program, stage, sponsorName: 'Jo', sponsorStyle: 'Warm & Gentle', deliveryMethod: 'whatsapp',
});

module.exports = [
  {
    id: 'q_no_mark_meaning', pattern: 'detail', program: 'AA',
    profile: base('AA', '3-12 months', 'Ravi'), now: NOW,
    history: [
      ['user', 'my home group read the third step prayer tonight', 20],
      ['assistant', "That one's a good one to sit with. Did any line stay with you?", 19],
    ],
    message: 'what is the meaning of third step prayer',
    criteria: [
      { id: 'answers_meaning', text: 'Actually explains what the Third Step prayer means: offering yourself, your will and your life to God or a Higher Power as you understand it, asking to be relieved of the bondage of self, so you can be of use to others. Asking them a question back, or only telling them to sit with it, does not pass.' },
      { id: 'no_brush_off', text: 'Does NOT brush the question off with a one-line saying or a task (for example "tonight\'s work is one honest sentence") instead of an answer.' },
    ],
    minWords: 40,
  },
  {
    id: 'detail_in_depth', pattern: 'detail', program: 'AA',
    profile: base('AA', '3-12 months', 'Ravi'), now: NOW,
    history: [
      ['user', 'what is step 7 about?', 12],
      ['assistant', 'Step 7 is asking, humbly, for your shortcomings to be removed. Step 6 is getting ready; Step 7 is the asking.', 11],
    ],
    message: 'in depth please',
    criteria: [
      { id: 'goes_further', text: 'Gives a fuller explanation of Step 7 than the earlier two-line answer: for example what humility means in it, what "shortcomings" are, how the asking is done (the Seventh Step prayer or in their own words), or how it shows up in a real day. A restatement of the earlier answer in other words does not pass.' },
      { id: 'no_clarifying_only', text: 'Does NOT reply only with a question about what they mean or what they want to know.' },
    ],
    minWords: 90,
  },
  {
    id: 'detail_explain_below', pattern: 'detail', program: 'AA',
    profile: base('AA', '3-12 months', 'Ravi'), now: NOW,
    history: [
      ['user', 'my sponsor in group said I must admit I am powerless. I dont get it', 15],
      ['assistant', "Powerless over alcohol, not over your whole life. It's admitting it beat you when you fought it alone.", 14],
    ],
    message: 'please explain me down below',
    criteria: [
      { id: 'explains_step1', text: 'Explains powerlessness in Step 1 more fully: what it does and does not mean, why admitting it helps, how it can look in daily life.' },
      { id: 'no_nothing_came', text: 'Does NOT say or suggest that nothing came through, that their message was empty or cut off, or ask them to send it again.' },
    ],
    minWords: 80,
  },
  {
    id: 'detail_tell_more', pattern: 'detail', program: 'NA',
    profile: base('NA', '1-5 years', 'Kim'), now: NOW,
    history: [
      ['user', 'thinking about starting step 4 soon', 30],
      ['assistant', "That's a big one, and a good sign you're ready to look. Have you talked to your sponsor about how they'd like you to write it?", 29],
      ['user', 'not yet', 25],
      ['assistant', "Worth doing first. People write it different ways, and their way is the one you'll go through together.", 24],
    ],
    message: 'tell me more about how people write it',
    criteria: [
      { id: 'real_ways', text: 'Describes at least two real ways people write a Fourth Step inventory (for example columns for resentments, fears and harms; answering the questions in the NA Step Working Guide; a written life story), with enough detail to picture doing it.' },
      { id: 'no_clarifying_only', text: 'Does NOT reply only with a question about what they mean or what they want to know.' },
    ],
    minWords: 90,
  },
  /* Controls: the length rule must still hold where nobody asked for more. */
  {
    id: 'ctrl_small_talk', pattern: 'control', program: 'AA',
    profile: base('AA', '1-5 years', 'Lee'), now: NOW,
    history: [
      ['user', 'going to my home group tonight', 5 * H],
      ['assistant', 'Good. Say hi to the coffee pot for me.', 5 * H - 1],
    ],
    message: 'had a good meeting tonight, feeling lighter',
    criteria: [
      { id: 'meets_them', text: 'Responds warmly to the good meeting and to them feeling lighter.' },
    ],
    maxWords: 60,
  },
  {
    id: 'ctrl_cant_explain', pattern: 'control', program: 'AA',
    profile: base('AA', '1-5 years', 'Lee'), now: NOW,
    history: [
      ['user', 'morning', 3 * H],
      ['assistant', 'Morning. How did you sleep?', 3 * H - 1],
    ],
    message: "I can't explain how I feel today, just heavy",
    criteria: [
      { id: 'meets_them', text: 'Meets the heaviness gently, without lecturing or explaining feelings to them at length.' },
    ],
    maxWords: 70,
  },
];
