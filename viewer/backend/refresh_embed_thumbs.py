"""
Refresh Pornhub embed post metadata using the Pornhub webmasters API.

For each post in the library with source_type='pornhub', fetches current
thumbnail and tags from the public API and updates the DB.

Usage from app.py:
    from refresh_embed_thumbs import refresh_embed_thumbs
    refresh_embed_thumbs()          # background thread (default)
    refresh_embed_thumbs(background=False)  # blocking, for CLI/testing

Flask route to trigger manually:
    POST /api/pornhub/refresh
"""

import re
import threading

import requests

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

_VIEWKEY_RE = re.compile(r'pornhub\.com/embed/([a-zA-Z0-9]+)', re.I)
_PH_API     = 'https://www.pornhub.com/webmasters/video_by_id'


def _extract_viewkey(embed_url: str) -> str | None:
    m = _VIEWKEY_RE.search(embed_url or '')
    return m.group(1) if m else None


def _fetch_ph_metadata(viewkey: str) -> dict | None:
    """
    Call the Pornhub webmasters API and return a dict with:
      thumb   — permanent thumbnail URL (no expiry token)
      tags    — list of tag slugs
    Returns None on any failure.
    """
    try:
        resp = requests.get(
            _PH_API,
            params={'id': viewkey},
            headers=HEADERS,
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        video = data.get('video') or {}
        if not video:
            return None

        # Thumbnail — prefer 'thumb' key, fall back to first in 'thumbs'
        thumb = video.get('thumb') or ''
        if not thumb:
            thumbs = video.get('thumbs') or []
            thumb = thumbs[0].get('src', '') if thumbs else ''

        # Tags — list of {tag_name: '...'} dicts
        raw_tags = video.get('tags') or []
        tags = [
            t['tag_name'].lower().replace(' ', '_')
            for t in raw_tags if t.get('tag_name')
        ]

        return {'thumb': thumb, 'tags': tags}

    except Exception as exc:
        print(f'[ph-refresh] API error for viewkey {viewkey}: {exc}')
        return None


def _upsert_tags(db, post_id: int, tag_names: list[str]):
    """Insert any new tags and link them to the post, replacing existing links."""
    if not tag_names:
        return

    # Remove old tag links for this post
    db.execute('DELETE FROM post_tags WHERE post_id = %s', (post_id,))

    for name in tag_names:
        name = name.strip()
        if not name:
            continue
        # Upsert tag
        db.execute(
            'INSERT INTO tags (name) VALUES (%s) ON CONFLICT (name) DO NOTHING',
            (name,),
        )
        row = db.execute('SELECT id FROM tags WHERE name = %s', (name,)).fetchone()
        if row:
            db.execute(
                'INSERT INTO post_tags (post_id, tag_id) VALUES (%s, %s) ON CONFLICT DO NOTHING',
                (post_id, row['id']),
            )


def _run(quiet: bool) -> dict:
    from db import get_db

    db = get_db()
    results = {'updated': 0, 'failed': 0, 'skipped': 0, 'total': 0}
    try:
        rows = db.execute(
            "SELECT id, file_url FROM posts WHERE source_type = 'pornhub'"
        ).fetchall()

        results['total'] = len(rows)

        if not rows:
            if not quiet:
                print('[ph-refresh] no Pornhub posts found.')
            return results

        for row in rows:
            post_id   = row['id']
            embed_url = row['file_url']
            viewkey   = _extract_viewkey(embed_url)

            if not viewkey:
                results['skipped'] += 1
                continue

            meta = _fetch_ph_metadata(viewkey)
            if not meta:
                results['failed'] += 1
                continue

            # Update thumbnail
            if meta['thumb']:
                db.execute(
                    'UPDATE posts SET thumb_cdn = %s WHERE id = %s',
                    (meta['thumb'], post_id),
                )

            # Update tags
            if meta['tags']:
                _upsert_tags(db, post_id, meta['tags'])

            results['updated'] += 1
            if not quiet:
                print(f'[ph-refresh] updated post {post_id} (viewkey={viewkey})')

        db.commit()
        if not quiet:
            print(
                f'[ph-refresh] done — '
                f'{results["updated"]} updated, '
                f'{results["failed"]} failed, '
                f'{results["skipped"]} skipped '
                f'(of {results["total"]} total)'
            )

    except Exception as exc:
        db.rollback()
        print(f'[ph-refresh] fatal error: {exc}')
    finally:
        db.close()

    return results


# ── Public API ────────────────────────────────────────────────────────────────

_refresh_lock = threading.Lock()
_refresh_status = {'running': False, 'last': None}


def refresh_embed_thumbs(*, background: bool = True, quiet: bool = False):
    """
    Refresh all Pornhub post thumbnails and tags from the webmasters API.

    background=True  — runs in a daemon thread, returns immediately.
    background=False — blocks until complete (useful for CLI / testing).
    """
    if background:
        t = threading.Thread(target=_run, args=(quiet,), daemon=True)
        t.start()
    else:
        return _run(quiet)


def run_refresh_for_route() -> dict:
    """
    Called from the Flask route. Prevents concurrent runs.
    Returns a status dict for the JSON response.
    """
    with _refresh_lock:
        if _refresh_status['running']:
            return {'status': 'already_running'}
        _refresh_status['running'] = True

    try:
        results = _run(quiet=False)
        _refresh_status['last'] = results
        return {'status': 'ok', **results}
    finally:
        with _refresh_lock:
            _refresh_status['running'] = False