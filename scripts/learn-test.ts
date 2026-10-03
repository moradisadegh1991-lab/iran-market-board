/**
 * Pins the learning section (lib/learn): the course is well-formed, the spaced-repetition schedule
 * (Leitner boxes 1/3/7/16/35 days), the interleaved daily review, storage that survives junk, and
 * the calculators' arithmetic. Also that no lesson tells anyone to buy or sell.
 * Run: npx tsx scripts/learn-test.ts
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { compound, doublingYears, inflate, mixVol, positionSize, split503020, workHours } from '../lib/learn/calc';
import { LESSONS, lessonById, questionById, TRACKS } from '../lib/learn/lessons';
import { addDaysIso, BOX_DAYS, dueDeck, emptyLearn, finishLesson, MASTERED, nextLesson, normalizeLearn, progress, review } from '../lib/learn/review';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const T = '2026-10-03';

ok('the course is well-formed: unique ids, valid answers, every track has lessons', () => {
  const ids = new Set<string>();
  for (const l of LESSONS) {
    assert.ok(!ids.has(l.id), `duplicate lesson ${l.id}`);
    ids.add(l.id);
    assert.ok(TRACKS.some((t) => t.key === l.track));
    assert.ok(l.steps.length >= 2 && l.quiz.length >= 2, l.id);
    for (const q of l.quiz) {
      assert.ok(!ids.has(q.id), `duplicate question ${q.id}`);
      ids.add(q.id);
      assert.ok(q.answer >= 0 && q.answer < q.options.length && q.options.length >= 2, q.id);
      assert.equal(new Set(q.options).size, q.options.length, `${q.id}: repeated option`);
      assert.ok(q.why.length > 10);
      assert.equal(questionById(q.id)?.lesson.id, l.id);
    }
    for (const s of l.steps) assert.equal((s.body.join(' ').match(/\*\*/g) ?? []).length % 2, 0, `${l.id}: unbalanced **`);
    if (l.action) assert.ok(l.action.href.startsWith('/'), 'in-app links only');
  }
  for (const t of TRACKS) assert.ok(LESSONS.filter((l) => l.track === t.key).length >= 4, t.key);
  assert.equal(lessonById('nope'), null);
});

ok('lessons describe and teach; none tells the reader to buy or sell something', () => {
  const all = LESSONS.flatMap((l) => [l.title, l.summary, l.takeaway, ...l.steps.flatMap((s) => [s.title, ...s.body]), ...l.quiz.flatMap((q) => [q.q, q.why, q.options[q.answer]])]).join('\n'); // wrong options are meant to be wrong
  assert.doesNotMatch(all, /(دلار|طلا|سکه|بیت‌کوین|سهام)\s*(را)?\s*(بخرید|بفروشید)|سیگنال خرید است|سود تضمینی|تضمین سود(?! را)/);
});

ok('finishing a lesson: right answers go to box 2 (3 days), wrong to box 1 (tomorrow)', () => {
  const l = LESSONS[0];
  const s = finishLesson(emptyLearn(), l, { [l.quiz[0].id]: true, [l.quiz[1].id]: false }, T);
  assert.deepEqual(s.cards[l.quiz[0].id], { box: 2, due: addDaysIso(T, 3), right: 1, wrong: 0 });
  assert.deepEqual(s.cards[l.quiz[1].id], { box: 1, due: addDaysIso(T, 1), right: 0, wrong: 1 });
  assert.equal(s.lessons[l.id].score, 0.5);
  assert.deepEqual(s.days, [T]);
  // finishing again does not reset the schedule or the first score
  const again = finishLesson(s, l, { [l.quiz[0].id]: false, [l.quiz[1].id]: true }, addDaysIso(T, 1));
  assert.deepEqual(again.cards[l.quiz[0].id], s.cards[l.quiz[0].id]);
  assert.equal(again.lessons[l.id].score, 0.5);
});

ok('reviews climb the Leitner boxes, a miss sends the card back, box 5 right retires it', () => {
  const l = LESSONS[1];
  const id = l.quiz[0].id;
  let s = finishLesson(emptyLearn(), l, { [id]: true }, T);
  let day = T;
  for (const box of [3, 4, 5]) {
    day = s.cards[id].due;
    s = review(s, id, true, day);
    assert.equal(s.cards[id].box, box);
    assert.equal(s.cards[id].due, addDaysIso(day, BOX_DAYS[box - 1]));
  }
  s = review(s, id, false, s.cards[id].due);
  assert.equal(s.cards[id].box, 1);
  for (let k = 0; k < 5; k++) s = review(s, id, true, s.cards[id].due);
  assert.equal(s.cards[id].box, MASTERED);
  assert.deepEqual(
    dueDeck(s, LESSONS, '2099-01-01').filter((c) => c.cardId === id),
    [],
    'retired cards never come back',
  );
});

ok('the daily deck: only due cards, oldest first, interleaved across lessons, stable within a day', () => {
  let s = emptyLearn();
  for (const l of LESSONS.slice(0, 4)) s = finishLesson(s, l, Object.fromEntries(l.quiz.map((q) => [q.id, false])), T);
  assert.equal(dueDeck(s, LESSONS, T).length, 0, 'nothing due on the day itself');
  const tomorrow = addDaysIso(T, 1);
  const deck = dueDeck(s, LESSONS, tomorrow, 50);
  assert.equal(
    deck.length,
    LESSONS.slice(0, 4).reduce((a, l) => a + l.quiz.length, 0),
  );
  for (let i = 1; i < deck.length; i++)
    if (deck[i].lessonId === deck[i - 1].lessonId)
      assert.ok(
        deck.slice(i).every((x) => x.lessonId === deck[i].lessonId),
        'same lesson twice in a row only when nothing else is left',
      );
  assert.deepEqual(dueDeck(s, LESSONS, tomorrow, 50), deck, 'same order all day');
  assert.equal(dueDeck(s, LESSONS, tomorrow, 3).length, 3, 'capped');
  const p = progress(s, LESSONS, tomorrow);
  assert.equal(p.lessonsDone, 4);
  assert.equal(p.dueToday, deck.length);
  assert.equal(nextLesson(s, LESSONS)?.id, LESSONS[4].id);
});

ok('storage: junk is dropped, good state survives a round trip', () => {
  const l = LESSONS[2];
  const s = { ...finishLesson(emptyLearn(), l, { [l.quiz[0].id]: true }, T), plans: { [l.id]: 'اگر حقوق آمد، آنگاه ۱۵٪ را منتقل می‌کنم' } };
  assert.deepEqual(normalizeLearn(JSON.parse(JSON.stringify(s))), s);
  const junk = normalizeLearn({ cards: { a: { box: 9, due: 'x' }, b: { box: 2, due: '2026-01-01', right: -3 } }, lessons: { z: { done: 5 } }, plans: { p: 7 }, days: ['bad', T, T] });
  assert.deepEqual(Object.keys(junk.cards), ['b']);
  assert.equal(junk.cards.b.right, 0);
  assert.deepEqual(junk.lessons, {});
  assert.deepEqual(junk.plans, {});
  assert.deepEqual(junk.days, [T]);
  assert.deepEqual(normalizeLearn(null), emptyLearn());
});

ok('calculators: compound, inflation, real money, mix volatility, position size, 50/30/20, work hours', () => {
  // 100 at 20% for 2 years, nothing added → 144; in today's money at 20% inflation → 100
  const c = compound(100, 0, 20, 2, 20);
  close(c.nominal, 144);
  close(c.real, 100);
  // monthly deposits at 0% just add up
  close(compound(0, 10, 0, 1, 0).nominal, 120);
  close(compound(100, 0, 20, 10, 0).nominal, 619.1736422, 1e-4); // the lesson's «حدود ۶۲۰»
  close(doublingYears(40), Math.log(2) / Math.log(1.4));
  assert.ok(doublingYears(40) > 2 && doublingYears(40) < 2.1); // «حدوداً هر دو سال»
  close(inflate(100, 40, 1).buys, 100 / 1.4); // «حدود ۷۱»
  close(mixVol(30, 1), 30);
  close(mixVol(30, 0), 30 * Math.SQRT1_2);
  assert.ok(1 - mixVol(30, 0.63) / 30 < 0.1 && 1 - mixVol(30, 0.78) / 30 > 0.05); // «فقط ۶ تا ۱۰٪»
  const p = positionSize(100_000_000, 1, 100, 95)!;
  close(p.size, 20_000_000); // the quiz's answer
  close(p.riskAmount, 1_000_000);
  assert.equal(positionSize(100, 1, 100, 101), null, 'a stop above the entry is not a stop');
  assert.deepEqual(split503020(100), { needs: 50, wants: 30, save: 20 });
  close(workHours(1_000_000, 17_600_000, 176)!, 10);
  // the lessons' worked numbers
  close((1.3 / 1.4 - 1) * 100, -7.142857, 1e-5);
  close((1.25 / 1.35 - 1) * 100, -7.407407, 1e-5);
  close((1.23 / 1.4 - 1) * 100, -12.142857, 1e-5);
  close(0.99 ** 20, 0.8179069, 1e-6);
});

// the lessons' «measured» market numbers, against the real data of scripts/eval (when downloaded)
if (fs.existsSync('.cache/eval/daily-usd.json'))
  ok('real data: dollar ×~186 and ~42%/yr since 1390; coin and 18k gold ~52%/yr; the dollar’s 48% fall, Mehr → Azar 1397', () => {
    const load = (k: string) => JSON.parse(fs.readFileSync(`.cache/eval/daily-${k}.json`, 'utf8')) as [string, number][];
    const cagr = (r: [string, number][]) => ((r[r.length - 1][1] / r[0][1]) ** (1 / ((Date.parse(r[r.length - 1][0]) - Date.parse(r[0][0])) / (365.25 * 86_400_000))) - 1) * 100;
    const usd = load('usd');
    assert.ok(Math.abs(usd[usd.length - 1][1] / usd[0][1] - 186) < 8, 'dollar multiple');
    assert.ok(Math.abs(cagr(usd) - 42) < 2);
    for (const k of ['coin', 'g18']) assert.ok(Math.abs(cagr(load(k)) - 52) < 2, k);
    let peak = 0;
    let peakAt = '';
    let worst = { dd: 0, from: '', to: '' };
    for (const [d, v] of usd) {
      if (v > peak) (peak = v), (peakAt = d);
      if (v / peak - 1 < worst.dd) worst = { dd: v / peak - 1, from: peakAt, to: d };
    }
    assert.ok(Math.abs(worst.dd + 0.48) < 0.01 && worst.from.startsWith('2018-09') && worst.to.startsWith('2018-12'), JSON.stringify(worst));
  });

console.log(`\nlearn: ${n} checks OK`);
