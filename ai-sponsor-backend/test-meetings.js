/* Guards the meetings the sponsor hands out. Run: node test-meetings.js

   Offline. The meeting list is replaced with a fixed one, and the clock is
   passed in, so every answer here is exact.

   What going wrong would look like, each one landing on somebody who has just
   worked up the nerve to go to a meeting:
   1. A time converted wrongly, so they arrive an hour late, especially in the
      week the UK and US change their clocks on different days.
   2. A meeting from a list nobody has refreshed in months.
   3. Meeting data pushed into a conversation about meeting a friend.
   4. A program we hold no data for getting somebody else's meetings.          */
const path = require('path');
const meetings = require(path.resolve(__dirname, 'meetings.js'));
const refresh = require(path.resolve(__dirname, 'meetings-refresh.js'));

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n— ${t}`);

const at = (iso) => Date.parse(iso);
const NY_TUESDAY = {
  id: 'da-1', program: 'DA', name: 'Tuesday Visions', days: [2], start: '19:30', end: '20:30',
  zone: 'America/New_York', link: 'https://us02web.zoom.us/j/12345678901', passcode: '512788', access: 'closed',
};
const LONDON_MONDAY = {
  id: 'da-2', program: 'BDA', name: 'Prosperity and Serenity', days: [1], start: '09:15', end: '10:30',
  zone: 'Europe/London', link: 'https://zoom.us/j/952138930?pwd=abc', passcode: null, access: 'open',
};
const WA_DAILY = {
  id: 'wa-1', program: 'WA', name: 'Underscheduling', days: [0, 1, 2, 3, 4, 5, 6], start: '18:00', end: '19:00',
  zone: 'Europe/London', link: 'https://zoom.us/j/98765432100?pwd=xyz', passcode: null, access: 'open',
};
const fresh = (generatedAt) => ({ generatedAt, meetings: [NY_TUESDAY, LONDON_MONDAY, WA_DAILY] });

group('which programs we cover, from what registration stores');
check('codes',                meetings.programsOf('DA, BDA, UA, ACA, WA, Al-Anon'), ['DA', 'BDA', 'WA', 'UA', 'ACA', 'Al-Anon']);
check('long names',           meetings.programsOf('Debtors Anonymous, Workaholics Anonymous'), ['DA', 'WA']);
check('AA, NA and Al-Anon',   meetings.programsOf('AA, NA, Al-Anon'), ['Al-Anon', 'AA', 'NA']);
check('nothing we hold',      meetings.programsOf('GA, S Anon, Chronic Pain Anon'), []);
check('OA and SLAA are searchable', meetings.programsOf('OA, SLAA'), ['OA', 'SLAA']);
check('"slaa meeting" and "an OA meeting"', [meetings.programsIn('any slaa meetings?'), meetings.programsIn('find me an OA meeting')], [['SLAA'], ['OA']]);
check('UA is not DA',         meetings.programsOf('UA'), ['UA']);
check('ACA by its long name', meetings.programsOf('Adult Children of Alcoholics'), ['ACA']);

group('only when they are talking about meetings');
check('asks for a meeting',   meetings.asksAboutMeetings('Can you find me a meeting tonight?'), true);
check('zoom',                 meetings.asksAboutMeetings('is there a zoom I can join'), true);
check('no mention',           meetings.asksAboutMeetings('I had a hard day at work'), false);

group('converting times, across clock changes');
// 2026: UK clocks go back Sun 25 Oct, US clocks Sun 1 Nov. In between, New
// York is four hours behind London instead of five.
check('NY 19:30 in October is 23:30 UTC',
  meetings.instantFor('America/New_York', 2026, 9, 20, 19, 30), at('2026-10-20T23:30:00Z'));
check('NY 19:30 after US change is 00:30 UTC next day',
  meetings.instantFor('America/New_York', 2026, 10, 3, 19, 30), at('2026-11-04T00:30:00Z'));
check('London 09:15 in summer time is 08:15 UTC',
  meetings.instantFor('Europe/London', 2026, 9, 19, 9, 15), at('2026-10-19T08:15:00Z'));
check('London 09:15 after UK change is 09:15 UTC',
  meetings.instantFor('Europe/London', 2026, 9, 26, 9, 15), at('2026-10-26T09:15:00Z'));

group('the next meeting, said in their own time');
const tueNoonUtc = at('2026-10-20T12:00:00Z');
const next = meetings.nextStart(NY_TUESDAY, tueNoonUtc);
check('NY Tuesday meeting is tonight', next, at('2026-10-20T23:30:00Z'));
check('a Londoner hears it as half past midnight tomorrow',
  meetings.describeWhen(next, 'Europe/London', tueNoonUtc), 'tomorrow, Wednesday 21 October, at 12:30am');
check('a New Yorker hears it as tonight',
  meetings.describeWhen(next, 'America/New_York', tueNoonUtc), 'today, Tuesday 20 October, at 7:30pm');
check('the gap week: London hears 11:30pm once the UK has changed',
  meetings.describeWhen(meetings.nextStart(NY_TUESDAY, at('2026-10-27T12:00:00Z')), 'Europe/London', at('2026-10-27T12:00:00Z')),
  'today, Tuesday 27 October, at 11:30pm');
check('just started still counts',
  meetings.nextStart(NY_TUESDAY, at('2026-10-20T23:35:00Z')), at('2026-10-20T23:30:00Z'));
check('long started moves to next week',
  meetings.nextStart(NY_TUESDAY, at('2026-10-20T23:45:00Z')), at('2026-10-27T23:30:00Z'));

group('the block the sponsor sees');
meetings._setData(fresh('2026-10-20T08:00:00Z'));
const block = meetings.buildMeetingsBlock({
  message: 'can you find me a DA or BDA meeting', programField: 'DA, BDA, UA', userZone: 'Europe/London', now: tueNoonUtc,
});
check('a meeting at 12:30am their time is not offered', block.includes('Tuesday Visions'), false);
const nyBlock = meetings.buildMeetingsBlock({
  message: 'can you find me a DA meeting', programField: 'DA', userZone: 'America/New_York', now: tueNoonUtc,
});
check('a New Yorker gets it tonight, exact link and passcode',
  nyBlock.includes('- today, Tuesday 20 October, at 7:30pm | "Tuesday Visions" | listed as Tuesday 7:30pm America/New_York time | closed | https://us02web.zoom.us/j/12345678901 | passcode 512788'), true);
check('has the BDA meeting, next Monday',
  block.includes('- Monday 26 October at 9:15am | "Prosperity and Serenity" | listed as Monday 9:15am Europe/London time | open | https://zoom.us/j/952138930?pwd=abc'), true);
check('no WA meetings for someone not in WA', block.includes('Underscheduling'), false);
check('says when it was checked', block.includes('official listing on 20 October'), true);
check('tells it never to invent', block.includes('never offer one that is not on this list'), true);

check('nothing when they are not asking',
  meetings.buildMeetingsBlock({ message: 'I feel low today', programField: 'DA', userZone: 'Europe/London', now: tueNoonUtc }), '');
const uncovered = meetings.buildMeetingsBlock({ message: 'any GA meetings today?', programField: 'DA', userZone: 'Europe/London', now: tueNoonUtc });
check('a program we hold no meetings for: leads with its official finder, names no meeting',
  [uncovered.includes('https://gamblersanonymous.org/find-a-meeting/'), uncovered.includes('Do not open with what you cannot do'), uncovered.includes('Tuesday Visions')], [true, true, false]);
const coda = meetings.buildMeetingsBlock({ message: 'CoDA meetings?', programField: '', userZone: 'Europe/London', now: tueNoonUtc });
check('a program with no checked finder link: no link is made up', [coda.includes('never make up a link'), /coda\.org/i.test(coda)], [true, false]);
const oneOnFile = meetings.buildMeetingsBlock({ message: 'can you look for the meetings of today', programField: 'NA', userZone: 'Asia/Tbilisi', now: tueNoonUtc });
check('one program on file, none named: straight to that program, no question (Mariam\'s rule, 21 Oct)',
  [/ask (which|what) program/.test(oneOnFile), oneOnFile.includes('Narcotics Anonymous'), oneOnFile.includes('https://www.na.org/meetingsearch/')], [false, true, true]);
const nothingOnFile = meetings.buildMeetingsBlock({ message: 'can you look for the meetings of today', programField: '', userZone: 'Asia/Tbilisi', now: tueNoonUtc });
check('nothing on file (Mariam, Matt): asks what programs they are looking for today, and that it will search',
  [nothingOnFile.includes('"What programs are you looking for today? I\'ll search for you."'), nothingOnFile.includes('Never say you cannot look up meetings'), /zoom\.us/.test(nothingOnFile)], [true, true, false]);
check('says it has no in-person list', block.includes('These are online meetings only'), true);

const daily = meetings.buildMeetingsBlock({ message: 'WA meetings this week?', programField: 'WA', userZone: 'Europe/London', now: tueNoonUtc });
check('a daily meeting is listed once a day, today and tomorrow',
  (daily.match(/"Underscheduling"/g) || []).length, 2);
check('and today\'s is first', daily.includes('- today, Tuesday 20 October, at 6pm | "Underscheduling"'), true);

const unplaced = meetings.buildMeetingsBlock({ message: 'WA meeting?', programField: 'WA', userZone: null, now: tueNoonUtc });
check('no zone: time stays in the meeting\'s own zone, labelled',
  [unplaced.includes('- Tuesday 20 October at 6pm Europe/London time | "Underscheduling"'), /^- (today|tomorrow)/m.test(unplaced)], [true, false]);

group('a list nobody refreshed is never shown');
meetings._setData(fresh('2026-09-01T08:00:00Z'));
const stale = meetings.buildMeetingsBlock({ message: 'a DA meeting please', programField: 'DA', userZone: 'Europe/London', now: tueNoonUtc });
check('stale list: no meeting names', stale.includes('Tuesday Visions'), false);
check('stale list: points at the official finder', stale.includes('https://debtorsanonymous.org/meeting-info/'), true);
meetings._setData({ generatedAt: 'nonsense', meetings: [NY_TUESDAY] });
check('unreadable date counts as stale',
  meetings.buildMeetingsBlock({ message: 'DA meeting', programField: 'DA', userZone: null, now: tueNoonUtc }).includes('Tuesday Visions'), false);

group('the refresh rules, on real listing text');
const page = (video, extra = '') => `<p>Copy this link</p> | Tuesday Visions | Closed D.A. meeting #120 | Meeting focus: | Steps | Primary language: | English | ${video} ${extra} | Information last updated January 02 2026 | Print page`;
const goodVideo = 'Video venue | Tuesday | 07:30 pm to 08:30 pm | (local time) | Video platform: | ZOOM | Link (click to connect): | https://us06web.zoom.us/j/81647734312 | Meeting ID: | 816 4773 4312 | Password: | 512788 |';
const now = at('2026-10-20T12:00:00Z');
const good = refresh.parseDaDetail(page(goodVideo));
check('a complete listing is kept', refresh.daProblem(good, now), null);
check('its time is read as 24h', [good.start, good.end], ['19:30', '20:30']);
check('http and a doubled slash are normalised',
  refresh.parseDaDetail(page(goodVideo.replace('https://us06web.zoom.us/j/', 'http://us06web.zoom.us//j/'))).link, 'https://us06web.zoom.us/j/81647734312');
check('id only: link built from the listed id',
  refresh.parseDaDetail(page(goodVideo.replace('https://us06web.zoom.us/j/81647734312 |', ''))).link, 'https://zoom.us/j/81647734312');
check('no passcode anywhere is left out',
  refresh.daProblem(refresh.parseDaDetail(page(goodVideo.replace('| Password: | 512788 |', '|'))), now), 'no passcode in the link or the listing');
check('"email for the password" is left out',
  refresh.daProblem(refresh.parseDaDetail(page(goodVideo, 'Please email us to receive the password.')), now), 'listing says to ask someone for the link or password');
check('monthly is left out',
  refresh.daProblem(refresh.parseDaDetail(page(goodVideo, 'Meets the first Tuesday of the month.')), now), 'not weekly');
check('a rotating weekly format is kept',
  refresh.daProblem(refresh.parseDaDetail(page(goodVideo, 'Week 1: Steps. Week 2: Tools.')), now), null);
check('an old listing is left out',
  refresh.daProblem(refresh.parseDaDetail(page(goodVideo).replace('January 02 2026', 'March 10 2024')), now), 'listing last updated 2024-03-10');
check('another language is left out',
  refresh.daProblem(refresh.parseDaDetail(page(goodVideo).replace('English', 'Spanish')), now), 'language is Spanish');
check('"Password: email us" is left out',
  refresh.daProblem(refresh.parseDaDetail(page(goodVideo.replace('| Password: | 512788 |', '| Password: email us at group@example.com |'))), now) !== null, true);

group('one directory failing does not take the others down');
const fresh2 = (p, n) => Array.from({ length: n }, (_, i) => ({ id: `${p}-${i}`, program: p }));
const prev = { generatedAt: '2026-10-10T05:00:00Z', meetings: [...fresh2('ACA', 3), ...fresh2('DA', 2)] };
const ran = refresh.assemble([
  { programs: ['DA', 'BDA'], found: [...fresh2('DA', 60), ...fresh2('BDA', 20)] },
  { programs: ['ACA'], error: 'HTTP 503' },
  { programs: ['WA'], found: fresh2('WA', 2) },
], prev, new Date('2026-10-21T05:00:00Z'));
check('DA refreshed, checked now', ran.checked.DA, '2026-10-21T05:00:00.000Z');
check('ACA kept its last meetings', ran.meetings.filter((m) => m.program === 'ACA').length, 3);
check('ACA keeps its OLD check date, so the 21-day guard still applies', ran.checked.ACA, '2026-10-10T05:00:00Z');
check('a thin WA answer is not believed, and there is nothing to fall back on', ran.checked.WA, undefined);
check('each problem is reported', ran.problems.length, 2);

group('the block, per program and with who a meeting is for');
const AA_WOMEN = {
  id: 'aa-1', program: 'AA', name: 'Women on the Way', days: [2], start: '18:00', zone: 'Europe/London',
  link: 'https://zoom.us/j/11122233344?pwd=x', passcode: null, access: 'closed', who: 'women',
};
const UA_UNKNOWN = {
  id: 'ua-1', program: 'UA', name: 'Prosperity Tuesday', days: [2], start: '19:00', zone: 'Europe/London',
  link: 'https://zoom.us/j/55566677788?pwd=y', passcode: null, access: null, who: null,
};
meetings._setData({
  generatedAt: '2026-10-20T08:00:00Z',
  checked: { AA: '2026-10-20T08:00:00Z', UA: '2026-10-20T08:00:00Z', WA: '2026-09-01T08:00:00Z' },
  meetings: [AA_WOMEN, UA_UNKNOWN, WA_DAILY],
});
const mixed = meetings.buildMeetingsBlock({ message: 'any AA, UA or WA meetings tonight?', programField: 'AA, UA, WA', userZone: 'Europe/London', now: tueNoonUtc });
const several = meetings.buildMeetingsBlock({ message: 'any meetings tonight?', programField: 'AA, UA, WA', userZone: 'Europe/London', now: tueNoonUtc });
check('in several programs and none named: it asks which one first',
  [several.includes('ask which program'), several.includes('Women on the Way')], [true, false]);
const single = meetings.buildMeetingsBlock({ message: 'any meetings tonight?', programField: 'AA', userZone: 'Europe/London', now: tueNoonUtc });
check('in one program and none named: straight to its meetings',
  [single.includes('ask which program'), single.includes('"Women on the Way"')], [false, true]);
check('in several programs it asks "Which program, or programs"', several.includes('"Which program, or programs, are you looking for?"'), true);
check('naming it brings the meetings straight away',
  meetings.buildMeetingsBlock({ message: 'any AA meetings tonight?', programField: 'AA', userZone: 'Europe/London', now: tueNoonUtc }).includes('"Women on the Way"'), true);
check('a women-only meeting says so', mixed.includes('| "Women on the Way" | listed as Tuesday 6pm Europe/London time | closed | women only | https://zoom.us/j/11122233344?pwd=x'), true);
check('unknown open/closed is simply left out', mixed.includes('| "Prosperity Tuesday" | listed as Tuesday 7pm Europe/London time | https://zoom.us/j/55566677788?pwd=y'), true);
check('it is told who a gendered meeting is for', mixed.includes('only for people of that gender'), true);
check('a program whose own list is stale is not offered', mixed.includes('Underscheduling'), false);
check('and leads with its finder instead',
  [mixed.includes('For Workaholics Anonymous, do not name any specific meeting'), mixed.includes('Lead with the official finder as the answer itself, warmly: https://workaholics-anonymous.org/meetings/')], [true, true]);

group('no program on file (people who started on WhatsApp, Matt\'s test on 21 Oct)');
check('"an AA meeting"', meetings.programsIn('Can you find me an AA meeting tonight?'), ['AA']);
check('lower case right before "meeting"', meetings.programsIn('any aa meetings near me'), ['AA']);
check('Al-Anon spelled loosely', meetings.programsIn('is there an alanon group'), ['Al-Anon']);
check('Debtors Anonymous is not Business Debtors', meetings.programsIn('Debtors Anonymous please'), ['DA']);
check('Business Debtors Anonymous', meetings.programsIn('business debtors anonymous meeting'), ['BDA']);
check('ordinary words never match', meetings.programsIn('the data was bad, wa wa, aaah, a meeting at work'), []);
meetings._setData({ generatedAt: '2026-10-20T08:00:00Z', meetings: [AA_WOMEN, NY_TUESDAY] });
const noProgram = meetings.buildMeetingsBlock({ message: 'Can you find me a meeting?', programField: '', userZone: 'Europe/London', now: tueNoonUtc });
check('no program, no name in the message: it asks what programs first',
  [noProgram.includes('ask what program, or programs'), noProgram.includes('Alcoholics Anonymous'), /zoom\.us/.test(noProgram)], [true, true, false]);
const two = meetings.buildMeetingsBlock({ message: 'AA and Al-Anon please', programField: '', userZone: 'Europe/London', now: tueNoonUtc, recentMessages: 'find me a meeting\nWhat programs are you looking for today?' });
check('answering with two programs brings both', two.includes('Alcoholics Anonymous:'), true);
const named = meetings.buildMeetingsBlock({ message: 'find me an AA meeting', programField: '', userZone: 'Europe/London', now: tueNoonUtc });
check('naming the program in the message brings its meetings', named.includes('"Women on the Way"'), true);
check('and only that program\'s', named.includes('Tuesday Visions'), false);
const answer = meetings.buildMeetingsBlock({
  message: 'AA', programField: '', userZone: 'Europe/London', now: tueNoonUtc,
  recentMessages: 'Can you find me a meeting?\nWhich program?',
});
check('"AA" answering "which program?" brings the meetings', answer.includes('"Women on the Way"'), true);
check('"AA" out of the blue does not', meetings.buildMeetingsBlock({ message: 'AA', programField: '', userZone: 'Europe/London', now: tueNoonUtc, recentMessages: 'I had a long day.\nHow was it?' }), '');
const afterAa = 'AA\n- "Women on the Way", today at 6pm, https://zoom.us/j/11122233344?pwd=x';
check('"any more tomorrow?" after AA stays with AA, with no program on file',
  meetings.buildMeetingsBlock({ message: 'any more tomorrow?', programField: '', userZone: 'Europe/London', now: tueNoonUtc, recentMessages: afterAa, lastUserMessage: 'AA' }).includes('"Women on the Way"'), true);
const followDa = meetings.buildMeetingsBlock({ message: 'what about Friday?', programField: 'DA', userZone: 'Europe/London', now: tueNoonUtc, recentMessages: afterAa, lastUserMessage: 'find me an AA meeting' });
check('someone in DA who just asked for AA: "what about Friday?" is still AA',
  [followDa.includes('"Women on the Way"'), followDa.includes('Tuesday Visions')], [true, false]);
check('once the talk has moved on, nothing is added',
  meetings.buildMeetingsBlock({ message: 'ok', programField: 'DA', userZone: 'Europe/London', now: tueNoonUtc, recentMessages: 'I am tired today\nThat sounds hard.', lastUserMessage: 'I am tired today' }), '');
group('Matt\'s and Mariam\'s real messages, 21 Oct');
const waReply = 'WA\n"Sober Play" today at 5:30pm, open: https://zoom.us/j/88237374526?pwd=N04';
const programsInBlock = (b) => [...b.matchAll(/^(Debtors Anonymous|Business Debtors Anonymous|Workaholics Anonymous|Underearners Anonymous|Adult Children of Alcoholics|Al-Anon|Alcoholics Anonymous|Narcotics Anonymous|Overeaters Anonymous|Sex and Love Addicts Anonymous):$/gm)].map((x) => x[1]);
const fakeData = { generatedAt: '2026-10-20T08:00:00Z', meetings: ['DA', 'BDA', 'UA', 'WA', 'Al-Anon'].map((p, i) => ({ ...WA_DAILY, id: `x-${i}`, program: p, name: `${p} meeting` })) };
meetings._setData(fakeData);
const ask = (message, lastUserMessage) => programsInBlock(meetings.buildMeetingsBlock({ message, programField: '', userZone: 'Europe/London', now: tueNoonUtc, recentMessages: waReply, lastUserMessage }));
check('"How about right now for da" after WA means DA, not WA', ask('How about right now for da', 'WA'), ['Debtors Anonymous']);
check('"Bda?"', ask('Bda?', 'How about right now for da'), ['Business Debtors Anonymous']);
check('"Ua?"', ask('Ua?', 'Bda?'), ['Underearners Anonymous']);
check('"What about al-anob and BDA" brings both', ask('What about al-anob and BDA', 'And what about debtors anonymous meetings?'), ['Business Debtors Anonymous', 'Al-Anon']);
check('outside meeting talk, "da" is still not a program', meetings.programsIn('da da da'), []);
check('"Alanna" is not Al-Anon even in meeting talk', meetings.programsIn('Alanna said hi', { loose: true }), []);
const anyBlock = meetings.buildMeetingsBlock({ message: 'Ua?', programField: '', userZone: 'Europe/London', now: tueNoonUtc, recentMessages: waReply, lastUserMessage: 'WA' });
check('every block says it CAN look meetings up, and to drop an earlier "I can\'t"',
  [anyBlock.includes('Never say you cannot look up meetings or schedules: you can'), anyBlock.includes('If earlier in this chat you said you could not, that has changed')], [true, true]);
check('every block carries the real finder links, so none is made up (UA is .org)',
  anyBlock.includes('Underearners Anonymous https://underearnersanonymous.org/meetings-underearners-anonymous/'), true);

check('asking about another program overrides the one on file',
  meetings.buildMeetingsBlock({ message: 'any AA meetings?', programField: 'DA', userZone: 'Europe/London', now: tueNoonUtc }).includes('Tuesday Visions'), false);

group('reading NA\'s world list');
const naRow = {
  id_bigint: '177552', weekday_tinyint: '1', venue_type: '2', start_time: '00:00:00', time_zone: 'America/Chicago', formats: 'CC,VM,W',
  lang_enum: 'en', meeting_name: 'Awokenings Group', comments: '', virtual_meeting_link: 'https://us02web.zoom.us/j/9191086501',
  virtual_meeting_additional_info: 'Zoom ID 919-108-6501 PW 091999',
};
check('a good NA listing is kept', refresh.naProblem(naRow), null);
check('NA weekday 1 is Sunday, time and zone kept', (({ days, start, zone }) => ({ days, start, zone }))(refresh.naMeeting(naRow)), { days: [0], start: '00:00', zone: 'America/Chicago' });
check('NA "PW 091999" is the passcode', [refresh.naMeeting(naRow).link, refresh.naMeeting(naRow).passcode], ['https://us02web.zoom.us/j/9191086501', '091999']);
check('NA format W is women only', refresh.naMeeting(naRow).who, 'women');
check('NA with a blank time zone is left out, never guessed', refresh.naProblem({ ...naRow, time_zone: '' }), 'unknown time zone (none)');
check('NA in another language is left out', refresh.naProblem({ ...naRow, lang_enum: 'pt' }), 'language is pt');
check('an NA service committee is left out', refresh.naProblem({ ...naRow, meeting_name: 'Policy Review Subcommittee' }), 'service meeting');

group('asking for the link, told apart from a contact line (real listing text, 21 Oct)');
const asks = (t) => refresh.textProblem('X', t) === 'listing says to ask someone for the link or password';
for (const t of ['Please email us to receive the password.', 'To get the zoom password, please email women@example.com to retrieve the password.',
  'Contact morning.group@gmail.com for log in information.', 'Please email atl.group@gmail.com for the zoom link password.', 'Email Group Rep for Zoom Link!',
  'PLEASE Email nyc.rep@gmail.com for OUR 35 WEEKLY Meeting LINKS', 'Password: email us at a@b.com', 'Ask the meeting contact for login information prior to the meeting.']) {
  check(`asks: "${t.slice(0, 45)}"`, asks(t), true);
}
for (const t of ['Group email: | ua.group@gmail.com | Zoom', 'If you have problems connecting, please contact this group using the information on this listing.',
  'Join Zoom Meeting | Meeting ID: 811 0517 7232 | Passcode: 1212 | One tap mobile | call-in number', 'Contact: a.b@c.com for questions about the group']) {
  check(`does not ask: "${t.slice(0, 45)}"`, asks(t), false);
}

group('reading OA meeting pages');
const oaPage = (head, online) => `<h1>Meeting 800011</h1><p>Meeting search</p><p>${head}</p><p>Meeting #: 800011</p><p>Online</p>
  <p>Meeting details:</p><p>Spoken Language</p><p>:</p><p>English</p><p>Visitor Access</p><p>:</p><p>Closed</p><p>Specific Topic</p><p>:</p><p>Meditation</p>
  <p>Location &amp; access:</p><p>Online meeting access</p>${online}<p>Phone meeting access</p>`;
const oaGood = refresh.parseOaPage(oaPage('<span>Saturday 12:00 PM</span><span>Eastern Time</span><span>⁦Meets Once a week⁩</span>',
  '<p>Join the meeting (full link provided).</p><a href="https://zoom.us/j/98842499977?pwd=K0hs">Join meeting</a><p>Meeting ID:</p><p>988 4249 9977</p><p>Passcode:</p><p>1212</p>'));
check('a good OA page is kept', refresh.oaProblem(oaGood), null);
const oaM = refresh.oaMeeting(oaGood, { id: 15706, link: 'https://oa.org/meetings/800011/', modified: '2026-08-13T13:11:20', class_list: ['specific_focus-women'] });
check('OA day, time and zone', (({ days, start, zone }) => ({ days, start, zone }))(oaM), { days: [6], start: '12:00', zone: 'America/New_York' });
check('a nameless OA meeting is called by number and topic', oaM.name, 'OA meeting #800011 (Meditation)');
check('OA women focus is marked', oaM.who, 'women');
check('"Ask the meeting contact for login information" is left out',
  refresh.oaProblem(refresh.parseOaPage(oaPage('<span>Monday 7:00 AM</span><span>Pacific Time</span>', '<p>Ask the meeting contact for login information prior to the meeting.</p><a href="https://zoom.us/join">Join meeting</a>'))),
  'listing says to ask someone for the link or password');
check('an OA zone we cannot map exactly is left out',
  refresh.oaProblem(refresh.parseOaPage(oaPage('<span>Monday 7:00 AM</span><span>Greenwich Mean Time</span>', '<a href="https://zoom.us/j/98842499977?pwd=K">Join</a>'))),
  'time zone not mapped exactly (Greenwich Mean Time)');

group('reading SLAA listings');
const slaaCell = (schedule, name, pairs, updated = '2/2/2026') => `ResultSetListViewTableEvenCell"><script> var gi = 'Group'
  if (gi == 'Intergroup') { x.innerHTML = 'no'; } else if (gi == 'Group') { x.innerHTML = '<span>Last Updated: ${updated}<br>ID: 40041385</span><b style="font-size: 22px;">| ${name}</b><br /><span style="text-transform:uppercase; font-size: 20px; font-weight: 500;color:orange;">${schedule}</span>'; }</script>
  ${pairs.map(([k, v]) => `<span class="cbResultSetListViewDataLabel cbResultSetNestedAlign">${k}&nbsp;</span><span class="cbResultSetData cbResultSetNestedAlign">${v}</span><br />`).join('')}`;
const slaaPairs = [['&#8226;', 'Closed Meeting (Only those identifying with sex and love addiction may attend)'], ['Meeting Format', 'Men and Women Welcome (MW)'], ['Languages Spoken', 'English'],
  ['Email', '<a href="mailto:x@example.com">Send Email to This Group</a>'], ['Meeting Links', '<a href="https://us02web.zoom.us/j/89522611873?pwd=d2Vy">Visit Link</a>'],
  ['Online Meeting ID', '895 2261 1873'], ['Connection Instructions', 'Password = 101011&nbsp;']];
const sGood = refresh.parseSlaaCell(slaaCell('Every Day 9:00 PM ET', 'Daily 10th Step', slaaPairs));
check('a good SLAA listing is kept (the "Send Email" button is not "email for the link")', refresh.slaaProblem(sGood, now), null);
check('SLAA every day, time, zone, closed', (({ days, start, zone, access }) => ({ days, start, zone, access }))(refresh.slaaMeeting(sGood)),
  { days: [0, 1, 2, 3, 4, 5, 6], start: '21:00', zone: 'America/New_York', access: 'closed' });
check('SLAA "7PM EST" on two days', (({ days, start, zone }) => ({ days, start, zone }))(refresh.slaaMeeting(refresh.parseSlaaCell(slaaCell('Sunday, Thursday 7PM EST', 'Trailblazers', slaaPairs)))),
  { days: [0, 4], start: '19:00', zone: 'America/New_York' });
check('SLAA with no time zone is left out, never guessed', refresh.slaaProblem(refresh.parseSlaaCell(slaaCell('Tuesday 7:00 PM', 'X', slaaPairs)), now), 'time zone not mapped exactly (blank)');
check('SLAA name and schedule disagreeing is left out',
  refresh.slaaProblem(refresh.parseSlaaCell(slaaCell('Every Day 12:00 AM UTC', 'Sober Dating Workshop Noon Thursdays', slaaPairs)), now), 'name and schedule disagree');
check('SLAA "Password = 101011" with no pwd in the link', refresh.slaaMeeting(refresh.parseSlaaCell(slaaCell('Every Day 9:00 PM ET', 'X',
  slaaPairs.map(([k, v]) => (k === 'Meeting Links' ? [k, '<a href="https://example.org">Visit Link</a>'] : [k, v]))))).passcode, '101011');
check('SLAA "please email us for the password" is left out', refresh.slaaProblem(refresh.parseSlaaCell(slaaCell('Every Day 9:00 PM ET', 'X',
  [...slaaPairs.filter(([k]) => k !== 'Connection Instructions'), ['Connection Instructions', 'Please email sunrise@example.com for the meeting password.']])), now),
  'listing says to ask someone for the link or password');

group('reading the new directories');
check('a phone number is never taken for a Zoom id', refresh.zoomFrom('Call 412-924-7162 access 947757'), null);
check('"Zoom ID# 432860084" becomes a link', refresh.zoomFrom('ZOOM ONLY Zoom ID# 432860084 Password 135048').link, 'https://zoom.us/j/432860084');
check('dashes in an id', refresh.zoomFrom('ZOOM 854-5637-9820 access code 646293').meetingId, '85456379820');
check('the href wins over a copy broken up by markup',
  refresh.zoomFrom('<a href="https://us06web.zoom.us/j/81479436405?pwd=Q7vM.1">https://us06web.zoom.us/j/<u></u>8147<u></u>9436405?pwd=<u></u>Q7vM.1</a>').link,
  'https://us06web.zoom.us/j/81479436405?pwd=Q7vM.1');
check('a passcode after a colon', refresh.passcodeFrom('Zoom ID: 999 3559 8599 | Passcode: ACASydney |'), 'ACASydney');
check('a numeric passcode without a colon', refresh.passcodeFrom('Zoom ID# 432860084 Password 135048'), '135048');
check('"Passcode: Email us" is not a passcode', refresh.passcodeFrom('ID: 853 5353 0603 Passcode: Email aabossiercity@gmail.com'), null);
check('"the password for the meeting" is not a passcode', refresh.passcodeFrom('To get the password for the meeting, please write'), null);
check('a pwd= token inside a link is not something to type', refresh.passcodeFrom('https://zoom.us/j/81105177232?pwd=MYZHk9ggWM6ODKS5mdbL'), null);
check('trailing full stop is dropped', refresh.passcodeFrom('Passcode: 296471.'), '296471');
check('"Password-First164" is First164', refresh.passcodeFrom('Connection Instructions | Password-First164 |'), 'First164');
check('Al-Anon times', refresh.alAnonWhen('Tuesday 08:15 PM'), { day: 2, start: '20:15' });
check('Al-Anon around the clock is left out', refresh.alAnonProblem({ is_24_7: true, url: 'https://zoom.us/j/12345678901?pwd=a', languages: 'English', times: '', timezone: 'America/Chicago' }), 'runs around the clock, no fixed time');
const acaRow = {
  SID: '6193', MeetName: 'Men of ACA', LangValue: 'English', DayCode: '4', Time_Local: '11:30 am', Timezone: 'America/Los_Angeles',
  Location: '<p>ZOOM Id# 805 888 1234<br />Password: Healing</p>', virtualInfo: '', Notes: '', other_notes: '', OpenClosed: 'O', Type: 'Men-Only, ', LastUpdate: '2026-10-19 00:00:00',
};
check('a good ACA listing is kept', refresh.acaProblem(acaRow, now), null);
check('ACA day code 4 is Wednesday', refresh.acaMeeting(acaRow).days, [3]);
check('ACA id is unique per day and time', refresh.acaMeeting(acaRow).id, 'aca-6193-3-1130');
check('ACA escaped quotes in a name are undone', refresh.acaMeeting({ ...acaRow, MeetName: "Tony A\\'s Steps U.S." }).name, "Tony A's Steps U.S.");
check('ACA time and zone', [refresh.acaMeeting(acaRow).start, refresh.acaMeeting(acaRow).zone], ['11:30', 'America/Los_Angeles']);
check('ACA men-only is marked', refresh.acaMeeting(acaRow).who, 'men');
check('ACA "Women Only", no hyphen, is marked too', refresh.acaMeeting({ ...acaRow, Type: 'Women Only, LGBTQ+, ' }).who, 'women');
check('an ACA teen meeting is left out', refresh.acaProblem({ ...acaRow, Type: 'ACA Teen (Ages 12 to 18), ' }, now), 'teen meeting');
check('ACA link and passcode from typed text', [refresh.acaMeeting(acaRow).link, refresh.acaMeeting(acaRow).passcode], ['https://zoom.us/j/8058881234', 'Healing']);
check('ACA "email for the password" is left out',
  refresh.acaProblem({ ...acaRow, Location: '<p>Meeting ID: 860 0737 0131</p><p>Please email acapathwaytohope@gmail.com for the password.</p>' }, now) !== null, true);

const ics = (extra, rule = 'FREQ=WEEKLY;BYDAY=TU,TH', desc = 'Join Zoom Meeting <a href="https://www.google.com/url?q=https://us06web.zoom.us/j/81105177232%3Fpwd%3DMYZ.1&amp;sa=D">link</a>') => [
  'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;TZID=America/New_York:20250107T193000', 'DTEND;TZID=America/New_York:20250107T203000',
  `RRULE:${rule}`, 'UID:abc123@google.com', 'SUMMARY:Neurodiversity and UA', `DESCRIPTION:${desc}`, 'LAST-MODIFIED:20260310T120000Z', 'STATUS:CONFIRMED', ...extra, 'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');
const [uaGood] = refresh.parseIcs(ics([]));
check('a weekly UA calendar meeting is kept', refresh.uaProblem(uaGood, now), null);
check('its days, time and zone', (({ days, start, zone }) => ({ days, start, zone }))(refresh.uaMeeting(uaGood)), { days: [2, 4], start: '19:30', zone: 'America/New_York' });
check('the Google redirect is unwrapped to the real link', refresh.uaMeeting(uaGood).link, 'https://us06web.zoom.us/j/81105177232?pwd=MYZ.1');
check('a series that has ended is left out', refresh.uaProblem(refresh.parseIcs(ics([], 'FREQ=WEEKLY;UNTIL=20260122T045959Z;BYDAY=TU'))[0], now), 'series has ended');
check('every other week is left out', refresh.uaProblem(refresh.parseIcs(ics([], 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU'))[0], now), 'not weekly');
check('a group that shifts with daylight saving is left out',
  refresh.uaProblem(refresh.parseIcs(ics([], undefined, 'https://zoom.us/j/9267004753?pwd=Q (due to Daylight Savings Time)'))[0], now), 'listing says its time moves with daylight saving');
check('a Farsi-speaking group is left out',
  refresh.uaProblem(refresh.parseIcs(ics([]).replace('SUMMARY:Neurodiversity and UA', 'SUMMARY:Mohajeran UA (Farsi speaking)'))[0], now), 'not in English');

group('Bilal\'s QA, 22 Oct: Pakistan, just after midnight there');
const SAT_UA = {
  id: 'ua-2', program: 'UA', name: 'Saturday-LGBTQ2SIA+ UA Rainbow Recovery', days: [6], start: '10:30', zone: 'America/New_York',
  link: 'https://us02web.zoom.us/j/85752382310', passcode: 'Being', access: null, who: null,
  source: 'https://underearnersanonymous.org/meetings-underearners-anonymous/',
};
const AA_2222 = {
  id: 'aa-2', program: 'AA', name: '22:22 Presents: The Wheel of Surrender  - Daily 9:00 PM PST', days: [4], start: '21:00', zone: 'America/Los_Angeles',
  link: 'https://us06web.zoom.us/j/88007279944?pwd=B.1', passcode: null, access: 'open', who: null,
  source: 'https://aa-intergroup.org/meetings/2222-presents-the-wheel-of-surrender-4',
};
const DA_3141 = {
  id: 'da-3141', program: 'DA', name: 'Together We Prosper', days: [4], start: '12:00', zone: 'America/New_York',
  link: 'https://zoom.us/j/81990424358', meetingId: '81990424358', passcode: '382437', access: 'open',
  source: 'https://www.debtorsanonymous.org/meeting-search-detail/?mid=3141',
};
meetings._setData({ generatedAt: '2026-10-22T07:58:00Z', meetings: [SAT_UA, AA_2222, DA_3141] });
const pkMidnight = at('2026-10-22T19:07:44Z'); // Friday 12:07am in Pakistan, still Thursday in UTC
const uaPk = meetings.buildMeetingsBlock({ message: 'Can you find me an online ua meeting tomorrow after 7 PM Pakistan time?', programField: '', userZone: 'Asia/Karachi', now: pkMidnight });
check('it is told it is already Friday where they are', uaPk.includes('it is now Friday 23 October, 12:07am'), true);
check('the Saturday meeting says Saturday 24 October, not just "tomorrow"',
  uaPk.includes('- tomorrow, Saturday 24 October, at 7:30pm | "Saturday-LGBTQ2SIA+ UA Rainbow Recovery" | listed as Saturday 10:30am America/New_York time'), true);
const aaPk = meetings.buildMeetingsBlock({ message: 'Can you find an online AA meeting today after 7 PM Pakistan time?', programField: '', userZone: 'Asia/Karachi', now: at('2026-10-22T19:11:48Z') });
check('9pm Pacific is 9am in Pakistan, and the "9:00 PM PST" in its name is gone',
  aaPk.includes('- today, Friday 23 October, at 9am | "22:22 Presents: The Wheel of Surrender" | listed as Thursday 9pm America/Los_Angeles time'), true);
check('it is told a time in a name is never their time', aaPk.includes('never its time for them'), true);
const daPk = meetings.buildMeetingsBlock({ message: 'Can you find me an online DA meeting today after 7 PM Pakistan time?', programField: '', userZone: 'Asia/Karachi', now: at('2026-10-22T14:26:57Z') });
check('each meeting carries its own official listing, to show when asked',
  daPk.includes('| passcode 382437 | source https://www.debtorsanonymous.org/meeting-search-detail/?mid=3141'), true);
check('questioned, it stands by the list instead of taking it back', daPk.includes('If they question a meeting, do not take it back'), true);
check('schedule tags at the end of a name go, the rest of the name stays', [
  meetings.cleanName('UA Prosper Team - 30 mins (4.30pm UK)'),
  meetings.cleanName("'Women's Fellowship Corner' Monday 05:30 PM PST"),
  meetings.cleanName('SLAA Step 11 Group Meditation Daily 7:05 AM Eastern Time'),
  meetings.cleanName("Sisters in Sobriety Texas - 8 PM Women's Closed Meeting Of Alcoholics Anonymous"),
  meetings.cleanName('6am Sunrisers Meeting'),
], ['UA Prosper Team - 30 mins', "'Women's Fellowship Corner'", 'SLAA Step 11 Group Meditation', "Sisters in Sobriety Texas - 8 PM Women's Closed Meeting Of Alcoholics Anonymous", '6am Sunrisers Meeting']);
const askedAgain = meetings.buildMeetingsBlock({
  message: 'I couldn\'t find the Zoom details through that page. Can you provide the official source for meeting ID 81990424358 and passcode 382437?',
  programField: '', userZone: 'Asia/Karachi', now: at('2026-10-22T16:22:36Z'),
  recentMessages: 'Please share the official listing\nHere it is: https://www.debtorsanonymous.org/meeting-search-detail/?mid=3141',
  lastUserMessage: 'Please share the official listing for "Together We Prosper"',
});
check('asked about a meeting it gave, after it started and with no program named: it still has it, with its source',
  [/ask what program/.test(askedAgain), askedAgain.includes('- started 23 minutes ago (Thursday 22 October, 9pm) | "Together We Prosper"'), askedAgain.includes('source https://www.debtorsanonymous.org/meeting-search-detail/?mid=3141')],
  [false, true, true]);
check('a meeting ID typed with spaces is still found', meetings.alreadyGiven('is 819 9042 4358 right?', { meetings: [DA_3141] }).length, 1);
check('weekdays named in a message', [meetings.weekdaysIn('what about Saturday?'), meetings.weekdaysIn('any weds or thurs ones'), meetings.weekdaysIn('the sun sat on the mat')], [[6], [3, 4], []]);

group('fast enough with thousands of meetings');
const many = Array.from({ length: 3000 }, (_, i) => ({
  ...AA_WOMEN, id: `aa-${i}`, who: null, days: [i % 7], start: `${String(i % 24).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
  zone: ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Australia/Sydney'][i % 4],
}));
meetings._setData({ generatedAt: '2026-10-20T08:00:00Z', meetings: many });
const t0 = Date.now();
const big = meetings.buildMeetingsBlock({ message: 'AA meeting tonight?', programField: 'AA', userZone: 'Europe/London', now: tueNoonUtc });
const took = Date.now() - t0;
console.log(`      (3,000 meetings: ${took} ms)`);
check('3,000 meetings in under half a second', took < 500, true);
const minutesOf = (x) => { const [h, mi] = x[1].split(':').map(Number); return (h % 12 + (x[2] === 'pm' ? 12 : 0)) * 60 + (mi || 0); };
const todays = [...big.matchAll(/^- today, [A-Za-z]+ \d+ [A-Za-z]+, at ([0-9:]+)(am|pm) \|/gm)].map(minutesOf);
const tomorrows = [...big.matchAll(/^- tomorrow, [A-Za-z]+ \d+ [A-Za-z]+, at ([0-9:]+)(am|pm) \|/gm)].map(minutesOf);
check('two days, at most four a day', [(big.match(/^- [^|\n]+ \| "/gm) || []).length <= 8, tomorrows.length], [true, 4]);
check('today\'s choices are spread out, not all starting now',
  todays.length >= 2 && todays.every((t, i) => i === 0 || t - todays[i - 1] >= 120), true);
check('a whole day has a morning, midday, afternoon and evening meeting (22 Oct: none after 7pm)',
  [tomorrows.some((t) => t < 11 * 60), tomorrows.some((t) => t >= 11 * 60 && t < 15 * 60), tomorrows.some((t) => t >= 15 * 60 && t < 19 * 60), tomorrows.some((t) => t >= 19 * 60)], [true, true, true, true]);
const satAsked = meetings.buildMeetingsBlock({ message: 'any AA meetings on Saturday?', programField: 'AA', userZone: 'Europe/London', now: tueNoonUtc });
check('a weekday they name is added to the list', /^- Saturday 24 October at /m.test(satAsked), true);
check('and not when they name none', /^- Saturday 24 October at /m.test(big), false);

group('the real list, as written');
const real = JSON.parse(require('fs').readFileSync(path.resolve(__dirname, 'meetings-data.json'), 'utf8'));
const ids = new Set(real.meetings.map((m) => m.id));
check('every meeting id is unique', ids.size, real.meetings.length);
check('every meeting has a direct Zoom link',
  real.meetings.filter((m) => !/^https:\/\/([a-z0-9]+\.)?zoom\.us\/j\/\d{9,11}(\?pwd=[A-Za-z0-9._-]+)?$/.test(m.link)).length, 0);
check('every meeting can be opened: pwd in the link or a passcode',
  real.meetings.filter((m) => !/pwd=/.test(m.link) && !m.passcode).length, 0);
const realZone = (z) => { try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; } };
check('every meeting has a day, time and real zone',
  real.meetings.filter((m) => !m.days.length || m.days.some((d) => d < 0 || d > 6) || !/^\d{2}:\d{2}$/.test(m.start) || !realZone(m.zone)).length, 0);
check('no teen meetings', real.meetings.filter((m) => /\bteens?\b|alateen/i.test(m.name)).length, 0);
check('no backslashes or markup left in names', real.meetings.filter((m) => /[\\<>]|&amp;|&quot;|&#\d/.test(m.name)).length, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
