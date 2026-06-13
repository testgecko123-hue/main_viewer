"""
Audit Pornhub post thumbnails — checks which ones are broken.

Run locally:
    python audit_ph_thumbs.py

Outputs a summary and writes broken/ok post IDs to audit_results.json
so refresh_embed_thumbs.py can target only the broken ones.
"""

import json
import os
import re
import sys
import concurrent.futures
from pathlib import Path

import requests
import psycopg2
from psycopg2.extras import RealDictCursor

# ── Config ────────────────────────────────────────────────────────────────────

DATABASE_URL = (
    os.getenv('DATABASE_URL')
    or 'postgresql://postgres.snauedoixaynqbldzmyi:tEMaDbPRp2jo32p9@aws-1-eu-west-2.pooler.supabase.com:6543/postgres?sslmode=require'
)
WORKERS      = 10   # concurrent HEAD requests
TIMEOUT      = 8    # seconds per request
OUTPUT_FILE  = Path(__file__).parent / 'audit_results.json'

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

_EXPIRY_RE = re.compile(r'validto=|hdnea=', re.I)

def is_expiring(url: str) -> bool:
    return bool(_EXPIRY_RE.search(url or ''))

def check_thumb(post: dict) -> dict:
    """HEAD-request the thumbnail URL and return result."""
    url = post['thumb_cdn'] or ''
    if not url:
        return {**post, 'status': 'missing', 'expiring': False}

    expiring = is_expiring(url)
    try:
        r = requests.head(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
        ok = r.status_code == 200
    except Exception:
        ok = False

    return {**post, 'status': 'ok' if ok else 'broken', 'expiring': expiring}

# ── Main ──────────────────────────────────────────────────────────────────────

print('Connecting to Supabase...')
conn = psycopg2.connect(DATABASE_URL)
if hasattr(conn, 'prepare_threshold'):
    conn.prepare_threshold = None

cur = conn.cursor(cursor_factory=RealDictCursor)
cur.execute("SELECT id, file_url, thumb_cdn FROM posts WHERE source_type = 'pornhub'")
rows = [dict(r) for r in cur.fetchall()]
cur.close()
conn.close()

print(f'Checking {len(rows)} Pornhub posts...')

results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
    futures = {ex.submit(check_thumb, r): r for r in rows}
    done = 0
    for f in concurrent.futures.as_completed(futures):
        result = f.result()
        results.append(result)
        done += 1
        if done % 10 == 0:
            print(f'  {done}/{len(rows)}...', flush=True)

ok       = [r for r in results if r['status'] == 'ok' and not r['expiring']]
expiring = [r for r in results if r['status'] == 'ok' and r['expiring']]
broken   = [r for r in results if r['status'] == 'broken']
missing  = [r for r in results if r['status'] == 'missing']

print(f'\n── Audit Results ──────────────────────────────')
print(f'  ✓ OK (permanent):  {len(ok)}')
print(f'  ⚠ OK (expiring):   {len(expiring)}')
print(f'  ✗ Broken:          {len(broken)}')
print(f'  ✗ Missing:         {len(missing)}')
print(f'  Total:             {len(results)}')

# Save results for use by refresh script
output = {
    'ok':       [r['id'] for r in ok],
    'expiring': [r['id'] for r in expiring],
    'broken':   [r['id'] for r in broken],
    'missing':  [r['id'] for r in missing],
    'details':  results,
}
OUTPUT_FILE.write_text(json.dumps(output, indent=2))
print(f'\nResults saved to {OUTPUT_FILE}')

if broken or missing:
    print(f'\nBroken/missing posts (need refresh):')
    for r in broken + missing:
        print(f'  post {r["id"]} — {r["thumb_cdn"] or "NO URL"}')