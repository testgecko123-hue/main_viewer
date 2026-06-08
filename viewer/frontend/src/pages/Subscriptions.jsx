import { useState, useEffect, useCallback, useRef } from 'react'
import { gridCols, GRID } from '../config/gridConfig.js'

function loadStored(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback }
  catch { return fallback }
}
function saveStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

// ---------------------------------------------------------------------------
// Rate-limited fetch orchestration
// ---------------------------------------------------------------------------

// Fetch a single subscription tag from the backend.
// Falls back to the old bulk endpoint if the per-tag endpoint doesn't exist.
// Retries on 429 with exponential backoff.
const FETCH_CONCURRENCY   = 6    // parallel requests at most
const FETCH_DELAY_MS      = 200  // ms between each serial request (was 800)
const FETCH_MAX_RETRIES   = 4
const FETCH_BACKOFF_BASE  = 2000 // ms – doubles each retry

async function fetchTagWithBackoff(tag, signal, attempt = 0) {
  const url = `/api/subscriptions/fetch-one?tag=${encodeURIComponent(tag)}`
  let res
  try {
    res = await fetch(url, { method: 'POST', signal })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error(`Network error for "${tag}": ${err.message}`)
  }

  if (res.status === 429) {
    if (attempt >= FETCH_MAX_RETRIES) throw new Error(`429 Too Many Requests for "${tag}" after ${attempt} retries`)
    const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10)
    const delay = retryAfter > 0
      ? retryAfter * 1000
      : FETCH_BACKOFF_BASE * Math.pow(2, attempt) + Math.random() * 500
    await sleep(delay)
    return fetchTagWithBackoff(tag, signal, attempt + 1)
  }

  if (!res.ok) throw new Error(`HTTP ${res.status} for "${tag}"`)
  return res.json()
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function isVideoPost(post) {
  const mt = post?.media_type
  if (mt === 'video' || mt === 'vr') return true
  const url = (post?.file_url || '').toLowerCase().split('?')[0]
  return /\.(mp4|webm|mov|m4v)$/.test(url)
}

// Run tasks with a fixed concurrency ceiling
async function pooled(items, concurrency, fn) {
  const results = []
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx], idx)
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker)
  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------------------
// ExcludeInput
// ---------------------------------------------------------------------------
function ExcludeInput({ excluded, onChange }) {
  const [input, setInput] = useState('')
  const [sugs, setSugs]   = useState([])
  const debounce = useRef()
  useEffect(() => {
    if (!input.trim()) { setSugs([]); return }
    clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      const res = await fetch(`/api/tags/search?q=${encodeURIComponent(input)}&limit=6`)
      setSugs(await res.json())
    }, 150)
  }, [input])
  function add(tag) {
    const norm = tag.trim().toLowerCase().replace(/ /g, '_')
    if (!norm || excluded.includes(norm)) return
    onChange([...excluded, norm]); setInput(''); setSugs([])
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ position: 'relative' }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add(input)}
          placeholder="Add excluded tag..."
          style={{ fontSize: '0.72rem', borderColor: '#dc262655' }} />
        {sugs.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
            background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, marginTop: 2 }}>
            {sugs.map(s => (
              <div key={s.name} onMouseDown={() => add(s.name)}
                style={{ padding: '5px 10px', cursor: 'pointer', fontSize: '0.7rem', display: 'flex', justifyContent: 'space-between' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span>{s.name}</span><span style={{ color: 'var(--muted)' }}>{s.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {excluded.map(t => (
          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
            borderRadius: 3, padding: '2px 8px', fontSize: '0.65rem',
            background: '#7f1d1d33', border: '1px solid #dc262655', color: '#fca5a5' }}>
            {t}<span onClick={() => onChange(excluded.filter(x => x !== t))} style={{ cursor: 'pointer', opacity: 0.7 }}>x</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FeedCard
// ---------------------------------------------------------------------------
function FeedCard({ post, onAction, idField = 'rule34_post_id' }) {
  const isVideo = isVideoPost(post)
  const videoSrc = post.file_url || post.preview_url
  const displayUrl = post.preview_url || post.file_url
  const [loaded, setLoaded] = useState(false)
  const [progress, setProgress] = useState(0)
  const [imgError, setImgError] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const timer = useRef()

  useEffect(() => {
    setLoaded(false); setProgress(0); setImgError(false); setVideoError(false)
    if (isVideo) return
    clearInterval(timer.current)
    timer.current = setInterval(() => {
      setProgress(p => { if (p >= 85) { clearInterval(timer.current); return 85 } return p + Math.random() * 15 })
    }, 80)
    return () => clearInterval(timer.current)
  }, [post[idField], isVideo])

  const canPlayVideo = isVideo && videoSrc && !videoError

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', maxWidth: 420, margin: '0 auto' }}>
      {!loaded && (<div style={{ height: 3, background: 'var(--surface2)' }}><div style={{ height: '100%', background: 'var(--accent)', width: `${progress}%`, transition: 'width 0.1s' }} /></div>)}

      {canPlayVideo ? (
        <video
          key={videoSrc}
          src={videoSrc}
          poster={displayUrl || undefined}
          controls
          autoPlay={false}
          muted={false}
          playsInline
          onLoadedData={() => setLoaded(true)}
          onError={() => { setVideoError(true); setLoaded(true) }}
          onKeyDown={e => {
            // Stop propagation so video keys don't trigger the feed swipe shortcuts,
            // but do NOT preventDefault — let the browser handle play/pause/seek natively.
            if (['ArrowLeft', 'ArrowRight', 'ArrowDown', ' '].includes(e.key)) {
              e.stopPropagation()
            }
          }}
          style={{ width: '100%', maxHeight: '60vh', background: '#000', display: 'block' }}
        />
      ) : isVideo ? (
        <div style={{
          width: '100%', minHeight: '260px', background: '#000',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--muted)', fontSize: '0.72rem',
        }}>
          Video failed to load
        </div>
      ) : imgError || !displayUrl ? (
        <div style={{
          width: '100%', height: '260px',
          background: 'var(--surface2)',
          border: 'none',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 10, color: 'var(--muted)', fontSize: '0.75rem',
        }}>
          <span style={{ fontSize: '2rem' }}>'🖼'</span>
          
        </div>
      ) : (
        <img
          src={displayUrl}
          alt=""
          style={{ width: '100%', maxHeight: '60vh', objectFit: 'contain', background: '#000', display: 'block', opacity: loaded ? 1 : 0.3, transition: 'opacity 0.2s' }}
          onLoad={() => { setLoaded(true); setProgress(100); clearInterval(timer.current) }}
          onError={() => { setImgError(true); setLoaded(true) }}
        />
      )}

      <div style={{ padding: '12px 16px' }}>
        {(post.title || post.media_type) && (
          <div style={{ marginBottom: 8, fontSize: '0.68rem', color: 'var(--muted2)', lineHeight: 1.4 }}>
            {post.media_type === 'vr' && (
              <span style={{
                background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)',
                borderRadius: 3, padding: '1px 6px', fontSize: '0.58rem', color: '#93c5fd',
                marginRight: 6, textTransform: 'uppercase',
              }}>vr</span>
            )}
            {post.media_type && !['image', 'video', 'vr'].includes(post.media_type) && (
              <span style={{
                background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)',
                borderRadius: 3, padding: '1px 6px', fontSize: '0.58rem', color: '#c4b5fd',
                marginRight: 6, textTransform: 'uppercase',
              }}>{post.media_type}</span>
            )}
            {post.title}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
          {(post.matched_subs || []).map(s => (<span key={s} style={{ background: '#14532d33', border: '1px solid #22c55e55', color: '#86efac', borderRadius: 3, padding: '1px 6px', fontSize: '0.62rem' }}>{s}</span>))}
          {(post.tags || []).slice(0, 8).map(t => (
            <span key={t} style={{
              background: 'var(--surface3)',
              border: '1px solid var(--border2)',
              color: 'var(--muted)',
              borderRadius: 3, padding: '1px 6px', fontSize: '0.62rem'
            }}>{t}</span>
          ))}
          {(post.tags || []).length > 8 && (<span style={{ color: 'var(--muted)', fontSize: '0.62rem' }}>+{post.tags.length - 8}</span>)}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-accent" style={{ flex: 1 }} onClick={() => onAction(post[idField], 'saved')}>SAVE <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>{'->'}</span></button>
          <button className="btn-surface" style={{ flex: 1 }} onClick={() => onAction(post[idField], 'unsure')}>LATER <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>v</span></button>
          <button className="btn-ghost" style={{ flex: 1 }} onClick={() => onAction(post[idField], 'ignored')}>SKIP <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>{'<-'}</span></button>
        </div>
        <div style={{ fontSize: '0.6rem', color: '#333', textAlign: 'center', marginTop: 4 }}>
          ←/A skip · →/D/L save · ↓/S later · Space skip
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ManageSubs
// ---------------------------------------------------------------------------
function ManageSubs({ subs, onAdd, onRemove, onBulkAdd, onMarkSeen }) {
  const [input, setInput] = useState('')
  const [bulk, setBulk] = useState('')
  const [showBulk, setShowBulk] = useState(false)
  const [marking, setMarking] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.08em' }}>SUBSCRIBED TAGS ({subs.length})</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { onAdd(input); setInput('') } }} placeholder="tag_name..." style={{ flex: 1 }} />
          <button className="btn-accent" onClick={() => { onAdd(input); setInput('') }}>ADD</button>
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button className="btn-ghost" onClick={() => setShowBulk(v => !v)} style={{ width: '100%', textAlign: 'left', fontSize: '0.72rem' }}>{showBulk ? 'v' : '>'} BULK IMPORT</button>
        {showBulk && (<>
          <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>Paste tags comma or newline separated</div>
          <textarea value={bulk} onChange={e => setBulk(e.target.value)} rows={6} placeholder="smitty34, jackerman..." style={{ resize: 'vertical', background: '#0d0d0d', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', padding: '8px', borderRadius: 4, outline: 'none', width: '100%' }} />
          <button className="btn-accent" onClick={() => { onBulkAdd(bulk); setBulk(''); setShowBulk(false) }} style={{ width: '100%' }}>IMPORT</button>
        </>)}
      </div>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: '0.65rem', color: 'var(--muted)', lineHeight: 1.6 }}>First time setup: fetch current posts and mark them as already seen so only genuinely new posts appear in your feed.</div>
        <button className="btn-surface" onClick={async () => { setMarking(true); await onMarkSeen(); setMarking(false) }} disabled={marking} style={{ width: '100%', fontSize: '0.78rem' }}>{marking ? 'MARKING...' : 'MARK ALL CURRENT AS SEEN'}</button>
      </div>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {subs.map(s => (
          <span key={s.tag_name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--surface3)', border: '1px solid var(--border2)', borderRadius: 3, padding: '3px 8px', fontSize: '0.68rem', color: 'var(--text)' }}>
            {s.tag_name}<span onClick={() => onRemove(s.tag_name)} style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: '0.8rem' }}>x</span>
          </span>
        ))}
        {subs.length === 0 && <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>No subscriptions yet</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
function BrowseTab({ subs }) {
  const [posts, setPosts] = useState([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoad] = useState(false)
  const [selected, setSelected] = useState(() => loadStored('sub_browse_selected', []))
  const [excluded, setExcl] = useState(() => loadStored('sub_browse_excl', []))
  const [showOwned, setShowOwned] = useState(false)
  const [subSearch, setSubSearch] = useState('')
  const gridRef = useRef()
  const LIMIT = 50

  const load = useCallback(async (reset = true, _page = null, _accumulated = []) => {
    if (!subs.length) return
    setLoad(true)
    const p = new URLSearchParams()
    const queryTags = selected.length > 0 ? selected : subs.map(s => s.tag_name)
    queryTags.forEach(t => p.append('subs', t))
    excluded.forEach(t => p.append('exclude', t))
    const nextPage = _page !== null ? _page : (reset ? 0 : page)
    p.set('page', nextPage); p.set('limit', LIMIT)
    const res = await fetch(`/api/subscriptions/browse?${p}`)
    const data = await res.json()
    const newPosts = data.posts || []
    const accumulated = (_page === null && reset) ? newPosts : [..._accumulated, ...newPosts]
    const newVisible = newPosts.filter(p => !p.owned)
    if (newPosts.length >= LIMIT && newVisible.length === 0) { setPage(nextPage + 1); load(false, nextPage + 1, accumulated); return }
    setPosts(prev => (reset && _page === null) ? accumulated : [...prev, ...accumulated])
    setPage(nextPage + 1); setHasMore(newPosts.length >= LIMIT); setLoad(false)
  }, [subs, page, selected, excluded])

  useEffect(() => { if (subs.length) load(true) }, [subs.length])

  if (!subs.length) return (<div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: 60, fontSize: '0.75rem' }}>Add subscriptions to browse posts</div>)

  const filteredSubs = subs.filter(s => !subSearch || s.tag_name.toLowerCase().includes(subSearch.toLowerCase()))
  const visiblePosts = showOwned ? posts : posts.filter(p => !p.owned)

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.78rem', color: 'var(--accent)' }}>ARTISTS</div>
        <div style={{ fontSize: '0.63rem', color: 'var(--muted)' }}>Click to select - all shown if none selected</div>
        <input value={subSearch} onChange={e => setSubSearch(e.target.value)} placeholder="Filter artists..." style={{ fontSize: '0.72rem' }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 280, overflowY: 'auto', padding: '4px 0' }}>
          {filteredSubs.map(s => {
            const isSel = selected.includes(s.tag_name)
            return (<span key={s.tag_name} onClick={() => { const next = isSel ? selected.filter(t => t !== s.tag_name) : [...selected, s.tag_name]; setSelected(next); saveStored('sub_browse_selected', next) }} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 3, padding: '3px 8px', fontSize: '0.65rem', cursor: 'pointer', background: isSel ? '#1e3a5f55' : 'var(--surface3)', border: `1px solid ${isSel ? 'var(--blue)' : 'var(--border2)'}`, color: isSel ? '#93c5fd' : 'var(--muted2)', transition: 'all 0.1s' }}>{s.tag_name}</span>)
          })}
        </div>
        {selected.length > 0 && (<button className="btn-ghost" style={{ fontSize: '0.68rem', padding: '5px' }} onClick={() => { setSelected([]); saveStored('sub_browse_selected', []) }}>CLEAR SELECTION ({selected.length})</button>)}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginBottom: 6, letterSpacing: '0.08em' }}>EXCLUDE TAGS</div>
          <ExcludeInput excluded={excluded} onChange={next => { setExcl(next); saveStored('sub_browse_excl', next) }} />
        </div>
        <button className="btn-accent" onClick={() => load(true)} style={{ width: '100%', padding: '10px' }}>SEARCH</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" id="show-owned-b" checked={showOwned} onChange={e => setShowOwned(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
          <label htmlFor="show-owned-b" style={{ fontSize: '0.68rem', color: 'var(--muted)', cursor: 'pointer' }}>Show already saved</label>
        </div>
        <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: 'auto' }}>
          {visiblePosts.length} posts{posts.filter(p => p.owned).length > 0 && <span style={{ color: '#444' }}> - {posts.filter(p => p.owned).length} owned hidden</span>}
        </div>
        <button className="btn-ghost" onClick={() => gridRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} style={{ width: '100%', padding: '9px', fontSize: '0.72rem' }}>UP - BACK TO TOP</button>
      </div>
      <div ref={gridRef} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {loading && posts.length === 0 && (<div style={{ color: 'var(--muted)', fontSize: '0.7rem', padding: 20 }}>loading...</div>)}
        <div style={{ display: 'grid', gridTemplateColumns: gridCols.desktop, gap: GRID.gap, alignItems: 'start' }}>
          {visiblePosts.map(p => (
            <div key={p.rule34_post_id} style={{ borderRadius: 4, overflow: 'hidden', background: 'var(--surface2)', aspectRatio: '1', cursor: 'pointer', position: 'relative', border: p.owned ? '2px solid #22c55e33' : '2px solid transparent' }}
              onClick={() => window.open(`https://rule34.xxx/index.php?page=post&s=view&id=${p.rule34_post_id}`, '_blank')}>
              {isVideoPost(p) ? (
                <video src={p.file_url || p.preview_url} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', position: 'absolute', inset: 0 }} onError={e => { e.target.style.display = 'none' }} />
              ) : (
                <img src={p.preview_url} loading="lazy" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', position: 'absolute', inset: 0 }} onError={e => e.target.style.display = 'none'} />
              )}
              {isVideoPost(p) && (<div style={{ position: 'absolute', bottom: 4, left: 4, background: 'rgba(0,0,0,0.7)', borderRadius: 3, padding: '1px 5px', fontSize: '0.58rem', color: '#fff' }}>▶</div>)}
              {p.owned && (<div style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(34,197,94,0.8)', borderRadius: 3, padding: '1px 5px', fontSize: '0.58rem', color: '#000', fontWeight: 700 }}>saved</div>)}
            </div>
          ))}
        </div>
        {hasMore && (<div style={{ textAlign: 'center', padding: '20px 0' }}><button className="btn-surface" onClick={() => load(false)} disabled={loading}>{loading ? 'loading...' : 'Load more'}</button></div>)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Subscriptions component
// ---------------------------------------------------------------------------
export default function Subscriptions({ selection, setSelection }) {
  const [tab, setTab] = useState('feed')
  const [subs, setSubs] = useState([])
  const [feed, setFeed] = useState([])
  const [feedIdx, setFeedIdx] = useState(0)
  const [fetching, setFetch] = useState(false)
  const [feedSelected, setFeedSelected] = useState([])
  const [feedExcl, setFeedExcl] = useState(() => loadStored('sub_feed_excl', []))
  const filteredFeedRef = useRef([])
  const [fetchStatus, setFetchStatus] = useState('')
  const [fetchErrors, setFetchErrors] = useState([])
  const [progressLog, setProgressLog] = useState([])
  const fetchAbortRef = useRef(null)

  const selectedStorageKey = 'sub_feed_needed'
  const subLabel = s => s.tag_name
  const subValue = s => s.tag_name
  async function refreshSubs() {
    const endpoint = '/api/subscriptions'
    setSubs(await fetch(endpoint).then(r => r.json()))
  }

  useEffect(() => { refreshSubs() }, [])
  useEffect(() => { setFeedSelected(loadStored(selectedStorageKey, [])) }, [selectedStorageKey])
  useEffect(() => { if (tab === 'feed') loadFeed(feedSelected) }, [tab])
  useEffect(() => { if (tab === 'feed') loadFeed(feedSelected) }, [feedSelected])


  async function loadFeed(selectedTags = []) {
    setFeedIdx(0)
    if (selectedTags.length > 0) {
      const p = new URLSearchParams()
      selectedTags.forEach(t => p.append('subs', t))
      p.set('page', 0); p.set('limit', 100)
      const res  = await fetch(`/api/subscriptions/browse?${p}`)
      const data = await res.json()
      const posts = (data.posts || [])
        .filter(p => !p.owned)
        .map(p => ({
          rule34_post_id: p.rule34_post_id,
          file_url:       p.file_url,
          preview_url:    p.preview_url,
          media_type:     p.media_type,
          tags:           p.tags || [],
          matched_subs:   selectedTags,
          status:         'unseen',
        }))
      setFeed(posts)
    } else {
      const res = await fetch('/api/feed?status=unseen&limit=100')
      setFeed(await res.json())
    }
  }

  // -------------------------------------------------------------------------
  // fetchNew — tries 3 strategies in order:
  //   1. SSE streaming  (/api/subscriptions/fetch-stream)
  //   2. Per-tag with rate limiting  (/api/subscriptions/fetch-one?tag=…)
  //   3. Bulk fallback  (/api/subscriptions/fetch)
  // -------------------------------------------------------------------------
  async function fetchNew() {
    if (fetching) {
      // Cancel in-progress fetch
      fetchAbortRef.current?.abort()
      return
    }

    setFetch(true)
    setFetchStatus('Starting...')
    setFetchErrors([])
    setProgressLog([])

    const abort = new AbortController()
    fetchAbortRef.current = abort

    try {
      await rule34Fetch(abort.signal)
      await loadFeed()
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error(e)
        setFetchStatus(`Fetch failed: ${e.message || 'unknown error'}`)
      } else {
        setFetchStatus('Fetch cancelled.')
      }
    }

    fetchAbortRef.current = null
    setFetch(false)
  }


  // Rule34 fetch — tries SSE → per-tag → bulk
  async function rule34Fetch(signal) {
    // Strategy 1: SSE streaming
    const sseOk = await trySSEFetch(signal)
    if (sseOk || signal.aborted) return

    // Strategy 2: per-tag with rate limiting (requires /api/subscriptions/fetch-one)
    const perTagOk = await tryPerTagFetch(signal)
    if (perTagOk || signal.aborted) return

    // Strategy 3: legacy bulk endpoint
    await bulkFetch(signal)
  }

  // SSE strategy
  function trySSEFetch(signal) {
    return new Promise(resolve => {
      if (signal.aborted) { resolve(false); return }

      let es = null
      let confirmed = false  // true once we receive at least one event
      let settled = false
      let countdownTimer = null

      const done = (ok) => {
        if (settled) return
        settled = true
        clearInterval(countdownTimer)
        es?.close()
        resolve(ok)
      }

      // Abort support
      signal.addEventListener('abort', () => done(confirmed), { once: true })

      try {
        es = new EventSource('/api/subscriptions/fetch-stream')

        es.addEventListener('progress', e => {
          confirmed = true
          clearInterval(countdownTimer)
          try {
            const data = JSON.parse(e.data)
            setProgressLog(prev => {
              const idx = prev.findIndex(p => p.tag === data.tag)
              if (idx >= 0) { const next = [...prev]; next[idx] = data; return next }
              return [...prev, data]
            })
            if (data.skipped) {
              setFetchStatus(`[${data.index}/${data.total}] ${data.tag} — skipped (fetched recently)`)
            } else {
              setFetchStatus(`[${data.index}/${data.total}] ${data.tag} — ${data.fetched ?? 0} fetched${data.added_new ? ` (+${data.added_new} new)` : ''}`)
            }
          } catch {}
        })

        // Batch pause — show a live countdown
        es.addEventListener('pause', e => {
          confirmed = true
          try {
            const data = JSON.parse(e.data)
            let remaining = data.seconds
            clearInterval(countdownTimer)
            setFetchStatus(`Batch ${data.batch}/${data.total_batches} done — pausing ${remaining}s (rate limit)…`)
            countdownTimer = setInterval(() => {
              remaining -= 1
              if (remaining <= 0) { clearInterval(countdownTimer); return }
              setFetchStatus(`Batch ${data.batch}/${data.total_batches} done — resuming in ${remaining}s…`)
            }, 1000)
          } catch {}
        })

        es.addEventListener('done', e => {
          confirmed = true
          clearInterval(countdownTimer)
          try {
            const data = JSON.parse(e.data)
            setFetchErrors((data.errors || []).slice(0, 8))
            const skipNote = data.skipped ? ` (${data.skipped} skipped)` : ''
            setFetchStatus(`Done. ${data.new_posts ?? 0} fetched, ${data.new_unseen ?? 0} new.${skipNote}`)
          } catch {}
          done(true)
        })

        es.addEventListener('error', () => {
          done(confirmed)
        })

        // Timeout: if nothing arrives in 1.5 s, assume SSE not supported
        setTimeout(() => { if (!confirmed) done(false) }, 1500)

      } catch {
        done(false)
      }
    })
  }

  // Per-tag strategy: fetch each subscription individually with rate limiting
  async function tryPerTagFetch(signal) {
    // Probe the endpoint with a HEAD-like request to see if it exists
    try {
      const probe = await fetch('/api/subscriptions/fetch-one?tag=__probe__', {
        method: 'POST', signal,
        headers: { 'X-Probe': '1' }
      })
      // 404 means endpoint doesn't exist → fall through to bulk
      if (probe.status === 404) return false
    } catch (e) {
      if (e.name === 'AbortError') throw e
      return false
    }

    const tags = subs.map(s => s.tag_name)
    if (!tags.length) return true

    let totalNew = 0
    let totalFetched = 0
    const errors = []

    setFetchStatus(`Fetching ${tags.length} subscriptions (${FETCH_CONCURRENCY} at a time)…`)

    await pooled(tags, FETCH_CONCURRENCY, async (tag, localIdx) => {
      if (signal.aborted) return

      try {
        const data = await fetchTagWithBackoff(tag, signal)
        totalNew     += data.new_posts    ?? 0
        totalFetched += data.fetched      ?? 0

        setProgressLog(prev => {
          const entry = {
            index:     prev.length + 1,
            total:     tags.length,
            tag,
            fetched:   data.fetched   ?? 0,
            added_new: data.new_posts ?? 0,
            error:     null,
          }
          const idx = prev.findIndex(p => p.tag === tag)
          if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next }
          return [...prev, entry]
        })
        setFetchStatus(`[${localIdx + 1}/${tags.length}] ${tag} — ${data.fetched ?? 0} fetched, ${data.new_posts ?? 0} new`)
      } catch (err) {
        if (err.name === 'AbortError') throw err
        errors.push({ tag, error: err.message })
        setProgressLog(prev => {
          const entry = { index: prev.length + 1, total: tags.length, tag, fetched: 0, added_new: 0, error: err.message }
          return [...prev, entry]
        })
      }

      // Courtesy delay between requests (same worker, next iteration)
      if (!signal.aborted) await sleep(FETCH_DELAY_MS)
    })

    setFetchErrors(errors.slice(0, 8))
    setFetchStatus(`Done. ${totalFetched} fetched, ${totalNew} new posts.${errors.length ? ` ${errors.length} error(s).` : ''}`)
    return true
  }

  // Bulk fallback (original behavior)
  async function bulkFetch(signal) {
    setFetchStatus('Fetching (bulk)…')
    const res = await fetch('/api/subscriptions/fetch', { method: 'POST', signal })
    const data = await res.json()
    setProgressLog(data.progress || [])
    setFetchErrors((data.errors || []).slice(0, 8))
    setFetchStatus(`Processed ${data.new_posts || 0}, new unseen ${data.new_unseen || 0}.`)
  }

  // -------------------------------------------------------------------------

  async function handleAction(postId, action) {
    const idField = 'rule34_post_id'
    setFeed(prev => prev.filter(p => p[idField] !== postId))
    const normalizedAction = action
    const endpoint = `/api/feed/${postId}/action`
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: normalizedAction })
    }).catch(() => {})
  }

  const filteredFeed = feed.filter(post => {
    const tags = new Set(post.tags || [])
    if (feedExcl.length && feedExcl.some(t => tags.has(t))) return false
    return true
  })

  useEffect(() => {
    function onKey(e) {
      if (tab !== 'feed') return
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const post = filteredFeedRef.current[0]
      if (!post) return
      const idField = 'rule34_post_id'
      switch (e.key) {
        case 'ArrowRight': case 'd': case 'l': e.preventDefault(); handleAction(post[idField], 'saved'); break
        case 'ArrowLeft':  case 'a': case 'h': e.preventDefault(); handleAction(post[idField], 'ignored'); break
        case 'ArrowDown':  case 's': e.preventDefault(); handleAction(post[idField], 'unsure'); break
        case ' ': e.preventDefault(); handleAction(filteredFeedRef.current[0]?.[idField], 'ignored'); break
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [tab])

  async function addSub(tag) {
    if (!tag.trim()) return
    await fetch('/api/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_name: tag.trim() }) })
    await refreshSubs()
  }
  async function removeSub(value) {
    await fetch(`/api/subscriptions/${encodeURIComponent(value)}`, { method: 'DELETE' })
    setSubs(subs.filter(s => s.tag_name !== value))
  }
  async function bulkAddSubs(raw) {
    const tags = raw.split(/[,\n]/).map(t => t.trim()).filter(Boolean)
    if (!tags.length) return
    await fetch('/api/subscriptions/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags }) })
    await refreshSubs()
  }
  async function markAllSeen() {
    await fetch('/api/subscriptions/mark_seen', { method: 'POST' })
    await loadFeed()
  }

  const currentFeedPost = filteredFeed[0]
  filteredFeedRef.current = filteredFeed

  useEffect(() => {
    const next = filteredFeed[feedIdx + 1]
    if (next && !isVideoPost(next)) { const img = new Image(); img.src = next.file_url || next.preview_url }
  }, [feedIdx, filteredFeed])

  return (
    <div style={{ height: 'calc(100vh - var(--nav-h))', display: 'flex', flexDirection: 'column' }}>
      <div style={{ borderBottom: '1px solid var(--border)', padding: '0 20px', display: 'flex', alignItems: 'center', gap: 4 }}>
        {[['feed','FEED'],['browse','BROWSE'],['manage','MANAGE']].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '12px 16px', fontSize: '0.7rem', letterSpacing: '0.08em', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`, color: tab === t ? 'var(--accent)' : 'var(--muted)', borderRadius: 0, cursor: 'pointer' }}>{label}</button>
        ))}
        {progressLog.length > 0 && (
          <div style={{ fontSize: 'clamp(0.65rem, 1vw, 0.8rem)', color: 'var(--accent)', marginRight: 10, maxHeight: 60, overflowY: 'auto' }}>
            {progressLog.map((p, i) => (
              <div key={`${p.subscription || p.tag || 'progress'}-${i}`} style={{ color: p.skipped ? 'var(--muted)' : (p.error ? '#fca5a5' : 'var(--accent)') }}>
                {p.skipped ? (
                  <>[{p.index}/{p.total}] {p.tag} — ↷ skipped</>
                ) : (
                  <>[{p.index}/{p.total}] {p.tag} → {p.fetched || 0}{p.added_new ? ` +${p.added_new}` : ''}{p.error && <span style={{ color: '#fca5a5' }}> (error)</span>}</>
                )}
              </div>
            ))}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button
          className="btn-surface"
          onClick={fetchNew}
          style={{
            fontSize: '0.65rem', marginRight: 8,
            background: fetching ? '#7f1d1d22' : undefined,
            borderColor: fetching ? '#dc262655' : undefined,
            color: fetching ? '#fca5a5' : undefined,
          }}
        >
          {fetching ? '■ CANCEL' : 'FETCH NEW'}
        </button>
        <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>{subs.length} subs</span>
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'feed' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 80, overflowY: 'auto' }}>
                <span style={{ fontSize: '0.62rem', color: 'var(--muted)', alignSelf: 'center', marginRight: 4 }}>ARTISTS:</span>
                {subs.map(s => {
                  const v = subValue(s)
                  const isSel = feedSelected.includes(v)
                  return (<span key={v} onClick={() => { const next = isSel ? feedSelected.filter(t => t !== v) : [...feedSelected, v]; setFeedSelected(next); saveStored(selectedStorageKey, next) }} style={{ borderRadius: 3, padding: '2px 7px', fontSize: '0.63rem', cursor: 'pointer', background: isSel ? '#1e3a5f55' : 'var(--surface3)', border: `1px solid ${isSel ? 'var(--blue)' : 'var(--border2)'}`, color: isSel ? '#93c5fd' : 'var(--muted2)', transition: 'all 0.1s' }}>{subLabel(s)}</span>)
                })}
                {feedSelected.length > 0 && (<span onClick={() => { setFeedSelected([]); saveStored(selectedStorageKey, []) }} style={{ borderRadius: 3, padding: '2px 7px', fontSize: '0.63rem', cursor: 'pointer', color: 'var(--muted)', border: '1px solid var(--border)' }}>clear</span>)}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontSize: '0.62rem', color: 'var(--muted)', paddingTop: 6, flexShrink: 0 }}>EXCL:</span>
                <ExcludeInput excluded={feedExcl} onChange={next => { setFeedExcl(next); saveStored('sub_feed_excl', next) }} />
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px' }}>
              {fetchStatus && (
                <div style={{ marginBottom: 12, fontSize: '0.66rem', color: 'var(--muted)', textAlign: 'center' }}>
                  {fetchStatus}
                </div>
              )}
              {fetchErrors.length > 0 && (
                <div style={{ marginBottom: 12, border: '1px solid #dc262655', background: '#7f1d1d22', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: '0.66rem', color: '#fca5a5', marginBottom: 6 }}>Fetch errors</div>
                  {fetchErrors.map((e, i) => (
                    <div key={`${e.subscription || e.tag || 'sub'}-${i}`} style={{ fontSize: '0.62rem', color: '#fca5a5', marginBottom: 4 }}>
                      {e.subscription ? `@${e.subscription}: ` : (e.tag ? `${e.tag}: ` : '')}{e.error}
                    </div>
                  ))}
                </div>
              )}
              {!currentFeedPost ? (
                <div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: 60, fontSize: '0.75rem', letterSpacing: '0.08em' }}>
                  <div style={{ fontSize: '2rem', marginBottom: 12 }}>v</div>
                  {feed.length === 0 ? 'No new posts - click Fetch New' : 'All caught up!'}
                </div>
              ) : (
                <div>
                  <div style={{ textAlign: 'center', marginBottom: 16, fontSize: '0.65rem', color: 'var(--muted)' }}>
                    {filteredFeed.length} remaining
                    {(feedSelected.length > 0 || feedExcl.length > 0) && <span style={{ color: 'var(--accent)' }}> (filtered)</span>}
                  </div>
                  <FeedCard key={currentFeedPost.rule34_post_id} post={currentFeedPost} onAction={handleAction} />
                </div>
              )}
            </div>
          </div>
        )}
        {tab === 'browse' && <BrowseTab subs={subs} />}
        {tab === 'manage' && (
          <div style={{ padding: 24, overflowY: 'auto', height: '100%', width: '100%' }}>
            <ManageSubs subs={subs} onAdd={addSub} onRemove={removeSub} onBulkAdd={bulkAddSubs} onMarkSeen={markAllSeen} />
          </div>
        )}
      </div>
    </div>
  )
}