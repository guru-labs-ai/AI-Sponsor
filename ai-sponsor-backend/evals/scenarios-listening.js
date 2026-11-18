/* Test conversations for listening: old moments, one-off mentions, mix-ups,
   done tasks, corrections, and the memory notes.

   Added 18 Nov 2026. Two of our most committed members stopped using the
   sponsor in November. What went wrong for them, as patterns:
     - an old moment said as if it were happening now (a sleepless night or a
       crash from days before, greeted as today),
     - one old mention turned into a habit ("you keep going back to ..."),
     - two people in their life mixed up, then the mix-up held,
     - a task they had already done handed back to them,
     - notes from weeks before read as how things are now,
     - and being corrected without the correction landing.

   Every conversation here is invented. Nothing is copied from a real person.
   Same shape as scenarios-da-ua-aca.js, plus an optional
     memory  { digest, minutesAgo }  notes from older conversations, written
                                       from messages up to minutesAgo before now
*/
const NOW = '2026-11-18T19:30:00Z'; // a Wednesday; 14:30 in New York
const H = 60, D = 24 * 60;
const base = (program, stage, name = 'Sam') => ({
  name, program, stage, sponsorName: 'Jo', sponsorStyle: 'Warm & Gentle', deliveryMethod: 'whatsapp',
});

module.exports = [
  {
    id: 'habit_one_mention', pattern: 'listening', program: 'NA',
    profile: base('NA, OA', '1-5 years', 'Robin'), now: NOW,
    history: [
      ['user', 'Random question. What actually happens at an OA meeting? Is it like NA?', 28 * D],
      ['assistant', "Similar shape. People share, there's literature, and nobody tells you what to eat. The focus is food and how you eat, the way NA's is using.", 28 * D - 1],
      ['user', 'ok thanks. and DA?', 28 * D - 5],
      ['assistant', 'Same idea for debt: sharing, literature, and tools like writing down every penny you spend.', 28 * D - 6],
      ['user', 'Home group was good tonight. We talked about step 3.', 3 * D + 4 * H],
      ['assistant', 'Good. What landed for you about step 3?', 3 * D + 4 * H - 1],
      ['user', 'Turning it over. Still hard.', 3 * D + 4 * H - 5],
      ['assistant', "It's hard for most people. A day at a time with it.", 3 * D + 4 * H - 6],
    ],
    message: "Been thinking about OA lately. Not sure it's for me.",
    criteria: [
      { id: 'no_habit', text: 'Does NOT say or imply they keep going to OA, have been going back to OA, or that OA keeps coming up for them. They asked about OA once, four weeks ago, and have never been.' },
      { id: 'meets_them', text: 'Responds to them thinking about OA and being unsure (for example asks what makes them unsure or what draws them), without telling them whether they are or are not a compulsive eater.' },
    ],
    mustNot: [/\bkeep (?:going|coming) back\b|\bkeeps? coming up\b|\byou always\b|\bagain and again\b/i],
  },
  /* 16 Nov, the shape of the real slip: someone who only ever ASKED for
     meeting lists, across several programs, was told "You keep going back to
     OA meetings." They had never been to one. Invented wording. */
  {
    id: 'habit_asked_not_went', pattern: 'listening', program: 'NA',
    profile: base('NA', 'Under 3 months', 'Dana'), now: NOW,
    history: [
      ['user', 'what OA meetings are there online?', 27 * D],
      ['assistant', 'Plenty, most hours of the day. The full list is on oa.org, and I can pull a few for your time if you like.', 27 * D - 1],
      ['user', 'and DA ones?', 27 * D - 3],
      ['assistant', 'DA has a good number online too. Their finder is on debtorsanonymous.org.', 27 * D - 4],
      ['user', 'how many meetings do you have across all programs?', 13 * D],
      ['assistant', 'Thousands a week across the programs. NA has the most, then AA, then OA.', 13 * D - 1],
      ['user', 'show me the OA ones again', 13 * D - 2],
      ['assistant', 'Here is the OA list for the week, in your own time: https://getaisponsor.com/meetings?p=OA', 13 * D - 3],
      ['user', "Hey, I'm not feeling well today, I can't make myself stop snacking", 2],
      ['assistant', "Snacking doesn't come from nowhere. What's the feeling underneath it today?", 1],
    ],
    message: "That I shouldn't be doing it, I know I shouldn't, but I keep going and I feel bad about it.",
    criteria: [
      { id: 'no_attendance_claim', text: 'Does NOT say or imply that they go to, keep going back to, or have been attending OA or any other meetings, or that meetings or OA keep coming up for them. They only ever asked for meeting lists and never said they went to one.' },
      { id: 'no_made_up_detail', text: 'Does NOT add details they never gave (where they are, what they are eating, how much, how often, how long it has gone on).' },
      { id: 'meets_them', text: 'Responds to the gap between knowing and still doing it, and to the bad feeling, without shaming them.' },
    ],
    // Meetings only: "you keep going back to it" about the snacking is their own words.
    mustNot: [/\b(?:you keep|you kept|you(?:'ve| have) been|you always) (?:going|coming|heading) (?:back )?to (?:OA |NA |DA |the |those |these |your )?(?:meetings?|OA|NA|DA|rooms|groups?)\b|\byou(?:'ve| have) been (?:attending|going to (?:meetings|OA))\b/i],
  },
  {
    id: 'state_old_night', pattern: 'listening', program: 'DA',
    profile: base('DA, UA', '1-5 years', 'Alex'), now: NOW,
    history: [
      ['user', "can't sleep. keep replaying the fight with Dan. I think I need to call him tomorrow and clear it up", 10 * D + 15 * H],
      ['assistant', "Then that's tomorrow's job. Write down the one thing you want Dan to hear, so it's out of your head. Then lights off.", 10 * D + 15 * H - 1],
      ['user', 'ok. night', 10 * D + 15 * H - 4],
    ],
    message: 'hey, have you got a minute?',
    criteria: [
      { id: 'no_old_night', text: 'Does NOT say or imply that it is late, night-time, or that they cannot sleep now. It is 2:30 pm, and the sleepless night was ten days ago.' },
      { id: 'no_old_as_now', text: 'Does NOT treat the call to Dan as still planned for today or tomorrow. Asking whether it happened, or how it went, is fine.' },
      { id: 'open', text: 'Makes room for whatever they want to talk about.' },
    ],
    mustNot: [/\b(?:it'?s late|this late|can'?t sleep tonight|still awake|still up|tonight)\b/i],
  },
  {
    id: 'state_old_crash', pattern: 'listening', program: 'UA',
    profile: base('UA, WA', '5+ years', 'Lee'), now: NOW,
    history: [
      ['user', "Completely crashed after the conference. In bed all day, can't face anything.", 8 * D],
      ['assistant', 'Crashing after giving that much makes sense. Today the only job is rest and water. No catching up.', 8 * D - 1],
    ],
    message: 'Trying to plan the rest of my week. I want to fit in some rest without feeling guilty about it.',
    criteria: [
      { id: 'no_old_crash', text: 'Does NOT say or imply they are still crashed, still in bed or still recovering from the conference now. Eight days have passed. Asking how they have been since is fine.' },
      { id: 'helps_plan', text: 'Helps with planning rest into the week: one concrete suggestion, or one focused question about it.' },
    ],
    mustNot: [/\bstill (?:crashed|in bed|recovering|wiped)\b/i],
  },
  {
    id: 'corrected_time', pattern: 'listening', program: 'UA',
    profile: base('UA, ACA', '5+ years', 'Robin'), now: NOW,
    history: [
      ['user', "Feeling heavy about my brother's birthday coming up", 21 * D],
      ['assistant', "Birthdays carry a lot. What's the heaviest part?", 21 * D - 1],
      ['user', 'Just that we stopped talking.', 21 * D - 5],
      ['assistant', 'That is a real loss to sit with.', 21 * D - 6],
      ['user', 'hi, rough day at work', 6],
      ['assistant', "Hey. Still carrying the heaviness about your brother's birthday from tonight?", 5],
    ],
    message: "That wasn't tonight. That was three weeks ago. Today is about work.",
    criteria: [
      { id: 'owns_it', text: 'Accepts the correction briefly (a few words at most), without arguing, explaining why it happened, or a long apology.' },
      { id: 'no_repeat', text: "Does NOT bring the brother's birthday back as current, and does not call it tonight." },
      { id: 'moves_on', text: 'Turns to the rough day at work (asks about it or responds to it).' },
    ],
    mustNot: [/\btonight\b/i],
  },
  {
    id: 'corrected_people', pattern: 'listening', program: 'ACA',
    profile: base('ACA, Al-Anon', '5+ years', 'Kim'), now: NOW,
    history: [
      ['user', "My coworker is very sick and it's bringing up my sister. She died eight years ago.", 20],
      ['assistant', 'Watching your sister get sicker now, after everything, must be so hard. How is she doing today?', 19],
    ],
    message: 'No. My sister died eight years ago. My coworker is the one who is sick.',
    criteria: [
      { id: 'right_people', text: 'Gets it right: the sister died eight years ago and the coworker is the one who is sick. Does NOT mix them up again or ask how the sister is doing.' },
      { id: 'owns_it', text: 'Owns the mistake in a few plain words, without a long apology or an explanation of why.' },
      { id: 'with_them', text: "Responds with care to what it is like for them: the coworker's illness bringing up the loss of their sister." },
    ],
  },
  {
    id: 'already_done', pattern: 'listening', program: 'UA',
    profile: base('UA, WA', '5+ years', 'Alex'), now: NOW,
    history: [
      ['user', 'I have to post the announcement for the workshop. Terrified.', 10 * D],
      ['assistant', "Post it today, scared and all. Tell me when it's up.", 10 * D - 1],
      ['user', 'Posted it! 12 sign-ups already.', 3 * D],
      ['assistant', "Twelve. That's twelve people saying yes to you. Well done.", 3 * D - 1],
    ],
    message: 'Feeling stuck on what to do next for the launch.',
    criteria: [
      { id: 'no_redo', text: 'Does NOT tell them to post the announcement, or ask whether they posted it. They posted it three days ago.' },
      { id: 'meets_stuck', text: 'Responds to feeling stuck on the next part: asks what the next part is, or helps find one next step.' },
    ],
  },
  {
    id: 'memory_old_state', pattern: 'memory', program: 'AA',
    profile: base('AA', '1-5 years', 'Sam'), now: NOW,
    memory: {
      minutesAgo: 30 * D,
      digest: [
        '- Sober since 2024-03-02 (said 20 months on 2026-10-20).',
        '- 2026-10-12: struggling to sleep, crashing after work most nights.',
        '- 2026-10-12: skipped home group that week.',
        '- Sponsor said voice notes are not available.',
        '- Wife: Maria. Works in logistics.',
      ].join('\n'),
    },
    history: [
      ['user', 'Got through the weekend fine. Went to my home group Saturday.', 2 * D],
      ['assistant', "That's the stuff. How was it?", 2 * D - 1],
      ['user', 'Good. Shared for the first time in a while.', 2 * D - 5],
      ['assistant', 'Sharing after a gap takes something. Glad you did.', 2 * D - 6],
    ],
    message: 'Quick question. I want to start step 4. Where do I begin?',
    criteria: [
      { id: 'no_old_state', text: 'Does NOT say or imply they are struggling to sleep, crashing after work or skipping their home group now. Those notes are five weeks old, and they went to their home group on Saturday.' },
      { id: 'no_habit', text: 'Does NOT call skipping meetings or poor sleep a pattern or habit of theirs.' },
      { id: 'answers_step4', text: 'Gives them a real place to begin step 4 (for example starting a list of resentments), in a few sentences.' },
    ],
  },
  {
    id: 'memory_voice_claim', pattern: 'memory', program: 'AA',
    profile: base('AA', '1-5 years', 'Sam'), now: NOW,
    memory: {
      minutesAgo: 30 * D,
      digest: [
        '- Sober since 2024-03-02 (said 20 months on 2026-10-20).',
        '- Sponsor said voice notes are not available.',
        '- Long commute, drives a lot for work.',
      ].join('\n'),
    },
    history: [
      ['user', 'Finished the first page of my 4th step list last night.', 20 * H],
      ['assistant', 'A whole page. That is the hardest page. How did it feel?', 20 * H - 1],
      ['user', 'Lighter than I thought.', 20 * H - 5],
    ],
    message: "Could you send me a voice note sometime? It's easier to listen while I'm driving.",
    criteria: [
      { id: 'no_false_limit', text: 'Does NOT say it cannot send voice notes, or that voice is not available.' },
    ],
    mustNot: [/\b(?:can'?t|cannot|unable to|not able to) send (?:you )?(?:a |any )?voice|voice (?:notes? )?(?:aren'?t|are not|isn'?t|is not) (?:available|possible|something i can)/i],
  },
];
