import { useState, useCallback, useEffect, useRef } from 'react'
import TagSearch from '../components/TagSearch.jsx'
import PostGrid from '../components/PostGrid.jsx'
import useIsMobile from '../hooks/useIsMobile.js'
import { EXTERNAL_IMG_PROPS, parseSourceMeta, postThumbUrl } from '../utils/mediaUtils.js'

const LIMIT = 60

const EMPTY_SEARCH = { needed: [], optional: [], exclude: [] }

export default function Library({ selection, setSelection, openViewer }) {
  const isMobile = useIsMobile()
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [tags, setTags]         = useState(EMPTY_SEARCH)
  const [mediaType, setMedia]   = useState('')
  const [sourceType, setSourceType] = useState('')
  const [mediaCategory, setMediaCategory] = useState('')
  const [order, setOrder]       = useState('saved_newest')
  const [posts, setPosts]       = useState([])
  const [total, setTotal]       = useState(0)
  const [offset, setOffset]     = useState(0)
  const [loading, setLoading]   = useState(false)
  const [searchKey, setSearchKey] = useState(0)  // increment to force full reset
  const [selected, setSelected] = useState(new Set())
  const [detail, setDetail]     = useState(null)  // post detail panel
  const gridRef = useRef()

  const buildParams = useCallback((off = 0) => {
    const p = new URLSearchParams()
    tags.needed.forEach(t   => p.append('needed', t))
    tags.optional.forEach(t => p.append('optional', t))
    tags.exclude.forEach(t  => p.append('exclude', t))
    if (mediaType) p.set('media_type', mediaType)
    if (sourceType) p.set('source_type', sourceType)
    if (mediaCategory) p.set('media_category', mediaCategory)
    p.set('order', order)
    p.set('limit', LIMIT)
    p.set('offset', off)
    return p
  }, [tags, mediaType, sourceType, mediaCategory, order])

  const doSearch = useCallback(async (reset = true) => {
    setLoading(true)
    try {
      const off = reset ? 0 : offset
      if (reset) {
        setPosts([])   // clear immediately so old results vanish
        setOffset(0)
        setTotal(0)
      }
      const res = await fetch(`/api/posts?${buildParams(reset ? 0 : off)}`)
      const data = await res.json()
      const newPosts = data.posts || []
      const total = data.total ?? 0
      setPosts(prev => reset ? newPosts : [...prev, ...newPosts])
      setTotal(total)
      setOffset((reset ? 0 : off) + newPosts.length)
    } catch(e) {
      console.error('Search failed:', e)
    }
    setLoading(false)
  }, [buildParams, offset])

  // Initial load
  useEffect(() => { doSearch(true) }, [order, mediaType, sourceType, mediaCategory])

  function loadMore() {
    if (!loading && offset < total) doSearch(false)
  }

  function toggleSelect(post) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(post.id) ? next.delete(post.id) : next.add(post.id)
      return next
    })
  }

  function handlePostClick(post) {
    if (isMobile) {
      addToSelection([post.id])
      return
    }
    if (selected.size > 0) {
      toggleSelect(post)
    } else {
      setDetail(post)
    }
  }

  function handleMiddleClick(e, post) {
    if (e.button === 1) {
      e.preventDefault()
      addToSelection([post.id])
    }
  }

  function addToSelection(postIds) {
    const newIds = [...new Set([...selection.ids, ...postIds])]
    setSelection(s => ({ ...s, ids: newIds }))
  }

  async function importMedia() {
    const url = importUrl.trim()
    if (!url) return
    setImporting(true)
    setImportStatus(null)
    try {
      const res = await fetch('/api/posts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      setImportStatus(data.status === 'already_saved' ? 'Already in library' : 'Added to library')
      setImportUrl('')
      if (order !== 'saved_newest') setOrder('saved_newest')
      else await doSearch(true)
    } catch (e) {
      setImportStatus(e.message || 'Import failed')
    }
    setImporting(false)
  }

  function viewSelected() {
    if (selected.size === 0) return
    const selectedIds = posts.filter(p => selected.has(p.id)).map(p => p.id)
    setSelection(s => ({ ...s, ids: selectedIds }))
    setSelected(new Set())
    openViewer(selectedIds, 0)
  }

  async function fetchDetail(id) {
    const res = await fetch(`/api/posts/${id}`)
    setDetail(await res.json())
  }

  const [confirmDelete, setConfirmDelete] = useState(null)
  const [r34UpdateUrl, setR34UpdateUrl]   = useState('')
  const [r34UpdateStatus, setR34Status]   = useState(null)
  const [r34UpdateMsg, setR34Msg]         = useState('')
  const [autoMatch, setAutoMatch]         = useState(null)   // { loading, candidates, search_tags, post_id }
  const [autoMatchMsg, setAutoMatchMsg]   = useState('')
  const [importUrl, setImportUrl]         = useState('')
  const [importStatus, setImportStatus]   = useState(null)
  const [importing, setImporting]         = useState(false)

  async function autoSearch(postId) {
    setAutoMatch({ loading: true, candidates: [], search_tags: [], post_id: postId })
    setAutoMatchMsg('')
    try {
      const res = await fetch(`/api/posts/${postId}/auto-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_apply: false }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAutoMatch(null)
        setAutoMatchMsg(data.error || 'Auto-search failed')
        return
      }
      if (data.status === 'applied') {
        setAutoMatch(null)
        setDetail(data.post)
        setPosts(prev => prev.map(p => p.id === postId ? { ...p, ...data.post } : p))
        setAutoMatchMsg(`Auto-applied — ${data.tags_updated} tags`)
        return
      }
      setAutoMatch({ loading: false, candidates: data.candidates, search_tags: data.search_tags, post_id: postId, confident: data.confident })
    } catch (e) {
      setAutoMatch(null)
      setAutoMatchMsg(e.message)
    }
  }

  async function applyCandidate(postId, r34Id) {
    const res = await fetch(`/api/posts/${postId}/auto-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apply: true, r34_id: r34Id }),
    })
    const data = await res.json()
    if (data.status === 'applied') {
      setDetail(data.post)
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, ...data.post } : p))
      setAutoMatch(null)
      setAutoMatchMsg(`Updated — ${data.tags_updated} tags, R34 ID ${data.r34_id}`)
    }
  }

  async function updateFromR34(postId) {
    if (!r34UpdateUrl.trim()) return
    setR34Status('loading')
    setR34Msg('')
    try {
      const res = await fetch(`/api/posts/${postId}/update-from-r34`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ r34_url: r34UpdateUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setR34Status('error')
        setR34Msg(data.error || 'Unknown error')
      } else {
        setR34Status('ok')
        setR34Msg(`Updated — ${data.tags_updated} tags, R34 ID ${data.r34_id}`)
        setDetail(data.post)
        setR34UpdateUrl('')
        // Refresh grid entry
        setPosts(prev => prev.map(p => p.id === postId ? { ...p, ...data.post } : p))
      }
    } catch (e) {
      setR34Status('error')
      setR34Msg(e.message)
    }
  }

  async function deletePost(id) {
    await fetch(`/api/posts/${id}`, { method: 'DELETE' })
    setPosts(prev => prev.filter(p => p.id !== id))
    setTotal(t => t - 1)
    setDetail(null)
    setConfirmDelete(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: 'calc(100vh - var(--nav-h))' }}>

      {/* Left sidebar: search */}
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
          color: 'var(--accent)', letterSpacing: '-0.01em' }}>SEARCH</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <a
            href="https://rule34.xxx/index.php?page=post&s=list"
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: 'none' }}
          >
            <button
              className="btn-surface"
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '0.75rem',
                letterSpacing: '0.06em'
              }}
            >
              🔎 OPEN R34 SEARCH ↗
            </button>
          </a>
        </div>

        <TagSearch
          value={tags}
          onChange={setTags}
          onSearch={() => doSearch(true)}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8,
          borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', letterSpacing: '0.08em' }}>
            ADD MEDIA
          </div>
          <div style={{ fontSize: '0.62rem', color: 'var(--muted)', lineHeight: 1.5 }}>
            Direct image/video URL, rule34.xxx, rule34hub.com, or multporn.net post link.
          </div>
          <input
            value={importUrl}
            onChange={e => { setImportUrl(e.target.value); setImportStatus(null) }}
            onKeyDown={e => e.key === 'Enter' && importMedia()}
            placeholder="https://…"
            style={{ fontSize: '0.72rem' }}
          />
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

        {/* Filters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', letterSpacing: '0.08em' }}>FILTERS</div>

          <select value={mediaType} onChange={e => setMedia(e.target.value)}
            style={{ background: '#0d0d0d', border: '1px solid var(--border)', color: 'var(--text)',
              fontFamily: 'var(--font-mono)', fontSize: '0.78rem', padding: '9px 10px', borderRadius: 4 }}>
            <option value="">All media types</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
            <option value="vr">VR videos</option>
            <option value="comic">Comics</option>
            <option value="gallery">Galleries</option>
            <option value="carousel">Carousels</option>
          </select>

          <select value={sourceType} onChange={e => setSourceType(e.target.value)}
            style={{ background: '#0d0d0d', border: '1px solid var(--border)', color: 'var(--text)',
              fontFamily: 'var(--font-mono)', fontSize: '0.78rem', padding: '9px 10px', borderRadius: 4 }}>
            <option value="">All sources</option>
            <option value="rule34">Rule34</option>
            <option value="rule34hub">Rule34hub</option>
            <option value="multporn">Multporn</option>
            <option value="manual">Imported links</option>
          </select>

          <select value={mediaCategory} onChange={e => setMediaCategory(e.target.value)}
            style={{ background: '#0d0d0d', border: '1px solid var(--border)', color: 'var(--text)',
              fontFamily: 'var(--font-mono)', fontSize: '0.78rem', padding: '9px 10px', borderRadius: 4 }}>
            <option value="">All categories</option>
            <option value="library">Library</option>
            <option value="imported">Imported</option>
          </select>

          <select value={order} onChange={e => setOrder(e.target.value)}
            style={{ background: '#0d0d0d', border: '1px solid var(--border)', color: 'var(--text)',
              fontFamily: 'var(--font-mono)', fontSize: '0.78rem', padding: '9px 10px', borderRadius: 4 }}>
            <option value="saved_newest">Date added ↓ (newest)</option>
            <option value="saved_oldest">Date added ↑ (oldest)</option>
            <option value="newest">R34 post ID ↓</option>
            <option value="oldest">R34 post ID ↑</option>
            <option value="random">Random</option>
          </select>
        </div>

        <button className="btn-accent" onClick={() => doSearch(true)}
          style={{ width: '100%', padding: '11px', fontSize: '0.82rem', letterSpacing: '0.08em' }}>
          SEARCH
        </button>

        <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>
          {(total || 0).toLocaleString()} posts
        </div>

        {/* Selection actions */}
        {selected.size > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12,
            display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>
              {selected.size} selected
            </div>
            <button className="btn-accent" onClick={viewSelected}>▶ VIEW SELECTED</button>
            <button className="btn-surface" onClick={() => addToSelection([...selected])}>
              + ADD TO SELECTION
            </button>
            <button className="btn-ghost" onClick={() => setSelected(new Set())}>
              CLEAR
            </button>
          </div>
        )}

        {selection.ids.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12,
            display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>
              Selection: {selection.ids.length} posts
            </div>
            <button className="btn-surface" onClick={() => addToSelection(posts.map(p => p.id))} style={{width:'100%',padding:'10px',fontSize:'0.78rem'}}>
              + ADD ALL RESULTS
            </button>
          </div>
        )}

        {/* Spacer pushes back-to-top to bottom */}
        <div style={{ flex: 1 }} />

        <button
          className="btn-ghost"
          onClick={() => gridRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          style={{ width: '100%', padding: '10px', fontSize: '0.78rem', letterSpacing: '0.06em',
            borderTop: '1px solid var(--border)', marginTop: 8 }}>
          ↑ BACK TO TOP
        </button>
        </div>
      </div>

      {/* Main grid */}
      <div ref={gridRef} style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 10 : 16 }}>
        <PostGrid
          posts={posts}
          onPostClick={handlePostClick}
          selectedIds={selected}
          loadMore={loadMore}
          hasMore={offset < total}
          loading={loading}
          onAddToSelection={post => addToSelection([post.id])}
          columns={isMobile ? 3 : null}
        />
      </div>

      {/* Right detail panel */}
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

          <div style={{ borderRadius: 4, overflow: 'hidden', background: 'var(--surface2)' }}>
            {detail.media_type === 'comic' && parseSourceMeta(detail).pages?.length > 0 ? (
              <div style={{ position: 'relative' }}>
                <img src={parseSourceMeta(detail).pages[0]} alt=""
                  {...EXTERNAL_IMG_PROPS}
                  style={{ width: '100%', display: 'block' }}
                  onError={e => { e.target.src = postThumbUrl(detail); }} />
                <div style={{
                  position: 'absolute', bottom: 4, right: 4,
                  background: 'rgba(139,92,246,0.85)', borderRadius: 3,
                  padding: '2px 6px', fontSize: '0.6rem', color: '#fff',
                }}>📖 {parseSourceMeta(detail).pages.length}p</div>
              </div>
            ) : (
              <img src={postThumbUrl(detail)} alt="" style={{ width: '100%', display: 'block' }}
                {...EXTERNAL_IMG_PROPS}
                onError={e => e.target.style.display = 'none'} />
            )}
          </div>

          <div style={{ fontSize: '0.68rem', lineHeight: 2, color: 'var(--muted)' }}>
            <div><span style={{ color: 'var(--text)' }}>ID</span> {detail.rule34hub_id || detail.id}</div>
            <div><span style={{ color: 'var(--text)' }}>Type</span> {detail.media_type}</div>
            {detail.source_type && (
              <div><span style={{ color: 'var(--text)' }}>Source</span> {detail.source_type}</div>
            )}
            {detail.created_at && (
              <div><span style={{ color: 'var(--text)' }}>Added</span> {new Date(detail.created_at).toLocaleString()}</div>
            )}
            {detail.media_category && detail.media_category !== 'library' && (
              <div><span style={{ color: 'var(--text)' }}>Category</span> {detail.media_category}</div>
            )}
            {detail.source_type && detail.source_type !== 'rule34' && (
              <div><span style={{ color: 'var(--text)' }}>Source</span> {detail.source_type}</div>
            )}
            {detail.width && <div><span style={{ color: 'var(--text)' }}>Size</span> {detail.width}×{detail.height}</div>}
            {detail.media_type === 'comic' && parseSourceMeta(detail).pages && (
              <div><span style={{ color: 'var(--text)' }}>Pages</span> {parseSourceMeta(detail).pages.length}</div>
            )}
            {detail.source && <div><a href={detail.source} target="_blank" rel="noreferrer">Source ↗</a></div>}
          </div>

          {detail.tags && (
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button className="btn-accent" onClick={() => {
              // Add to selection if not already in it, open at that post
              const ids = selection.ids.includes(detail.id)
                ? selection.ids
                : [...selection.ids, detail.id]
              const idx = ids.indexOf(detail.id)
              openViewer(ids, idx)
            }}>▶ VIEW</button>
            <button className="btn-surface" onClick={() => {
              addToSelection([detail.id])
              setDetail(null)
            }}>+ ADD TO SELECTION</button>
            {detail.hub_url && (
              <a href={detail.hub_url} target="_blank" rel="noreferrer">
                <button className="btn-ghost" style={{ width: '100%' }}>Open on rule34hub ↗</button>
              </a>
            )}

            {/* Update from R34 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6,
              borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div style={{ fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.08em' }}>
                UPDATE FROM R34
              </div>
              <button className="btn-surface"
                onClick={() => autoSearch(detail.id)}
                style={{ width: '100%', fontSize: '0.72rem' }}>
                ⟳ AUTO SEARCH
              </button>
              {autoMatchMsg && <div style={{ fontSize: '0.65rem', color: 'var(--green)' }}>{autoMatchMsg}</div>}
              <input
                value={r34UpdateUrl}
                onChange={e => { setR34UpdateUrl(e.target.value); setR34Status(null) }}
                onKeyDown={e => e.key === 'Enter' && updateFromR34(detail.id)}
                placeholder="or paste rule34.xxx URL / ID..."
                style={{ fontSize: '0.72rem' }}
              />
              <button
                className="btn-surface"
                onClick={() => updateFromR34(detail.id)}
                disabled={r34UpdateStatus === 'loading'}
                style={{ width: '100%', fontSize: '0.72rem', opacity: r34UpdateStatus === 'loading' ? 0.6 : 1 }}>
                {r34UpdateStatus === 'loading' ? 'FETCHING...' : 'FETCH & UPDATE'}
              </button>
              {r34UpdateStatus === 'ok' && (
                <div style={{ fontSize: '0.65rem', color: 'var(--green)' }}>{r34UpdateMsg}</div>
              )}
              {r34UpdateStatus === 'error' && (
                <div style={{ fontSize: '0.65rem', color: 'var(--red)' }}>{r34UpdateMsg}</div>
              )}
            </div>

            {confirmDelete === detail.id ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6,
                background: '#7f1d1d33', border: '1px solid #dc262655',
                borderRadius: 4, padding: 10 }}>
                <div style={{ fontSize: '0.68rem', color: '#fca5a5' }}>
                  Remove from library permanently?
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-danger" style={{ flex: 1 }}
                    onClick={() => deletePost(detail.id)}>
                    CONFIRM
                  </button>
                  <button className="btn-ghost" style={{ flex: 1 }}
                    onClick={() => setConfirmDelete(null)}>
                    CANCEL
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn-ghost"
                onClick={() => setConfirmDelete(detail.id)}
                style={{ width: '100%', color: 'var(--red)', borderColor: 'var(--red)',
                  fontSize: '0.72rem' }}>
                REMOVE FROM LIBRARY
              </button>
            )}
          </div>
        </div>
      )}

      {/* Auto-match candidate modal */}
      {autoMatch && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setAutoMatch(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 20, width: 640, maxHeight: '80vh',
            overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', color: 'var(--accent)' }}>
                AUTO SEARCH RESULTS
              </div>
              <button className="btn-ghost" onClick={() => setAutoMatch(null)}
                style={{ padding: '3px 10px' }}>×</button>
            </div>

            {autoMatch.loading ? (
              <div style={{ color: 'var(--muted)', fontSize: '0.75rem', textAlign: 'center', padding: 20 }}>
                Searching R34...
              </div>
            ) : (
              <>
                <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>
                  Searched with: {(autoMatch.search_tags || []).join(', ')}
                </div>
                {autoMatch.candidates.length === 0 ? (
                  <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>No results found.</div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {autoMatch.candidates.map((c, i) => (
                      <div key={c.r34_id}
                        onClick={() => applyCandidate(autoMatch.post_id, c.r34_id)}
                        style={{
                          width: 140, cursor: 'pointer',
                          background: 'var(--surface2)',
                          border: `2px solid ${i === 0 && autoMatch.confident ? 'var(--green)' : 'var(--border)'}`,
                          borderRadius: 6, overflow: 'hidden',
                          transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                        onMouseLeave={e => e.currentTarget.style.borderColor = i === 0 && autoMatch.confident ? 'var(--green)' : 'var(--border)'}
                      >
                        <div style={{ aspectRatio: '1', overflow: 'hidden', background: '#0d0d0d' }}>
                          <img src={c.preview_url} alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            onError={e => e.target.style.display = 'none'} />
                        </div>
                        <div style={{ padding: '6px 8px', fontSize: '0.63rem', color: 'var(--muted)', lineHeight: 1.7 }}>
                          <div>ID: {c.r34_id}</div>
                          <div>Score: {c.score}{c.source_match ? ' ✓ source' : ''}</div>
                          {c.img_similarity != null && <div>Sim: {(c.img_similarity * 100).toFixed(0)}%</div>}
                          <a href={`https://rule34.xxx/index.php?page=post&s=view&id=${c.r34_id}`}
                            target="_blank" rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            style={{ color: 'var(--blue)' }}>View ↗</a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}