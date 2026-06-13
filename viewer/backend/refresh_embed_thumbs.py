"""
Refresh Pornhub embed post metadata.

Thumbnail strategy (in priority order):
  1. CSV lookup — permanent ei.phncdn.com URLs, no expiry tokens
  2. Pornhub webmasters API — expiring URLs, used as fallback when CSV has
     a dead/missing thumbnail for that video
  3. Leave existing thumb unchanged if both sources fail

Tags always come from the API.

Usage from app.py:
    from refresh_embed_thumbs import refresh_embed_thumbs, run_refresh_for_route
    refresh_embed_thumbs()   # background thread
"""

import json
import re
import threading
from pathlib import Path

import requests

HEADERS     = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
_VIEWKEY_RE = re.compile(r'pornhub\.com/embed/([a-zA-Z0-9]+)', re.I)
_EXPIRY_RE  = re.compile(r'validto=|hdnea=', re.I)
_PH_API     = 'https://www.pornhub.com/webmasters/video_by_id'

# Path to the local CSV — only used if present
CSV_PATH = Path(r'C:\Users\Michael\Downloads\pornhub.com-db\pornhub.com-db.csv')

# Audit results written by audit_ph_thumbs.py — if present, only refresh
# posts flagged as broken/expiring/missing instead of all posts
AUDIT_PATH = Path(__file__).parent / 'audit_results.json'


def _extract_viewkey(embed_url: str) -> str | None:
    m = _VIEWKEY_RE.search(embed_url or '')
    return m.group(1) if m else None


def _is_expiring(url: str) -> bool:
    return bool(_EXPIRY_RE.search(url or ''))


def _is_dead_ei(url: str) -> bool:
    """ei.phncdn.com URLs from the CSV snapshot are often dead."""
    return bool(url and 'ei.phncdn.com' in url)


# ── CSV lookup (runs once, cached) ───────────────────────────────────────────

_csv_cache: dict[str, str] | None = None
_csv_lock = threading.Lock()


def _load_csv_cache() -> dict[str, str]:
    """
    Build a viewkey → thumbnail dict from the local CSV using DuckDB.
    Returns empty dict if CSV not present or DuckDB not installed.
    """
    global _csv_cache
    with _csv_lock:
        if _csv_cache is not None:
            return _csv_cache

        if not CSV_PATH.is_file():
            print('[ph-refresh] CSV not found, skipping CSV lookup.')
            _csv_cache = {}
            return _csv_cache

        try:
            import duckdb
            print(f'[ph-refresh] loading CSV thumbnail index from {CSV_PATH}...')
            duck = duckdb.connect()
            rows = duck.execute(f"""
                SELECT
                    regexp_extract(column00, 'pornhub\\.com/embed/([a-zA-Z0-9]+)', 1) AS viewkey,
                    column01 AS thumb
                FROM read_csv_auto('{str(CSV_PATH)}')
                WHERE column01 != ''
                  AND column01 NOT LIKE '%validto=%'
                  AND column01 NOT LIKE '%hdnea=%'
                  AND column01 NOT LIKE '%ei.phncdn.com%'
            """).fetchall()
            duck.close()
            _csv_cache = {vk: thumb for vk, thumb in rows if vk}
            print(f'[ph-refresh] CSV index loaded — {len(_csv_cache)} permanent thumbnails.')
        except Exception as exc:
            print(f'[ph-refresh] CSV load failed: {exc}')
            _csv_cache = {}

        return _csv_cache


# ── Pornhub API ───────────────────────────────────────────────────────────────

def _fetch_ph_metadata(viewkey: str) -> dict | None:
    try:
        resp = requests.get(_PH_API, params={'id': viewkey}, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        video = data.get('video') or {}
        if not video:
            return None

        # Try to find a non-expiring thumb from the API (pix-cdn77 with hash=)
        # These still expire via validto= but last ~24hrs which is acceptable
        thumb = ''
        for t in (video.get('thumbs') or []):
            src = t.get('src', '')
            if 'pix-cdn77' in src:
                thumb = src
                break
        if not thumb:
            thumb = video.get('thumb') or video.get('default_thumb') or ''

        tags = [
            t['tag_name'].lower().replace(' ', '_')
            for t in (video.get('tags') or []) if t.get('tag_name')
        ]

        return {'thumb': thumb, 'tags': tags, 'is_expiring': _is_expiring(thumb)}

    except Exception as exc:
        print(f'[ph-refresh] API error for viewkey {viewkey}: {exc}')
        return None


# ── Tag upsert ────────────────────────────────────────────────────────────────

def _upsert_tags(db, post_id: int, tag_names: list[str]):
    if not tag_names:
        return
    db.execute('DELETE FROM post_tags WHERE post_id = %s', (post_id,))
    for name in tag_names:
        name = name.strip()
        if not name:
            continue
        db.execute('INSERT INTO tags (name) VALUES (%s) ON CONFLICT (name) DO NOTHING', (name,))
        row = db.execute('SELECT id FROM tags WHERE name = %s', (name,)).fetchone()
        if row:
            db.execute(
                'INSERT INTO post_tags (post_id, tag_id) VALUES (%s, %s) ON CONFLICT DO NOTHING',
                (post_id, row['id']),
            )


# ── Main refresh logic ────────────────────────────────────────────────────────

def _run(quiet: bool, post_ids: list[int] | None = None) -> dict:
    from db import get_db

    csv_cache = _load_csv_cache()
    db = get_db()
    results = {'updated': 0, 'failed': 0, 'skipped': 0,
               'used_csv': 0, 'used_api': 0, 'total': 0}
    try:
        if post_ids:
            placeholders = ','.join(['%s'] * len(post_ids))
            rows = db.execute(
                f"SELECT id, file_url, thumb_cdn FROM posts WHERE id IN ({placeholders})",
                post_ids,
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT id, file_url, thumb_cdn FROM posts WHERE source_type = 'pornhub'"
            ).fetchall()

        results['total'] = len(rows)

        if not rows:
            if not quiet:
                print('[ph-refresh] no posts to refresh.')
            return results

        for row in rows:
            post_id   = row['id']
            embed_url = row['file_url']
            viewkey   = _extract_viewkey(embed_url)

            if not viewkey:
                results['skipped'] += 1
                continue

            # ── Tags always from API ──────────────────────────────────────
            meta = _fetch_ph_metadata(viewkey)
            if not meta:
                results['failed'] += 1
                continue

            if meta['tags']:
                _upsert_tags(db, post_id, meta['tags'])

            # ── Thumbnail: CSV first, API fallback ────────────────────────
            csv_thumb = csv_cache.get(viewkey, '')
            if csv_thumb:
                # CSV has a permanent URL and it's not an ei.phncdn dead URL
                thumb = csv_thumb
                source = 'csv'
                results['used_csv'] += 1
            else:
                # Fall back to API thumb (may be expiring, better than broken)
                thumb = meta['thumb']
                source = 'api'
                results['used_api'] += 1

            if thumb:
                db.execute('UPDATE posts SET thumb_cdn = %s WHERE id = %s', (thumb, post_id))

            results['updated'] += 1
            if not quiet:
                expiry_flag = ' [expiring]' if _is_expiring(thumb) else ''
                print(f'[ph-refresh] post {post_id} ({source}{expiry_flag})')

        db.commit()
        if not quiet:
            print(
                f'[ph-refresh] done — {results["updated"]} updated '
                f'({results["used_csv"]} from CSV, {results["used_api"]} from API), '
                f'{results["failed"]} failed, {results["skipped"]} skipped '
                f'(of {results["total"]} total)'
            )

    except Exception as exc:
        db.rollback()
        print(f'[ph-refresh] fatal error: {exc}')
    finally:
        db.close()

    return results


# ── Public API ────────────────────────────────────────────────────────────────

_refresh_lock  = threading.Lock()
_refresh_state = {'running': False, 'last': None}


def refresh_embed_thumbs(*, background: bool = True, quiet: bool = False,
                         broken_only: bool = False):
    """
    Refresh Pornhub post thumbnails and tags.

    broken_only=True — only refresh posts flagged by audit_ph_thumbs.py
                       (broken + expiring + missing). Faster for scheduled runs.
    """
    post_ids = None
    if broken_only and AUDIT_PATH.is_file():
        audit = json.loads(AUDIT_PATH.read_text())
        post_ids = audit.get('broken', []) + audit.get('missing', []) + audit.get('expiring', [])
        if not post_ids:
            if not quiet:
                print('[ph-refresh] audit shows no posts need refresh, skipping.')
            return

    if background:
        t = threading.Thread(target=_run, args=(quiet, post_ids), daemon=True)
        t.start()
    else:
        return _run(quiet, post_ids)


def run_refresh_for_route() -> dict:
    """Called from the Flask /api/pornhub/refresh route."""
    with _refresh_lock:
        if _refresh_state['running']:
            return {'status': 'already_running'}
        _refresh_state['running'] = True
    try:
        results = _run(quiet=False)
        _refresh_state['last'] = results
        return {'status': 'ok', **results}
    finally:
        with _refresh_lock:
            _refresh_state['running'] = False