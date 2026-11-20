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
  type Connection = { client: Redis; ready: Promise<Redis> };
  let connection: Connection | undefined;

  function invalidate(active: Connection) {
    if (connection === active) connection = undefined;
  }

  function connect(): Connection {
    if (connection && !['close', 'end'].includes(connection.client.status)) return connection;
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
    let socketError: Error | undefined;
    client.on('error', (error: Error) => { socketError = error; });
    const ready = (async () => {
      try {
        await client.connect();
      } catch (error) {
        // ioredis may report just "Connection is closed" after a socket error.
        throw socketError ?? error;
      }
      if (password) {
        if (username) await client.auth(username, password);
        else await client.auth(password);
      }
      // Each replacement must finish AUTH and SELECT before it can run commands.
      if (db !== 0) await client.select(db);
      return client;
    })();
    const active = { client, ready };
    connection = active;
    client.once('close', () => invalidate(active));
    client.once('end', () => invalidate(active));
    void ready.catch(() => {
      invalidate(active);
      client.disconnect();
    });
    return active;
  }

  async function connected(): Promise<Redis> {
    return connect().ready;
  }

  async function read<T>(command: (client: Redis) => Promise<T>): Promise<T> {
    const active = connect();
    try {
      return await command(await active.ready);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      const message = error instanceof Error ? error.message : '';
      const closed = message === 'Connection is closed.' ||
        message.startsWith("Stream isn't writeable") ||
        code === 'ECONNRESET' || code === 'EPIPE';
      if (!closed) throw error;

      // A read can safely try once on a fresh socket. Writes may already have
      // reached Redis when the connection drops, so they are never replayed.
      invalidate(active);
      active.client.disconnect();
      return command(await connected());
    }
  }

  return {
    async get<T>(key: string) {
      const raw = await read((client) => client.get(key));
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
    async smembers(key) { return (await read((client) => client.smembers(key))).map((value) => String(decode(value))); },
    async incr(key, ttlSec) { return Number(await (await connected()).eval(INCREMENT, 1, key, ttlSec)); },
    async rpush(key, member) { await (await connected()).rpush(key, member); },
    async lrange(key) { return (await read((client) => client.lrange(key, 0, -1))).map((value) => String(decode(value))); },
    async lrem(key, member) { await (await connected()).lrem(key, 0, member); },
  };
}
