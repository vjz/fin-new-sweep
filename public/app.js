(() => {
  function cleanTicker(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '').slice(0, 16);
  }

  document.querySelectorAll('form[data-ticker-nav]').forEach((form) => {
    const input = form.querySelector('input[name="ticker"]');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const ticker = cleanTicker(input?.value);
      if (!ticker) {
        input?.focus();
        return;
      }
      window.location.href = `/fund/?ticker=${encodeURIComponent(ticker)}`;
    });
  });
})();
