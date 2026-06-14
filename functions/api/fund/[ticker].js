const SEC_UA = 'fin-new-sweep/1.0 dealzen.km@gmail.com';
const YAHOO_UA = 'Mozilla/5.0 fin-new-sweep fund endpoint';

const TTL = {
  rendered: 6 * 60 * 60,
  chart: 30 * 60,
  cikMap: 30 * 24 * 60 * 60,
  companyfacts: 14 * 24 * 60 * 60,
  submissions: 14 * 24 * 60 * 60,
  businessDescription: 30 * 24 * 60 * 60,
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

function shares(value) {
  if (value == null) return '--';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} Bil`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} Mil`;
  return `${Math.round(value).toLocaleString()}`;
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

function wrapText(value, width = 76, indent = '') {
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.map((item, idx) => `${idx ? indent : ''}${item}`);
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;|&#8217;|&rsquo;/gi, "'")
    .replace(/&#8220;|&ldquo;/gi, '"')
    .replace(/&#8221;|&rdquo;/gi, '"')
    .replace(/&#8211;|&ndash;/gi, '-')
    .replace(/&#8212;|&mdash;/gi, '-')
    .replace(/&#(\d+);/g, (_, code) => {
      const num = Number(code);
      return Number.isFinite(num) ? String.fromCharCode(num) : '';
    });
}

function cleanHtmlText(html) {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function locationFromSubmission(submission) {
  const address = submission?.addresses?.business || submission?.addresses?.mailing || {};
  return [address.city, address.stateOrCountryDescription || address.stateOrCountry]
    .filter(Boolean)
    .join(', ') || '--';
}

function latestAnnualFiling(submission) {
  const recent = submission?.filings?.recent || {};
  const forms = recent.form || [];
  for (let i = 0; i < forms.length; i += 1) {
    if (forms[i] !== '10-K') continue;
    if (!recent.accessionNumber?.[i] || !recent.primaryDocument?.[i]) continue;
    return {
      form: forms[i],
      accessionNumber: recent.accessionNumber[i],
      primaryDocument: recent.primaryDocument[i],
      filingDate: recent.filingDate?.[i] || '',
    };
  }
  return null;
}

function trimBusinessDescription(segment) {
  let textValue = segment
    .replace(/^item\s+1\.?\s+business\s*/i, '')
    .replace(/^(general|overview|our company)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const sentenceMatches = textValue.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [];
  if (sentenceMatches.length) {
    textValue = sentenceMatches.slice(0, 3).join(' ').trim();
  }
  return truncate(textValue, 700);
}

function extractBusinessDescription(html) {
  const textValue = cleanHtmlText(html);
  const starts = [...textValue.matchAll(/item\s+1\.?\s+business/gi)].map((match) => match.index);
  const ends = [...textValue.matchAll(/item\s+1a\.?\s+risk\s+factors/gi)].map((match) => match.index);
  const candidates = [];

  for (const start of starts) {
    const end = ends.find((idx) => idx > start) || Math.min(textValue.length, start + 100000);
    const segment = textValue.slice(start, end);
    if (segment.length < 1200 || segment.length > 120000) continue;
    if (/item\s+1\.?\s+business\s*["'.]*\s*\d+\s+item\s+3/i.test(segment.slice(0, 180))) continue;
    if (/item\s+1\.?\s+business\s*["'.]*\s+above contains/i.test(segment.slice(0, 180))) continue;
    candidates.push(segment);
  }

  if (!candidates.length) return '';
  return trimBusinessDescription(candidates[0]);
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

async function fetchSubmissions(cik, env) {
  return cachedJson(env, `sec:submissions:${cik}:v1`, TTL.submissions, async () => {
    const padded = String(cik).padStart(10, '0');
    const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
    return fetchJson(url, {
      headers: { accept: 'application/json', 'user-agent': SEC_UA },
      cf: { cacheTtl: TTL.submissions, cacheEverything: true },
    });
  });
}

async function fetchBusinessDescription(cik, submission, env) {
  const filing = latestAnnualFiling(submission);
  if (!filing) return { data: { summary: '', filingDate: '' }, cache: 'none' };

  return cachedJson(env, `sec:business-description:${cik}:${filing.accessionNumber}:v1`, TTL.businessDescription, async () => {
    const accession = filing.accessionNumber.replace(/-/g, '');
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/${filing.primaryDocument}`;
    const res = await fetch(url, {
      headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': SEC_UA },
      cf: { cacheTtl: TTL.businessDescription, cacheEverything: true },
    });
    if (!res.ok) {
      const err = new Error(`SEC filing ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const html = await res.text();
    return {
      summary: extractBusinessDescription(html),
      filingDate: filing.filingDate,
      source: `${filing.form} ${filing.filingDate || filing.accessionNumber}`,
    };
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
  const description = truncate(data.summary || data.name || '', 520) || '--';
  const sourceBits = [
    data.asOf.yahooChart ? `Yahoo ${data.asOf.yahooChart.slice(0, 10)}` : '',
    data.asOf.secFacts ? `SEC facts ${data.asOf.secFacts}` : '',
    data.summarySource ? `desc ${data.summarySource}` : '',
  ].filter(Boolean);
  const lines = [
    `${data.ticker} Fundamentals`,
    data.name && data.name !== data.ticker ? data.name : '',
    `${data.exchange || '--'} - ${data.industry || '--'}`,
    `${data.location || '--'} | ${data.phone || '--'}`,
    data.website && data.website !== '--' ? data.website : '',
    '',
    'Description',
    ...wrapText(description, 76),
    '',
    `Market Capitalization: ${moneyB(data.marketCap)}`,
    `Shares in Float:     ${shares(data.floatShares)}`,
    `Shares Outstanding:  ${shares(data.sharesOutstanding)}`,
    `Short Interest:      ${data.shortInterest || '--'}`,
    '',
    sourceBits.length ? `Data: ${sourceBits.join('; ')}` : '',
    'Note: EPS is GAAP diluted EPS from SEC data, not adjusted analyst EPS.',
    data.warnings.length ? `Warnings: ${data.warnings.join('; ')}` : '',
    '',
    `${'Year'.padEnd(6)} ${'EPS'.padStart(8)} ${'EPS %'.padStart(7)} ${'Sales $B'.padStart(10)} ${'Sales %'.padStart(8)}`,
    `${'-'.repeat(6)} ${'-'.repeat(8)} ${'-'.repeat(7)} ${'-'.repeat(10)} ${'-'.repeat(8)}`,
  ].filter((line, idx) => line || idx < 15);

  let prevEps = null;
  let prevSales = null;
  for (const row of data.rows) {
    const eps = row.eps == null ? '--' : row.eps.toFixed(2);
    const sales = row.salesB == null ? '--' : row.salesB.toFixed(2);
    lines.push(
      `${String(row.year).padEnd(6)} ${eps.padStart(8)} ${pctChange(row.eps, prevEps, true).padStart(7)} ${sales.padStart(10)} ${pctChange(row.salesB, prevSales).padStart(8)}`
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
  const submissionsResult = await fetchSubmissions(cik, env);
  const submission = submissionsResult.data;
  let descriptionResult = { data: { summary: '', filingDate: '' }, cache: 'none' };
  try {
    descriptionResult = await fetchBusinessDescription(cik, submission, env);
  } catch (err) {
    warnings.push(`SEC business description unavailable: ${err.message}`);
  }
  const meta = chartMeta(chart);
  const shares = latestSecValue(facts, ['EntityCommonStockSharesOutstanding'], ['shares']);
  const price = cleanNumber(meta.regularMarketPrice);
  const sharesOutstanding = shares?.val ?? null;
  const marketCap = price != null && sharesOutstanding != null ? price * sharesOutstanding : null;
  const industry = submission.sicDescription || '--';
  const summary = descriptionResult.data.summary || submission.description || `${submission.name || facts.entityName || ticker} is an SEC filer in ${industry}.`;

  return {
    ticker,
    cik: String(cik).padStart(10, '0'),
    name: meta.longName || meta.shortName || submission.name || facts.entityName || ticker,
    exchange: meta.fullExchangeName || meta.exchangeName || submission.exchanges?.[0] || '--',
    industry,
    location: locationFromSubmission(submission),
    phone: submission.phone || '--',
    website: submission.website || submission.investorWebsite || '--',
    summary,
    summarySource: descriptionResult.data.source || (submission.description ? 'SEC submissions' : 'SEC profile fallback'),
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
      secSubmissions: submissionsResult.cache,
      secBusinessDescription: descriptionResult.cache,
    },
    asOf: {
      yahooChart: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
      secFacts: shares?.end || null,
      secProfile: descriptionResult.data.filingDate || null,
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

  const renderKey = `fund:rendered:${ticker}:${minYear}:${format}:v4`;
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
