import { useState, useEffect, useRef } from 'react'
import useIsMobile from '../hooks/useIsMobile.js'
import { gridCols, GRID } from '../config/gridConfig.js'
import {
  getActiveIds,
  setActiveIds,
  newSubsetId,
} from '../utils/selectionUtils.js'
import { EXTERNAL_IMG_PROPS, postThumbUrl } from '../utils/mediaUtils.js'
import { apiFetch } from '../utils/api.js'

export default function Selection({ selection, setSelection, openViewer, saveStatus }) {
  const isMobile = useIsMobile()
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false)
  const [posts, setPosts]       = useState([])
  const [loading, setLoading]   = useState(false)
  const [focused, setFocused]   = useState(null)
  const [detail, setDetail]     = useState(null)
  const [collections, setCols]  = useState([])
  const [showAddCol, setAddCol] = useState(false)
  const [newColName, setNewColName] = useState('')
  const [removeTagInput, setRemoveTagInput] = useState('')
  const [removeTagSugs, setRemoveTagSugs]   = useState([])
  const removeTagRef = useRef()
  const [newSubsetName, setNewSubsetName] = useState('')
  const [dragIdx, setDragIdx] = useState(null)
  const [dropIdx, setDropIdx] = useState(null)
  const [subselected, setSubselected] = useState(new Set())
  const gridRef = useRef()

  const activeIds = getActiveIds(selection)
  const isViewingSubset = Boolean(selection.activeSubsetId)
  const activeSubset = selection.subsets?.find(s => s.id === selection.activeSubsetId)

  useEffect(() => {
    if (!activeIds.length) { setPosts([]); return }
    setLoading(true)
    const chunks = []
    for (let i = 0; i < activeIds.length; i += 60) {
      chunks.push(activeIds.slice(i, i + 60))
    }
    Promise.all(
      chunks.map(chunk => {
        const p = new URLSearchParams()
        chunk.forEach(id => p.append('ids', id))
        return apiFetch(`/api/posts/by-ids?${p}`).then(r => r.json())
      })
    ).then(results => {
      const flat = results.flat()
      const map = Object.fromEntries(flat.map(p => [p.id, p]))
      setPosts(activeIds.map(id => map[id]).filter(Boolean))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [activeIds])

  useEffect(() => {
    apiFetch('/api/collections').then(r => r.json()).then(setCols)
  }, [])

  useEffect(() => {
    function onPointerDown(e) {
      if (!removeTagRef.current?.contains(e.target)) setRemoveTagSugs([])
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  useEffect(() => {
    if (!removeTagInput.trim()) { setRemoveTagSugs([]); return }
    apiFetch(`/api/tags/search?q=${encodeURIComponent(removeTagInput)}&limit=6`)
      .then(r => r.json()).then(setRemoveTagSugs)
  }, [removeTagInput])

  function updateActiveIds(ids) {
    setSelection(s => setActiveIds(s, ids))
  }

  function sortRandom() {
    const shuffled = [...activeIds].sort(() => Math.random() - 0.5)
    updateActiveIds(shuffled)
  }

  function reorderPosts(fromIdx, toIdx) {
    if (fromIdx === toIdx || fromIdx == null || toIdx == null) return
    const ids = [...activeIds]
    const [moved] = ids.splice(fromIdx, 1)
    ids.splice(toIdx, 0, moved)
    updateActiveIds(ids)
  }

  function createSubset() {
    const name = newSubsetName.trim()
    if (!name || !activeIds.length) return
    const subset = { id: newSubsetId(), name, ids: [...activeIds], index: 0 }
    setSelection(s => ({ ...s, subsets: [...(s.subsets || []), subset], activeSubsetId: subset.id }))
    setNewSubsetName('')
    if (isMobile) setMobileControlsOpen(false)
  }

  function createSubsetFromFocused() {
    if (!focused) return
    const name = newSubsetName.trim() || `Subset ${(selection.subsets?.length ?? 0) + 1}`
    const subset = { id: newSubsetId(), name, ids: [focused], index: 0 }
    setSelection(s => ({ ...s, subsets: [...(s.subsets || []), subset], activeSubsetId: subset.id }))
    setNewSubsetName('')
  }

  function switchToMain() {
    setSelection(s => ({ ...s, activeSubsetId: null }))
    if (isMobile) setMobileControlsOpen(false)
  }

  function switchToSubset(id) {
    setSelection(s => ({ ...s, activeSubsetId: id }))
    if (isMobile) setMobileControlsOpen(false)
  }

  function deleteSubset(id) {
    setSelection(s => ({
      ...s,
      subsets: (s.subsets || []).filter(sub => sub.id !== id),
      activeSubsetId: s.activeSubsetId === id ? null : s.activeSubsetId,
    }))
  }

  async function removeByTag(tag) {
    const res = await apiFetch(`/api/posts?needed=${encodeURIComponent(tag)}&limit=9999`)
    const data = await res.json()
    const taggedIds = new Set((data.posts || []).map(p => p.id))
    updateActiveIds(activeIds.filter(id => !taggedIds.has(id)))
    setRemoveTagInput('')
    setRemoveTagSugs([])
  }

  function removePost(postId) {
    updateActiveIds(activeIds.filter(id => id !== postId))
    setDetail(null)
  }

  function clearActive() {
    updateActiveIds([])
    setPosts([])
    setDetail(null)
  }

  async function saveAsCollection() {
    if (!newColName.trim()) return
    await apiFetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newColName.trim(), post_ids: activeIds }),
    })
    setNewColName('')
    setAddCol(false)
    const r = await apiFetch('/api/collections')
    setCols(await r.json())
  }

  async function addToExistingCollection(colId) {
    const col = await apiFetch(`/api/collections/${colId}`).then(r => r.json())
    const merged = [...new Set([...col.posts.map(p => p.id), ...activeIds])]
    await apiFetch(`/api/collections/${colId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_ids: merged }),
    })
    setDetail(null)
  }

  useEffect(() => {
    function onKey(e) {
      if (document.querySelector('[data-viewer-overlay]')) return
      if (e.target.tagName === 'INPUT') return
      if (e.key === 'Backspace' && focused) { removePost(focused); setFocused(null) }
      if (e.key === 'Enter' && focused) {
        const idx = activeIds.indexOf(focused)
        if (idx >= 0) openViewer(idx)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, activeIds, openViewer])

  if (!selection.ids.length && !activeIds.length) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: 'calc(100vh - var(--nav-h) - var(--safe-top, 0px))',
      flexDirection: 'column', gap: 12,
      color: 'var(--muted)', fontSize: '0.8rem', letterSpacing: '0.06em' }}>
      <div style={{ fontSize: '2rem' }}>∅</div>
      SELECTION IS EMPTY
      <div style={{ fontSize: '0.68rem', color: '#333', textAlign: 'center', maxWidth: 320 }}>
        Middle-click or tap any image to add posts from the library or collections.
      </div>
    </div>
  )

  // ── Controls panel (shared between desktop sidebar and mobile sheet) ──
  const controlsPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14,
      padding: isMobile ? '16px 16px 32px' : 20 }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', color: 'var(--accent)' }}>
          {isViewingSubset ? 'SUBSET' : 'SELECTION'}
        </div>
        {saveStatus === 'saving' && <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>saving…</span>}
        {saveStatus === 'saved'  && <span style={{ fontSize: '0.65rem', color: 'var(--green)' }}>✓ saved</span>}
        {saveStatus === 'error'  && <span style={{ fontSize: '0.65rem', color: 'var(--red)' }}>save failed</span>}
      </div>

      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', lineHeight: 2 }}>
        <div>
          {isViewingSubset
            ? <>{activeIds.length} in subset · {selection.ids.length} total</>
            : <>{selection.ids.length} posts</>}
        </div>
      </div>

      <button className="btn-accent" onClick={() => { openViewer(0); if (isMobile) setMobileControlsOpen(false) }}
        style={{ width: '100%', padding: '12px', fontSize: '0.9rem' }}>
        ▶ VIEW {isViewingSubset ? 'SUBSET' : 'ALL'}
      </button>

      {subselected.size > 0 && (
        <button className="btn-accent"
          onClick={() => {
            const subIds = activeIds.filter(id => subselected.has(id))
            if (subIds.length) openViewer(0, subIds)
            if (isMobile) setMobileControlsOpen(false)
          }}
          style={{ width: '100%', padding: '12px', fontSize: '0.9rem',
            background: 'rgba(34,197,94,0.2)', borderColor: 'var(--green)', color: 'var(--green)' }}>
          ▶ VIEW SUBSELECTION ({subselected.size})
        </button>
      )}

      <button className="btn-surface" onClick={sortRandom} style={{ width: '100%' }}>
        ⇄ SORT RANDOM
      </button>

      {/* Subselections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8,
        borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.08em' }}>
          SUBSELECTIONS
        </div>
        <button
          className={`btn-ghost${!isViewingSubset ? ' btn-accent' : ''}`}
          onClick={switchToMain}
          style={{ width: '100%', padding: '10px', fontSize: '0.8rem', textAlign: 'left' }}>
          Main selection ({selection.ids.length})
        </button>
        {(selection.subsets || []).map(sub => (
          <div key={sub.id} style={{ display: 'flex', gap: 6 }}>
            <button
              className={`btn-ghost${selection.activeSubsetId === sub.id ? ' btn-accent' : ''}`}
              onClick={() => switchToSubset(sub.id)}
              style={{ flex: 1, padding: '10px', fontSize: '0.8rem', textAlign: 'left',
                overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {sub.name} ({sub.ids.length})
            </button>
            <button className="btn-danger" onClick={() => deleteSubset(sub.id)}
              style={{ padding: '10px 12px', fontSize: '0.8rem' }}>✕</button>
          </div>
        ))}
        <input
          value={newSubsetName}
          onChange={e => setNewSubsetName(e.target.value)}
          placeholder="New subset name..."
        />
        <button className="btn-surface" onClick={createSubset} disabled={!activeIds.length}
          style={{ width: '100%' }}>
          SAVE CURRENT AS SUBSET
        </button>
        {focused && (
          <button className="btn-surface" onClick={createSubsetFromFocused} style={{ width: '100%' }}>
            SUBSET FROM FOCUSED POST
          </button>
        )}
      </div>

      {/* Remove by tag */}
      <div ref={removeTagRef} style={{ display: 'flex', flexDirection: 'column', gap: 8,
        borderTop: '1px solid var(--border)', paddingTop: 14, position: 'relative' }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.08em' }}>
          REMOVE ALL WITH TAG
        </div>
        <input
          value={removeTagInput}
          onChange={e => setRemoveTagInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && removeTagInput.trim()) removeByTag(removeTagInput.trim()) }}
          placeholder="Search tag..."
        />
        {removeTagSugs.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 4, overflow: 'hidden' }}>
            {removeTagSugs.map(s => (
              <div key={s.name}
                onMouseDown={() => removeByTag(s.name)}
                style={{ padding: '10px 12px', cursor: 'pointer', fontSize: '0.8rem',
                  display: 'flex', justifyContent: 'space-between' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span>{s.name}</span>
                <span style={{ color: 'var(--muted)' }}>{s.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save as collection */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8,
        borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.08em' }}>
          SAVE AS COLLECTION
        </div>
        <input value={newColName} onChange={e => setNewColName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && saveAsCollection()}
          placeholder="Collection name..." />
        <button className="btn-surface" onClick={saveAsCollection} style={{ width: '100%' }}>SAVE</button>
      </div>

      {collections.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8,
          borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.08em' }}>
            ADD ALL TO COLLECTION
          </div>
          {collections.map(c => (
            <button key={c.id} className="btn-ghost"
              onClick={() => addToExistingCollection(c.id)}
              style={{ width: '100%', padding: '10px', fontSize: '0.8rem',
                textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {c.name} <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>({c.post_count})</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button className="btn-danger" onClick={clearActive} style={{ width: '100%' }}>
          {isViewingSubset ? 'CLEAR SUBSET' : 'CLEAR SELECTION'}
        </button>
        {!isMobile && (
          <button className="btn-ghost"
            onClick={() => gridRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            style={{ width: '100%' }}>
            ↑ BACK TO TOP
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div style={{ height: 'calc(100vh - var(--nav-h) - var(--safe-top, 0px))',
      display: 'flex', flexDirection: isMobile ? 'column' : 'row',
      paddingBottom: 'var(--safe-bottom, 0px)', position: 'relative' }}>

      {/* Desktop sidebar */}
      {!isMobile && (
        <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
          {controlsPanel}
        </div>
      )}

      {/* Mobile bottom sheet */}
      {isMobile && mobileControlsOpen && (
        <>
          <div onClick={() => setMobileControlsOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40 }} />
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
            background: 'var(--surface)', borderTop: '1px solid var(--border)',
            borderRadius: '12px 12px 0 0',
            maxHeight: '85vh', overflowY: 'auto',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 16px', borderBottom: '1px solid var(--border)',
              position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1,
            }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', color: 'var(--accent)' }}>
                {isViewingSubset ? 'SUBSET' : 'SELECTION'} — {activeIds.length} posts
              </span>
              <button onClick={() => setMobileControlsOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--muted)',
                  fontSize: '1.5rem', padding: '0 4px', cursor: 'pointer' }}>×</button>
            </div>
            {controlsPanel}
          </div>
        </>
      )}

      {/* Grid */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Mobile top toolbar */}
        {isMobile && (
          <div style={{ display: 'flex', gap: 8, padding: '10px 10px 6px', flexShrink: 0, alignItems: 'center' }}>
            <button className="btn-accent" onClick={() => openViewer(0)}
              style={{ flex: 1, padding: '12px', fontSize: '0.9rem' }}>
              ▶ VIEW {isViewingSubset ? 'SUBSET' : 'ALL'} ({activeIds.length})
            </button>
            <button className="btn-surface" onClick={() => setMobileControlsOpen(true)}
              style={{ flexShrink: 0, padding: '12px 16px', fontSize: '0.85rem' }}>
              ☰
            </button>
            <button className="btn-ghost"
              onClick={() => gridRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              style={{ flexShrink: 0, padding: '12px 14px', fontSize: '0.85rem' }}>↑</button>
          </div>
        )}

        {/* Subset quick-switcher on mobile */}
        {isMobile && (selection.subsets || []).length > 0 && (
          <div style={{ display: 'flex', gap: 6, padding: '0 10px 8px', overflowX: 'auto',
            WebkitOverflowScrolling: 'touch', flexShrink: 0 }}>
            <span
              onClick={switchToMain}
              style={{
                flexShrink: 0, borderRadius: 20, padding: '6px 12px', fontSize: '0.75rem', cursor: 'pointer',
                background: !isViewingSubset ? 'var(--accent)' : 'var(--surface3)',
                color: !isViewingSubset ? '#000' : 'var(--muted2)',
                border: `1px solid ${!isViewingSubset ? 'var(--accent)' : 'var(--border2)'}`,
              }}>
              Main ({selection.ids.length})
            </span>
            {(selection.subsets || []).map(sub => (
              <span key={sub.id}
                onClick={() => switchToSubset(sub.id)}
                style={{
                  flexShrink: 0, borderRadius: 20, padding: '6px 12px', fontSize: '0.75rem', cursor: 'pointer',
                  background: selection.activeSubsetId === sub.id ? 'var(--accent)' : 'var(--surface3)',
                  color: selection.activeSubsetId === sub.id ? '#000' : 'var(--muted2)',
                  border: `1px solid ${selection.activeSubsetId === sub.id ? 'var(--accent)' : 'var(--border2)'}`,
                }}>
                {sub.name} ({sub.ids.length})
              </span>
            ))}
          </div>
        )}

        <div ref={gridRef} style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 10 : 16 }}>
          {loading && (
            <div style={{ color: 'var(--muted)', fontSize: '0.75rem', padding: 20 }}>loading...</div>
          )}
          <div style={{ display: 'grid',
            gridTemplateColumns: isMobile ? gridCols.mobile : gridCols.desktop,
            gap: GRID.gap }}>
            {posts.map((post, idx) => (
              <div
                key={post.id}
                draggable={!isMobile}
                tabIndex={0}
                onFocus={() => setFocused(post.id)}
                onBlur={() => setFocused(null)}
                onDragStart={e => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={e => { e.preventDefault(); setDropIdx(idx) }}
                onDragLeave={() => setDropIdx(null)}
                onDrop={e => { e.preventDefault(); reorderPosts(dragIdx, idx); setDragIdx(null); setDropIdx(null) }}
                onDragEnd={() => { setDragIdx(null); setDropIdx(null) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') openViewer(idx)
                  if (e.key === 'Backspace') removePost(post.id)
                }}
                onAuxClick={e => {
                  if (e.button === 1) {
                    e.preventDefault()
                    setSubselected(prev => {
                      const next = new Set(prev)
                      if (next.has(post.id)) next.delete(post.id)
                      else next.add(post.id)
                      return next
                    })
                  }
                }}
                onMouseDown={e => { if (e.button === 1) e.preventDefault() }}
                onClick={() => setDetail(detail?.id === post.id ? null : post)}
                style={{
                  position: 'relative', borderRadius: 4, overflow: 'hidden',
                  aspectRatio: '1', background: 'var(--surface2)', cursor: isMobile ? 'pointer' : 'grab',
                  border: `2px solid ${
                    subselected.has(post.id)
                      ? 'var(--green)'
                      : dropIdx === idx && dragIdx !== null && dragIdx !== idx
                        ? 'rgba(34,197,94,0.4)'
                        : focused === post.id
                          ? 'var(--accent)'
                          : detail?.id === post.id
                            ? 'var(--blue)'
                            : 'transparent'
                  }`,
                  boxShadow: subselected.has(post.id) ? '0 0 8px rgba(34,197,94,0.4)' : 'none',
                  transition: 'border-color 0.1s, opacity 0.1s',
                  outline: 'none',
                  opacity: dragIdx === idx ? 0.45 : 1,
                }}
              >
                <img src={postThumbUrl(post)} alt=""
                  {...EXTERNAL_IMG_PROPS}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
                  onError={e => e.target.style.display = 'none'} />

                {subselected.has(post.id) && (
                  <div style={{ position: 'absolute', bottom: 4, left: 4,
                    background: 'rgba(34,197,94,0.85)', borderRadius: 3,
                    padding: '2px 5px', fontSize: '0.6rem', color: '#000', fontWeight: 700 }}>✓</div>
                )}

                <div style={{ position: 'absolute', top: 4, left: 4,
                  background: 'rgba(0,0,0,0.65)', borderRadius: 3,
                  padding: '1px 5px', fontSize: '0.6rem', color: '#888' }}>{idx + 1}</div>

                {post.media_type === 'video' && (
                  <div style={{ position: 'absolute', bottom: 4, right: 4,
                    background: 'rgba(0,0,0,0.7)', borderRadius: 3,
                    padding: '2px 5px', fontSize: '0.6rem', color: '#fff' }}>▶</div>
                )}

                {/* Overlay on tap (mobile) or hover */}
                {detail?.id === post.id && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'rgba(0,0,0,0.8)',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8,
                  }}>
                    <button
                      onClick={e => { e.stopPropagation(); openViewer(idx) }}
                      style={{ width: '100%', background: 'var(--accent)', color: '#000',
                        border: 'none', borderRadius: 3, padding: '8px', fontSize: '0.82rem',
                        cursor: 'pointer', fontWeight: 700 }}>
                      ▶ VIEW
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); removePost(post.id) }}
                      style={{ width: '100%', background: 'rgba(220,38,38,0.8)', color: '#fff',
                        border: 'none', borderRadius: 3, padding: '8px', fontSize: '0.82rem',
                        cursor: 'pointer' }}>
                      ✕ REMOVE
                    </button>
                    {collections.slice(0, 3).map(c => (
                      <button key={c.id}
                        onClick={e => { e.stopPropagation(); addToExistingCollection(c.id) }}
                        style={{ width: '100%', background: 'var(--surface3)', color: 'var(--text)',
                          border: '1px solid var(--border2)', borderRadius: 3,
                          padding: '6px', fontSize: '0.75rem', cursor: 'pointer',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        + {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}