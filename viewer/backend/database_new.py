import sqlite3
import json
import os

# DB_DIR env var lets Render point this at the persistent disk (/data)
_db_dir  = os.environ.get('DB_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
DB_PATH  = os.path.join(_db_dir, 'posts.db')
SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'schema.sql')

def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA journal_mode = WAL")
    return db

def _migrate_schema(db):
    cols = [r[1] for r in db.execute("PRAGMA table_info(collections)").fetchall()]
    if cols and 'search_tags' not in cols:
        db.execute("ALTER TABLE collections ADD COLUMN search_tags TEXT DEFAULT '[]'")
    db.execute("""
        CREATE TABLE IF NOT EXISTS collection_review (
            collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            PRIMARY KEY (collection_id, post_id)
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS idx_collection_review_col ON collection_review(collection_id)")

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = get_db()
    with open(SCHEMA_PATH) as f:
        db.executescript(f.read())
    _migrate_schema(db)
    db.commit()
    db.close()

# ── Tag group helpers ─────────────────────────────────────────────────────────

def expand_tags_with_groups(tag_names, db):
    if not tag_names:
        return tag_names
    expanded = set()
    for tag in tag_names:
        expanded.add(tag)
        row = db.execute("SELECT group_name FROM tag_groups WHERE tag_name = ?", (tag,)).fetchone()
        if row:
            members = db.execute("SELECT tag_name FROM tag_groups WHERE group_name = ?", (row['group_name'],)).fetchall()
            for m in members:
                expanded.add(m['tag_name'])
    return list(expanded)

# ── Post search ───────────────────────────────────────────────────────────────

def search_posts(db, needed=None, optional=None, exclude=None,
                 media_type=None, limit=100, offset=0, order='newest'):
    needed   = expand_tags_with_groups(needed or [],  db)
    optional = expand_tags_with_groups(optional or [], db)
    exclude  = expand_tags_with_groups(exclude or [],  db)

    params = []
    conditions = ["p.status = 'resolved'"]

    for tag in needed:
        conditions.append("""
            EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON pt.tag_id = t.id
                    WHERE pt.post_id = p.id AND t.name = ?)
        """)
        params.append(tag)

    if optional:
        placeholders = ','.join('?' * len(optional))
        conditions.append(f"""
            EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON pt.tag_id = t.id
                    WHERE pt.post_id = p.id AND t.name IN ({placeholders}))
        """)
        params.extend(optional)

    for tag in exclude:
        conditions.append("""
            NOT EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON pt.tag_id = t.id
                        WHERE pt.post_id = p.id AND t.name = ?)
        """)
        params.append(tag)

    if media_type:
        conditions.append("p.media_type = ?")
        params.append(media_type)

    where = ' AND '.join(conditions)
    order_clause = {
        'newest':       'COALESCE(p.rule34hub_id, p.rule34_api_id) DESC',
        'oldest':       'COALESCE(p.rule34hub_id, p.rule34_api_id) ASC',
        'saved_newest': 'p.created_at DESC',
        'saved_oldest': 'p.created_at ASC',
        'random':       'RANDOM()',
    }.get(order, 'COALESCE(p.rule34hub_id, p.rule34_api_id) DESC')

    rows = db.execute(f"""
        SELECT p.* FROM posts p WHERE {where}
        ORDER BY {order_clause} LIMIT ? OFFSET ?
    """, params + [limit, offset]).fetchall()
    return [dict(r) for r in rows]

def count_posts(db, needed=None, optional=None, exclude=None, media_type=None):
    needed   = expand_tags_with_groups(needed or [],  db)
    optional = expand_tags_with_groups(optional or [], db)
    exclude  = expand_tags_with_groups(exclude or [],  db)

    params = []; conditions = ["p.status = 'resolved'"]
    for tag in needed:
        conditions.append("EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON pt.tag_id=t.id WHERE pt.post_id=p.id AND t.name=?)")
        params.append(tag)
    if optional:
        placeholders = ','.join('?' * len(optional))
        conditions.append(f"EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON pt.tag_id=t.id WHERE pt.post_id=p.id AND t.name IN ({placeholders}))")
        params.extend(optional)
    for tag in exclude:
        conditions.append("NOT EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON pt.tag_id=t.id WHERE pt.post_id=p.id AND t.name=?)")
        params.append(tag)
    if media_type:
        conditions.append("p.media_type = ?"); params.append(media_type)
    where = ' AND '.join(conditions)
    return db.execute(f"SELECT COUNT(*) as n FROM posts p WHERE {where}", params).fetchone()['n']

def get_post_with_tags(db, post_id):
    post = db.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
    if not post: return None
    post = dict(post)
    tags = db.execute("""
        SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id=t.id
        WHERE pt.post_id = ? ORDER BY t.name
    """, (post_id,)).fetchall()
    post['tags'] = [r['name'] for r in tags]
    return post

def get_random_posts(db, count=20, needed=None, optional=None, exclude=None, media_type=None):
    return search_posts(db, needed=needed, optional=optional, exclude=exclude,
                        media_type=media_type, limit=count, order='random')

# ── Tag helpers ───────────────────────────────────────────────────────────────

def get_all_tags_with_counts(db):
    rows = db.execute("""
        SELECT t.name, COUNT(pt.post_id) as count FROM tags t
        LEFT JOIN post_tags pt ON pt.tag_id=t.id GROUP BY t.id ORDER BY count DESC, t.name
    """).fetchall()
    return [dict(r) for r in rows]

def get_all_tag_groups(db):
    rows = db.execute("""
        SELECT group_name, GROUP_CONCAT(tag_name, '||') as members
        FROM tag_groups GROUP BY group_name ORDER BY group_name
    """).fetchall()
    return [{'group_name': r['group_name'], 'members': r['members'].split('||')} for r in rows]

def upsert_tag_group(db, group_name, tag_names):
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
    if raw is None: row_dict['search_tags'] = []; return
    if isinstance(raw, list): return
    try: row_dict['search_tags'] = json.loads(raw or '[]')
    except: row_dict['search_tags'] = []

def get_collections(db):
    rows = db.execute("""
        SELECT c.*, COUNT(cp.post_id) as post_count FROM collections c
        LEFT JOIN collection_posts cp ON cp.collection_id=c.id
        GROUP BY c.id ORDER BY c.updated_at DESC
    """).fetchall()
    out = []
    for r in rows:
        d = dict(r); _parse_collection_search_tags(d); out.append(d)
    return out

def get_collection(db, collection_id):
    col = db.execute("SELECT * FROM collections WHERE id = ?", (collection_id,)).fetchone()
    if not col: return None
    posts = db.execute("""
        SELECT p.* FROM posts p JOIN collection_posts cp ON cp.post_id=p.id
        WHERE cp.collection_id = ? ORDER BY cp.position
    """, (collection_id,)).fetchall()
    result = dict(col); _parse_collection_search_tags(result)
    result['posts'] = [dict(p) for p in posts]
    return result

def create_collection(db, name, post_ids=None, search_tags=None):
    tags_json = json.dumps(search_tags or [])
    cur = db.execute("INSERT INTO collections (name, search_tags) VALUES (?,?)", (name, tags_json))
    col_id = cur.lastrowid
    if post_ids:
        for i, pid in enumerate(post_ids):
            db.execute("INSERT INTO collection_posts (collection_id, post_id, position) VALUES (?,?,?)",
                       (col_id, pid, i))
    db.commit(); return col_id

def update_collection_posts(db, collection_id, post_ids):
    db.execute("DELETE FROM collection_posts WHERE collection_id = ?", (collection_id,))
    for i, pid in enumerate(post_ids):
        db.execute("INSERT INTO collection_posts (collection_id, post_id, position) VALUES (?,?,?)",
                   (collection_id, pid, i))
    db.execute("UPDATE collections SET updated_at=datetime('now') WHERE id=?", (collection_id,))
    db.commit()

def update_collection_meta(db, collection_id, name=None, search_tags=None):
    parts = []; params = []
    if name        is not None: parts.append("name = ?");        params.append(name)
    if search_tags is not None: parts.append("search_tags = ?"); params.append(json.dumps(search_tags))
    if not parts: return
    parts.append("updated_at = datetime('now')"); params.append(collection_id)
    db.execute(f"UPDATE collections SET {', '.join(parts)} WHERE id = ?", params)
    db.commit()

def append_post_to_collection(db, collection_id, post_id):
    row = db.execute("SELECT COALESCE(MAX(position), -1) AS m FROM collection_posts WHERE collection_id=?",
                     (collection_id,)).fetchone()
    pos = int(row['m']) + 1
    db.execute("INSERT OR IGNORE INTO collection_posts (collection_id, post_id, position) VALUES (?,?,?)",
               (collection_id, post_id, pos))
    db.execute("UPDATE collections SET updated_at=datetime('now') WHERE id=?", (collection_id,))
    db.commit()

def record_collection_review_ignored(db, collection_id, post_ids):
    for pid in post_ids:
        try:
            db.execute("INSERT INTO collection_review (collection_id, post_id) VALUES (?,?)",
                       (collection_id, int(pid)))
        except sqlite3.IntegrityError:
            pass
    db.commit()

def get_collection_review_queue(db, collection_id, limit=80):
    col = db.execute("SELECT search_tags FROM collections WHERE id = ?", (collection_id,)).fetchone()
    if not col: return []
    try: tags = json.loads(col['search_tags'] or '[]')
    except: tags = []
    if not tags: return []
    tags = expand_tags_with_groups(tags, db)
    in_col   = {r['post_id'] for r in db.execute("SELECT post_id FROM collection_posts WHERE collection_id=?", (collection_id,)).fetchall()}
    reviewed = {r['post_id'] for r in db.execute("SELECT post_id FROM collection_review WHERE collection_id=?", (collection_id,)).fetchall()}
    exclude_ids = in_col | reviewed
    candidates = search_posts(db, needed=[], optional=tags, exclude=None, limit=600, offset=0, order='newest')
    out = []
    for p in candidates:
        if p['id'] in exclude_ids: continue
        out.append(p)
        if len(out) >= limit: break
    return out

# ── Selections ────────────────────────────────────────────────────────────────

MAX_HISTORY = 10

def save_selection(db, post_ids, name=None, is_saved=False):
    cur    = db.execute("INSERT INTO selections (name, post_ids, is_saved) VALUES (?,?,?)",
                        (name, json.dumps(post_ids), 1 if is_saved else 0))
    sel_id = cur.lastrowid; db.commit()
    db.execute("""
        DELETE FROM selections WHERE is_saved=0 AND id NOT IN (
            SELECT id FROM selections WHERE is_saved=0 ORDER BY created_at DESC LIMIT ?
        )
    """, (MAX_HISTORY,)); db.commit()
    return sel_id

def get_selections(db, saved_only=False):
    rows = db.execute(
        "SELECT * FROM selections WHERE is_saved=1 ORDER BY updated_at DESC" if saved_only
        else "SELECT * FROM selections ORDER BY is_saved DESC, updated_at DESC"
    ).fetchall()
    result = []
    for r in rows:
        d = dict(r); d['post_ids'] = json.loads(d['post_ids']); d['post_count'] = len(d['post_ids'])
        result.append(d)
    return result

def get_selection(db, selection_id):
    row = db.execute("SELECT * FROM selections WHERE id = ?", (selection_id,)).fetchone()
    if not row: return None
    d = dict(row); d['post_ids'] = json.loads(d['post_ids'])
    return d

def promote_selection_to_collection(db, selection_id, name):
    sel = get_selection(db, selection_id)
    if not sel: return None
    col_id = create_collection(db, name, sel['post_ids'])
    db.execute("UPDATE selections SET is_saved=1, name=? WHERE id=?", (name, selection_id))
    db.commit(); return col_id

# ── Subscriptions ─────────────────────────────────────────────────────────────

def get_subscriptions(db):
    return [dict(r) for r in db.execute("SELECT * FROM subscriptions ORDER BY tag_name").fetchall()]

def add_subscription(db, tag_name):
    tag_name = tag_name.lower().replace(' ', '_')
    db.execute("INSERT OR IGNORE INTO subscriptions (tag_name) VALUES (?)", (tag_name,)); db.commit()

def remove_subscription(db, tag_name):
    db.execute("DELETE FROM subscriptions WHERE tag_name = ?", (tag_name,)); db.commit()

# ── Feed ──────────────────────────────────────────────────────────────────────

def get_feed_posts(db, status='unseen', limit=50, offset=0):
    rows = db.execute("""
        SELECT * FROM feed_posts WHERE status=? ORDER BY post_date DESC, id DESC LIMIT ? OFFSET ?
    """, (status, limit, offset)).fetchall()
    result = []
    for r in rows:
        d = dict(r); d['tags'] = json.loads(d['tags']); d['matched_subs'] = json.loads(d['matched_subs'])
        result.append(d)
    return result

def upsert_feed_post(db, rule34_post_id, file_url, preview_url, tags, matched_subs, post_date):
    existing = db.execute("SELECT id, status FROM feed_posts WHERE rule34_post_id=?", (rule34_post_id,)).fetchone()
    if existing:
        if existing['status'] != 'unseen': return
        db.execute("UPDATE feed_posts SET file_url=?,preview_url=?,tags=?,matched_subs=?,post_date=? WHERE rule34_post_id=?",
                   (file_url, preview_url, json.dumps(tags), json.dumps(matched_subs), post_date, rule34_post_id))
    else:
        db.execute("INSERT INTO feed_posts (rule34_post_id,file_url,preview_url,tags,matched_subs,post_date) VALUES (?,?,?,?,?,?)",
                   (rule34_post_id, file_url, preview_url, json.dumps(tags), json.dumps(matched_subs), post_date))
    db.commit()

def set_feed_post_status(db, rule34_post_id, status):
    db.execute("UPDATE feed_posts SET status=? WHERE rule34_post_id=?", (status, rule34_post_id))
    db.commit()