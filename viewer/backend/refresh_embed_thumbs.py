"""
Refresh thumbnails for Pornhub embed posts.

Scrapes the current image_url from each embed's page and updates thumb_cdn
in the posts table. Designed to be called at app startup from app.py:

    from refresh_embed_thumbs import refresh_embed_thumbs
    refresh_embed_thumbs()

Runs in a background thread so it doesn't block startup.
"""

import re
import threading

import requests

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

_IMAGE_URL_RE = re.compile(r'"image_url"\s*:\s*"([^"]+)"')
_VIEWKEY_RE   = re.compile(r'pornhub\.com/embed/([a-zA-Z0-9]+)', re.I)


def _scrape_thumb(embed_url: str) -> str | None:
    """Return the current thumbnail URL for a Pornhub embed, or None on failure."""
    try:
        resp = requests.get(embed_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        m = _IMAGE_URL_RE.search(resp.text)
        if m:
            return m.group(1).replace('\\/', '/')
    except Exception as exc:
        print(f'[thumb-refresh] failed to scrape {embed_url}: {exc}')
    return None


def _run(quiet: bool):
    # Import here so this module can be imported before db is initialised
    from db import get_db

    db = get_db()
    try:
        rows = db.execute(
            "SELECT id, file_url FROM posts WHERE media_type = 'embed' AND source_type = 'pornhub'"
        ).fetchall()

        if not rows:
            if not quiet:
                print('[thumb-refresh] no Pornhub embed posts found, skipping.')
            return

        updated = 0
        for row in rows:
            post_id   = row['id']
            embed_url = row['file_url']
            if not embed_url:
                continue

            thumb = _scrape_thumb(embed_url)
            if not thumb:
                continue

            db.execute(
                'UPDATE posts SET thumb_cdn = %s WHERE id = %s',
                (thumb, post_id),
            )
            updated += 1

        db.commit()
        if not quiet:
            print(f'[thumb-refresh] updated {updated}/{len(rows)} Pornhub thumbnails.')
    except Exception as exc:
        db.rollback()
        print(f'[thumb-refresh] error: {exc}')
    finally:
        db.close()


def refresh_embed_thumbs(*, background: bool = True, quiet: bool = False):
    """
    Refresh Pornhub embed thumbnails.

    background=True  (default) — runs in a daemon thread, returns immediately.
    background=False — blocks until complete (useful for CLI / testing).
    quiet=False      — prints progress; set True to silence.
    """
    if background:
        t = threading.Thread(target=_run, args=(quiet,), daemon=True)
        t.start()
    else:
        _run(quiet)