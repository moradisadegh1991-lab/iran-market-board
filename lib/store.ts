// Upstash Redis (Vercel Marketplace) with an in-memory fallback for local dev.
import { Redis } from '@upstash/redis';

export interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSec?: number): Promise<void>;
  setNx(key: string, value: unknown, ttlSec: number): Promise<boolean>;
  del(key: string): Promise<void>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  /** counter that starts its expiry on first use (rate limits) */
  incr(key: string, ttlSec: number): Promise<number>;
  rpush(key: string, member: string): Promise<void>;
  lrange(key: string): Promise<string[]>;
  lrem(key: string, member: string): Promise<void>;
}

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const storeMode: 'redis' | 'memory' = url && token ? 'redis' : 'memory';

function redisKV(): KV {
  // two quick retries: a Redis that is down or over its plan should be noticed in well under a second (cacheKv then
  // serves without it), not after the client's default five retries with exponential backoff
  const r = new Redis({ url: url!, token: token!, automaticDeserialization: true, retry: { retries: 2, backoff: (n) => 100 * (n + 1) } });
  return {
    async get<T>(key: string) {
      return ((await r.get(key)) as T) ?? null;
    },
    async set(key, value, ttlSec) {
      if (ttlSec) await r.set(key, value, { ex: ttlSec });
      else await r.set(key, value);
    },
    async setNx(key, value, ttlSec) {
      const res = await r.set(key, value, { nx: true, ex: ttlSec });
      return res === 'OK';
    },
    async del(key) {
      await r.del(key);
    },
    async sadd(key, member) {
      await r.sadd(key, member);
    },
    async srem(key, member) {
      await r.srem(key, member);
    },
    async smembers(key) {
      return ((await r.smembers(key)) as unknown[]).map(String);
    },
    async incr(key, ttlSec) {
      const n = await r.incr(key);
      if (n === 1) await r.expire(key, ttlSec);
      return n;
    },
    async rpush(key, member) {
      await r.rpush(key, member);
    },
    async lrange(key) {
      return ((await r.lrange(key, 0, -1)) as unknown[]).map(String);
    },
    async lrem(key, member) {
      await r.lrem(key, 0, member);
    },
  };
}

function memoryKV(): KV {
  const g = globalThis as any;
  g.__imbStore ??= { data: new Map<string, { v: unknown; exp: number }>(), sets: new Map<string, Set<string>>(), lists: new Map<string, string[]>() };
  g.__imbStore.lists ??= new Map<string, string[]>();
  const { data, sets, lists } = g.__imbStore as { data: Map<string, { v: unknown; exp: number }>; sets: Map<string, Set<string>>; lists: Map<string, string[]> };
  const alive = (k: string) => {
    const e = data.get(k);
    if (!e) return undefined;
    if (e.exp && e.exp < Date.now()) {
      data.delete(k);
      return undefined;
    }
    return e;
  };
  return {
    async get<T>(key: string) {
      const e = alive(key);
      return e ? (structuredClone(e.v) as T) : null;
    },
    async set(key, value, ttlSec) {
      data.set(key, { v: structuredClone(value), exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
    },
    async setNx(key, value, ttlSec) {
      if (alive(key)) return false;
      data.set(key, { v: value, exp: Date.now() + ttlSec * 1000 });
      return true;
    },
    async del(key) {
      data.delete(key);
    },
    async sadd(key, member) {
      if (!sets.has(key)) sets.set(key, new Set());
      sets.get(key)!.add(member);
    },
    async srem(key, member) {
      sets.get(key)?.delete(member);
    },
    async smembers(key) {
      return [...(sets.get(key) ?? [])];
    },
    async incr(key, ttlSec) {
      const e = alive(key);
      const n = (typeof e?.v === 'number' ? e.v : 0) + 1;
      data.set(key, { v: n, exp: e?.exp || Date.now() + ttlSec * 1000 });
      return n;
    },
    async rpush(key, member) {
      lists.set(key, [...(lists.get(key) ?? []), member]);
    },
    async lrange(key) {
      return [...(lists.get(key) ?? [])];
    },
    async lrem(key, member) {
      lists.set(key, (lists.get(key) ?? []).filter((x) => x !== member));
    },
  };
}

export const kv: KV = storeMode === 'redis' ? redisKV() : memoryKV();

// ── caches: never take the board down ──────────────────────────────────────
// Snapshot, source and history caches can be rebuilt from the sources, so a Redis failure (down, or the plan's limit
// reached — "ERR … reached current Fixed plan limits", Mehr 1405) must not turn into a 503: a read gives null, a write
// is skipped, and Redis is left alone for a minute. Durable data (paper sessions, the business inbox, subscribers) keeps
// using `kv` and fails loudly — silently keeping an order in one instance's memory would lose it.
const DOWN_MS = 60_000;
const health = { downUntil: 0, lastError: null as string | null, lastErrorAt: 0 };
export const cacheHealth = () => ({ ...health, down: Date.now() < health.downUntil });
/** tests: Redis came back (as it would a minute later) */
export const resetCacheHealth = () => void (health.downUntil = 0);

async function guard<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (Date.now() < health.downUntil) return fallback;
  try {
    return await fn();
  } catch (e) {
    health.downUntil = Date.now() + DOWN_MS;
    health.lastError = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    health.lastErrorAt = Date.now();
    console.warn('[store] cache read/write failed; serving without Redis for a minute:', health.lastError);
    return fallback;
  }
}

/** A value read through `cacheKv.get` when Redis failed: null, and remembered so it is never written back over the real one. */
export const cacheKv = {
  get: <T>(key: string) => guard<T | null>(() => kv.get<T>(key), null),
  /** like get, but says whether Redis answered — a store loaded from a failed read must never be saved back */
  read: <T>(key: string) => guard<{ ok: boolean; value: T | null }>(async () => ({ ok: true, value: await kv.get<T>(key) }), { ok: false, value: null }),
  set: (key: string, value: unknown, ttlSec?: number) => guard(() => kv.set(key, value, ttlSec), undefined),
  /** true when Redis is away: build anyway (one instance building twice is better than none building) */
  setNx: (key: string, value: unknown, ttlSec: number) => guard(() => kv.setNx(key, value, ttlSec), true),
  del: (key: string) => guard(() => kv.del(key), undefined),
};
