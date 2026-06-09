import json
import random

from db import get_db, init_db

__all__ = [
    'init_db', 'get_db',
    'infer_rule34_media_type', 'expand_tags_with_groups',
    'search_posts', 'count_posts', 'get_browse_timeline_meta', 'get_stratified_random_posts',
    'get_post_with_tags', 'get_random_posts',
    'get_all_tags_with_counts', 'get_all_tag_groups', 'upsert_tag_group', 'delete_tag_group',
    'get_collections', 'get_collection', 'create_collection', 'update_collection_posts',
    'update_collection_meta', 'append_post_to_collection', 'record_collection_review_ignored',
    'get_collection_review_queue',
    'save_selection', 'get_selections', 'get_selection', 'promote_selection_to_collection',
    'get_subscriptions', 'add_subscription', 'remove_subscription',
    'get_feed_posts', 'upsert_feed_post', 'set_feed_post_status',
    'seed_source_subscriptions', 'get_source_subscriptions', 'add_source_subscription',
    'remove_source_subscription', 'get_ext_feed_posts', 'upsert_ext_feed_item',
    'set_ext_feed_status', 'get_ext_feed_post', 'save_ext_item_to_library',
    'get_owned_external_keys', 'get_known_external_keys',
    'import_post', 'find_existing_import',
]


def infer_rule34_media_type(file_url, tags=None):
    """Classify a Rule34 post for feed/library display."""
    tag_set = {t.lower() for t in (tags or [])}
    path = (file_url or '').lower().split('?')[0]
    if path.endswith(('.mp4', '.webm', '.mov', '.m4v')):
        return 'video'
    if 'video' in tag_set:
        return 'video'
    if 'is_comic' in tag_set:
        return 'comic'
    return 'image'


# ── Tag group helpers ─────────────────────────────────────────────────────────

def expand_tags_with_groups(tag_names, db):
    """Given a list of tag names, expand each to include all aliases in its group."""
    if not tag_names:
        return tag_names
    expanded = set()
    for tag in tag_names:
        expanded.add(tag)
        row = db.execute(
            "SELECT group_name FROM tag_groups WHERE tag_name = %s", (tag,)
        ).fetchone()
        if row:
            members = db.execute(
                "SELECT tag_name FROM tag_groups WHERE group_name = %s", (row['group_name'],)
            ).fetchall()
            for m in members:
                expanded.add(m['tag_name'])
    return list(expanded)

# ── Post search ───────────────────────────────────────────────────────────────

ORDER_CLAUSES = {
    'newest':       'COALESCE(p.rule34hub_id, p.rule34_api_id) DESC NULLS LAST',
    'oldest':       'COALESCE(p.rule34hub_id, p.rule34_api_id) ASC NULLS LAST',
    'saved_newest': 'p.created_at DESC',
    'saved_oldest': 'p.created_at ASC',
    'random':       'RANDOM()',
}


def _build_post_conditions(db, needed=None, optional=None, exclude=None,
                           media_type=None, source_type=None, media_category=None,
                           created_after=None, created_before=None):
    needed   = expand_tags_with_groups(needed or [],  db)
    optional = expand_tags_with_groups(optional or [], db)
    exclude  = expand_tags_with_groups(exclude or [],  db)

    params = []
    conditions = ["p.status = 'resolved'"]

    for tag in needed:
        conditions.append("""
            EXISTS (
                SELECT 1 FROM post_tags pt
                JOIN tags t ON pt.tag_id = t.id
                WHERE pt.post_id = p.id AND t.name = %s
            )
        """)
        params.append(tag)

    if optional:
        placeholders = ','.join(['%s'] * len(optional))
        conditions.append(f"""
            EXISTS (
                SELECT 1 FROM post_tags pt
                JOIN tags t ON pt.tag_id = t.id
                WHERE pt.post_id = p.id AND t.name IN ({placeholders})
            )
        """)
        params.extend(optional)

    for tag in exclude:
        conditions.append("""
            NOT EXISTS (
                SELECT 1 FROM post_tags pt
                JOIN tags t ON pt.tag_id = t.id
                WHERE pt.post_id = p.id AND t.name = %s
            )
        """)
        params.append(tag)

    if media_type:
        conditions.append("p.media_type = %s")
        params.append(media_type)
    if source_type:
        conditions.append("p.source_type = %s")
        params.append(source_type)
    if media_category:
        conditions.append("p.media_category = %s")
        params.append(media_category)
    if created_after:
        conditions.append("p.created_at >= %s")
        params.append(created_after)
    if created_before:
        conditions.append("p.created_at <= %s")
        params.append(created_before)

    return conditions, params


def search_posts(db, needed=None, optional=None, exclude=None,
                 media_type=None, limit=100, offset=0, order='newest', source_type=None,
                 media_category=None, created_after=None, created_before=None):
    conditions, params = _build_post_conditions(
        db, needed=needed, optional=optional, exclude=exclude,
        media_type=media_type, source_type=source_type, media_category=media_category,
        created_after=created_after, created_before=created_before,
    )

    where = ' AND '.join(conditions)
    order_clause = ORDER_CLAUSES.get(order, ORDER_CLAUSES['newest'])

    sql = f"""
        SELECT p.* FROM posts p
        WHERE {where}
        ORDER BY {order_clause}
        LIMIT %s OFFSET %s
    """
    params.extend([limit, offset])

    rows = db.execute(sql, params).fetchall()
    return [_parse_post_row(r) for r in rows]


def count_posts(db, needed=None, optional=None, exclude=None, media_type=None, source_type=None,
                media_category=None, created_after=None, created_before=None):
    conditions, params = _build_post_conditions(
        db, needed=needed, optional=optional, exclude=exclude,
        media_type=media_type, source_type=source_type, media_category=media_category,
        created_after=created_after, created_before=created_before,
    )
    where = ' AND '.join(conditions)
    row = db.execute(f"SELECT COUNT(*) as n FROM posts p WHERE {where}", params).fetchone()
    return row['n']


def get_browse_timeline_meta(db, needed=None, optional=None, exclude=None,
                             media_type=None, source_type=None, media_category=None,
                             created_after=None, created_before=None, anchor_offset=None):
    total = count_posts(
        db, needed=needed, optional=optional, exclude=exclude,
        media_type=media_type, source_type=source_type, media_category=media_category,
        created_after=created_after, created_before=created_before,
    )
    conditions, params = _build_post_conditions(
        db, needed=needed, optional=optional, exclude=exclude,
        media_type=media_type, source_type=source_type, media_category=media_category,
        created_after=created_after, created_before=created_before,
    )
    where = ' AND '.join(conditions)
    span = db.execute(
        f"SELECT MIN(p.created_at) as min_at, MAX(p.created_at) as max_at FROM posts p WHERE {where}",
        params,
    ).fetchone()

    anchor = None
    if anchor_offset is not None and total > 0:
        off = max(0, min(int(anchor_offset), total - 1))
        rows = search_posts(
            db, needed=needed, optional=optional, exclude=exclude,
            media_type=media_type, source_type=source_type, media_category=media_category,
            created_after=created_after, created_before=created_before,
            limit=1, offset=off, order='saved_oldest',
        )
        if rows:
            anchor = rows[0]

    return {
        'total': total,
        'min_created_at': span['min_at'],
        'max_created_at': span['max_at'],
        'anchor_offset': anchor_offset,
        'anchor': anchor,
    }


def get_stratified_random_posts(db, buckets=10, per_bucket=2, needed=None, optional=None,
                                exclude=None, media_type=None, source_type=None,
                                media_category=None, created_after=None, created_before=None):
    total = count_posts(
        db, needed=needed, optional=optional, exclude=exclude,
        media_type=media_type, source_type=source_type, media_category=media_category,
        created_after=created_after, created_before=created_before,
    )
    if total == 0:
        return []

    buckets = max(1, min(int(buckets), total))
    per_bucket = max(1, int(per_bucket))
    bucket_size = max(1, total // buckets)
    posts = []
    seen_ids = set()

    for i in range(buckets):
        start = i * bucket_size
        end = total if i == buckets - 1 else min(total, (i + 1) * bucket_size)
        if start >= end:
            continue
        span = end - start
        pick_n = min(per_bucket, span)
        offsets = random.sample(range(start, end), pick_n)
        for off in offsets:
            rows = search_posts(
                db, needed=needed, optional=optional, exclude=exclude,
                media_type=media_type, source_type=source_type, media_category=media_category,
                created_after=created_after, created_before=created_before,
                limit=1, offset=off, order='saved_oldest',
            )
            if rows and rows[0]['id'] not in seen_ids:
                posts.append(rows[0])
                seen_ids.add(rows[0]['id'])

    random.shuffle(posts)
    return posts


def _parse_post_row(row):
    d = dict(row)
    try:
        d['source_meta'] = json.loads(d.get('source_meta') or '{}')
    except (TypeError, json.JSONDecodeError):
        d['source_meta'] = {}
    return d


def get_post_with_tags(db, post_id):
    post = db.execute("SELECT * FROM posts WHERE id = %s", (post_id,)).fetchone()
    if not post:
        return None
    post = _parse_post_row(post)
    tags = db.execute("""
        SELECT t.name FROM tags t
        JOIN post_tags pt ON pt.tag_id = t.id
        WHERE pt.post_id = %s
        ORDER BY t.name
    """, (post_id,)).fetchall()
    post['tags'] = [r['name'] for r in tags]
    return post


def get_random_posts(db, count=20, needed=None, optional=None, exclude=None, media_type=None,
                     source_type=None, media_category=None):
    return search_posts(db, needed=needed, optional=optional, exclude=exclude,
                        media_type=media_type, limit=count, order='random',
                        source_type=source_type, media_category=media_category)


def find_existing_import(db, fields):
    """Return existing post id if this import would duplicate library content."""
    hub_id = fields.get('rule34hub_id')
    api_id = fields.get('rule34_api_id')
    file_url = fields.get('file_url')
    source_type = fields.get('source_type')
    hub_url = fields.get('hub_url')

    if hub_id is not None:
        row = db.execute(
            "SELECT id FROM posts WHERE rule34hub_id = %s", (hub_id,),
        ).fetchone()
        if row:
            return row['id']
    if api_id is not None:
        row = db.execute(
            "SELECT id FROM posts WHERE rule34_api_id = %s", (api_id,),
        ).fetchone()
        if row:
            return row['id']
    # Multporn: deduplicate by canonical comic URL
    if source_type == 'multporn' and hub_url:
        row = db.execute(
            "SELECT id FROM posts WHERE source_type = %s AND hub_url = %s",
            (source_type, hub_url),
        ).fetchone()
        if row:
            return row['id']
    if file_url and source_type == 'manual':
        row = db.execute(
            "SELECT id FROM posts WHERE file_url = %s AND source_type = %s",
            (file_url, source_type),
        ).fetchone()
        if row:
            return row['id']
    return None


def import_post(db, fields):
    """Insert a resolved import into the library. Returns (post_id, already_existed)."""
    existing_id = find_existing_import(db, fields)
    if existing_id is not None:
        return existing_id, True

    # Build source_meta: for comics store page_urls under 'pages' key.
    # Merge any caller-supplied source_meta with page_urls from the import fields.
    source_meta = dict(fields.get('source_meta') or {})
    page_urls = fields.get('page_urls')
    if page_urls:
        source_meta['pages'] = page_urls
    # Store comic title inside source_meta since posts has no title column
    title = fields.get('title')
    if title:
        source_meta['title'] = title
    source_meta_json = json.dumps(source_meta)

    row = db.execute("""
        INSERT INTO posts (
            rule34hub_id, rule34_api_id, file_url, cdn_url, thumb_cdn, hub_url,
            media_type, media_category, source_type, source_meta,
            status, resolved_by, created_at
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'resolved', %s, NOW())
        RETURNING id
    """, (
        fields.get('rule34hub_id'),
        fields.get('rule34_api_id'),
        fields.get('file_url'),
        fields.get('cdn_url') or fields.get('file_url'),
        fields.get('thumb_cdn') or fields.get('file_url'),
        fields.get('hub_url'),
        fields.get('media_type', 'image'),
        fields.get('media_category', 'library'),
        fields.get('source_type', 'manual'),
        source_meta_json,
        fields.get('resolved_by', 'url_import'),
    )).fetchone()
    post_id = row['id']

    for tag_name in fields.get('tags') or []:
        tag_name = str(tag_name).strip()
        if not tag_name:
            continue
        db.execute(
            "INSERT INTO tags (name) VALUES (%s) ON CONFLICT (name) DO NOTHING",
            (tag_name,),
        )
        tag_row = db.execute("SELECT id FROM tags WHERE name = %s", (tag_name,)).fetchone()
        if tag_row:
            db.execute(
                "INSERT INTO post_tags (post_id, tag_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (post_id, tag_row['id']),
            )

    db.commit()
    return post_id, False

# ── Tag helpers ───────────────────────────────────────────────────────────────

def get_all_tags_with_counts(db):
    rows = db.execute("""
        SELECT t.name, COUNT(pt.post_id) as count
        FROM tags t
        LEFT JOIN post_tags pt ON pt.tag_id = t.id
        GROUP BY t.id, t.name
        ORDER BY count DESC, t.name
    """).fetchall()
    return [dict(r) for r in rows]

def get_all_tag_groups(db):
    rows = db.execute("""
        SELECT group_name, STRING_AGG(tag_name, '||' ORDER BY tag_name) as members
        FROM tag_groups
        GROUP BY group_name
        ORDER BY group_name
    """).fetchall()
    return [{'group_name': r['group_name'], 'members': r['members'].split('||')} for r in rows]

def upsert_tag_group(db, group_name, tag_names):
    db.execute("DELETE FROM tag_groups WHERE group_name = %s", (group_name,))
    for tag in tag_names:
        db.execute("""
            INSERT INTO tag_groups (group_name, tag_name) VALUES (%s, %s)
            ON CONFLICT (tag_name) DO UPDATE SET group_name = EXCLUDED.group_name
        """, (group_name, tag.lower().replace(' ', '_')))
    db.commit()

def delete_tag_group(db, group_name):
    db.execute("DELETE FROM tag_groups WHERE group_name = %s", (group_name,))
    db.commit()

# ── Collections ───────────────────────────────────────────────────────────────

def _parse_collection_search_tags(row_dict):
    raw = row_dict.get('search_tags')
    if raw is None:
        row_dict['search_tags'] = []
        return
    if isinstance(raw, list):
        return
    try:
        row_dict['search_tags'] = json.loads(raw or '[]')
    except (TypeError, json.JSONDecodeError):
        row_dict['search_tags'] = []


def get_collections(db):
    rows = db.execute("""
        SELECT c.*, COUNT(cp.post_id) as post_count
        FROM collections c
        LEFT JOIN collection_posts cp ON cp.collection_id = c.id
        GROUP BY c.id
        ORDER BY c.updated_at DESC
    """).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        _parse_collection_search_tags(d)
        out.append(d)
    return out

def get_collection(db, collection_id):
    col = db.execute("SELECT * FROM collections WHERE id = %s", (collection_id,)).fetchone()
    if not col:
        return None
    posts = db.execute("""
        SELECT p.* FROM posts p
        JOIN collection_posts cp ON cp.post_id = p.id
        WHERE cp.collection_id = %s
        ORDER BY cp.position
    """, (collection_id,)).fetchall()
    result = dict(col)
    _parse_collection_search_tags(result)
    result['posts'] = [_parse_post_row(p) for p in posts]
    return result

def create_collection(db, name, post_ids=None, search_tags=None):
    tags_json = json.dumps(search_tags or [])
    row = db.execute(
        "INSERT INTO collections (name, search_tags) VALUES (%s, %s) RETURNING id",
        (name, tags_json),
    ).fetchone()
    col_id = row['id']
    if post_ids:
        for i, pid in enumerate(post_ids):
            db.execute(
                "INSERT INTO collection_posts (collection_id, post_id, position) VALUES (%s, %s, %s) "
                "ON CONFLICT (collection_id, post_id) DO NOTHING",
                (col_id, pid, i),
            )
    db.commit()
    return col_id

def update_collection_posts(db, collection_id, post_ids):
    db.execute("DELETE FROM collection_posts WHERE collection_id = %s", (collection_id,))
    for i, pid in enumerate(post_ids):
        db.execute(
            "INSERT INTO collection_posts (collection_id, post_id, position) VALUES (%s, %s, %s)",
            (collection_id, pid, i),
        )
    db.execute("UPDATE collections SET updated_at = NOW() WHERE id = %s", (collection_id,))
    db.commit()


def update_collection_meta(db, collection_id, name=None, search_tags=None):
    parts = []
    params = []
    if name is not None:
        parts.append("name = %s")
        params.append(name)
    if search_tags is not None:
        parts.append("search_tags = %s")
        params.append(json.dumps(search_tags))
    if not parts:
        return
    parts.append("updated_at = NOW()")
    params.append(collection_id)
    db.execute(
        f"UPDATE collections SET {', '.join(parts)} WHERE id = %s",
        params,
    )
    db.commit()


def append_post_to_collection(db, collection_id, post_id):
    row = db.execute(
        """SELECT COALESCE(MAX(position), -1) AS m FROM collection_posts
           WHERE collection_id = %s""",
        (collection_id,),
    ).fetchone()
    pos = int(row['m']) + 1
    db.execute(
        "INSERT INTO collection_posts (collection_id, post_id, position) VALUES (%s, %s, %s) "
        "ON CONFLICT (collection_id, post_id) DO NOTHING",
        (collection_id, post_id, pos),
    )
    db.execute("UPDATE collections SET updated_at = NOW() WHERE id = %s", (collection_id,))
    db.commit()


def record_collection_review_ignored(db, collection_id, post_ids):
    for pid in post_ids:
        db.execute(
            "INSERT INTO collection_review (collection_id, post_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (collection_id, int(pid)),
        )
    db.commit()


def get_collection_review_queue(db, collection_id, limit=80):
    col = db.execute("SELECT search_tags FROM collections WHERE id = %s", (collection_id,)).fetchone()
    if not col:
        return []
    try:
        tags = json.loads(col['search_tags'] or '[]')
    except (TypeError, json.JSONDecodeError):
        tags = []
    if not tags:
        return []
    tags = expand_tags_with_groups(tags, db)

    in_col = {r['post_id'] for r in db.execute(
        "SELECT post_id FROM collection_posts WHERE collection_id = %s", (collection_id,)
    ).fetchall()}
    reviewed = {r['post_id'] for r in db.execute(
        "SELECT post_id FROM collection_review WHERE collection_id = %s", (collection_id,)
    ).fetchall()}
    exclude_ids = in_col | reviewed

    candidates = search_posts(
        db, needed=[], optional=tags, exclude=None, limit=600, offset=0, order='newest',
    )
    out = []
    for p in candidates:
        if p['id'] in exclude_ids:
            continue
        out.append(p)
        if len(out) >= limit:
            break
    return out

# ── Selections ────────────────────────────────────────────────────────────────

MAX_HISTORY = 10

def save_selection(db, post_ids, name=None, is_saved=False):
    post_ids_json = json.dumps(post_ids)
    row = db.execute(
        "INSERT INTO selections (name, post_ids, is_saved) VALUES (%s, %s, %s) RETURNING id",
        (name, post_ids_json, 1 if is_saved else 0),
    ).fetchone()
    sel_id = row['id']
    db.commit()
    db.execute("""
        DELETE FROM selections
        WHERE is_saved = 0 AND name != '__current__'
          AND id NOT IN (
            SELECT id FROM (
                SELECT id FROM selections
                WHERE is_saved = 0 AND name != '__current__'
                ORDER BY created_at DESC
                LIMIT %s
            ) keep_rows
          )
    """, (MAX_HISTORY,))
    db.commit()
    return sel_id

def get_selections(db, saved_only=False):
    if saved_only:
        rows = db.execute(
            "SELECT * FROM selections WHERE is_saved = 1 ORDER BY updated_at DESC"
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM selections WHERE name != '__current__' ORDER BY is_saved DESC, updated_at DESC"
        ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d['post_ids'] = json.loads(d['post_ids'])
        d['post_count'] = len(d['post_ids'])
        result.append(d)
    return result

def get_selection(db, selection_id):
    row = db.execute("SELECT * FROM selections WHERE id = %s", (selection_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d['post_ids'] = json.loads(d['post_ids'])
    return d

def promote_selection_to_collection(db, selection_id, name):
    sel = get_selection(db, selection_id)
    if not sel:
        return None
    col_id = create_collection(db, name, sel['post_ids'])
    db.execute("UPDATE selections SET is_saved = 1, name = %s WHERE id = %s", (name, selection_id))
    db.commit()
    return col_id

# ── Subscriptions ─────────────────────────────────────────────────────────────

def get_subscriptions(db):
    rows = db.execute("SELECT * FROM subscriptions ORDER BY tag_name").fetchall()
    return [dict(r) for r in rows]

def add_subscription(db, tag_name):
    tag_name = tag_name.lower().replace(' ', '_')
    db.execute(
        "INSERT INTO subscriptions (tag_name) VALUES (%s) ON CONFLICT (tag_name) DO NOTHING",
        (tag_name,),
    )
    db.commit()

def remove_subscription(db, tag_name):
    db.execute("DELETE FROM subscriptions WHERE tag_name = %s", (tag_name,))
    db.commit()

# ── Feed ──────────────────────────────────────────────────────────────────────

def get_feed_posts(db, status='unseen', limit=50, offset=0):
    rows = db.execute("""
        SELECT * FROM feed_posts
        WHERE status = %s
        ORDER BY post_date DESC NULLS LAST, id DESC
        LIMIT %s OFFSET %s
    """, (status, limit, offset)).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d['tags'] = json.loads(d['tags'])
        d['matched_subs'] = json.loads(d['matched_subs'])
        if not d.get('media_type'):
            d['media_type'] = infer_rule34_media_type(d.get('file_url'), d['tags'])
        result.append(d)
    return result

def upsert_feed_post(db, rule34_post_id, file_url, preview_url, tags, matched_subs, post_date,
                       media_type=None, *, commit=True):
    if media_type is None:
        media_type = infer_rule34_media_type(file_url, tags)
    existing = db.execute(
        "SELECT id, status FROM feed_posts WHERE rule34_post_id = %s", (rule34_post_id,)
    ).fetchone()
    if existing:
        if existing['status'] != 'unseen':
            return
        db.execute("""
            UPDATE feed_posts SET file_url=%s, preview_url=%s, tags=%s, matched_subs=%s,
                post_date=%s, media_type=%s
            WHERE rule34_post_id=%s
        """, (file_url, preview_url, json.dumps(tags), json.dumps(matched_subs), post_date, media_type, rule34_post_id))
    else:
        db.execute("""
            INSERT INTO feed_posts (rule34_post_id, file_url, preview_url, tags, matched_subs, post_date, media_type)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (rule34_post_id, file_url, preview_url, json.dumps(tags), json.dumps(matched_subs), post_date, media_type))
    if commit:
        db.commit()

def set_feed_post_status(db, rule34_post_id, status):
    db.execute("UPDATE feed_posts SET status = %s WHERE rule34_post_id = %s", (status, rule34_post_id))
    db.commit()

# ── External source subscriptions & feed ────────────────────────────────────

def seed_source_subscriptions(db):
    pass


def get_source_subscriptions(db):
    rows = db.execute(
        "SELECT * FROM source_subscriptions WHERE enabled = 1 ORDER BY label, url"
    ).fetchall()
    return [dict(r) for r in rows]


def add_source_subscription(db, url, source_kind=None, label=None):
    from external.detect import detect_url_kind, normalize_url
    url = normalize_url(url)
    kind = source_kind or detect_url_kind(url)
    if kind in ('unknown', 'webpage', 'direct_image', 'ph_video'):
        kind = kind if kind not in ('unknown',) else 'webpage'
    db.execute(
        """INSERT INTO source_subscriptions (source_kind, url, label)
           VALUES (%s, %s, %s) ON CONFLICT (url) DO NOTHING""",
        (kind, url, label or url),
    )
    db.commit()


def remove_source_subscription(db, sub_id):
    db.execute("DELETE FROM source_subscriptions WHERE id = %s", (sub_id,))
    db.commit()


def _parse_ext_feed_row(row):
    d = dict(row)
    d['tags'] = json.loads(d.get('tags') or '[]')
    try:
        d['source_meta'] = json.loads(d.get('source_meta') or '{}')
    except (TypeError, json.JSONDecodeError):
        d['source_meta'] = {}
    return d


def get_ext_feed_posts(db, status='unseen', limit=50, offset=0, source_kind=None):
    params = [status]
    sql = "SELECT * FROM ext_feed_posts WHERE status = %s"
    if source_kind:
        sql += " AND source_kind = %s"
        params.append(source_kind)
    sql += " ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s"
    params.extend([limit, offset])
    return [_parse_ext_feed_row(r) for r in db.execute(sql, params).fetchall()]


def upsert_ext_feed_item(db, item, owned_keys=None):
    sk = item['source_kind']
    key = item['source_key']
    owned_keys = owned_keys or set()

    existing = db.execute(
        "SELECT id, status, file_url, preview_url FROM ext_feed_posts WHERE source_kind = %s AND source_key = %s",
        (sk, key),
    ).fetchone()

    status = 'owned' if (sk, key) in owned_keys else 'unseen'
    tags_json = json.dumps(item.get('tags') or [])
    meta_json = json.dumps(item.get('source_meta') or {})

    if existing:
        if existing['file_url'] or existing['preview_url']:
            return False
        db.execute("""
            UPDATE ext_feed_posts SET
                source_url=%s, file_url=%s, preview_url=%s, media_type=%s, media_category=%s,
                title=%s, tags=%s, source_meta=%s, status=%s
            WHERE source_kind=%s AND source_key=%s
        """, (
            item.get('source_url'), item.get('file_url'), item.get('preview_url'),
            item.get('media_type', 'image'), item.get('media_category', 'external'),
            item.get('title'), tags_json, meta_json, status, sk, key,
        ))
        return status == 'unseen'
    else:
        db.execute("""
            INSERT INTO ext_feed_posts
                (source_kind, source_key, source_url, file_url, preview_url,
                 media_type, media_category, title, tags, source_meta, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            sk, key, item.get('source_url'), item.get('file_url'), item.get('preview_url'),
            item.get('media_type', 'image'), item.get('media_category', 'external'),
            item.get('title'), tags_json, meta_json, status,
        ))
        return status == 'unseen'


def set_ext_feed_status(db, ext_id, status):
    db.execute("UPDATE ext_feed_posts SET status = %s WHERE id = %s", (status, ext_id))
    db.commit()


def get_ext_feed_post(db, ext_id):
    row = db.execute("SELECT * FROM ext_feed_posts WHERE id = %s", (ext_id,)).fetchone()
    return _parse_ext_feed_row(row) if row else None


def save_ext_item_to_library(db, item):
    sk = item['source_kind']
    key = item['source_key']
    source_type_map = {
        'gofile_folder': 'gofile',
        'ph_playlist': 'pornhub',
        'ph_video': 'pornhub',
        'hdporncomics': 'hdporncomics',
        'direct_image': 'manual',
        'webpage': 'manual',
    }
    source_type = source_type_map.get(sk, sk)
    media_type = item.get('media_type') or 'image'
    meta = item.get('source_meta') or {}
    meta_json = json.dumps(meta)

    existing = db.execute(
        "SELECT id FROM posts WHERE source_type = %s AND external_id = %s",
        (source_type, key),
    ).fetchone()
    if existing:
        return existing['id']

    row = db.execute("""
        INSERT INTO posts
            (file_url, cdn_url, thumb_cdn, media_type, media_category, source_type,
             external_id, source, source_meta, status, resolved_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'resolved', 'ext_import')
        RETURNING id
    """, (
        item.get('file_url'),
        item.get('file_url'),
        item.get('preview_url') or item.get('file_url'),
        media_type,
        item.get('media_category', 'external'),
        source_type,
        key,
        item.get('source_url') or meta.get('webpage_url'),
        meta_json,
    )).fetchone()
    post_id = row['id']
    for tag_name in (item.get('tags') or []):
        tag_name = str(tag_name).strip()
        if not tag_name:
            continue
        db.execute(
            "INSERT INTO tags (name) VALUES (%s) ON CONFLICT (name) DO NOTHING",
            (tag_name,),
        )
        tag_row = db.execute("SELECT id FROM tags WHERE name = %s", (tag_name,)).fetchone()
        if tag_row:
            db.execute(
                "INSERT INTO post_tags (post_id, tag_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (post_id, tag_row['id']),
            )
    db.commit()
    return post_id


def get_owned_external_keys(db):
    rows = db.execute(
        "SELECT source_type, external_id FROM posts WHERE external_id IS NOT NULL"
    ).fetchall()
    kind_map = {
        'gofile': 'gofile_folder',
        'pornhub': 'ph_playlist',
        'hdporncomics': 'hdporncomics',
        'manual': 'direct_image',
    }
    out = set()
    for r in rows:
        sk = kind_map.get(r['source_type'], r['source_type'])
        out.add((sk, r['external_id']))
    return out


def get_known_external_keys(db):
    known = get_owned_external_keys(db)
    rows = db.execute(
        "SELECT source_kind, source_key, file_url, preview_url FROM ext_feed_posts"
    ).fetchall()
    for r in rows:
        if r['file_url'] or r['preview_url']:
            known.add((r['source_kind'], r['source_key']))
    return known