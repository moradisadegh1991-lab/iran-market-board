import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { webVoiceIO, VoiceError } from '../lib/voice-io';

class Recognition {
  static instances: Recognition[] = [];
  lang = ''; interimResults = false; maxAlternatives = 0; continuous = false;
  onresult: any = null; onerror: any = null; onend: any = null;
  constructor() { Recognition.instances.push(this); }
  start() {} stop() { this.onend?.(); } abort() { this.onend?.(); }
}
const last = () => Recognition.instances.at(-1)!;
const row = (text: string, final: boolean) => Object.assign([{ transcript: text }], { isFinal: final });
let n = 0;
async function test(name: string, fn: () => Promise<void>) { await fn(); console.log(`✓ ${name}`); n++; }
async function main() {
  const io = webVoiceIO(Recognition, null);
  await test('cancel always settles even if the recognizer emits no abort error', async () => {
    const pending = io.listen(() => {});
    const late = last().onresult;
    io.cancel();
    await assert.rejects(pending, (e: unknown) => e instanceof VoiceError && e.code === 'cancelled');
    late({ results: [row('بله', true)] });
    assert.equal(last().onresult, null);
  });
  await test('starting a second listen cancels the first without consuming its late result', async () => {
    const first = io.listen(() => {});
    const rejected = assert.rejects(first, /cancelled/);
    const second = io.listen(() => {});
    last().onresult({ results: [row('پولم تا کی میرسه', true)] });
    assert.deepEqual(await second, ['پولم تا کی میرسه']);
    await rejected;
  });
  await test('recognition keeps earlier segments and displays partial transcript', async () => {
    let partial = '';
    const p = io.listen((t) => { partial = t; });
    last().onresult({ results: [row('پنجاه هزار', true), row('تومان نان', false)] });
    assert.equal(partial, 'پنجاه هزار تومان نان');
    last().onresult({ results: [row('پنجاه هزار', true), row('تومان نان', true)] });
    assert.deepEqual(await p, ['پنجاه هزار تومان نان']);
  });
  await test('explicit stop can return the visible partial for the confirmation flow', async () => {
    const p = io.listen(() => {});
    last().onresult({ results: [row('صد هزار تومان', false)] });
    io.stop();
    assert.deepEqual(await p, ['صد هزار تومان']);
  });
  await test('permission errors retain their actionable classification', async () => {
    const p = io.listen(() => {});
    last().onerror({ error: 'not-allowed' });
    await assert.rejects(p, /permission/);
  });
  await test('hung recognition times out and clears handlers', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const p = io.listen(() => {});
    const check = assert.rejects(p, /no-match/);
    mock.timers.tick(25_000);
    await check;
    assert.equal(last().onend, null);
    mock.timers.reset();
  });
  await test('hushing browser speech settles the promise even without an onend event', async () => {
    Object.assign(globalThis, { window: { speechSynthesis: { cancel() {}, speak() {} } }, SpeechSynthesisUtterance: class { constructor(public text: string) {} } });
    const speaker = webVoiceIO(null, { lang: 'fa-IR' } as SpeechSynthesisVoice);
    const p = speaker.speak('سلام');
    speaker.hush();
    await p;
  });
  console.log(`${n} voice IO tests passed`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
