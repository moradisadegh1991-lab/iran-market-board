// Run against a disposable Redis 7 instance that requires AUTH, with an admin URL on DB 0.
import assert from 'node:assert/strict';
import Redis from 'ioredis';
import { tcpKV } from '../lib/store-tcp';

async function main() {
  const adminUrl = process.env.TEST_REDIS_URL;
  if (!adminUrl) throw new Error('Set TEST_REDIS_URL to a disposable Redis instance');
  const admin = new Redis(adminUrl);
  const base = new URL(adminUrl);
  base.username = 'market-test';
  base.password = 'test:password@1';
  base.pathname = '/1';
  const password = '>test:password@1';
  const rights = ['~diag:*', '+get', '+set', '+del', '+sadd', '+srem', '+smembers', '+rpush', '+lrange', '+lrem', '+eval', '+incr'];
  try {
    await admin.acl('SETUSER', 'market-test', 'reset', 'on', password, ...rights);
    await admin.set('diag:fixture', 'db0');
    const anonymous = new URL(adminUrl);
    anonymous.username = '';
    anonymous.password = '';
    await assert.rejects(tcpKV(anonymous.href).get('diag:fixture'), /NOAUTH/);
    const denied = tcpKV(base.href);
    await assert.rejects(denied.get('diag:fixture'), /NOPERM/);
    assert.equal(await admin.get('diag:fixture'), 'db0');
    await admin.acl('SETUSER', 'market-test', '+select');
    await admin.select(1);
    const elsewhere = new URL(base);
    elsewhere.pathname = '/99';
    await assert.rejects(tcpKV(elsewhere.href).set('diag:fixture', 'wrong-db'), /DB index/);
    const store = tcpKV(base.href);
    const fixture = [{ n: 7, label: 'آزمایش' }];
    await admin.set('diag:fixture', JSON.stringify(fixture));
    assert.deepEqual(await store.get('diag:fixture'), fixture);
    await store.set('diag:fixture', fixture);
    assert.equal(await admin.get('diag:fixture'), JSON.stringify(fixture));
    assert.equal(await admin.ttl('diag:fixture'), -1);
    await store.set('diag:flag', true, 60);
    assert.equal(await admin.get('diag:flag'), 'true');
    assert.equal(await store.get('diag:flag'), true);
    await admin.set('diag:raw', '001');
    assert.equal(await store.get('diag:raw'), '001');
    assert.equal(await store.get('diag:missing'), null);
    const locks = await Promise.all(Array.from({ length: 12 }, () => store.setNx('diag:lock', '1', 30)));
    assert.equal(locks.filter(Boolean).length, 1);
    assert.ok(await admin.ttl('diag:lock') > 0);
    const increments = await Promise.all(Array.from({ length: 30 }, () => store.incr('diag:counter', 60)));
    assert.deepEqual(increments.sort((a, b) => a - b), Array.from({ length: 30 }, (_, i) => i + 1));
    assert.ok(await admin.ttl('diag:counter') > 0);
    await admin.expire('diag:counter', 10);
    assert.equal(await store.incr('diag:counter', 60), 31);
    assert.ok(await admin.ttl('diag:counter') <= 10);
    await admin.set('diag:persistent', '0');
    assert.equal(await store.incr('diag:persistent', 60), 1);
    assert.equal(await admin.ttl('diag:persistent'), -1);
    await store.sadd('diag:members', '001');
    assert.deepEqual(await store.smembers('diag:members'), ['001']);
    await store.srem('diag:members', '001');
    assert.deepEqual(await store.smembers('diag:members'), []);
    await store.rpush('diag:list', 'A');
    await store.rpush('diag:list', 'A');
    await store.rpush('diag:list', 'B');
    await store.lrem('diag:list', 'A');
    assert.deepEqual(await store.lrange('diag:list'), ['B']);
    await store.del('diag:list');
    assert.deepEqual(await store.lrange('diag:list'), []);
    await assert.rejects(store.get('unrelated:key'), /NOPERM/);
    await admin.select(0);
    assert.equal(await admin.get('diag:fixture'), 'db0');
    console.log('Redis TCP: stored formats, TTL, atomic locks/counters, containers and DB/ACL checks passed');
  } finally {
    admin.disconnect();
  }
}
main().then(() => process.exit(0), (error: unknown) => {
  console.error(error);
  process.exit(1);
});
