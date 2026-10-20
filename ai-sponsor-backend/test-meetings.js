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
check('codes',                meetings.programsOf('DA, BDA, UA, ACA, WA, Al-Anon'), ['DA', 'BDA', 'WA']);
check('long names',           meetings.programsOf('Debtors Anonymous, Workaholics Anonymous'), ['DA', 'WA']);
check('nothing we hold',      meetings.programsOf('AA, NA, Al-Anon'), []);
check('UA is not DA',         meetings.programsOf('UA'), []);

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
  meetings.describeWhen(next, 'Europe/London', tueNoonUtc), 'tomorrow at 12:30am');
check('a New Yorker hears it as tonight',
  meetings.describeWhen(next, 'America/New_York', tueNoonUtc), 'today at 7:30pm');
check('the gap week: London hears 11:30pm once the UK has changed',
  meetings.describeWhen(meetings.nextStart(NY_TUESDAY, at('2026-10-27T12:00:00Z')), 'Europe/London', at('2026-10-27T12:00:00Z')),
  'today at 11:30pm');
check('just started still counts',
  meetings.nextStart(NY_TUESDAY, at('2026-10-20T23:35:00Z')), at('2026-10-20T23:30:00Z'));
check('long started moves to next week',
  meetings.nextStart(NY_TUESDAY, at('2026-10-20T23:45:00Z')), at('2026-10-27T23:30:00Z'));

group('the block the sponsor sees');
meetings._setData(fresh('2026-10-20T08:00:00Z'));
const block = meetings.buildMeetingsBlock({
  message: 'can you find me a meeting', programField: 'DA, BDA, UA', userZone: 'Europe/London', now: tueNoonUtc,
});
check('a meeting at 12:30am their time is not offered', block.includes('Tuesday Visions'), false);
const nyBlock = meetings.buildMeetingsBlock({
  message: 'can you find me a meeting', programField: 'DA', userZone: 'America/New_York', now: tueNoonUtc,
});
check('a New Yorker gets it tonight, exact link and passcode',
  nyBlock.includes('"Tuesday Visions", today at 7:30pm, closed, https://us02web.zoom.us/j/12345678901, passcode 512788'), true);
check('has the BDA meeting, next Monday',
  block.includes('"Prosperity and Serenity", Monday at 9:15am, open, https://zoom.us/j/952138930?pwd=abc'), true);
check('no WA meetings for someone not in WA', block.includes('Underscheduling'), false);
check('says when it was checked', block.includes('checked on 20 October'), true);
check('tells it never to invent', block.includes('never offer one that is not on this list'), true);

check('nothing when they are not asking',
  meetings.buildMeetingsBlock({ message: 'I feel low today', programField: 'DA', userZone: 'Europe/London', now: tueNoonUtc }), '');
check('nothing for programs we hold no data for',
  meetings.buildMeetingsBlock({ message: 'any meetings?', programField: 'AA, NA', userZone: 'Europe/London', now: tueNoonUtc }), '');

const daily = meetings.buildMeetingsBlock({ message: 'meetings this week?', programField: 'WA', userZone: 'Europe/London', now: tueNoonUtc });
check('a daily meeting is listed once, at its next time',
  (daily.match(/"Underscheduling"/g) || []).length, 1);
check('and that is today', daily.includes('"Underscheduling", today at 6pm'), true);

const unplaced = meetings.buildMeetingsBlock({ message: 'meeting?', programField: 'WA', userZone: null, now: tueNoonUtc });
check('no zone: time stays in the meeting\'s own zone, labelled',
  unplaced.includes('today at 6pm (Europe/London time)'), true);

group('a list nobody refreshed is never shown');
meetings._setData(fresh('2026-09-01T08:00:00Z'));
const stale = meetings.buildMeetingsBlock({ message: 'a meeting please', programField: 'DA', userZone: 'Europe/London', now: tueNoonUtc });
check('stale list: no meeting names', stale.includes('Tuesday Visions'), false);
check('stale list: points at the official finder', stale.includes('https://debtorsanonymous.org/meeting-info/'), true);
meetings._setData({ generatedAt: 'nonsense', meetings: [NY_TUESDAY] });
check('unreadable date counts as stale',
  meetings.buildMeetingsBlock({ message: 'meeting', programField: 'DA', userZone: null, now: tueNoonUtc }).includes('Tuesday Visions'), false);

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
