#!/usr/bin/env python3
"""
One-time migration: copy viewer/posts.db (SQLite) into Supabase PostgreSQL.

Prerequisites:
  1. Supabase project created
  2. viewer/.env filled with DATABASE_URL
  3. Empty cloud schema: python -c "from db import init_db; init_db()"  (from backend/)

For large databases, use the *direct* connection string (port 5432), not the
transaction pooler (port 6543). Project Settings → Database → Connection string → URI.

Usage (from viewer/backend):
  python ../scripts/migrate_sqlite_to_supabase.py
  python ../scripts/migrate_sqlite_to_supabase.py --sqlite ../posts.db
  python ../scripts/migrate_sqlite_to_supabase.py --skip-init   # tables already exist
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
import traceback
from pathlib import Path
from tqdm import tqdm

BACKEND = Path(__file__).resolve().parent.parent / 'backend'
sys.path.insert(0, str(BACKEND))

from psycopg2.extras import execute_values  # noqa: E402

from db import get_db, init_db  # noqa: E402

VIEWER = Path(__file__).resolve().parent.parent
DEFAULT_SQLITE = VIEWER / 'posts.db'
DEFAULT_BATCH_SIZE = 500
# tags has a unique index on name; keep batches smaller to avoid timeouts.
TABLE_BATCH_SIZE = {
    'tags': 200,
    'post_tags': 2000,
    'collection_review': 2000,
    'collection_posts': 2000,
}

# Copy order respects foreign keys
TABLES = [
    ('posts', [
        'id', 'rule34hub_id', 'rule34_api_id', 'file_url', 'cdn_url', 'thumb_cdn',
        'media_type', 'width', 'height', 'source', 'status', 'resolved_by', 'hub_url',
        'source_type', 'external_id', 'source_meta', 'media_category', 'created_at',
    ]),
    ('tags', ['id', 'name']),
    ('post_tags', ['post_id', 'tag_id']),
    ('tag_groups', ['id', 'group_name', 'tag_name']),
    ('collections', ['id', 'name', 'search_tags', 'created_at', 'updated_at']),
    ('collection_review', ['collection_id', 'post_id']),
    ('collection_posts', ['collection_id', 'post_id', 'position']),
    ('selections', ['id', 'name', 'post_ids', 'is_saved', 'created_at', 'updated_at']),
    ('subscriptions', ['id', 'tag_name', 'last_fetched_at', 'created_at']),
    ('feed_posts', [
        'id', 'rule34_post_id', 'file_url', 'preview_url', 'media_type', 'tags',
        'status', 'matched_subs', 'post_date', 'created_at',
    ]),
    ('source_subscriptions', [
        'id', 'source_kind', 'url', 'label', 'enabled', 'last_fetched_at', 'created_at',
    ]),
    ('ext_feed_posts', [
        'id', 'source_kind', 'source_key', 'source_url', 'file_url', 'preview_url',
        'media_type', 'media_category', 'title', 'tags', 'source_meta', 'status',
        'post_date', 'created_at',
    ]),
]

# Columns that may not exist in older SQLite backups
OPTIONAL_COLUMNS = {
    'posts': ['source_type', 'external_id', 'source_meta', 'media_category'],
    'collections': ['search_tags'],
    'feed_posts': ['media_type'],
    'subscriptions': ['last_fetched_at'],
}


def log(msg: str) -> None:
    print(msg, flush=True)


def sqlite_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f'PRAGMA table_info({table})').fetchall()}


def fetch_sqlite_rows(conn: sqlite3.Connection, table: str, columns: list[str]) -> list[dict]:
    existing = sqlite_columns(conn, table)
    if table not in {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}:
        return []
    use_cols = [c for c in columns if c in existing]
    if not use_cols:
        return []
    rows = conn.execute(f"SELECT {', '.join(use_cols)} FROM {table}").fetchall()
    out = []
    for row in rows:
        d = {use_cols[i]: row[i] for i in range(len(use_cols))}
        for opt in OPTIONAL_COLUMNS.get(table, []):
            if opt not in d:
                if opt in ('source_meta',):
                    d[opt] = '{}'
                elif opt in ('search_tags', 'tags', 'matched_subs'):
                    d[opt] = '[]'
                elif opt == 'source_type':
                    d[opt] = 'rule34'
                elif opt == 'media_category':
                    d[opt] = 'library'
                elif opt == 'media_type':
                    d[opt] = 'image'
                else:
                    d[opt] = None
        out.append(d)
    return out


CONFLICT_KEYS = {
    'posts': '(id)',
    'tags': '(id)',
    'post_tags': '(post_id, tag_id)',
    'tag_groups': '(id)',
    'collections': '(id)',
    'collection_review': '(collection_id, post_id)',
    'collection_posts': '(collection_id, post_id)',
    'selections': '(id)',
    'subscriptions': '(id)',
    'feed_posts': '(id)',
    'source_subscriptions': '(id)',
    'ext_feed_posts': '(id)',
}


def insert_rows(pg, table, columns, rows, batch_size=DEFAULT_BATCH_SIZE) -> int:
    if not rows:
        return 0

    present = [c for c in columns if c in rows[0]]
    col_sql = ', '.join(present)
    conflict = CONFLICT_KEYS.get(table, '(id)')

    insert_sql = f"""
        INSERT INTO {table} ({col_sql})
        VALUES %s
        ON CONFLICT {conflict} DO NOTHING
    """

    conn = pg._conn
    total = len(rows)

    log(f'  {table}: inserting {total} rows...')

    inserted = 0

    with tqdm(total=total, desc=table, unit="rows") as pbar:
        for start in range(0, total, batch_size):
            batch = rows[start:start + batch_size]
            vals = [tuple(row.get(c) for c in present) for row in batch]

            cur = conn.cursor()
            try:
                execute_values(cur, insert_sql, vals, page_size=len(vals))
                conn.commit()
            except Exception:
                conn.rollback()
                log(f'  {table}: FAILED at rows {start + 1}-{start + len(batch)}')
                raise
            finally:
                cur.close()

            inserted += len(batch)
            pbar.update(len(batch))

    return inserted


def configure_migration_session(pg) -> None:
    """Allow long bulk inserts; Supabase defaults can cancel large statements."""
    conn = pg._conn
    cur = conn.cursor()
    try:
        cur.execute("SET statement_timeout = 0")
        cur.execute("SET lock_timeout = 0")
        conn.commit()
    finally:
        cur.close()


def reset_sequences(pg) -> None:
    log('Resetting ID sequences...')
    for table in ('posts', 'tags', 'tag_groups', 'collections', 'selections',
                  'subscriptions', 'feed_posts', 'source_subscriptions', 'ext_feed_posts'):
        pg.execute(f"""
            SELECT setval(
                pg_get_serial_sequence('{table}', 'id'),
                COALESCE((SELECT MAX(id) FROM {table}), 1)
            )
        """)
    pg.commit()


def main():
    parser = argparse.ArgumentParser(description='Migrate SQLite posts.db to Supabase')
    parser.add_argument('--sqlite', type=Path, default=DEFAULT_SQLITE, help='Path to posts.db')
    parser.add_argument('--skip-init', action='store_true', help='Skip creating tables (already done)')
    parser.add_argument(
        '--batch-size',
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help='Default rows per commit batch (some tables override)',
    )
    args = parser.parse_args()

    default_batch_size = max(1, args.batch_size)

    if not args.sqlite.is_file():
        log(f'SQLite file not found: {args.sqlite}')
        sys.exit(1)

    if not args.skip_init:
        log('Creating Supabase tables (skip with --skip-init if already done)...')
        init_db(quiet=True)
    else:
        log('Skipping schema init (--skip-init).')

    log(f'Opening SQLite: {args.sqlite}')
    sqlite = sqlite3.connect(str(args.sqlite))
    sqlite.row_factory = sqlite3.Row

    log('Connecting to Supabase...')
    pg = get_db()
    configure_migration_session(pg)

    try:
        total = 0
        for table, columns in TABLES:
            log(f'Reading {table} from SQLite...')
            rows = fetch_sqlite_rows(sqlite, table, columns)
            if not rows:
                log(f'  {table}: 0 rows (skipped)')
                continue
            table_batch = TABLE_BATCH_SIZE.get(table, default_batch_size)
            n = insert_rows(pg, table, columns, rows, batch_size=table_batch)
            total += n
            log(f'  {table}: done ({n} rows)')
        reset_sequences(pg)
        log(f'Migration complete. {total} rows copied.')
    except Exception as exc:
        log(f'Migration failed: {exc}')
        traceback.print_exc()
        sys.exit(1)
    finally:
        sqlite.close()
        pg.close()


if __name__ == '__main__':
    main()
