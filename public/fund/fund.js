(() => {
  const form = document.getElementById('fund-form');
  const input = document.getElementById('ticker');
  const output = document.getElementById('output');
  const meta = document.getElementById('meta');

  function cleanTicker(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '').slice(0, 16);
  }

  async function load(ticker) {
    const symbol = cleanTicker(ticker);
    if (!symbol) return;
    input.value = symbol;
    output.textContent = `Loading ${symbol}...`;
    meta.textContent = 'Fetching cached fundamentals...';
    const res = await fetch(`/api/fund/${encodeURIComponent(symbol)}`, { cache: 'no-store' });
    const body = await res.text();
    output.textContent = body;
    meta.textContent = res.ok
      ? `Endpoint: /api/fund/${symbol} | ${new Date().toLocaleString()}`
      : `Request failed: HTTP ${res.status}`;
    history.replaceState(null, '', `/fund/?ticker=${encodeURIComponent(symbol)}`);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    load(input.value).catch((err) => {
      output.textContent = err.message || 'Request failed';
      meta.textContent = 'Unavailable';
    });
  });

  const initial = new URLSearchParams(location.search).get('ticker') || input.value || 'WMT';
  load(initial).catch((err) => {
    output.textContent = err.message || 'Request failed';
    meta.textContent = 'Unavailable';
  });
})();
