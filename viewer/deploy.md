# Deploying the backend to Render

The Android app and remote browsers talk to the **Flask API only**. The database stays on Supabase (`DATABASE_URL`).

## 1. Create the Render web service

**Option A — Blueprint**

1. Push this repo to GitHub.
2. In [Render](https://render.com): **New → Blueprint** and select the repo.
3. Render reads `render.yaml` and creates `vault-viewer-api`.

**Option B — Manual**

1. **New → Web Service**, connect the repo.
2. Settings:
   - **Root directory:** `backend`
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120 app:app`
   - **Health check path:** `/`

## 2. Environment variables (Render dashboard)

| Variable | Required | Example |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Supabase Session pooler URI (`?sslmode=require`) |
| `VIEWER_AUTH_TOKEN` | Yes | Long random secret (Render can auto-generate) |
| `CORS_ORIGINS` | Optional | Comma-separated extra origins, e.g. `capacitor://localhost,https://localhost` |

Copy the same `DATABASE_URL` you use locally from `viewer/.env`.

## 3. Point the frontend / Android app at Render

In `frontend/.env` (rebuild after changes):

```
VITE_API_URL=https://vault-viewer-api.onrender.com
VITE_AUTH_TOKEN=<same as VIEWER_AUTH_TOKEN on Render>
```

Then:

```powershell
npm run build:android
```

LAN testing (phone on same Wi‑Fi as your PC):

```
VITE_API_URL=http://192.168.x.x:5002
VITE_AUTH_TOKEN=Test123
```

Leave both empty for PC-only dev — Vite proxies `/api` to Flask and auth is skipped for localhost.

## 4. Auth methods

Remote clients must send the token. Any of these work:

- **Header (recommended for mobile):** `X-Viewer-Token: <token>` — the app does this automatically when `VITE_AUTH_TOKEN` is set.
- **Cookie:** visit `https://<api-host>/auth?token=<token>` once in a browser.
- **SSE:** `?viewer_token=<token>` on stream URLs (handled by `apiEventSource`).

Change `VIEWER_AUTH_TOKEN` / `VITE_AUTH_TOKEN` before exposing the API publicly.

## 5. Notes

- Free Render services **spin down** after inactivity; the first request may take ~30s.
- Use **one gunicorn worker** so SSE (`/api/subscriptions/fetch-stream`) is not split across processes.
- HTTPS on Render enables secure cross-site cookies if you rely on `/auth` instead of headers.
