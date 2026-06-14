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

  function fmtNumber(value, digits = 1) {
    return value == null ? '--' : Number(value).toFixed(digits);
  }

  function fmtPct(value, { signed = false, digits = 0 } = {}) {
    if (value == null) return '--';
    const prefix = signed && value > 0 ? '+' : '';
    return `${prefix}${Number(value).toFixed(digits)}%`;
  }

  function pctClass(value) {
    if (!value || value === '--' || value === 'NM') return '';
    return value.startsWith('-') ? ' class="neg"' : ' class="pos"';
  }

  function firstDate(value) {
    return value ? String(value).slice(0, 10) : 'n/a';
  }

  function trendRows(rows, firstLabel) {
    let prevEps = null;
    let prevSales = null;
    return (rows || []).map((row) => {
      const epsChange = pct(row.eps, prevEps, true);
      const salesChange = pct(row.salesB, prevSales);
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
    const quarterlyRows = trendRows(data.quarterlyRows, 'period');
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
          <div class="section-subtitle">SEC 10-Q facts</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Qtr</th><th>EPS</th><th>EPS %</th><th>Sales</th><th>Sales %</th></tr>
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
        <div>
          <div class="ticker">${escapeHtml(data.ticker)}</div>
          <div class="name">${escapeHtml(data.name || '')}</div>
        </div>
        <div class="badge">${escapeHtml(data.cache?.secCompanyfacts === 'hit' ? 'Cached' : 'Fresh')}</div>
      </div>

      <div class="profile">
        <span>${escapeHtml(data.exchange || '--')}</span>
        <span>${escapeHtml(data.industry || '--')}</span>
        <span>${escapeHtml(data.location || '--')}</span>
      </div>

      <p class="desc">${escapeHtml(data.summary || '--')}</p>

      <div class="metrics">
        <div class="metric"><div class="label">Market cap</div><div class="value">${moneyB(data.marketCap)}</div><div class="subvalue">Durval ${escapeHtml(durvalRange)}</div></div>
        <div class="metric"><div class="label">Shares out</div><div class="value">${shares(data.sharesOutstanding)}</div></div>
        <div class="metric"><div class="label">Float</div><div class="value">${shares(data.floatShares)}</div></div>
        <div class="metric"><div class="label">Short interest</div><div class="value">${escapeHtml(data.shortInterest || '--')}</div></div>
      </div>

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

      <div class="note">Data: Yahoo ${firstDate(data.asOf?.yahooChart)}; SEC facts ${firstDate(data.asOf?.secFacts)}; description ${escapeHtml(data.summarySource || 'n/a')}</div>
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
