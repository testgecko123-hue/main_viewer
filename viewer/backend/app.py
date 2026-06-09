import logging
import time
import os
import subprocess
import shutil
import re
import threading
import queue
from concurrent.futures import ThreadPoolExecutor, as_completed

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s | %(message)s',
)

logger = logging.getLogger(__name__)
import json
import requests
import urllib.parse
from datetime import date, datetime
from flask import Flask, jsonify, request, make_response, Response
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS
from database import (
    init_db, get_db,
    search_posts, count_posts, get_post_with_tags, get_random_posts,
    get_browse_timeline_meta, get_stratified_random_posts,
    get_all_tags_with_counts, get_all_tag_groups, upsert_tag_group, delete_tag_group,
    get_collections, get_collection, create_collection, update_collection_posts,
    update_collection_meta, append_post_to_collection, record_collection_review_ignored,
    get_collection_review_queue,
    save_selection, get_selections, get_selection, promote_selection_to_collection,
    get_subscriptions, add_subscription, remove_subscription,
    get_feed_posts, upsert_feed_post, set_feed_post_status,
    infer_rule34_media_type,
    expand_tags_with_groups,
    import_post,
)
from media_import import resolve_import_url

app = Flask(__name__)


class _AppJSON(DefaultJSONProvider):
    def default(self, o):
        if isinstance(o, (datetime, date)):
            return o.isoformat()
        return super().default(o)


app.json = _AppJSON(app)

def _cors_origins():
    origins = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'https://localhost',
        'capacitor://localhost',
        # Private LAN dev (phone / other PCs on same network)
        re.compile(r'^https?://192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$'),
        re.compile(r'^https?://10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$'),
        re.compile(r'^https?://172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$'),
    ]
    raw = os.getenv('CORS_ORIGINS', '')
    origins.extend(o.strip() for o in raw.split(',') if o.strip())
    return origins


CORS(app, supports_credentials=True, origins=_cors_origins())

R34_API   = "https://api.rule34.xxx/index.php?page=dapi&s=post&q=index"
API_KEY   = "e4bbcb7881e3f87ce9c4289526dd6343ad2792022fa1b3cc41464030d05fca703565fbe627cb296ffce35e8422549e07d0bb9b94fd87433af5b6a94cc9702257"
USER_ID   = 4878639
HEADERS   = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

# How recent a tag fetch must be to be skipped (seconds). 8 minutes.
SKIP_IF_FETCHED_WITHIN_SECS = 8 * 60

# ── Auth / Whitelist ──────────────────────────────────────────────────────────
# Set VIEWER_AUTH_TOKEN in .env (or Render env vars). Clients authenticate via:
#   • Cookie from GET /auth?token=<token>  (browser / same-site)
#   • Header X-Viewer-Token: <token>       (Capacitor / cross-origin)
#   • Header Authorization: Bearer <token>
#   • Query ?viewer_token=<token>          (EventSource / SSE)

SECRET_TOKEN = os.getenv('VIEWER_AUTH_TOKEN', 'Test123')
COOKIE_NAME  = 'viewer_auth'


def _request_is_https():
    return request.is_secure or request.headers.get('X-Forwarded-Proto') == 'https'


def _is_authorized():
    if request.cookies.get(COOKIE_NAME) == SECRET_TOKEN:
        return True
    header_token = request.headers.get('X-Viewer-Token', '')
    if header_token and header_token == SECRET_TOKEN:
        return True
    auth_hdr = request.headers.get('Authorization', '')
    if auth_hdr.startswith('Bearer ') and auth_hdr[7:] == SECRET_TOKEN:
        return True
    if request.args.get('viewer_token') == SECRET_TOKEN:
        return True
    return False


@app.route('/auth')
def auth_gate():
    if request.args.get('token') == SECRET_TOKEN:
        resp = make_response('''
            <html><body style="font-family:sans-serif;padding:40px;background:#0d0d0d;color:#eee">
            <h2 style="color:#a3e635">&#10003; Device authorised</h2>
            <p>This device is whitelisted for 30 days. You can close this tab.</p>
            </body></html>
        ''')
        secure = _request_is_https()
        resp.set_cookie(
            COOKIE_NAME, SECRET_TOKEN,
            max_age=60 * 60 * 24 * 30,
            httponly=True,
            secure=secure,
            samesite='None' if secure else 'Lax',
        )
        return resp
    return '', 403


@app.before_request
def check_auth():
    logger.info(f"{request.method} {request.path} | args={dict(request.args)}")
    if request.method == 'OPTIONS':
        return
    if request.remote_addr in ('127.0.0.1', '::1'):
        return
    if request.path == '/auth':
        return
    if not _is_authorized():
        return '', 403


@app.route('/')
def serve_frontend():
    return jsonify({"status": "ok", "message": "API running. Frontend at http://localhost:3000"})

# ── Posts ─────────────────────────────────────────────────────────────────────

def _parse_post_filters():
    """Common tag/media/date filters from query string."""
    return {
        'needed':       request.args.getlist('needed'),
        'optional':     request.args.getlist('optional'),
        'exclude':      request.args.getlist('exclude'),
        'media_type':   request.args.get('media_type') or None,
        'source_type':  request.args.get('source_type') or None,
        'media_category': request.args.get('media_category') or None,
        'created_after':  request.args.get('created_after') or None,
        'created_before': request.args.get('created_before') or None,
    }

@app.route('/api/posts')
def api_posts():
    db = get_db()
    filters = _parse_post_filters()
    limit      = int(request.args.get('limit', 60))
    offset     = int(request.args.get('offset', 0))
    order      = request.args.get('order', 'newest')

    posts = search_posts(db, limit=limit, offset=offset, order=order, **filters)
    total = count_posts(db, **filters)
    db.close()
    return jsonify({"posts": posts, "total": total, "offset": offset, "limit": limit})

@app.route('/api/posts/<int:post_id>')
def api_post(post_id):
    db = get_db()
    post = get_post_with_tags(db, post_id)
    db.close()
    if not post:
        return jsonify({"error": "not found"}), 404
    return jsonify(post)



@app.route('/api/posts/<int:post_id>', methods=['DELETE'])
def api_delete_post(post_id):
    db = get_db()
    db.execute("DELETE FROM posts WHERE id = %s", (post_id,))
    db.commit()
    db.close()
    return jsonify({"status": "ok"})

import re as _re

def _get_post_with_tags_inline(db, post_id):
    """Inline version of get_post_with_tags that uses the correct column name."""
    row = db.execute("""
        SELECT p.id, p.rule34hub_id, p.rule34_api_id, p.file_url, p.cdn_url,
               p.thumb_cdn, p.media_type, p.width, p.height, p.source,
               p.hub_url, p.status,
               STRING_AGG(t.name, '|||' ORDER BY t.name) as tag_str
        FROM posts p
        LEFT JOIN post_tags pt ON pt.post_id = p.id
        LEFT JOIN tags t ON t.id = pt.tag_id
        WHERE p.id = %s
        GROUP BY p.id
    """, (post_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d['tags'] = [t for t in (d.pop('tag_str') or '').split('|||') if t]
    return d


def _fetch_r34_by_id(r34_id):
    """Fetch a single post from R34 API by its numeric ID. Returns dict or None."""
    url = (
        f"{R34_API}&user_id={USER_ID}&api_key={API_KEY}"
        f"&json=1&limit=1&id={r34_id}"
    )
    resp = requests.get(url, headers=HEADERS, timeout=10)
    resp.raise_for_status()
    results = resp.json()
    if isinstance(results, dict):
        results = [results] if results else []
    if not results:
        return None
    return results[0]

def _apply_r34_to_post(db, post_id, r34):
    """Write file_url, rule34_api_id and replace tags from an R34 post dict."""
    file_url = r34.get("file_url", "")
    r34_id   = int(r34.get("id", 0))
    new_tags = [t for t in r34.get("tags", "").split() if t]

    db.execute("""
        UPDATE posts
        SET file_url      = %s,
            rule34_api_id = %s
        WHERE id = %s
    """, (file_url, r34_id, post_id))

    db.execute("DELETE FROM post_tags WHERE post_id = %s", (post_id,))
    for tag in new_tags:
        db.execute(
            "INSERT INTO tags (name) VALUES (%s) ON CONFLICT (name) DO NOTHING",
            (tag,),
        )
        row = db.execute("SELECT id FROM tags WHERE name = %s", (tag,)).fetchone()
        if row:
            db.execute(
                "INSERT INTO post_tags (post_id, tag_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (post_id, row['id']),
            )
    db.commit()
    return new_tags, r34_id

def _score_tags(local_tags, r34_tags_str):
    """Count overlapping tags between local list and R34 space-separated string."""
    r34_set   = set(r34_tags_str.lower().split())
    local_set = set(t.lower().replace(" ", "_") for t in local_tags)
    return len(local_set & r34_set)


@app.route('/api/posts/<int:post_id>/update-from-r34', methods=['POST'])
def api_update_from_r34(post_id):
    """Paste a rule34.xxx URL or bare post ID → update file_url + tags."""
    payload   = request.get_json() or {}
    r34_input = payload.get('r34_url', '').strip()
    if not r34_input:
        return jsonify({"error": "r34_url required"}), 400

    match = _re.search(r'id=(\d+)', r34_input) or _re.match(r'^(\d+)$', r34_input)
    if not match:
        return jsonify({"error": "Could not parse R34 post ID from input"}), 400

    r34_id = int(match.group(1))
    try:
        r34 = _fetch_r34_by_id(r34_id)
    except Exception as e:
        return jsonify({"error": f"R34 API request failed: {e}"}), 502

    if not r34:
        return jsonify({"error": f"No post found on R34 for ID {r34_id}"}), 404

    db = get_db()
    try:
        new_tags, r34_id = _apply_r34_to_post(db, post_id, r34)
        post = _get_post_with_tags_inline(db, post_id)
        db.close()
        return jsonify({"status": "ok", "post": post, "r34_id": r34_id, "tags_updated": len(new_tags)})
    except Exception as e:
        db.rollback()
        db.close()
        return jsonify({"error": str(e)}), 500


@app.route('/api/posts/<int:post_id>/auto-match', methods=['POST'])
def api_auto_match(post_id):
    """
    Use the post's existing tags to search R34, score by tag overlap,
    optionally run image similarity, and return ranked candidates.
    If one candidate is clearly best (score >= threshold AND uniquely top),
    auto-apply it and return status='applied'. Otherwise return status='candidates'.
    Pass { apply: true, r34_id: <id> } to manually apply a specific candidate.
    """
    SCORE_THRESHOLD = 5
    payload = request.get_json() or {}

    db = get_db()

    # Manual apply shortcut
    if payload.get('apply') and payload.get('r34_id'):
        try:
            r34 = _fetch_r34_by_id(int(payload['r34_id']))
            if not r34:
                db.close()
                return jsonify({"error": "R34 post not found"}), 404
            new_tags, r34_id = _apply_r34_to_post(db, post_id, r34)
            post = _get_post_with_tags_inline(db, post_id)
            db.close()
            return jsonify({"status": "applied", "post": post, "r34_id": r34_id, "tags_updated": len(new_tags)})
        except Exception as e:
            db.rollback(); db.close()
            return jsonify({"error": str(e)}), 500

    # Get post's current tags + thumb from DB
    row = db.execute("""
        SELECT p.id, p.thumb_cdn, p.cdn_url, p.source, p.file_url,
               STRING_AGG(t.name, ' ' ORDER BY t.name) as tag_str
        FROM posts p
        LEFT JOIN post_tags pt ON pt.post_id = p.id
        LEFT JOIN tags t ON t.id = pt.tag_id
        WHERE p.id = %s
        GROUP BY p.id
    """, (post_id,)).fetchone()
    db.close()

    if not row:
        return jsonify({"error": "Post not found"}), 404

    local_tags = [t for t in (row['tag_str'] or '').split() if t]
    local_thumb = row['thumb_cdn'] or row['cdn_url'] or ''
    source_url  = row['source'] or ''

    if not local_tags:
        return jsonify({"error": "Post has no tags to search with"}), 400

    # Search R34 with top tags (use up to 6 most specific — avoid super-generic ones)
    GENERIC = {'female','male','breasts','ass','big_breasts','huge_breasts','large_breasts',
               'thick_thighs','wide_hips','anthro','furry','solo','1girls','1boy','animated',
               'tagme','hi_res','absurd_res','highres','3d','2d','rating:explicit'}
    search_tags = [t for t in local_tags if t.lower() not in GENERIC][:8]
    if not search_tags:
        search_tags = local_tags[:6]

    encoded = '+'.join(t.replace(' ', '_') for t in search_tags)
    api_url = (
        f"{R34_API}&user_id={USER_ID}&api_key={API_KEY}"
        f"&json=1&limit=30&tags={encoded}"
    )
    try:
        resp = requests.get(api_url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        results = resp.json()
        if isinstance(results, dict):
            results = [results] if results else []
        if not isinstance(results, list):
            results = []
    except Exception as e:
        return jsonify({"error": f"R34 API error: {e}"}), 502

    if not results:
        return jsonify({"status": "no_results", "candidates": [], "search_tags": search_tags})

    # Score by tag overlap; also check source URL match
    scored = []
    for r in results:
        score = _score_tags(local_tags, r.get('tags', ''))
        source_match = False
        if source_url:
            def _norm(u):
                u = u.lower()
                u = _re.sub(r'^https?://', '', u)
                u = _re.sub(r'^www\.', '', u)
                return u.rstrip('/')
            if _norm(r.get('source', '')) == _norm(source_url):
                score += 1000  # guaranteed winner
                source_match = True
        scored.append((score, source_match, r))

    scored.sort(key=lambda x: x[0], reverse=True)

    # Build candidate list (top 8)
    candidates = []
    for score, source_match, r in scored[:8]:
        candidates.append({
            "r34_id":      r.get("id"),
            "file_url":    r.get("file_url", ""),
            "preview_url": r.get("preview_url", ""),
            "score":       score if score < 1000 else score - 1000,
            "source_match": source_match,
            "source":      r.get("source", ""),
            "tags":        r.get("tags", "").split()[:30],  # first 30 for display
        })

    # Image similarity on top 3 candidates if PIL available
    try:
        from PIL import Image
        import io as _io, math

        def _dhash(img, size=16):
            img = img.resize((size+1, size), Image.LANCZOS).convert('L')
            px = list(img.getdata())
            return [1 if px[y*(size+1)+x] > px[y*(size+1)+x+1] else 0
                    for y in range(size) for x in range(size)]

        def _center_crop(img, pct=0.6):
            w, h = img.size
            mx, my = int(w*(1-pct)/2), int(h*(1-pct)/2)
            return img.crop((mx, my, w-mx, h-my))

        def _color_hist(img, buckets=16, size=64):
            px = list(img.resize((size, size), Image.LANCZOS).getdata())
            total = len(px); step = 256/buckets
            r=[0]*buckets; g=[0]*buckets; b=[0]*buckets
            for pr,pg,pb in px:
                r[int(pr/step)]+=1; g[int(pg/step)]+=1; b[int(pb/step)]+=1
            return [x/total for x in r],[x/total for x in g],[x/total for x in b]

        def _hash_sim(h1, h2): return sum(a==b for a,b in zip(h1,h2))/len(h1)
        def _hist_sim(ha, hb):
            return sum(sum(math.sqrt(ha[c][i]*hb[c][i]) for i in range(16))
                       for c in range(3)) / 3

        def _img_sim(url_a, url_b):
            ra = requests.get(url_a, timeout=6, headers=HEADERS)
            rb = requests.get(url_b, timeout=6, headers=HEADERS)
            if ra.status_code != 200 or rb.status_code != 200: return None
            ia = Image.open(_io.BytesIO(ra.content)).convert('RGB')
            ib = Image.open(_io.BytesIO(rb.content)).convert('RGB')
            full = _hash_sim(_dhash(ia), _dhash(ib))
            crop = _hash_sim(_dhash(_center_crop(ia)), _dhash(_center_crop(ib)))
            hist = _hist_sim(_color_hist(ia), _color_hist(ib))
            return round(full*0.25 + crop*0.45 + hist*0.30, 4)

        if local_thumb:
            for c in candidates[:3]:
                if c['preview_url']:
                    sim = _img_sim(local_thumb, c['preview_url'])
                    c['img_similarity'] = sim
    except ImportError:
        pass  # PIL not installed, skip image similarity

    # Auto-apply if top candidate is clearly confident
    top_score = scored[0][0]
    second_score = scored[1][0] if len(scored) > 1 else 0
    is_source_match = scored[0][1]
    is_confident = is_source_match or (
        top_score >= SCORE_THRESHOLD and top_score > second_score
    )

    if is_confident and payload.get('auto_apply', False):
        db = get_db()
        try:
            new_tags, r34_id = _apply_r34_to_post(db, post_id, scored[0][2])
            post = _get_post_with_tags_inline(db, post_id)
            db.close()
            return jsonify({
                "status": "applied", "post": post,
                "r34_id": r34_id, "tags_updated": len(new_tags),
                "candidates": candidates, "search_tags": search_tags,
            })
        except Exception as e:
            db.rollback(); db.close()
            return jsonify({"error": str(e)}), 500

    return jsonify({
        "status": "candidates",
        "candidates": candidates,
        "search_tags": search_tags,
        "confident": is_confident,
        "top_score": top_score,
    })


@app.route('/api/posts/by-ids')
def api_posts_by_ids():
    ids = request.args.getlist('ids', type=int)
    if not ids:
        return jsonify([])
    db = get_db()
    placeholders = ','.join(['%s'] * len(ids))
    from database import _parse_post_row
    rows = db.execute(f"SELECT * FROM posts WHERE id IN ({placeholders})", ids).fetchall()
    db.close()
    return jsonify([_parse_post_row(r) for r in rows])

@app.route('/api/posts/random')
def api_random():
    db = get_db()
    count      = int(request.args.get('count', 20))
    filters = _parse_post_filters()
    posts = get_random_posts(db, count=count, **filters)
    db.close()
    return jsonify({"posts": posts})


@app.route('/api/posts/browse-meta')
def api_browse_meta():
    db = get_db()
    filters = _parse_post_filters()
    anchor_offset = request.args.get('anchor_offset', type=int)
    meta = get_browse_timeline_meta(db, anchor_offset=anchor_offset, **filters)
    db.close()
    return jsonify(meta)


@app.route('/api/posts/stratified-random')
def api_stratified_random():
    db = get_db()
    filters = _parse_post_filters()
    buckets = int(request.args.get('buckets', 10))
    per_bucket = int(request.args.get('per_bucket', 2))
    posts = get_stratified_random_posts(
        db, buckets=buckets, per_bucket=per_bucket, **filters
    )
    db.close()
    return jsonify({"posts": posts, "count": len(posts)})

# ── Tags ──────────────────────────────────────────────────────────────────────

@app.route('/api/tags')
def api_tags():
    limit = request.args.get('limit', type=int)
    db = get_db()
    tags = get_all_tags_with_counts(db)
    db.close()
    if limit:
        tags = tags[:limit]
    return jsonify(tags)

@app.route('/api/tags/search')
def api_tags_search():
    q = request.args.get('q', '').lower().replace(' ', '_')
    limit = int(request.args.get('limit', 20))
    db = get_db()
    rows = db.execute("""
        SELECT t.name, COUNT(pt.post_id) as count
        FROM tags t
        LEFT JOIN post_tags pt ON pt.tag_id = t.id
        WHERE t.name LIKE %s
        GROUP BY t.id, t.name
        ORDER BY count DESC
        LIMIT %s
    """, (f'%{q}%', limit)).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

# ── Tag groups ────────────────────────────────────────────────────────────────

@app.route('/api/tag-groups', methods=['GET'])
def api_tag_groups():
    db = get_db()
    groups = get_all_tag_groups(db)
    db.close()
    return jsonify(groups)

@app.route('/api/tag-groups', methods=['POST'])
def api_create_tag_group():
    payload = request.get_json()
    group_name = payload.get('group_name', '').strip()
    members    = [t.strip().lower().replace(' ', '_') for t in payload.get('members', []) if t.strip()]
    if not group_name or not members:
        return jsonify({"error": "group_name and members required"}), 400
    db = get_db()
    upsert_tag_group(db, group_name, members)
    db.close()
    return jsonify({"status": "ok"})

@app.route('/api/tag-groups/<group_name>', methods=['DELETE'])
def api_delete_tag_group(group_name):
    db = get_db()
    delete_tag_group(db, group_name)
    db.close()
    return jsonify({"status": "ok"})

# ── Collections ───────────────────────────────────────────────────────────────

@app.route('/api/collections')
def api_collections():
    db = get_db()
    cols = get_collections(db)
    db.close()
    return jsonify(cols)

@app.route('/api/collections/<int:col_id>')
def api_collection(col_id):
    db = get_db()
    col = get_collection(db, col_id)
    db.close()
    if not col:
        return jsonify({"error": "not found"}), 404
    return jsonify(col)

@app.route('/api/collections', methods=['POST'])
def api_create_collection():
    payload  = request.get_json() or {}
    name     = payload.get('name', 'Untitled')
    post_ids = payload.get('post_ids', [])
    search_tags = payload.get('search_tags')
    db = get_db()
    col_id = create_collection(db, name, post_ids, search_tags=search_tags)
    db.close()
    return jsonify({"status": "ok", "id": col_id})

@app.route('/api/collections/<int:col_id>', methods=['PUT'])
def api_update_collection(col_id):
    payload  = request.get_json() or {}
    db = get_db()
    if 'post_ids' in payload:
        update_collection_posts(db, col_id, payload['post_ids'])
    meta_kw = {}
    if 'name' in payload:
        meta_kw['name'] = payload['name']
    if 'search_tags' in payload:
        meta_kw['search_tags'] = payload['search_tags']
    if meta_kw:
        update_collection_meta(db, col_id, **meta_kw)
    db.close()
    return jsonify({"status": "ok"})


@app.route('/api/collections/<int:col_id>/review-queue')
def api_collection_review_queue(col_id):
    limit = int(request.args.get('limit', 80))
    limit = max(1, min(limit, 200))
    db = get_db()
    posts = get_collection_review_queue(db, col_id, limit=limit)
    db.close()
    return jsonify({"posts": posts})


@app.route('/api/collections/<int:col_id>/review-action', methods=['POST'])
def api_collection_review_action(col_id):
    payload = request.get_json() or {}
    action = payload.get('action')
    db = get_db()
    try:
        if action == 'add':
            post_id = int(payload['post_id'])
            append_post_to_collection(db, col_id, post_id)
        elif action == 'ignore':
            record_collection_review_ignored(db, col_id, [int(payload['post_id'])])
        elif action == 'ignore_all':
            raw = payload.get('stack_ids') or []
            record_collection_review_ignored(db, col_id, [int(x) for x in raw])
        else:
            return jsonify({"error": "invalid action"}), 400
    finally:
        db.close()
    return jsonify({"status": "ok"})

@app.route('/api/collections/<int:col_id>', methods=['DELETE'])
def api_delete_collection(col_id):
    db = get_db()
    db.execute("DELETE FROM collections WHERE id = %s", (col_id,))
    db.commit()
    db.close()
    return jsonify({"status": "ok"})

# ── Selections ────────────────────────────────────────────────────────────────

@app.route('/api/selections')
def api_selections():
    db = get_db()
    sels = get_selections(db)
    db.close()
    return jsonify(sels)

@app.route('/api/selections', methods=['POST'])
def api_save_selection():
    payload  = request.get_json()
    post_ids = payload.get('post_ids', [])
    name     = payload.get('name')
    is_saved = payload.get('is_saved', False)
    db = get_db()
    sel_id = save_selection(db, post_ids, name=name, is_saved=is_saved)
    db.close()
    return jsonify({"status": "ok", "id": sel_id})

@app.route('/api/selections/<int:sel_id>')
def api_get_selection(sel_id):
    db = get_db()
    sel = get_selection(db, sel_id)
    db.close()
    if not sel:
        return jsonify({"error": "not found"}), 404
    return jsonify(sel)

@app.route('/api/selections/<int:sel_id>/promote', methods=['POST'])
def api_promote_selection(sel_id):
    payload = request.get_json()
    name    = payload.get('name', 'Untitled Collection')
    db = get_db()
    col_id = promote_selection_to_collection(db, sel_id, name)
    db.close()
    if not col_id:
        return jsonify({"error": "selection not found"}), 404
    return jsonify({"status": "ok", "collection_id": col_id})

# ── Current Selection (persisted working selection) ───────────────────────────
# Uses a reserved row named '__current__' in the selections table.
# GET  /api/selections/current  → { ids: [...] }
# PUT  /api/selections/current  → { ids: [...] }  (upsert)

@app.route('/api/selections/current', methods=['GET'])
def api_get_current_selection():
    db = get_db()
    try:
        row = db.execute(
            "SELECT post_ids FROM selections WHERE name = '__current__' ORDER BY id DESC LIMIT 1"
        ).fetchone()
    finally:
        db.close()
    if not row:
        return jsonify({"ids": [], "index": 0})
    try:
        raw = json.loads(row['post_ids'] or '[]')
    except Exception:
        raw = []
    # Support legacy format (plain id array) and new format ({ ids, index })
    if isinstance(raw, dict):
        ids = raw.get('ids', [])
        index = raw.get('index', 0)
        subsets = raw.get('subsets', [])
        active_subset_id = raw.get('activeSubsetId')
    else:
        ids = raw if isinstance(raw, list) else []
        index = 0
        subsets = []
        active_subset_id = None
    return jsonify({
        "ids": ids,
        "index": index,
        "subsets": subsets,
        "activeSubsetId": active_subset_id,
    })

@app.route('/api/selections/current', methods=['PUT'])
def api_put_current_selection():
    payload = request.get_json() or {}
    raw_ids = payload.get('ids', [])
    ids = []
    for i in raw_ids:
        try:
            ids.append(int(i))
        except (TypeError, ValueError):
            pass
    try:
        index = max(0, int(payload.get('index', 0)))
    except (TypeError, ValueError):
        index = 0
    subsets = payload.get('subsets', [])
    if not isinstance(subsets, list):
        subsets = []
    active_subset_id = payload.get('activeSubsetId')
    stored = json.dumps({
        'ids': ids,
        'index': index,
        'subsets': subsets,
        'activeSubsetId': active_subset_id,
    })
    db = get_db()
    try:
        existing = db.execute(
            "SELECT id FROM selections WHERE name = '__current__'"
        ).fetchone()
        if existing:
            db.execute(
                "UPDATE selections SET post_ids = %s WHERE name = '__current__'",
                (stored,),
            )
        else:
            db.execute(
                "INSERT INTO selections (name, post_ids, is_saved) VALUES ('__current__', %s, 0)",
                (stored,),
            )
        db.commit()
        return jsonify({"status": "ok", "count": len(ids), "index": index})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()

# ── Subscriptions ─────────────────────────────────────────────────────────────

@app.route('/api/subscriptions')
def api_subscriptions():
    db = get_db()
    subs = get_subscriptions(db)
    db.close()
    return jsonify(subs)

@app.route('/api/subscriptions', methods=['POST'])
def api_add_subscription():
    payload  = request.get_json()
    tag_name = payload.get('tag_name', '')
    if not tag_name:
        return jsonify({"error": "tag_name required"}), 400
    db = get_db()
    add_subscription(db, tag_name)
    db.close()
    return jsonify({"status": "ok"})

@app.route('/api/subscriptions/<tag_name>', methods=['DELETE'])
def api_remove_subscription(tag_name):
    db = get_db()
    remove_subscription(db, tag_name)
    db.close()
    return jsonify({"status": "ok"})


@app.route('/api/subscriptions/browse')
def api_subscriptions_browse():
    """Query rule34 API directly with subscription tags using OR syntax.
    Excludes posts already in local library."""
    db = get_db()
    subs = get_subscriptions(db)
    if not subs:
        db.close()
        return jsonify({"posts": [], "total": 0})

    # subs param = selected subset of subscriptions (or all if not specified)
    req_subs = request.args.getlist('subs')
    exclude  = request.args.getlist('exclude')
    page     = int(request.args.get('page', 0))
    limit    = int(request.args.get('limit', 50))

    # Use requested subs or fall back to all subscriptions
    query_tags = req_subs if req_subs else [s['tag_name'] for s in subs]
    if not query_tags:
        db.close()
        return jsonify({"posts": [], "total": 0})

    # Build query - single tag = direct, multiple = OR syntax
    if len(query_tags) == 1:
        or_query = query_tags[0]
    else:
        or_query = '( ' + ' ~ '.join(query_tags) + ' )'

    parts = [or_query]
    for t in exclude:
        parts.append('-' + t.lower().replace(' ', '_'))
    # Sort newest first
    parts.append('sort:id:desc')

    tag_query = ' '.join(parts)
    url = (f"{R34_API}&user_id={USER_ID}&api_key={API_KEY}"
           f"&json=1&limit={limit}&pid={page}&tags={requests.utils.quote(tag_query, safe='():~-_')}")

    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        results = resp.json()
        if isinstance(results, dict): results = [results] if results else []
        elif not isinstance(results, list): results = []
    except Exception as e:
        db.close()
        return jsonify({"error": str(e), "posts": [], "total": 0}), 500

    # Get all rule34_api_ids already in local library for filtering
    owned = {row['rule34_api_id'] for row in db.execute(
        "SELECT rule34_api_id FROM posts WHERE rule34_api_id IS NOT NULL"
    ).fetchall()}
    db.close()

    posts = []
    for r in results:
        pid = r.get('id')
        tags_list = r.get("tags", "").split()
        file_url = r.get("file_url", "")
        posts.append({
            "rule34_post_id": pid,
            "file_url":    file_url,
            "preview_url": r.get("preview_url", ""),
            "media_type":  infer_rule34_media_type(file_url, tags_list),
            "tags":        tags_list,
            "source":      r.get("source", ""),
            "owned":       pid in owned,
        })

    return jsonify({"posts": posts, "total": len(posts), "page": page})

def _get_owned_rule34_ids(db):
    """Rule34 post IDs already in the local library (api + hub columns)."""
    owned = set()
    rows = db.execute(
        "SELECT rule34_api_id, rule34hub_id FROM posts "
        "WHERE rule34_api_id IS NOT NULL OR rule34hub_id IS NOT NULL"
    ).fetchall()
    for row in rows:
        for key in ('rule34_api_id', 'rule34hub_id'):
            val = row.get(key)
            if val is not None:
                owned.add(int(val))
    return owned


def _fetch_tag_posts(db, tag, sub_tags, owned_ids):
    """
    Fetch posts for a single subscription tag from R34 and upsert into feed_posts.
    Returns (fetched, added_new, error_msg).
      fetched   – number of posts R34 returned (0 is normal, not an error)
      added_new – number of genuinely new unseen posts inserted
      error_msg – None on success, string on failure

    Optimised: uses a single IN-clause batch query to check existing feed_posts
    instead of one SELECT per post, which was the main DB bottleneck.
    """
    url = (f"{R34_API}&user_id={USER_ID}&api_key={API_KEY}"
           f"&json=1&limit=100&tags={requests.utils.quote(tag, safe='')}"
           f"+sort:id:desc")

    logger.info(f"[fetch] {tag} → {url}")

    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        raw = resp.json()
    except requests.HTTPError as e:
        return 0, 0, f"HTTP {resp.status_code}: {e}"
    except Exception as e:
        return 0, 0, str(e)

    # Normalise R34 response
    if raw is None or raw == 0 or raw == "" or raw == {}:
        results = []
    elif isinstance(raw, dict):
        results = [raw] if raw else []
    elif isinstance(raw, list):
        results = raw
    else:
        results = []

    if not results:
        logger.info(f"{tag}: 0 posts (no new content)")
        return 0, 0, None

    logger.info(f"{tag}: {len(results)} posts returned")

    # ── Batch-fetch existing feed_post statuses in ONE query ──────────────────
    pids = [p.get('id') for p in results if p.get('id')]
    if not pids:
        return 0, 0, None

    placeholders = ','.join(['%s'] * len(pids))
    existing_rows = db.execute(
        f"SELECT rule34_post_id, status FROM feed_posts WHERE rule34_post_id IN ({placeholders})",
        pids
    ).fetchall()
    existing_map = {row['rule34_post_id']: row['status'] for row in existing_rows}
    # ─────────────────────────────────────────────────────────────────────────

    sub_tag_set = set(sub_tags)
    added_new = 0

    for post in results:
        raw_pid = post.get('id')
        if not raw_pid:
            continue
        try:
            pid = int(raw_pid)
        except (TypeError, ValueError):
            continue
        file_url  = post.get('file_url', '')
        preview   = post.get('preview_url', '')
        tags_list = post.get('tags', '').split()
        post_date = post.get('created_at', '')
        media_type = infer_rule34_media_type(file_url, tags_list)

        matched = [s for s in tags_list if s in sub_tag_set]

        if pid in owned_ids:
            if pid not in existing_map:
                db.execute("""
                    INSERT INTO feed_posts
                        (rule34_post_id, file_url, preview_url, media_type, tags, matched_subs, post_date, status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, 'owned')
                """, (pid, file_url, preview, media_type, json.dumps(tags_list), json.dumps(matched), post_date))
                existing_map[pid] = 'owned'
        else:
            if pid not in existing_map:
                upsert_feed_post(
                    db, pid, file_url, preview, tags_list, matched, post_date, commit=False,
                )
                existing_map[pid] = 'unseen'
                added_new += 1
            # Don't overwrite posts already actioned by the user

    db.commit()

    # Record when this tag was last successfully fetched from R34
    db.execute(
        "UPDATE subscriptions SET last_fetched_at = %s WHERE tag_name = %s",
        (time.time(), tag)
    )
    db.commit()

    return len(results), added_new, None


@app.route('/api/subscriptions/fetch', methods=['POST'])
def api_fetch_subscriptions():
    start_time = time.time()
    logger.info("Starting subscription fetch (bulk)")

    db = get_db()
    subs = get_subscriptions(db)

    if not subs:
        logger.info("No subscriptions found")
        db.close()
        return jsonify({"status": "ok", "new_posts": 0, "new_unseen": 0})

    owned_ids = _get_owned_rule34_ids(db)

    sub_tags  = [s['tag_name'] for s in subs]
    total_fetched = 0
    total_new     = 0
    progress      = []
    errors        = []

    logger.info(f"Processing {len(subs)} subscriptions")

    for i, sub in enumerate(subs):
        tag       = sub['tag_name']
        sub_start = time.time()

        fetched, added_new, err = _fetch_tag_posts(db, tag, sub_tags, owned_ids)

        elapsed = round(time.time() - sub_start, 2)
        entry = {
            "index":     i + 1,
            "total":     len(subs),
            "tag":       tag,
            "fetched":   fetched,
            "added_new": added_new,
            "error":     err,
        }
        progress.append(entry)

        if err:
            logger.error(f"[{i+1}/{len(subs)}] {tag}: {err}")
            errors.append({"tag": tag, "error": err})
        else:
            logger.info(f"[{i+1}/{len(subs)}] {tag}: {fetched} fetched, {added_new} new ({elapsed}s)")

        total_fetched += fetched
        total_new     += added_new

    db.close()

    logger.info(f"Fetch complete: {total_fetched} fetched, {total_new} new unseen")
    logger.info(f"Total time: {round(time.time() - start_time, 2)}s")

    return jsonify({
        "status":     "ok",
        "new_posts":  total_fetched,
        "new_unseen": total_new,
        "progress":   progress,
        "errors":     errors,
    })


@app.route('/api/subscriptions/fetch-stream')
def api_fetch_subscriptions_stream():
    """
    SSE endpoint — the frontend's primary fetch strategy.

    Rate-limit strategy (R34 allows ~60 requests/minute):
      • Tags fetched successfully within SKIP_IF_FETCHED_WITHIN_SECS are skipped
        entirely — no point hitting R34 again if nothing has changed.
      • Remaining tags are split into batches of BATCH_SIZE.
      • Each batch runs concurrently (one thread per tag in the batch).
      • Between batches we pause BATCH_PAUSE_SECS to stay under the 60 req/min cap.
        6 tags × 6-second pause = 10 batches/minute = 60 requests/minute max.
    """
    BATCH_SIZE       = 6
    BATCH_PAUSE_SECS = 6
    CONCURRENCY      = BATCH_SIZE   # one thread per slot in the batch

    def generate():
        yield f"event: progress\ndata: {json.dumps({'index': 0, 'total': 0, 'tag': '', 'fetched': 0, 'added_new': 0, 'skipped': False, 'error': None, 'starting': True})}\n\n"

        db_main = get_db()
        subs = get_subscriptions(db_main)

        if not subs:
            db_main.close()
            yield "event: done\ndata: {\"new_posts\":0,\"new_unseen\":0,\"errors\":[]}\n\n"
            return

        owned_ids = _get_owned_rule34_ids(db_main)

        # Read last_fetched_at for each tag
        now = time.time()
        last_fetched = {}
        rows = db_main.execute(
            "SELECT tag_name, last_fetched_at FROM subscriptions"
        ).fetchall()
        for row in rows:
            if row['last_fetched_at']:
                last_fetched[row['tag_name']] = row['last_fetched_at']

        sub_tags = [s['tag_name'] for s in subs]
        db_main.close()

        # Split into skipped vs. to-fetch
        to_fetch = []
        skipped  = []
        for s in subs:
            tag = s['tag_name']
            lf  = last_fetched.get(tag)
            if lf and (now - lf) < SKIP_IF_FETCHED_WITHIN_SECS:
                skipped.append(tag)
            else:
                to_fetch.append(tag)

        total_subs    = len(subs)
        total_fetched = 0
        total_new     = 0
        errors        = []
        global_idx    = [0]   # tracks position across all subs for display

        # Announce skipped tags immediately so the UI shows them
        for tag in skipped:
            global_idx[0] += 1
            yield f"event: progress\ndata: {json.dumps({'index': global_idx[0], 'total': total_subs, 'tag': tag, 'fetched': 0, 'added_new': 0, 'skipped': True, 'error': None})}\n\n"

        if not to_fetch:
            done_data = json.dumps({"new_posts": 0, "new_unseen": 0, "errors": [], "skipped": len(skipped)})
            yield f"event: done\ndata: {done_data}\n\n"
            return

        lock = threading.Lock()

        # Each worker gets its own DB connection
        def fetch_one(tag):
            db = get_db()
            try:
                return _fetch_tag_posts(db, tag, sub_tags, owned_ids)
            except Exception as exc:
                logger.exception("fetch_one failed for %s", tag)
                return 0, 0, str(exc)
            finally:
                db.close()

        # Process in batches of BATCH_SIZE with a pause between batches
        batches = [to_fetch[i:i + BATCH_SIZE] for i in range(0, len(to_fetch), BATCH_SIZE)]

        for batch_num, batch in enumerate(batches):
            # Run the batch concurrently
            with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
                futures = {pool.submit(fetch_one, tag): tag for tag in batch}
                for future in as_completed(futures):
                    tag = futures[future]
                    try:
                        fetched, added_new, err = future.result()
                    except Exception as exc:
                        logger.exception("batch worker failed for %s", tag)
                        fetched, added_new, err = 0, 0, str(exc)

                    with lock:
                        global_idx[0] += 1
                        total_fetched += fetched
                        total_new     += added_new
                        if err:
                            errors.append({"tag": tag, "error": err})

                    yield f"event: progress\ndata: {json.dumps({'index': global_idx[0], 'total': total_subs, 'tag': tag, 'fetched': fetched, 'added_new': added_new, 'skipped': False, 'error': err})}\n\n"

            # Pause between batches (but not after the last one)
            if batch_num < len(batches) - 1:
                logger.info(f"Batch {batch_num + 1}/{len(batches)} done — pausing {BATCH_PAUSE_SECS}s")
                yield f"event: pause\ndata: {json.dumps({'seconds': BATCH_PAUSE_SECS, 'batch': batch_num + 1, 'total_batches': len(batches)})}\n\n"
                time.sleep(BATCH_PAUSE_SECS)

        done_data = json.dumps({
            "new_posts":  total_fetched,
            "new_unseen": total_new,
            "errors":     errors,
            "skipped":    len(skipped),
        })
        yield f"event: done\ndata: {done_data}\n\n"

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control':     'no-cache',
            'X-Accel-Buffering': 'no',
        }
    )


@app.route('/api/subscriptions/fetch-one', methods=['POST'])
def api_fetch_subscription_one():
    """
    Fetch a single subscription tag.  Called by the frontend per-tag
    rate-limited strategy so it can control concurrency and backoff itself.

    Query param:  ?tag=tag_name
    Special case: ?tag=__probe__ just returns 200 so the frontend knows
                  this endpoint exists.
    """
    tag = request.args.get('tag', '').strip()

    # Probe request — frontend checks if this endpoint exists
    if tag == '__probe__':
        return jsonify({"status": "ok", "probe": True})

    if not tag:
        return jsonify({"error": "tag param required"}), 400

    db = get_db()
    subs     = get_subscriptions(db)
    sub_tags = [s['tag_name'] for s in subs]

    owned_ids = _get_owned_rule34_ids(db)

    fetched, added_new, err = _fetch_tag_posts(db, tag, sub_tags, owned_ids)
    db.close()

    if err:
        # 429 from R34 → pass it back so the frontend can retry with backoff
        if '429' in str(err):
            return jsonify({"error": err, "tag": tag}), 429
        return jsonify({"error": err, "tag": tag}), 502

    return jsonify({
        "status":    "ok",
        "tag":       tag,
        "fetched":   fetched,
        "new_posts": added_new,
    })

# ── Feed ──────────────────────────────────────────────────────────────────────

@app.route('/api/feed')
def api_feed():
    status = request.args.get('status', 'unseen')  # unseen | saved | ignored | unsure (never 'owned')
    limit  = int(request.args.get('limit', 50))
    offset = int(request.args.get('offset', 0))
    db = get_db()
    posts = get_feed_posts(db, status=status, limit=limit, offset=offset)
    db.close()
    return jsonify(posts)

@app.route('/api/feed/<int:rule34_post_id>/action', methods=['POST'])
def api_feed_action(rule34_post_id):
    payload = request.get_json()
    action  = payload.get('action')  # 'saved' | 'ignored' | 'unsure'
    if action not in ('saved', 'ignored', 'unsure'):
        return jsonify({"error": "invalid action"}), 400

    db = get_db()
    set_feed_post_status(db, rule34_post_id, action)

    # If saving, also add to posts table with tags
    if action == 'saved':
        feed_post = db.execute(
            "SELECT * FROM feed_posts WHERE rule34_post_id = %s", (rule34_post_id,)
        ).fetchone()
        if feed_post:
            fp = dict(feed_post)
            pid_str = str(rule34_post_id)

            tags = json.loads(fp['tags'])
            media_type = fp.get('media_type') or infer_rule34_media_type(fp.get('file_url', ''), tags)

            # Check if already in library (by rule34_api_id or rule34hub_id)
            existing_post = db.execute(
                "SELECT id FROM posts WHERE rule34_api_id = %s OR rule34hub_id = %s",
                (rule34_post_id, rule34_post_id)
            ).fetchone()

            if existing_post:
                post_db_id = existing_post['id']
            else:
                row = db.execute("""
                    INSERT INTO posts
                        (rule34hub_id, rule34_api_id, file_url, thumb_cdn, cdn_url, media_type, status, resolved_by)
                    VALUES (%s, %s, %s, %s, %s, %s, 'resolved', 'feed_save')
                    RETURNING id
                """, (
                    rule34_post_id,
                    rule34_post_id,
                    fp['file_url'],
                    fp['preview_url'],
                    fp['file_url'],
                    media_type,
                )).fetchone()
                post_db_id = row['id']

            if post_db_id:
                for tag_name in tags:
                    if not tag_name.strip():
                        continue
                    db.execute(
                        "INSERT INTO tags (name) VALUES (%s) ON CONFLICT (name) DO NOTHING",
                        (tag_name,),
                    )
                    tag_row = db.execute("SELECT id FROM tags WHERE name = %s", (tag_name,)).fetchone()
                    if tag_row:
                        db.execute(
                            "INSERT INTO post_tags (post_id, tag_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                            (post_db_id, tag_row['id']),
                        )
            db.commit()

    db.close()
    return jsonify({"status": "ok"})


@app.route('/api/subscriptions/bulk', methods=['POST'])
def api_bulk_subscriptions():
    """Add multiple subscriptions at once."""
    payload = request.get_json()
    tags = payload.get('tags', [])
    db = get_db()
    added = 0
    for tag in tags:
        tag = tag.strip().lower().replace(' ', '_')
        if not tag: continue
        db.execute(
            "INSERT INTO subscriptions (tag_name) VALUES (%s) ON CONFLICT (tag_name) DO NOTHING",
            (tag,),
        )
        added += 1
    db.commit()
    db.close()
    return jsonify({"status": "ok", "added": added})


@app.route('/api/subscriptions/mark_seen', methods=['POST'])
def api_mark_seen():
    """
    Fetch latest posts for all subscriptions and mark them as ignored.
    This sets your baseline so only genuinely new posts show in the feed.
    """
    db = get_db()
    subs = get_subscriptions(db)
    if not subs:
        db.close()
        return jsonify({"status": "ok", "marked": 0})

    marked = 0
    print(f"mark_seen: processing {len(subs)} subs")
    for sub in subs:
        tag = sub['tag_name']
        url = (f"{R34_API}&user_id={USER_ID}&api_key={API_KEY}"
               f"&json=1&limit=100&tags={tag}")
        try:
            print(f"  fetching {tag}...")
            resp = requests.get(url, headers=HEADERS, timeout=10)
            resp.raise_for_status()
            results = resp.json()
            if isinstance(results, dict):
                results = [results] if results else []
            elif not isinstance(results, list):
                results = []
            print(f"  {tag}: {len(results)} results")

            sub_tags = [s['tag_name'] for s in subs]
            for post in results:
                pid = post.get('id')
                if not pid: continue
                tags_list = post.get('tags', '').split()
                file_url = post.get('file_url', '')
                media_type = infer_rule34_media_type(file_url, tags_list)
                post_tag_set = set(tags_list)
                matched = [s for s in sub_tags if s in post_tag_set]
                # Insert as ignored — already seen
                existing = db.execute(
                    "SELECT id, status FROM feed_posts WHERE rule34_post_id = %s", (pid,)
                ).fetchone()
                is_owned = db.execute(
                    'SELECT id FROM posts WHERE rule34_api_id = %s', (pid,)
                ).fetchone()
                new_status = 'owned' if is_owned else 'ignored'
                if not existing:
                    db.execute("""
                        INSERT INTO feed_posts
                            (rule34_post_id, file_url, preview_url, media_type, tags, matched_subs, post_date, status)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        pid,
                        file_url,
                        post.get('preview_url', ''),
                        media_type,
                        json.dumps(tags_list),
                        json.dumps(matched),
                        post.get('created_at', ''),
                        new_status,
                    ))
                    marked += 1
                elif existing['status'] == 'unseen':
                    db.execute(
                        "UPDATE feed_posts SET status = %s WHERE rule34_post_id = %s",
                        (new_status, pid)
                    )
                    marked += 1
            db.commit()
        except Exception as e:
            import traceback
            print(f"  mark_seen error for {tag}: {e}")
            traceback.print_exc()

    db.close()
    return jsonify({"status": "ok", "marked": marked})

# ── R34 Direct Search ─────────────────────────────────────────────────────────

@app.route('/api/r34/search')
def api_r34_search():
    """
    Proxy a tag search to rule34.xxx and annotate each result with
    `in_library: true` if the post is already saved locally.

    Query params:
      needed[]   – tags that must be present (AND)
      optional[] – treated the same as needed (R34 has no OR support for tag search)
      exclude[]  – tags to exclude (prepended with -)
      media_type – 'image' | 'video' (filtered after fetch)
      page       – zero-based page index
      limit      – defaults to 42
    """
    needed     = request.args.getlist('needed')
    optional   = request.args.getlist('optional')
    exclude    = request.args.getlist('exclude')
    media_type = request.args.get('media_type')
    page       = max(0, int(request.args.get('page', 0)))
    # R34 DAPI behaves best at <=100 results per page.
    limit      = max(1, min(int(request.args.get('limit', 100)), 100))

    # Build the R34 tags string
    tag_parts  = list(needed) + list(optional)   # both treated as required
    tag_parts += [f'-{t}' for t in exclude]
    tags_str   = ' '.join(tag_parts)

    # R34 expects pid as page index (0, 1, 2...), not item offset.
    pid = page
    url = (
        f"{R34_API}&user_id={USER_ID}&api_key={API_KEY}"
        f"&json=1&limit={limit}&pid={pid}"
    )
    if tags_str:
        url += f"&tags={urllib.parse.quote(tags_str)}"

    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        results = resp.json()
    except Exception as e:
        return jsonify({"error": f"R34 request failed: {e}"}), 502

    if isinstance(results, dict):
        results = [results] if results else []
    elif not isinstance(results, list):
        results = []

    # Check which posts are already in the library
    db = get_db()
    owned_set = set()
    if results:
        r34_ids = [int(p['id']) for p in results if p.get('id')]
        if r34_ids:
            placeholders = ','.join(['%s'] * len(r34_ids))
            rows = db.execute(
                f"SELECT rule34_api_id FROM posts WHERE rule34_api_id IN ({placeholders})",
                r34_ids
            ).fetchall()
            owned_set = {row['rule34_api_id'] for row in rows}
    db.close()

    # Normalise to the shape the frontend expects
    posts = []
    for p in results:
        r34_id   = int(p.get('id', 0))
        file_url = p.get('file_url', '')
        preview  = p.get('preview_url', '')
        mt       = infer_rule34_media_type(file_url, p.get('tags', '').split())

        # Apply media-type filter
        if media_type and mt != media_type:
            continue

        posts.append({
            'id':            r34_id,
            'rule34_api_id': r34_id,
            'file_url':      file_url,
            'cdn_url':       file_url,
            'thumb_cdn':     preview,
            'media_type':    mt,
            'tags':          p.get('tags', '').split(),
            'width':         p.get('width'),
            'height':        p.get('height'),
            'source':        p.get('source', ''),
            'in_library':    r34_id in owned_set,
        })

    # has_more: if we received a full page there are likely more results
    has_more = len(results) >= limit

    return jsonify({'posts': posts, 'page': page, 'has_more': has_more})


@app.route('/api/r34/save', methods=['POST'])
def api_r34_save():
    """
    Save a rule34.xxx post directly into the local library.
    Expects JSON body: { post: <normalised post object from /api/r34/search> }
    """
    payload = request.get_json() or {}
    post    = payload.get('post')
    if not post or not post.get('id'):
        return jsonify({"error": "post with id required"}), 400

    r34_id   = int(post['id'])
    file_url = post.get('file_url', '')
    preview  = post.get('thumb_cdn', '')
    tags     = post.get('tags', [])
    mt       = post.get('media_type', 'image')

    db = get_db()
    try:
        # Avoid duplicates
        existing = db.execute(
            "SELECT id FROM posts WHERE rule34_api_id = %s", (r34_id,)
        ).fetchone()

        if existing:
            db.close()
            return jsonify({"status": "already_saved", "id": existing['id']})

        row = db.execute("""
            INSERT INTO posts
                (rule34hub_id, rule34_api_id, file_url, thumb_cdn, cdn_url,
                 media_type, source_type, hub_url, status, resolved_by, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, 'rule34', %s, 'resolved', 'r34_search', NOW())
            RETURNING id
        """, (
            r34_id, r34_id, file_url, preview, file_url, mt,
            f'https://rule34.xxx/index.php?page=post&s=view&id={r34_id}',
        )).fetchone()
        post_db_id = row['id']

        for tag_name in tags:
            tag_name = tag_name.strip()
            if not tag_name:
                continue
            db.execute(
                "INSERT INTO tags (name) VALUES (%s) ON CONFLICT (name) DO NOTHING",
                (tag_name,),
            )
            tag_row = db.execute(
                "SELECT id FROM tags WHERE name = %s", (tag_name,)
            ).fetchone()
            if tag_row:
                db.execute(
                    "INSERT INTO post_tags (post_id, tag_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    (post_db_id, tag_row['id']),
                )

        db.commit()
        db.close()
        return jsonify({"status": "ok", "id": post_db_id})
    except Exception as e:
        db.rollback()
        db.close()
        return jsonify({"error": str(e)}), 500


@app.route('/api/posts/import', methods=['POST'])
def api_import_post():
    """
    Add a single item to the library from:
      - direct image/video URL (.jpg, .png, .mp4, …)
      - rule34.xxx post page URL
      - rule34hub.com post page URL (HTML is fetched and parsed)
    Optional JSON: { url, tags: ["tag_a", …] }
    """
    payload = request.get_json() or {}
    url = (payload.get('url') or '').strip()
    extra_tags = payload.get('tags') or []

    force = bool(payload.get('force', False))

    if not url:
        return jsonify({"error": "url required"}), 400

    try:
        fields = resolve_import_url(url, fetch_r34_post=_fetch_r34_by_id, force=force)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except requests.RequestException as e:
        return jsonify({"error": f"Failed to fetch URL: {e}"}), 502
    except Exception as e:
        logger.exception("resolve_import_url failed")
        return jsonify({"error": f"Import error: {e}"}), 500

    if extra_tags:
        merged = list(fields.get('tags') or [])
        for t in extra_tags:
            norm = str(t).strip().lower().replace(' ', '_')
            if norm and norm not in merged:
                merged.append(norm)
        fields['tags'] = merged

    db = get_db()
    try:
        post_id, already = import_post(db, fields)
        post = get_post_with_tags(db, post_id)
        db.close()
        return jsonify({
            "status": "already_saved" if already else "ok",
            "id": post_id,
            "post": post,
        })
    except Exception as e:
        logger.exception("import_post db write failed")
        db.rollback()
        db.close()
        return jsonify({"error": str(e)}), 500


# Ensure schema exists when started via gunicorn (Render, etc.).
if os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
    init_db(quiet=True)

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=5002)