/* ─── Where a phone number is from ───────────────────────────────────────────
   One table, three jobs: what to call the place, what time it is there, and how
   many digits a number should have. They used to live in two files that knew
   different sets of countries, and somebody fell down the gap between them.

   Bilal registered on a +92 Pakistan number on 4 Sep. phonerules.js knew
   Pakistan well enough to validate his number, timezones.js did not know it at
   all, so the Sunday weekly review could not work out when 9am was for him and
   held him back. Held, not delayed: he would never have received one, and the
   sweep only counted how many it skipped rather than naming them. One table
   means that particular gap cannot reopen.

   ── What is asserted, and what is not ─────────────────────────────────────
   name and zone are stable facts and are given for every country here.

   lengths is null wherever nobody has checked. Null means "do not enforce",
   and the caller falls back to the plain E.164 bound. Blocking somebody with a
   perfectly good number because we guessed at their country is worse than
   letting an odd one through, and they would never report it. Fill a null in
   when somebody has actually verified it, not to make the table look finished.
──────────────────────────────────────────────────────────────────────────── */

/* code: [name, IANA zone, national-number lengths or null]
   Lengths exclude the country code and any trunk zero. */
const COUNTRIES = {
  7:   ['Russia', 'Europe/Moscow', [10]],
  20:  ['Egypt', 'Africa/Cairo', [10]],
  27:  ['South Africa', 'Africa/Johannesburg', [9]],
  30:  ['Greece', 'Europe/Athens', [10]],
  31:  ['Netherlands', 'Europe/Amsterdam', [9]],
  32:  ['Belgium', 'Europe/Brussels', [8, 9]],
  33:  ['France', 'Europe/Paris', [9]],
  34:  ['Spain', 'Europe/Madrid', [9]],
  36:  ['Hungary', 'Europe/Budapest', [8, 9]],
  39:  ['Italy', 'Europe/Rome', [6, 7, 8, 9, 10, 11]],
  40:  ['Romania', 'Europe/Bucharest', [9]],
  41:  ['Switzerland', 'Europe/Zurich', [9]],
  43:  ['Austria', 'Europe/Vienna', null],
  44:  ['United Kingdom', 'Europe/London', [9, 10]],
  45:  ['Denmark', 'Europe/Copenhagen', [8]],
  46:  ['Sweden', 'Europe/Stockholm', [7, 8, 9]],
  47:  ['Norway', 'Europe/Oslo', [8]],
  48:  ['Poland', 'Europe/Warsaw', [9]],
  49:  ['Germany', 'Europe/Berlin', [6, 7, 8, 9, 10, 11]],
  51:  ['Peru', 'America/Lima', [9]],
  52:  ['Mexico', 'America/Mexico_City', [10]],
  53:  ['Cuba', 'America/Havana', null],
  54:  ['Argentina', 'America/Argentina/Buenos_Aires', [10]],
  55:  ['Brazil', 'America/Sao_Paulo', [10, 11]],
  56:  ['Chile', 'America/Santiago', [9]],
  57:  ['Colombia', 'America/Bogota', [10]],
  58:  ['Venezuela', 'America/Caracas', [10]],
  60:  ['Malaysia', 'Asia/Kuala_Lumpur', [9, 10]],
  62:  ['Indonesia', 'Asia/Jakarta', [9, 10, 11, 12]],
  63:  ['Philippines', 'Asia/Manila', [10]],
  64:  ['New Zealand', 'Pacific/Auckland', [8, 9]],
  65:  ['Singapore', 'Asia/Singapore', [8]],
  66:  ['Thailand', 'Asia/Bangkok', [9]],
  81:  ['Japan', 'Asia/Tokyo', [10]],
  82:  ['South Korea', 'Asia/Seoul', [9, 10]],
  84:  ['Vietnam', 'Asia/Ho_Chi_Minh', [9]],
  86:  ['China', 'Asia/Shanghai', [11]],
  90:  ['Turkey', 'Europe/Istanbul', [10]],
  91:  ['India', 'Asia/Kolkata', [10]],
  92:  ['Pakistan', 'Asia/Karachi', [10]],
  93:  ['Afghanistan', 'Asia/Kabul', null],
  94:  ['Sri Lanka', 'Asia/Colombo', [9]],
  95:  ['Myanmar', 'Asia/Yangon', null],
  98:  ['Iran', 'Asia/Tehran', [10]],
  212: ['Morocco', 'Africa/Casablanca', [9]],
  213: ['Algeria', 'Africa/Algiers', [9]],
  216: ['Tunisia', 'Africa/Tunis', [8]],
  218: ['Libya', 'Africa/Tripoli', null],
  220: ['Gambia', 'Africa/Banjul', null],
  221: ['Senegal', 'Africa/Dakar', [9]],
  233: ['Ghana', 'Africa/Accra', [9]],
  234: ['Nigeria', 'Africa/Lagos', [10]],
  237: ['Cameroon', 'Africa/Douala', null],
  243: ['DR Congo', 'Africa/Kinshasa', null],
  244: ['Angola', 'Africa/Luanda', null],
  250: ['Rwanda', 'Africa/Kigali', [9]],
  251: ['Ethiopia', 'Africa/Addis_Ababa', [9]],
  254: ['Kenya', 'Africa/Nairobi', [9]],
  255: ['Tanzania', 'Africa/Dar_es_Salaam', [9]],
  256: ['Uganda', 'Africa/Kampala', [9]],
  260: ['Zambia', 'Africa/Lusaka', [9]],
  263: ['Zimbabwe', 'Africa/Harare', null],
  351: ['Portugal', 'Europe/Lisbon', [9]],
  352: ['Luxembourg', 'Europe/Luxembourg', null],
  353: ['Ireland', 'Europe/Dublin', [7, 8, 9]],
  354: ['Iceland', 'Atlantic/Reykjavik', [7]],
  355: ['Albania', 'Europe/Tirane', null],
  356: ['Malta', 'Europe/Malta', [8]],
  357: ['Cyprus', 'Asia/Nicosia', [8]],
  358: ['Finland', 'Europe/Helsinki', null],
  359: ['Bulgaria', 'Europe/Sofia', [8, 9]],
  370: ['Lithuania', 'Europe/Vilnius', [8]],
  371: ['Latvia', 'Europe/Riga', [8]],
  372: ['Estonia', 'Europe/Tallinn', [7, 8]],
  373: ['Moldova', 'Europe/Chisinau', [8]],
  374: ['Armenia', 'Asia/Yerevan', [8]],
  375: ['Belarus', 'Europe/Minsk', [9]],
  380: ['Ukraine', 'Europe/Kyiv', [9]],
  381: ['Serbia', 'Europe/Belgrade', [8, 9]],
  385: ['Croatia', 'Europe/Zagreb', [8, 9]],
  386: ['Slovenia', 'Europe/Ljubljana', [8]],
  387: ['Bosnia and Herzegovina', 'Europe/Sarajevo', [8]],
  389: ['North Macedonia', 'Europe/Skopje', [8]],
  420: ['Czechia', 'Europe/Prague', [9]],
  421: ['Slovakia', 'Europe/Bratislava', [9]],
  423: ['Liechtenstein', 'Europe/Vaduz', null],
  501: ['Belize', 'America/Belize', null],
  502: ['Guatemala', 'America/Guatemala', [8]],
  503: ['El Salvador', 'America/El_Salvador', [8]],
  504: ['Honduras', 'America/Tegucigalpa', [8]],
  505: ['Nicaragua', 'America/Managua', [8]],
  506: ['Costa Rica', 'America/Costa_Rica', [8]],
  507: ['Panama', 'America/Panama', null],
  509: ['Haiti', 'America/Port-au-Prince', [8]],
  591: ['Bolivia', 'America/La_Paz', [8]],
  593: ['Ecuador', 'America/Guayaquil', [9]],
  595: ['Paraguay', 'America/Asuncion', [9]],
  598: ['Uruguay', 'America/Montevideo', [8]],
  880: ['Bangladesh', 'Asia/Dhaka', [10]],
  960: ['Maldives', 'Indian/Maldives', null],
  961: ['Lebanon', 'Asia/Beirut', null],
  962: ['Jordan', 'Asia/Amman', [9]],
  963: ['Syria', 'Asia/Damascus', null],
  964: ['Iraq', 'Asia/Baghdad', [10]],
  965: ['Kuwait', 'Asia/Kuwait', [8]],
  966: ['Saudi Arabia', 'Asia/Riyadh', [9]],
  967: ['Yemen', 'Asia/Aden', null],
  968: ['Oman', 'Asia/Muscat', [8]],
  971: ['United Arab Emirates', 'Asia/Dubai', [9]],
  972: ['Israel', 'Asia/Jerusalem', [9]],
  973: ['Bahrain', 'Asia/Bahrain', [8]],
  974: ['Qatar', 'Asia/Qatar', [8]],
  975: ['Bhutan', 'Asia/Thimphu', null],
  976: ['Mongolia', 'Asia/Ulaanbaatar', [8]],
  977: ['Nepal', 'Asia/Kathmandu', [10]],
  992: ['Tajikistan', 'Asia/Dushanbe', [9]],
  993: ['Turkmenistan', 'Asia/Ashgabat', null],
  994: ['Azerbaijan', 'Asia/Baku', [9]],
  995: ['Georgia', 'Asia/Tbilisi', [9]],
  996: ['Kyrgyzstan', 'Asia/Bishkek', [9]],
  998: ['Uzbekistan', 'Asia/Tashkent', [9]],
};

/* Australia's country code is not enough: 15:00 UTC is Monday in Perth and
   Tuesday in Sydney. The digit after +61 is the area. */
const AU_AREAS = {
  2: ['Australia', 'Australia/Sydney'],
  3: ['Australia', 'Australia/Melbourne'],
  7: ['Australia', 'Australia/Brisbane'],
  8: ['Australia', 'Australia/Perth'],
};

/* ── North America ──────────────────────────────────────────────────────────
   +1 covers the US, Canada and about twenty Caribbean nations, so the area code
   is the only thing that says which. Matt asked for the US state specifically
   ("state in the USA also based on their phone number"), and that is the same
   lookup, so it is one table.

   An area code is where the number was ISSUED, not where somebody is standing.
   People keep their number when they move, so this is a good signal about a
   population and a bad one about an individual. Anything reading it should say
   "numbers from" rather than "people in". */
const NANP_AREAS = {
  // United States, by state
  'Alabama': ['205', '251', '256', '334', '659', '938'],
  'Alaska': ['907'],
  'Arizona': ['480', '520', '602', '623', '928'],
  'Arkansas': ['479', '501', '870'],
  'California': ['209', '213', '279', '310', '323', '341', '350', '408', '415', '424', '442', '510',
    '530', '559', '562', '619', '626', '628', '650', '657', '661', '669', '707', '714', '747', '760',
    '805', '818', '820', '831', '840', '858', '909', '916', '925', '949', '951'],
  'Colorado': ['303', '719', '720', '970', '983'],
  'Connecticut': ['203', '475', '860', '959'],
  'Delaware': ['302'],
  'District of Columbia': ['202'],
  'Florida': ['239', '305', '321', '324', '352', '386', '407', '448', '561', '656', '689', '727',
    '754', '772', '786', '813', '850', '863', '904', '941', '954'],
  'Georgia': ['229', '404', '470', '478', '678', '706', '762', '770', '912', '943'],
  'Hawaii': ['808'],
  'Idaho': ['208', '986'],
  'Illinois': ['217', '224', '309', '312', '331', '447', '464', '618', '630', '708', '730', '773',
    '779', '815', '847', '872'],
  'Indiana': ['219', '260', '317', '463', '574', '765', '812', '930'],
  'Iowa': ['319', '515', '563', '641', '712'],
  'Kansas': ['316', '620', '785', '913'],
  'Kentucky': ['270', '364', '502', '606', '859'],
  'Louisiana': ['225', '318', '337', '504', '985'],
  'Maine': ['207'],
  'Maryland': ['227', '240', '301', '410', '443', '667'],
  'Massachusetts': ['339', '351', '413', '508', '617', '774', '781', '857', '978'],
  'Michigan': ['231', '248', '269', '313', '517', '586', '616', '679', '734', '810', '906', '947', '989'],
  'Minnesota': ['218', '320', '507', '612', '651', '763', '952'],
  'Mississippi': ['228', '601', '662', '769'],
  'Missouri': ['235', '314', '417', '557', '573', '636', '660', '816'],
  'Montana': ['406'],
  'Nebraska': ['308', '402', '531'],
  'Nevada': ['702', '725', '775'],
  'New Hampshire': ['603'],
  'New Jersey': ['201', '551', '609', '640', '732', '848', '856', '862', '908', '973'],
  'New Mexico': ['505', '575'],
  'New York': ['212', '315', '329', '332', '347', '363', '516', '518', '585', '607', '631', '646',
    '680', '716', '718', '838', '845', '914', '917', '929', '934'],
  'North Carolina': ['252', '336', '472', '704', '743', '828', '910', '919', '980', '984'],
  'North Dakota': ['701'],
  'Ohio': ['216', '220', '234', '283', '326', '330', '380', '419', '436', '440', '513', '567', '614', '740', '937'],
  'Oklahoma': ['405', '539', '572', '580', '918'],
  'Oregon': ['458', '503', '541', '971'],
  'Pennsylvania': ['215', '223', '267', '272', '412', '445', '484', '570', '582', '610', '717', '724', '814', '835', '878'],
  'Rhode Island': ['401'],
  'South Carolina': ['803', '821', '839', '843', '854', '864'],
  'South Dakota': ['605'],
  'Tennessee': ['423', '615', '629', '731', '865', '901', '931'],
  'Texas': ['210', '214', '254', '281', '325', '346', '361', '409', '430', '432', '469', '512',
    '682', '713', '726', '737', '806', '817', '830', '832', '903', '915', '936', '940', '945', '956', '972', '979'],
  'Utah': ['385', '435', '801'],
  'Vermont': ['802'],
  'Virginia': ['276', '434', '540', '571', '703', '757', '804', '826', '948'],
  'Washington': ['206', '253', '360', '425', '509', '564'],
  'West Virginia': ['304', '681'],
  'Wisconsin': ['262', '274', '414', '534', '608', '715', '920'],
  'Wyoming': ['307'],
};

/* Canada spans six zones, so the country code cannot answer "what time is it
   there" any more than it can for the US. Caught by Jen on +1 403: an earlier
   version of this file returned Canada with no zone at all, which would have
   dropped her from the Sunday weekly review silently, which is the exact bug
   this file exists to close. */
const CANADA_ZONES = {
  'America/Vancouver': ['236', '250', '604', '672', '778'],
  'America/Edmonton':  ['368', '403', '587', '780', '825'],
  'America/Regina':    ['306', '474', '639'],
  'America/Winnipeg':  ['204', '431', '584'],
  'America/Toronto':   ['226', '249', '289', '343', '354', '365', '367', '382', '416', '418',
                        '437', '438', '450', '468', '514', '519', '548', '579', '581', '613',
                        '647', '683', '705', '742', '753', '807', '819', '873', '905'],
  'America/Halifax':   ['506', '782', '902'],
  'America/St_Johns':  ['709'],
  'America/Whitehorse':['867'],
};
const CANADA_AREA_TO_ZONE = {};
for (const [zone, codes] of Object.entries(CANADA_ZONES)) {
  for (const c of codes) CANADA_AREA_TO_ZONE[c] = zone;
}

// Canada is a country here, not a state, so its provinces stay out of byState.
const CANADA_AREAS = ['204', '226', '236', '249', '250', '289', '306', '343', '354', '365', '367',
  '368', '382', '403', '416', '418', '431', '437', '438', '450', '468', '474', '506', '514', '519',
  '548', '579', '581', '584', '587', '604', '613', '639', '647', '672', '683', '705', '709', '742',
  '753', '778', '780', '782', '807', '819', '825', '867', '873', '879', '902', '905'];

/* The Caribbean and Pacific +1 codes. Four-digit code, seven digits after. */
const NANP_ISLANDS = {
  '1242': ['Bahamas', 'America/Nassau'],        '1246': ['Barbados', 'America/Barbados'],
  '1264': ['Anguilla', 'America/Anguilla'],     '1268': ['Antigua and Barbuda', 'America/Antigua'],
  '1284': ['British Virgin Islands', 'America/Tortola'],
  '1340': ['US Virgin Islands', 'America/St_Thomas'],
  '1345': ['Cayman Islands', 'America/Cayman'], '1441': ['Bermuda', 'Atlantic/Bermuda'],
  '1473': ['Grenada', 'America/Grenada'],       '1649': ['Turks and Caicos', 'America/Grand_Turk'],
  '1664': ['Montserrat', 'America/Montserrat'], '1671': ['Guam', 'Pacific/Guam'],
  '1684': ['American Samoa', 'Pacific/Pago_Pago'],
  '1721': ['Sint Maarten', 'America/Lower_Princes'],
  '1758': ['Saint Lucia', 'America/St_Lucia'],  '1767': ['Dominica', 'America/Dominica'],
  '1784': ['Saint Vincent', 'America/St_Vincent'],
  '1787': ['Puerto Rico', 'America/Puerto_Rico'], '1809': ['Dominican Republic', 'America/Santo_Domingo'],
  '1868': ['Trinidad and Tobago', 'America/Port_of_Spain'],
  '1869': ['Saint Kitts and Nevis', 'America/St_Kitts'],
  '1876': ['Jamaica', 'America/Jamaica'],
};

// One US area code to one state and one zone, built once at load.
const AREA_TO_STATE = {};
for (const [state, codes] of Object.entries(NANP_AREAS)) {
  for (const c of codes) AREA_TO_STATE[c] = state;
}

// Which zone each US state sits in. Arizona is listed apart because it does not
// move its clocks, and a stored offset would be an hour out for half the year.
const STATE_ZONES = {
  pacific: ['California', 'Washington', 'Nevada', 'Oregon'],
  arizona: ['Arizona'],
  mountain: ['Colorado', 'Montana', 'New Mexico', 'Utah', 'Wyoming', 'Idaho'],
  central: ['Alabama', 'Arkansas', 'Illinois', 'Iowa', 'Kansas', 'Louisiana', 'Minnesota',
    'Mississippi', 'Missouri', 'Nebraska', 'North Dakota', 'Oklahoma', 'South Dakota',
    'Texas', 'Wisconsin', 'Tennessee'],
  alaska: ['Alaska'],
  hawaii: ['Hawaii'],
};
const ZONE_NAMES = {
  pacific: 'America/Los_Angeles', arizona: 'America/Phoenix', mountain: 'America/Denver',
  central: 'America/Chicago', alaska: 'America/Anchorage', hawaii: 'Pacific/Honolulu',
  eastern: 'America/New_York',
};
const STATE_TO_ZONE = {};
for (const [group, states] of Object.entries(STATE_ZONES)) {
  for (const st of states) STATE_TO_ZONE[st] = ZONE_NAMES[group];
}

const MIN_NATIONAL = 6;
const MAX_TOTAL = 15;

/* Everything anyone needs about a number, in one call.
   Returns { country, state, zone, cc, national, lengths } with nulls where we
   genuinely do not know, never a guess dressed as an answer. */
function place(rawPhone, ccHint) {
  const digits = String(rawPhone || '').replace(/\D/g, '').replace(/^00/, '');
  const out = { country: null, state: null, zone: null, cc: null, national: '', lengths: null };
  if (digits.length < 7) return out;

  // North America. The islands have four-digit codes, so try those first.
  if (digits.startsWith('1') && digits.length >= 11) {
    const four = digits.slice(0, 4);
    if (NANP_ISLANDS[four]) {
      const [name, zone] = NANP_ISLANDS[four];
      return { country: name, state: null, zone, cc: four, national: digits.slice(4), lengths: [7] };
    }
    const area = digits.slice(1, 4);
    const state = AREA_TO_STATE[area] || null;
    const canadian = CANADA_AREAS.includes(area);
    return {
      country: state ? 'United States' : canadian ? 'Canada' : null,
      state,
      // Unmapped US area codes fall to Central: two hours out at worst, which
      // is an early or late message rather than a middle-of-the-night one.
      zone: state ? (STATE_TO_ZONE[state] || ZONE_NAMES.eastern)
        : canadian ? (CANADA_AREA_TO_ZONE[area] || 'America/Toronto')
        : ZONE_NAMES.central,
      cc: '1', national: digits.slice(1), lengths: [10],
    };
  }

  if (digits.startsWith('61') && digits.length >= 10) {
    const a = AU_AREAS[digits[2]] || ['Australia', 'Australia/Sydney'];
    return { country: a[0], state: null, zone: a[1], cc: '61', national: digits.slice(2), lengths: [9] };
  }

  // Longest code first, so 353 is never read as 35 and then 3.
  for (const len of [3, 2, 1]) {
    const code = digits.slice(0, len);
    const entry = COUNTRIES[Number(code)];
    if (entry) {
      const [name, zone, lengths] = entry;
      return {
        country: name, state: null, zone, cc: code,
        national: digits.slice(len).replace(/^0/, ''), lengths: lengths || null,
      };
    }
  }
  return out;
}

module.exports = {
  place, COUNTRIES, NANP_ISLANDS, AREA_TO_STATE, STATE_TO_ZONE, CANADA_AREA_TO_ZONE,
  CANADA_AREAS, ZONE_NAMES, MIN_NATIONAL, MAX_TOTAL,
};
