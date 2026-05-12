(() => {
  const GROUPS = [
    ['Equities', [['SPY', 'SPY'], ['QQQ', 'QQQ'], ['IWM', 'IWM']]],
    ['Futures', [['ES', 'ES=F'], ['YM', 'YM=F'], ['NQ', 'NQ=F']]],
    ['Rates', [['TLT', 'TLT']]],
    ['FX', [['UUP', 'UUP']]],
    ['Commodities', [['USO', 'USO'], ['GLD', 'GLD'], ['COPX', 'COPX']]],
    ['Vol', [['VIX', '^VIX']]],
  ];

  const tracked = Object.fromEntries(
    GROUPS.flatMap(([, items]) => items.map(([label, symbol]) => [label, symbol]))
  );

  function pct(last, prev) {
    if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return null;
    return ((last - prev) / prev) * 100;
  }

  const COLOR_THRESHOLD = 0.25;

  function fmt(label, move) {
    if (!Number.isFinite(move)) return `${label} n/a`;
    const sign = move >= 0 ? '+' : '';
    const text = `${label} ${sign}${move.toFixed(2)}%`;
    if (move >= COLOR_THRESHOLD) return `<span style="color:#15803d">${text}</span>`;
    if (move <= -COLOR_THRESHOLD) return `<span style="color:#dc2626">${text}</span>`;
    return text;
  }

  function hourPT() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    return Number((parts.find((p) => p.type === 'hour')?.value || '0').replace('24', '0'));
  }

  async function quote(symbol) {
    const url = `/api/chart?symbol=${encodeURIComponent(symbol)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`chart ${symbol}: ${res.status}`);
    const obj = await res.json();
    const last = Number(obj.last);
    const prev = Number(obj.prev);
    const move = Number.isFinite(obj.move) ? obj.move : pct(last, prev);
    return { symbol, last, prev, move };
  }

  function regime(moves) {
    const qqq = moves.QQQ?.move ?? 0;
    const tlt = moves.TLT?.move ?? 0;
    const uup = moves.UUP?.move ?? 0;
    const uso = moves.USO?.move ?? 0;
    const gld = moves.GLD?.move ?? 0;
    let score = 0;
    score += qqq > 0 ? 1 : -1;
    score += tlt > 0 ? 1 : -1;
    score += uso > 0 ? 1 : 0;
    score += gld > 0 ? 1 : 0;
    score += uup > 0 ? 1 : 0;
    if (score >= 3) return 'Risk-off / inflationary';
    if (score <= -2) return 'Risk-on';
    return 'Mixed';
  }

  function render(moves) {
    const includeFutures = hourPT() >= 18 || hourPT() < 6;
    const lines = GROUPS
      .filter(([name]) => includeFutures || name !== 'Futures')
      .map(([name, items]) => {
        const text = items.map(([label]) => fmt(label, moves[label]?.move)).join(' | ');
        return `<div>${name}: ${text}</div>`;
      });

    document.getElementById('dashboard-lines').innerHTML = lines.join('');
    document.getElementById('dashboard-regime').textContent = `Regime: ${regime(moves)}`;
    document.getElementById('dashboard-time').textContent = `Live via Yahoo Finance proxy • ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' })}`;
  }

  async function main() {
    const entries = await Promise.allSettled(
      Object.entries(tracked).map(async ([label, symbol]) => [label, await quote(symbol)])
    );
    const moves = {};
    for (const entry of entries) {
      if (entry.status === 'fulfilled') {
        const [label, data] = entry.value;
        moves[label] = data;
      }
    }
    if (!Object.keys(moves).length) throw new Error('no live data');
    render(moves);
  }

  main().catch(() => {
    document.getElementById('dashboard-time').textContent = 'Live dashboard unavailable';
    document.getElementById('dashboard-lines').textContent = '(Yahoo Finance request failed)';
    document.getElementById('dashboard-regime').textContent = 'Regime: —';
  });
})();
