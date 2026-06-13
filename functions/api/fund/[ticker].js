const SEC_UA = 'OpenClaw fin-new-sweep fund endpoint; contact: vjshrike';
const YAHOO_UA = 'Mozilla/5.0 fin-new-sweep fund endpoint';

const TTL = {
  rendered: 6 * 60 * 60,
  chart: 30 * 60,
  cikMap: 30 * 24 * 60 * 60,
  companyfacts: 14 * 24 * 60 * 60,
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

function text(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=300',
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

function moneyB(value) {
  return value == null ? '--' : `$${(value / 1_000_000_000).toFixed(1)} Bil`;
}

function sharesK(value) {
  return value == null ? '--' : `${(value / 1_000_000).toFixed(1)}K`;
}

function pctChange(curr, prev, positiveBaseRequired = false) {
  if (curr == null || prev == null || prev === 0) return '';
  if (positiveBaseRequired && (prev <= 0 || curr < 0)) return 'NM';
  const pct = ((curr / prev) - 1) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
}

function truncate(value, maxLen) {
  const textValue = String(value || '').replace(/\s+/g, ' ').trim();
  if (textValue.length <= maxLen) return textValue;
  return `${textValue.slice(0, Math.max(0, maxLen - 3)).trim()}...`;
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

async function cachedJson(env, key, ttl, fetcher) {
  const cached = await kvGet(env, key);
  if (cached) {
    try {
      return { data: JSON.parse(cached), cache: 'hit' };
    } catch {
      // Ignore bad cache entries and refresh.
    }
  }

  const data = await fetcher();
  await kvPut(env, key, JSON.stringify(data), ttl);
  return { data, cache: 'miss' };
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const err = new Error(`upstream ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function loadCikMap(request, env) {
  return cachedJson(env, 'sec:cik-map:v1', TTL.cikMap, async () => {
    const url = new URL('/company_tickers.json', request.url);
    return fetchJson(url.toString(), { cf: { cacheTtl: TTL.cikMap, cacheEverything: true } });
  });
}

async function fetchChart(ticker, env) {
  const block = await kvGet(env, 'yahoo:blocked_until');
  if (block && Number(block) > Date.now()) {
    throw new Error('Yahoo refresh deferred');
  }

  try {
    return await cachedJson(env, `yahoo:chart:${ticker}:v1`, TTL.chart, async () => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`;
      return fetchJson(url, {
        headers: { accept: 'application/json', 'user-agent': YAHOO_UA },
        cf: { cacheTtl: TTL.chart, cacheEverything: true },
      });
    });
  } catch (err) {
    if ([403, 429, 500, 502, 503, 504].includes(err.status)) {
      await kvPut(env, 'yahoo:blocked_until', String(Date.now() + TTL.blocked * 1000), TTL.blocked);
    }
    throw err;
  }
}

async function fetchCompanyfacts(cik, env) {
  return cachedJson(env, `sec:companyfacts:${cik}:v1`, TTL.companyfacts, async () => {
    const padded = String(cik).padStart(10, '0');
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`;
    return fetchJson(url, {
      headers: { accept: 'application/json', 'user-agent': SEC_UA },
      cf: { cacheTtl: TTL.companyfacts, cacheEverything: true },
    });
  });
}

function annualSecValues(companyfacts, tags, units) {
  const out = new Map();
  const facts = companyfacts?.facts?.['us-gaap'] || {};
  for (const tag of tags) {
    const item = facts[tag];
    if (!item) continue;
    for (const unit of units) {
      for (const fact of item.units?.[unit] || []) {
        if (fact.form !== '10-K' || fact.fp !== 'FY') continue;
        const val = cleanNumber(fact.val);
        if (val == null || !fact.end) continue;
        const year = Number(String(fact.end).slice(0, 4));
        if (!Number.isFinite(year)) continue;
        const filed = String(fact.filed || '');
        const existing = out.get(year);
        if (!existing || filed > existing.filed) out.set(year, { filed, val, tag });
      }
    }
  }
  return out;
}

function latestSecValue(companyfacts, tags, units) {
  let latest = null;
  const facts = companyfacts?.facts?.dei || {};
  for (const tag of tags) {
    const item = facts[tag];
    if (!item) continue;
    for (const unit of units) {
      for (const fact of item.units?.[unit] || []) {
        const val = cleanNumber(fact.val);
        if (val == null || !fact.end) continue;
        const end = String(fact.end);
        if (!latest || end > latest.end) latest = { end, val, tag };
      }
    }
  }
  return latest;
}

function chartMeta(chart) {
  return chart?.chart?.result?.[0]?.meta || {};
}

function buildRows(companyfacts, startYear) {
  const revenue = annualSecValues(
    companyfacts,
    ['Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerExcludingAssessedTax'],
    ['USD']
  );
  const eps = annualSecValues(
    companyfacts,
    ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'],
    ['USD/shares']
  );
  const years = new Set([...revenue.keys(), ...eps.keys()]);
  return [...years]
    .filter((year) => year >= startYear)
    .sort((a, b) => a - b)
    .map((year) => {
      const epsItem = eps.get(year);
      const revItem = revenue.get(year);
      return {
        year,
        eps: epsItem?.val ?? null,
        salesB: revItem?.val == null ? null : revItem.val / 1_000_000_000,
        estimated: false,
        epsSource: epsItem ? `SEC ${epsItem.tag}` : '',
        salesSource: revItem ? `SEC ${revItem.tag}` : '',
      };
    });
}

function renderFundTable(data) {
  const lines = [
    `${data.ticker} Fundamentals`,
    `${data.exchange || '--'} - ${data.industry || '--'}`,
    `${data.location || '--'} | ${data.phone || '--'}`,
    data.website || '--',
    truncate(data.summary || data.name || '', 145) || '--',
    '',
    `Market Capitalization: ${moneyB(data.marketCap)}`,
    `Shares in Float:     ${sharesK(data.floatShares)}`,
    `Shares Outstanding:  ${sharesK(data.sharesOutstanding)}`,
    `Short Interest:      ${data.shortInterest || '--'}`,
    '',
    'Caveat: historical EPS is GAAP diluted EPS from SEC-style data; screenshot-style adjusted EPS needs a separate source.',
    `Data as of: Yahoo chart ${data.asOf.yahooChart || 'n/a'}; SEC companyfacts ${data.asOf.secFacts || 'n/a'}; rendered ${data.asOf.rendered}`,
    data.warnings.length ? `Warnings: ${data.warnings.join('; ')}` : '',
    '',
    `${'Year'.padEnd(8)} ${'EPS'.padStart(8)} ${'% Chg'.padStart(7)} ${'Sales $B'.padStart(10)} ${'% Chg'.padStart(7)}  source`,
  ].filter((line, idx) => line || idx < 15);

  let prevEps = null;
  let prevSales = null;
  for (const row of data.rows) {
    const eps = row.eps == null ? '--' : row.eps.toFixed(2);
    const sales = row.salesB == null ? '--' : row.salesB.toFixed(2);
    const source = [row.epsSource, row.salesSource].filter(Boolean).join('/') || '--';
    lines.push(
      `${String(row.year).padEnd(8)} ${eps.padStart(8)} ${pctChange(row.eps, prevEps, true).padStart(7)} ${sales.padStart(10)} ${pctChange(row.salesB, prevSales).padStart(7)}  ${source}`
    );
    if (row.eps != null) prevEps = row.eps;
    if (row.salesB != null) prevSales = row.salesB;
  }
  return lines.join('\n');
}

async function buildFundamentals(ticker, request, env, startYear) {
  const warnings = [];
  const cikMapResult = await loadCikMap(request, env);
  const cik = cikMapResult.data[ticker];
  if (!cik) throw new Error(`No SEC CIK mapping for ${ticker}`);

  let chart = null;
  let chartCache = 'none';
  try {
    const chartResult = await fetchChart(ticker, env);
    chart = chartResult.data;
    chartCache = chartResult.cache;
  } catch (err) {
    warnings.push(`Yahoo chart unavailable: ${err.message}`);
  }

  const factsResult = await fetchCompanyfacts(cik, env);
  const facts = factsResult.data;
  const meta = chartMeta(chart);
  const shares = latestSecValue(facts, ['EntityCommonStockSharesOutstanding'], ['shares']);
  const price = cleanNumber(meta.regularMarketPrice);
  const sharesOutstanding = shares?.val ?? null;
  const marketCap = price != null && sharesOutstanding != null ? price * sharesOutstanding : null;

  return {
    ticker,
    cik: String(cik).padStart(10, '0'),
    name: meta.longName || meta.shortName || facts.entityName || ticker,
    exchange: meta.fullExchangeName || meta.exchangeName || '--',
    industry: '--',
    location: '--',
    phone: '--',
    website: '--',
    summary: facts.entityName || meta.longName || meta.shortName || ticker,
    price,
    marketCap,
    floatShares: null,
    sharesOutstanding,
    shortInterest: '--',
    rows: buildRows(facts, startYear),
    warnings,
    cache: {
      cikMap: cikMapResult.cache,
      yahooChart: chartCache,
      secCompanyfacts: factsResult.cache,
    },
    asOf: {
      yahooChart: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
      secFacts: shares?.end || null,
      rendered: new Date().toISOString(),
    },
  };
}

export async function onRequestGet(context) {
  const { params, request, env } = context;
  const ticker = safeTicker(params.ticker);
  const url = new URL(request.url);
  const format = url.searchParams.get('format') === 'json' ? 'json' : 'text';
  const startYear = Number(url.searchParams.get('startYear') || '2020');
  const minYear = Number.isFinite(startYear) ? Math.max(1990, Math.min(2100, startYear)) : 2020;

  if (!ticker) return json({ error: 'ticker required' }, { status: 400 });

  const renderKey = `fund:rendered:${ticker}:${minYear}:${format}:v2`;
  const cached = await kvGet(env, renderKey);
  if (cached) {
    return format === 'json' ? json(JSON.parse(cached)) : text(cached);
  }

  try {
    const data = await buildFundamentals(ticker, request, env, minYear);
    const body = format === 'json' ? data : renderFundTable(data);
    await kvPut(env, renderKey, format === 'json' ? JSON.stringify(body) : body, TTL.rendered);
    return format === 'json' ? json(body) : text(body);
  } catch (err) {
    const payload = { error: err.message || 'fundamentals unavailable', ticker };
    return format === 'json' ? json(payload, { status: 502 }) : text(`${ticker} fundamentals unavailable: ${payload.error}`, { status: 502 });
  }
}
