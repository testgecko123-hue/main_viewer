import { useState, useCallback, useEffect, useRef } from 'react'
import TagSearch from '../components/TagSearch.jsx'
import PostGrid from '../components/PostGrid.jsx'
import useIsMobile from '../hooks/useIsMobile.js'
import { gridCols, GRID } from '../config/gridConfig.js'
import { EXTERNAL_IMG_PROPS, postThumbUrl } from '../utils/mediaUtils.js'
import { apiFetch } from '../utils/api.js'

const LIMIT = 60
const EMPTY_SEARCH = { needed: [], optional: [], exclude: [] }

const MODES = [
  { id: 'deck_cut',      label: 'Deck Cut'      },
  { id: 'era_sampler',   label: 'Era Sampler'   },
  { id: 'date_range',    label: 'Date Range'    },
  { id: 'random_sample', label: 'Random Sample' },
  { id: 'collection',    label: 'Collection'    },
]

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function isoDateOnly(str) {
  if (!str) return ''
  return String(str).slice(0, 10)
}

function addDays(iso, days) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function dateToEnd(iso) {
  return iso ? `${iso} 23:59:59` : null
}

function FilterSelects({ mediaType, setMedia, sourceType, setSourceType }) {
  const selStyle = {
    background: '#0d0d0d', border: '1px solid var(--border)', color: 'var(--text)',
    fontFamily: 'var(--font-mono)', fontSize: '0.72rem', padding: '6px 8px', borderRadius: 4,
  }
  return (
    <>
      <select value={mediaType} onChange={e => setMedia(e.target.value)} style={selStyle}>
        <option value="">All media</option>
        <option value="image">Images only</option>
        <option value="video">Videos only</option>
      </select>
      <select value={sourceType} onChange={e => setSourceType(e.target.value)} style={selStyle}>
        <option value="">All sources</option>
        <option value="rule34">Rule34</option>
        <option value="imhentai">imhentai</option>
        <option value="manual">Manual</option>
      </select>
    </>
  )
}

function SampleGrid({ posts, removed, onRemove, onAdd, isMobile }) {
  const visible = posts.filter(p => !removed.has(p.id))
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? gridCols.mobile : gridCols.desktop,
      gap: GRID.gap, alignItems: 'start',
    }}>
      {visible.map(post => (
        <div
          key={post.id}
          style={{ position: 'relative' }}
          onMouseEnter={e => {
            if (isMobile) return
            const el = e.currentTarget.querySelector('[data-sample-overlay]')
            if (el) { el.style.opacity = 1; el.style.pointerEvents = 'auto' }
          }}
          onMouseLeave={e => {
            const el = e.currentTarget.querySelector('[data-sample-overlay]')
            if (el) { el.style.opacity = 0; el.style.pointerEvents = 'none' }
          }}
        >
          <div
            onClick={() => { if (isMobile) onAdd(post) }}
            onMouseDown={e => { if (e.button === 1) { e.preventDefault(); onAdd(post) }}}
            style={{
              borderRadius: 4, overflow: 'hidden', background: 'var(--surface2)',
              aspectRatio: '1', cursor: 'pointer',
            }}
          >
            <img src={postThumbUrl(post)} alt=""
              {...EXTERNAL_IMG_PROPS}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={e => { e.target.style.display = 'none' }} />
          </div>
          {!isMobile && (
            <div
              data-sample-overlay
              style={{
                position: 'absolute', inset: 0, opacity: 0, transition: 'opacity 0.15s',
                display: 'flex', alignItems: 'flex-end', padding: 4, gap: 4,
                background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
                pointerEvents: 'none',
              }}
            >
              <button onClick={() => onAdd(post)}
                style={{ flex: 1, background: 'var(--accent)', color: '#000',
                  border: 'none', borderRadius: 3, padding: '4px', fontSize: '0.65rem',
                  cursor: 'pointer', fontWeight: 700 }}>+</button>
              <button onClick={() => onRemove(post)}
                style={{ flex: 1, background: 'rgba(220,38,38,0.8)', color: '#fff',
                  border: 'none', borderRadius: 3, padding: '4px', fontSize: '0.65rem',
                  cursor: 'pointer' }}>✕</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function Browse({ selection, setSelection, openViewer }) {
  const isMobile = useIsMobile()
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false)
  const [mode, setMode] = useState('deck_cut')

  const [tags, setTags] = useState(EMPTY_SEARCH)
  const [mediaType, setMedia] = useState('')
  const [sourceType, setSourceType] = useState('')

  // Shared meta for filtered pool
  const [meta, setMeta] = useState(null)
  const [metaLoading, setMetaLoading] = useState(false)

  // Deck cut
  const [cutPercent, setCutPercent] = useState(50)
  const [cutOffset, setCutOffset] = useState(0)
  const [anchor, setAnchor] = useState(null)
  const [scrollPosts, setScrollPosts] = useState([])
  const [scrollTotal, setScrollTotal] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [scrollLoading, setScrollLoading] = useState(false)
  const [scrollActive, setScrollActive] = useState(false)
  const [skipNewest, setSkipNewest] = useState(0)

  // Era sampler
  const [buckets, setBuckets] = useState(10)
  const [perBucket, setPerBucket] = useState(2)
  const [samplePosts, setSamplePosts] = useState([])
  const [sampleRemoved, setSampleRemoved] = useState(new Set())
  const [sampleLoading, setSampleLoading] = useState(false)

  // Date range
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const [dateScrollActive, setDateScrollActive] = useState(false)

  // Random sample
  const [randCount, setRandCount] = useState(20)
  const [randPosts, setRandPosts] = useState([])
  const [randRemoved, setRandRemoved] = useState(new Set())
  const [randLoading, setRandLoading] = useState(false)

  // Collection
  const [collections, setCols] = useState([])
  const [colsLoading, setColsLoading] = useState(false)
  const [selectedCol, setSelectedCol] = useState('')
  const [colMediaType, setColMedia] = useState('')
  const [colMode, setColMode] = useState('sample')
  const [colCount, setColCount] = useState(20)
  const [colPosts, setColPosts] = useState([])
  const [colRemoved, setColRemoved] = useState(new Set())
  const [colLoading, setColLoading] = useState(false)
  const [colBrowseOffset, setColBrowseOffset] = useState(0)
  const [colPoolTotal, setColPoolTotal] = useState(0)
  const colPoolRef = useRef([])

  const filterKey = JSON.stringify({ tags, mediaType, sourceType })

  const buildFilterParams = useCallback((extra = {}) => {
    const p = new URLSearchParams()
    tags.needed.forEach(t => p.append('needed', t))
    tags.optional.forEach(t => p.append('optional', t))
    tags.exclude.forEach(t => p.append('exclude', t))
    if (mediaType) p.set('media_type', mediaType)
    if (sourceType) p.set('source_type', sourceType)
    Object.entries(extra).forEach(([k, v]) => { if (v != null && v !== '') p.set(k, v) })
    return p
  }, [tags, mediaType, sourceType])

  const fetchMeta = useCallback(async (anchorOff = null) => {
    setMetaLoading(true)
    try {
      const p = buildFilterParams()
      if (anchorOff != null) p.set('anchor_offset', String(anchorOff))
      const res = await apiFetch(`/api/posts/browse-meta?${p}`)
      const data = await res.json()
      setMeta(data)
      if (data.anchor) setAnchor(data.anchor)
      return data
    } catch {
      setMeta(null)
      return null
    } finally {
      setMetaLoading(false)
    }
  }, [buildFilterParams])

  useEffect(() => {
    if (mode === 'collection') return
    fetchMeta().then(data => {
      if (data?.min_created_at) setDateStart(isoDateOnly(data.min_created_at))
      if (data?.max_created_at) setDateEnd(isoDateOnly(data.max_created_at))
    })
  }, [filterKey, mode])

  useEffect(() => {
    if (mode === 'collection' && collections.length === 0 && !colsLoading) {
      setColsLoading(true)
      apiFetch('/api/collections')
        .then(r => r.json())
        .then(data => { setCols(data); setColsLoading(false) })
        .catch(() => setColsLoading(false))
    }
  }, [mode])

  function offsetFromPercent(percent, total) {
    if (!total) return 0
    return Math.min(total - 1, Math.max(0, Math.floor(total * percent / 100)))
  }

  async function previewCut(percent = cutPercent) {
    const data = meta || await fetchMeta()
    if (!data?.total) return
    let off = offsetFromPercent(percent, data.total)
    if (skipNewest > 0) {
      const maxOff = Math.max(0, data.total - 1 - skipNewest)
      off = Math.min(off, maxOff)
    }
    setCutOffset(off)
    setCutPercent(percent)
    await fetchMeta(off)
  }

  function randomCut() {
    const pct = randInt(0, 100)
    setCutPercent(pct)
    previewCut(pct)
  }

  const fetchScrollPage = useCallback(async (reset, baseOffset, order, dateExtra = {}) => {
    setScrollLoading(true)
    try {
      const off = reset ? baseOffset : scrollOffset
      if (reset) {
        setScrollPosts([])
        setScrollOffset(baseOffset)
      }
      const p = buildFilterParams({
        limit: LIMIT,
        offset: off,
        order,
        ...dateExtra,
      })
      const res = await apiFetch(`/api/posts?${p}`)
      const data = await res.json()
      const newPosts = data.posts || []
      setScrollPosts(prev => reset ? newPosts : [...prev, ...newPosts])
      setScrollTotal(data.total ?? 0)
      setScrollOffset(off + newPosts.length)
    } catch (e) {
      console.error('Browse scroll failed:', e)
    }
    setScrollLoading(false)
  }, [buildFilterParams, scrollOffset])

  function startDeckBrowse() {
    setScrollActive(true)
    fetchScrollPage(true, cutOffset, 'saved_oldest')
  }

  function startDateBrowse() {
    setDateScrollActive(true)
    const extra = {
      created_after: dateStart || undefined,
      created_before: dateToEnd(dateEnd) || undefined,
    }
    fetchScrollPage(true, 0, 'saved_oldest', extra)
  }

  function randomDateRange() {
    if (!meta?.min_created_at || !meta?.max_created_at) return
    const minD = isoDateOnly(meta.min_created_at)
    const maxD = isoDateOnly(meta.max_created_at)
    const minT = new Date(minD + 'T12:00:00').getTime()
    const maxT = new Date(maxD + 'T12:00:00').getTime()
    const span = maxT - minT
    if (span <= 0) return
    const windowDays = Math.max(7, Math.floor(span / (1000 * 86400) * 0.15))
    const startOff = randInt(0, Math.max(0, Math.floor(span / (1000 * 86400)) - windowDays))
    const start = addDays(minD, startOff)
    const end = addDays(start, windowDays)
    setDateStart(start)
    setDateEnd(end > maxD ? maxD : end)
  }

  async function runEraSample() {
    setSampleLoading(true)
    setSampleRemoved(new Set())
    try {
      const p = buildFilterParams({ buckets, per_bucket: perBucket })
      const res = await apiFetch(`/api/posts/stratified-random?${p}`)
      const data = await res.json()
      setSamplePosts(data.posts || [])
    } catch (e) {
      console.error(e)
      setSamplePosts([])
    }
    setSampleLoading(false)
  }

  async function runRandomSample() {
    setRandLoading(true)
    setRandRemoved(new Set())
    try {
      const p = buildFilterParams({ count: randCount })
      const res = await apiFetch(`/api/posts/random?${p}`)
      const data = await res.json()
      setRandPosts(data.posts || [])
    } catch (e) {
      console.error(e)
      setRandPosts([])
    }
    setRandLoading(false)
  }

  async function runCollection() {
    if (!selectedCol) return
    setColLoading(true)
    setColRemoved(new Set())
    setColBrowseOffset(0)
    try {
      const res = await apiFetch(`/api/collections/${selectedCol}`)
      const data = await res.json()
      let pool = data.posts || []
      if (colMediaType) pool = pool.filter(p => p.media_type === colMediaType)
      if (colMode === 'sample') {
        setColPosts(shuffle(pool).slice(0, colCount))
        setColPoolTotal(0)
        colPoolRef.current = []
      } else {
        colPoolRef.current = pool
        setColPoolTotal(pool.length)
        setColPosts(pool.slice(0, LIMIT))
        setColBrowseOffset(Math.min(LIMIT, pool.length))
      }
    } catch (e) {
      console.error(e)
      setColPosts([])
    }
    setColLoading(false)
  }

  function loadMoreCollection() {
    if (colMode !== 'browse' || colLoading) return
    const pool = colPoolRef.current
    if (colBrowseOffset >= pool.length) return
    const next = pool.slice(colBrowseOffset, colBrowseOffset + LIMIT)
    setColPosts(prev => [...prev, ...next])
    setColBrowseOffset(o => o + next.length)
  }

  function addToSelection(postIds) {
    const newIds = [...new Set([...selection.ids, ...postIds])]
    setSelection(s => ({ ...s, ids: newIds }))
  }

  function addOne(post) {
    if (!selection.ids.includes(post.id)) {
      setSelection(s => ({ ...s, ids: [...s.ids, post.id] }))
    }
  }

  function addAllFromList(list) {
    const ids = [...new Set([...selection.ids, ...list.map(p => p.id)])]
    setSelection(s => ({ ...s, ids }))
  }

  function viewAllFromList(list) {
    setSelection({ ids: list.map(p => p.id), index: 0, name: null })
    openViewer(0)
  }

  function onScrollAdd(post) {
    addOne(post)
  }

  const scrollHasMore = scrollActive && scrollOffset < scrollTotal
  const dateExtra = {
    created_after: dateStart || undefined,
    created_before: dateToEnd(dateEnd) || undefined,
  }

  function loadMoreScroll() {
    if (scrollLoading || scrollOffset >= scrollTotal) return
    if (dateScrollActive) {
      fetchScrollPage(false, cutOffset, 'saved_oldest', dateExtra)
    } else {
      fetchScrollPage(false, cutOffset, 'saved_oldest')
    }
  }

  const sectionLabel = { fontSize: '0.65rem', color: 'var(--muted)', letterSpacing: '0.08em' }
  const modeBtn = (active) => ({
    flex: 1, padding: '5px 4px', fontSize: '0.6rem', letterSpacing: '0.04em',
    background: active ? 'var(--accent)' : 'var(--surface3)',
    color: active ? '#000' : 'var(--muted)',
    border: 'none', cursor: 'pointer', fontWeight: active ? 700 : 400,
  })

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: 'calc(100vh - var(--nav-h))' }}>
      {/* Sidebar */}
      <div style={{
        width: isMobile ? '100%' : 280, maxHeight: isMobile ? '45vh' : 'none', flexShrink: 0,
        borderRight: isMobile ? 'none' : '1px solid var(--border)',
        borderBottom: isMobile ? '1px solid var(--border)' : 'none',
        padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {isMobile && (
          <button className="btn-surface" type="button"
            onClick={() => setMobileControlsOpen(v => !v)}
            style={{ width: '100%', fontSize: '0.72rem', padding: '8px 10px' }}>
            {mobileControlsOpen ? '▲ HIDE BROWSE CONTROLS' : '▼ SHOW BROWSE CONTROLS'}
          </button>
        )}

        <div style={{
          display: !isMobile || mobileControlsOpen ? 'flex' : 'none',
          flexDirection: 'column', gap: 12,
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', color: 'var(--accent)' }}>
            BROWSE
          </div>

          {/* Mode tabs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={sectionLabel}>MODE</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {MODES.map(m => (
                <button key={m.id}
                  onClick={() => {
                    setMode(m.id)
                    setScrollActive(false)
                    setDateScrollActive(false)
                  }}
                  style={{
                    padding: '4px 8px', fontSize: '0.62rem', letterSpacing: '0.04em',
                    background: mode === m.id ? 'var(--accent)' : 'var(--surface3)',
                    color: mode === m.id ? '#000' : 'var(--muted)',
                    border: '1px solid var(--border2)', borderRadius: 3,
                    cursor: 'pointer', fontWeight: mode === m.id ? 700 : 400,
                  }}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {mode !== 'collection' && (
            <>
              <TagSearch value={tags} onChange={setTags} />
              <FilterSelects mediaType={mediaType} setMedia={setMedia}
                sourceType={sourceType} setSourceType={setSourceType} />
              {meta && (
                <div style={{ fontSize: '0.62rem', color: 'var(--muted2)' }}>
                  {metaLoading ? '…' : `${meta.total?.toLocaleString()} posts in pool`}
                  {meta.min_created_at && (
                    <div>{isoDateOnly(meta.min_created_at)} → {isoDateOnly(meta.max_created_at)}</div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Deck Cut ── */}
          {mode === 'deck_cut' && (
            <>
              <div style={sectionLabel}>CUT POINT ({cutPercent}%)</div>
              <input type="range" min={0} max={100} value={cutPercent}
                onChange={e => {
                  const v = Number(e.target.value)
                  setCutPercent(v)
                  previewCut(v)
                }}
                style={{ width: '100%' }} />
              {anchor && (
                <div style={{ fontSize: '0.62rem', color: 'var(--muted2)' }}>
                  Anchor: post #{anchor.id} · saved {isoDateOnly(anchor.created_at)}
                  <div>Offset {cutOffset} of {meta?.total ?? '?'}</div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[0, 25, 50, 75, 100].map(p => (
                  <button key={p} onClick={() => previewCut(p)}
                    style={{ padding: '3px 8px', fontSize: '0.62rem',
                      background: cutPercent === p ? 'var(--surface3)' : 'transparent',
                      border: '1px solid var(--border2)', borderRadius: 3, color: 'var(--muted)' }}>
                    {p}%
                  </button>
                ))}
              </div>
              <div style={sectionLabel}>SKIP NEWEST N</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="number" min={0} value={skipNewest}
                  onChange={e => setSkipNewest(Math.max(0, Number(e.target.value) || 0))}
                  style={{ width: 70, padding: '4px 6px', fontSize: '0.68rem' }} />
                <button className="btn-ghost" style={{ fontSize: '0.62rem', padding: '4px 8px' }}
                  onClick={() => previewCut(cutPercent)}>Apply</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button className="btn-accent" onClick={startDeckBrowse}
                  disabled={!meta?.total || scrollLoading}>
                  ▶ BROWSE FROM CUT
                </button>
                <button className="btn-surface" onClick={randomCut} disabled={!meta?.total}>
                  🎲 RANDOM CUT
                </button>
                <button className="btn-ghost" onClick={() => { setScrollActive(false); setScrollPosts([]) }}>
                  Clear grid
                </button>
              </div>
            </>
          )}

          {/* ── Era Sampler ── */}
          {mode === 'era_sampler' && (
            <>
              <div style={sectionLabel}>BUCKETS</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {[4, 6, 8, 10, 12, 20].map(n => (
                  <button key={n} onClick={() => setBuckets(n)}
                    style={{ padding: '3px 8px', fontSize: '0.62rem',
                      background: buckets === n ? 'var(--accent)' : 'var(--surface3)',
                      color: buckets === n ? '#000' : 'var(--muted)',
                      border: '1px solid var(--border2)', borderRadius: 3 }}>
                    {n}
                  </button>
                ))}
              </div>
              <div style={sectionLabel}>PER BUCKET</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {[1, 2, 3, 5, 10].map(n => (
                  <button key={n} onClick={() => setPerBucket(n)}
                    style={{ padding: '3px 8px', fontSize: '0.62rem',
                      background: perBucket === n ? 'var(--accent)' : 'var(--surface3)',
                      color: perBucket === n ? '#000' : 'var(--muted)',
                      border: '1px solid var(--border2)', borderRadius: 3 }}>
                    {n}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '0.62rem', color: 'var(--muted2)' }}>
                Up to {buckets * perBucket} posts across timeline
              </div>
              <button className="btn-accent" onClick={runEraSample} disabled={sampleLoading || !meta?.total}>
                {sampleLoading ? '…' : '▶ SAMPLE ERAS'}
              </button>
              <button className="btn-surface" onClick={runEraSample} disabled={sampleLoading}>
                🎲 RANDOM RESAMPLE
              </button>
              {samplePosts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <button className="btn-accent"
                    onClick={() => viewAllFromList(samplePosts.filter(p => !sampleRemoved.has(p.id)))}>
                    ▶ VIEW ALL
                  </button>
                  <button className="btn-surface"
                    onClick={() => addAllFromList(samplePosts.filter(p => !sampleRemoved.has(p.id)))}>
                    + ADD ALL TO SELECTION
                  </button>
                </div>
              )}
            </>
          )}

          {/* ── Date Range ── */}
          {mode === 'date_range' && (
            <>
              <div style={sectionLabel}>START DATE</div>
              <input type="date" value={dateStart} min={isoDateOnly(meta?.min_created_at)}
                max={isoDateOnly(meta?.max_created_at)}
                onChange={e => setDateStart(e.target.value)} />
              <div style={sectionLabel}>END DATE</div>
              <input type="date" value={dateEnd} min={dateStart || isoDateOnly(meta?.min_created_at)}
                max={isoDateOnly(meta?.max_created_at)}
                onChange={e => setDateEnd(e.target.value)} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button className="btn-accent" onClick={startDateBrowse}
                  disabled={!dateStart || !dateEnd || scrollLoading}>
                  ▶ BROWSE RANGE
                </button>
                <button className="btn-surface" onClick={randomDateRange} disabled={!meta?.total}>
                  🎲 RANDOM RANGE
                </button>
                <button className="btn-ghost" onClick={() => { setDateScrollActive(false); setScrollPosts([]) }}>
                  Clear grid
                </button>
              </div>
            </>
          )}

          {/* ── Random Sample ── */}
          {mode === 'random_sample' && (
            <>
              <div style={sectionLabel}>COUNT</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[10, 20, 50, 100].map(n => (
                  <button key={n} onClick={() => setRandCount(n)}
                    style={{ padding: '4px 10px', fontSize: '0.68rem',
                      background: randCount === n ? 'var(--accent)' : 'var(--surface3)',
                      color: randCount === n ? '#000' : 'var(--muted)',
                      border: '1px solid var(--border2)', borderRadius: 3 }}>
                    {n}
                  </button>
                ))}
                <input type="number" min={1} max={200} value={randCount}
                  onChange={e => setRandCount(Number(e.target.value))}
                  style={{ width: 60, padding: '4px 6px', fontSize: '0.68rem' }} />
              </div>
              <button className="btn-accent" onClick={runRandomSample} disabled={randLoading}>
                {randLoading ? '…' : '🎲 ROLL'}
              </button>
              {randPosts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <button className="btn-accent"
                    onClick={() => viewAllFromList(randPosts.filter(p => !randRemoved.has(p.id)))}>
                    ▶ VIEW ALL
                  </button>
                  <button className="btn-surface"
                    onClick={() => addAllFromList(randPosts.filter(p => !randRemoved.has(p.id)))}>
                    + ADD ALL TO SELECTION
                  </button>
                  <button className="btn-ghost" onClick={runRandomSample}>🎲 REROLL</button>
                </div>
              )}
            </>
          )}

          {/* ── Collection ── */}
          {mode === 'collection' && (
            <>
              <div style={sectionLabel}>COLLECTION</div>
              {colsLoading ? (
                <div style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Loading…</div>
              ) : (
                <select value={selectedCol} onChange={e => setSelectedCol(e.target.value)}
                  style={{ background: '#0d0d0d', border: '1px solid var(--border)', color: 'var(--text)',
                    fontFamily: 'var(--font-mono)', fontSize: '0.72rem', padding: '6px 8px', borderRadius: 4 }}>
                  <option value="">— pick a collection —</option>
                  {collections.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.post_count != null ? ` (${c.post_count})` : ''}
                    </option>
                  ))}
                </select>
              )}
              <select value={colMediaType} onChange={e => setColMedia(e.target.value)}
                style={{ background: '#0d0d0d', border: '1px solid var(--border)', color: 'var(--text)',
                  fontFamily: 'var(--font-mono)', fontSize: '0.72rem', padding: '6px 8px', borderRadius: 4 }}>
                <option value="">All media</option>
                <option value="image">Images only</option>
                <option value="video">Videos only</option>
              </select>
              <div style={{ display: 'flex', gap: 0, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border2)' }}>
                {[['sample', 'Sample'], ['browse', 'Browse all']].map(([val, label]) => (
                  <button key={val} onClick={() => setColMode(val)} style={modeBtn(colMode === val)}>
                    {label}
                  </button>
                ))}
              </div>
              {colMode === 'sample' && (
                <>
                  <div style={sectionLabel}>SAMPLE COUNT</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[10, 20, 50, 100].map(n => (
                      <button key={n} onClick={() => setColCount(n)}
                        style={{ padding: '4px 10px', fontSize: '0.68rem',
                          background: colCount === n ? 'var(--accent)' : 'var(--surface3)',
                          color: colCount === n ? '#000' : 'var(--muted)',
                          border: '1px solid var(--border2)', borderRadius: 3 }}>
                        {n}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <button className="btn-accent" onClick={runCollection}
                disabled={colLoading || !selectedCol}>
                {colLoading ? '…' : colMode === 'sample' ? '🎲 SAMPLE' : '▶ BROWSE'}
              </button>
              {colMode === 'sample' && colPosts.length > 0 && (
                <button className="btn-surface" onClick={runCollection}>🎲 RESAMPLE</button>
              )}
              {colPosts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <button className="btn-accent"
                    onClick={() => viewAllFromList(colPosts.filter(p => !colRemoved.has(p.id)))}>
                    ▶ VIEW ALL
                  </button>
                  <button className="btn-surface"
                    onClick={() => addAllFromList(colPosts.filter(p => !colRemoved.has(p.id)))}>
                    + ADD ALL TO SELECTION
                  </button>
                </div>
              )}
            </>
          )}

          <div style={{ fontSize: '0.6rem', color: 'var(--muted)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            Middle-click or tap (mobile) to add · {selection.ids.length} in selection
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 10 : 16 }}>
        {(mode === 'deck_cut' || mode === 'date_range') && scrollActive && (
          <>
            <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginBottom: 10, letterSpacing: '0.06em' }}>
              {mode === 'deck_cut'
                ? `Browsing from cut at ${cutPercent}% (offset ${cutOffset}) · forward in time`
                : `Browsing ${dateStart} → ${dateEnd}`}
            </div>
            <PostGrid
              posts={scrollPosts}
              onPostClick={() => {}}
              onAddToSelection={onScrollAdd}
              loadMore={loadMoreScroll}
              hasMore={scrollHasMore}
              loading={scrollLoading}
            />
          </>
        )}

        {mode === 'era_sampler' && (
          samplePosts.length === 0 && !sampleLoading ? (
            <EmptyHint text="Sample eras to spread picks across the timeline" />
          ) : (
            <SampleGrid posts={samplePosts} removed={sampleRemoved}
              onRemove={p => setSampleRemoved(s => new Set([...s, p.id]))}
              onAdd={addOne} isMobile={isMobile} />
          )
        )}

        {mode === 'random_sample' && (
          randPosts.length === 0 && !randLoading ? (
            <EmptyHint text="Roll for a random sample from the filtered pool" />
          ) : (
            <SampleGrid posts={randPosts} removed={randRemoved}
              onRemove={p => setRandRemoved(s => new Set([...s, p.id]))}
              onAdd={addOne} isMobile={isMobile} />
          )
        )}

        {mode === 'collection' && (
          colPosts.length === 0 && !colLoading ? (
            <EmptyHint text={selectedCol ? 'Load collection to browse or sample' : 'Pick a collection'} />
          ) : colMode === 'browse' ? (
            <PostGrid
              posts={colPosts}
              onPostClick={() => {}}
              onAddToSelection={onScrollAdd}
              loadMore={loadMoreCollection}
              hasMore={colBrowseOffset < colPoolTotal}
              loading={colLoading}
            />
          ) : (
            <SampleGrid posts={colPosts} removed={colRemoved}
              onRemove={p => setColRemoved(s => new Set([...s, p.id]))}
              onAdd={addOne} isMobile={isMobile} />
          )
        )}

        {(mode === 'deck_cut' || mode === 'date_range') && !scrollActive && (
          <EmptyHint text={mode === 'deck_cut'
            ? 'Set a cut point and browse forward from there'
            : 'Pick dates or random range, then browse'} />
        )}
      </div>
    </div>
  )
}

function EmptyHint({ text }) {
  return (
    <div style={{ color: 'var(--muted)', textAlign: 'center', marginTop: 60,
      fontSize: '0.75rem', letterSpacing: '0.08em' }}>
      {text}
    </div>
  )
}
