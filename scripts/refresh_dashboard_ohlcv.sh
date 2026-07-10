#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(cd "$PROJECT_DIR/../.." && pwd)"
export ROOT
OUT="$ROOT/store/ohlcv/yfinance/1y-1d"
CACHE_YF="$ROOT/projects/ibd-cache-yf/cache_yf.py"

TICKERS=(QQQ SPY IWM TLT UUP USO GLD COPX '^VIX' 'ES=F' 'YM=F' 'NQ=F')

cd "$ROOT/projects/rt-options"
. .venv/bin/activate

la_hour=$(TZ=America/Los_Angeles date +%H)
include_futures=0
if (( 10#$la_hour >= 18 || 10#$la_hour < 6 )); then
  include_futures=1
fi

for t in "${TICKERS[@]}"; do
  if [[ "$t" =~ =(F)$ ]] && [[ "$include_futures" -ne 1 ]]; then
    continue
  fi
  python "$CACHE_YF" "$t" --out "$OUT" --period 1y --interval 1d --skip-if-updated-today >/dev/null || true
done

mkdir -p "$ROOT/store/status"
python3 - <<'PY'
import datetime as dt
import json
import os
path = os.path.join(os.environ["ROOT"], "store/status/cross-asset-dashboard.json")
obj = {"refreshed_at": dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00','Z')}
open(path, 'w', encoding='utf-8').write(json.dumps(obj, indent=2))
PY

FIN_NEWS_SWEEP_BASE_URL=https://markets.dealzen.ai \
FIN_NEWS_SWEEP_NEW_HOURS=4 \
  "$PROJECT_DIR/scripts/refresh_and_push.sh"
