"""
fix_dupes.py — removes duplicate posts that share the same rule34_api_id
Keeps the row with the most tags attached, falls back to lowest id.
Run from viewer/backend/ or update DB_PATH below.
"""
import sqlite3
import os

DB_PATH = r'C:\Riot Games\VALORANT\binaries\H1736\viewer\posts.db'

db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row
db.execute("PRAGMA foreign_keys = ON")

# Find all api_id duplicates
dupes = db.execute('''
    SELECT rule34_api_id, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
    FROM posts
    WHERE rule34_api_id IS NOT NULL
    GROUP BY rule34_api_id
    HAVING cnt > 1
    ORDER BY cnt DESC
''').fetchall()

print(f'Found {len(dupes)} rule34_api_ids with duplicates')

total_removed = 0

for d in dupes:
    api_id = d['rule34_api_id']
    ids = [int(x) for x in d['ids'].split(',')]

    # Pick best: most tags > has file_url > lowest id
    placeholders = ','.join('?' * len(ids))
    posts = db.execute(f'''
        SELECT p.id, p.file_url, COUNT(pt.tag_id) as tag_count
        FROM posts p
        LEFT JOIN post_tags pt ON pt.post_id = p.id
        WHERE p.id IN ({placeholders})
        GROUP BY p.id
        ORDER BY
            (p.file_url IS NOT NULL AND p.file_url != '') DESC,
            tag_count DESC,
            p.id ASC
    ''', ids).fetchall()

    keep_id   = posts[0]['id']
    remove_ids = [p['id'] for p in posts[1:]]

    print(f'  api_id={api_id}: keeping db#{keep_id} '
          f'(tags={posts[0]["tag_count"]}, file={bool(posts[0]["file_url"])}), '
          f'removing {len(remove_ids)} dupes')

    for rid in remove_ids:
        db.execute("DELETE FROM posts WHERE id = ?", (rid,))

    total_removed += len(remove_ids)

db.commit()
print(f'\nDone. Removed {total_removed} duplicate posts.')

# Verify
remaining = db.execute('''
    SELECT COUNT(*) as n FROM (
        SELECT rule34_api_id FROM posts
        WHERE rule34_api_id IS NOT NULL
        GROUP BY rule34_api_id HAVING COUNT(*) > 1
    )
''').fetchone()['n']
print(f'Remaining duplicates: {remaining}')

total = db.execute('SELECT COUNT(*) as n FROM posts').fetchone()['n']
print(f'Total posts in DB: {total}')

db.close()