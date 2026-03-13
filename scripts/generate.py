#!/usr/bin/env python3
"""Generate the public static page from the local OpenClaw news-sweep inbox.

Inputs (read-only):
- /home/vjshrike/clawd/store/news-sweep/inbox.json
- (optional) stdout of news_sweep_cli.py summary --from-inbox

Output:
- public/index.html

Goal: a Techmeme-ish front page: storyline summary + top links.
"""

from __future__ import annotations

import datetime as dt
import html
import json
import os
import subprocess
from urllib.parse import urlparse

ROOT = "/home/vjshrike/clawd"
INBOX = os.path.join(ROOT, "store/news-sweep/inbox.json")
NEWS_SWEEP_CLI = os.path.join(ROOT, "scripts/news_sweep_cli.py")

SITE_TITLE = os.getenv("FIN_NEWS_SWEEP_TITLE", "Fin New Sweep")
TOP_N = int(os.getenv("FIN_NEWS_SWEEP_TOP_N", "20"))

# Mark paywalled domains (keep links, but label).
PAYWALLED = {
    "ft.com",
    "wsj.com",
    "economist.com",
    "bloomberg.com",
    "theinformation.com",
    "nytimes.com",
}


def read_inbox() -> dict:
    with open(INBOX, "r", encoding="utf-8") as f:
        obj = json.load(f)
    return obj if isinstance(obj, dict) else {}


def run_summary() -> str:
    """Run the local CLI summary (best-effort)."""
    try:
        p = subprocess.run(
            ["python3", NEWS_SWEEP_CLI, "summary", "--from-inbox"],
            text=True,
            capture_output=True,
            timeout=20,
        )
        out = (p.stdout or "").strip()
        if out:
            return out
    except Exception:
        pass
    return ""


def domain(url: str) -> str:
    try:
        netloc = urlparse(url).netloc.lower()
        if netloc.startswith("www."):
            netloc = netloc[4:]
        return netloc
    except Exception:
        return ""


def is_paywalled(dom: str) -> bool:
    if not dom:
        return False
    if dom in PAYWALLED:
        return True
    # subdomains
    return any(dom.endswith("." + d) for d in PAYWALLED)


def html_page(*, generated_at: str, summary_text: str, items: list[dict]) -> str:
    def esc(s: str) -> str:
        return html.escape(s or "")

    # Build top links list
    lis = []
    for it in items[:TOP_N]:
        title = str(it.get("title") or "").strip()
        link = str(it.get("link") or "").strip()
        src = str(it.get("source") or "").strip()
        if not title or not link:
            continue
        dom = domain(link)
        pw = " <span class=\"pill\">paywalled</span>" if is_paywalled(dom) else ""
        src_txt = f"<span class=\"src\">{esc(src)}</span>" if src else ""
        lis.append(
            f"<li><a href=\"{esc(link)}\" target=\"_blank\" rel=\"noopener noreferrer\">{esc(title)}</a> {src_txt}{pw}</li>"
        )

    summary_html = ""
    if summary_text:
        # Preserve line breaks as <pre> but keep styling nice
        summary_html = f"<pre class=\"summary\">{esc(summary_text)}</pre>"

    return f"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <title>{esc(SITE_TITLE)}</title>
  <style>
    :root {{ color-scheme: light dark; }}
    body {{ font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 24px; max-width: 980px; }}
    h1 {{ margin: 0 0 8px 0; }}
    .meta {{ opacity: 0.8; margin-bottom: 16px; }}
    .grid {{ display: grid; grid-template-columns: 1fr; gap: 18px; }}
    @media (min-width: 900px) {{ .grid {{ grid-template-columns: 1fr 1fr; }} }}
    .card {{ border: 1px solid rgba(127,127,127,0.35); border-radius: 12px; padding: 14px 16px; }}
    .summary {{ white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace; font-size: 13px; line-height: 1.35; }}
    ul {{ margin: 0; padding-left: 18px; }}
    li {{ margin: 8px 0; }}
    a {{ text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
    .src {{ margin-left: 6px; opacity: 0.8; font-size: 12px; }}
    .pill {{ display: inline-block; margin-left: 8px; font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(127,127,127,0.35); opacity: 0.85; }}
    footer {{ margin-top: 24px; opacity: 0.7; font-size: 12px; }}
  </style>
</head>
<body>
  <h1>{esc(SITE_TITLE)}</h1>
  <div class=\"meta\">Generated at {esc(generated_at)}</div>

  <div class=\"grid\">
    <div class=\"card\">
      <h2 style=\"margin-top:0\">RSS summary</h2>
      {summary_html or '<div style="opacity:0.8">(summary unavailable)</div>'}
    </div>

    <div class=\"card\">
      <h2 style=\"margin-top:0\">Top links</h2>
      <ul>
        {''.join(lis) if lis else '<li>(no links)</li>'}
      </ul>
    </div>
  </div>

  <footer>
    Built from a local RSS inbox; only this rendered page is public.
  </footer>
</body>
</html>"""


def main() -> int:
    inbox = read_inbox()
    items = inbox.get("items") or []
    if not isinstance(items, list):
        items = []

    # sort by published desc (string RFC822-ish; keep stable even if parse fails)
    def k(it: dict):
        return str(it.get("published") or "")

    items_sorted = sorted([it for it in items if isinstance(it, dict)], key=k, reverse=True)

    summary_text = run_summary()
    generated_at = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")

    out_html = html_page(generated_at=generated_at, summary_text=summary_text, items=items_sorted)

    out_dir = os.path.join(os.getcwd(), "public")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "index.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(out_html)

    print(out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
