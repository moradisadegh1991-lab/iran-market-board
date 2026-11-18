# Market Redis TCP rollout

Set `REDIS_URL=redis://market:PERCENT_ENCODED_PASSWORD@REDIS_HOST:6379/1`
on the trial Market deployment. Use `rediss://` for a TLS listener with a trusted
certificate. Percent-encode the username and password as URL components.
The deployment must have network access to this Redis listener.
`REDIS_URL` takes precedence over Upstash REST; remove it to return to REST.
The adapter uses the existing key names and Redis types, without a prefix or
data conversion. Selecting a nonzero DB must succeed before Market sends data
commands. Redis ACLs permit `SELECT` but cannot restrict it to a particular
DB number. Use a separate Redis instance for security isolation between DBs.

Run these commands as the Redis administrator. Supply the password using the
deployment's secret handling and install the user through the server's
persistent ACL configuration. `reset` replaces an existing user's rules;
use a dedicated Market user. Redis 7 is the tested baseline.

```sh
redis-cli ACL SETUSER market reset on ">$MARKET_REDIS_PASSWORD" \
  +select +get +set +del +sadd +srem +smembers +rpush +lrange +lrem +eval +incr \
  '~snapshot:v1' '~snapshot:v2' '~snapshot:lock' '~src:*' \
  '~hist:daily:v1' '~hist:tse:v1' '~hist:intraday:v1' \
  '~hist:daily:lastWrite' '~hist:tse:lastWrite' \
  '~holdings:v1' '~diag:ping' '~advisor:calls:*' '~sim:v2:*' '~news:v1:*' \
  '~learn:params:v1' '~learn:log:v1' '~learn:days:v1' '~learn:lock' \
  '~swing:runs:v1' '~swinglive:active:v1' '~swinglive:history:v1' '~swinglive:lock' '~swinglive:session:v1:*' \
  '~paper:active:v1' '~paper:history:v1' '~paper:lock' '~paper:notify' '~paper:session:v1:*' \
  '~tg:subscribers' '~tg:botname' '~tg:bz:*' '~tg:bzmine:*' \
  '~biz:index' '~biz:owner:*' '~biz:pub:*' '~biz:inbox:*' '~biz:item:*' '~biz:ref:*' '~biz:lock:*' \
  '~rl:biz:*' '~rl:bizslug:*'
```

`AUTH` is the Redis authentication handshake. The script uses only `SET` and
`INCR` under `EVAL`. The application does not need administrative commands,
`INFO`, or a global key pattern. Use the admin account separately to inspect
ACL failures or compare data. Save ACL changes using the instance's configured
ACL file or deployment configuration.

On DB 1 verify application reads against known copied data. For example, compare
`GET /api/biz/track?slug=…&id=…` with an existing copied `biz:ref:…` record,
or `GET /api/holdings` against known holdings. A generic HTTP 200 is insufficient.
Keep final copy and job activation gated on this check.
