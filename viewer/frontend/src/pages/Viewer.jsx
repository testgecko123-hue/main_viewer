import { useState, useEffect, useRef, useCallback } from 'react'
import useIsMobile from '../hooks/useIsMobile.js'
import { getActiveIndex, setActiveIndex } from '../utils/selectionUtils.js'
import { EXTERNAL_IMG_PROPS, preloadImage } from '../utils/mediaUtils.js'
import { apiFetch } from '../utils/api.js'

// Ratio threshold above which an image is treated as a vertical comic strip
const COMIC_RATIO = 2.5

function fmtTime(secs) {
  if (!isFinite(secs)) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function VidBtn({ onClick, title, style, mobile, children }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
        color: '#fff', borderRadius: 4,
        padding: mobile ? '8px 14px' : '4px 10px',
        fontSize: mobile ? '0.75rem' : '0.65rem',
        cursor: 'pointer', transition: 'background 0.1s', letterSpacing: '0.03em',
        ...style,
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.22)'}
      onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
    >{children}</button>
  )
}

export default function Viewer({ selection, setSelection, viewIds, startIndex, onClose }) {
  const isMobile = useIsMobile()
  const [posts, setPosts]   = useState([])
  const [idx, setIdx]       = useState(startIndex || 0)
  const [postData, setPost] = useState(null)
  const [showInfo, setInfo] = useState(false)
  const [loading, setLoad]  = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [progress, setProgress]   = useState(0)
  const [r34Url, setR34Url]       = useState('')
  const [r34Status, setR34Status] = useState(null)
  const [r34Msg, setR34Msg]       = useState('')
  const [autoMatch, setAutoMatch] = useState(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [autoMatchMsg, setAutoMatchMsg] = useState('')
  // Comic strip scroll mode
  const [isComicStrip, setIsComicStrip] = useState(false)
  const [comicOverride, setComicOverride] = useState(null) // true/false = manual override, null = auto
  const [comicPageIdx, setComicPageIdx] = useState(0)

  // Preload-all state: null = idle, { loaded, total, done } = active/finished
  const [preloadState, setPreloadState] = useState(null)
  const preloadCancelRef = useRef(false)

  const videoRef    = useRef()
  const progressTimer = useRef()
  const comicScrollRef = useRef()
  const touchStartX = useRef(0)
  const ids = viewIds ?? selection.ids

  useEffect(() => {
    setSelection(s => (getActiveIndex(s) === idx ? s : setActiveIndex(s, idx)))
  }, [idx, setSelection])

  const closeViewer = useCallback(() => onClose(idx), [onClose, idx])

  // ── Video control bar state ───────────────────────────────────────────────
  const [vidCurrentTime, setVidCurrentTime] = useState(0)
  const [vidDuration, setVidDuration]       = useState(0)
  const [vidPaused, setVidPaused]           = useState(false)
  const [vidMuted, setVidMuted]             = useState(false)
  const [videoError, setVideoError]         = useState(false)
  const [ctrlVisible, setCtrlVisible]       = useState(true)
  const ctrlHideTimer = useRef()
  const scrubbing = useRef(false)

  function showControls() {
    setCtrlVisible(true)
    clearTimeout(ctrlHideTimer.current)
    ctrlHideTimer.current = setTimeout(() => setCtrlVisible(false), 2500)
  }

  const [cache, setCache] = useState({})

  // ── Derived: is current image in comic strip mode? ────────────────────────
  const isComic = postData?.media_type === 'comic'
  const comicPages = (() => {
    const pages = postData?.source_meta?.pages
    if (isComic) {
      // comic media_type: use stored pages array, or wrap the single file_url
      // so the carousel UI always activates for this type
      if (Array.isArray(pages) && pages.length > 0) return pages
      const url = postData?.file_url || postData?.cdn_url
      return url ? [url] : []
    }
    return Array.isArray(pages) && pages.length > 1 ? pages : []
  })()
  const comicCarouselActive = isComic || comicPages.length > 1
  const comicActive = !comicCarouselActive && (comicOverride !== null ? comicOverride : isComicStrip)
  const comicImageUrl = comicCarouselActive
    ? comicPages[comicPageIdx]
    : (postData?.file_url || postData?.cdn_url)

  // ── Load + preload adjacent posts ─────────────────────────────────────────
  useEffect(() => {
    if (!ids.length) return
    const id = ids[idx]
    if (!id) return

    setImgLoaded(false)
    setProgress(0)
    setIsComicStrip(false)
    setComicOverride(null)
    setComicPageIdx(0)
    setVidCurrentTime(0)
    setVidDuration(0)
    setVidPaused(false)
    setVideoError(false)
    // Reset comic scroll to top when switching
    if (comicScrollRef.current) comicScrollRef.current.scrollTop = 0

    if (cache[id]) {
      setPost(cache[id])
      setLoad(false)
    } else {
      setLoad(true)
      apiFetch(`/api/posts/${id}`)
        .then(r => r.json())
        .then(d => {
          setPost(d)
          setCache(prev => ({ ...prev, [id]: d }))
          setLoad(false)
        })
    }

    // Preload metadata for next + prev + next-next
    const toPreload = [ids[idx + 1], ids[idx - 1], ids[idx + 2]].filter(Boolean)
    toPreload.forEach(pid => {
      if (!cache[pid]) {
        apiFetch(`/api/posts/${pid}`)
          .then(r => r.json())
          .then(d => setCache(prev => ({ ...prev, [pid]: d })))
      }
    })
  }, [idx, ids])

   function onTouchStart(e) {
    touchStartX.current = e.touches[0].clientX
  }

  function onTouchEnd(e) {
    if (scrubbing.current) return  // scrub just finished — don't navigate
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(dx) > 50) {
      if (comicCarouselActive) {
        if (dx < 0) setComicPageIdx(i => Math.min(comicPages.length - 1, i + 1))
        else setComicPageIdx(i => Math.max(0, i - 1))
        return
      }
      if (dx < 0) go(1)
      else go(-1)
    }
  }

  // ── Detect comic strip from postData dimensions (when known up front) ─────
  useEffect(() => {
    if (!postData) { setIsComicStrip(false); return }
    if (postData.width && postData.height) {
      setIsComicStrip(postData.height / postData.width > COMIC_RATIO)
    }
  }, [postData?.id])

  // ── Progress bar animation ────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(progressTimer.current)
    if (imgLoaded || !postData) return
    setProgress(0)
    progressTimer.current = setInterval(() => {
      setProgress(p => {
        if (p >= 85) { clearInterval(progressTimer.current); return 85 }
        return p + Math.random() * 12
      })
    }, 80)
    return () => clearInterval(progressTimer.current)
  }, [postData?.id, imgLoaded])

  // ── Auto-play video + preload next image into browser cache ───────────────
  useEffect(() => {
    const v = videoRef.current
    if ((postData?.media_type === 'video' || postData?.media_type === 'vr') && v && !videoError) {
      v.muted = false
      v.play().catch(() => {
        v.muted = true
        v.play().catch(() => {})
      })
    }
    const nextId = ids[idx + 1]
    const nextPost = cache[nextId]
    if (nextPost && nextPost.media_type === 'image') {
      preloadImage(nextPost.file_url || nextPost.cdn_url)
    }
  }, [postData, idx, ids, cache])

  // ── Preload ALL media ─────────────────────────────────────────────────────
  async function preloadAll() {
    preloadCancelRef.current = false
    const total = ids.length
    setPreloadState({ loaded: 0, total, done: false })

    // Take a snapshot of current cache so we don't re-fetch what we have
    const localCache = { ...cache }
    let completedCount = 0

    const processOne = async (id) => {
      if (preloadCancelRef.current) return

      // Step 1: fetch post metadata if not cached
      let post = localCache[id]
      if (!post) {
        try {
          const res = await apiFetch(`/api/posts/${id}`)
          post = await res.json()
          localCache[id] = post
          setCache(prev => ({ ...prev, [id]: post }))
        } catch {
          completedCount++
          setPreloadState(s => s ? { ...s, loaded: completedCount } : null)
          return
        }
      }

      // Step 2: preload image bytes into browser cache
      if (!preloadCancelRef.current && (post.media_type === 'image' || post.media_type === 'comic')) {
        const pages = post.media_type === 'comic'
          ? (post.source_meta?.pages?.length ? post.source_meta.pages : [post.file_url || post.cdn_url])
          : [post.file_url || post.cdn_url]
        for (const src of pages.filter(Boolean)) {
          if (preloadCancelRef.current) break
          await new Promise(resolve => {
            const img = preloadImage(src)
            if (!img) return resolve()
            img.onload = resolve
            img.onerror = resolve
          })
        }
      }
      // Videos: metadata fetch is enough; we can't meaningfully preload video blobs

      completedCount++
      if (!preloadCancelRef.current) {
        setPreloadState(s => s
          ? { ...s, loaded: completedCount, done: completedCount >= total }
          : null
        )
      }
    }

    // Process in parallel batches of 4
    const BATCH = 4
    for (let i = 0; i < ids.length; i += BATCH) {
      if (preloadCancelRef.current) break
      await Promise.all(ids.slice(i, i + BATCH).map(processOne))
    }

    if (!preloadCancelRef.current) {
      setPreloadState(s => s ? { ...s, done: true } : null)
    }
  }

  function cancelPreload() {
    preloadCancelRef.current = true
    setPreloadState(null)
  }

  // ── R34 helpers ───────────────────────────────────────────────────────────
  async function autoSearch() {
    if (!postData) return
    setAutoMatch({ loading: true, candidates: [], search_tags: [], post_id: postData.id })
    setAutoMatchMsg('')
    try {
      const res = await apiFetch(`/api/posts/${postData.id}/auto-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_apply: false }),
      })
      const data = await res.json()
      if (!res.ok) { setAutoMatch(null); setAutoMatchMsg(data.error || 'Failed'); return }
      if (data.status === 'applied') {
        setAutoMatch(null)
        setPost(data.post)
        setCache(prev => ({ ...prev, [postData.id]: data.post }))
        setAutoMatchMsg(`Auto-applied — ${data.tags_updated} tags`)
        return
      }
      setAutoMatch({ loading: false, candidates: data.candidates, search_tags: data.search_tags, post_id: postData.id, confident: data.confident })
    } catch (e) { setAutoMatch(null); setAutoMatchMsg(e.message) }
  }

  async function applyCandidate(postId, r34Id) {
    const res = await apiFetch(`/api/posts/${postId}/auto-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apply: true, r34_id: r34Id }),
    })
    const data = await res.json()
    if (data.status === 'applied') {
      setPost(data.post)
      setCache(prev => ({ ...prev, [postId]: data.post }))
      setAutoMatch(null)
      setAutoMatchMsg(`Updated — ${data.tags_updated} tags, R34 ID ${data.r34_id}`)
    }
  }

  async function updateFromR34() {
    if (!r34Url.trim() || !postData) return
    setR34Status('loading')
    setR34Msg('')
    try {
      const res = await apiFetch(`/api/posts/${postData.id}/update-from-r34`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ r34_url: r34Url.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setR34Status('error')
        setR34Msg(data.error || 'Unknown error')
      } else {
        setR34Status('ok')
        setR34Msg(`Updated — ${data.tags_updated} tags, R34 ID ${data.r34_id}`)
        setPost(data.post)
        setCache(prev => ({ ...prev, [postData.id]: data.post }))
        setR34Url('')
      }
    } catch (e) {
      setR34Status('error')
      setR34Msg(e.message)
    }
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  const go = useCallback((dir) => {
    setIdx(i => {
      const next = i + dir
      if (next < 0) return ids.length - 1
      if (next >= ids.length) return 0
      return next
    })
  }, [ids.length])

  const seek = useCallback((secs) => {
    if (videoRef.current) videoRef.current.currentTime += secs
  }, [])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.paused ? v.play() : v.pause()
  }, [])

  const goComicPage = useCallback((dir) => {
    setComicPageIdx(i => {
      const next = i + dir
      if (next < 0) return 0
      if (next >= comicPages.length) return comicPages.length - 1
      return next
    })
  }, [comicPages.length])

  // Preload adjacent comic pages
  useEffect(() => {
    if (!comicCarouselActive) return
    setImgLoaded(false)
    setProgress(0)
    ;[comicPageIdx + 1, comicPageIdx - 1].forEach(pi => {
      if (pi >= 0 && pi < comicPages.length) preloadImage(comicPages[pi])
    })
  }, [comicCarouselActive, comicPageIdx, comicPages])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      switch (e.key) {
        case 'ArrowRight': case 'd': go(1);          break
        case 'ArrowLeft':  case 'a': go(-1);         break
        case ' ':          e.preventDefault(); togglePlay(); break
        case 'ArrowUp':    seek(5);             break
        case 'ArrowDown':  seek(-5);            break
        case 'l':
          if (comicCarouselActive) goComicPage(1)
          else seek(1)
          break
        case 'j':
          if (comicCarouselActive) goComicPage(-1)
          else seek(-1)
          break
        case 'i':          setInfo(v => !v);   break
        case 'Escape':     closeViewer();           break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, togglePlay, seek, closeViewer, comicCarouselActive, goComicPage])

  if (!ids.length) return (
    <div style={overlay}>
      <div style={{ color: 'var(--muted)', textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: 12 }}>∅</div>
        No posts in selection
        <br/><br/>
        <button className="btn-ghost" onClick={closeViewer}>Close</button>
      </div>
    </div>
  )

  const isVideo = (postData?.media_type === 'video' || postData?.media_type === 'vr') && !isComic
  const isVr = postData?.media_type === 'vr'
  const videoSrc = postData?.file_url || postData?.cdn_url
  const canPlayVideo = isVideo && videoSrc && !videoError

  // Preload bar colours
  const preloadPct = preloadState
    ? Math.round((preloadState.loaded / preloadState.total) * 100)
    : 0

  return (
    <div
      data-viewer-overlay
      style={overlay}
      onTouchStart={e => { onTouchStart(e); if (isVideo) showControls() }}
      onTouchEnd={onTouchEnd}
      onClick={e => { if (e.target === e.currentTarget) setInfo(v => !v) }}
      onMouseMove={isVideo ? showControls : undefined}
    >

      {/* ── Progress bar (image load) ── */}
      {!imgLoaded && postData?.media_type === 'image' && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, zIndex: 200 }}>
          <div style={{ height: '100%', background: 'var(--accent)',
            width: `${progress}%`, transition: 'width 0.1s',
            boxShadow: '0 0 8px var(--accent)' }} />
        </div>
      )}

      {/* ── Preload-all progress bar ── */}
      {preloadState && !preloadState.done && (
        <div style={{ position: 'absolute', top: preloadState ? 3 : 0,
          left: 0, right: 0, height: 3, zIndex: 201 }}>
          <div style={{ height: '100%', background: 'var(--blue)',
            width: `${preloadPct}%`, transition: 'width 0.2s',
            boxShadow: '0 0 6px var(--blue)' }} />
        </div>
      )}

      {/* ── Media area (pointer-events pass through; media elements re-enable) ── */}
      <div style={{
        width: '100%', height: '100%', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        position: 'absolute', inset: 0, zIndex: 1,
        pointerEvents: 'none',
      }}>

        {loading && (
          <div style={{ position: 'absolute', color: 'var(--muted)', fontSize: '0.7rem' }}>
            loading...
          </div>
        )}

        {/* Preview thumbnail while full image loads */}
        {postData && !isVideo && !comicActive && !imgLoaded && (postData.thumb_cdn || postData.cdn_url) && (
          <img
            src={postData.thumb_cdn || postData.cdn_url}
            alt=""
            {...EXTERNAL_IMG_PROPS}
            style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              maxHeight: isMobile ? '100vh' : '100%',
              display: 'block',
              userSelect: 'none',
              pointerEvents: 'auto',
            }}
          />
        )}

        {/* Normal image or comic carousel page */}
        {postData && !isVideo && !comicActive && (
          <img
            key={comicCarouselActive ? `${postData.id}-${comicPageIdx}` : postData.id}
            src={comicImageUrl}
            alt=""
            {...EXTERNAL_IMG_PROPS}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              maxHeight: isMobile ? '100vh' : '100%',
              display: 'block',
              userSelect: 'none',
              opacity: imgLoaded ? 1 : 0,
              transition: 'opacity 0.2s',
              pointerEvents: 'auto',
            }}
            onLoad={e => {
              setImgLoaded(true)
              setProgress(100)
              const { naturalWidth: nw, naturalHeight: nh } = e.target
              if (nw && nh && !(postData.width && postData.height)) {
                setIsComicStrip(nh / nw > COMIC_RATIO)
              }
            }}
            onError={e => {
              e.target.src = postData.cdn_url || postData.thumb_cdn
              setImgLoaded(true)
            }}
          />
        )}

        {/* Comic strip image — 1/3 page width, scrollable vertically */}
        {postData && !isVideo && comicActive && (
          <div
            ref={comicScrollRef}
            style={{
              width: isMobile ? '100%' : '33.333%',
              height: '100%',
              overflowY: 'auto',
              overflowX: 'hidden',
              flexShrink: 0,
              pointerEvents: 'auto',
              scrollbarWidth: 'thin',
              scrollbarColor: 'var(--border2) transparent',
            }}
          >
            {!imgLoaded && (postData.thumb_cdn || postData.cdn_url) && (
              <img
                src={postData.thumb_cdn || postData.cdn_url}
                alt=""
                {...EXTERNAL_IMG_PROPS}
                style={{
                  width: '100%',
                  height: 'auto',
                  display: 'block',
                  userSelect: 'none',
                }}
              />
            )}
            <img
              key={postData.id}
              src={postData.file_url || postData.cdn_url}
              alt=""
              {...EXTERNAL_IMG_PROPS}
              style={{
                width: '100%',
                height: 'auto',
                display: 'block',
                userSelect: 'none',
                opacity: imgLoaded ? 1 : 0,
                transition: 'opacity 0.2s',
              }}
              onLoad={e => {
                setImgLoaded(true)
                setProgress(100)
                const { naturalWidth: nw, naturalHeight: nh } = e.target
                if (nw && nh && !(postData.width && postData.height)) {
                  // If we auto-detected non-comic, allow override to revert
                  if (nh / nw <= COMIC_RATIO && comicOverride === null) {
                    setIsComicStrip(false)
                  }
                }
              }}
              onError={e => {
                e.target.src = postData.cdn_url || postData.thumb_cdn
                setImgLoaded(true)
              }}
            />
          </div>
        )}

        {postData && canPlayVideo && (
          <video
            key={`${postData.id}-${videoSrc}`}
            ref={videoRef}
            src={videoSrc}
            loop
            autoPlay
            playsInline
            style={{
              width: isVr ? '100%' : '100%',
              height: '100%',
              objectFit: 'contain',
              outline: 'none',
              maxHeight: isMobile ? '100vh' : '100%',
              pointerEvents: 'auto',
            }}
            onLoadedData={() => {
              setImgLoaded(true)
              setVidDuration(videoRef.current?.duration || 0)
              showControls()
            }}
            onTimeUpdate={() => {
              if (!scrubbing.current && videoRef.current)
                setVidCurrentTime(videoRef.current.currentTime)
            }}
            onPlay={() => setVidPaused(false)}
            onPause={() => setVidPaused(true)}
            onVolumeChange={() => setVidMuted(videoRef.current?.muted ?? false)}
            onClick={e => { e.stopPropagation(); togglePlay(); showControls() }}
            onError={() => {
              setVideoError(true)
              setImgLoaded(true)
              console.error('Video error:', videoRef.current?.error)
            }}
          />
        )}
      </div>

      {/* ── Top bar ── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50,
        padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.75), transparent)',
      }}>
        <span style={{ fontFamily: 'var(--font-display)', color: 'var(--accent)',
          fontSize: '0.85rem', fontWeight: 800 }}>VIEWER</span>
        <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>
          {idx + 1} / {ids.length}
        </span>

        {postData?.media_type === 'video' && (
          <span style={{ background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 3, padding: '1px 6px', fontSize: '0.62rem', color: 'var(--muted)' }}>
            VIDEO
          </span>
        )}
        {isVr && (
          <span style={{ background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.5)',
            borderRadius: 3, padding: '1px 6px', fontSize: '0.62rem', color: '#93c5fd' }}>
            VR
          </span>
        )}

        {/* Comic strip badge */}
        {comicCarouselActive && (
          <span style={{ background: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.5)',
            borderRadius: 3, padding: '1px 6px', fontSize: '0.62rem', color: '#c4b5fd' }}>
            {isComic ? '📖' : '🖼'} {comicPageIdx + 1}/{comicPages.length}
          </span>
        )}
        {comicActive && (
          <span style={{ background: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.5)',
            borderRadius: 3, padding: '1px 6px', fontSize: '0.62rem', color: '#c4b5fd' }}>
            📜 SCROLL
          </span>
        )}

        {/* Preload status badge */}
        {preloadState?.done && (
          <span style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)',
            borderRadius: 3, padding: '1px 6px', fontSize: '0.62rem', color: 'var(--green)' }}>
            ✓ ALL LOADED
          </span>
        )}
        {preloadState && !preloadState.done && (
          <span style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)',
            borderRadius: 3, padding: '1px 6px', fontSize: '0.62rem', color: '#93c5fd' }}>
            ⬇ {preloadState.loaded}/{preloadState.total}
          </span>
        )}

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>

          {isMobile ? (
            <button
              className="btn-ghost"
              onClick={() => setMobileMenuOpen(v => !v)}
              style={{ padding: '6px 12px', fontSize: '0.7rem' }}
            >
              ☰ OPTIONS
            </button>
          ) : (
            <>

          {/* Comic strip toggle — only for non-comic images */}
          {postData && !isVideo && !isComic && (
            <button
              className="btn-ghost"
              title={comicActive ? 'Switch to normal view' : 'Switch to comic strip scroll mode'}
              onClick={() => setComicOverride(v => v === null ? !isComicStrip : !v)}
              style={{
                padding: '4px 10px', fontSize: '0.65rem',
                color: comicActive ? '#c4b5fd' : undefined,
                borderColor: comicActive ? 'rgba(139,92,246,0.5)' : undefined,
              }}>
              📜 {comicActive ? 'NORMAL' : 'SCROLL'}
            </button>
          )}
          {/* Preload all button */}
          {!preloadState && (
            <button className="btn-ghost"
              onClick={preloadAll}
              style={{ padding: '4px 10px', fontSize: '0.65rem' }}>
              ⬇ PRELOAD ALL
            </button>
          )}
          {preloadState && !preloadState.done && (
            <button className="btn-ghost"
              onClick={cancelPreload}
              style={{ padding: '4px 10px', fontSize: '0.65rem', color: 'var(--red)' }}>
              ✕ CANCEL
            </button>
          )}

          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: '0.65rem' }}
            onClick={() => setInfo(v => !v)}>
            {showInfo ? 'HIDE INFO' : 'INFO'}
          </button>
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: '0.65rem' }}
            onClick={closeViewer}>
            ✕ CLOSE
          </button>
          </>
        )}
        </div>
      </div> 
      

      {/* ── Prev / Next arrows ── */}
      <button onClick={() => go(-1)} style={{
        position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
        background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)',
        fontSize: '2rem', padding: '20px 16px', cursor: 'pointer',
        transition: 'color 0.15s', zIndex: 50,
      }}
        onMouseEnter={e => e.target.style.color = 'rgba(255,255,255,0.9)'}
        onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.3)'}
      >‹</button>
      <button onClick={() => go(1)} style={{
        position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
        background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)',
        fontSize: '2rem', padding: '20px 16px', cursor: 'pointer',
        transition: 'color 0.15s', zIndex: 50,
      }}
        onMouseEnter={e => e.target.style.color = 'rgba(255,255,255,0.9)'}
        onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.3)'}
      >›</button>

      {/* ── Video control bar ── */}
      {isVideo && imgLoaded && (
        <div
          onMouseEnter={showControls}
          onTouchStart={showControls}
          style={{
            position: 'absolute', bottom: showInfo ? 'calc(35vh + 1px)' : 0,
            left: 0, right: 0, zIndex: 60,
            background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%)',
            padding: isMobile ? '32px 16px 18px' : '28px 20px 14px',
            display: 'flex', flexDirection: 'column', gap: isMobile ? 10 : 8,
            opacity: (isMobile ? vidPaused : ctrlVisible) ? 1 : 0,
            transition: 'opacity 0.3s, bottom 0.15s',
            pointerEvents: (isMobile ? vidPaused : ctrlVisible) ? 'all' : 'none',
            userSelect: 'none',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Scrub bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.7)',
              fontVariantNumeric: 'tabular-nums', minWidth: 38, textAlign: 'right' }}>
              {fmtTime(vidCurrentTime)}
            </span>
            <div
              style={{
                flex: 1, height: isMobile ? 6 : 4,
                background: 'rgba(255,255,255,0.2)',
                borderRadius: 3, position: 'relative', cursor: 'pointer',
                // Expand touch target vertically without changing visual height
                padding: isMobile ? '10px 0' : '4px 0',
                margin: isMobile ? '-10px 0' : '-4px 0',
                boxSizing: 'content-box',
              }}
              onMouseDown={e => {
                e.preventDefault()
                scrubbing.current = true
                const trackEl = e.currentTarget
                const rect = trackEl.getBoundingClientRect()
                const seek = (clientX) => {
                  const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
                  const t = p * vidDuration
                  setVidCurrentTime(t)
                  if (videoRef.current) videoRef.current.currentTime = t
                }
                seek(e.clientX)
                const onMove = ev => { ev.preventDefault(); seek(ev.clientX) }
                const onUp = () => {
                  scrubbing.current = false
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
              onTouchStart={e => {
                e.stopPropagation() // don't fire swipe navigation
                scrubbing.current = true
                const trackEl = e.currentTarget
                const rect = trackEl.getBoundingClientRect()
                const seekTouch = (touch) => {
                  const p = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width))
                  const t = p * vidDuration
                  setVidCurrentTime(t)
                  if (videoRef.current) videoRef.current.currentTime = t
                }
                seekTouch(e.touches[0])
                const onMove = ev => { ev.preventDefault(); seekTouch(ev.touches[0]) }
                const onEnd = () => {
                  // Delay clearing so the overlay's onTouchEnd fires first and sees scrubbing=true
                  setTimeout(() => { scrubbing.current = false }, 50)
                  window.removeEventListener('touchmove', onMove)
                  window.removeEventListener('touchend', onEnd)
                }
                window.addEventListener('touchmove', onMove, { passive: false })
                window.addEventListener('touchend', onEnd)
              }}
            >
              {/* Track fill */}
              <div style={{
                height: isMobile ? 6 : 4, borderRadius: 3,
                background: 'var(--accent)',
                width: vidDuration ? `${(vidCurrentTime / vidDuration) * 100}%` : '0%',
                pointerEvents: 'none',
              }} />
              {/* Scrub handle */}
              <div style={{
                position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
                left: vidDuration ? `${(vidCurrentTime / vidDuration) * 100}%` : '0%',
                width: isMobile ? 18 : 12, height: isMobile ? 18 : 12, borderRadius: '50%',
                background: '#fff', pointerEvents: 'none',
                boxShadow: '0 0 4px rgba(0,0,0,0.6)',
              }} />
            </div>
            <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.5)',
              fontVariantNumeric: 'tabular-nums', minWidth: 38 }}>
              {fmtTime(vidDuration)}
            </span>
          </div>

          {/* Buttons row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 6 }}>
            <VidBtn title="Skip back 5s" mobile={isMobile} onClick={() => { seek(-5); showControls() }}>⏮ 5s</VidBtn>
            <VidBtn title="Skip back 1s" mobile={isMobile} onClick={() => { seek(-1); showControls() }}>‹1s</VidBtn>
            <VidBtn title="Play / Pause" mobile={isMobile}
              onClick={() => { togglePlay(); showControls() }}
              style={{ minWidth: isMobile ? 72 : 52, fontWeight: 700 }}>
              {vidPaused ? '▶ PLAY' : '⏸ PAUSE'}
            </VidBtn>
            <VidBtn title="Skip forward 1s" mobile={isMobile} onClick={() => { seek(1); showControls() }}>1s›</VidBtn>
            <VidBtn title="Skip forward 5s" mobile={isMobile} onClick={() => { seek(5); showControls() }}>5s ⏭</VidBtn>
            <div style={{ flex: 1 }} />
            <VidBtn title="Mute / Unmute" mobile={isMobile} onClick={() => {
              if (videoRef.current) {
                videoRef.current.muted = !videoRef.current.muted
                setVidMuted(videoRef.current.muted)
              }
            }}>{vidMuted ? '🔇' : '🔊'}</VidBtn>
          </div>
        </div>
      )}

      {/* ── Bottom info panel ── */}
      {showInfo && postData && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'rgba(10,10,10,0.95)', borderTop: '1px solid var(--border)',
          padding: '16px 20px', maxHeight: '35vh', overflowY: 'auto', zIndex: 55,
        }}>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ fontSize: '0.68rem', lineHeight: 2, color: 'var(--muted)' }}>
              <div><span style={{ color: 'var(--text)' }}>ID </span>{postData.rule34hub_id || postData.id}</div>
              <div><span style={{ color: 'var(--text)' }}>Type </span>{postData.media_type}</div>
              {postData.width && <div><span style={{ color: 'var(--text)' }}>Size </span>{postData.width}×{postData.height}
                {postData.width && postData.height && postData.height / postData.width > COMIC_RATIO &&
                  <span style={{ marginLeft: 6, color: '#c4b5fd', fontSize: '0.6rem' }}>📜 tall</span>
                }
              </div>}
              {postData.source && <div><a href={postData.source} target="_blank" rel="noreferrer">Source ↗</a></div>}
            </div>
          </div>
          {postData.tags?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {postData.tags.map(t => (
                <span key={t} style={{
                  background: 'var(--surface3)', border: '1px solid var(--border2)',
                  borderRadius: 3, padding: '2px 7px', fontSize: '0.63rem', color: 'var(--muted2)',
                }}>{t}</span>
              ))}
            </div>
          )}

          {/* Update from R34 */}
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6,
            borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.08em' }}>
              UPDATE FROM R34
            </div>
            <button className="btn-surface"
              onClick={e => { e.stopPropagation(); autoSearch() }}
              style={{ fontSize: '0.7rem', padding: '7px 12px' }}>
              ⟳ AUTO SEARCH
            </button>
            {autoMatchMsg && <div style={{ fontSize: '0.65rem', color: 'var(--green)' }}>{autoMatchMsg}</div>}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={r34Url}
                onChange={e => { setR34Url(e.target.value); setR34Status(null) }}
                onKeyDown={e => e.key === 'Enter' && updateFromR34()}
                placeholder="or paste rule34.xxx URL / ID..."
                onClick={e => e.stopPropagation()}
                style={{ flex: 1, fontSize: '0.72rem', background: '#0d0d0d',
                  border: '1px solid var(--border)', color: 'var(--text)',
                  fontFamily: 'var(--font-mono)', padding: '7px 10px', borderRadius: 4, outline: 'none' }}
              />
              <button className="btn-surface"
                onClick={e => { e.stopPropagation(); updateFromR34() }}
                disabled={r34Status === 'loading'}
                style={{ fontSize: '0.7rem', padding: '7px 12px', whiteSpace: 'nowrap',
                  opacity: r34Status === 'loading' ? 0.6 : 1 }}>
                {r34Status === 'loading' ? '...' : 'UPDATE'}
              </button>
            </div>
            {r34Status === 'ok' && (
              <div style={{ fontSize: '0.65rem', color: 'var(--green)' }}>{r34Msg}</div>
            )}
            {r34Status === 'error' && (
              <div style={{ fontSize: '0.65rem', color: 'var(--red)' }}>{r34Msg}</div>
            )}
          </div>

          {/* Keyboard hint */}
          <div style={{ marginTop: 12, fontSize: '0.6rem', color: '#333',
            display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[['←/→', 'prev/next'], ['Space', 'play/pause'], ['J/L', '±1s'],
              ['↑/↓', '±5s'], ['I', 'toggle info'], ['Esc', 'close']
            ].map(([k, v]) => (
              <span key={k}><span style={{ color: 'var(--muted)' }}>{k}</span> {v}</span>
            ))}
          </div>
        </div>
      )}

      {/* ── Auto-match candidate modal ── */}
      {autoMatch && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 1100,
          background: 'rgba(0,0,0,0.88)',
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
    {isMobile && mobileMenuOpen && (
  <div
    onClick={() => setMobileMenuOpen(false)}
    style={{
      position: 'absolute',
      inset: 0,
      zIndex: 1200,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <div
      onClick={e => e.stopPropagation()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        width: '80%',
        maxWidth: 320,
      }}
    >

      {postData && !isVideo && !isComic && !comicCarouselActive && (
        <button
          className="btn-surface"
          onClick={() => {
            setComicOverride(v => v === null ? !isComicStrip : !v)
            setMobileMenuOpen(false)
          }}
        >
          📜 {comicActive ? 'NORMAL VIEW' : 'SCROLL MODE'}
        </button>
      )}

      {!preloadState && (
        <button
          className="btn-surface"
          onClick={() => {
            preloadAll()
            setMobileMenuOpen(false)
          }}
        >
          ⬇ PRELOAD ALL
        </button>
      )}

      {preloadState && !preloadState.done && (
        <button
          className="btn-surface"
          onClick={() => {
            cancelPreload()
            setMobileMenuOpen(false)
          }}
        >
          ✕ CANCEL PRELOAD
        </button>
      )}
      <button
        className="btn-surface"
        onClick={() => {
          setInfo(v => !v)
          setMobileMenuOpen(false)
        }}
      >
        {showInfo ? 'HIDE INFO' : 'SHOW INFO'}
      </button>

      <button
        className="btn-surface"
        onClick={closeViewer}
        style={{ color: 'var(--red)' }}
      >
        ✕ CLOSE VIEWER
      </button>

    </div>
  </div>
)}



    </div>
  )
}

const overlay = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: '#000',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}