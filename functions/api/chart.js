const ALLOWED_SYMBOLS = new Set([
  'QQQ', 'SPY', 'IWM', 'TLT', 'UUP', 'USO', 'GLD', 'COPX', '^VIX', 'ES=F', 'YM=F', 'NQ=F',
]);

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=30, s-maxage=30',
      ...(init.headers || {}),
    },
  });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();

  if (!ALLOWED_SYMBOLS.has(symbol)) {
    return json({ error: 'symbol not allowed' }, { status: 400 });
  }

  const isFuture = symbol.endsWith('=F');
  const range = isFuture ? '1d' : '5d';
  const interval = isFuture ? '1m' : '1d';
  const yahoo = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=true`;
  const res = await fetch(yahoo, {
    headers: {
      'accept': 'application/json',
      'user-agent': 'Mozilla/5.0 fin-news-sweep',
    },
    cf: { cacheTtl: 30, cacheEverything: true },
  });

  if (!res.ok) {
    return json({ error: 'upstream failed', status: res.status }, { status: 502 });
  }

  const obj = await res.json();
  const result = obj?.chart?.result?.[0];
  const meta = result?.meta || {};
  const closes = (result?.indicators?.quote?.[0]?.close || []).filter(Number.isFinite);
  const last = Number(meta.regularMarketPrice ?? closes.at(-1));
  // For stocks/ETFs, chartPreviousClose on range=5d is the close before the
  // requested range, so use the last two daily closes. For futures, use a 1d
  // intraday chart where Yahoo exposes the prior settlement as previousClose.
  const prev = Number(
    isFuture
      ? (meta.previousClose ?? meta.chartPreviousClose)
      : (closes.length >= 2 ? closes.at(-2) : undefined)
  );

  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) {
    return json({ error: 'bad upstream data' }, { status: 502 });
  }

  return json({
    symbol,
    last,
    prev,
    move: ((last - prev) / prev) * 100,
    asOf: new Date().toISOString(),
  });
}
