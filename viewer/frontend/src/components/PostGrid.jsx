import React from 'react'
import { useEffect, useRef } from 'react'
import { gridCols, GRID } from '../config/gridConfig.js'

function PostThumb({ post, onSelect, isSelected, onAdd }) {
  const isVideo = post.media_type === 'video'
  const videoRef = React.useRef()
  const [hovered, setHovered] = React.useState(false)

  function handleKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); onAdd?.(post) }
  }

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

  return (
    <div
      onClick={(e) => onSelect(post, e)}
      onMouseDown={e => { if (e.button === 1) { e.preventDefault(); onAdd?.(post) }}}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: 'relative', cursor: 'pointer', borderRadius: 4, overflow: 'hidden',
        border: `2px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
        background: 'var(--surface2)', transition: 'border-color 0.1s, transform 0.1s',
        aspectRatio: '1',
      }}
    >
      <img
        src={post.thumb_cdn}

        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block',
          opacity: (isVideo && hovered) ? 0 : 1, transition: 'opacity 0.1s' }}
        onError={e => e.target.style.display = 'none'}
      />
      {isVideo && (
        <video
          ref={videoRef}
          src={post.cdn_url}
          muted loop playsInline preload="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', opacity: hovered ? 1 : 0, transition: 'opacity 0.1s' }}
        />
      )}
      {isVideo && !hovered && (
        <div style={{
          position: 'absolute', bottom: 4, right: 4,
          background: 'rgba(0,0,0,0.7)', borderRadius: 3,
          padding: '2px 5px', fontSize: '0.6rem', color: '#fff',
        }}>▶</div>
      )}
      {isSelected && (
        <div style={{
          position: 'absolute', top: 4, right: 4,
          background: 'var(--accent)', borderRadius: '50%',
          width: 18, height: 18, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: '0.6rem', color: '#000', fontWeight: 700,
          zIndex: 2,
        }}>✓</div>
      )}
    </div>
  )
}

export default function PostGrid({
  posts, onPostClick, selectedIds = new Set(),
  loadMore, hasMore, loading,
  onAddToSelection,
  columns = null,
}) {
  const sentinelRef = useRef()

  useEffect(() => {
    if (!loadMore || !hasMore) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loading) loadMore()
    }, { rootMargin: '200px' })
    if (sentinelRef.current) obs.observe(sentinelRef.current)
    return () => obs.disconnect()
  }, [loadMore, hasMore, loading])

  const colStyle = columns
    ? `repeat(${columns}, 1fr)`
    : gridCols.desktop

  return (
    <div>
      <div style={{
        display: 'grid', gridTemplateColumns: colStyle,
        gap: GRID.gap, alignItems: 'start',
      }}>
        {posts.map(post => (
          <PostThumb
            key={post.rule34hub_id || post.id}
            post={post}
            onSelect={onPostClick}
            isSelected={selectedIds.has(post.id)}
            onAdd={onAddToSelection}
          />
        ))}
      </div>
      {hasMore && (
        <div ref={sentinelRef} style={{ height: 40, display: 'flex', alignItems: 'center',
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
    </div>
  )
}