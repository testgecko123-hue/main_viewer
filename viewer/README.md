# Vault Viewer

Local web app for browsing and organizing a Rule34-based media library. Posts, tags, collections, selections, and subscription feeds are stored in SQLite (`posts.db`).

Instagram, taste/prediction ML, and the Capacitor Android port were removed from this app. Use the sibling [`insta/`](../insta) project for Instagram.

## Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3, Flask, SQLite (`posts.db`) |
| Frontend | React 18, Vite, React Router |

## Project layout

```
viewer/
├── backend/          Flask API (app.py, database.py, schema.sql)
├── frontend/         React UI
├── posts.db          Main library database
├── scripts/
│   ├── cleanup_db.py   One-time DB cleanup (already run)
│   ├── patch_app.py    Dev helper used during cleanup
│   └── vault_push.py / vault_pull.py  Remote sync (see deploy.md)
├── run.bat           Start backend + frontend on Windows
└── deploy.md         Render.com deployment notes
```

## Quick start (Windows)

1. **Backend**

   ```powershell
   cd backend
   .\setup.ps1
   python app.py
   ```

   API runs at `http://localhost:5002`.

2. **Frontend** (separate terminal)

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

   UI at `http://localhost:3000` (proxies `/api` to the backend).

Or double-click `run.bat` from the `viewer` folder.

## Features

- **Library** — Tag search (needed / optional / exclude), filters, post detail, R34 auto-match
- **Subscriptions** — Follow Rule34 tags, fetch new posts, triage feed (save / skip / later)
- **Random** — Random sample from the library with filters
- **Collections** — Named saved lists with optional review queues
- **Selection** — Working ordered list of post IDs (persisted on the server)
- **Viewer** — Full-screen image/video viewer with keyboard shortcuts
- **Tag groups** — Alias tags for search expansion
- **R34 Search** — Direct Rule34 API search

## Database

- Path: `viewer/posts.db`
- Schema: `backend/schema.sql` plus additive migrations in `database.py`
- Re-run cleanup after restoring an old backup:

  ```powershell
  python scripts/cleanup_db.py
  ```

## Auth (LAN / remote)

Non-localhost clients need a cookie from:

`http://<host>:5002/auth?token=<SECRET_TOKEN>`

Token is set in `backend/app.py` (`SECRET_TOKEN`). Change it before exposing the server.

## Remote deploy

See [deploy.md](deploy.md) for Render.com setup and `vault_push.py` / `vault_pull.py`.

## Removed (intentionally)

- Instagram scraping, CDN proxy, `ig_subscriptions`, `ext_feed_posts`
- Taste engine (CLIP embeddings, predictions, UMAP, generate-selection)
- Capacitor / Android / offline sql.js mobile build
- Duplicate files: `app_new.py`, `backend/frontend/`, `posts copy.db`, `setup_instagram.md`
