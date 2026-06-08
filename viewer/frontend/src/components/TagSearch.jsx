import { useState, useRef, useEffect } from 'react'

const PILL_COLORS = {
  needed:   { bg: '#14532d33', border: '#22c55e55', text: '#86efac', label: 'NEED'    },
  optional: { bg: '#1e3a5f33', border: '#3b82f655', text: '#93c5fd', label: 'OPT'     },
  exclude:  { bg: '#7f1d1d33', border: '#dc262655', text: '#fca5a5', label: 'EXCL'    },
}

function TagPill({ tag, type, onRemove, onClick }) {
  const c = PILL_COLORS[type]
  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: c.bg, border: `1px solid ${c.border}`, color: c.text,
        borderRadius: 3, padding: '2px 8px', fontSize: '0.68rem',
        cursor: onClick ? 'pointer' : 'default', userSelect: 'none',
      }}
    >
      <span style={{ color: c.border, fontSize: '0.6rem' }}>{c.label}</span>
      {tag}
      <span
        onClick={e => { e.stopPropagation(); onRemove() }}
        style={{ color: c.border, cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1 }}
      >×</span>
    </span>
  )
}

export default function TagSearch({ value, onChange, onSearch, singleMode = null }) {
  // value: { needed: [], optional: [], exclude: [] }
  // singleMode: 'optional' | 'needed' | 'exclude' | null — if set, hide mode bar and only edit that bucket
  const [input, setInput]     = useState('')
  const [mode, setMode]       = useState(singleMode || 'needed')   // current input mode
  const [suggestions, setSugs] = useState([])
  const [sugIdx, setSugIdx]   = useState(-1)
  const inputRef = useRef()
  const debounce = useRef()

  useEffect(() => {
    if (singleMode) setMode(singleMode)
  }, [singleMode])

  useEffect(() => {
    if (!input.trim()) { setSugs([]); return }
    clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      const res = await fetch(`/api/tags/search?q=${encodeURIComponent(input)}&limit=10`)
      const data = await res.json()
      setSugs(data)
      setSugIdx(-1)
    }, 150)
  }, [input])

  const effectiveMode = singleMode || mode

  function addTag(tag, type = effectiveMode) {
    if (!tag.trim()) return
    const norm = tag.trim().toLowerCase().replace(/ /g, '_')
    const next = { ...value }
    if (!singleMode) {
      for (const m of ['needed', 'optional', 'exclude']) {
        next[m] = next[m].filter(t => t !== norm)
      }
    }
    if (!next[type].includes(norm)) {
      next[type] = [...next[type], norm]
    }
    onChange(next)
    setInput('')
    setSugs([])
    inputRef.current?.focus()
  }

  function removeTag(tag, type) {
    onChange({ ...value, [type]: value[type].filter(t => t !== tag) })
  }

  function moveTag(tag, fromType, toType) {
    const next = { ...value }
    next[fromType] = next[fromType].filter(t => t !== tag)
    if (!next[toType].includes(tag)) next[toType] = [...next[toType], tag]
    onChange(next)
  }

  function handleKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSugIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSugIdx(i => Math.max(i - 1, -1)) }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (sugIdx >= 0 && suggestions[sugIdx]) addTag(suggestions[sugIdx].name)
      else addTag(input)
      if (onSearch) onSearch()
    }
    if (!singleMode && e.key === 'Tab') {
      e.preventDefault()
      setMode(m => m === 'needed' ? 'optional' : m === 'optional' ? 'exclude' : 'needed')
    }
    if (e.key === 'Backspace' && !input) {
      const m = effectiveMode
      const last = value[m].at(-1)
      if (last) removeTag(last, m)
    }
  }

  const allTags = singleMode
    ? value[singleMode].map(t => ({ tag: t, type: singleMode }))
    : [
        ...value.needed.map(t   => ({ tag: t, type: 'needed'   })),
        ...value.optional.map(t => ({ tag: t, type: 'optional' })),
        ...value.exclude.map(t  => ({ tag: t, type: 'exclude'  })),
      ]

  const modeColors = PILL_COLORS[effectiveMode]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!singleMode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['needed','optional','exclude']).map(m => (
              <button key={m}
                type="button"
                onClick={() => setMode(m)}
                style={{
                  flex: 1, padding: '7px 6px', fontSize: '0.72rem', letterSpacing: '0.06em',
                  background: mode === m ? PILL_COLORS[m].bg : 'transparent',
                  border: `1px solid ${mode === m ? PILL_COLORS[m].border : 'var(--border)'}`,
                  color: mode === m ? PILL_COLORS[m].text : 'var(--muted)',
                  borderRadius: 3,
                }}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>
          <span style={{ fontSize: '0.62rem', color: 'var(--muted)' }}>
            Tab to switch mode · Enter to add · Click pill to cycle
          </span>
        </div>
      )}
      {singleMode === 'optional' && (
        <span style={{ fontSize: '0.62rem', color: 'var(--muted)' }}>
          Matches library posts that have <strong style={{ color: 'var(--text)' }}>any</strong> of these tags · Enter to add · Click × to remove
        </span>
      )}

      {/* Input + pills */}
      <div
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center',
          background: '#0d0d0d', border: `1px solid ${input ? modeColors.border : 'var(--border)'}`,
          borderRadius: 4, padding: '6px 10px', minHeight: 42, cursor: 'text',
          transition: 'border-color 0.15s',
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {allTags.map(({ tag, type }) => (
          <TagPill
            key={`${type}-${tag}`}
            tag={tag} type={type}
            onRemove={() => removeTag(tag, type)}
            onClick={singleMode ? undefined : () => {
              const cycle = { needed: 'optional', optional: 'exclude', exclude: null }
              const next = cycle[type]
              if (next) moveTag(tag, type, next)
              else removeTag(tag, type)
            }}
          />
        ))}
        <div style={{ position: 'relative', flex: 1, minWidth: 120 }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={allTags.length ? '' : 'Search tags...'}
            style={{
              background: 'transparent', border: 'none', padding: 0,
              color: modeColors.text, outline: 'none', width: '100%', fontSize: '0.75rem',
            }}
          />
          {suggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 4, overflow: 'hidden', marginTop: 4,
            }}>
              {suggestions.map((s, i) => (
                <div
                  key={s.name}
                  onMouseDown={() => addTag(s.name)}
                  style={{
                    padding: '6px 10px', cursor: 'pointer', fontSize: '0.72rem',
                    background: i === sugIdx ? 'var(--surface3)' : 'transparent',
                    display: 'flex', justifyContent: 'space-between',
                  }}
                >
                  <span>{s.name}</span>
                  <span style={{ color: 'var(--muted)' }}>{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}