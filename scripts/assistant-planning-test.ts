import assert from 'node:assert/strict';
import { parseQuestion, answerQuestion } from '../lib/assistant/ask';
import { emptyData } from '../lib/finance/model';
import { addDays } from '../lib/finance/calc';
const today = '2026-11-13';
const d = emptyData(today);
for (const text of ['پولم تا کی می‌رسه؟', 'وضعیت نقدینگی من چطوره؟', 'کسری نقدینگی دارم؟']) {
  const q = parseQuestion(d, text, today);
  assert.ok(q && q.type === 'more' && q.q.type === 'cashPlan', text);
  const r = answerQuestion(d, [], today, q);
  assert.match(r.text, /ابتدا موجودی/);
  assert.equal(r.action, undefined);
}
d.accounts[0].openingRial = 1_000_000;
d.cheques.push({ id: 'c', direction: 'issued', amountRial: 1_200_000, dueDate: addDays(today, 5), counterparty: '', status: 'pending' });
const q = parseQuestion(d, 'پولم تا سه ماه کافیه؟', today)!;
assert.ok(q.type === 'more' && q.q.type === 'cashPlan' && q.q.days === 90);
const r = answerQuestion(d, [], today, q);
assert.match(r.text, /۲۰٬۰۰۰ تومان/);
assert.match(r.text, /احتمال کسری/);
assert.equal(r.link?.href, '/');
assert.equal(r.action, undefined);
console.log('4 assistant planning cases passed');
