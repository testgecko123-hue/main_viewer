-- Posts: your saved collection
CREATE TABLE IF NOT EXISTS posts (
    id              INTEGER PRIMARY KEY,
    rule34hub_id    INTEGER UNIQUE,
    rule34_api_id   INTEGER,
    file_url        TEXT,
    cdn_url         TEXT,
    thumb_cdn       TEXT,
    media_type      TEXT DEFAULT 'image',
    width           INTEGER,
    height          INTEGER,
    source          TEXT,
    status          TEXT DEFAULT 'resolved',
    resolved_by     TEXT,
    hub_url         TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- All unique tag names
CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

-- Post <-> tag join
CREATE TABLE IF NOT EXISTS post_tags (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
);

-- Tag groups: group_name is the canonical display name
-- Each row is one member alias
CREATE TABLE IF NOT EXISTS tag_groups (
    id         INTEGER PRIMARY KEY,
    group_name TEXT NOT NULL,
    tag_name   TEXT NOT NULL UNIQUE   -- actual tag stored on posts
);
CREATE INDEX IF NOT EXISTS idx_tag_groups_name ON tag_groups(group_name);
CREATE INDEX IF NOT EXISTS idx_tag_groups_tag  ON tag_groups(tag_name);

-- Collections: named, stable, saved lists
CREATE TABLE IF NOT EXISTS collections (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    search_tags TEXT DEFAULT '[]',  -- JSON array of tag names (library search for review queue)
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Posts dismissed from a collection's review queue (never show again in that queue)
CREATE TABLE IF NOT EXISTS collection_review (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    post_id       INTEGER NOT NULL REFERENCES posts(id)       ON DELETE CASCADE,
    PRIMARY KEY (collection_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_collection_review_col ON collection_review(collection_id);

CREATE TABLE IF NOT EXISTS collection_posts (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    post_id       INTEGER NOT NULL REFERENCES posts(id)       ON DELETE CASCADE,
    position      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (collection_id, post_id)
);

-- Selections: working sessions (ordered list of post IDs stored as JSON)
CREATE TABLE IF NOT EXISTS selections (
    id           INTEGER PRIMARY KEY,
    name         TEXT,
    post_ids     TEXT NOT NULL DEFAULT '[]',   -- JSON array of post IDs in order
    is_saved     INTEGER NOT NULL DEFAULT 0,    -- 1 = saved as named selection
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
);

-- Subscriptions: tags you follow on rule34
CREATE TABLE IF NOT EXISTS subscriptions (
    id         INTEGER PRIMARY KEY,
    tag_name   TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Feed posts: rule34 posts seen in the subscription feed
CREATE TABLE IF NOT EXISTS feed_posts (
    id              INTEGER PRIMARY KEY,
    rule34_post_id  INTEGER UNIQUE NOT NULL,
    file_url        TEXT,
    preview_url     TEXT,
    media_type      TEXT DEFAULT 'image',  -- image | video | vr
    tags            TEXT DEFAULT '[]',   -- JSON array
    status          TEXT DEFAULT 'unseen',  -- unseen | saved | ignored | unsure
    matched_subs    TEXT DEFAULT '[]',   -- JSON array of matched subscription tags
    post_date       TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- External source subscriptions (Gofile folders, PH playlists, comic sites, etc.)
CREATE TABLE IF NOT EXISTS source_subscriptions (
    id              INTEGER PRIMARY KEY,
    source_kind     TEXT NOT NULL,
    url             TEXT NOT NULL UNIQUE,
    label           TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_fetched_at REAL,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- External feed: scraped items from non-Rule34 sources (distinct from feed_posts)
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
);
CREATE INDEX IF NOT EXISTS idx_ext_feed_status ON ext_feed_posts(status);
CREATE INDEX IF NOT EXISTS idx_source_subs_kind ON source_subscriptions(source_kind);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_posts_media_type  ON posts(media_type);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag     ON post_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_post    ON post_tags(post_id);
CREATE INDEX IF NOT EXISTS idx_feed_status       ON feed_posts(status);