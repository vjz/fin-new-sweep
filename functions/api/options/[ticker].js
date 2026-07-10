const PROVIDER_UA = 'Mozilla/5.0 fin-new-sweep options endpoint';

const TTL = {
  options: 5 * 60,
  blocked: 15 * 60,
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=300',
      ...(init.headers || {}),
    },
  });
}

function uncachedJson(data, init = {}) {
  return json(data, {
    ...init,
    headers: {
      'cache-control': 'no-store, max-age=0',
      'x-robots-tag': 'noindex',
      ...(init.headers || {}),
    },
  });
}

function safeTicker(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '').slice(0, 16);
}

function cleanNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function kvGet(env, key) {
  try {
    return env.FUND_CACHE ? await env.FUND_CACHE.get(key) : null;
  } catch {
    return null;
  }
}

async function kvPut(env, key, value, ttl) {
  try {
    if (env.FUND_CACHE) await env.FUND_CACHE.put(key, value, { expirationTtl: ttl });
  } catch {
    // Cache writes should never break the endpoint.
  }
}

function setCookieValue(headers, name) {
  const raw = headers.get('set-cookie') || '';
  const match = raw.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : '';
}

async function fetchProviderAuth() {
  const cookieRes = await fetch('https://fc.yahoo.com', {
    method: 'HEAD',
    headers: { 'user-agent': PROVIDER_UA },
  });
  const cookie = setCookieValue(cookieRes.headers, 'A3');
  if (!cookie) throw new Error('Options auth unavailable');

  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { cookie, 'user-agent': PROVIDER_UA },
  });
  if (!crumbRes.ok) throw new Error(`Options auth ${crumbRes.status}`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.startsWith('{')) throw new Error('Options auth unavailable');
  return { cookie, crumb };
}

async function fetchOptionChain(ticker, auth, expiration = null) {
  const url = new URL(`https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}`);
  url.searchParams.set('crumb', auth.crumb);
  if (expiration != null) url.searchParams.set('date', String(expiration));
  const res = await fetch(url.toString(), {
    headers: {
      accept: 'application/json',
      cookie: auth.cookie,
      'user-agent': PROVIDER_UA,
    },
    cf: { cacheTtl: TTL.options, cacheEverything: true },
  });
  if (!res.ok) {
    const err = new Error(`Options provider ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  const error = body?.optionChain?.error || body?.finance?.error;
  if (error) throw new Error(error.description || error.code || 'Options unavailable');
  return body?.optionChain?.result?.[0] || null;
}

function isoDateFromSeconds(value) {
  const seconds = cleanNumber(value);
  return seconds == null ? '' : new Date(seconds * 1000).toISOString().slice(0, 10);
}

function latestSessionDate(rows) {
  let latest = '';
  for (const row of rows) {
    const ts = cleanNumber(row.lastTradeDate);
    if (ts == null) continue;
    const day = new Date(ts * 1000).toISOString().slice(0, 10);
    if (day > latest) latest = day;
  }
  return latest;
}

function tradeDirection(row) {
  const last = cleanNumber(row.lastPrice);
  const bid = cleanNumber(row.bid);
  const ask = cleanNumber(row.ask);
  if (last == null || bid == null || ask == null) return 'unknown';
  return Math.abs(last - ask) <= Math.abs(last - bid) ? 'buying' : 'selling';
}

function buildTone(rows) {
  if (!rows.length) return 'no notable flow';
  const callPremium = rows
    .filter((row) => row.type === 'CALL')
    .reduce((sum, row) => sum + row.volume * row.last * 100, 0);
  const putPremium = rows
    .filter((row) => row.type === 'PUT')
    .reduce((sum, row) => sum + row.volume * row.last * 100, 0);
  if (callPremium >= putPremium * 1.5) return 'bullish call flow';
  if (putPremium >= callPremium * 1.5) return 'put hedge / bearish flow';
  return 'mixed flow';
}

function normalizeRows(chains) {
  const rows = [];
  for (const chain of chains) {
    const options = chain?.options?.[0] || {};
    for (const [type, contracts] of [['CALL', options.calls || []], ['PUT', options.puts || []]]) {
      for (const contract of contracts) {
        const volume = cleanNumber(contract.volume);
        const oi = cleanNumber(contract.openInterest);
        const last = cleanNumber(contract.lastPrice);
        if (volume == null || oi == null || last == null || oi <= 0) continue;
        rows.push({
          ...contract,
          type,
          volume,
          openInterest: oi,
          lastPrice: last,
          expiration: isoDateFromSeconds(contract.expiration),
        });
      }
    }
  }
  const sessionDate = latestSessionDate(rows);
  const filtered = rows
    .filter((row) => {
      const tradeDate = isoDateFromSeconds(row.lastTradeDate);
      const volOi = row.volume / row.openInterest;
      return tradeDate === sessionDate
        && row.volume > 100
        && row.lastPrice > 1
        && row.lastPrice < 80
        && volOi > 1;
    })
    .map((row) => {
      const volOi = row.volume / row.openInterest;
      const score = row.volume * row.lastPrice * (row.volume / Math.max(row.openInterest, 50));
      return {
        type: row.type,
        contractSymbol: row.contractSymbol || '',
        strike: cleanNumber(row.strike),
        expiration: row.expiration,
        last: row.lastPrice,
        bid: cleanNumber(row.bid),
        ask: cleanNumber(row.ask),
        direction: tradeDirection(row),
        volume: Math.round(row.volume),
        openInterest: Math.round(row.openInterest),
        volOi,
        impliedVolatility: cleanNumber(row.impliedVolatility),
        lastTradeDate: row.lastTradeDate ? new Date(row.lastTradeDate * 1000).toISOString() : null,
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return { rows: filtered, sessionDate };
}

async function buildOptionsActivity(ticker, env) {
  const block = await kvGet(env, 'options:blocked_until');
  if (block && Number(block) > Date.now()) throw new Error('Options refresh deferred');

  const auth = await fetchProviderAuth();
  const first = await fetchOptionChain(ticker, auth);
  if (!first) throw new Error('No options chain available');

  const expirations = (first.expirationDates || []).filter((value) => cleanNumber(value) != null);
  const now = Date.now() / 1000;
  const cutoff = now + 90 * 24 * 60 * 60;
  const near = expirations.filter((value) => value <= cutoff).slice(0, 6);
  const far = expirations.filter((value) => value > cutoff).slice(0, 2);
  const selected = [...new Set([first.options?.[0]?.expirationDate, ...near, ...far].filter((value) => value != null))];

  const rest = await Promise.allSettled(
    selected
      .filter((expiration) => expiration !== first.options?.[0]?.expirationDate)
      .map((expiration) => fetchOptionChain(ticker, auth, expiration))
  );
  const chains = [
    first,
    ...rest.filter((item) => item.status === 'fulfilled' && item.value).map((item) => item.value),
  ];
  const { rows, sessionDate } = normalizeRows(chains);
  return {
    success: true,
    ticker,
    currentPrice: cleanNumber(first.quote?.regularMarketPrice),
    tone: buildTone(rows),
    sessionDate,
    latestTrade: rows.map((row) => row.lastTradeDate).filter(Boolean).sort().at(-1) || null,
    data: rows,
    source: 'Options chain data',
    cacheTtlSeconds: TTL.options,
    asOf: new Date().toISOString(),
    note: 'Delayed/experimental options flow; unusual activity is context, not a buy/sell signal.',
  };
}

export async function onRequestGet(context) {
  const { params, env } = context;
  const ticker = safeTicker(params.ticker);
  if (!ticker) return json({ success: false, error: 'ticker required' }, { status: 400 });

  const cacheKey = `options:activity:${ticker}:v2`;
  const cached = await kvGet(env, cacheKey);
  if (cached) {
    try {
      return json({ ...JSON.parse(cached), cache: 'hit' });
    } catch {
      // Ignore bad cache and refresh.
    }
  }

  try {
    const data = await buildOptionsActivity(ticker, env);
    await kvPut(env, cacheKey, JSON.stringify(data), TTL.options);
    return json({ ...data, cache: 'miss' });
  } catch (err) {
    if ([403, 429, 500, 502, 503, 504].includes(err.status)) {
      await kvPut(env, 'options:blocked_until', String(Date.now() + TTL.blocked * 1000), TTL.blocked);
    }
    return uncachedJson({
      success: false,
      ticker,
      error: 'Options activity unavailable',
      detail: err.message || 'upstream unavailable',
      data: [],
      asOf: new Date().toISOString(),
    }, { status: 502 });
  }
}
