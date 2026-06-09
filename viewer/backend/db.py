"""Supabase PostgreSQL connection for the viewer backend."""
import os
from pathlib import Path

import psycopg2
from psycopg2 import errors as pg_errors
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_ROOT / '.env')

DATABASE_URL = os.getenv('DATABASE_URL') or os.getenv('SUPABASE_DB_URL')
SCHEMA_PATH = Path(__file__).parent / 'supabase_schema.sql'

# Drop-in replacement for sqlite3.IntegrityError at call sites.
IntegrityError = pg_errors.UniqueViolation


class _Cursor:
    def __init__(self, cursor):
        self._cursor = cursor
        self.lastrowid = None

    def fetchone(self):
        try:
            row = self._cursor.fetchone()
            if row and 'id' in row and self.lastrowid is None:
                self.lastrowid = row['id']
            return row
        finally:
            self._cursor.close()

    def fetchall(self):
        try:
            return self._cursor.fetchall()
        finally:
            self._cursor.close()

    def close(self):
        try:
            self._cursor.close()
        except Exception:
            pass

    def __del__(self):
        try:
            self._cursor.close()
        except Exception:
            pass


class DbConnection:
    """Thin wrapper so existing code can keep using db.execute(...).fetchone()."""

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, params=None):
        if not sql or not sql.strip():
            print("Warning: empty SQL statement, skipping execution")
            return None
        
        cur = self._conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(sql, params or ())
        return _Cursor(cur)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()


def get_db():
    if not DATABASE_URL:
        raise RuntimeError(
            'DATABASE_URL is not set. Copy viewer/.env.example to viewer/.env '
            'and paste your Supabase connection string (Project Settings → Database).'
        )
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    # Transaction poolers (Supabase port 6543) reject server-side prepared statements.
    if hasattr(conn, 'prepare_threshold'):
        conn.prepare_threshold = None
    return DbConnection(conn)


def init_db(*, quiet: bool = False):
    if not DATABASE_URL:
        raise RuntimeError(
            'DATABASE_URL is not set. Copy viewer/.env.example to viewer/.env '
            'and paste your Supabase connection string.'
        )
    if not SCHEMA_PATH.is_file():
        raise FileNotFoundError(f'Schema not found: {SCHEMA_PATH}')

    db = get_db()  # uses your DbConnection wrapper
    try:
        with open(SCHEMA_PATH, encoding='utf-8') as f:
            raw = f.read()

        stmts = [s.strip() for s in raw.split(';') if s.strip()]
        for i, stmt in enumerate(stmts, 1):
            if not quiet:
                preview = stmt.split('\n', 1)[0][:80]
                print(f'  schema [{i}/{len(stmts)}]: {preview}...', flush=True)
            db.execute(stmt)

        db.commit()
        if not quiet:
            print(f'Schema ready ({len(stmts)} statements).', flush=True)
    finally:
        db.close()