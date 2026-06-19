"""
mega_handler.py
───────────────
Scrape MEGA.nz folder links, list their contents, and handle
temporary download + re-upload to the storage network (MEGA accounts
or Google Drive accounts), filling one account at a time.

Dependencies (add to requirements.txt):
    mega.py>=1.0.8
    google-api-python-client>=2.0
    google-auth-httplib2>=0.2
    google-auth-oauthlib>=1.0
    yt-dlp>=2024.1   (already present)
"""

import os
import re
import json
import time
import logging
import tempfile
import threading
from pathlib import Path
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# ── MEGA public-folder scraping (no auth needed) ───────────────────────────

MEGA_API = "https://g.api.mega.co.nz/cs"

def _mega_api_call(payload: list, n: str = None) -> list:
    params = {}
    if n:
        params["n"] = n
    resp = requests.post(MEGA_API, params=params, json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _parse_mega_key(key_b64: str) -> bytes:
    """Base64url → raw bytes, ignore errors."""
    import base64
    pad = "=" * (-len(key_b64) % 4)
    return base64.urlsafe_b64decode(key_b64 + pad)


def _infer_media_type(name: str) -> str:
    ext = Path(name).suffix.lower().lstrip(".")
    if ext in ("mp4", "webm", "mov", "m4v", "avi", "mkv"):
        return "video"
    if ext in ("jpg", "jpeg", "png", "gif", "webp", "bmp"):
        return "image"
    return "other"


def scrape_mega_folder(mega_url: str) -> list[dict]:
    """
    List all files in a public MEGA folder link, with real decrypted filenames.

    Tries in order:
      1. mega.py  — decrypts filenames properly using the key in the URL
      2. yt-dlp   — fallback, also handles decryption via subprocess

    Returns list of:
      { id, name, size, media_type, mega_url, source_url, thumbnail_url }
    """
    # Normalise old-style links (#F!handle!key) to new style (folder/handle#key)
    old = re.match(r"https?://mega\.nz/#F!([A-Za-z0-9_-]+)!([A-Za-z0-9_-]+)", mega_url)
    if old:
        mega_url = f"https://mega.nz/folder/{old.group(1)}#{old.group(2)}"

    m = re.search(r"mega\.nz/folder/([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)", mega_url)
    if not m:
        raise ValueError(
            "Could not parse MEGA folder URL. "
            "Expected format: https://mega.nz/folder/HANDLE#KEY"
        )

    folder_handle = m.group(1)

    # Method 1: mega.py
    try:
        return _scrape_via_megapy(mega_url, folder_handle)
    except ImportError:
        logger.warning("mega.py not installed, falling back to yt-dlp")
    except Exception as e:
        logger.warning("mega.py scrape failed (%s), falling back to yt-dlp", e)

    # Method 2: yt-dlp fallback
    return _scrape_via_ytdlp(mega_url, folder_handle)


def _scrape_via_megapy(mega_url: str, folder_handle: str) -> list[dict]:
    """Use mega.py to list folder contents with decrypted names."""
    from mega import Mega

    mg = Mega()
    folder_info = mg.get_public_files(mega_url)

    files = []
    for handle, info in folder_info.items():
        if info.get("t") != 0:
            continue
        attrs = info.get("a") or {}
        name  = attrs.get("n") or f"file_{handle}"
        size  = info.get("s", 0)
        file_url = f"https://mega.nz/folder/{folder_handle}/file/{handle}"
        files.append({
            "id":            handle,
            "name":          name,
            "size":          size,
            "media_type":    _infer_media_type(name),
            "mega_url":      file_url,
            "source_url":    mega_url,
            "thumbnail_url": None,
        })

    logger.info("mega.py listed %d files from %s", len(files), mega_url)
    return files


def _scrape_via_ytdlp(mega_url: str, folder_handle: str) -> list[dict]:
    """Use yt-dlp --flat-playlist to list folder contents."""
    import subprocess, json as _json

    result = subprocess.run(
        ["yt-dlp", "--flat-playlist", "--no-warnings", "-J", mega_url],
        capture_output=True, text=True, timeout=60,
    )

    if result.returncode != 0:
        raise RuntimeError(
            f"yt-dlp listing failed (rc={result.returncode}): {result.stderr[:400]}"
        )

    try:
        data = _json.loads(result.stdout)
    except Exception as e:
        raise RuntimeError(f"yt-dlp returned invalid JSON: {e}") from e

    entries = data.get("entries") or []
    files   = []

    for entry in entries:
        handle   = entry.get("id") or entry.get("url", "").split("/")[-1]
        name     = entry.get("title") or entry.get("filename") or f"file_{handle}"
        size     = entry.get("filesize") or entry.get("filesize_approx") or 0
        file_url = entry.get("url") or f"https://mega.nz/folder/{folder_handle}/file/{handle}"
        files.append({
            "id":            handle,
            "name":          name,
            "size":          size,
            "media_type":    _infer_media_type(name),
            "mega_url":      file_url,
            "source_url":    mega_url,
            "thumbnail_url": None,
        })

    logger.info("yt-dlp listed %d files from %s", len(files), mega_url)
    return files


# ── Storage-account registry ───────────────────────────────────────────────
# Loaded from environment or a JSON config file.
# Expected env vars (or .env):
#
# STORAGE_ACCOUNTS = JSON array, e.g.:
# [
#   {"kind":"mega","email":"a@b.com","password":"secret","quota_gb":50},
#   {"kind":"mega","email":"c@d.com","password":"secret","quota_gb":50},
#   {"kind":"gdrive","credentials_json":"/path/to/creds.json","token_json":"/path/to/token.json","quota_gb":15}
# ]
#
# Up to 5 MEGA accounts + 4 Google Drive accounts (one GDrive ignored if in use).

_accounts_lock = threading.Lock()
_accounts_cache: Optional[list] = None


def load_storage_accounts() -> list[dict]:
    global _accounts_cache
    with _accounts_lock:
        if _accounts_cache is not None:
            return _accounts_cache
        raw = os.environ.get("STORAGE_ACCOUNTS", "[]")
        accounts = json.loads(raw)
        _accounts_cache = accounts
        return accounts


def reload_storage_accounts():
    global _accounts_cache
    with _accounts_lock:
        _accounts_cache = None
    return load_storage_accounts()


# ── MEGA upload (uses mega.py library) ─────────────────────────────────────

def _mega_used_bytes(account: dict) -> int:
    """Return bytes already used on this MEGA account."""
    try:
        from mega import Mega
        m = Mega()
        mg = m.login(account["email"], account["password"])
        quota = mg.get_quota()          # returns dict with 'used'
        return int(quota.get("used", 0))
    except Exception as e:
        logger.warning("Could not get MEGA quota for %s: %s", account["email"], e)
        return 0


def _mega_free_bytes(account: dict) -> int:
    quota_bytes = int(account.get("quota_gb", 50)) * 1024 ** 3
    used = _mega_used_bytes(account)
    return max(0, quota_bytes - used)


def _upload_to_mega(account: dict, local_path: str, remote_name: str) -> str:
    """Upload file to MEGA, return share link."""
    from mega import Mega
    m = Mega()
    mg = m.login(account["email"], account["password"])
    uploaded = mg.upload(local_path, dest_filename=remote_name)
    link = mg.get_upload_link(uploaded)
    return link


# ── Google Drive upload ─────────────────────────────────────────────────────

def _gdrive_free_bytes(account: dict) -> int:
    try:
        service = _gdrive_service(account)
        about = service.about().get(fields="storageQuota").execute()
        sq = about["storageQuota"]
        limit = int(sq.get("limit", 0))
        usage = int(sq.get("usage", 0))
        return max(0, limit - usage)
    except Exception as e:
        logger.warning("Could not get GDrive quota: %s", e)
        return 0


def _gdrive_service(account: dict):
    """Return an authenticated Google Drive v3 service object."""
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    SCOPES = ["https://www.googleapis.com/auth/drive.file"]
    creds = None
    token_path = account.get("token_json", "gdrive_token.json")
    creds_path = account.get("credentials_json", "gdrive_credentials.json")

    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(creds_path, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(token_path, "w") as f:
            f.write(creds.to_json())

    return build("drive", "v3", credentials=creds)


def _upload_to_gdrive(account: dict, local_path: str, remote_name: str) -> str:
    """Upload file to Google Drive, return shareable link."""
    from googleapiclient.http import MediaFileUpload

    service = _gdrive_service(account)
    folder_id = account.get("folder_id")  # optional: upload into specific folder

    file_metadata = {"name": remote_name}
    if folder_id:
        file_metadata["parents"] = [folder_id]

    media = MediaFileUpload(local_path, resumable=True)
    uploaded = (
        service.files()
        .create(body=file_metadata, media_body=media, fields="id, webViewLink")
        .execute()
    )

    file_id = uploaded["id"]
    # Make it publicly readable
    service.permissions().create(
        fileId=file_id,
        body={"type": "anyone", "role": "reader"},
    ).execute()

    return uploaded.get("webViewLink", f"https://drive.google.com/file/d/{file_id}/view")


# ── Unified uploader ────────────────────────────────────────────────────────

def upload_to_storage_network(local_path: str, remote_name: str) -> dict:
    """
    Upload a file to the storage network, filling accounts in order.
    Returns { account_index, kind, share_url } or raises RuntimeError.
    """
    accounts = load_storage_accounts()
    file_size = os.path.getsize(local_path)

    for idx, account in enumerate(accounts):
        kind = account.get("kind", "mega")
        try:
            if kind == "mega":
                free = _mega_free_bytes(account)
            elif kind == "gdrive":
                free = _gdrive_free_bytes(account)
            else:
                logger.warning("Unknown account kind: %s", kind)
                continue

            if free < file_size:
                logger.info(
                    "Account #%d (%s %s) full — skipping (free=%dMB, need=%dMB)",
                    idx, kind, account.get("email", "?"),
                    free // 1024**2, file_size // 1024**2,
                )
                continue

            logger.info("Uploading %s (%dMB) to account #%d (%s)", remote_name, file_size // 1024**2, idx, kind)
            if kind == "mega":
                url = _upload_to_mega(account, local_path, remote_name)
            else:
                url = _upload_to_gdrive(account, local_path, remote_name)

            return {"account_index": idx, "kind": kind, "share_url": url}

        except Exception as e:
            logger.error("Upload to account #%d failed: %s", idx, e)
            continue

    raise RuntimeError("All storage accounts are full or unavailable.")


# ── Download + re-upload pipeline ──────────────────────────────────────────

def download_and_reupload(mega_file_url: str, filename: str) -> dict:
    """
    1. Download the MEGA file to a temp directory using yt-dlp.
    2. Upload to the storage network.
    3. Delete the temp file.
    Returns { share_url, account_index, kind, local_size_bytes }.
    """
    import subprocess

    with tempfile.TemporaryDirectory(prefix="mega_dl_") as tmpdir:
        out_path = os.path.join(tmpdir, filename)

        logger.info("Downloading %s via yt-dlp …", mega_file_url)
        result = subprocess.run(
            [
                "yt-dlp",
                "--no-playlist",
                "-o", out_path,
                mega_file_url,
            ],
            capture_output=True,
            text=True,
            timeout=600,
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"yt-dlp failed (rc={result.returncode}): {result.stderr[:500]}"
            )

        # yt-dlp may add an extension; find the actual file
        actual = None
        for f in Path(tmpdir).iterdir():
            if f.is_file():
                actual = str(f)
                break
        if not actual:
            raise RuntimeError("yt-dlp produced no output file")

        size = os.path.getsize(actual)
        logger.info("Downloaded %s → %dMB", filename, size // 1024**2)

        upload_result = upload_to_storage_network(actual, Path(actual).name)
        upload_result["local_size_bytes"] = size
        return upload_result


# ── List files in a storage account (for browsing) ─────────────────────────

def list_mega_account_files(account: dict) -> list[dict]:
    """List all files stored in a MEGA storage account."""
    try:
        from mega import Mega
        m = Mega()
        mg = m.login(account["email"], account["password"])
        files = mg.get_files()
        result = []
        for fh, fdata in files.items():
            if fdata.get("t") == 0:   # file
                result.append({
                    "handle": fh,
                    "name":   fdata.get("a", {}).get("n", fh),
                    "size":   fdata.get("s", 0),
                })
        return result
    except Exception as e:
        logger.error("list_mega_account_files: %s", e)
        return []


def list_gdrive_account_files(account: dict) -> list[dict]:
    """List files in a Google Drive storage account."""
    try:
        service = _gdrive_service(account)
        folder_id = account.get("folder_id")
        q = f"'{folder_id}' in parents and trashed=false" if folder_id else "trashed=false"
        items = []
        page_token = None
        while True:
            resp = service.files().list(
                q=q,
                spaces="drive",
                fields="nextPageToken, files(id, name, size, webViewLink)",
                pageToken=page_token,
            ).execute()
            items.extend(resp.get("files", []))
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
        return [{"id": f["id"], "name": f["name"], "size": int(f.get("size", 0)),
                 "url": f.get("webViewLink")} for f in items]
    except Exception as e:
        logger.error("list_gdrive_account_files: %s", e)
        return []
