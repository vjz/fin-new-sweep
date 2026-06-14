(() => {
  const form = document.getElementById('fund-form');
  const input = document.getElementById('ticker');
  const output = document.getElementById('output');
  const meta = document.getElementById('meta');

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

  function pctClass(value) {
    if (!value || value === '--' || value === 'NM') return '';
    return value.startsWith('-') ? ' class="neg"' : ' class="pos"';
  }

  function firstDate(value) {
    return value ? String(value).slice(0, 10) : 'n/a';
  }

  function renderFund(data) {
    let prevEps = null;
    let prevSales = null;
    const rows = (data.rows || []).map((row) => {
      const epsChange = pct(row.eps, prevEps, true);
      const salesChange = pct(row.salesB, prevSales);
      if (row.eps != null) prevEps = row.eps;
      if (row.salesB != null) prevSales = row.salesB;
      return `
        <tr>
          <td>${escapeHtml(row.year)}</td>
          <td>${row.eps == null ? '--' : row.eps.toFixed(2)}</td>
          <td${pctClass(epsChange)}>${escapeHtml(epsChange)}</td>
          <td>${row.salesB == null ? '--' : row.salesB.toFixed(2)}</td>
          <td${pctClass(salesChange)}>${escapeHtml(salesChange)}</td>
        </tr>`;
    }).join('');

    const warnings = data.warnings?.length
      ? `<div class="note warn">Warnings: ${escapeHtml(data.warnings.join('; '))}</div>`
      : '';

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
        <div class="metric"><div class="label">Market cap</div><div class="value">${moneyB(data.marketCap)}</div></div>
        <div class="metric"><div class="label">Shares out</div><div class="value">${shares(data.sharesOutstanding)}</div></div>
        <div class="metric"><div class="label">Float</div><div class="value">${shares(data.floatShares)}</div></div>
        <div class="metric"><div class="label">Short interest</div><div class="value">${escapeHtml(data.shortInterest || '--')}</div></div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Year</th><th>EPS</th><th>EPS %</th><th>Sales $B</th><th>Sales %</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div class="note">Data: Yahoo ${firstDate(data.asOf?.yahooChart)}; SEC facts ${firstDate(data.asOf?.secFacts)}; description ${escapeHtml(data.summarySource || 'n/a')}</div>
      <div class="note">EPS is GAAP diluted EPS from SEC data, not adjusted analyst EPS.</div>
      ${warnings}`;
  }

  async function load(ticker) {
    const symbol = cleanTicker(ticker);
    if (!symbol) return;
    input.value = symbol;
    output.className = 'panel loading';
    output.textContent = `Loading ${symbol}...`;
    meta.textContent = 'Fetching cached fundamentals...';
    const res = await fetch(`/api/fund/${encodeURIComponent(symbol)}?format=json`, { cache: 'no-store' });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    renderFund(body);
    meta.textContent = res.ok
      ? `Endpoint: /api/fund/${symbol} | ${new Date().toLocaleString()}`
      : `Request failed: HTTP ${res.status}`;
    history.replaceState(null, '', `/fund/?ticker=${encodeURIComponent(symbol)}`);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    load(input.value).catch((err) => {
      output.className = 'panel error';
      output.textContent = err.message || 'Request failed';
      meta.textContent = 'Unavailable';
    });
  });

  const initial = new URLSearchParams(location.search).get('ticker') || input.value || 'WMT';
  load(initial).catch((err) => {
    output.className = 'panel error';
    output.textContent = err.message || 'Request failed';
    meta.textContent = 'Unavailable';
  });
})();
