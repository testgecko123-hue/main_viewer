"""
mega_account.py
────────────────
Talks to the user's OWN MEGA.nz account (not public folder scraping).

Two jobs:

  1. UPLOAD  — take local files (sent up from the browser's folder picker)
               and upload them into a folder on the user's MEGA drive.
  2. SERVE   — when the viewer wants to actually display/play one of those
               files, download + decrypt it from MEGA on demand and cache
               the plaintext on disk so repeat views/scrubbing are instant.

Why #2 is needed: MEGA encrypts everything client-side. A mega.nz/file/...
link cannot be used directly as an <img>/<video> src — there is no plaintext
URL for it. Since this is the user's own account we have full API access,
so we do the decrypt ourselves and hand the browser a normal-looking URL
(/api/mega/stream/<handle>/<filename>) backed by this cache.

Configure with environment variables:
    MEGA_EMAIL              your mega.nz account email
    MEGA_PASSWORD           your mega.nz account password
    MEGA_ROOT_FOLDER        (optional) top-level folder name to upload into.
                            Defaults to "ViewerUploads".
    MEGA_PUBLIC_BASE_URL    (optional) override for the base URL used when
                            building stream links, e.g. for a Render deploy
                            behind a proxy. Defaults to whatever host the
                            upload request came in on.

Note: we use the vendored copy in backend/vendor_mega/ rather than the
`mega.py` PyPI package directly. That package pins `tenacity<6.0.0`, an
ancient version that uses `asyncio.coroutine` — removed in Python 3.11 — so
`import mega` crashes outright on any modern Python. This is very likely why
the previous MEGA integration "didn't work". vendor_mega/ is the same library
with that one dependency swapped for a small built-in retry loop.
"""

import os
import re
import time
import shutil
import logging
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

MEGA_EMAIL       = os.environ.get("MEGA_EMAIL", "").strip()
MEGA_PASSWORD    = os.environ.get("MEGA_PASSWORD", "").strip()
MEGA_ROOT_FOLDER = (os.environ.get("MEGA_ROOT_FOLDER", "").strip() or "ViewerUploads")

CACHE_DIR = Path(__file__).parent / "mega_cache"
CACHE_DIR.mkdir(exist_ok=True)

_IMAGE_EXTS = {"jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "heic"}
_VIDEO_EXTS = {"mp4", "webm", "mov", "m4v", "avi", "mkv"}


def infer_media_type(filename: str) -> str:
    ext = Path(filename).suffix.lower().lstrip(".")
    if ext in _IMAGE_EXTS:
        return "image"
    if ext in _VIDEO_EXTS:
        return "video"
    return "other"


def configured() -> bool:
    return bool(MEGA_EMAIL and MEGA_PASSWORD)


# ── Singleton client — mega.py isn't thread-safe, so every call to it goes
#    through this one lock. Uploads/downloads end up serialized, which is
#    fine for a personal-use import tool. ──────────────────────────────────

_client_lock = threading.Lock()
_client = None
_client_logged_in_at = 0.0
_SESSION_TTL = 60 * 45  # re-login periodically in case the session goes stale


def _get_client():
    """Return a logged-in mega.py client, reusing the session when possible.
    Caller must hold _client_lock."""
    global _client, _client_logged_in_at

    if not configured():
        raise RuntimeError(
            "MEGA_EMAIL / MEGA_PASSWORD are not set. Add them to your backend "
            ".env (or Render env vars) to enable MEGA import."
        )

    if _client is not None and (time.time() - _client_logged_in_at) < _SESSION_TTL:
        return _client

    from vendor_mega import Mega
    mg = Mega().login(MEGA_EMAIL, MEGA_PASSWORD)
    _client = mg
    _client_logged_in_at = time.time()
    logger.info("Logged in to MEGA as %s", MEGA_EMAIL)
    return _client


def _reset_client():
    global _client
    _client = None


def get_account_status() -> dict:
    """Quota + connectivity info for the import UI."""
    if not configured():
        return {"configured": False, "connected": False}
    with _client_lock:
        try:
            mg = _get_client()
            space = mg.get_storage_space(giga=True)
            return {
                "configured": True,
                "connected": True,
                "email": MEGA_EMAIL,
                "used_gb": round(space.get("used", 0), 2),
                "total_gb": round(space.get("total", 0), 2),
                "root_folder": MEGA_ROOT_FOLDER,
            }
        except Exception as e:
            logger.exception("MEGA status check failed")
            _reset_client()
            return {
                "configured": True,
                "connected": False,
                "email": MEGA_EMAIL,
                "error": str(e),
            }


# ── Naming helpers ──────────────────────────────────────────────────────────

_UNSAFE_NAME_RE = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def _safe_name(name: str) -> str:
    name = _UNSAFE_NAME_RE.sub("_", str(name)).strip()
    return name or "untitled"


# ── Folder creation (find-or-create, nested-path safe) ──────────────────────
#
# mega.py's own create_folder() has a bug where it checks for an existing
# *nested* folder using only that segment's name searched from the account
# root, instead of the cumulative path — so re-running it against an
# already-existing "Root/Batch" path can create a duplicate "Batch" folder.
# find_path_descriptor() does handle full "a/b/c" paths correctly, so we use
# that directly and fall back to mega.py's private _mkdir() only for the
# segments that are actually missing.

_folder_cache_lock = threading.Lock()
_folder_cache: dict[str, tuple[str, float]] = {}
_FOLDER_CACHE_TTL = 600  # 10 minutes — avoids re-listing the whole drive per file


def _ensure_folder_path(mg, full_path: str) -> str:
    files = mg.get_files()
    parts = [p for p in full_path.split("/") if p]
    parent_id = mg._root_node_id()
    cumulative = ""
    for part in parts:
        cumulative = f"{cumulative}/{part}" if cumulative else part
        existing = mg.find_path_descriptor(cumulative, files=files)
        if existing:
            parent_id = existing
            continue
        created = mg._mkdir(name=part, parent_node_id=parent_id)
        parent_id = created["f"][0]["h"]
    return parent_id


def ensure_batch_folder(batch_name: str) -> str:
    """Find-or-create MEGA_ROOT_FOLDER/<batch_name>; return its node id."""
    full_path = f"{MEGA_ROOT_FOLDER}/{_safe_name(batch_name)}"

    now = time.time()
    with _folder_cache_lock:
        cached = _folder_cache.get(full_path)
        if cached and (now - cached[1]) < _FOLDER_CACHE_TTL:
            return cached[0]

    with _client_lock:
        mg = _get_client()
        node_id = _ensure_folder_path(mg, full_path)

    with _folder_cache_lock:
        _folder_cache[full_path] = (node_id, now)
    return node_id


def list_batch_folders() -> list[str]:
    """Names of existing folders directly under MEGA_ROOT_FOLDER (for autocomplete)."""
    with _client_lock:
        mg = _get_client()
        files = mg.get_files()
        root_node = mg.find_path_descriptor(MEGA_ROOT_FOLDER, files=files)
        if not root_node:
            return []
        names = [
            f["a"]["n"]
            for f in files.values()
            if f.get("t") == 1 and f.get("p") == root_node and f.get("a")
        ]
    return sorted(set(names))


# ── Upload ───────────────────────────────────────────────────────────────────

def upload_file(local_path: str, remote_filename: str, folder_node_id: str) -> dict:
    """Upload a local file into the given MEGA folder. Returns {handle, name, size}."""
    remote_filename = _safe_name(remote_filename)
    with _client_lock:
        mg = _get_client()
        result = mg.upload(local_path, dest=folder_node_id, dest_filename=remote_filename)
    handle = result["f"][0]["h"]
    return {
        "handle": handle,
        "name": remote_filename,
        "size": os.path.getsize(local_path),
    }


def seed_cache(handle: str, local_path: str, name_hint: str = "") -> None:
    """We already have the plaintext on disk right after uploading it — copy it
    straight into the cache so the first view doesn't need a MEGA round-trip."""
    ext = Path(name_hint).suffix.lower()
    dest = CACHE_DIR / f"{handle}{ext}"
    try:
        shutil.copy2(local_path, dest)
    except Exception:
        logger.exception("Could not seed MEGA cache for %s", handle)


# ── Fetch / stream ───────────────────────────────────────────────────────────

def get_cached_or_download(handle: str, name_hint: str = "") -> Path:
    """
    Local filesystem path to the decrypted file for this MEGA handle.
    Downloads + decrypts from MEGA on first access and caches afterwards.
    """
    ext = Path(name_hint).suffix.lower()
    cached = CACHE_DIR / f"{handle}{ext}"
    if cached.exists():
        return cached

    existing = list(CACHE_DIR.glob(f"{handle}.*"))
    if existing:
        return existing[0]

    with _client_lock:
        mg = _get_client()
        files = mg.get_files()
        if handle not in files:
            raise FileNotFoundError(f"MEGA file {handle} not found (deleted on MEGA?)")
        node = (handle, files[handle])
        downloaded = mg.download(
            node, dest_path=str(CACHE_DIR), dest_filename=f"{handle}{ext}"
        )
    return Path(downloaded)
