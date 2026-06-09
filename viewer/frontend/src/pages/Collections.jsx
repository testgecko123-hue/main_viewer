import { useState, useEffect, useCallback, useRef } from 'react'
import TagSearch from '../components/TagSearch.jsx'
import useIsMobile from '../hooks/useIsMobile.js'
import { gridCols, GRID } from '../config/gridConfig.js'

const EMPTY_COL_TAGS = { needed: [], optional: [], exclude: [] }

export default function Collections({ selection, setSelection, openViewer }) {
  const isMobile = useIsMobile()
  const [mobileListOpen, setMobileListOpen] = useState(false)
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false)
  const [collections, setCols] = useState([])
  const [selections, setSels]  = useState([])
  const [active, setActive]    = useState(null)
  const [activeData, setData]  = useState(null)
  const [newName, setNewName]  = useState('')
  const [tab, setTab]          = useState('collections')
  const [postDetail, setPostDetail] = useState(null)

  const [colTagSearch, setColTagSearch] = useState(EMPTY_COL_TAGS)
  const [searchSaveStatus, setSearchSaveStatus] = useState(null)

  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewQueue, setReviewQueue] = useState([])
  const [reviewLoading, setReviewLoading] = useState(false)
  /** null = single-collection review; otherwise chain through list */
  const [multiReview, setMultiReview] = useState(null)
  const multiReviewRef = useRef(null)
  useEffect(() => { multiReviewRef.current = multiReview }, [multiReview])

  useEffect(() => {
    fetch('/api/collections').then(r => r.json()).then(setCols)
    fetch('/api/selections').then(r => r.json()).then(setSels)
  }, [])

  useEffect(() => {
    if (active?.type === 'col' && activeData) {
      setColTagSearch({
        ...EMPTY_COL_TAGS,
        optional: activeData.search_tags || [],
      })
    }
  }, [active?.id, active?.type, activeData?.id])

  async function loadActive(type, id) {
    setActive({ type, id })
    if (type === 'col') {
      const res = await fetch(`/api/collections/${id}`)
      setData(await res.json())
    } else {
      const res = await fetch(`/api/selections/${id}`)
      setData(await res.json())
    }
  }

  async function createCollection() {
    if (!newName.trim()) return
    const res = await fetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), post_ids: selection.ids }),
    })
    const data = await res.json()
    setNewName('')
    const r = await fetch('/api/collections')
    setCols(await r.json())
    loadActive('col', data.id)
  }

  async function saveCurrentSelection() {
    if (!newName.trim()) return
    const res = await fetch('/api/selections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_ids: selection.ids, name: newName.trim(), is_saved: true }),
    })
    await res.json()
    setNewName('')
    const r = await fetch('/api/selections')
    setSels(await r.json())
  }

  async function promoteSelection(selId) {
    if (!newName.trim()) return
    await fetch(`/api/selections/${selId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    })
    const [rc, rs] = await Promise.all([fetch('/api/collections'), fetch('/api/selections')])
    setCols(await rc.json()); setSels(await rs.json())
  }

  async function deleteCollection(id) {
    await fetch(`/api/collections/${id}`, { method: 'DELETE' })
    setCols(cols => cols.filter(c => c.id !== id))
    if (active?.id === id) { setActive(null); setData(null); setReviewOpen(false) }
  }

  function loadIntoViewer(postIds) {
    setSelection({ ids: postIds, index: 0, name: activeData?.name || null })
    openViewer(0)
  }

  async function removeFromCollection(postId) {
    const newIds = activeData.posts.filter(p => p.id !== postId).map(p => p.id)
    await fetch(`/api/collections/${active.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_ids: newIds }),
    })
    setData(d => ({ ...d, posts: d.posts.filter(p => p.id !== postId) }))
    setPostDetail(null)
    setCols(cols => cols.map(c => c.id === active.id ? { ...c, post_count: newIds.length } : c))
  }

  async function saveSearchTags() {
    if (active?.type !== 'col') return
    const tags = colTagSearch.optional
    setSearchSaveStatus('saving')
    try {
      await fetch(`/api/collections/${active.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search_tags: tags }),
      })
      setData(d => ({ ...d, search_tags: tags }))
      setCols(cols => cols.map(c => c.id === active.id ? { ...c, search_tags: tags } : c))
      setSearchSaveStatus('saved')
      setTimeout(() => setSearchSaveStatus(null), 1500)
    } catch {
      setSearchSaveStatus('error')
    }
  }

  const closeReview = useCallback(() => {
    setReviewOpen(false)
    setReviewQueue([])
    setMultiReview(null)
    multiReviewRef.current = null
  }, [])

  const loadCollectionIntoState = useCallback(async (colId) => {
    setActive({ type: 'col', id: colId })
    const res = await fetch(`/api/collections/${colId}`)
    const data = await res.json()
    setData(data)
    setColTagSearch({
      ...EMPTY_COL_TAGS,
      optional: data.search_tags || [],
    })
    return data
  }, [])

  /** After API returns posts for current collection, advance multi-review if empty */
  const applyReviewQueuePosts = useCallback(async (posts) => {
    const list = posts || []
    if (list.length > 0) {
      setReviewQueue(list)
      return
    }
    const mr = multiReviewRef.current
    if (!mr || mr.index >= mr.list.length - 1) {
      setReviewQueue([])
      return
    }
    const nextIdx = mr.index + 1
    const nextMr = { ...mr, index: nextIdx }
    multiReviewRef.current = nextMr
    setMultiReview(nextMr)
    const next = nextMr.list[nextIdx]
    setReviewLoading(true)
    try {
      await loadCollectionIntoState(next.id)
      setCols(await fetch('/api/collections').then(r => r.json()))
      const rq = await fetch(`/api/collections/${next.id}/review-queue?limit=80`).then(r => r.json())
      await applyReviewQueuePosts(rq.posts || [])
    } finally {
      setReviewLoading(false)
    }
  }, [loadCollectionIntoState])

  async function openReview() {
    if (active?.type !== 'col') return
    const tags = colTagSearch.optional
    if (tags.length === 0) {
      alert('Add at least one tag using the search box (same as Library), then try again.')
      return
    }
    setMultiReview(null)
    multiReviewRef.current = null
    await fetch(`/api/collections/${active.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search_tags: tags }),
    })
    setData(d => ({ ...d, search_tags: tags }))
    setCols(await fetch('/api/collections').then(r => r.json()))
    setReviewOpen(true)
    setReviewLoading(true)
    try {
      const res = await fetch(`/api/collections/${active.id}/review-queue?limit=80`)
      const data = await res.json()
      setReviewQueue(data.posts || [])
    } finally {
      setReviewLoading(false)
    }
  }

  async function openReviewAllCollections() {
    const fresh = await fetch('/api/collections').then(r => r.json())
    const withTags = fresh
      .filter(c => Array.isArray(c.search_tags) && c.search_tags.length > 0)
      .map(c => ({ id: c.id, name: c.name }))
    if (!withTags.length) {
      alert('No collections have saved search tags yet. Open each collection, add tags, click SAVE TAGS, then try again.')
      return
    }
    const plan = { list: withTags, index: 0 }
    multiReviewRef.current = plan
    setMultiReview(plan)
    setReviewOpen(true)
    setReviewLoading(true)
    try {
      const first = withTags[0]
      await loadCollectionIntoState(first.id)
      setCols(fresh)
      const rq = await fetch(`/api/collections/${first.id}/review-queue?limit=80`).then(r => r.json())
      await applyReviewQueuePosts(rq.posts || [])
    } finally {
      setReviewLoading(false)
    }
  }

  const currentReview = reviewQueue[0]

  const onReviewAdd = useCallback(async () => {
    const cur = reviewQueue[0]
    if (!cur || active?.type !== 'col') return
    await fetch(`/api/collections/${active.id}/review-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', post_id: cur.id }),
    })
    const res = await fetch(`/api/collections/${active.id}`)
    setData(await res.json())
    setCols(await fetch('/api/collections').then(r => r.json()))
    const rq = await fetch(`/api/collections/${active.id}/review-queue?limit=80`).then(r => r.json())
    await applyReviewQueuePosts(rq.posts || [])
  }, [reviewQueue, active?.id, active?.type, applyReviewQueuePosts])

  const onReviewIgnore = useCallback(async () => {
    const cur = reviewQueue[0]
    if (!cur || active?.type !== 'col') return
    await fetch(`/api/collections/${active.id}/review-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ignore', post_id: cur.id }),
    })
    const rq = await fetch(`/api/collections/${active.id}/review-queue?limit=80`).then(r => r.json())
    await applyReviewQueuePosts(rq.posts || [])
  }, [reviewQueue, active?.id, active?.type, applyReviewQueuePosts])

  const onReviewIgnoreAll = useCallback(async () => {
    if (!reviewQueue.length || active?.type !== 'col') return
    await fetch(`/api/collections/${active.id}/review-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ignore_all', stack_ids: reviewQueue.map(p => p.id) }),
    })
    await applyReviewQueuePosts([])
  }, [reviewQueue, active?.id, active?.type, applyReviewQueuePosts])

  useEffect(() => {
    if (!reviewOpen) return
    function onKey(e) {
      if (document.querySelector('[data-viewer-overlay]')) return
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      switch (e.key) {
        case 'ArrowRight': case 'd': e.preventDefault(); onReviewAdd(); break
        case 'ArrowLeft': case 'a': e.preventDefault(); onReviewIgnore(); break
        case 'ArrowDown': case 's': e.preventDefault(); onReviewIgnoreAll(); break
        case 'Escape': e.preventDefault(); closeReview(); break
        default: break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reviewOpen, onReviewAdd, onReviewIgnore, onReviewIgnoreAll, closeReview])

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: 'calc(100vh - var(--nav-h))' }}>

      <div style={{ width: isMobile ? '100%' : 280, maxHeight: isMobile ? (mobileListOpen ? '50vh' : 'auto') : 'none', flexShrink: 0,
        borderRight: isMobile ? 'none' : '1px solid var(--border)',
        borderBottom: isMobile ? '1px solid var(--border)' : 'none',
        display: 'flex', flexDirection: 'column' }}>
        {isMobile && (
          <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
            <button className="btn-surface" type="button"
              onClick={() => setMobileListOpen(v => !v)}
              style={{ width: '100%', fontSize: '0.72rem', padding: '8px 10px' }}>
              {mobileListOpen ? '▲ HIDE LISTS' : '▼ SHOW COLLECTIONS / SELECTIONS'}
            </button>
          </div>
        )}
        <div style={{ display: !isMobile || mobileListOpen ? 'flex' : 'none', flexDirection: 'column', minHeight: 0 }}>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {[['collections','COLLECTIONS'],['selections','SELECTIONS']].map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '10px', fontSize: '0.65rem', letterSpacing: '0.08em',
              background: 'transparent', border: 'none',
              borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`,
              color: tab === t ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer',
            }}>{l}</button>
          ))}
        </div>

        <div style={{ padding: 12, borderBottom: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createCollection()}
            placeholder="Name..." style={{ fontSize: '0.72rem' }} />
          {tab === 'collections' && (
            <>
              <button className="btn-accent" onClick={createCollection}
                style={{ fontSize: '0.65rem' }}>
                + NEW COLLECTION {selection.ids.length > 0 && `(${selection.ids.length} posts)`}
              </button>
              <button className="btn-surface" type="button" onClick={openReviewAllCollections}
                style={{ fontSize: '0.62rem', width: '100%' }}>
                ▶ REVIEW ALL (saved search tags)
              </button>
            </>
          )}
          {tab === 'selections' && (
            <button className="btn-surface" onClick={saveCurrentSelection}
              style={{ fontSize: '0.65rem' }}>
              SAVE CURRENT SELECTION
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {tab === 'collections' && collections.map(c => (
            <div key={c.id}
              onClick={() => loadActive('col', c.id)}
              style={{
                padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                background: active?.id === c.id ? 'var(--surface3)' : 'transparent',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                transition: 'background 0.1s',
              }}>
              <div>
                <div style={{ fontSize: '0.72rem' }}>{c.name}</div>
                <div style={{ fontSize: '0.62rem', color: 'var(--muted)', marginTop: 2 }}>
                  {c.post_count} posts
                  {(c.search_tags?.length > 0) && (
                    <span style={{ marginLeft: 6, color: '#64748b' }}>· {c.search_tags.length} search tags</span>
                  )}
                </div>
              </div>
              <span onClick={e => { e.stopPropagation(); deleteCollection(c.id) }}
                style={{ color: 'var(--muted)', cursor: 'pointer', fontSize: '0.9rem' }}>×</span>
            </div>
          ))}

          {tab === 'selections' && selections.map(s => (
            <div key={s.id}
              onClick={() => loadActive('sel', s.id)}
              style={{
                padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                background: active?.id === s.id ? 'var(--surface3)' : 'transparent',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
              <div>
                <div style={{ fontSize: '0.72rem' }}>
                  {s.name || <span style={{ color: 'var(--muted)' }}>Untitled</span>}
                  {s.is_saved ? '' : <span style={{ color: 'var(--muted)', marginLeft: 6,
                    fontSize: '0.6rem' }}>HISTORY</span>}
                </div>
                <div style={{ fontSize: '0.62rem', color: 'var(--muted)', marginTop: 2 }}>
                  {s.post_count} posts · {s.created_at?.slice(0, 10)}
                </div>
              </div>
            </div>
          ))}
        </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        {!activeData ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--muted)', fontSize: '0.75rem' }}>
            Select a collection or selection
          </div>
        ) : (
          <>
            <div style={{ padding: isMobile ? '10px 12px' : '14px 20px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem' }}>
                {activeData.name || 'Untitled'}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: '0.68rem' }}>
                {(activeData.posts || activeData.post_ids || []).length} posts
              </div>
              <div style={{ flex: 1 }} />
              {isMobile ? (
                <button className="btn-surface" type="button"
                  onClick={() => setMobileToolsOpen(v => !v)}
                  style={{ fontSize: '0.68rem', padding: '6px 10px' }}>
                  {mobileToolsOpen ? '▲ HIDE TOOLS' : '▼ SHOW TOOLS'}
                </button>
              ) : (
                <>
                  <button className="btn-accent"
                    onClick={() => loadIntoViewer(
                      active.type === 'col'
                        ? activeData.posts.map(p => p.id)
                        : activeData.post_ids
                    )}>
                    ▶ LOAD INTO VIEWER
                  </button>
                  <button className="btn-surface"
                    onClick={() => {
                      const newIds = active.type === 'col'
                        ? activeData.posts.map(p => p.id)
                        : activeData.post_ids
                      setSelection(s => ({ ...s, ids: [...new Set([...s.ids, ...newIds])] }))
                    }}>
                    + LOAD INTO SELECTION
                  </button>
                  {active.type === 'sel' && (
                    <button className="btn-surface"
                      onClick={() => promoteSelection(active.id)}>
                      → SAVE AS COLLECTION
                    </button>
                  )}
                </>
              )}
            </div>

            {isMobile && mobileToolsOpen && (
              <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)',
                display: 'flex', gap: 8, flexWrap: 'wrap', background: 'var(--surface2)' }}>
                <button className="btn-accent"
                  onClick={() => loadIntoViewer(activeData.posts.map(p => p.id))}
                  style={{ fontSize: '0.68rem', padding: '7px 10px' }}>
                  ▶ LOAD
                </button>
                <button className="btn-surface"
                  onClick={() => {
                    const newIds = activeData.posts.map(p => p.id)
                    setSelection(s => ({ ...s, ids: [...new Set([...s.ids, ...newIds])] }))
                  }}
                  style={{ fontSize: '0.68rem', padding: '7px 10px' }}>
                  + MERGE
                </button>
                {active.type === 'sel' && (
                  <button className="btn-surface"
                    onClick={() => promoteSelection(active.id)}
                    style={{ fontSize: '0.68rem', padding: '7px 10px' }}>
                    SAVE AS COL
                  </button>
                )}
              </div>
            )}

            {active.type === 'col' && (!isMobile || mobileToolsOpen) && (
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)',
                background: 'var(--surface2)' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.78rem',
                  color: 'var(--accent)', letterSpacing: '-0.01em', marginBottom: 10 }}>
                  COLLECTION LIBRARY SEARCH
                </div>
                <div style={{ display: 'flex', gap: 14, alignItems: 'stretch', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 280 }}>
                    <TagSearch
                      value={colTagSearch}
                      onChange={setColTagSearch}
                      singleMode="optional"
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button className="btn-surface" onClick={saveSearchTags}
                      style={{ fontSize: '0.68rem', whiteSpace: 'nowrap', padding: '8px 14px' }}>
                      SAVE TAGS
                    </button>
                    <button className="btn-accent" onClick={openReview}
                      style={{ fontSize: '0.68rem', whiteSpace: 'nowrap', padding: '8px 14px' }}>
                      ▶ REVIEW FROM LIBRARY
                    </button>
                    <button className="btn-surface" type="button" onClick={openReviewAllCollections}
                      style={{ fontSize: '0.62rem', whiteSpace: 'nowrap', padding: '8px 14px' }}>
                      ALL COLLECTIONS
                    </button>
                  </div>
                </div>
                {searchSaveStatus === 'saved' && (
                  <div style={{ fontSize: '0.62rem', color: 'var(--green)', marginTop: 10 }}>Saved</div>
                )}
              </div>
            )}

            <div style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', overflow: 'hidden' }}>
              <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 10 : 16 }}>
                <div style={{ display: 'grid',
                  gridTemplateColumns: isMobile
                    ? gridCols.mobile
                    : gridCols.desktop, gap: GRID.gap }}>
                  {(active.type === 'col' ? activeData.posts : []).map(p => (
                    <div key={p.id}
                      onClick={() => setPostDetail(postDetail?.id === p.id ? null : p)}
                      onMouseDown={e => {
                        if (e.button === 1) {
                          e.preventDefault()
                          setSelection(s => s.ids.includes(p.id) ? s : { ...s, ids: [...s.ids, p.id] })
                        }
                      }}
                      style={{
                        borderRadius: 4, overflow: 'hidden', background: 'var(--surface2)',
                        aspectRatio: '1', cursor: 'pointer',
                        border: `2px solid ${postDetail?.id === p.id ? 'var(--accent)' : 'transparent'}`,
                        transition: 'border-color 0.1s',
                      }}>
                      <img src={p.thumb_cdn} alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        onError={e => e.target.style.display = 'none'} />
                    </div>
                  ))}
                  {active.type === 'sel' && (
                    <div style={{ color: 'var(--muted)', fontSize: '0.7rem',
                      gridColumn: '1/-1', textAlign: 'center', padding: '20px 0' }}>
                      {activeData.post_ids.length} post IDs saved
                      <br/><span style={{ fontSize: '0.62rem' }}>Load into viewer to browse</span>
                    </div>
                  )}
                </div>
              </div>

              {postDetail && !isMobile && (
                <div style={{
                  width: isMobile ? '100%' : 240, maxHeight: isMobile ? '34vh' : 'none',
                  flexShrink: 0, borderLeft: isMobile ? 'none' : '1px solid var(--border)',
                  borderTop: isMobile ? '1px solid var(--border)' : 'none',
                  padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.06em' }}>POST DETAIL</div>
                    <button className="btn-ghost" onClick={() => setPostDetail(null)}
                      style={{ padding: '2px 8px' }}>×</button>
                  </div>

                  <div style={{ borderRadius: 4, overflow: 'hidden', background: 'var(--surface2)' }}>
                    <img src={postDetail.thumb_cdn} alt=""
                      style={{ width: '100%', display: 'block' }}
                      onError={e => e.target.style.display = 'none'} />
                  </div>

                  <div style={{ fontSize: '0.67rem', lineHeight: 2, color: 'var(--muted)' }}>
                    <div><span style={{ color: 'var(--text)' }}>ID</span> {postDetail.rule34hub_id || postDetail.id}</div>
                    <div><span style={{ color: 'var(--text)' }}>Type</span> {postDetail.media_type}</div>
                    {postDetail.source && (
                      <div><a href={postDetail.source} target="_blank" rel="noreferrer"
                        style={{ color: 'var(--blue)' }}>Source ↗</a></div>
                    )}
                  </div>

                  {postDetail.tags && postDetail.tags.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginBottom: 6,
                        letterSpacing: '0.08em' }}>TAGS</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {postDetail.tags.map(t => (
                          <span key={t} style={{
                            background: 'var(--surface3)', border: '1px solid var(--border2)',
                            borderRadius: 3, padding: '2px 7px', fontSize: '0.62rem',
                            color: 'var(--muted2)',
                          }}>{t}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button className="btn-accent"
                      onClick={() => setSelection({ ids: activeData.posts.map(p => p.id), index: 0, name: activeData.name })}
                      style={{ width: '100%', fontSize: '0.72rem' }}>▶ VIEW</button>
                    {active.type === 'col' && (
                      <button className="btn-ghost"
                        onClick={() => removeFromCollection(postDetail.id)}
                        style={{ width: '100%', fontSize: '0.72rem', color: 'var(--red)', borderColor: 'var(--red)' }}>
                        REMOVE FROM COLLECTION
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {isMobile && postDetail && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'flex-end',
        }} onClick={() => setPostDetail(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxHeight: '72vh', overflowY: 'auto',
            borderTop: '1px solid var(--border)', background: 'var(--surface)', padding: 14,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>POST DETAIL</div>
              <button className="btn-ghost" onClick={() => setPostDetail(null)} style={{ padding: '2px 8px' }}>×</button>
            </div>
            <img src={postDetail.thumb_cdn} alt="" style={{ width: '100%', borderRadius: 4 }}
              onError={e => e.target.style.display = 'none'} />
            <div style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
              ID {postDetail.rule34hub_id || postDetail.id} · {postDetail.media_type}
            </div>
            <button className="btn-accent"
              onClick={() => setSelection({ ids: activeData.posts.map(p => p.id), index: 0, name: activeData.name })}
              style={{ width: '100%', fontSize: '0.72rem' }}>▶ VIEW</button>
            {active?.type === 'col' && (
              <button className="btn-ghost"
                onClick={() => removeFromCollection(postDetail.id)}
                style={{ width: '100%', fontSize: '0.72rem', color: 'var(--red)', borderColor: 'var(--red)' }}>
                REMOVE FROM COLLECTION
              </button>
            )}
          </div>
        </div>
      )}

      {/* Full-screen collection review (subscription-style) */}
      {reviewOpen && active?.type === 'col' && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.92)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }}>
          <div style={{ width: '100%', maxWidth: 440, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {multiReview && (
                  <div style={{
                    fontSize: '0.62rem', color: '#94a3b8', letterSpacing: '0.12em', marginBottom: 6,
                  }}>
                    COLLECTION {multiReview.index + 1} / {multiReview.list.length}
                  </div>
                )}
                <div style={{
                  fontFamily: 'var(--font-display)', color: 'var(--accent)',
                  fontSize: multiReview ? '1.15rem' : '0.95rem', fontWeight: 800,
                  lineHeight: 1.25, wordBreak: 'break-word',
                }}>
                  {multiReview
                    ? (multiReview.list[multiReview.index]?.name || activeData?.name)
                    : (activeData?.name || 'Untitled')}
                </div>
                <div style={{ fontSize: '0.62rem', color: 'var(--muted)', marginTop: 6 }}>
                  Adding to this collection · matches any search tag · skips never repeat
                </div>
              </div>
              <button className="btn-ghost" onClick={closeReview} style={{ fontSize: '0.72rem', flexShrink: 0 }}>✕ CLOSE</button>
            </div>
          </div>

          {reviewLoading && reviewQueue.length === 0 ? (
            <div style={{ color: 'var(--muted)' }}>Loading queue…</div>
          ) : !currentReview ? (
            <div style={{ color: 'var(--muted)', textAlign: 'center', maxWidth: 360 }}>
              No more matching posts (or none left that aren&apos;t already in the collection or skipped before).
            </div>
          ) : (
            <div style={{ width: '100%', maxWidth: 440 }}>
              <div style={{ fontSize: '0.62rem', color: '#94a3b8', textAlign: 'center', marginBottom: 8 }}>
                {reviewQueue.length} left in stack
              </div>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
                overflow: 'hidden' }}>
                <div style={{ background: '#000', maxHeight: '65vh' }}>
                  <img
                    src={currentReview.thumb_cdn || currentReview.cdn_url || currentReview.file_url}
                    alt=""
                    style={{ width: '100%', maxHeight: '65vh', objectFit: 'contain', display: 'block' }}
                    onError={e => { e.target.style.display = 'none' }}
                  />
                </div>
                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: '0.62rem', color: 'var(--muted)' }}>
                    Post #{currentReview.id} · {currentReview.media_type || 'image'}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn-accent" style={{ flex: 1, minWidth: 120 }}
                      onClick={onReviewAdd}>
                      + ADD TO COLLECTION →
                    </button>
                    <button className="btn-surface" style={{ flex: 1, minWidth: 120 }}
                      onClick={onReviewIgnore}>
                      IGNORE ←
                    </button>
                  </div>
                  <button className="btn-ghost" style={{ width: '100%', color: '#fca5a5', borderColor: '#7f1d1d55' }}
                    onClick={onReviewIgnoreAll}>
                    IGNORE ALL REMAINING ({reviewQueue.length})
                  </button>
                  <div style={{ fontSize: '0.58rem', color: '#444', textAlign: 'center' }}>
                    → / D add · ← / A ignore · ↓ / S ignore all · Esc close
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}