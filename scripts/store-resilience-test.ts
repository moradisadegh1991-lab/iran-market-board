/**
 * Redis over its plan (Upstash «ERR … reached current Fixed plan limits», Mehr 1405) or down must not take the board down,
 * and the cache layer must not hammer Redis while it is up. A fake Upstash REST server answers like the real one.
 * Run: npx tsx scripts/store-resilience-test.ts
 */
import assert from 'node:assert';
import http from 'node:http';

const LIMIT = 'ERR This database has reached current Fixed plan limits. Please upgrade manually or enable auto upgrade on Upstash Console';
let mode: 'up' | 'limit' = 'up';
const data = new Map<string, string>();
const log: string[][] = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    // the client sends single commands or (auto-)pipelines: [[cmd], [cmd]] → [{ result } | { error }]
    const parsed = JSON.parse(body) as unknown[];
    const pipeline = Array.isArray(parsed[0]);
    const cmds = (pipeline ? parsed : [parsed]) as string[][];
    res.setHeader('content-type', 'application/json');
    const out = cmds.map((cmd) => {
      log.push(cmd.map(String));
      const [op, key, val, ...opts] = cmd.map(String);
      let result: unknown = null;
      if (op === 'get') result = data.get(key) ?? null;
      else if (op === 'set') {
        if (opts.map((o) => o.toLowerCase()).includes('nx') && data.has(key)) result = null;
        else ((result = 'OK'), data.set(key, val));
      } else if (op === 'del') result = Number(data.delete(key));
      return { result };
    });
    // over the plan, Upstash refuses the whole request: HTTP 400 with one top-level error (the text the app showed)
    if (mode === 'limit') {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: `${LIMIT}, command was: ${JSON.stringify(cmds)}` }));
    }
    res.end(JSON.stringify(pipeline ? out : out[0]));
  });
});

let n = 0;
const ok = async (name: string, fn: () => Promise<void>) => {
  await fn();
  n++;
  console.log(`✓ ${name}`);
};

server.listen(0, async () => {
  const port = (server.address() as { port: number }).port;
  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${port}`;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test';
  try {
    const { cacheKv, cacheHealth, kv, resetCacheHealth, storeMode } = await import('../lib/store');
    const { cachedSource } = await import('../lib/sources/cache');
    const { loadDaily, saveDaily, upsertDailyPoint } = await import('../lib/history');
    assert.equal(storeMode, 'redis');
    const health = cacheHealth as () => { down: boolean; downUntil: number; lastError: string | null };

    await ok('up: a fresh source is read from Redis once, then served from memory', async () => {
      let fetched = 0;
      const fetcher = async () => ((fetched += 1), { p: fetched });
      const a = await cachedSource('t1', 60, fetcher);
      assert.deepEqual(a.data, { p: 1 });
      const before = log.length;
      for (let i = 0; i < 5; i++) assert.deepEqual((await cachedSource('t1', 60, fetcher)).data, { p: 1 });
      assert.equal(log.length, before, 'no Redis command while the in-memory copy is fresh');
      assert.equal(fetched, 1);
    });

    await ok('up: a refetch within 10 minutes is not written back to Redis', async () => {
      const fetcher = async () => ({ v: Math.random() });
      await cachedSource('t2', 1, fetcher);
      const sets = () => log.filter((c) => c[0] === 'set' && c[1] === 'src:t2').length;
      assert.equal(sets(), 1);
      await new Promise((r) => setTimeout(r, 1100));
      await cachedSource('t2', 1, fetcher);
      assert.equal(sets(), 1, 'refetched, kept in memory, not rewritten');
    });

    // the real history, saved while Redis was up
    const real = await loadDaily();
    upsertDailyPoint(real, '2026-10-01', { usd: 1_000_000 });
    await saveDaily(real);
    assert.match(data.get('hist:daily:v1') ?? '', /2026-10-01/);

    mode = 'limit';
    await ok('over the plan: reads give nothing, writes are skipped — no throw', async () => {
      assert.equal(await cacheKv.get('x'), null);
      assert.equal(health().down, true);
      assert.match(health().lastError ?? '', /Fixed plan limits/);
      await cacheKv.set('x', 1);
      assert.equal(await cacheKv.setNx('lock', 1, 40), true, 'build anyway');
    });

    await ok('over the plan: Redis is left alone for a minute (no command per request)', async () => {
      const before = log.length;
      for (let i = 0; i < 20; i++) await cacheKv.get('snapshot:v2');
      assert.equal(log.length, before);
    });

    await ok('over the plan: a source still fetches and serves from memory', async () => {
      const r = await cachedSource('t3', 60, async () => ({ live: true }));
      assert.deepEqual(r.data, { live: true });
      assert.equal(r.status.ok, true);
    });

    await ok('a history loaded from a failed read is never saved back over the real one', async () => {
      const h = await loadDaily();
      assert.equal(h.dates.length, 0);
      upsertDailyPoint(h, '2026-10-06', { usd: 1_100_000 });
      // Redis recovers in the middle — the stand-in must still not be written
      mode = 'up';
      resetCacheHealth();
      await saveDaily(h);
      assert.ok(!log.some((c) => c[0] === 'set' && c[1] === 'hist:daily:v1' && c[2].includes('2026-10-06')), 'not even tried');
      assert.match(data.get('hist:daily:v1') ?? '', /2026-10-01/, 'the real history is intact');
      assert.doesNotMatch(data.get('hist:daily:v1') ?? '', /2026-10-06/);
    });

    await ok('durable data still fails loudly (an order must not vanish into one instance’s memory)', async () => {
      mode = 'limit';
      await assert.rejects(() => kv.get('biz:inbox:x'), /Fixed plan limits/);
      mode = 'up';
    });

    console.log(`\nstore resilience: ${n} checks OK`);
    server.close();
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
});
