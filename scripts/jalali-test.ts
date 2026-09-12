/** Cross-checks lib/jalali.ts against Intl's Persian calendar, plus round-trip and edge cases. */
import assert from 'node:assert';
import { gregorianToJalali, isLeapJalali, isoToJalali, jalaliMonthLength, jalaliToGregorian, jalaliToIso } from '../lib/jalali';

const fmt = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });

/** Intl's own Persian-calendar answer for a UTC date, as {jy,jm,jd}. */
function viaIntl(d: Date) {
  const parts = fmt.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { jy: get('year'), jm: get('month'), jd: get('day') };
}

// ── 1. every day across ~30 years, both directions ──
let checked = 0;
const start = Date.UTC(2000, 0, 1);
const end = Date.UTC(2030, 0, 1);
for (let t = start; t < end; t += 86400000) {
  const d = new Date(t);
  const expect = viaIntl(d);
  const got = gregorianToJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  assert.deepEqual(got, expect, `G→J mismatch at ${d.toISOString().slice(0, 10)}: got ${JSON.stringify(got)} want ${JSON.stringify(expect)}`);

  // and back again
  const back = jalaliToGregorian(got.jy, got.jm, got.jd);
  assert.deepEqual(
    back,
    { gy: d.getUTCFullYear(), gm: d.getUTCMonth() + 1, gd: d.getUTCDate() },
    `J→G round-trip failed for ${JSON.stringify(got)}`,
  );
  checked++;
}
console.log(`cross-checked ${checked} days against Intl (2000–2030), both directions`);

// ── 2. month lengths agree with the conversion ──
for (let jy = 1380; jy <= 1420; jy++) {
  for (let jm = 1; jm <= 12; jm++) {
    const len = jalaliMonthLength(jy, jm);
    // the claimed last day must exist and map back to the same Jalali date
    assert.deepEqual(isoToJalali(jalaliToIso(jy, jm, len)), { jy, jm, jd: len }, `bad last day ${jy}/${jm}/${len}`);
    // one past the end must be rejected
    assert.throws(() => jalaliToGregorian(jy, jm, len + 1), `${jy}/${jm}/${len + 1} should not exist`);
  }
}
console.log('month lengths consistent for 1380–1420');

// ── 3. leap years match Intl (Esfand 30 exists iff leap) ──
let leaps = 0;
for (let jy = 1380; jy <= 1420; jy++) {
  const leap = isLeapJalali(jy);
  if (leap) leaps++;
  assert.equal(jalaliMonthLength(jy, 12), leap ? 30 : 29, `Esfand length wrong for ${jy}`);
  if (leap) {
    const iso = jalaliToIso(jy, 12, 30);
    assert.deepEqual(isoToJalali(iso), { jy, jm: 12, jd: 30 }, `Esfand 30 broken in leap year ${jy}`);
  }
}
console.log(`leap years in 1380–1420: ${leaps}`);
assert.ok(leaps >= 9 && leaps <= 11, `expected ~10 leap years in 41, got ${leaps}`);

// ── 4. known anchors ──
assert.equal(jalaliToIso(1404, 1, 1), '2025-03-21', 'Nowruz 1404');
assert.equal(jalaliToIso(1405, 6, 20), '2026-09-11', '20 Shahrivar 1405');
assert.equal(jalaliToIso(1403, 12, 30), '2025-03-20', '1403 was a leap year');
assert.deepEqual(isoToJalali('2026-09-12'), { jy: 1405, jm: 6, jd: 21 });
console.log('known anchor dates OK');

// ── 5. invalid input rejected ──
assert.throws(() => jalaliToGregorian(1404, 13, 1), 'month 13');
assert.throws(() => jalaliToGregorian(1404, 0, 1), 'month 0');
assert.throws(() => jalaliToGregorian(1404, 1, 0), 'day 0');
assert.throws(() => jalaliToGregorian(1404, 1, 1.5), 'fractional day');
assert.throws(() => jalaliToGregorian(1404, 12, 30), '1404 is not a leap year');
console.log('invalid dates rejected');

console.log('\nJALALI OK');
