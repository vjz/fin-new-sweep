# fin-new-sweep
Market Sweep

## Fund endpoint

- UI: `/fund/`
- Text API: `/api/fund/WMT`
- JSON API: `/api/fund/WMT?format=json`

The fund endpoint runs as a Cloudflare Pages Function. It uses SEC companyfacts
for annual GAAP EPS/revenue, third-party market data for live-ish price/name
data, SEC submissions/latest 10-K Item 1 for profile and company description,
and the `FUND_CACHE` KV binding when available.
