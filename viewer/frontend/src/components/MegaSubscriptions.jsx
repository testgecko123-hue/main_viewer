/**
 * MegaSubscriptions.jsx
 * ─────────────────────
 * Panel that manages MEGA.nz folder subscriptions, displays their scraped
 * file feed, lets the user pick items, and triggers download→re-upload to
 * the storage network.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../utils/api.js'
import { postThumbUrl, parseSourceMeta, EXTERNAL_IMG_PROPS } from '../utils/mediaUtils.js'

// ── helpers ──────────────────────────────────────────────────────────────

function fmtBytes(b) {
  if (!b || b < 0) return '?'
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

// ── LightboxModal (photo full-view) ──────────────────────────────────────

function LightboxModal({ post, onClose }) {
  const thumbUrl = postThumbUrl(post)
  const meta = parseSourceMeta(post)
  const imgUrl = post.cdn_url || post.file_url || thumbUrl

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 16, right: 16,
          background: 'rgba(255,255,255,0.1)', border: 'none',
          borderRadius: '50%', width: 40, height: 40,
          color: '#fff', fontSize: 20, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >✕</button>

      <div onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <img
          src={imgUrl}
          alt={post.title || 'image'}
          {...EXTERNAL_IMG_PROPS}
          style={{ maxWidth: '90vw', maxHeight: '82vh', objectFit: 'contain', borderRadius: 8 }}
          onError={e => { e.target.style.display = 'none' }}
        />
        {post.title && (
          <div style={{ fontSize: 13, color: '#ccc', textAlign: 'center', maxWidth: 600 }}>
            {post.title}
          </div>
        )}
      </div>
    </div>
  )
}

// ── VideoModal ───────────────────────────────────────────────────────────

function VideoModal({ post, onClose }) {
  const meta = parseSourceMeta(post)
  const videoUrl = post.cdn_url || post.file_url || meta.source_url || ''

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.95)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 16, right: 16,
          background: 'rgba(255,255,255,0.1)', border: 'none',
          borderRadius: '50%', width: 40, height: 40,
          color: '#fff', fontSize: 20, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >✕</button>

      <div onClick={e => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        {videoUrl ? (
          <video
            src={videoUrl}
            controls
            autoPlay
            style={{ maxWidth: '92vw', maxHeight: '84vh', borderRadius: 8, background: '#000' }}
          />
        ) : (
          <div style={{ color: '#aaa', fontSize: 14, padding: 40 }}>
            No video URL available yet. Download and store the file first to play it.
          </div>
        )}
        {post.title && (
          <div style={{ fontSize: 13, color: '#ccc', textAlign: 'center', maxWidth: 600 }}>
            {post.title}
          </div>
        )}
      </div>
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
                  height: '100%',
                  width: `${usedPct}%`,
                  background: isFull ? '#e05050' : acc.kind === 'mega' ? '#d9534f' : '#4a90d9',
                  borderRadius: 4,
                  transition: 'width 0.4s',
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

function FeedPostCard({ post, selected, onToggle, uploading, onOpenMedia }) {
  const isVideo = post.media_type === 'video'
  const isImage = post.media_type === 'image'
  const size    = post.source_meta?.size || parseSourceMeta(post)?.size || 0
  const thumbUrl = postThumbUrl(post)
  const hasThumb = !!thumbUrl

  const [hovered, setHovered] = useState(false)
  const [imgError, setImgError] = useState(false)

  const statusColor = {
    unseen:  'transparent',
    saved:   '#3a7d44',
    ignored: '#555',
    unsure:  '#7d6a2a',
  }[post.status] || 'transparent'

  // Type badge colors
  const typeBadgeBg = isVideo ? 'rgba(220,80,60,0.88)' : isImage ? 'rgba(50,120,210,0.82)' : 'rgba(80,80,80,0.75)'
  const typeLabel   = isVideo ? '▶ VIDEO' : isImage ? '🖼 PHOTO' : 'FILE'

  function handleClick(e) {
    // If clicking the open-media button, don't toggle selection
    if (uploading) return
    onToggle(post.id)
  }

  function handleOpenMedia(e) {
    e.stopPropagation()
    onOpenMedia(post)
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleClick}
      style={{
        position: 'relative',
        borderRadius: 10,
        overflow: 'hidden',
        cursor: uploading ? 'default' : 'pointer',
        border: selected ? '2px solid #4a90d9' : hovered ? '2px solid #666' : '2px solid transparent',
        background: 'var(--surface-1, #1a1a1a)',
        transition: 'border-color 0.15s',
        aspectRatio: '4/3',
      }}
    >
      {/* Thumbnail or icon fallback */}
      {hasThumb && !imgError ? (
        <img
          src={thumbUrl}
          alt={post.title || ''}
          {...EXTERNAL_IMG_PROPS}
          onError={() => setImgError(true)}
          style={{
            width: '100%', height: '100%',
            objectFit: 'cover',
            display: 'block',
            transition: 'transform 0.2s',
            transform: hovered ? 'scale(1.04)' : 'scale(1)',
          }}
        />
      ) : (
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 6, padding: 8,
        }}>
          <span style={{ fontSize: 36 }}>{isVideo ? '🎬' : isImage ? '🖼️' : '📄'}</span>
          <div style={{
            fontSize: 10, color: 'var(--text-primary, #ddd)',
            overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            lineHeight: 1.3, textAlign: 'center',
          }}>
            {post.title || `file_${post.id}`}
          </div>
          {size > 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-secondary, #888)' }}>
              {fmtBytes(size)}
            </div>
          )}
        </div>
      )}

      {/* Dark gradient overlay on hover or when no thumb */}
      {(hovered || !hasThumb || imgError) && hasThumb && !imgError && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.1) 60%, transparent 100%)',
          pointerEvents: 'none',
        }} />
      )}

      {/* Type badge (top-left) */}
      <div style={{
        position: 'absolute', top: 6, left: 6,
        background: typeBadgeBg,
        borderRadius: 4, fontSize: 9, padding: '2px 5px',
        color: '#fff', fontWeight: 700, letterSpacing: '0.04em',
        backdropFilter: 'blur(4px)',
      }}>
        {typeLabel}
      </div>

      {/* Status badge */}
      {statusColor !== 'transparent' && (
        <div style={{
          position: 'absolute', top: 6, left: isVideo || isImage ? 72 : 6,
          background: statusColor, borderRadius: 4,
          fontSize: 9, padding: '2px 5px', color: '#fff', fontWeight: 700,
        }}>
          {post.status.toUpperCase()}
        </div>
      )}

      {/* Video play button overlay (center) */}
      {isVideo && (
        <button
          onClick={handleOpenMedia}
          style={{
            position: 'absolute',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 44, height: 44, borderRadius: '50%',
            background: hovered ? 'rgba(220,80,60,0.92)' : 'rgba(0,0,0,0.55)',
            border: '2px solid rgba(255,255,255,0.7)',
            color: '#fff', fontSize: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            transition: 'background 0.15s, transform 0.15s',
            boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
          }}
          title="Play video"
        >▶</button>
      )}

      {/* Photo expand button (shows on hover) */}
      {isImage && hovered && (
        <button
          onClick={handleOpenMedia}
          style={{
            position: 'absolute',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 40, height: 40, borderRadius: '50%',
            background: 'rgba(74,144,217,0.88)',
            border: '2px solid rgba(255,255,255,0.6)',
            color: '#fff', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
          }}
          title="View full image"
        >⤢</button>
      )}

      {/* Bottom info bar (visible on hover when there's a thumb) */}
      {hasThumb && !imgError && hovered && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '6px 8px',
          pointerEvents: 'none',
        }}>
          <div style={{
            fontSize: 10, color: '#eee',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {post.title || `file_${post.id}`}
          </div>
          {size > 0 && (
            <div style={{ fontSize: 9, color: '#aaa' }}>{fmtBytes(size)}</div>
          )}
        </div>
      )}

      {/* Selected checkmark */}
      {selected && (
        <div style={{
          position: 'absolute', top: 6, right: 6,
          width: 22, height: 22, borderRadius: '50%',
          background: '#4a90d9', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, color: '#fff', fontWeight: 700,
          boxShadow: '0 1px 6px rgba(0,0,0,0.4)',
        }}>✓</div>
      )}

      {/* Sub label */}
      {post.sub_label && !hovered && (
        <div style={{
          position: 'absolute', bottom: 4, right: 6,
          fontSize: 9, color: '#4a90d9', fontWeight: 600,
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
            {ev.status === 'error' && (
              <div style={{ fontSize: 10, color: '#e06060' }}>{ev.error}</div>
            )}
            {ev.status === 'downloading' && (
              <div style={{ fontSize: 10, color: '#888' }}>downloading…</div>
            )}
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
  const [mediaModal, setMediaModal] = useState(null) // { post, type: 'image'|'video' }
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

  function handleOpenMedia(post) {
    setMediaModal({ post, type: post.media_type === 'video' ? 'video' : 'image' })
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
    loadPosts(offset)
  }

  const canStoreSelected = selected.size > 0 && !uploading

  // Count videos vs images in current feed
  const videoCount = posts.filter(p => p.media_type === 'video').length
  const imageCount = posts.filter(p => p.media_type === 'image').length

  return (
    <div style={{ padding: '16px 0' }}>

      {/* Modals */}
      {mediaModal?.type === 'image' && (
        <LightboxModal post={mediaModal.post} onClose={() => setMediaModal(null)} />
      )}
      {mediaModal?.type === 'video' && (
        <VideoModal post={mediaModal.post} onClose={() => setMediaModal(null)} />
      )}

      {/* Storage network bars */}
      <StorageBar accounts={accounts} />

      {/* Add subscription form */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--text-primary, #eee)' }}>
          MEGA Subscriptions
        </div>
        <AddSubForm onAdded={handleSubAdded} />
      </div>

      {/* Subscription list */}
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

      {/* Upload progress */}
      <UploadProgress events={uploadEvents} />

      {/* Feed header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary, #eee)' }}>
          MEGA Feed
        </div>
        {/* Filter tabs */}
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
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#888' }}>
          {total} post{total !== 1 ? 's' : ''}
          {(videoCount > 0 || imageCount > 0) && posts.length > 0 && (
            <span style={{ marginLeft: 8 }}>
              {videoCount > 0 && <span style={{ color: '#d9534f' }}>▶ {videoCount}</span>}
              {videoCount > 0 && imageCount > 0 && <span style={{ color: '#555' }}> · </span>}
              {imageCount > 0 && <span style={{ color: '#4a90d9' }}>🖼 {imageCount}</span>}
            </span>
          )}
        </span>
        {selected.size > 0 && (
          <button
            onClick={handleStoreSelected}
            disabled={!canStoreSelected}
            style={btnStyle('#3a7d44')}
          >
            ⬆ Store {selected.size} selected
          </button>
        )}
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
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 10,
        }}>
          {posts.map(post => (
            <div key={post.id} style={{ position: 'relative' }}>
              <FeedPostCard
                post={post}
                selected={selected.has(post.id)}
                onToggle={toggleSelect}
                uploading={uploading}
                onOpenMedia={handleOpenMedia}
              />
              {/* quick-status menu */}
              <div style={{ display: 'flex', gap: 3, marginTop: 4, justifyContent: 'center' }}>
                {['saved', 'ignored'].map(s => (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(post.id, s)}
                    style={{
                      fontSize: 9, padding: '2px 5px', borderRadius: 4, border: 'none',
                      cursor: 'pointer',
                      background: post.status === s ? (s === 'saved' ? '#3a7d44' : '#555') : '#2a2a2a',
                      color: '#aaa',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
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
          >
            ← Prev
          </button>
          <span style={{ color: '#888', fontSize: 12, alignSelf: 'center' }}>
            {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
          </span>
          <button
            onClick={() => loadPosts(offset + LIMIT)}
            disabled={offset + LIMIT >= total}
            style={btnStyle('#333', { padding: '6px 16px' })}
          >
            Next →
          </button>
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
    opacity: 1,
    ...extra,
  }
}