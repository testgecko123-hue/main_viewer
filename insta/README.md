# InstaVault

Separate app for Instagram: scrape subscribed profiles with Playwright, download media locally, review new posts, and browse your saved library.

Rule34 and general library features live in [`viewer/`](../viewer).

## Stack

| Layer | Tech |
|-------|------|
| API | Node.js, Express, TypeScript (`src/server.ts`) |
| Scraper | Playwright (persistent browser profile) |
| Storage | JSON files under `data/` + files under `data/downloads/` |
| UI | React 19, TypeScript, Vite (`frontend/`) |

## Project layout

```
insta/
├── src/                 API + scraper
│   ├── server.ts        HTTP API entry
│   ├── scraper/         Profile scraping
│   ├── downloader/      Save media to disk
│   ├── storage/         posts.json
│   └── subscriptions/   subscriptions, review queue, rejected list
├── frontend/            React UI
├── data/
│   ├── posts.json
│   ├── subscriptions.json
│   ├── reviewQueue.json
│   ├── rejected.json
│   └── downloads/<username>/<shortcode>/...
├── userdata/            Playwright browser profile (login session)
├── start.bat            Start API + UI on Windows
└── .env                 Optional PORT override
```

## Quick start (Windows)

Double-click `start.bat`, or manually:

```powershell
# Terminal 1 — API (default port 3847)
npm install
npm run server

# Terminal 2 — UI (default port 5180)
cd frontend
npm install
npm run dev
```

Open `http://localhost:5180`.

Configure API URL in `frontend/.env` if needed (see `frontend/src/config.ts`).

## Typical workflow

1. **Log in** — Use the UI to open the manual Instagram browser window and sign in once. Session is kept in `userdata/`.
2. **Subscriptions** — Add Instagram usernames to follow.
3. **Scrape** — Run a scrape for one profile or all subscriptions. New posts land in the **review queue**.
4. **Review** — Accept posts into your library or reject them (rejected shortcodes are remembered).
5. **Library / Viewer** — Browse accepted posts; media is served from `/downloads/...`.

## API overview

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/posts` | Saved library |
| DELETE | `/posts/:shortcode` | Remove from library |
| GET | `/downloads/*` | Static media files |
| GET/POST | `/subscriptions` | List / add subscriptions |
| POST | `/subscriptions/scrape` | Scrape all subs |
| POST | `/scrape/start` | Scrape one username |
| GET | `/scrape/status` | Scraper progress |
| GET | `/review` | Pending review queue |
| POST | `/review/accept` | Save to library |
| POST | `/review/reject` | Reject and delete download |
| POST | `/browser/open` | Open Instagram login window |

## Data notes

- `data/` and `userdata/` are required; back them up before reinstalling.
- Downloads can be large; they are not in `posts.json`, only paths/metadata are.
- CLI one-off scrape: `npm start` runs `src/index.ts` (example profile hardcoded in that file).

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3847` | API port |

Set in `.env` at the `insta/` root.
