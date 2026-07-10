#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(cd "$PROJECT_DIR/../.." && pwd)"

# Refresh RSS inbox (local, private)
python3 "$ROOT/scripts/news_sweep_cli.py" fetch >/dev/null

# Generate public static page
cd "$PROJECT_DIR"
python3 scripts/generate.py >/dev/null

# Commit + push if changed
if git diff --quiet -- public/index.html public/app.css public/app.js public/dashboard.js public/fund/index.html public/fund/fund.js functions/api/chart.js functions/api/fund/[ticker].js public/robots.txt public/sitemap.xml \
  && git diff --cached --quiet -- public/index.html public/app.css public/app.js public/dashboard.js public/fund/index.html public/fund/fund.js functions/api/chart.js functions/api/fund/[ticker].js public/robots.txt public/sitemap.xml \
  && [[ -z "$(git ls-files --others --exclude-standard public/app.css public/app.js public/dashboard.js public/fund/index.html public/fund/fund.js functions/api/chart.js functions/api/fund/[ticker].js)" ]]; then
  exit 0
fi

git add public/index.html public/app.css public/app.js public/dashboard.js public/fund/index.html public/fund/fund.js functions/api/chart.js functions/api/fund/[ticker].js public/robots.txt public/sitemap.xml

git commit -m "Update site $(date -u +'%Y-%m-%dT%H:%MZ')" >/dev/null || exit 0

# Push using token (not stored in git remote)
if [[ -z "${FIN_NEWS_SWEEP_GITHUB_TOKEN:-}" ]]; then
  echo "Missing FIN_NEWS_SWEEP_GITHUB_TOKEN" >&2
  exit 2
fi

remote="https://x-access-token:${FIN_NEWS_SWEEP_GITHUB_TOKEN}@github.com/vjz/fin-new-sweep.git"
git push "$remote" main >/dev/null
