/**
 * MegaSubscriptions.jsx
 * ─────────────────────
 * Panel that manages MEGA.nz folder subscriptions, displays their scraped
 * file feed, lets the user pick items, and triggers download→re-upload to
 * the storage network.
 *
 * UX:
 *  - Left-click a card  → open detail drawer (info + preview + link)
 *  - Middle-click a card → toggle selection for batch upload
 *  - Checkbox in corner  → also toggles selection
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../utils/api.js'
import { parseSourceMeta } from '../utils/mediaUtils.js'

// ── helpers ──────────────────────────────────────────────────────────────

function fmtBytes(b) {
  if (!b || b < 0) return '?'
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

function getExt(filename) {
  if (!filename) return ''
  const m = filename.match(/\.([a-zA-Z0-9]+)$/)
  return m ? m[1].toLowerCase() : ''
}

// Given a post, find the best URL we can actually use for previewing
function getBestPreviewUrl(post) {
  const meta = parseSourceMeta(post)
  return (
    post.preview_url ||
    meta.thumbnail_url ||
    meta.preview_url ||
    null
  )
}

function getBestFileUrl(post) {
  const meta = parseSourceMeta(post)
  return (
    post.file_url ||
    meta.source_url ||
    meta.mega_url ||
    post.source_url ||
    null
  )
}

// ── PostDetailDrawer ──────────────────────────────────────────────────────

function PostDetailDrawer({ post, selected, onToggleSelect, onClose, onStatusChange }) {
  const meta       = parseSourceMeta(post)
  const isVideo    = post.media_type === 'video'
  const isImage    = post.media_type === 'image'
  const previewUrl = getBestPreviewUrl(post)
  const fileUrl    = getBestFileUrl(post)
  const size       = meta.size || 0
  const ext        = getExt(post.title || post.source_key || '')
  const [imgFailed, setImgFailed] = useState(false)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const typeColor = isVideo ? '#d9534f' : isImage ? '#4a90d9' : '#888'
  const typeLabel = isVideo ? '▶ VIDEO' : isImage ? '🖼 PHOTO' : '📄 FILE'

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 900,
          background: 'rgba(0,0,0,0.5)',
        }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(460px, 95vw)',
        zIndex: 901,
        background: 'var(--surface-0, #141414)',
        borderLeft: '1px solid #2a2a2a',
        display: 'flex', flexDirection: 'column',
        overflowY: 'auto',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.6)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 16px', borderBottom: '1px solid #222',
          position: 'sticky', top: 0, background: 'var(--surface-0, #141414)', zIndex: 1,
        }}>
          <span style={{
            background: typeColor, color: '#fff',
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
          }}>{typeLabel}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #eee)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {post.title || post.source_key || `Post #${post.id}`}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#888',
            fontSize: 20, cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
            lineHeight: 1,
          }}>✕</button>
        </div>

        {/* Preview area */}
        <div style={{
          background: '#0a0a0a',
          minHeight: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          {isVideo && fileUrl ? (
            <video
              src={fileUrl}
              controls
              style={{ maxWidth: '100%', maxHeight: 340, display: 'block' }}
            />
          ) : isVideo ? (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>🎬</div>
              <div style={{ fontSize: 12, color: '#666' }}>
                Video not yet downloaded.<br />Select and store to get the file.
              </div>
            </div>
          ) : isImage && previewUrl && !imgFailed ? (
            <img
              src={previewUrl}
              alt={post.title || ''}
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain', display: 'block' }}
            />
          ) : isImage && fileUrl && !imgFailed ? (
            <img
              src={fileUrl}
              alt={post.title || ''}
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>
                {isImage ? '🖼️' : isVideo ? '🎬' : '📄'}
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>
                {imgFailed
                  ? 'Preview unavailable (file may require MEGA authentication)'
                  : 'No preview available'}
              </div>
            </div>
          )}
        </div>

        {/* Info rows */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* File link */}
          {fileUrl && (
            <InfoRow label="File link">
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#4a90d9', fontSize: 12, wordBreak: 'break-all' }}
              >
                {fileUrl.length > 60 ? fileUrl.slice(0, 60) + '…' : fileUrl}
              </a>
            </InfoRow>
          )}

          {/* MEGA folder URL */}
          {meta.mega_url && meta.mega_url !== fileUrl && (
            <InfoRow label="MEGA folder">
              <a
                href={meta.mega_url}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#d9534f', fontSize: 12, wordBreak: 'break-all' }}
              >
                {meta.mega_url.length > 60 ? meta.mega_url.slice(0, 60) + '…' : meta.mega_url}
              </a>
            </InfoRow>
          )}

          {/* File details */}
          <InfoRow label="File type">
            <span style={{ color: '#ccc', fontSize: 12 }}>
              {ext ? ext.toUpperCase() : '—'}{' '}
              <span style={{ color: '#666' }}>({post.media_type || 'unknown'})</span>
            </span>
          </InfoRow>

          {size > 0 && (
            <InfoRow label="File size">
              <span style={{ color: '#ccc', fontSize: 12 }}>{fmtBytes(size)}</span>
            </InfoRow>
          )}

          {post.sub_label && (
            <InfoRow label="Subscription">
              <span style={{ color: '#4a90d9', fontSize: 12 }}>{post.sub_label}</span>
            </InfoRow>
          )}

          {post.post_date && (
            <InfoRow label="Date">
              <span style={{ color: '#ccc', fontSize: 12 }}>
                {new Date(post.post_date).toLocaleString()}
              </span>
            </InfoRow>
          )}

          <InfoRow label="Status">
            <span style={{
              fontSize: 12, fontWeight: 600,
              color: post.status === 'saved' ? '#3a7d44' : post.status === 'ignored' ? '#666' : '#ccc',
            }}>
              {post.status}
            </span>
          </InfoRow>

          {post.source_key && (
            <InfoRow label="Source key">
              <span style={{ color: '#555', fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {post.source_key}
              </span>
            </InfoRow>
          )}

          {/* Tags */}
          {post.tags?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 5 }}>Tags</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {post.tags.map(tag => (
                  <span key={tag} style={{
                    fontSize: 10, padding: '2px 6px', borderRadius: 3,
                    background: '#222', color: '#aaa',
                  }}>{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Raw meta (collapsed) */}
          {Object.keys(meta).length > 0 && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ fontSize: 11, color: '#555', cursor: 'pointer' }}>Raw metadata</summary>
              <pre style={{
                fontSize: 10, color: '#555', marginTop: 6,
                background: '#0d0d0d', padding: 8, borderRadius: 6,
                overflow: 'auto', maxHeight: 200,
              }}>
                {JSON.stringify(meta, null, 2)}
              </pre>
            </details>
          )}
        </div>

        {/* Action footer */}
        <div style={{
          marginTop: 'auto',
          padding: '12px 16px',
          borderTop: '1px solid #222',
          display: 'flex', gap: 8, flexWrap: 'wrap',
          background: 'var(--surface-0, #141414)',
          position: 'sticky', bottom: 0,
        }}>
          <button
            onClick={() => onToggleSelect(post.id)}
            style={btnStyle(selected ? '#4a90d9' : '#2a2a2a', { flex: 1, border: '1px solid #444' })}
          >
            {selected ? '✓ Selected for upload' : '+ Add to upload queue'}
          </button>
          {['saved', 'ignored', 'unseen'].filter(s => s !== post.status).map(s => (
            <button
              key={s}
              onClick={() => onStatusChange(post.id, s)}
              style={btnStyle(
                s === 'saved' ? '#3a7d44' : s === 'ignored' ? '#444' : '#333',
                { fontSize: 11, padding: '6px 10px' }
              )}
            >
              Mark {s}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

function InfoRow({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 11, color: '#555', width: 90, flexShrink: 0, paddingTop: 1 }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

// ── StorageBar ───────────────────────────────────────────────────────────

function StorageBar({ accounts }) {
  if (!accounts || accounts.length === 0) return null
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-primary, #eee)', fontSize: 13 }}>
        Storage Network
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {accounts.map((acc) => {
          const usedPct = acc.quota_gb > 0
            ? Math.min(100, (acc.used_bytes / (acc.quota_gb * 1024 ** 3)) * 100)
            : 0
          const isFull = usedPct >= 99
          return (
            <div key={acc.index} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>
                {acc.kind === 'mega' ? '🔴' : '🟢'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary, #aaa)', width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {acc.email}
              </span>
              <div style={{ flex: 1, height: 8, background: 'var(--surface-2, #333)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${usedPct}%`,
                  background: isFull ? '#e05050' : acc.kind === 'mega' ? '#d9534f' : '#4a90d9',
                  borderRadius: 4, transition: 'width 0.4s',
                }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-secondary, #aaa)', whiteSpace: 'nowrap', width: 80, textAlign: 'right' }}>
                {fmtBytes(acc.free_bytes)} free
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── AddSubForm ───────────────────────────────────────────────────────────

function AddSubForm({ onAdded }) {
  const [url, setUrl]     = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!url.trim()) return
    setBusy(true); setErr(null)
    try {
      const res = await apiFetch('/api/mega/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), label: label.trim() || null }),
      })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error || res.statusText) }
      const sub = await res.json()
      setUrl(''); setLabel('')
      onAdded(sub)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      <input
        placeholder="https://mega.nz/folder/…"
        value={url}
        onChange={e => setUrl(e.target.value)}
        style={inputStyle}
        disabled={busy}
      />
      <input
        placeholder="Label (optional)"
        value={label}
        onChange={e => setLabel(e.target.value)}
        style={{ ...inputStyle, width: 140 }}
        disabled={busy}
      />
      <button type="submit" disabled={busy || !url.trim()} style={btnStyle('#4a90d9')}>
        {busy ? '…' : '+ Add'}
      </button>
      {err && <span style={{ color: '#e06060', fontSize: 12, alignSelf: 'center' }}>{err}</span>}
    </form>
  )
}

// ── SubscriptionRow ──────────────────────────────────────────────────────

function SubscriptionRow({ sub, onDelete, onFetch, fetching }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
      background: 'var(--surface-1, #1e1e1e)', borderRadius: 8, marginBottom: 6,
    }}>
      <span style={{ fontSize: 16 }}>🔴</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-primary, #eee)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sub.label || 'Untitled folder'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary, #888)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sub.url}
        </div>
        {sub.last_fetched_at && (
          <div style={{ fontSize: 10, color: 'var(--text-tertiary, #666)', marginTop: 2 }}>
            Last fetched: {new Date(sub.last_fetched_at * 1000).toLocaleString()}
          </div>
        )}
      </div>
      <button onClick={() => onFetch(sub)} disabled={fetching} style={btnStyle('#3a7d44', { padding: '4px 10px', fontSize: 11 })}>
        {fetching ? '⟳' : 'Refresh'}
      </button>
      <button onClick={() => onDelete(sub)} style={btnStyle('#8b2a2a', { padding: '4px 10px', fontSize: 11 })}>
        ✕
      </button>
    </div>
  )
}

// ── FeedPostCard ──────────────────────────────────────────────────────────

function FeedPostCard({ post, selected, onLeftClick, onMiddleClick, uploading }) {
  const isVideo    = post.media_type === 'video'
  const isImage    = post.media_type === 'image'
  const size       = parseSourceMeta(post)?.size || 0
  const ext        = getExt(post.title || post.source_key || '')
  const [hovered, setHovered] = useState(false)

  const typeBadgeBg = isVideo ? '#d9534f' : isImage ? '#4a90d9' : '#555'
  const typeLabel   = isVideo ? '▶ VIDEO' : isImage ? '🖼 PHOTO' : '📄 FILE'

  const statusBadge = post.status !== 'unseen' ? post.status : null
  const statusColor = { saved: '#3a7d44', ignored: '#555', unsure: '#7d6a2a' }[post.status]

  function handleMouseDown(e) {
    // Middle click = toggle select
    if (e.button === 1) {
      e.preventDefault()
      if (!uploading) onMiddleClick(post.id)
    }
  }

  function handleClick(e) {
    if (uploading) return
    onLeftClick(post)
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      style={{
        position: 'relative',
        borderRadius: 10,
        overflow: 'hidden',
        cursor: uploading ? 'default' : 'pointer',
        border: selected
          ? '2px solid #4a90d9'
          : hovered ? '2px solid #444' : '2px solid transparent',
        background: 'var(--surface-1, #1a1a1a)',
        transition: 'border-color 0.12s',
        aspectRatio: '4/3',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: 10,
        userSelect: 'none',
      }}
    >
      {/* Type icon */}
      <div style={{ fontSize: 32 }}>
        {isVideo ? '🎬' : isImage ? '🖼️' : '📄'}
      </div>

      {/* Filename */}
      <div style={{
        fontSize: 10, color: 'var(--text-primary, #ddd)',
        overflow: 'hidden', textOverflow: 'ellipsis',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        lineHeight: 1.35, textAlign: 'center', maxWidth: '100%',
      }}>
        {post.title || post.source_key || `file_${post.id}`}
      </div>

      {/* Ext + size */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {ext && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
            background: typeBadgeBg, color: '#fff',
          }}>{ext.toUpperCase()}</span>
        )}
        {size > 0 && (
          <span style={{ fontSize: 9, color: '#666' }}>{fmtBytes(size)}</span>
        )}
      </div>

      {/* Type badge (top-left) */}
      <div style={{
        position: 'absolute', top: 6, left: 6,
        background: typeBadgeBg,
        borderRadius: 4, fontSize: 9, padding: '2px 5px',
        color: '#fff', fontWeight: 700,
      }}>
        {typeLabel}
      </div>

      {/* Status badge */}
      {statusBadge && (
        <div style={{
          position: 'absolute', top: 6, right: selected ? 32 : 6,
          background: statusColor, borderRadius: 4,
          fontSize: 9, padding: '2px 5px', color: '#fff', fontWeight: 700,
        }}>
          {statusBadge.toUpperCase()}
        </div>
      )}

      {/* Selected checkmark */}
      {selected && (
        <div style={{
          position: 'absolute', top: 6, right: 6,
          width: 20, height: 20, borderRadius: '50%',
          background: '#4a90d9', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, color: '#fff', fontWeight: 700,
        }}>✓</div>
      )}

      {/* Middle-click hint on hover */}
      {hovered && !selected && (
        <div style={{
          position: 'absolute', bottom: 5, right: 6,
          fontSize: 8, color: '#444',
        }}>
          mid-click to select
        </div>
      )}

      {/* Sub label */}
      {post.sub_label && (
        <div style={{
          position: 'absolute', bottom: 4, left: 6,
          fontSize: 9, color: '#4a90d9',
        }}>
          {post.sub_label}
        </div>
      )}
    </div>
  )
}

// ── UploadProgress ───────────────────────────────────────────────────────

function UploadProgress({ events }) {
  if (events.length === 0) return null
  return (
    <div style={{
      background: 'var(--surface-1, #1e1e1e)', borderRadius: 10,
      padding: '12px 16px', marginBottom: 14,
    }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--text-primary, #eee)' }}>
        Upload Progress
      </div>
      {events.map((ev) => (
        <div key={ev.post_id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 14 }}>
            {ev.status === 'done' ? '✅' : ev.status === 'error' ? '❌' : '⏳'}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--text-primary, #ddd)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ev.filename || `post #${ev.post_id}`}
            </div>
            {ev.status === 'done' && (
              <div style={{ fontSize: 10, color: '#4a90d9' }}>
                → {ev.kind} #{ev.account} · <a href={ev.share_url} target="_blank" rel="noreferrer" style={{ color: '#4a90d9' }}>view</a>
              </div>
            )}
            {ev.status === 'error' && <div style={{ fontSize: 10, color: '#e06060' }}>{ev.error}</div>}
            {ev.status === 'downloading' && <div style={{ fontSize: 10, color: '#888' }}>downloading…</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export default function MegaSubscriptions() {
  const [subs, setSubs]             = useState([])
  const [fetchingId, setFetchingId] = useState(null)
  const [accounts, setAccounts]     = useState([])
  const [posts, setPosts]           = useState([])
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [selected, setSelected]     = useState(new Set())
  const [uploading, setUploading]   = useState(false)
  const [uploadEvents, setUploadEvents] = useState([])
  const [statusFilter, setStatusFilter] = useState('unseen')
  const [offset, setOffset]         = useState(0)
  const [total, setTotal]           = useState(0)
  const [detailPost, setDetailPost] = useState(null)
  const LIMIT = 50

  useEffect(() => {
    apiFetch('/api/mega/subscriptions').then(r => r.json()).then(setSubs).catch(() => {})
    apiFetch('/api/storage/accounts').then(r => r.json()).then(setAccounts).catch(() => {})
  }, [])

  const loadPosts = useCallback(async (off = 0, filter = statusFilter) => {
    setLoadingPosts(true)
    try {
      const res = await apiFetch(`/api/mega/feed?status=${filter}&limit=${LIMIT}&offset=${off}`)
      const data = await res.json()
      setPosts(data.posts || [])
      setTotal(data.total || 0)
      setOffset(off)
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingPosts(false)
    }
  }, [statusFilter])

  useEffect(() => { loadPosts(0, statusFilter) }, [subs, statusFilter])

  function handleSubAdded(sub) {
    setSubs(prev => [sub, ...prev.filter(s => s.id !== sub.id)])
  }

  async function handleDelete(sub) {
    if (!confirm(`Remove MEGA subscription "${sub.label || sub.url}"?`)) return
    await apiFetch(`/api/mega/subscriptions/${sub.id}`, { method: 'DELETE' })
    setSubs(prev => prev.filter(s => s.id !== sub.id))
  }

  async function handleFetch(sub) {
    setFetchingId(sub.id)
    try {
      const res = await apiFetch(`/api/mega/subscriptions/${sub.id}/fetch`, { method: 'POST' })
      const data = await res.json()
      if (data.error) { alert(`Fetch error: ${data.error}`); return }
      setSubs(prev => prev.map(s => s.id === sub.id ? { ...s, last_fetched_at: Date.now() / 1000 } : s))
      loadPosts(0)
    } catch (e) {
      alert(`Error: ${e.message}`)
    } finally {
      setFetchingId(null)
    }
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  async function handleStoreSelected() {
    if (selected.size === 0) return
    if (!confirm(`Download and store ${selected.size} file(s) to storage network?`)) return
    setUploading(true)
    setUploadEvents([])
    const postIds = [...selected]
    setSelected(new Set())

    try {
      const res = await fetch('/api/mega/download-and-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_ids: postIds }),
      })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const ev = JSON.parse(line)
            setUploadEvents(prev => {
              const idx = prev.findIndex(e => e.post_id === ev.post_id)
              if (idx >= 0) { const n = [...prev]; n[idx] = ev; return n }
              return [...prev, ev]
            })
          } catch {}
        }
      }
      apiFetch('/api/storage/accounts').then(r => r.json()).then(setAccounts).catch(() => {})
      loadPosts(offset)
    } catch (e) {
      alert(`Upload error: ${e.message}`)
    } finally {
      setUploading(false)
    }
  }

  async function handleStatusChange(postId, status) {
    await apiFetch(`/api/mega/feed/${postId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    // Update in-place so the drawer reflects the new status immediately
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, status } : p))
    if (detailPost?.id === postId) setDetailPost(prev => ({ ...prev, status }))
  }

  const videoCount = posts.filter(p => p.media_type === 'video').length
  const imageCount = posts.filter(p => p.media_type === 'image').length

  return (
    <div style={{ padding: '16px 0' }}>

      {/* Detail drawer */}
      {detailPost && (
        <PostDetailDrawer
          post={detailPost}
          selected={selected.has(detailPost.id)}
          onToggleSelect={toggleSelect}
          onClose={() => setDetailPost(null)}
          onStatusChange={handleStatusChange}
        />
      )}

      <StorageBar accounts={accounts} />

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--text-primary, #eee)' }}>
          MEGA Subscriptions
        </div>
        <AddSubForm onAdded={handleSubAdded} />
      </div>

      {subs.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {subs.map(sub => (
            <SubscriptionRow
              key={sub.id}
              sub={sub}
              onDelete={handleDelete}
              onFetch={handleFetch}
              fetching={fetchingId === sub.id}
            />
          ))}
        </div>
      )}

      <UploadProgress events={uploadEvents} />

      {/* Feed header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary, #eee)' }}>
          MEGA Feed
        </div>
        {['unseen', 'saved', 'ignored', 'all'].map(f => (
          <button
            key={f}
            onClick={() => { setStatusFilter(f); loadPosts(0, f) }}
            style={{
              ...btnStyle(statusFilter === f ? '#4a90d9' : '#333', { padding: '4px 10px', fontSize: 11 }),
              ...(statusFilter === f ? {} : { border: '1px solid #444' }),
            }}
          >
            {f}
          </button>
        ))}

        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 6 }}>
          {total} post{total !== 1 ? 's' : ''}
          {videoCount > 0 && <span style={{ color: '#d9534f', fontWeight: 600 }}>▶ {videoCount}</span>}
          {imageCount > 0 && <span style={{ color: '#4a90d9', fontWeight: 600 }}>🖼 {imageCount}</span>}
        </span>

        {selected.size > 0 && (
          <button
            onClick={handleStoreSelected}
            disabled={uploading}
            style={btnStyle('#3a7d44')}
          >
            ⬆ Store {selected.size} selected
          </button>
        )}
      </div>

      {/* Usage hint */}
      <div style={{ fontSize: 11, color: '#444', marginBottom: 10 }}>
        Click a card to view details · Middle-click to select for upload
      </div>

      {/* Grid */}
      {loadingPosts ? (
        <div style={{ textAlign: 'center', color: '#888', padding: 40 }}>Loading…</div>
      ) : posts.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#666', padding: 40 }}>
          No posts yet — add a MEGA folder and click Refresh.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))',
          gap: 10,
        }}>
          {posts.map(post => (
            <FeedPostCard
              key={post.id}
              post={post}
              selected={selected.has(post.id)}
              onLeftClick={setDetailPost}
              onMiddleClick={toggleSelect}
              uploading={uploading}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > LIMIT && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 20 }}>
          <button
            onClick={() => loadPosts(Math.max(0, offset - LIMIT))}
            disabled={offset === 0}
            style={btnStyle('#333', { padding: '6px 16px' })}
          >← Prev</button>
          <span style={{ color: '#888', fontSize: 12, alignSelf: 'center' }}>
            {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
          </span>
          <button
            onClick={() => loadPosts(offset + LIMIT)}
            disabled={offset + LIMIT >= total}
            style={btnStyle('#333', { padding: '6px 16px' })}
          >Next →</button>
        </div>
      )}
    </div>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────

const inputStyle = {
  flex: 1,
  minWidth: 200,
  padding: '7px 10px',
  borderRadius: 7,
  border: '1px solid #444',
  background: '#1a1a1a',
  color: '#eee',
  fontSize: 13,
  outline: 'none',
}

function btnStyle(bg, extra = {}) {
  return {
    padding: '7px 14px',
    borderRadius: 7,
    border: 'none',
    background: bg,
    color: '#fff',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
    ...extra,
  }
}