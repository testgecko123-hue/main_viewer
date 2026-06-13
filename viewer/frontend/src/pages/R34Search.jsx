import { useState, useCallback, useEffect, useRef } from 'react'
import TagSearch from '../components/TagSearch.jsx'
import useIsMobile from '../hooks/useIsMobile.js'
import { gridCols, GRID } from '../config/gridConfig.js'
import { apiFetch } from '../utils/api.js'

// ── Tiny R34 thumbnail card ───────────────────────────────────────────────────

function R34Thumb({ post, onSelect, isSelected, onSave, saving }) {
  const isVideo = post.media_type === 'video'
  const videoRef = useRef()
  const [hovered, setHovered] = useState(false)

  function onEnter(e) {
    e.currentTarget.style.transform = 'scale(1.02)'
    setHovered(true)
    if (isVideo && videoRef.current) {
      videoRef.current.muted = true
      videoRef.current.play().catch(() => {})
    }
  }

  function onLeave(e) {
    e.currentTarget.style.transform = 'scale(1)'
    setHovered(false)
    if (isVideo && videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
  }

  const borderColor = isSelected
    ? 'var(--accent)'
    : post.in_library
    ? '#22c55e88'
    : 'transparent'

  return (
    <div
      onClick={() => onSelect(post)}
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onSelect(post)}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: 'relative', cursor: 'pointer', borderRadius: 4, overflow: 'hidden',
        border: `2px solid ${borderColor}`,
        background: 'var(--surface2)', transition: 'border-color 0.1s, transform 0.1s',
        aspectRatio: '1',
      }}
    >
      <img
        src={post.thumb_cdn}
        alt=""
        style={{
          width: '100%', height: '100%', objectFit: 'cover', display: 'block',
          opacity: (isVideo && hovered) ? 0 : 1, transition: 'opacity 0.1s',
        }}
        onError={e => e.target.style.display = 'none'}
      />

      {isVideo && (
        <video
          ref={videoRef}
          src={post.cdn_url}
          muted loop playsInline preload="none"
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', opacity: hovered ? 1 : 0, transition: 'opacity 0.1s',
          }}
        />
      )}

      {/* Video badge */}
      {isVideo && !hovered && (
        <div style={{
          position: 'absolute', bottom: 4, right: 4,
          background: 'rgba(0,0,0,0.7)', borderRadius: 3,
          padding: '2px 5px', fontSize: '0.6rem', color: '#fff',
        }}>▶</div>
      )}

      {/* Already in library badge */}
      {post.in_library && (
        <div style={{
          position: 'absolute', top: 4, left: 4,
          background: '#14532d', border: '1px solid #22c55e88',
          borderRadius: 3, padding: '2px 6px',
          fontSize: '0.58rem', color: '#86efac', fontWeight: 700,
          letterSpacing: '0.06em',
        }}>IN LIB</div>
      )}

      {/* Selected checkmark */}
      {isSelected && (
        <div style={{
          position: 'absolute', top: 4, right: 4,
          background: 'var(--accent)', borderRadius: '50%',
          width: 18, height: 18, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: '0.6rem', color: '#000', fontWeight: 700,
          zIndex: 2,
        }}>✓</div>
      )}

      {/* Quick-save button on hover (only if not yet in library) */}
      {hovered && !post.in_library && (
        <button
          onClick={e => { e.stopPropagation(); onSave(post) }}
          disabled={saving}
          style={{
            position: 'absolute', bottom: 4, left: 4,
            background: saving ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.75)',
            border: '1px solid var(--accent)',
            borderRadius: 3, padding: '3px 7px',
            fontSize: '0.58rem', color: 'var(--accent)',
            cursor: saving ? 'default' : 'pointer',
            letterSpacing: '0.05em',
          }}
        >{saving ? '...' : '+ SAVE'}</button>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const EMPTY_TAGS = { needed: [], optional: [], exclude: ["ai_generated", "gay", "futanari"] }
// Keep in sync with backend cap for consistent paging.
const LIMIT = 100

export default function R34Search() {
  const isMobile = useIsMobile()
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [tags, setTags]           = useState(EMPTY_TAGS)
  const [mediaType, setMedia]     = useState('')
  const [posts, setPosts]         = useState([])
  const [page, setPage]           = useState(0)
  const [hasMore, setHasMore]     = useState(false)
  const [loading, setLoading]     = useState(false)
  const [searched, setSearched]   = useState(false)    // did user run a search yet?
  const [error, setError]         = useState(null)
  const [detail, setDetail]       = useState(null)
  const [selected, setSelected]   = useState(new Set())
  const [saving, setSaving]       = useState(new Set())  // r34 IDs currently being saved
  const [saveMsg, setSaveMsg]     = useState({})         // { [r34Id]: 'ok' | 'err' }
  const [importUrl, setImportUrl] = useState('')
  const [importStatus, setImportStatus] = useState(null)
  const [importing, setImporting] = useState(false)
  const [forceImport, setForceImport] = useState(false)
  const [phRefreshing, setPhRefreshing] = useState(false)
  const [phRefreshResult, setPhRefreshResult] = useState(null)
  const gridRef = useRef()
  const sentinelRef = useRef()

  // ── Pornhub metadata refresh ─────────────────────────────────────────────────
  async function refreshPhMetadata() {
    setPhRefreshing(true)
    setPhRefreshResult(null)
    try {
      const res  = await apiFetch('/api/pornhub/refresh', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Refresh failed')
      setPhRefreshResult({ ok: true, msg: `Updated ${data.updated} of ${data.total} posts` })
    } catch (e) {
      setPhRefreshResult({ ok: false, msg: e.message || 'Refresh failed' })
    }
    setPhRefreshing(false)
  }

  // ── Infinite-scroll sentinel ────────────────────────────────────────────────
  useEffect(() => {
    if (!hasMore) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loading) loadMore()
    }, { rootMargin: '300px' })
    if (sentinelRef.current) obs.observe(sentinelRef.current)
    return () => obs.disconnect()
  }, [hasMore, loading, page])

  // ── Build query params ──────────────────────────────────────────────────────
  function buildParams(pg = 0) {
    const p = new URLSearchParams()
    tags.needed.forEach(t   => p.append('needed', t))
    tags.optional.forEach(t => p.append('optional', t))
    tags.exclude.forEach(t  => p.append('exclude', t))
    if (mediaType) p.set('media_type', mediaType)
    p.set('limit', LIMIT)
    p.set('page', pg)
    return p
  }

  // ── Search ──────────────────────────────────────────────────────────────────
  async function doSearch(reset = true) {
    setLoading(true)
    setError(null)
    if (reset) {
      setPosts([])
      setPage(0)
      setHasMore(false)
      setSearched(true)
    }
    const pg = reset ? 0 : page
    try {
      const res  = await apiFetch(`/api/r34/search?${buildParams(pg)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Search failed')
      const incoming = data.posts || []
      setPosts(prev => reset ? incoming : [...prev, ...incoming])
      setHasMore(Boolean(data.has_more))
      setPage(pg + 1)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  function loadMore() {
    if (!loading && hasMore) doSearch(false)
  }

  // ── Select / detail ─────────────────────────────────────────────────────────
  function handleThumbClick(post) {
    if (isMobile) {
      setSelected(prev => {
        const next = new Set(prev)
        next.has(post.id) ? next.delete(post.id) : next.add(post.id)
        return next
      })
      return
    }
    if (selected.size > 0) {
      setSelected(prev => {
        const next = new Set(prev)
        next.has(post.id) ? next.delete(post.id) : next.add(post.id)
        return next
      })
    } else {
      setDetail(post)
    }
  }

  // ── Save a single post to library ───────────────────────────────────────────
  async function savePost(post) {
    setSaving(prev => new Set(prev).add(post.id))
    try {
      const res  = await apiFetch('/api/r34/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      // Mark as in_library in local state
      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, in_library: true } : p))
      if (detail?.id === post.id) setDetail(d => ({ ...d, in_library: true }))
      setSaveMsg(prev => ({ ...prev, [post.id]: 'ok' }))
    } catch (e) {
      setSaveMsg(prev => ({ ...prev, [post.id]: 'err:' + e.message }))
    }
    setSaving(prev => { const n = new Set(prev); n.delete(post.id); return n })
  }

  // ── Save selected posts ──────────────────────────────────────────────────────
  async function saveSelected() {
    const toSave = posts.filter(p => selected.has(p.id) && !p.in_library)
    for (const p of toSave) await savePost(p)
    setSelected(new Set())
  }

  async function importMedia() {
    const url = importUrl.trim()
    if (!url) return
    setImporting(true)
    setImportStatus(null)
    try {
      const res = await apiFetch('/api/posts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, force: forceImport }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      setImportStatus(data.status === 'already_saved' ? 'Already in library' : 'Added to library')
      setImportUrl('')
      setForceImport(false)
    } catch (e) {
      setImportStatus(e.message || 'Import failed')
    }
    setImporting(false)
  }

  const selectedNotOwned = posts.filter(p => selected.has(p.id) && !p.in_library).length

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: 'calc(100vh - var(--nav-h))' }}>

      {/* ── Left sidebar ───────────────────────────────────────────────────── */}
      <div style={{
        width: isMobile ? '100%' : 320, maxHeight: isMobile ? '42vh' : 'none', flexShrink: 0,
        borderRight: isMobile ? 'none' : '1px solid var(--border)',
        borderBottom: isMobile ? '1px solid var(--border)' : 'none',
        padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        {isMobile && (
          <button className="btn-surface" type="button"
            onClick={() => setMobileSearchOpen(v => !v)}
            style={{ width: '100%', fontSize: '0.72rem', padding: '8px 10px' }}>
            {mobileSearchOpen ? '▲ HIDE SEARCH / FILTERS' : '▼ SHOW SEARCH / FILTERS'}
          </button>
        )}
        <div style={{
          display: !isMobile || mobileSearchOpen ? 'flex' : 'none',
          flexDirection: 'column',
          gap: 16,
          minHeight: 0,
        }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem',
          color: 'var(--accent)', letterSpacing: '-0.01em' }}>
          R34 SEARCH
        </div>
        <div style={{ fontSize: '0.62rem', color: 'var(--muted)', marginTop: -10 }}>
          Searches rule34.xxx directly. Optional tags are treated as required.
        </div>

        <TagSearch
          value={tags}
          onChange={setTags}
          onSearch={() => doSearch(true)}
        />

        {/* Filters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', letterSpacing: '0.08em' }}>
            FILTERS
          </div>
          <select value={mediaType} onChange={e => setMedia(e.target.value)}
            style={{ background: '#0d0d0d', border: '1px solid var(--border)', color: 'var(--text)',
              fontFamily: 'var(--font-mono)', fontSize: '0.78rem', padding: '9px 10px', borderRadius: 4 }}>
            <option value="">All media</option>
            <option value="image">Images only</option>
            <option value="video">Videos only</option>
          </select>
        </div>

        <button className="btn-accent" onClick={() => doSearch(true)}
          style={{ width: '100%', padding: '11px', fontSize: '0.82rem', letterSpacing: '0.08em' }}>
          SEARCH
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8,
          borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', letterSpacing: '0.08em' }}>
            PORNHUB METADATA
          </div>
          <div style={{ fontSize: '0.62rem', color: 'var(--muted)', lineHeight: 1.5 }}>
            Pulls current thumbnails and tags for all Pornhub posts from the official API.
          </div>
          <button className="btn-surface" onClick={refreshPhMetadata}
            disabled={phRefreshing}
            style={{ width: '100%', opacity: phRefreshing ? 0.6 : 1 }}>
            {phRefreshing ? 'REFRESHING…' : '↻ REFRESH PH METADATA'}
          </button>
          {phRefreshResult && (
            <div style={{
              fontSize: '0.65rem',
              color: phRefreshResult.ok ? 'var(--green)' : 'var(--red)',
            }}>
              {phRefreshResult.msg}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8,
          borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', letterSpacing: '0.08em' }}>
            ADD OTHER MEDIA
          </div>
          <div style={{ fontSize: '0.62rem', color: 'var(--muted)', lineHeight: 1.5 }}>
            Direct file URL, rule34hub.com post, or multporn.net comic/video (saved to your library).
          </div>
          <input
            value={importUrl}
            onChange={e => { setImportUrl(e.target.value); setImportStatus(null) }}
            onKeyDown={e => e.key === 'Enter' && importMedia()}
            placeholder="https://…"
            style={{ fontSize: '0.72rem' }}
          />
          {/* Force import toggle */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: '0.65rem', color: forceImport ? 'var(--accent)' : 'var(--muted)',
            cursor: 'pointer', userSelect: 'none',
          }}>
            <input
              type="checkbox"
              checked={forceImport}
              onChange={e => setForceImport(e.target.checked)}
              style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer' }}
            />
            FORCE IMPORT
            <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>
              — for token-gated CDN links (e.g. FPO)
            </span>
          </label>
          <button className="btn-surface" onClick={importMedia} disabled={importing || !importUrl.trim()}
            style={{ width: '100%', opacity: importing ? 0.6 : 1 }}>
            {importing ? 'IMPORTING…' : '+ IMPORT URL'}
          </button>
          {importStatus && (
            <div style={{
              fontSize: '0.65rem',
              color: importStatus.startsWith('Already') ? 'var(--muted)' : 'var(--green)',
            }}>
              {importStatus}
            </div>
          )}
        </div>

        {error && (
          <div style={{ fontSize: '0.65rem', color: 'var(--red)', wordBreak: 'break-word' }}>
            {error}
          </div>
        )}

        {/* Legend */}
        {searched && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5,
            borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.06em' }}>
              LEGEND
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2,
                border: '2px solid #22c55e88', flexShrink: 0 }} />
              <span style={{ fontSize: '0.63rem', color: 'var(--muted)' }}>Already in your library</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2,
                border: '2px solid transparent', background: 'var(--surface3)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.63rem', color: 'var(--muted)' }}>Not yet saved — hover for + SAVE</span>
            </div>
          </div>
        )}

        {/* Multi-select actions */}
        {selected.size > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12,
            display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>
              {selected.size} selected
              {selectedNotOwned < selected.size && (
                <span style={{ color: '#86efac' }}>
                  {' '}({selected.size - selectedNotOwned} already saved)
                </span>
              )}
            </div>
            {selectedNotOwned > 0 && (
              <button className="btn-accent" onClick={saveSelected}>
                + SAVE {selectedNotOwned} TO LIBRARY
              </button>
            )}
            <button className="btn-ghost" onClick={() => setSelected(new Set())}>
              CLEAR SELECTION
            </button>
          </div>
        )}

        <div style={{ flex: 1 }} />

        <button className="btn-ghost"
          onClick={() => gridRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          style={{ width: '100%', padding: '10px', fontSize: '0.78rem', letterSpacing: '0.06em',
            borderTop: '1px solid var(--border)', marginTop: 8 }}>
          ↑ BACK TO TOP
        </button>
        </div>
      </div>

      {/* ── Main grid ──────────────────────────────────────────────────────── */}
      <div ref={gridRef} style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 10 : 16 }}>
        {!searched && !loading && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: 12,
            color: 'var(--muted)', fontSize: '0.75rem',
          }}>
            <div style={{ fontSize: '2rem', opacity: 0.15 }}>⌕</div>
            <div>Add tags and hit SEARCH to browse rule34.xxx</div>
          </div>
        )}

        {searched && posts.length === 0 && !loading && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '50%', color: 'var(--muted)', fontSize: '0.75rem',
          }}>
            No results found.
          </div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile
            ? gridCols.mobile
            : gridCols.desktop,
          gap: GRID.gap,
        }}>
          {posts.map(post => (
            <R34Thumb
              key={post.id}
              post={post}
              onSelect={handleThumbClick}
              isSelected={selected.has(post.id)}
              onSave={savePost}
              saving={saving.has(post.id)}
            />
          ))}
        </div>

        {hasMore && (
          <div ref={sentinelRef}
            style={{ height: 40, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: 'var(--muted)', fontSize: '0.7rem', marginTop: 12 }}>
            {loading ? 'loading...' : ''}
          </div>
        )}

        {!hasMore && posts.length > 0 && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.65rem',
            padding: '20px 0', letterSpacing: '0.08em' }}>
            — {posts.length} posts —
          </div>
        )}

        {loading && posts.length === 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '40%', color: 'var(--muted)', fontSize: '0.75rem',
          }}>
            searching...
          </div>
        )}
      </div>

      {/* ── Right detail panel ─────────────────────────────────────────────── */}
      {detail && (
        <div style={{
          width: isMobile ? '100%' : 260, maxHeight: isMobile ? '40vh' : 'none',
          flexShrink: 0, borderLeft: isMobile ? 'none' : '1px solid var(--border)',
          borderTop: isMobile ? '1px solid var(--border)' : 'none',
          padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>POST DETAIL</div>
            <button className="btn-ghost" onClick={() => setDetail(null)}
              style={{ padding: '2px 8px' }}>×</button>
          </div>

          {/* Thumbnail */}
          <div style={{ borderRadius: 4, overflow: 'hidden', background: 'var(--surface2)' }}>
            {detail.media_type === 'video' ? (
              <video src={detail.cdn_url} controls muted playsInline
                style={{ width: '100%', display: 'block', maxHeight: 300, objectFit: 'contain' }} />
            ) : (
              <img src={detail.thumb_cdn} alt=""
                style={{ width: '100%', display: 'block' }}
                onError={e => e.target.style.display = 'none'} />
            )}
          </div>

          {/* Meta */}
          <div style={{ fontSize: '0.68rem', lineHeight: 2, color: 'var(--muted)' }}>
            <div><span style={{ color: 'var(--text)' }}>R34 ID</span> {detail.id}</div>
            <div><span style={{ color: 'var(--text)' }}>Type</span> {detail.media_type}</div>
            {detail.width && <div><span style={{ color: 'var(--text)' }}>Size</span> {detail.width}×{detail.height}</div>}
            {detail.source && (
              <div><a href={detail.source} target="_blank" rel="noreferrer"
                style={{ color: 'var(--blue)' }}>Source ↗</a></div>
            )}
            <div>
              <a href={`https://rule34.xxx/index.php?page=post&s=view&id=${detail.id}`}
                target="_blank" rel="noreferrer"
                style={{ color: 'var(--blue)' }}>View on R34 ↗</a>
            </div>
          </div>

          {/* Library status */}
          {detail.in_library ? (
            <div style={{
              background: '#14532d33', border: '1px solid #22c55e55',
              borderRadius: 4, padding: '8px 12px',
              fontSize: '0.68rem', color: '#86efac', textAlign: 'center',
            }}>
              ✓ Already in your library
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                className="btn-accent"
                disabled={saving.has(detail.id)}
                onClick={() => savePost(detail)}
                style={{ width: '100%', opacity: saving.has(detail.id) ? 0.6 : 1 }}>
                {saving.has(detail.id) ? 'SAVING...' : '+ SAVE TO LIBRARY'}
              </button>
              {saveMsg[detail.id] === 'ok' && (
                <div style={{ fontSize: '0.63rem', color: 'var(--green)', textAlign: 'center' }}>
                  Saved ✓
                </div>
              )}
              {saveMsg[detail.id]?.startsWith('err:') && (
                <div style={{ fontSize: '0.63rem', color: 'var(--red)' }}>
                  {saveMsg[detail.id].slice(4)}
                </div>
              )}
            </div>
          )}

          {/* Tags */}
          {detail.tags?.length > 0 && (
            <div>
              <div style={{ fontSize: '0.62rem', color: 'var(--muted)', marginBottom: 6,
                letterSpacing: '0.08em' }}>TAGS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {detail.tags.map(t => (
                  <span key={t}
                    onClick={() => {
                      setTags(prev => {
                        const norm = t.toLowerCase().replace(/ /g, '_')
                        if (prev.needed.includes(norm)) return prev
                        return { ...prev, needed: [...prev.needed, norm] }
                      })
                    }}
                    style={{
                      background: 'var(--surface3)', border: '1px solid var(--border2)',
                      borderRadius: 3, padding: '2px 7px', fontSize: '0.63rem',
                      cursor: 'pointer', color: 'var(--muted2)', transition: 'all 0.1s',
                    }}
                    onMouseEnter={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.color = 'var(--text)' }}
                    onMouseLeave={e => { e.target.style.borderColor = 'var(--border2)'; e.target.style.color = 'var(--muted2)' }}
                  >{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}