import os
import sqlite3

DB = os.path.join(os.path.dirname(__file__), '..', 'posts.db')

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row
c = db.cursor()
tables = c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
print('TABLES:')
for t in tables:
    print(' ', t[0])
print(f'Size: {os.path.getsize(DB)/1024/1024:.2f} MB')
for col in ('source_type', 'media_type'):
    rows = c.execute(f'SELECT {col}, COUNT(*) n FROM posts GROUP BY {col} ORDER BY n DESC').fetchall()
    print(f'{col} counts:', [dict(r) for r in rows])
db.close()
