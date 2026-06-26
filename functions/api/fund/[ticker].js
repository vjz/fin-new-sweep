const SEC_UA = 'fin-new-sweep/1.0 dealzen.km@gmail.com';
const YAHOO_UA = 'Mozilla/5.0 fin-new-sweep fund endpoint';
const SEC_COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';

const TTL = {
  rendered: 5 * 60,
  chart: 5 * 60,
  cikMap: 30 * 24 * 60 * 60,
  companyfacts: 14 * 24 * 60 * 60,
  submissions: 14 * 24 * 60 * 60,
  businessDescription: 30 * 24 * 60 * 60,
  blocked: 15 * 60,
};

const QUALITY_DEFAULTS = {
  NVDA: 1.30,
  MRVL: 1.10,
  MU: 1.00,
  SNDK: 1.00,
  DELL: 0.45,
  SSNLF: 0.65,
};

const DURABILITY_DEFAULTS = {
  NVDA: 1.25,
  MU: 1.00,
  MRVL: 1.00,
  SNDK: 0.75,
  DELL: 0.75,
  SSNLF: 0.75,
};

const DURABILITY_CASES = [
  { multiplier: 0.50, label: 'obvious peak cycle' },
  { multiplier: 0.75, label: 'strong but cyclical' },
  { multiplier: 1.00, label: 'durable 2-3 year setup' },
  { multiplier: 1.25, label: 'structural scarcity' },
];

const ANNUAL_FORMS = new Set(['10-K', '20-F']);
const INTERIM_FORMS = new Set(['10-Q', '6-K']);

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
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function moneyB(value) {
  return value == null ? '--' : `$${(value / 1_000_000_000).toFixed(1)} Bil`;
}

function compactMoney(value) {
  if (value == null) return '--';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(value).toLocaleString()}`;
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

function pctChangeValue(curr, prev, positiveBaseRequired = false) {
  if (curr == null || prev == null || prev === 0) return null;
  if (positiveBaseRequired && (prev <= 0 || curr < 0)) return 'NM';
  return ((curr / prev) - 1) * 100;
}

function formatChangeValue(value) {
  if (value == null) return '--';
  if (value === 'NM') return 'NM';
  return `${value >= 0 ? '+' : ''}${value.toFixed(0)}%`;
}

function formatNumber(value, digits = 1) {
  return value == null ? '--' : value.toFixed(digits);
}

function formatPct(value) {
  return value == null ? '--' : `${value >= 0 ? '+' : ''}${value.toFixed(0)}%`;
}

function formatUnsignedPct(value) {
  return value == null ? '--' : `${value.toFixed(0)}%`;
}

function formatPrice(value) {
  return value == null ? '--' : `$${value.toFixed(value >= 100 ? 2 : 2)}`;
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
    if (!ANNUAL_FORMS.has(forms[i])) continue;
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

function dropDescriptionBoilerplate(textValue) {
  let value = String(textValue || '').replace(/\s+/g, ' ').trim();
  const opening = value.slice(0, 2500);
  if (/forward-looking statements|actual results and outcomes may differ materially|actual results may differ materially/i.test(opening)) {
    value = value
      .replace(/^.*?\bRisk Factors\.\s*/i, '')
      .replace(/^As used herein,.*?context indicates otherwise\.\s*/i, '');
    const heading = value.match(/\b(?:General|Overview|Business Overview|Our Company|Company Overview)\s+(?=(?:We|Our|The Company|Amazon\.com|[A-Z][a-z]+)\b)/i);
    if (heading?.index != null && heading.index < 1200) value = value.slice(heading.index);
  }
  return value.replace(/^As used herein,.*?context indicates otherwise\.\s*/i, '').trim();
}

function trimBusinessDescription(segment) {
  let textValue = dropDescriptionBoilerplate(segment)
    .replace(/^item\s+1\.?\s+business\s*/i, '')
    .replace(/^item\s+4\.?\s+information\s+on\s+the\s+company\s*/i, '')
    .replace(/^business\s+overview\s*/i, '')
    .replace(/^company\s+overview\s*/i, '')
    .replace(/^industry\s+background\s*/i, '')
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
  const overviewStarts = [...textValue.matchAll(/business\s+overview(?:\s+industry\s+background)?/gi)]
    .map((match) => match.index)
    .filter((idx) => {
      const snippet = textValue.slice(idx, idx + 240);
      return !/legal\s+proceedings|research\s+and\s+development|intellectual\s+property|item\s+5/i.test(snippet);
    });
  const starts = [
    ...overviewStarts.map((idx) => ({ idx, preferred: true })),
    ...[...textValue.matchAll(/item\s+1\.?\s+business/gi)].map((match) => match.index),
    ...[...textValue.matchAll(/item\s+4\.?\s+information\s+on\s+the\s+company/gi)].map((match) => match.index),
  ]
    .map((entry) => (typeof entry === 'number' ? { idx: entry, preferred: false } : entry))
    .sort((a, b) => {
      if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
      return a.idx - b.idx;
    });
  const ends = [
    ...[...textValue.matchAll(/research\s+and\s+development/gi)].map((match) => match.index),
    ...[...textValue.matchAll(/intellectual\s+property/gi)].map((match) => match.index),
    ...[...textValue.matchAll(/item\s+1a\.?\s+risk\s+factors/gi)].map((match) => match.index),
    ...[...textValue.matchAll(/item\s+4a\.?\s+unresolved\s+staff\s+comments/gi)].map((match) => match.index),
    ...[...textValue.matchAll(/item\s+5\.?\s+operating\s+and\s+financial\s+review/gi)].map((match) => match.index),
  ].sort((a, b) => a - b);
  const candidates = [];

  for (const start of starts) {
    const end = ends.find((idx) => idx > start.idx) || Math.min(textValue.length, start.idx + 100000);
    const segment = textValue.slice(start.idx, end);
    if (segment.length < 1200 || segment.length > 120000) continue;
    if (/item\s+1\.?\s+business\s*["'.]*\s*\d+\s+item\s+3/i.test(segment.slice(0, 180))) continue;
    if (/item\s+1\.?\s+business\s*["'.]*\s+above contains/i.test(segment.slice(0, 180))) continue;
    if (/item\s+4\.?\s+information\s+on\s+the\s+company\s+\d+\s+item\s+4a/i.test(segment.slice(0, 180))) continue;
    if (/companies\s+act|legal\s+proceedings/i.test(segment.slice(0, 240))) continue;
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
  return cachedJson(env, 'sec:cik-map:v2', TTL.cikMap, async () => {
    const url = new URL('/company_tickers.json', request.url);
    return fetchJson(url.toString(), { cf: { cacheTtl: TTL.cikMap, cacheEverything: true } });
  });
}

function normalizeCikMap(data) {
  const out = {};
  for (const value of Object.values(data || {})) {
    if (!value || typeof value !== 'object') continue;
    const ticker = safeTicker(value.ticker);
    const cik = value.cik_str;
    if (ticker && cik != null) out[ticker] = String(cik).padStart(10, '0');
  }
  return out;
}

async function loadLiveCikMap(env) {
  return cachedJson(env, 'sec:cik-map-live:v1', TTL.cikMap, async () => {
    const data = await fetchJson(SEC_COMPANY_TICKERS_URL, {
      headers: { accept: 'application/json', 'user-agent': SEC_UA },
      cf: { cacheTtl: TTL.cikMap, cacheEverything: true },
    });
    return normalizeCikMap(data);
  });
}

async function resolveCik(ticker, request, env, warnings) {
  let cikMapResult = { data: {}, cache: 'unavailable' };
  try {
    cikMapResult = await loadCikMap(request, env);
  } catch (err) {
    warnings.push(`Local SEC CIK map unavailable: ${err.message}`);
  }
  let cik = cikMapResult.data[ticker];
  if (cik) {
    return { cik, cache: cikMapResult.cache };
  }

  let liveCikMapResult = { data: {}, cache: 'unavailable' };
  try {
    liveCikMapResult = await loadLiveCikMap(env);
  } catch (err) {
    warnings.push(`Live SEC CIK map unavailable: ${err.message}`);
  }
  cik = liveCikMapResult.data[ticker];
  if (cik) {
    warnings.push(`CIK resolved from live SEC ticker map: ${liveCikMapResult.cache}`);
    return { cik, cache: liveCikMapResult.cache };
  }

  warnings.push(`No SEC CIK mapping for ${ticker}; SEC-backed financial fields are unavailable.`);
  return { cik: null, cache: liveCikMapResult.cache, missing: true };
}

async function fetchChart(ticker, env, range = '5d') {
  const block = await kvGet(env, 'yahoo:blocked_until');
  if (block && Number(block) > Date.now()) {
    throw new Error('Yahoo refresh deferred');
  }

  try {
    return await cachedJson(env, `yahoo:chart:${ticker}:${range}:v1`, TTL.chart, async () => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${encodeURIComponent(range)}&interval=1d`;
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

  return cachedJson(env, `sec:business-description:${cik}:${filing.accessionNumber}:v3`, TTL.businessDescription, async () => {
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
        if (!ANNUAL_FORMS.has(fact.form) || fact.fp !== 'FY') continue;
        const val = cleanNumber(fact.val);
        if (val == null || !fact.end) continue;
        const year = Number(String(fact.end).slice(0, 4));
        if (!Number.isFinite(year)) continue;
        const filed = String(fact.filed || '');
        const existing = out.get(year);
        if (!existing || filed > existing.filed) out.set(year, { filed, val, tag, form: fact.form });
      }
    }
  }
  return out;
}

function secValues(companyfacts, namespace, tags, units) {
  const out = [];
  const facts = companyfacts?.facts?.[namespace] || {};
  for (const tag of tags) {
    const item = facts[tag];
    if (!item) continue;
    for (const unit of units) {
      for (const fact of item.units?.[unit] || []) {
        const val = cleanNumber(fact.val);
        if (val == null || !fact.end) continue;
        out.push({ ...fact, val, tag, unit });
      }
    }
  }
  return out;
}

function latestSecValue(companyfacts, tags, units, namespace = 'dei') {
  let latest = null;
  for (const fact of secValues(companyfacts, namespace, tags, units)) {
    const end = String(fact.end);
    if (!latest || end > latest.end) latest = { end, val: fact.val, tag: fact.tag, form: fact.form, fp: fact.fp };
  }
  return latest;
}

function chartMeta(chart) {
  return chart?.chart?.result?.[0]?.meta || {};
}

function chartCloses(chart) {
  return chartBars(chart).map(({ ts, close }) => ({ ts, close }));
}

function chartBars(chart) {
  const result = chart?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];
  return timestamps
    .map((ts, idx) => ({
      ts,
      open: cleanNumber(opens[idx]),
      high: cleanNumber(highs[idx]),
      low: cleanNumber(lows[idx]),
      close: cleanNumber(closes[idx]),
      volume: cleanNumber(volumes[idx]),
    }))
    .filter((point) => point.close != null)
    .sort((a, b) => a.ts - b.ts);
}

function trailingReturn(points, days) {
  if (!points.length) return null;
  const last = points.at(-1);
  const target = last.ts - days * 24 * 60 * 60;
  let base = points[0];
  for (const point of points) {
    if (point.ts <= target) base = point;
    else break;
  }
  if (!base?.close || !last?.close || base.close === 0 || base.ts === last.ts) return null;
  return ((last.close / base.close) - 1) * 100;
}

function buildRelativeStrength(chart, benchmarkChart) {
  const stock = chartCloses(chart);
  const benchmark = chartCloses(benchmarkChart);
  return [
    { label: '3M', stockReturn: trailingReturn(stock, 63), benchmarkReturn: trailingReturn(benchmark, 63) },
    { label: '6M', stockReturn: trailingReturn(stock, 126), benchmarkReturn: trailingReturn(benchmark, 126) },
    { label: '12M', stockReturn: trailingReturn(stock, 252), benchmarkReturn: trailingReturn(benchmark, 252) },
  ].map((row) => ({
    ...row,
    relativeReturn: row.stockReturn == null || row.benchmarkReturn == null ? null : row.stockReturn - row.benchmarkReturn,
  }));
}

function buildQuote(meta, chart) {
  const closes = chartCloses(chart);
  const latestClose = closes.at(-1)?.close ?? null;
  const priorClose = closes.length > 1 ? closes.at(-2)?.close ?? null : null;
  const price = cleanNumber(meta.regularMarketPrice);
  const quotePrice = price ?? latestClose;
  const previousClose = priorClose ?? cleanNumber(meta.previousClose ?? meta.chartPreviousClose);
  const change = quotePrice == null || previousClose == null ? null : quotePrice - previousClose;
  const changePct = change == null || previousClose === 0 ? null : (change / previousClose) * 100;
  return {
    price: quotePrice,
    previousClose,
    change,
    changePct,
    currency: meta.currency || '',
    marketState: meta.marketState || '',
    exchangeTimezoneName: meta.exchangeTimezoneName || '',
    regularMarketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    source: 'Yahoo chart metadata / daily close',
    cacheTtlSeconds: TTL.chart,
  };
}

function buildTradingStats(meta, chart, price) {
  const latestPrice = price ?? cleanNumber(meta.regularMarketPrice);
  const weekHigh = cleanNumber(meta.fiftyTwoWeekHigh);
  const weekLow = cleanNumber(meta.fiftyTwoWeekLow);
  const regularMarketTime = cleanNumber(meta.regularMarketTime);
  const regularMarketDate = regularMarketTime == null ? '' : new Date(regularMarketTime * 1000).toISOString().slice(0, 10);
  const rangePct = latestPrice == null || weekHigh == null || weekLow == null || weekHigh === weekLow
    ? null
    : ((latestPrice - weekLow) / (weekHigh - weekLow)) * 100;
  const offHighPct = latestPrice == null || weekHigh == null || weekHigh === 0
    ? null
    : ((latestPrice / weekHigh) - 1) * 100;
  const todayVolume = cleanNumber(meta.regularMarketVolume);
  const volumeBars = chartBars(chart)
    .filter((point) => point.volume != null && point.volume > 0)
    .filter((point) => !regularMarketDate || new Date(point.ts * 1000).toISOString().slice(0, 10) !== regularMarketDate)
    .slice(-30)
    .map((point) => point.volume);
  const avgVolume30d = volumeBars.length
    ? volumeBars.reduce((sum, value) => sum + value, 0) / volumeBars.length
    : null;
  const volumeRatio30d = todayVolume == null || avgVolume30d == null || avgVolume30d === 0
    ? null
    : todayVolume / avgVolume30d;

  return {
    fiftyTwoWeekHigh: weekHigh,
    fiftyTwoWeekLow: weekLow,
    fiftyTwoWeekRangePct: rangePct,
    offFiftyTwoWeekHighPct: offHighPct,
    todayVolume,
    avgVolume30d,
    volumeRatio30d,
    avgVolumeDays: volumeBars.length,
  };
}

function movingAverage(points, index, days) {
  if (index + 1 < days) return null;
  const slice = points.slice(index + 1 - days, index + 1);
  if (slice.length !== days || slice.some((point) => point.close == null)) return null;
  return slice.reduce((sum, point) => sum + point.close, 0) / days;
}

function buildBaseLocator(enriched) {
  const bars = enriched
    .map((bar, index) => ({ ...bar, index }))
    .filter((bar) => bar.high != null && bar.low != null && bar.close != null);
  if (bars.length < 20) return { bases: [], settings: { minBars: 15, maxBars: 99 } };

  const minBars = 15;
  const maxBars = 99;
  const visibleStart = Math.max(0, enriched.length - 126);
  const latest = bars.at(-1);

  const scoreCandidate = (start, end, active = false) => {
    const slice = enriched.slice(start, end + 1)
      .map((bar, index) => ({ ...bar, index: start + index }))
      .filter((bar) => bar.high != null && bar.low != null && bar.close != null);
    if (slice.length < minBars) return null;

    const highBar = slice.reduce((best, bar) => (bar.high > best.high ? bar : best), slice[0]);
    const lowBar = slice.reduce((best, bar) => (bar.low < best.low ? bar : best), slice[0]);
    const pivot = highBar.high;
    const support = lowBar.low;
    if (!pivot || !support || support <= 0 || pivot <= support) return null;

    const depthPct = ((pivot / support) - 1) * 100;
    const latestClose = latest?.close ?? slice.at(-1)?.close;
    if (depthPct > 38 || latestClose == null) return null;

    const agePenalty = Math.max(0, end - highBar.index - 8) * 0.08;
    const depthScore = Math.max(0, 38 - depthPct);
    const lengthScore = Math.min(35, slice.length * 0.45);
    const lateBreakout = latestClose > pivot * 1.08;
    const activeFit = active && latestClose >= support * 0.96 && latestClose <= pivot * 1.08;
    const score = lengthScore + depthScore - agePenalty + (activeFit ? 10 : 0) - (lateBreakout ? 20 : 0);

    let status = 'needs handle';
    if (latestClose > pivot * 1.05) status = 'extended';
    else if (latestClose >= pivot * 0.95) status = 'actionable now';

    return {
      startDate: slice[0].date,
      endDate: enriched[end]?.date || slice.at(-1).date,
      pivot,
      support,
      midpoint: (pivot + support) / 2,
      depthPct,
      bars: slice.length,
      status,
      active,
      score,
    };
  };

  let activeBase = null;
  const activeEnd = enriched.length - 1;
  for (let length = minBars; length <= Math.min(maxBars, enriched.length); length += 1) {
    const candidate = scoreCandidate(activeEnd - length + 1, activeEnd, true);
    if (candidate && (!activeBase || candidate.score > activeBase.score)) activeBase = candidate;
  }

  const completed = [];
  for (let end = visibleStart + minBars; end < enriched.length - 5; end += 1) {
    const candidate = scoreCandidate(Math.max(0, end - 44), end, false);
    const nextClose = enriched[end + 1]?.close;
    if (!candidate || nextClose == null || nextClose < candidate.pivot * 1.02) continue;
    const overlaps = completed.some((base) => Math.abs(new Date(base.endDate) - new Date(candidate.endDate)) < 12 * 24 * 60 * 60 * 1000);
    if (!overlaps) completed.push({ ...candidate, breakoutDate: enriched[end + 1]?.date, status: 'completed' });
  }

  const bases = [
    ...completed.slice(-2),
    ...(activeBase ? [activeBase] : []),
  ].map(({ score, ...base }) => base);

  return { bases, settings: { minBars, maxBars } };
}

function buildTechnicalChart(chart, benchmarkChart) {
  const bars = chartBars(chart);
  const stock = bars.map(({ ts, close }) => ({ ts, close }));
  if (stock.length < 20) return { available: false, points: [] };

  const benchmark = chartCloses(benchmarkChart);
  const benchmarkByTs = new Map(benchmark.map((point) => [point.ts, point.close]));
  const enriched = bars.map((bar, index) => ({
    date: new Date(bar.ts * 1000).toISOString().slice(0, 10),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    ma50: movingAverage(stock, index, 50),
    ma200: movingAverage(stock, index, 200),
    benchmarkClose: benchmarkByTs.get(bar.ts) ?? null,
  }));
  const points = enriched.slice(-126);
  const latest = enriched.at(-1) || null;
  const first = points[0] || null;
  const benchmarkFirst = points.find((point) => point.benchmarkClose != null);
  const benchmarkLast = [...points].reverse().find((point) => point.benchmarkClose != null);
  const stockReturn = first?.close && latest?.close ? ((latest.close / first.close) - 1) * 100 : null;
  const benchmarkReturn = benchmarkFirst?.benchmarkClose && benchmarkLast?.benchmarkClose
    ? ((benchmarkLast.benchmarkClose / benchmarkFirst.benchmarkClose) - 1) * 100
    : null;

  return {
    available: points.length >= 20,
    range: '6M',
    points: points.map(({ date, open, high, low, close, ma50, ma200 }) => ({ date, open, high, low, close, ma50, ma200 })),
    baseLocator: buildBaseLocator(enriched),
    latest: latest ? {
      date: latest.date,
      close: latest.close,
      ma50: latest.ma50,
      ma200: latest.ma200,
      above50d: latest.ma50 == null ? null : latest.close >= latest.ma50,
      above200d: latest.ma200 == null ? null : latest.close >= latest.ma200,
      stockReturn,
      benchmarkReturn,
      relativeReturn: stockReturn == null || benchmarkReturn == null ? null : stockReturn - benchmarkReturn,
    } : null,
  };
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
        epsSource: epsItem ? `SEC ${epsItem.form} ${epsItem.tag}` : '',
        salesSource: revItem ? `SEC ${revItem.form} ${revItem.tag}` : '',
      };
    });
}

function fiscalPeriodFromEnd(end, fiscalYearEnd) {
  const text = String(end || '');
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const fye = String(fiscalYearEnd || '').replace(/\D/g, '').padStart(4, '0').slice(-4);
  const endMonth = Number(fye.slice(0, 2));
  const endDay = Number(fye.slice(2, 4));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)
    || !Number.isFinite(endMonth) || !Number.isFinite(endDay) || endMonth < 1 || endMonth > 12) {
    return null;
  }

  const fiscalYear = (month < endMonth || (month === endMonth && day <= endDay)) ? year : year + 1;
  const fiscalStartMonth = endMonth;
  const offset = (month - fiscalStartMonth + 12) % 12;
  const fiscalQuarter = Math.min(4, Math.floor(offset / 3) + 1);
  return { year: fiscalYear, quarter: `Q${fiscalQuarter}` };
}

function quarterlySecValues(companyfacts, tags, units, fiscalYearEnd) {
  const out = new Map();
  for (const fact of secValues(companyfacts, 'us-gaap', tags, units)) {
    if (!INTERIM_FORMS.has(fact.form)) continue;
    const frame = String(fact.frame || '');
    const match = frame.match(/^CY(\d{4})Q([1-4])$/);
    if (!match) continue;
    const fiscalPeriod = fiscalPeriodFromEnd(fact.end, fiscalYearEnd);
    const year = fiscalPeriod?.year ?? Number(match[1]);
    const quarter = fiscalPeriod?.quarter ?? `Q${match[2]}`;
    const key = `${year}-${quarter}`;
    const filed = String(fact.filed || '');
    const existing = out.get(key);
    if (!existing || filed > existing.filed) {
      out.set(key, { year, quarter, end: fact.end, filed, val: fact.val, tag: fact.tag, form: fact.form, frame });
    }
  }
  return out;
}

function buildQuarterlyRows(companyfacts, fiscalYearEnd, limit = 8) {
  const revenue = quarterlySecValues(
    companyfacts,
    ['Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerExcludingAssessedTax'],
    ['USD'],
    fiscalYearEnd
  );
  const eps = quarterlySecValues(
    companyfacts,
    ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'],
    ['USD/shares'],
    fiscalYearEnd
  );
  const keys = new Set([...revenue.keys(), ...eps.keys()]);
  const allRows = [...keys]
    .map((key) => {
      const revItem = revenue.get(key);
      const epsItem = eps.get(key);
      const [year, quarter] = key.split('-');
      return {
        key,
        year: Number(year),
        quarter,
        period: `F${quarter} ${year}`,
        sortKey: `${year}${quarter.slice(1)}`,
        end: revItem?.end || epsItem?.end || '',
        filed: revItem?.filed || epsItem?.filed || '',
        eps: epsItem?.val ?? null,
        salesB: revItem?.val == null ? null : revItem.val / 1_000_000_000,
        epsSource: epsItem ? `SEC ${epsItem.form} ${epsItem.tag}` : '',
        salesSource: revItem ? `SEC ${revItem.form} ${revItem.tag}` : '',
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const byKey = new Map(allRows.map((row) => [row.key, row]));
  for (const row of allRows) {
    const priorYearRow = byKey.get(`${row.year - 1}-${row.quarter}`);
    row.epsYoY = pctChangeValue(row.eps, priorYearRow?.eps, true);
    row.salesYoY = pctChangeValue(row.salesB, priorYearRow?.salesB);
  }
  return allRows.slice(-limit);
}

function latestAnnualValue(companyfacts, tags, units) {
  const values = annualSecValues(companyfacts, tags, units);
  let latest = null;
  for (const [year, item] of values.entries()) {
    if (!latest || year > latest.year) latest = { year, ...item };
  }
  return latest;
}

function annualValueForYear(companyfacts, tags, units, year) {
  if (year == null) return null;
  const values = annualSecValues(companyfacts, tags, units);
  const item = values.get(year);
  return item ? { year, ...item } : null;
}

function buildAnnualGrossProfit(companyfacts, revenue) {
  const grossProfit = latestAnnualValue(companyfacts, ['GrossProfit'], ['USD']);
  if (grossProfit?.val != null) return { ...grossProfit, derived: false };

  const costOfRevenue = annualValueForYear(
    companyfacts,
    [
      'CostOfRevenue',
      'CostOfGoodsAndServicesSold',
      'CostOfGoodsSold',
      'CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization',
      'CostOfGoodsAndServicesSoldOverhead',
    ],
    ['USD'],
    revenue?.year
  );
  if (revenue?.val == null || costOfRevenue?.val == null) return null;
  if (costOfRevenue.val < 0 || costOfRevenue.val > revenue.val) return null;

  return {
    year: revenue.year,
    filed: costOfRevenue.filed,
    val: revenue.val - costOfRevenue.val,
    tag: `${revenue.tag}-minus-${costOfRevenue.tag}`,
    form: costOfRevenue.form || revenue.form,
    derived: true,
  };
}

function ratio(numerator, denominator, scale = 1) {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return (numerator / denominator) * scale;
}

function buildQuality(companyfacts, marketCap, price) {
  const revenue = latestAnnualValue(
    companyfacts,
    ['Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerExcludingAssessedTax'],
    ['USD']
  );
  const grossProfit = buildAnnualGrossProfit(companyfacts, revenue);
  const operatingIncome = latestAnnualValue(companyfacts, ['OperatingIncomeLoss'], ['USD']);
  const pretaxIncome = latestAnnualValue(
    companyfacts,
    ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxes'],
    ['USD']
  );
  const netIncome = latestAnnualValue(companyfacts, ['NetIncomeLoss', 'ProfitLoss'], ['USD']);
  const annualEps = latestAnnualValue(
    companyfacts,
    ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'],
    ['USD/shares']
  );
  const assets = latestSecValue(companyfacts, ['Assets'], ['USD'], 'us-gaap');
  const liabilities = latestSecValue(companyfacts, ['Liabilities'], ['USD'], 'us-gaap');
  const equity = latestSecValue(
    companyfacts,
    ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
    ['USD'],
    'us-gaap'
  );

  return {
    fiscalYear: revenue?.year || netIncome?.year || annualEps?.year || null,
    grossMargin: ratio(grossProfit?.val, revenue?.val, 100),
    operatingMargin: ratio(operatingIncome?.val, revenue?.val, 100),
    pretaxMargin: ratio(pretaxIncome?.val, revenue?.val, 100),
    roe: ratio(netIncome?.val, equity?.val, 100),
    liabilitiesToAssets: ratio(liabilities?.val ?? (assets?.val != null && equity?.val != null ? assets.val - equity.val : null), assets?.val, 100),
    pe: price != null && annualEps?.val ? ratio(price, annualEps.val) : ratio(marketCap, netIncome?.val),
    priceToSales: ratio(marketCap, revenue?.val),
    dataDate: [revenue?.year, assets?.end, equity?.end].filter(Boolean).join(' / ') || '',
    grossMarginSource: grossProfit?.derived ? `derived from ${grossProfit.tag}` : grossProfit?.tag || '',
  };
}

function buildDurabilityValuation(ticker, quality, quarterlyRows, annualRows, marketCap) {
  const latestQuarter = [...(quarterlyRows || [])].reverse().find((row) => row.salesB != null);
  const priorYearQuarter = latestQuarter
    ? [...(quarterlyRows || [])]
      .filter((row) => row.salesB != null && row.period?.slice(0, 2) === latestQuarter.period?.slice(0, 2) && row.sortKey < latestQuarter.sortKey)
      .at(-1)
    : null;
  const latestAnnual = [...(annualRows || [])].reverse().find((row) => row.salesB != null);
  const priorAnnual = latestAnnual
    ? [...(annualRows || [])].filter((row) => row.salesB != null && row.year < latestAnnual.year).at(-1)
    : null;

  const ttmSales = latestQuarter?.salesB != null
    ? latestQuarter.salesB * 4 * 1_000_000_000
    : latestAnnual?.salesB != null ? latestAnnual.salesB * 1_000_000_000 : null;
  const salesGrowthPct = latestQuarter?.salesB != null && priorYearQuarter?.salesB
    ? ((latestQuarter.salesB / priorYearQuarter.salesB) - 1) * 100
    : latestAnnual?.salesB != null && priorAnnual?.salesB ? ((latestAnnual.salesB / priorAnnual.salesB) - 1) * 100 : null;
  const grossMarginPct = quality?.grossMargin ?? null;
  const qualityMultiplier = QUALITY_DEFAULTS[ticker] ?? 1.00;
  const suggestedDurability = DURABILITY_DEFAULTS[ticker] ?? 0.75;

  if (ttmSales == null || salesGrowthPct == null || grossMarginPct == null) {
    return {
      available: false,
      missing: [
        ttmSales == null ? 'ttmSales' : '',
        salesGrowthPct == null ? 'salesGrowthPct' : '',
        grossMarginPct == null ? 'grossMarginPct' : '',
      ].filter(Boolean),
    };
  }

  const base = ttmSales * 0.10 * (salesGrowthPct + grossMarginPct) * qualityMultiplier;
  const valuations = DURABILITY_CASES.map((item) => {
    const impliedMarketCap = base * item.multiplier;
    return {
      ...item,
      impliedMarketCap,
      upsideDownsidePct: ratio(impliedMarketCap - marketCap, marketCap, 100),
    };
  });
  const impliedValues = valuations.map((item) => item.impliedMarketCap).filter((value) => value != null);
  const suggested = valuations.find((item) => item.multiplier === suggestedDurability) || valuations[1];

  return {
    available: true,
    ttmSales,
    salesGrowthPct,
    grossMarginPct,
    qualityMultiplier,
    suggestedDurability,
    rangeLow: Math.min(...impliedValues),
    rangeHigh: Math.max(...impliedValues),
    suggestedValue: suggested?.impliedMarketCap ?? null,
    suggestedUpsideDownsidePct: suggested?.upsideDownsidePct ?? null,
    valuations,
    source: latestQuarter?.salesB != null ? 'latest quarterly sales x4' : 'latest annual sales',
  };
}

function renderFundTable(data) {
  const description = truncate(data.summary || data.name || '', 520) || '--';
  const sourceBits = [
    data.asOf.yahooChart ? `Yahoo ${data.asOf.yahooChart.slice(0, 10)}` : '',
    data.asOf.secFacts ? `SEC facts ${data.asOf.secFacts}` : '',
    data.summarySource ? `desc ${data.summarySource}` : '',
  ].filter(Boolean);
  const volumeLine = [
    shares(data.tradingStats?.todayVolume),
    data.tradingStats?.avgVolume30d == null ? '' : `30D avg ${shares(data.tradingStats.avgVolume30d)}`,
    data.tradingStats?.volumeRatio30d == null ? '' : `${data.tradingStats.volumeRatio30d.toFixed(1)}x avg`,
  ].filter(Boolean).join(' | ');
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
    `Latest Quote:         ${formatPrice(data.quote?.price)} ${data.quote?.change == null || data.quote?.changePct == null ? '' : `${data.quote.change >= 0 ? '+' : ''}${data.quote.change.toFixed(2)} (${data.quote.changePct >= 0 ? '+' : ''}${data.quote.changePct.toFixed(2)}%)`}`.trim(),
    data.quote?.regularMarketTime ? `Quote Time:           ${data.quote.regularMarketTime}${data.quote.marketState ? ` ${data.quote.marketState}` : ''}` : '',
    `Market Capitalization: ${moneyB(data.marketCap)}`,
    `Shares Outstanding:  ${shares(data.sharesOutstanding)}`,
    `52W Position:        ${formatUnsignedPct(data.tradingStats?.fiftyTwoWeekRangePct)} range${data.tradingStats?.offFiftyTwoWeekHighPct == null ? '' : ` (${formatPct(data.tradingStats.offFiftyTwoWeekHighPct)} from high)`}`,
    `Volume:              ${volumeLine || '--'}`,
    `ROE:                 ${formatPct(data.quality?.roe)}`,
    `Pretax Margin:       ${formatPct(data.quality?.pretaxMargin)}`,
    `Liabilities/Assets:  ${formatPct(data.quality?.liabilitiesToAssets)}`,
    `P/E:                 ${formatNumber(data.quality?.pe)}`,
    `Price/Sales:         ${formatNumber(data.quality?.priceToSales)}`,
    data.durabilityValuation?.available
      ? `Durval Range:        ${compactMoney(data.durabilityValuation.rangeLow)}-${compactMoney(data.durabilityValuation.rangeHigh)}`
      : '',
    '',
    sourceBits.length ? `Data: ${sourceBits.join('; ')}` : '',
    'Quote note: Yahoo chart metadata/daily close, cached up to 5 minutes; not guaranteed real-time.',
    'Note: EPS is GAAP diluted EPS from SEC data, not adjusted analyst EPS.',
    'Durval: durability-implied market cap from sales run rate, sales growth, gross margin, and quality/durability multipliers; scenario math, not a target price.',
    'Durval limits: can be wrong when margins, growth, cyclicality, or source data are stale or abnormal.',
    data.warnings.length ? `Warnings: ${data.warnings.join('; ')}` : '',
    '',
    `${'Year'.padEnd(6)} ${'EPS'.padStart(8)} ${'EPS %'.padStart(7)} ${'Sales $B'.padStart(10)} ${'Sales %'.padStart(8)}`,
    `${'-'.repeat(6)} ${'-'.repeat(8)} ${'-'.repeat(7)} ${'-'.repeat(10)} ${'-'.repeat(8)}`,
  ].filter((line, idx) => line || idx < 15);

  let prevEps = null;
  let prevSales = null;
  if (data.rows.length) {
    for (const row of data.rows) {
      const eps = row.eps == null ? '--' : row.eps.toFixed(2);
      const sales = row.salesB == null ? '--' : row.salesB.toFixed(2);
      lines.push(
        `${String(row.year).padEnd(6)} ${eps.padStart(8)} ${pctChange(row.eps, prevEps, true).padStart(7)} ${sales.padStart(10)} ${pctChange(row.salesB, prevSales).padStart(8)}`
      );
      if (row.eps != null) prevEps = row.eps;
      if (row.salesB != null) prevSales = row.salesB;
    }
  } else {
    lines.push(`${'--'.padEnd(6)} ${'--'.padStart(8)} ${'--'.padStart(7)} ${'--'.padStart(10)} ${'--'.padStart(8)}`);
  }

  if (data.quarterlyRows?.length) {
    lines.push('', 'Quarterly', `${'Qtr'.padEnd(8)} ${'EPS'.padStart(8)} ${'EPS YoY'.padStart(7)} ${'Sales $B'.padStart(10)} ${'Sales YoY'.padStart(9)}`);
    for (const row of data.quarterlyRows) {
      const eps = row.eps == null ? '--' : row.eps.toFixed(2);
      const sales = row.salesB == null ? '--' : row.salesB.toFixed(2);
      lines.push(
        `${String(row.period).padEnd(8)} ${eps.padStart(8)} ${formatChangeValue(row.epsYoY).padStart(7)} ${sales.padStart(10)} ${formatChangeValue(row.salesYoY).padStart(9)}`
      );
    }
  }

  if (data.relativeStrength?.length) {
    lines.push('', 'Relative Strength vs SPY', `${'Period'.padEnd(8)} ${'Stock'.padStart(8)} ${'SPY'.padStart(8)} ${'Rel'.padStart(8)}`);
    for (const row of data.relativeStrength) {
      lines.push(
        `${row.label.padEnd(8)} ${formatPct(row.stockReturn).padStart(8)} ${formatPct(row.benchmarkReturn).padStart(8)} ${formatPct(row.relativeReturn).padStart(8)}`
      );
    }
  }
  return lines.join('\n');
}

async function buildFundamentals(ticker, request, env, startYear) {
  const warnings = [];
  let chart = null;
  let benchmarkChart = null;
  let chartCache = 'none';
  let benchmarkCache = 'none';
  try {
    const chartResult = await fetchChart(ticker, env, '1y');
    chart = chartResult.data;
    chartCache = chartResult.cache;
  } catch (err) {
    warnings.push(`Yahoo chart unavailable: ${err.message}`);
  }
  try {
    const benchmarkResult = await fetchChart('SPY', env, '1y');
    benchmarkChart = benchmarkResult.data;
    benchmarkCache = benchmarkResult.cache;
  } catch (err) {
    warnings.push(`SPY benchmark unavailable: ${err.message}`);
  }

  const cikResult = await resolveCik(ticker, request, env, warnings);
  const cik = cikResult.cik;
  const meta = chartMeta(chart);
  if (!cik && !chartCloses(chart).length && !cleanNumber(meta.regularMarketPrice)) {
    throw new Error(`No market or SEC data available for ${ticker}`);
  }

  let factsResult = { data: null, cache: 'none' };
  let submissionsResult = { data: {}, cache: 'none' };
  let descriptionResult = { data: { summary: '', filingDate: '' }, cache: 'none' };
  if (cik) {
    try {
      factsResult = await fetchCompanyfacts(cik, env);
    } catch (err) {
      warnings.push(err.status === 404 ? 'SEC companyfacts unavailable for this ticker.' : `SEC companyfacts unavailable: ${err.message}`);
    }
    try {
      submissionsResult = await fetchSubmissions(cik, env);
    } catch (err) {
      warnings.push(`SEC submissions unavailable: ${err.message}`);
    }
    if (submissionsResult.data?.filings) {
      try {
        descriptionResult = await fetchBusinessDescription(cik, submissionsResult.data, env);
      } catch (err) {
        warnings.push(`SEC business description unavailable: ${err.message}`);
      }
    }
  }
  const facts = factsResult.data;
  const submission = submissionsResult.data || {};
  const shares = latestSecValue(facts, ['EntityCommonStockSharesOutstanding'], ['shares']);
  const price = cleanNumber(meta.regularMarketPrice);
  const sharesOutstanding = shares?.val ?? cleanNumber(meta.sharesOutstanding);
  const marketCap = cleanNumber(meta.marketCap) ?? (price != null && sharesOutstanding != null ? price * sharesOutstanding : null);
  const industry = submission.sicDescription || '--';
  const displayName = meta.longName || meta.shortName || submission.name || facts?.entityName || ticker;
  const summary = descriptionResult.data.summary
    || submission.description
    || (cik && facts
      ? `${displayName} is an SEC filer in ${industry}.`
      : `${displayName} has Yahoo quote/chart coverage, but ${cik ? 'SEC companyfacts are unavailable' : 'no SEC CIK mapping was found'}, so SEC-backed financial statement fields are unavailable.`);
  const rows = buildRows(facts, startYear);
  const quarterlyRows = buildQuarterlyRows(facts, submission.fiscalYearEnd);
  const quality = buildQuality(facts, marketCap, price);

  return {
    ticker,
    cik: cik ? String(cik).padStart(10, '0') : null,
    name: displayName,
    exchange: meta.fullExchangeName || meta.exchangeName || submission.exchanges?.[0] || '--',
    industry,
    location: locationFromSubmission(submission),
    phone: submission.phone || '--',
    website: submission.website || submission.investorWebsite || '--',
    summary,
    summarySource: descriptionResult.data.source || (submission.description ? 'SEC submissions' : facts ? 'SEC profile fallback' : 'Yahoo chart / SEC facts unavailable'),
    price,
    quote: buildQuote(meta, chart),
    marketCap,
    sharesOutstanding,
    tradingStats: buildTradingStats(meta, chart, price),
    rows,
    quarterlyRows,
    quality,
    durabilityValuation: buildDurabilityValuation(ticker, quality, quarterlyRows, rows, marketCap),
    relativeStrength: buildRelativeStrength(chart, benchmarkChart),
    technicalChart: buildTechnicalChart(chart, benchmarkChart),
    warnings,
    cache: {
      cikMap: cikResult.cache,
      yahooChart: chartCache,
      benchmarkChart: benchmarkCache,
      secCompanyfacts: factsResult.cache,
      secSubmissions: submissionsResult.cache,
      secBusinessDescription: descriptionResult.cache,
    },
    asOf: {
      yahooChart: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
      secFacts: shares?.end || null,
      secProfile: descriptionResult.data.filingDate || null,
      secFactForms: facts ? (rows.some((row) => row.salesSource?.includes('20-F') || row.epsSource?.includes('20-F')) ? '20-F / 6-K' : '10-K / 10-Q') : '--',
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

  const renderKey = `fund:rendered:${ticker}:${minYear}:${format}:v22`;
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
