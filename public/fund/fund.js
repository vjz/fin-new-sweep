(() => {
  const form = document.getElementById('fund-form');
  const input = document.getElementById('ticker');
  const button = document.getElementById('load-button');
  const output = document.getElementById('output');
  const meta = document.getElementById('meta');
  const fieldError = document.getElementById('field-error');
  let activeRequest = null;
  let loadedTicker = '';

  function cleanTicker(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '').slice(0, 16);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  function moneyB(value) {
    return value == null ? '--' : `$${(value / 1_000_000_000).toFixed(1)}B`;
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
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    return Math.round(value).toLocaleString();
  }

  function pct(curr, prev, positiveBaseRequired = false) {
    if (curr == null || prev == null || prev === 0) return '--';
    if (positiveBaseRequired && (prev <= 0 || curr < 0)) return 'NM';
    const change = ((curr / prev) - 1) * 100;
    return `${change >= 0 ? '+' : ''}${change.toFixed(0)}%`;
  }

  function fmtChangeValue(value) {
    if (value == null) return '--';
    if (value === 'NM') return 'NM';
    return fmtPct(value, { signed: true });
  }

  function fmtNumber(value, digits = 1) {
    return value == null ? '--' : Number(value).toFixed(digits);
  }

  function fmtPct(value, { signed = false, digits = 0 } = {}) {
    if (value == null) return '--';
    const prefix = signed && value > 0 ? '+' : '';
    return `${prefix}${Number(value).toFixed(digits)}%`;
  }

  function fmtPrice(value) {
    if (value == null) return '--';
    return `$${Number(value).toFixed(value >= 100 ? 0 : 2)}`;
  }

  function fmtQuotePrice(value) {
    if (value == null) return '--';
    return `$${Number(value).toFixed(2)}`;
  }

  function fmtDateTime(value) {
    if (!value) return 'n/a';
    return new Date(value).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  }

  function pctClass(value) {
    if (!value || value === '--' || value === 'NM') return '';
    return value.startsWith('-') ? ' class="neg"' : ' class="pos"';
  }

  function firstDate(value) {
    return value ? String(value).slice(0, 10) : 'n/a';
  }

  function trendRows(rows, firstLabel, changeKeys = null) {
    let prevEps = null;
    let prevSales = null;
    return (rows || []).map((row) => {
      const epsChange = changeKeys ? fmtChangeValue(row[changeKeys.eps]) : pct(row.eps, prevEps, true);
      const salesChange = changeKeys ? fmtChangeValue(row[changeKeys.sales]) : pct(row.salesB, prevSales);
      if (row.eps != null) prevEps = row.eps;
      if (row.salesB != null) prevSales = row.salesB;
      return `
        <tr>
          <td>${escapeHtml(row[firstLabel])}</td>
          <td>${row.eps == null ? '--' : row.eps.toFixed(2)}</td>
          <td${pctClass(epsChange)}>${escapeHtml(epsChange)}</td>
          <td>${row.salesB == null ? '--' : row.salesB.toFixed(2)}</td>
          <td${pctClass(salesChange)}>${escapeHtml(salesChange)}</td>
        </tr>`;
    }).join('');
  }

  function linePath(points, key, xFor, yFor) {
    let path = '';
    let drawing = false;
    points.forEach((point, index) => {
      const value = point[key];
      if (value == null) {
        drawing = false;
        return;
      }
      const cmd = drawing ? 'L' : 'M';
      path += `${cmd}${xFor(index).toFixed(1)},${yFor(value).toFixed(1)} `;
      drawing = true;
    });
    return path.trim();
  }

  function renderTechnicalChart(chart) {
    if (!chart?.available || !chart.points?.length) return '';
    const points = chart.points.filter((point) => point.close != null);
    if (points.length < 2) return '';

    const narrow = window.matchMedia?.('(max-width: 520px)')?.matches;
    const width = narrow ? 360 : 820;
    const height = narrow ? 220 : 230;
    const pad = { top: 14, right: narrow ? 42 : 58, bottom: 28, left: 10 };
    const values = points
      .flatMap((point) => [point.close, point.ma50, point.ma200])
      .filter((value) => value != null && Number.isFinite(value));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min || max * 0.02 || 1;
    const yMin = min - spread * 0.08;
    const yMax = max + spread * 0.08;
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const xFor = (index) => pad.left + (index / Math.max(1, points.length - 1)) * plotW;
    const yFor = (value) => pad.top + ((yMax - value) / Math.max(1, yMax - yMin)) * plotH;
    const gridValues = [yMin + (yMax - yMin) * 0.25, yMin + (yMax - yMin) * 0.5, yMin + (yMax - yMin) * 0.75];
    const startLabel = points[0]?.date?.slice(5) || '';
    const endLabel = points.at(-1)?.date?.slice(5) || '';
    const latest = chart.latest || {};
    const rel = fmtPct(latest.relativeReturn, { signed: true });
    const relClass = latest.relativeReturn == null ? '' : latest.relativeReturn >= 0 ? ' good' : ' caution';

    return `
      <div class="section chart-section">
        <div class="section-head">
          <div>
            <div class="section-title">Price Trend</div>
            <div class="section-subtitle">6M daily close, 50D / 200D moving averages</div>
          </div>
        </div>
        <div class="chart-status">
          <span class="status-chip${latest.above50d == null ? '' : latest.above50d ? ' good' : ' caution'}">${latest.above50d == null ? '50D n/a' : latest.above50d ? 'Above 50D' : 'Below 50D'}</span>
          <span class="status-chip${latest.above200d == null ? '' : latest.above200d ? ' good' : ' caution'}">${latest.above200d == null ? '200D n/a' : latest.above200d ? 'Above 200D' : 'Below 200D'}</span>
          <span class="status-chip${relClass}">RS vs SPY ${rel}</span>
        </div>
        <div class="chart-wrap" aria-label="6 month price chart">
          <svg class="price-chart" viewBox="0 0 ${width} ${height}" role="img">
            ${gridValues.map((value) => `
              <line class="chart-grid" x1="${pad.left}" y1="${yFor(value).toFixed(1)}" x2="${width - pad.right}" y2="${yFor(value).toFixed(1)}"></line>
              <text class="chart-axis" x="${width - pad.right + 8}" y="${(yFor(value) + 4).toFixed(1)}">${fmtPrice(value)}</text>
            `).join('')}
            <path class="chart-line ma200" d="${linePath(points, 'ma200', xFor, yFor)}"></path>
            <path class="chart-line ma50" d="${linePath(points, 'ma50', xFor, yFor)}"></path>
            <path class="chart-line close" d="${linePath(points, 'close', xFor, yFor)}"></path>
            <text class="chart-date" x="${pad.left}" y="${height - 7}">${escapeHtml(startLabel)}</text>
            <text class="chart-date end" x="${width - pad.right}" y="${height - 7}">${escapeHtml(endLabel)}</text>
          </svg>
        </div>
        <div class="chart-legend">
          <span><i class="legend-line close"></i>Price</span>
          <span><i class="legend-line ma50"></i>50D</span>
          <span><i class="legend-line ma200"></i>200D</span>
        </div>
      </div>`;
  }

  function renderQuote(quote) {
    if (!quote?.price) return '';
    const change = quote.change == null ? '--' : `${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)}`;
    const changePct = fmtPct(quote.changePct, { signed: true, digits: 2 });
    const tone = quote.change == null ? '' : quote.change >= 0 ? ' pos' : ' neg';
    const timestamp = fmtDateTime(quote.regularMarketTime);
    const marketState = quote.marketState ? ` · ${escapeHtml(quote.marketState)}` : '';
    return `
      <div class="quote-inline">
        <div class="quote-label">Latest quote</div>
        <div class="quote-main">${fmtQuotePrice(quote.price)}</div>
        <div class="quote-change${tone}">${escapeHtml(change)} (${escapeHtml(changePct)})</div>
        <div class="quote-time">${escapeHtml(timestamp)}${marketState}</div>
      </div>`;
  }

  function setBusy(isBusy) {
    button.disabled = isBusy;
    input.disabled = isBusy;
    button.textContent = isBusy ? 'Loading' : 'Load';
    input.setAttribute('aria-busy', String(isBusy));
  }

  function setFieldError(message = '') {
    fieldError.textContent = message;
  }

  function urlForTicker(symbol) {
    return `/fund/?ticker=${encodeURIComponent(symbol)}`;
  }

  function initialTicker() {
    const params = new URLSearchParams(location.search);
    return params.get('ticker') || input.value || 'WMT';
  }

  function renderFund(data) {
    const rows = trendRows(data.rows, 'year');
    const quarterlyRows = trendRows(data.quarterlyRows, 'period', { eps: 'epsYoY', sales: 'salesYoY' });
    const rsRows = (data.relativeStrength || []).map((row) => {
      const rel = fmtPct(row.relativeReturn, { signed: true });
      return `
        <tr>
          <td>${escapeHtml(row.label)}</td>
          <td${pctClass(fmtPct(row.stockReturn, { signed: true }))}>${fmtPct(row.stockReturn, { signed: true })}</td>
          <td${pctClass(fmtPct(row.benchmarkReturn, { signed: true }))}>${fmtPct(row.benchmarkReturn, { signed: true })}</td>
          <td${pctClass(rel)}>${rel}</td>
        </tr>`;
    }).join('');

    const warnings = data.warnings?.length
      ? `<div class="note warn">Warnings: ${escapeHtml(data.warnings.join('; '))}</div>`
      : '';
    const quality = data.quality || {};
    const durval = data.durabilityValuation || {};
    const durvalRange = durval.available ? `${compactMoney(durval.rangeLow)}-${compactMoney(durval.rangeHigh)}` : '--';
    const quoteInline = renderQuote(data.quote);
    const chartSection = renderTechnicalChart(data.technicalChart);
    const qualitySection = `
      <div class="section">
        <div class="section-head">
          <div class="section-title">Quality Snapshot</div>
          <div class="section-subtitle">${quality.fiscalYear ? `FY ${escapeHtml(quality.fiscalYear)}` : 'Latest SEC facts'}</div>
        </div>
        <div class="metrics quality">
          <div class="metric"><div class="label">ROE</div><div class="value">${fmtPct(quality.roe)}</div></div>
          <div class="metric"><div class="label">Pretax margin</div><div class="value">${fmtPct(quality.pretaxMargin)}</div></div>
          <div class="metric"><div class="label">Op margin</div><div class="value">${fmtPct(quality.operatingMargin)}</div></div>
          <div class="metric"><div class="label">Liab/assets</div><div class="value">${fmtPct(quality.liabilitiesToAssets)}</div></div>
          <div class="metric"><div class="label">P/E</div><div class="value">${fmtNumber(quality.pe)}</div></div>
          <div class="metric"><div class="label">P/S</div><div class="value">${fmtNumber(quality.priceToSales)}</div></div>
        </div>
      </div>`;
    const quarterlySection = quarterlyRows ? `
      <div class="section">
        <div class="section-head">
          <div class="section-title">Quarterly EPS / Sales</div>
          <div class="section-subtitle">SEC 10-Q facts, YoY change</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Qtr</th><th>EPS</th><th>EPS YoY</th><th>Sales</th><th>Sales YoY</th></tr>
            </thead>
            <tbody>${quarterlyRows}</tbody>
          </table>
        </div>
      </div>` : '';
    const rsSection = rsRows ? `
      <div class="section">
        <div class="section-head">
          <div class="section-title">Relative Strength</div>
          <div class="section-subtitle">Price return vs SPY</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Period</th><th>Stock</th><th>SPY</th><th>Rel</th></tr>
            </thead>
            <tbody>${rsRows}</tbody>
          </table>
        </div>
      </div>` : '';

    output.className = 'panel';
    output.innerHTML = `
      <div class="topline">
        <div class="identity">
          <div class="ticker">${escapeHtml(data.ticker)}</div>
          <div class="name">${escapeHtml(data.name || '')}</div>
          <div class="profile">
            <span>${escapeHtml(data.exchange || '--')}</span>
            <span>${escapeHtml(data.industry || '--')}</span>
            <span>${escapeHtml(data.location || '--')}</span>
          </div>
        </div>
        <div class="top-right">
          <div class="badge">${escapeHtml(data.cache?.secCompanyfacts === 'hit' ? 'Cached' : 'Fresh')}</div>
          ${quoteInline}
        </div>
      </div>

      <p class="desc">${escapeHtml(data.summary || '--')}</p>

      <div class="metrics">
        <div class="metric"><div class="label">Market cap</div><div class="value">${moneyB(data.marketCap)}</div><div class="subvalue">Durval ${escapeHtml(durvalRange)}</div></div>
        <div class="metric"><div class="label">Shares out</div><div class="value">${shares(data.sharesOutstanding)}</div></div>
        <div class="metric"><div class="label">Float</div><div class="value">${shares(data.floatShares)}</div></div>
        <div class="metric"><div class="label">Short interest</div><div class="value">${escapeHtml(data.shortInterest || '--')}</div></div>
      </div>

      ${chartSection}

      ${qualitySection}

      <div class="section">
        <div class="section-head">
          <div class="section-title">Annual EPS / Sales</div>
          <div class="section-subtitle">SEC 10-K facts</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Year</th><th>EPS</th><th>EPS %</th><th>Sales</th><th>Sales %</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>

      ${quarterlySection}
      ${rsSection}

      <div class="note">Data: Yahoo quote/chart ${firstDate(data.asOf?.yahooChart)}; SEC facts ${firstDate(data.asOf?.secFacts)}; description ${escapeHtml(data.summarySource || 'n/a')}</div>
      <div class="note">Latest quote uses Yahoo chart metadata/daily close and is cached up to 5 minutes; it is not guaranteed real-time.</div>
      <div class="note">Sales shown in $B. EPS is GAAP diluted EPS from SEC data, not adjusted analyst EPS. Relative strength is raw price performance vs SPY.</div>
      <div class="note">Durval estimates durability-implied market cap from sales run rate, sales growth, gross margin, and a quality/durability multiplier. It is scenario math, not a target price; it can be wrong when margins, growth, cyclicality, or source data are stale or abnormal.</div>
      ${warnings}`;
  }

  async function load(ticker, { updateUrl = 'replace' } = {}) {
    const symbol = cleanTicker(ticker);
    if (!symbol) {
      setFieldError('Enter a ticker.');
      input.focus();
      return;
    }
    setFieldError('');
    if (activeRequest) activeRequest.abort();
    const controller = new AbortController();
    activeRequest = controller;
    input.value = symbol;
    output.className = 'panel loading';
    output.textContent = `Loading ${symbol}...`;
    meta.textContent = 'Fetching cached fundamentals...';
    setBusy(true);
    try {
      const res = await fetch(`/api/fund/${encodeURIComponent(symbol)}?format=json`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const contentType = res.headers.get('content-type') || '';
      const body = contentType.includes('application/json') ? await res.json() : {};
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (controller !== activeRequest) return;
      renderFund(body);
      loadedTicker = symbol;
      meta.textContent = `Endpoint: /api/fund/${symbol} | ${new Date().toLocaleString()}`;
      if (updateUrl === 'push') {
        history.pushState({ ticker: symbol }, '', urlForTicker(symbol));
      } else if (updateUrl === 'replace') {
        history.replaceState({ ticker: symbol }, '', urlForTicker(symbol));
      }
    } finally {
      if (controller === activeRequest) {
        activeRequest = null;
        setBusy(false);
      }
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    load(input.value, { updateUrl: cleanTicker(input.value) === loadedTicker ? 'replace' : 'push' }).catch((err) => {
      if (err.name === 'AbortError') return;
      output.className = 'panel error';
      output.textContent = err.message || 'Request failed';
      meta.textContent = 'Unavailable';
      setBusy(false);
    });
  });

  input.addEventListener('input', () => {
    const cleaned = cleanTicker(input.value);
    if (input.value !== cleaned) input.value = cleaned;
    if (cleaned) setFieldError('');
  });

  window.addEventListener('popstate', () => {
    load(initialTicker(), { updateUrl: false }).catch((err) => {
      if (err.name === 'AbortError') return;
      output.className = 'panel error';
      output.textContent = err.message || 'Request failed';
      meta.textContent = 'Unavailable';
      setBusy(false);
    });
  });

  load(initialTicker(), { updateUrl: 'replace' }).catch((err) => {
    if (err.name === 'AbortError') return;
    output.className = 'panel error';
    output.textContent = err.message || 'Request failed';
    meta.textContent = 'Unavailable';
    setBusy(false);
  });
})();
