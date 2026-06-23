import { useState, useEffect, useRef } from 'react'
import { apiFetch, apiPath, authHeaders } from '../utils/api.js'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'heic'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'])

function inferMediaType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  return 'other'
}

function formatBytes(n) {
  if (!n && n !== 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function mediaIcon(mediaType) {
  if (mediaType === 'image') return '🖼️'
  if (mediaType === 'video') return '🎬'
  return '❓'
}

function normalizeTag(t) {
  return t.trim().toLowerCase().replace(/\s+/g, '_')
}

/** Upload one file via XHR (not fetch) so we get real upload-progress events. */
function uploadOne(file, { folder, tags, sourceType, mediaCategory, relativePath }, onProgress) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', apiPath('/api/mega/upload'))
    const headers = authHeaders()
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v))

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      let data = null
      try { data = JSON.parse(xhr.responseText) } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && data) {
        resolve({ ok: true, data })
      } else {
        resolve({ ok: false, error: (data && data.error) || `HTTP ${xhr.status}` })
      }
    }
    xhr.onerror = () => resolve({ ok: false, error: 'Network error' })

    const fd = new FormData()
    fd.append('file', file)
    fd.append('folder', folder)
    fd.append('tags', JSON.stringify(tags))
    fd.append('source_type', sourceType)
    fd.append('media_category', mediaCategory)
    fd.append('relative_path', relativePath || file.name)
    xhr.send(fd)
  })
}

// ---------------------------------------------------------------------------
// TagChipsInput — free-typed tags w/ autocomplete from existing library tags
// ---------------------------------------------------------------------------

function TagChipsInput({ tags, onChange, placeholder }) {
  const [input, setInput] = useState('')
  const [sugs, setSugs] = useState([])
  const debounce = useRef()
  const containerRef = useRef()

  useEffect(() => {
    function onPointerDown(e) {
      if (!containerRef.current?.contains(e.target)) setSugs([])
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  useEffect(() => {
    if (!input.trim()) { setSugs([]); return }
    clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/tags/search?q=${encodeURIComponent(input)}&limit=6`)
        setSugs(await res.json())
      } catch { setSugs([]) }
    }, 150)
  }, [input])

  function add(tag) {
    const norm = normalizeTag(tag)
    if (!norm || tags.includes(norm)) return
    onChange([...tags, norm]); setInput(''); setSugs([])
  }

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ position: 'relative' }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add(input))}
          placeholder={placeholder}
          style={{ fontSize: '0.78rem', width: '100%' }} />
        {sugs.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
            background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, marginTop: 2 }}>
            {sugs.map(s => (
              <div key={s.name} onMouseDown={() => add(s.name)}
                style={{ padding: '8px 10px', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', justifyContent: 'space-between' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span>{s.name}</span><span style={{ color: 'var(--muted)' }}>{s.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {tags.map(t => (
            <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
              borderRadius: 3, padding: '3px 8px', fontSize: '0.7rem',
              background: '#e8ff4722', border: '1px solid var(--accent)', color: 'var(--accent)' }}>
              {t}<span onClick={() => onChange(tags.filter(x => x !== t))}
                style={{ cursor: 'pointer', opacity: 0.7, fontSize: '1rem', lineHeight: 1 }}>×</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AccountStatus
// ---------------------------------------------------------------------------

function AccountStatus({ status }) {
  if (!status) {
    return <div style={{ fontSize: '0.8rem', color: 'var(--muted2)' }}>Checking MEGA connection…</div>
  }
  if (!status.configured) {
    return (
      <div style={{ padding: 10, borderRadius: 6, background: '#7c2d1222', border: '1px solid var(--orange)',
        fontSize: '0.78rem', color: 'var(--orange)' }}>
        MEGA isn't configured on the server yet. Add <code>MEGA_EMAIL</code> and{' '}
        <code>MEGA_PASSWORD</code> for your own MEGA account to the backend <code>.env</code>, then restart it.
      </div>
    )
  }
  if (!status.connected) {
    return (
      <div style={{ padding: 10, borderRadius: 6, background: '#7f1d1d22', border: '1px solid var(--red)',
        fontSize: '0.78rem', color: '#fca5a5' }}>
        Couldn't log in to MEGA ({status.email}). {status.error || 'Check the credentials in your .env.'}
      </div>
    )
  }
  const pct = status.total_gb ? Math.min(100, (status.used_gb / status.total_gb) * 100) : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: '0.78rem', color: 'var(--text)', display: 'flex', justifyContent: 'space-between' }}>
        <span><span style={{ color: 'var(--green)' }}>●</span> Connected as {status.email}</span>
        <span style={{ color: 'var(--muted2)' }}>{status.used_gb} / {status.total_gb} GB</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'var(--surface3)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FileRow
// ---------------------------------------------------------------------------

function FileRow({ item, progress, onRemove, locked }) {
  const status = progress?.status
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
      borderBottom: '1px solid var(--border)', fontSize: '0.75rem' }}>
      <span>{mediaIcon(item.mediaType)}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: item.mediaType === 'other' ? 'var(--muted2)' : 'var(--text)' }}>
        {item.relativePath}
      </span>
      <span style={{ color: 'var(--muted2)', minWidth: 56, textAlign: 'right' }}>{formatBytes(item.file.size)}</span>
      <span style={{ minWidth: 90, textAlign: 'right' }}>
        {item.mediaType === 'other' ? (
          <span style={{ color: 'var(--muted2)' }}>skip</span>
        ) : status === 'done' ? (
          <span style={{ color: 'var(--green)' }}>✓ done</span>
        ) : status === 'error' ? (
          <span style={{ color: 'var(--red)' }} title={progress.error}>✕ failed</span>
        ) : status === 'uploading' ? (
          <span style={{ color: 'var(--accent)' }}>{progress.progress}%</span>
        ) : !locked ? (
          <span onClick={() => onRemove(item.id)} style={{ cursor: 'pointer', color: 'var(--muted2)' }}>remove</span>
        ) : (
          <span style={{ color: 'var(--muted2)' }}>queued</span>
        )}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MegaImport
// ---------------------------------------------------------------------------

export default function MegaImport() {
  const [status, setStatus]   = useState(null)
  const [options, setOptions] = useState({ sources: [], categories: [], folders: [] })

  const [tags, setTags]                 = useState([])
  const [folderName, setFolderName]     = useState('')
  const [sourceType, setSourceType]     = useState('mega_own')
  const [mediaCategory, setMediaCategory] = useState('library')
  const [tagFolderName, setTagFolderName] = useState(true)

  const [picked, setPicked]   = useState([])
  const [results, setResults] = useState({})
  const [running, setRunning] = useState(false)
  const fileInputRef = useRef()

  function refreshOptions() {
    apiFetch('/api/mega/import-options').then(r => r.json()).then(opts => {
      setOptions(opts)
      setSourceType(prev => prev || opts.sources?.[0] || 'mega_own')
      setMediaCategory(prev => prev || opts.categories?.[0] || 'library')
    }).catch(() => {})
  }

  useEffect(() => {
    apiFetch('/api/mega/status').then(r => r.json()).then(setStatus).catch(() => setStatus({ configured: false }))
    refreshOptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleFolderPick(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = '' // allow picking the same folder again later
    if (!files.length) return

    const topFolder = files[0].webkitRelativePath?.split('/')[0] || ''
    if (topFolder) setFolderName(topFolder)

    setPicked(files.map((f, i) => ({
      id: `${i}-${f.name}-${f.size}-${f.lastModified}`,
      file: f,
      relativePath: f.webkitRelativePath || f.name,
      mediaType: inferMediaType(f.name),
    })))
    setResults({})
  }

  function removeItem(id) {
    setPicked(prev => prev.filter(p => p.id !== id))
  }

  function clearAll() {
    setPicked([])
    setResults({})
  }

  const importable   = picked.filter(p => p.mediaType !== 'other')
  const imageCount   = picked.filter(p => p.mediaType === 'image').length
  const videoCount   = picked.filter(p => p.mediaType === 'video').length
  const skippedCount = picked.length - imageCount - videoCount

  const doneCount  = Object.values(results).filter(r => r.status === 'done').length
  const errorCount = Object.values(results).filter(r => r.status === 'error').length
  const finished   = !running && picked.length > 0 && (doneCount + errorCount) === importable.length && importable.length > 0

  async function startImport() {
    if (!importable.length || running) return
    setRunning(true)

    const finalTags = [...tags]
    if (tagFolderName && folderName) {
      const norm = normalizeTag(folderName)
      if (norm && !finalTags.includes(norm)) finalTags.push(norm)
    }

    const queue = [...importable]
    const concurrency = 3
    let cursor = 0

    async function worker() {
      while (cursor < queue.length) {
        const item = queue[cursor++]
        setResults(r => ({ ...r, [item.id]: { progress: 0, status: 'uploading' } }))

        const res = await uploadOne(item.file, {
          folder: folderName || 'Import',
          tags: finalTags,
          sourceType,
          mediaCategory,
          relativePath: item.relativePath,
        }, (pct) => setResults(r => ({ ...r, [item.id]: { ...r[item.id], progress: pct } })))

        if (res.ok && res.data.status === 'skipped') {
          setResults(r => ({ ...r, [item.id]: { progress: 100, status: 'done' } }))
        } else if (res.ok) {
          setResults(r => ({ ...r, [item.id]: { progress: 100, status: 'done' } }))
        } else {
          setResults(r => ({ ...r, [item.id]: { progress: 100, status: 'error', error: res.error } }))
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
    setRunning(false)
    refreshOptions()
  }

  const canStart = status?.configured && status?.connected && importable.length > 0 && !running

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div>
        <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem' }}>MEGA account</h3>
        <AccountStatus status={status} />
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      <div>
        <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem' }}>Import a folder</h3>
        <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: 'var(--muted2)' }}>
          Pick a local folder. Every image and video in it gets uploaded to your own
          MEGA account and added to your library with the options below — everything
          else in the folder is skipped.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          webkitdirectory=""
          directory=""
          multiple
          onChange={handleFolderPick}
          style={{ display: 'none' }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => fileInputRef.current?.click()} disabled={running}
            style={{ fontSize: '0.78rem', padding: '8px 14px' }}>
            📁 Choose folder…
          </button>
          {picked.length > 0 && !running && (
            <button onClick={clearAll} style={{ fontSize: '0.78rem', padding: '8px 14px',
              background: 'transparent', color: 'var(--muted2)' }}>
              Clear
            </button>
          )}
        </div>
      </div>

      {picked.length > 0 && (
        <>
          <div style={{ fontSize: '0.78rem', color: 'var(--muted2)' }}>
            {imageCount} image{imageCount === 1 ? '' : 's'} · {videoCount} video{videoCount === 1 ? '' : 's'}
            {skippedCount > 0 && <> · {skippedCount} skipped (unsupported type)</>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 14,
            border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)' }}>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--muted2)', marginBottom: 4 }}>
                Tags (applied to every file in this import)
              </label>
              <TagChipsInput tags={tags} onChange={setTags} placeholder="Add a tag and hit enter…" />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8,
                fontSize: '0.72rem', color: 'var(--muted2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={tagFolderName}
                  onChange={e => setTagFolderName(e.target.checked)} disabled={running} />
                Also tag everything with the folder name ({folderName ? normalizeTag(folderName) : '—'})
              </label>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--muted2)', marginBottom: 4 }}>
                  Source <span style={{ color: 'var(--muted)' }}>(source_type)</span>
                </label>
                <input value={sourceType} onChange={e => setSourceType(e.target.value)}
                  list="mega-source-options" disabled={running}
                  style={{ fontSize: '0.78rem', width: '100%' }} placeholder="mega_own" />
                <datalist id="mega-source-options">
                  {options.sources.map(s => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--muted2)', marginBottom: 4 }}>
                  Category <span style={{ color: 'var(--muted)' }}>(media_category)</span>
                </label>
                <input value={mediaCategory} onChange={e => setMediaCategory(e.target.value)}
                  list="mega-category-options" disabled={running}
                  style={{ fontSize: '0.78rem', width: '100%' }} placeholder="library" />
                <datalist id="mega-category-options">
                  {options.categories.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--muted2)', marginBottom: 4 }}>
                MEGA folder <span style={{ color: 'var(--muted)' }}>(where these files go on your MEGA drive)</span>
              </label>
              <input value={folderName} onChange={e => setFolderName(e.target.value)}
                list="mega-folder-options" disabled={running}
                style={{ fontSize: '0.78rem', width: '100%' }} placeholder="Import" />
              <datalist id="mega-folder-options">
                {options.folders.map(f => <option key={f} value={f} />)}
              </datalist>
            </div>
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden',
            maxHeight: 280, overflowY: 'auto' }}>
            {picked.map(item => (
              <FileRow key={item.id} item={item} progress={results[item.id]}
                onRemove={removeItem} locked={running} />
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={startImport} disabled={!canStart}
              style={{ fontSize: '0.82rem', padding: '10px 18px',
                background: canStart ? 'var(--accent)' : 'var(--surface3)',
                color: canStart ? '#000' : 'var(--muted2)', fontWeight: 600 }}>
              {running ? `Uploading… (${doneCount + errorCount}/${importable.length})` : `Upload ${importable.length} file${importable.length === 1 ? '' : 's'} to MEGA`}
            </button>
            {finished && (
              <span style={{ fontSize: '0.78rem', color: errorCount ? 'var(--orange)' : 'var(--green)' }}>
                {errorCount ? `Done — ${doneCount} imported, ${errorCount} failed` : `✓ All ${doneCount} imported`}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
