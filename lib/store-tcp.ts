import Redis from 'ioredis';
import { isIP } from 'node:net';
import type { KV } from './store';

const INCREMENT = `
if redis.call('SET', KEYS[1], '1', 'EX', ARGV[1], 'NX') then
  return 1
end
return redis.call('INCR', KEYS[1])
`;

// Match the Upstash REST client's wire format and default deserialization.
function encode(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function decode(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'number' && String(parsed) !== value ? value : parsed;
  } catch {
    return value;
  }
}

export function tcpKV(connectionUrl: string): KV {
  let url: URL;
  let username: string;
  let password: string;
  try {
    url = new URL(connectionUrl);
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error('Invalid REDIS_URL');
  }
  const db = Number(url.pathname.slice(1));
  if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname ||
      !/^(?:\/\d*)?$/.test(url.pathname) || !Number.isSafeInteger(db) ||
      url.search || url.hash || (username && !password)) {
    throw new Error('Invalid REDIS_URL: expected redis:// or rediss:// with an optional /DB number');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let pending: Promise<Redis> | undefined;

  function connected(): Promise<Redis> {
    if (pending) return pending;
    const client = new Redis({
      host,
      port: url.port ? Number(url.port) : 6379,
      tls: url.protocol === 'rediss:' ? { servername: isIP(host) ? undefined : host } : undefined,
      lazyConnect: true,
      connectTimeout: 2000,
      commandTimeout: 3000,
      enableReadyCheck: false,
      disableClientInfo: true,
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
      retryStrategy: () => null,
    });
    // Connection and command failures reach callers via promises.
    client.on('error', () => {});
    const attempt = (async () => {
      await client.connect();
      if (password) {
        if (username) await client.auth(username, password);
        else await client.auth(password);
      }
      // Await SELECT explicitly: a denied or invalid DB must never fall through to DB 0.
      if (db !== 0) await client.select(db);
      return client;
    })();
    pending = attempt;
    const clear = () => {
      if (pending === attempt) pending = undefined;
    };
    client.once('end', clear);
    void attempt.catch(() => {
      clear();
      client.disconnect();
    });
    return attempt;
  }

  return {
    async get<T>(key: string) {
      const raw = await (await connected()).get(key);
      return raw === null ? null : (decode(raw) as T);
    },
    async set(key, value, ttlSec) {
      const client = await connected();
      if (ttlSec) await client.set(key, encode(value), 'EX', ttlSec);
      else await client.set(key, encode(value));
    },
    async setNx(key, value, ttlSec) {
      return await (await connected()).set(key, encode(value), 'EX', ttlSec, 'NX') === 'OK';
    },
    async del(key) { await (await connected()).del(key); },
    async sadd(key, member) { await (await connected()).sadd(key, member); },
    async srem(key, member) { await (await connected()).srem(key, member); },
    async smembers(key) { return (await (await connected()).smembers(key)).map((value) => String(decode(value))); },
    async incr(key, ttlSec) { return Number(await (await connected()).eval(INCREMENT, 1, key, ttlSec)); },
    async rpush(key, member) { await (await connected()).rpush(key, member); },
    async lrange(key) { return (await (await connected()).lrange(key, 0, -1)).map((value) => String(decode(value))); },
    async lrem(key, member) { await (await connected()).lrem(key, 0, member); },
  };
}
