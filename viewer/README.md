# Vault Viewer

Web app for browsing and organizing a Rule34-based media library. Posts, tags, collections, selections, and subscription feeds are stored in **Supabase (PostgreSQL)** so the same library is available from any device running the app.

Instagram, taste/prediction ML, and the Capacitor Android port were removed from this app. Use the sibling [`insta/`](../insta) project for Instagram.

## Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3, Flask, Supabase PostgreSQL |
| Frontend | React 18, Vite, React Router |
| Database | Supabase (cloud PostgreSQL) |

## Project layout

```
viewer/
├── backend/          Flask API (app.py, database.py, db.py, supabase_schema.sql)
├── frontend/         React UI
├── .env.example      Supabase connection template (copy to .env)
├── scripts/
│   ├── migrate_sqlite_to_supabase.py  One-time SQLite → Supabase migration
│   └── inspect_db.py
├── run.bat           Start backend + frontend on Windows
└── deploy.md         Render.com deployment notes
```

## Supabase setup (first time)

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. **New project** → pick a name, password, and region.
3. Wait for the database to finish provisioning.

### 2. Get your credentials

In the Supabase dashboard:

| Setting | Where to find it |
|---------|------------------|
| **DATABASE_URL** | Project Settings → **Database** → Connection string → **URI** (use Session pooler for the Flask app) |
| **SUPABASE_URL** | Project Settings → **API** → Project URL |
| **SUPABASE_ANON_KEY** | Project Settings → **API** → anon public |
| **SUPABASE_SERVICE_ROLE_KEY** | Project Settings → **API** → service_role (keep secret) |

### 3. Configure the app

```powershell
cd viewer
copy .env.example .env
```

Edit `viewer/.env` and paste your **DATABASE_URL** (and optional API keys). The password is the database password you set when creating the project.

Example URI format:

```
postgresql://postgres.xxxxx:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require
```

### 4. Install backend dependencies

```powershell
cd backend
pip install -r requirements.txt
```

### 5. Create tables in Supabase

Either run in **Supabase → SQL Editor** (paste contents of `backend/supabase_schema.sql`), or:

```powershell
cd backend
python -c "from db import init_db; init_db()"
```

### 6. Migrate existing local data (optional)

If you have an old `posts.db` from SQLite:

```powershell
cd backend
python ../scripts/migrate_sqlite_to_supabase.py
# or: python ../scripts/migrate_sqlite_to_supabase.py --sqlite path/to/posts.db
```

If tables are already created in Supabase, skip schema init:

```powershell
python ../scripts/migrate_sqlite_to_supabase.py --skip-init
```

**Tips for large libraries:** use the **direct** database URL (port `5432`) in `.env` for the migration, not the transaction pooler (`6543`). The script prints progress per table and per batch. If it fails, the error and row range are shown instead of hanging silently.

This copies all tables and resets ID sequences so new rows continue from the correct ID.

### 7. Run the app

**Backend**

```powershell
cd backend
python app.py
```

API at `http://localhost:5002`.

**Frontend** (separate terminal)

```powershell
cd frontend
npm install
npm run dev
```

UI at `http://localhost:5173` (proxies `/api` to the backend).

Or double-click `run.bat` from the `viewer` folder.

## Using on other devices

Every device runs the same backend + frontend, but all point at the **same Supabase database** via `DATABASE_URL` in `.env`:

1. Clone/copy the `viewer` folder to the other machine.
2. Copy your `viewer/.env` (or recreate it with the same Supabase credentials).
3. Install dependencies and run as above.

Collections, selections, subscriptions, and the library stay in sync because they live in Supabase, not on local disk.

## Features

- **Library** — Tag search (needed / optional / exclude), filters, post detail, R34 auto-match
- **Subscriptions** — Follow Rule34 tags, fetch new posts, triage feed (save / skip / later)
- **Random** — Random sample from the library with filters
- **Collections** — Named saved lists with optional review queues
- **Selection** — Working ordered list of post IDs (persisted on the server)
- **Viewer** — Full-screen image/video viewer with keyboard shortcuts
- **Tag groups** — Alias tags for search expansion
- **R34 Search** — Direct Rule34 API search

## Auth (LAN / remote)

Non-localhost clients need a cookie from:

`http://<host>:5002/auth?token=<SECRET_TOKEN>`

Token is set in `backend/app.py` (`SECRET_TOKEN`). Change it before exposing the server.

## Remote deploy

See [deploy.md](deploy.md) for Render.com setup. Set `DATABASE_URL` in the host environment to your Supabase connection string.

## Removed (intentionally)

- Local-only SQLite as primary store (replaced by Supabase)
- Instagram scraping, CDN proxy, `ig_subscriptions`
- Taste engine (CLIP embeddings, predictions, UMAP, generate-selection)
- Capacitor / Android / offline sql.js mobile build
