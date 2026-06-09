"""Resolve external URLs into library-ready post metadata."""
import re
from urllib.parse import urlparse, parse_qs

import requests

from database import infer_rule34_media_type

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

_DIRECT_EXT = re.compile(
    r'\.(jpg|jpeg|png|gif|webp|bmp|mp4|webm|mov|m4v)(\?|#|$)', re.I,
)
_HUB_POST_RE = re.compile(
    r'rule34hub\.com/post/(\d+)', re.I,
)
_R34_POST_RE = re.compile(
    r'rule34\.xxx/index\.php\?page=post&s=view&id=(\d+)|rule34\.xxx/.*[?&]id=(\d+)', re.I,
)
_SIZE_SUFFIX_RE = re.compile(r'\.pic(?:preview|small|256|480)\.', re.I)
_MULTPORN_RE = re.compile(r'multporn\.net/', re.I)

# Maps a known extension to its media type, used for force-import sniffing
_EXT_TO_MEDIA: dict[str, str] = {
    'jpg': 'image', 'jpeg': 'image', 'png': 'image',
    'gif': 'image', 'webp': 'image', 'bmp': 'image',
    'mp4': 'video', 'webm': 'video', 'mov': 'video', 'm4v': 'video',
}


def _is_direct_media_url(url: str) -> bool:
    path = urlparse(url).path.lower()
    return bool(_DIRECT_EXT.search(path))


def _sniff_extension_from_url(url: str) -> str | None:
    """
    Try to find a media extension anywhere in the URL — path or query params.
    Returns the extension (e.g. 'mp4') or None.
    """
    # Check path first (normal case)
    path = urlparse(url).path.lower()
    m = _DIRECT_EXT.search(path)
    if m:
        return m.group(1)

    # Check query-string values (e.g. ?file=something.mp4&token=...)
    qs = parse_qs(urlparse(url).query)
    for values in qs.values():
        for v in values:
            m = _DIRECT_EXT.search(v.lower())
            if m:
                return m.group(1)

    return None


def _hub_post_id(url: str):
    m = _HUB_POST_RE.search(url)
    return int(m.group(1)) if m else None


def _r34_post_id(url: str):
    m = _R34_POST_RE.search(url)
    if not m:
        return None
    return int(m.group(1) or m.group(2))


def _pick_best_hub_file(urls, post_id: int):
    """Prefer full-quality file for this hub post id."""
    pid = str(post_id)
    scoped = [u for u in urls if f'/{pid}/' in u or f'/{pid}.' in u]
    if not scoped:
        scoped = urls

    def score(u: str) -> int:
        low = u.lower()
        if _SIZE_SUFFIX_RE.search(low):
            return 10
        if 'thumb' in low or 'preview' in low or 'sample' in low:
            return 5
        if low.endswith('.mp4') or low.endswith('.webm') or '.mov' in low:
            return 100
        if low.endswith(('.jpg', '.jpeg', '.png', '.webp', '.gif')):
            return 90
        return 20

    return max(scoped, key=score) if scoped else None


def _extract_hub_tags(html: str):
    tags = []
    for m in re.finditer(
        r'href=["\']/tag/([^"\']+)["\'][^>]*>([^<]+)</a>', html, re.I,
    ):
        name = m.group(1).replace('%20', '_').replace(' ', '_').lower()
        if name and name not in tags:
            tags.append(name)
    return tags[:80]


def resolve_rule34hub(url: str, html: str, hub_id: int) -> dict:
    file_url = None
    thumb = None

    m = re.search(
        r'<video[^>]*id=["\']post-video["\'][^>]*>.*?<source[^>]+src=["\']([^"\']+)',
        html, re.I | re.S,
    )
    if m:
        file_url = m.group(1)

    if not file_url:
        m = re.search(
            r'<img[^>]*id=["\']post-image["\'][^>]+src=["\']([^"\']+)',
            html, re.I,
        )
        if m:
            file_url = m.group(1)
            thumb = file_url

    if not file_url:
        storage_urls = re.findall(r'https://rule34storage\.b-cdn\.net/[^"\']+', html)
        file_url = _pick_best_hub_file(storage_urls, hub_id)

    if not file_url:
        raise ValueError('Could not find media file on rule34hub page')

    if not thumb:
        thumb = re.sub(r'\.mov\d*\.mp4$', '.picpreview.jpg', file_url, flags=re.I)
        if thumb == file_url:
            thumb = file_url

    tags = _extract_hub_tags(html)
    media_type = infer_rule34_media_type(file_url, tags)

    return {
        'source_type': 'rule34hub',
        'rule34hub_id': hub_id,
        'rule34_api_id': None,
        'file_url': file_url,
        'cdn_url': file_url,
        'thumb_cdn': thumb,
        'hub_url': url.split('?')[0],
        'media_type': media_type,
        'media_category': 'library',
        'tags': tags,
        'resolved_by': 'rule34hub_import',
    }


def resolve_direct_url(url: str, forced_ext: str | None = None) -> dict:
    """
    Resolve a direct media URL.

    forced_ext: if provided (e.g. 'mp4'), skip extension detection and use this
    to determine media_type. Use this for URLs like CDN links with tokens where
    the extension appears in a query param rather than the path.
    """
    if forced_ext:
        media_type = _EXT_TO_MEDIA.get(forced_ext.lower(), 'image')
    else:
        media_type = infer_rule34_media_type(url)

    return {
        'source_type': 'manual',
        'rule34hub_id': None,
        'rule34_api_id': None,
        'file_url': url,
        'cdn_url': url,
        'thumb_cdn': url,
        'hub_url': url,
        'media_type': media_type,
        'media_category': 'imported',
        'tags': [],
        'resolved_by': 'url_import',
    }


def _multporn_scrape(url: str) -> dict:
    """
    Scrape a multporn.net page directly with BeautifulSoup.
    Replaces the multporn library which crashes on pages missing optional
    metadata fields (Author, Characters, Tags) due to unguarded .find_next() calls.
    """
    from bs4 import BeautifulSoup

    clean_url = url.split('?')[0]
    resp = requests.get(clean_url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'html.parser')

    # Title
    title_meta = soup.find('meta', attrs={'name': 'dcterms.title'})
    title = title_meta['content'].strip() if title_meta else clean_url.split('/')[-1]

    # Content type is the URL path segment: comics, hentai_manga, videos, etc.
    content_type = clean_url.rstrip('/').split('/')[3].lower() if len(clean_url.split('/')) > 3 else 'comics'
    is_video = 'video' in content_type

    def _safe_field(label: str) -> list[str]:
        """Find a labelled field like 'Tags: ' and return its linked text values."""
        node = soup.find(string=label)
        if not node:
            return []
        next_el = node.find_next()
        if not next_el:
            return []
        results = []
        for item in next_el.contents:
            try:
                text = item.get_text(strip=True) if hasattr(item, 'get_text') else str(item).strip()
                if text:
                    results.append(text)
            except Exception:
                pass
        return results

    tags = _safe_field('Tags: ')
    artists = _safe_field('Author: ')
    characters = _safe_field('Characters: ')

    # Combine into tag list, slugifying everything
    all_tags = []
    seen = set()
    for t in tags + artists + characters:
        slug = t.lower().replace(' ', '_')
        if slug and slug not in seen:
            all_tags.append(slug)
            seen.add(slug)
    # Always mark as comic so the viewer knows to use carousel mode
    if 'is_comic' not in seen and not is_video:
        all_tags.append('is_comic')

    if is_video:
        video_tag = soup.find('video')
        source_tag = video_tag.find('source') if video_tag else None
        file_url = (source_tag or {}).get('src', '') if source_tag else ''
        thumb = video_tag.get('poster', '') if video_tag else ''
        if not file_url:
            raise ValueError(f'Could not find video source on multporn page: {clean_url}')
        return {
            'source_type': 'multporn',
            'rule34hub_id': None,
            'rule34_api_id': None,
            'file_url': file_url,
            'cdn_url': file_url,
            'thumb_cdn': thumb or file_url,
            'hub_url': clean_url,
            'media_type': 'video',
            'media_category': 'imported',
            'tags': all_tags,
            'title': title,
            'resolved_by': 'multporn_import',
        }

    # Comic / picture album — collect all page images
    page_imgs = soup.find_all('p', class_='jb-image')
    content_urls = []
    for p in page_imgs:
        img = p.find('img')
        if img and img.get('src'):
            content_urls.append(img['src'])

    if not content_urls:
        raise ValueError(f'No pages found on multporn page: {clean_url}')

    thumb = content_urls[0]
    return {
        'source_type': 'multporn',
        'rule34hub_id': None,
        'rule34_api_id': None,
        'file_url': content_urls[0],
        'cdn_url': content_urls[0],
        'thumb_cdn': thumb,
        'hub_url': clean_url,
        'media_type': 'comic',
        'media_category': 'imported',
        'tags': all_tags,
        'title': title,
        'page_count': len(content_urls),
        'page_urls': content_urls,
        'resolved_by': 'multporn_import',
    }


def resolve_multporn(url: str) -> dict:
    """Resolve a multporn.net comic/video/album URL."""
    return _multporn_scrape(url)


def resolve_import_url(url: str, *, fetch_r34_post=None, force: bool = False) -> dict:
    """
    Return normalised post fields for inserting into the library.

    force=True  — skip URL-pattern recognition and treat the URL as a direct
                  media link. Useful for CDN URLs where the file extension is
                  buried in a query parameter rather than the path (e.g. FPO
                  token-gated .mp4 links). The extension is sniffed from
                  anywhere in the URL; if nothing is found the file is assumed
                  to be a video (most common use-case for force-import).
    """
    url = (url or '').strip()
    if not url:
        raise ValueError('URL is required')

    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url

    # ── Force mode ──────────────────────────────────────────────────────────
    if force:
        ext = _sniff_extension_from_url(url)
        if ext is None:
            # Default to video when we truly can't tell — caller opted in
            ext = 'mp4'
        return resolve_direct_url(url, forced_ext=ext)

    # ── Multporn ─────────────────────────────────────────────────────────────
    if _MULTPORN_RE.search(url):
        return resolve_multporn(url)

    # ── Rule34hub ────────────────────────────────────────────────────────────
    hub_id = _hub_post_id(url)
    if hub_id is not None:
        resp = requests.get(url.split('?')[0], headers=HEADERS, timeout=20)
        resp.raise_for_status()
        return resolve_rule34hub(url, resp.text, hub_id)

    # ── Rule34.xxx ───────────────────────────────────────────────────────────
    r34_id = _r34_post_id(url)
    if r34_id is not None:
        if not fetch_r34_post:
            raise ValueError('R34 resolver not configured')
        r34 = fetch_r34_post(r34_id)
        if not r34:
            raise ValueError(f'No rule34 post found for id {r34_id}')
        file_url = r34.get('file_url', '')
        preview = r34.get('preview_url', '')
        tags = [t for t in r34.get('tags', '').split() if t]
        return {
            'source_type': 'rule34',
            'rule34hub_id': r34_id,
            'rule34_api_id': r34_id,
            'file_url': file_url,
            'cdn_url': file_url,
            'thumb_cdn': preview or file_url,
            'hub_url': f'https://rule34.xxx/index.php?page=post&s=view&id={r34_id}',
            'media_type': infer_rule34_media_type(file_url, tags),
            'media_category': 'library',
            'tags': tags,
            'resolved_by': 'r34_url_import',
        }

    # ── Direct URL ───────────────────────────────────────────────────────────
    if _is_direct_media_url(url):
        return resolve_direct_url(url)

    raise ValueError(
        'Unsupported URL. Use a direct image/video link, rule34.xxx post URL, '
        'rule34hub.com post URL, or multporn.net comic/video URL. '
        'For token-gated CDN links (e.g. FPO), use force=True.'
    )