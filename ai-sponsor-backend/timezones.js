/* ─── Working out what time it is for somebody ───────────────────────────────
   Matt: "they should all get it Sundays ... between 9 am - 12 pm their local
   time". Every message this product sends today goes out at one instant, which
   reads as 8am in California and 5pm in South Africa. To land inside somebody's
   own morning we have to know where they are, and we never asked them.

   What we do have is the phone number they message us from. The country code
   gives the country, and for +1 the area code gives the state or province.
   That is a derivation rather than something they told us, so it is wrong for
   a person travelling or carrying a foreign SIM. It is right for almost
   everybody else, and the alternative is asking 27 people in recovery to fill
   in a timezone field.

   IANA names rather than fixed offsets on purpose: the offsets move twice a
   year, and a stored "-7" would silently send an hour early every November.
   Node resolves the name against real DST rules at send time.

   Anything we cannot place returns null, and the caller decides. Guessing a
   zone would produce a confident 6am message, which is worse on this product
   than not sending yet.                                                      */

// Unambiguous single-zone countries we actually see, plus the obvious neighbours.
const BY_COUNTRY = {
  44: 'Europe/London',        48: 'Europe/Warsaw',       27: 'Africa/Johannesburg',
  353: 'Europe/Dublin',       33: 'Europe/Paris',        49: 'Europe/Berlin',
  31: 'Europe/Amsterdam',     34: 'Europe/Madrid',       39: 'Europe/Rome',
  46: 'Europe/Stockholm',     47: 'Europe/Oslo',         45: 'Europe/Copenhagen',
  351: 'Europe/Lisbon',       30: 'Europe/Athens',       40: 'Europe/Bucharest',
  353: 'Europe/Dublin',       420: 'Europe/Prague',      36: 'Europe/Budapest',
  972: 'Asia/Jerusalem',      971: 'Asia/Dubai',         91: 'Asia/Kolkata',
  63: 'Asia/Manila',          65: 'Asia/Singapore',      81: 'Asia/Tokyo',
  82: 'Asia/Seoul',           64: 'Pacific/Auckland',    52: 'America/Mexico_City',
  55: 'America/Sao_Paulo',    54: 'America/Argentina/Buenos_Aires',
  56: 'America/Santiago',     57: 'America/Bogota',      51: 'America/Lima',
  234: 'Africa/Lagos',        254: 'Africa/Nairobi',     20: 'Africa/Cairo',
  353: 'Europe/Dublin',       353: 'Europe/Dublin',
};

/* Multi-zone countries need more than the country code. Australia is the one
   that matters most here: it is the case that breaks a single global send,
   because 15:00 UTC is 1am the NEXT DAY in Sydney. */
const AU_BY_AREA = {
  2: 'Australia/Sydney', 3: 'Australia/Melbourne',
  7: 'Australia/Brisbane', 8: 'Australia/Perth',
};

/* North American area codes. Not exhaustive, and deliberately so: the ones
   below cover the places our people actually are plus the large metros. An
   unknown +1 falls back to Central, which is at most two hours out anywhere in
   the mainland US, so the worst case is a message at 7am or 2pm rather than
   the middle of the night. */
const NANP = {
  pacific: ['206','209','213','223','253','279','310','323','341','360','369','408','415','424','442',
            '458','503','510','530','541','559','562','564','604','619','626','628','650','657','661',
            '669','672','707','714','747','760','778','805','818','820','831','858','909','916','925',
            '949','951','971','986','236','250'],
  mountain: ['208','303','307','385','406','435','505','575','719','720','801','970','403','587','780','825','367'],
  arizona:  ['480','520','602','623','928'],          // no daylight saving
  central:  ['204','205','214','217','218','224','225','228','251','254','262','281','309','312','314',
             '316','318','319','320','325','331','334','337','346','361','364','402','405','409','414',
             '417','430','431','432','469','479','501','504','507','512','515','531','534','539','563',
             '573','580','601','605','608','612','615','618','620','629','630','636','641','651','660',
             '662','682','701','708','712','713','715','731','737','763','769','773','779','785','806',
             '812','815','816','817','830','832','847','870','872','901','903','913','915','918','920',
             '930','936','940','952','956','972','979','985'],
  eastern:  ['201','202','203','207','212','215','216','220','226','231','234','239','240','248','249',
             '267','272','276','289','301','302','304','305','313','315','321','326','330','332','336',
             '339','343','347','352','365','380','386','401','404','407','410','412','413','416','419',
             '423','434','437','440','443','445','470','475','478','484','502','508','513','516','517',
             '518','519','540','548','551','561','567','570','571','585','586','603','606','607','609',
             '610','613','614','616','617','631','646','647','667','678','681','689','703','704','705',
             '706','716','717','718','724','727','732','734','740','743','754','757','762','770','772',
             '774','781','786','802','803','804','807','810','813','814','828','838','843','845','848',
             '850','854','856','857','859','860','862','863','864','865','873','878','902','904','905',
             '908','910','912','914','917','919','929','937','941','947','954','959','973','978','980','984'],
};

const NANP_ZONE = {
  pacific: 'America/Los_Angeles', mountain: 'America/Denver',
  arizona: 'America/Phoenix',     central: 'America/Chicago',
  eastern: 'America/New_York',
};

const AREA_LOOKUP = (() => {
  const m = {};
  for (const [group, codes] of Object.entries(NANP)) {
    for (const c of codes) m[c] = NANP_ZONE[group];
  }
  return m;
})();

/* Give it whatever we hold: "+16614771953", "16614771953", "wa-+4479...".
   Returns an IANA zone, or null when we genuinely cannot tell. */
function zoneForPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 8) return null;

  if (digits.startsWith('1') && digits.length === 11) {
    return AREA_LOOKUP[digits.slice(1, 4)] || 'America/Chicago';
  }
  if (digits.startsWith('61')) {
    return AU_BY_AREA[digits[2]] || 'Australia/Sydney';
  }
  // Longest country code first, so 353 is not read as 35.
  for (const len of [3, 2, 1]) {
    const cc = parseInt(digits.slice(0, len), 10);
    if (BY_COUNTRY[cc]) return BY_COUNTRY[cc];
  }
  return null;
}

/* What hour is it where they are, right now? Uses real DST rules rather than a
   stored offset, so it stays correct across a clock change without anyone
   remembering to update anything. */
function localHour(zone, now = new Date()) {
  if (!zone) return null;
  try {
    const h = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, hour: 'numeric', hour12: false,
    }).format(now);
    const n = parseInt(h, 10);
    return Number.isFinite(n) ? n % 24 : null;
  } catch {
    return null;   // an unknown zone name must not take the sweep down
  }
}

// Which day of the week is it for them? 0 = Sunday, to match getUTCDay.
function localDay(zone, now = new Date()) {
  if (!zone) return null;
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(now);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(s);
  } catch {
    return null;
  }
}

module.exports = { zoneForPhone, localHour, localDay };
