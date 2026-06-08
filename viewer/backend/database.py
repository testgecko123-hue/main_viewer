import sqlite3
import json
import os
import random

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'posts.db')
SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'schema.sql')

def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA journal_mode = WAL")  # better concurrent read performance
    return db

def _migrate_schema(db):
    """Apply additive migrations for existing DBs (schema.sql is not re-run on ALTER)."""
    cols = [r[1] for r in db.execute("PRAGMA table_info(collections)").fetchall()]
    if cols and 'search_tags' not in cols:
        db.execute("ALTER TABLE collections ADD COLUMN search_tags TEXT DEFAULT '[]'")
    post_cols = [r[1] for r in db.execute("PRAGMA table_info(posts)").fetchall()]
    if post_cols and 'source_type' not in post_cols:
        db.execute("ALTER TABLE posts ADD COLUMN source_type TEXT DEFAULT 'rule34'")
    if post_cols and 'external_id' not in post_cols:
        db.execute("ALTER TABLE posts ADD COLUMN external_id TEXT")
    if post_cols and 'source_meta' not in post_cols:
        db.execute("ALTER TABLE posts ADD COLUMN source_meta TEXT DEFAULT '{}'")
    if post_cols and 'media_category' not in post_cols:
        db.execute("ALTER TABLE posts ADD COLUMN media_category TEXT DEFAULT 'library'")
    db.execute("""
        CREATE TABLE IF NOT EXISTS collection_review (
            collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            PRIMARY KEY (collection_id, post_id)
        )
    """)
    db.execute(
        "CREATE INDEX IF NOT EXISTS idx_collection_review_col ON collection_review(collection_id)"
    )
    db.execute("""
        CREATE TABLE IF NOT EXISTS source_subscriptions (
            id              INTEGER PRIMARY KEY,
            source_kind     TEXT NOT NULL,
            url             TEXT NOT NULL UNIQUE,
            label           TEXT,
            enabled         INTEGER NOT NULL DEFAULT 1,
            last_fetched_at REAL,
            created_at      TEXT DEFAULT (datetime('now'))
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS ext_feed_posts (
            id              INTEGER PRIMARY KEY,
            source_kind     TEXT NOT NULL,
            source_key      TEXT NOT NULL,
            source_url      TEXT,
            file_url        TEXT,
            preview_url     TEXT,
            media_type      TEXT DEFAULT 'image',
            media_category  TEXT DEFAULT 'external',
            title           TEXT,
            tags            TEXT DEFAULT '[]',
            source_meta     TEXT DEFAULT '{}',
            status          TEXT DEFAULT 'unseen',
            post_date       TEXT,
            created_at      TEXT DEFAULT (datetime('now')),
            UNIQUE(source_kind, source_key)
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS idx_ext_feed_status ON ext_feed_posts(status)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_source_subs_kind ON source_subscriptions(source_kind)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_posts_media_category ON posts(media_category)")
    feed_cols = [r[1] for r in db.execute("PRAGMA table_info(feed_posts)").fetchall()]
    if feed_cols and 'media_type' not in feed_cols:
        db.execute("ALTER TABLE feed_posts ADD COLUMN media_type TEXT DEFAULT 'image'")
        rows = db.execute(
            "SELECT rule34_post_id, file_url, tags FROM feed_posts"
        ).fetchall()
        for row in rows:
            tags = json.loads(row['tags'] or '[]')
            mt = infer_rule34_media_type(row['file_url'], tags)
            db.execute(
                "UPDATE feed_posts SET media_type = ? WHERE rule34_post_id = ?",
                (mt, row['rule34_post_id']),
            )


def infer_rule34_media_type(file_url, tags=None):
    """Classify a Rule34 post for feed/library display."""
    tag_set = {t.lower() for t in (tags or [])}
    if 'vr' in tag_set:
        return 'vr'
    path = (file_url or '').lower().split('?')[0]
    if path.endswith(('.mp4', '.webm', '.mov', '.m4v')):
        return 'video'
    if 'video' in tag_set:
        return 'video'
    return 'image'


def init_db():
    db = get_db()
    with open(SCHEMA_PATH) as f:
        db.executescript(f.read())
    _migrate_schema(db)
    seed_source_subscriptions(db)
    db.commit()
    db.close()

# ── Tag group helpers ─────────────────────────────────────────────────────────

def expand_tags_with_groups(tag_names, db):
    """Given a list of tag names, expand each to include all aliases in its group."""
    if not tag_names:
        return tag_names
    expanded = set()
    for tag in tag_names:
        expanded.add(tag)
        # Find group this tag belongs to
        row = db.execute(
            "SELECT group_name FROM tag_groups WHERE tag_name = ?", (tag,)
        ).fetchone()
        if row:
            # Add all members of the group
            members = db.execute(
                "SELECT tag_name FROM tag_groups WHERE group_name = ?", (row['group_name'],)
            ).fetchall()
            for m in members:
                expanded.add(m['tag_name'])
    return list(expanded)

# ── Post search ───────────────────────────────────────────────────────────────

ORDER_CLAUSES = {
    'newest':       'COALESCE(p.rule34hub_id, p.rule34_api_id) DESC',
    'oldest':       'COALESCE(p.rule34hub_id, p.rule34_api_id) ASC',
    'saved_newest': 'p.created_at DESC',
    'saved_oldest': 'p.created_at ASC',
    'random':       'RANDOM()',
}


def _build_post_conditions(db, needed=None, optional=None, exclude=None,
                           media_type=None, source_type=None, media_category=None,
                           created_after=None, created_before=None):
    """
    needed   : list of tags — post must have ALL (group-expanded)
    optional : list of tags — post must have AT LEAST ONE (group-expanded)
    exclude  : list of tags — post must have NONE (group-expanded)
    """
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
                WHERE pt.post_id = p.id AND t.name = ?
            )
        """)
        params.append(tag)

    if optional:
        placeholders = ','.join('?' * len(optional))
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
                WHERE pt.post_id = p.id AND t.name = ?
            )
        """)
        params.append(tag)

    if media_type:
        conditions.append("p.media_type = ?")
        params.append(media_type)
    if source_type:
        conditions.append("p.source_type = ?")
        params.append(source_type)
    if media_category:
        conditions.append("p.media_category = ?")
        params.append(media_category)
    if created_after:
        conditions.append("p.created_at >= ?")
        params.append(created_after)
    if created_before:
        conditions.append("p.created_at <= ?")
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
        LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])

    rows = db.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


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
    """Total count, date span, and optional anchor post at offset (saved_oldest order)."""
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
    """Sample posts evenly across timeline buckets (saved_oldest order)."""
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


def get_post_with_tags(db, post_id):
    post = db.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
    if not post:
        return None
    post = dict(post)
    tags = db.execute("""
        SELECT t.name FROM tags t
        JOIN post_tags pt ON pt.tag_id = t.id
        WHERE pt.post_id = ?
        ORDER BY t.name
    """, (post_id,)).fetchall()
    post['tags'] = [r['name'] for r in tags]
    try:
        post['source_meta'] = json.loads(post.get('source_meta') or '{}')
    except (TypeError, json.JSONDecodeError):
        post['source_meta'] = {}
    return post


def get_random_posts(db, count=20, needed=None, optional=None, exclude=None, media_type=None,
                     source_type=None, media_category=None):
    return search_posts(db, needed=needed, optional=optional, exclude=exclude,
                        media_type=media_type, limit=count, order='random',
                        source_type=source_type, media_category=media_category)

# ── Tag helpers ───────────────────────────────────────────────────────────────

def get_all_tags_with_counts(db):
    rows = db.execute("""
        SELECT t.name, COUNT(pt.post_id) as count
        FROM tags t
        LEFT JOIN post_tags pt ON pt.tag_id = t.id
        GROUP BY t.id
        ORDER BY count DESC, t.name
    """).fetchall()
    return [dict(r) for r in rows]

def get_all_tag_groups(db):
    rows = db.execute("""
        SELECT group_name, GROUP_CONCAT(tag_name, '||') as members
        FROM tag_groups
        GROUP BY group_name
        ORDER BY group_name
    """).fetchall()
    return [{'group_name': r['group_name'], 'members': r['members'].split('||')} for r in rows]

def upsert_tag_group(db, group_name, tag_names):
    """Replace all members of a group."""
    db.execute("DELETE FROM tag_groups WHERE group_name = ?", (group_name,))
    for tag in tag_names:
        db.execute("INSERT OR REPLACE INTO tag_groups (group_name, tag_name) VALUES (?,?)",
                   (group_name, tag.lower().replace(' ', '_')))
    db.commit()

def delete_tag_group(db, group_name):
    db.execute("DELETE FROM tag_groups WHERE group_name = ?", (group_name,))
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
    col = db.execute("SELECT * FROM collections WHERE id = ?", (collection_id,)).fetchone()
    if not col:
        return None
    posts = db.execute("""
        SELECT p.* FROM posts p
        JOIN collection_posts cp ON cp.post_id = p.id
        WHERE cp.collection_id = ?
        ORDER BY cp.position
    """, (collection_id,)).fetchall()
    result = dict(col)
    _parse_collection_search_tags(result)
    result['posts'] = [dict(p) for p in posts]
    return result

def create_collection(db, name, post_ids=None, search_tags=None):
    tags_json = json.dumps(search_tags or [])
    cur = db.execute(
        "INSERT INTO collections (name, search_tags) VALUES (?,?)", (name, tags_json)
    )
    col_id = cur.lastrowid
    if post_ids:
        for i, pid in enumerate(post_ids):
            db.execute("INSERT INTO collection_posts (collection_id, post_id, position) VALUES (?,?,?)",
                       (col_id, pid, i))
    db.commit()
    return col_id

def update_collection_posts(db, collection_id, post_ids):
    db.execute("DELETE FROM collection_posts WHERE collection_id = ?", (collection_id,))
    for i, pid in enumerate(post_ids):
        db.execute("INSERT INTO collection_posts (collection_id, post_id, position) VALUES (?,?,?)",
                   (collection_id, pid, i))
    db.execute("UPDATE collections SET updated_at = datetime('now') WHERE id = ?", (collection_id,))
    db.commit()


def update_collection_meta(db, collection_id, name=None, search_tags=None):
    parts = []
    params = []
    if name is not None:
        parts.append("name = ?")
        params.append(name)
    if search_tags is not None:
        parts.append("search_tags = ?")
        params.append(json.dumps(search_tags))
    if not parts:
        return
    parts.append("updated_at = datetime('now')")
    params.append(collection_id)
    db.execute(
        f"UPDATE collections SET {', '.join(parts)} WHERE id = ?",
        params,
    )
    db.commit()


def append_post_to_collection(db, collection_id, post_id):
    row = db.execute(
        """SELECT COALESCE(MAX(position), -1) AS m FROM collection_posts
           WHERE collection_id = ?""",
        (collection_id,),
    ).fetchone()
    pos = int(row['m']) + 1
    db.execute(
        "INSERT OR IGNORE INTO collection_posts (collection_id, post_id, position) VALUES (?,?,?)",
        (collection_id, post_id, pos),
    )
    db.execute("UPDATE collections SET updated_at = datetime('now') WHERE id = ?", (collection_id,))
    db.commit()


def record_collection_review_ignored(db, collection_id, post_ids):
    for pid in post_ids:
        try:
            db.execute(
                "INSERT INTO collection_review (collection_id, post_id) VALUES (?,?)",
                (collection_id, int(pid)),
            )
        except sqlite3.IntegrityError:
            pass
    db.commit()


def get_collection_review_queue(db, collection_id, limit=80):
    """
    Library posts matching collection search_tags (optional: any tag), excluding
    posts already in the collection and posts previously ignored in review.
    """
    col = db.execute("SELECT search_tags FROM collections WHERE id = ?", (collection_id,)).fetchone()
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
        "SELECT post_id FROM collection_posts WHERE collection_id = ?", (collection_id,)
    ).fetchall()}
    reviewed = {r['post_id'] for r in db.execute(
        "SELECT post_id FROM collection_review WHERE collection_id = ?", (collection_id,)
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
    cur = db.execute(
        "INSERT INTO selections (name, post_ids, is_saved) VALUES (?,?,?)",
        (name, post_ids_json, 1 if is_saved else 0)
    )
    sel_id = cur.lastrowid
    db.commit()
    # Prune history: keep only last MAX_HISTORY unsaved selections (__current__ is reserved)
    db.execute("""
        DELETE FROM selections WHERE is_saved = 0 AND name != '__current__' AND id NOT IN (
            SELECT id FROM selections WHERE is_saved = 0 AND name != '__current__'
            ORDER BY created_at DESC LIMIT ?
        )
    """, (MAX_HISTORY,))
    db.commit()
    return sel_id

def get_selections(db, saved_only=False):
    if saved_only:
        rows = db.execute("SELECT * FROM selections WHERE is_saved = 1 ORDER BY updated_at DESC").fetchall()
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
    row = db.execute("SELECT * FROM selections WHERE id = ?", (selection_id,)).fetchone()
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
    db.execute("UPDATE selections SET is_saved = 1, name = ? WHERE id = ?", (name, selection_id))
    db.commit()
    return col_id

# ── Subscriptions ─────────────────────────────────────────────────────────────

def get_subscriptions(db):
    rows = db.execute("SELECT * FROM subscriptions ORDER BY tag_name").fetchall()
    return [dict(r) for r in rows]

def add_subscription(db, tag_name):
    tag_name = tag_name.lower().replace(' ', '_')
    db.execute("INSERT OR IGNORE INTO subscriptions (tag_name) VALUES (?)", (tag_name,))
    db.commit()

def remove_subscription(db, tag_name):
    db.execute("DELETE FROM subscriptions WHERE tag_name = ?", (tag_name,))
    db.commit()

# ── Feed ──────────────────────────────────────────────────────────────────────

def get_feed_posts(db, status='unseen', limit=50, offset=0):
    rows = db.execute("""
        SELECT * FROM feed_posts
        WHERE status = ?
        ORDER BY post_date DESC, id DESC
        LIMIT ? OFFSET ?
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
                       media_type=None):
    if media_type is None:
        media_type = infer_rule34_media_type(file_url, tags)
    existing = db.execute(
        "SELECT id, status FROM feed_posts WHERE rule34_post_id = ?", (rule34_post_id,)
    ).fetchone()
    if existing:
        # Never overwrite a user decision
        if existing['status'] != 'unseen':
            return
        db.execute("""
            UPDATE feed_posts SET file_url=?, preview_url=?, tags=?, matched_subs=?, post_date=?, media_type=?
            WHERE rule34_post_id=?
        """, (file_url, preview_url, json.dumps(tags), json.dumps(matched_subs), post_date, media_type, rule34_post_id))
    else:
        db.execute("""
            INSERT INTO feed_posts (rule34_post_id, file_url, preview_url, tags, matched_subs, post_date, media_type)
            VALUES (?,?,?,?,?,?,?)
        """, (rule34_post_id, file_url, preview_url, json.dumps(tags), json.dumps(matched_subs), post_date, media_type))
    db.commit()

def set_feed_post_status(db, rule34_post_id, status):
    db.execute("UPDATE feed_posts SET status = ? WHERE rule34_post_id = ?", (status, rule34_post_id))
    db.commit()

# ── External source subscriptions & feed ────────────────────────────────────

def seed_source_subscriptions(db):
    """No built-in external subscriptions (PH/Gofile removed)."""
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
        """INSERT OR IGNORE INTO source_subscriptions (source_kind, url, label)
           VALUES (?,?,?)""",
        (kind, url, label or url),
    )
    db.commit()


def remove_source_subscription(db, sub_id):
    db.execute("DELETE FROM source_subscriptions WHERE id = ?", (sub_id,))
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
    sql = "SELECT * FROM ext_feed_posts WHERE status = ?"
    if source_kind:
        sql += " AND source_kind = ?"
        params.append(source_kind)
    sql += " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    return [_parse_ext_feed_row(r) for r in db.execute(sql, params).fetchall()]


def upsert_ext_feed_item(db, item, owned_keys=None):
    """
    Insert or refresh an ext feed item. Skips if user already actioned it.
    owned_keys: set of (source_kind, source_key) already in library.
    """
    sk = item['source_kind']
    key = item['source_key']
    owned_keys = owned_keys or set()

    existing = db.execute(
        "SELECT id, status, file_url, preview_url FROM ext_feed_posts WHERE source_kind = ? AND source_key = ?",
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
                source_url=?, file_url=?, preview_url=?, media_type=?, media_category=?,
                title=?, tags=?, source_meta=?, status=?
            WHERE source_kind=? AND source_key=?
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
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """, (
            sk, key, item.get('source_url'), item.get('file_url'), item.get('preview_url'),
            item.get('media_type', 'image'), item.get('media_category', 'external'),
            item.get('title'), tags_json, meta_json, status,
        ))
        return status == 'unseen'


def set_ext_feed_status(db, ext_id, status):
    db.execute("UPDATE ext_feed_posts SET status = ? WHERE id = ?", (status, ext_id))
    db.commit()


def get_ext_feed_post(db, ext_id):
    row = db.execute("SELECT * FROM ext_feed_posts WHERE id = ?", (ext_id,)).fetchone()
    return _parse_ext_feed_row(row) if row else None


def save_ext_item_to_library(db, item):
    """Insert external item into posts + tags. Returns post id."""
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
        "SELECT id FROM posts WHERE source_type = ? AND external_id = ?",
        (source_type, key),
    ).fetchone()
    if existing:
        return existing['id']

    cur = db.execute("""
        INSERT INTO posts
            (file_url, cdn_url, thumb_cdn, media_type, media_category, source_type,
             external_id, source, source_meta, status, resolved_by)
        VALUES (?,?,?,?,?,?,?,?,?,'resolved','ext_import')
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
    ))
    post_id = cur.lastrowid
    for tag_name in (item.get('tags') or []):
        tag_name = str(tag_name).strip()
        if not tag_name:
            continue
        db.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag_name,))
        tag_row = db.execute("SELECT id FROM tags WHERE name = ?", (tag_name,)).fetchone()
        if tag_row:
            db.execute(
                "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?,?)",
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
    """External items to skip re-scraping (library + feed rows that already have media)."""
    known = get_owned_external_keys(db)
    rows = db.execute(
        "SELECT source_kind, source_key, file_url, preview_url FROM ext_feed_posts"
    ).fetchall()
    for r in rows:
        if r['file_url'] or r['preview_url']:
            known.add((r['source_kind'], r['source_key']))
    return known
