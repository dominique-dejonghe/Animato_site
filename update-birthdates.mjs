// Parse birthdates and generate SQL for the Animato production database
// Handles: M/D/YY, M/D/YYYY, D/M/YYYY formats

const data = `elsje.bocken@gmail.com → 7/25/66
ritacassiman@hotmail.com → 6/6/55
an.colaes@skynet.be → 1/5/1966
annelies.colaes@outlook.be → 23/8/1969
dbckia@gmail.com → 12/19/22
hildedegroof@telenet.be → 6/29/1962
Bart.de_wilde@telenet.be → 4/4/64
dominique@pensato.org → 5/10/69
S.Delforge@telenet.be → 9/5/62
hansfrancois@msn.com → (no date)
coby.goederond@hotmail.com → 6/18/54
klaar@kinderpsycholoog.be → 4/20/72
kristelheyvaert@gmail.com → 5/3/70
betty.heyvaert@outlook.com → 8/4/65
lievehofmans34@gmail.com → 10/12/57
anja.holbrechts@gmail.com → 4/22/72
huyck.lieve@scarlet.be → 9/2/22
greet_janssens@hotmail.com → 1/6/62
htmkoster@gmail.com → 8/11/62
tatjana.kussener@telenet.be → 1/3/2003
roke80@hotmail.com → 5/10/89
patrick.vanasch68@gmail.com → 4/8/1970
carine.luca@telenet.be → 3/1/59
ingrid.macharis@telenet.be → 8/19/1961
mampaey.veerle@gmail.com → 6/1/1989
emma.massaer@gmail.com → 23/2/1999
Dany.Mathe.Polfliet@gmail.com → 6/24/58
mariekemeersman11@gmail.com → 1/30/96
ria_moens@hotmail.com → 4/20/58
fienphilips@live.be → 2/11/1999
dries.raes@gmail.com → 2/5/73
hannah.raes.cool@gmail.com → 1/31/00
raes.geoffrey@gmail.com → 3/4/02
christiane.schokkaert@telenet.be → 1/27/48
Maria_seghers@hotmail.com → 9/2/57
lieve.servaes@skynet.be → 6/4/62
linda.tampere@telenet.be → 11/6/63
tanjathiels@gmail.com → 12/29/69
ingestimmerm@gmail.com → 5/18/68
katelijnetonnelier@skynet.be → 12/4/73
dtu@telenet.be → 10/6/67
andré.valcke@telenet.be → 9/6/48
jose.vanassche@telenet.be → 7/18/48
sien.vanassche@gmail.com → 7/18/48
vantak@hotmail.com → 07/09/1955
hildevandoorslaer@outlook.com → 11/21/63
claudine@proportio.be → 12/15/70
marijkevangoethem6@gmail.com → 3/6/56
ivan.van.gucht@telenet.be → 7/25/65
aerts.didier@telenet.be → 11/8/64
lutgarde.vanherstraeten@live.be → 7/22/59
peter.vanhoeymissen@telenet.be → 9/22/59
vanhove.ilse@telenet.be → 7/3/65
vanhove.kathleen70@gmail.com → 12/13/70
gretavanhuffel@gmail.com → 12/26/54
wendy.vanmalderen@telenet.be → (no date)
else.vanpraet@gmail.com → (no date)
vanpuyvelde-desmedt@hotmail.com → 2/5/1972
patrick.vanasch68@gmail.com → 3/5/1964
ilse.vanbegin@icloud.com → 8/17/1974
K_vandenbroucke@yahoo.com → 3/22/1953
Kathl_v@hotmail.com → 3/3/84
karolien.vanhoyweghen@gmail.com → 3/18/1974
dirkenkatleen@outlook.be → 4/11/1961
biggetje1959@gmail.com → 7/2/59
elsje.bocken@gmail.com → 2/29/1964
Annemiezoldermans@hotmail.com → 4/10/59
lievezoldermans@hotmail.com → 8/4/60
riablommaert@gmail.com → 11/11/62
Koen.karen@skynet.be → 7/27/76
elshendrickx59@hotmail.com → (no date)
gertruda.vanmuylder@gmail.com → (no date)
an.veyt@hotmail.com → (no date)
Koen.karen@skynet.be → 4/10/74
kim.steen@hotmail.be → 11/16/89
renilde_verschueren@hotmail.com → 2/29/64
margo.willems@hotmail.com → 9/23/96
marijke-bruno@live.be → 10/11/69
vandromluc@hotmail.com → 5/17/57
marjan.schollaert@telenet.be → 7/14/70
nele.sauwens@gmail.com → 8/3/92
hannelore.leyers@hotmail.com → 2/22/93
lutdesmit65@gmail.com → 11/4/65
ann-dewit@telenet.be → 1/27/72`;

// Known DB users (from remote query)
const dbUsers = new Map([
  ['admin@animato.be', 1], ['aerts.didier@telenet.be', 62],
  ['an.colaes@skynet.be', 16], ['andré.valcke@telenet.be', 54],
  ['anja.holbrechts@gmail.com', 28], ['annelies.colaes@outlook.be', 17],
  ['annemiezoldermans@hotmail.com', 77], ['bart.de_wilde@telenet.be', 20],
  ['betty.heyvaert@outlook.com', 26], ['biggetje1959@gmail.com', 76],
  ['carine.luca@telenet.be', 35], ['christiane.schokkaert@telenet.be', 46],
  ['claudine@proportio.be', 59], ['coby.goederond@hotmail.com', 23],
  ['dany.mathe.polfliet@gmail.com', 39], ['dbckia@gmail.com', 18],
  ['dirk.tuyaerts@icloud.com', 10], ['dirkenkatleen@outlook.be', 75],
  ['dries.raes@gmail.com', 43], ['else.vanpraet@gmail.com', 69],
  ['elsje.bocken@gmail.com', 14], ['emma.massaer@gmail.com', 38],
  ['fienphilips@live.be', 42], ['greet_janssens@hotmail.com', 30],
  ['gretavanhuffel@gmail.com', 67], ['hannah.raes.cool@gmail.com', 44],
  ['hansfrancois@msn.com', 22], ['hildedegroof@telenet.be', 19],
  ['hildevandoorslaer@outlook.com', 58], ['htmkoster@gmail.com', 31],
  ['huyck.lieve@scarlet.be', 29], ['ilse.vanbegin@icloud.com', 71],
  ['ingetimmerm@gmail.com', 51], ['ingrid.macharis@telenet.be', 36],
  ['ivan.van.gucht@telenet.be', 61], ['jose.vanassche@telenet.be', 55],
  ['k_vandenbroucke@yahoo.com', 72], ['karolien.vanhoyweghen@gmail.com', 74],
  ['katelijnetonnelier@skynet.be', 52], ['kathl_v@hotmail.com', 73],
  ['klaar@kinderpsycholoog.be', 24], ['kristelheyvaert@gmail.com', 25],
  ['lieve.servaes@skynet.be', 48], ['lievehofmans34@gmail.com', 27],
  ['lievezoldermans@hotmail.com', 78], ['linda.tampere@telenet.be', 49],
  ['lutgarde.vanherstraeten@live.be', 63], ['mampaey.veerle@gmail.com', 37],
  ['maria_seghers@hotmail.com', 47], ['mariekemeersman11@gmail.com', 40],
  ['marijkevangoethem6@gmail.com', 60], ['patrick.vanasch68@gmail.com', 34],
  ['peter.vanhoeymissen@telenet.be', 64], ['raes.geoffrey@gmail.com', 45],
  ['ria_moens@hotmail.com', 41], ['ritacassiman@hotmail.com', 15],
  ['roke80@hotmail.com', 33], ['s.delforge@telenet.be', 21],
  ['sien.vanassche@gmail.com', 56], ['tanjathiels@gmail.com', 50],
  ['tatjana.kussener@telenet.be', 32], ['vanhove.ilse@telenet.be', 65],
  ['vanhove.kathleen70@gmail.com', 66], ['vanpuyvelde-desmedt@hotmail.com', 70],
  ['vantak@hotmail.com', 57], ['wendy.vanmalderen@telenet.be', 68],
]);

function parseDate(dateStr) {
  dateStr = dateStr.trim();
  if (!dateStr || dateStr.includes('no date')) return null;
  
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  
  let [a, b, c] = parts.map(p => parseInt(p, 10));
  
  // Determine if c is a 4-digit year or 2-digit year
  let year, month, day;
  
  if (c >= 1900 && c <= 2099) {
    // c is a 4-digit year
    // Could be M/D/YYYY or D/M/YYYY
    // If a > 12, it must be D/M/YYYY
    if (a > 12) {
      day = a; month = b; year = c;
    } else if (b > 12) {
      // b > 12 means b is day, so M/D/YYYY
      month = a; day = b; year = c;
    } else {
      // Both a and b <= 12 — ambiguous
      // Default: for European context check known patterns
      // Most dates in this dataset with 4-digit year use D/M/YYYY if first > 12
      // If ambiguous, use M/D/YYYY (US format seen in the dataset)
      month = a; day = b; year = c;
    }
  } else {
    // 2-digit year
    year = c;
    if (year < 100) {
      // Pivot: >= 26 → 1900s, < 26 → 2000s (current year is 2026)
      year = year >= 26 ? 1900 + year : 2000 + year;
    }
    
    // For 2-digit year entries, format is M/D/YY (US format)
    if (a > 12) {
      day = a; month = b;
    } else if (b > 12) {
      month = a; day = b;
    } else {
      // Ambiguous — assume M/D/YY (US format, which is the dominant pattern)
      month = a; day = b;
    }
  }
  
  // Validate
  if (month < 1 || month > 12) return { error: `Invalid month ${month}` };
  if (day < 1 || day > 31) return { error: `Invalid day ${day}` };
  
  const dateObj = new Date(year, month - 1, day);
  if (dateObj.getMonth() !== month - 1 || dateObj.getDate() !== day) {
    return { error: `Invalid date: ${year}-${month}-${day}` };
  }
  
  // Format as YYYY-MM-DD
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Parse all lines
const lines = data.split('\n');
const emailDates = new Map(); // email → date
const duplicates = [];
const noMatch = [];
const noDate = [];
const parseErrors = [];

for (const line of lines) {
  const match = line.match(/^(.+?)\s*→\s*(.+)$/);
  if (!match) continue;
  
  const email = match[1].trim().toLowerCase();
  const dateStr = match[2].trim();
  
  if (dateStr.includes('no date')) {
    noDate.push(email);
    continue;
  }
  
  const parsed = parseDate(dateStr);
  if (!parsed) {
    parseErrors.push({ email, dateStr, reason: 'Could not parse' });
    continue;
  }
  if (parsed.error) {
    parseErrors.push({ email, dateStr, reason: parsed.error });
    continue;
  }
  
  // Check for duplicates
  if (emailDates.has(email)) {
    const existing = emailDates.get(email);
    if (existing !== parsed) {
      duplicates.push({ email, date1: existing, date2: parsed, dateStr });
    }
    continue; // Keep first occurrence unless we have a 4-digit year
  }
  
  emailDates.set(email, parsed);
}

// Handle duplicates: prefer 4-digit year entries (more explicit)
// elsje.bocken: 7/25/66 → 1966-07-25 vs 2/29/1964 → 1964-02-29
// patrick.vanasch68: 4/8/1970 → 1970-04-08 vs 3/5/1964 → 1964-03-05
// koen.karen: 7/27/76 → 1976-07-27 vs 4/10/74 → 1974-04-10

// For elsje.bocken: second entry 2/29/1964 has 4-digit year and is a leap year date
// Let's use the second (more explicit) entry
emailDates.set('elsje.bocken@gmail.com', '1964-02-29');
// For patrick.vanasch68: "68" in email suggests born 1968, but dates are 1970 and 1964
// 3/5/1964 has 4-digit year - use that
emailDates.set('patrick.vanasch68@gmail.com', '1964-03-05');
// For koen.karen: both 2-digit years, 76 and 74
// Use first: 1976-07-27 (keep as-is)

// Special handling for ambiguous 2-digit years:
// dbckia@gmail.com → 12/19/22 → could be 2022 or 1922. 2022 makes more sense (recent member?)
// huyck.lieve@scarlet.be → 9/2/22 → same: 2022. But that would make them 4 years old...
// Let's set these to 1922 which also doesn't make sense. These need manual review.
// Actually: pivot at 26 means 22 → 2022. These are clearly wrong data. Skip them.

console.log('=== DUPLICATES (resolved) ===');
for (const d of duplicates) {
  console.log(`  ${d.email}: ${d.date1} vs ${d.date2} (dateStr: ${d.dateStr})`);
}

console.log('\n=== NO DATE ===');
for (const e of noDate) {
  console.log(`  ${e}`);
}

console.log('\n=== PARSE ERRORS ===');
for (const e of parseErrors) {
  console.log(`  ${e.email}: "${e.dateStr}" → ${e.reason}`);
}

// Check which emails match DB
console.log('\n=== NOT IN DATABASE ===');
const notInDb = [];
for (const [email] of emailDates) {
  if (!dbUsers.has(email)) {
    notInDb.push(email);
    console.log(`  ${email}`);
  }
}

// Check problematic dates
console.log('\n=== SUSPICIOUS DATES (born after 2000, verify) ===');
for (const [email, date] of emailDates) {
  const year = parseInt(date.split('-')[0]);
  if (year >= 2020) {
    console.log(`  ${email}: ${date} ← SUSPICIOUS, likely wrong pivot year`);
  }
}

// Generate SQL
console.log('\n=== SQL UPDATES ===');
const sqlStatements = [];
let count = 0;
for (const [email, date] of emailDates) {
  const userId = dbUsers.get(email);
  if (!userId) continue;
  
  // Skip suspicious dates (2022 entries)
  const year = parseInt(date.split('-')[0]);
  if (year >= 2020) {
    console.log(`-- SKIPPED (suspicious year): ${email} → ${date}`);
    continue;
  }
  
  const sql = `UPDATE profiles SET geboortedatum = '${date}' WHERE user_id = ${userId};`;
  sqlStatements.push(sql);
  count++;
  console.log(sql);
}

console.log(`\n=== SUMMARY ===`);
console.log(`Total entries: ${lines.length}`);
console.log(`Parsed dates: ${emailDates.size}`);
console.log(`Duplicates resolved: ${duplicates.length}`);
console.log(`No date: ${noDate.length}`);
console.log(`Parse errors: ${parseErrors.length}`);
console.log(`Not in DB: ${notInDb.length}`);
console.log(`SQL updates to execute: ${count}`);

// Write SQL file
const fs = await import('fs');
fs.writeFileSync('/home/user/webapp/update-birthdates.sql', sqlStatements.join('\n'));
console.log(`\nSQL written to update-birthdates.sql`);
