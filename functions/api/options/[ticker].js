function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300',
      'x-robots-tag': 'noindex',
      ...(init.headers || {}),
    },
  });
}

export async function onRequestGet() {
  return json({
    success: false,
    error: 'Options activity is not available on the public site.',
  }, { status: 404 });
}
