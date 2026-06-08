import { useState, useEffect } from 'react'

export default function TagGroups() {
  const [groups, setGroups]   = useState([])
  const [allTags, setAllTags] = useState([])
  const [editing, setEditing] = useState(null)  // group_name being edited
  const [newName, setNewName] = useState('')
  const [newMembers, setNewMembers] = useState('')  // comma separated
  const [tagSearch, setTagSearch] = useState('')
  const [suggestions, setSugs] = useState([])

  useEffect(() => {
    loadGroups()
    fetch('/api/tags?limit=500').then(r => r.json()).then(setAllTags)
  }, [])

  async function loadGroups() {
    const res = await fetch('/api/tag-groups')
    setGroups(await res.json())
  }

  useEffect(() => {
    if (!tagSearch.trim()) { setSugs([]); return }
    fetch(`/api/tags/search?q=${encodeURIComponent(tagSearch)}&limit=8`)
      .then(r => r.json()).then(setSugs)
  }, [tagSearch])

  async function saveGroup() {
    const name = newName.trim()
    const members = newMembers.split(',').map(t => t.trim().toLowerCase().replace(/ /g,'_')).filter(Boolean)
    if (!name || members.length < 2) return
    await fetch('/api/tag-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_name: name, members }),
    })
    setNewName(''); setNewMembers(''); setEditing(null)
    loadGroups()
  }

  async function deleteGroup(name) {
    await fetch(`/api/tag-groups/${encodeURIComponent(name)}`, { method: 'DELETE' })
    loadGroups()
  }

  function startEdit(group) {
    setEditing(group.group_name)
    setNewName(group.group_name)
    setNewMembers(group.members.join(', '))
  }

  function addSuggestion(tag) {
    const existing = newMembers.split(',').map(t => t.trim()).filter(Boolean)
    if (!existing.includes(tag)) {
      setNewMembers([...existing, tag].join(', '))
    }
    setTagSearch('')
    setSugs([])
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - var(--nav-h))' }}>

      {/* Left — create/edit form */}
      <div style={{ width: 360, flexShrink: 0, borderRight: '1px solid var(--border)',
        padding: 24, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>

        <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', color: 'var(--accent)' }}>
          {editing ? `EDITING: ${editing}` : 'NEW TAG GROUP'}
        </div>

        <div style={{ fontSize: '0.7rem', color: 'var(--muted)', lineHeight: 1.8 }}>
          Tag groups let you use multiple names for the same character or concept.
          Searching for any member will match all others.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>GROUP NAME</label>
          <input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="e.g. Sue Storm" />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>MEMBERS (comma separated)</label>
          <textarea value={newMembers} onChange={e => setNewMembers(e.target.value)}
            placeholder="sue_storm, invisible_woman, susan_storm"
            rows={3}
            style={{ resize: 'vertical', background: '#0d0d0d', border: '1px solid var(--border)',
              color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
              padding: '8px 10px', borderRadius: 4, outline: 'none' }} />
        </div>

        {/* Tag search to find tags */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
          <label style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>ADD TAG FROM LIBRARY</label>
          <input value={tagSearch} onChange={e => setTagSearch(e.target.value)}
            placeholder="Search your tags..." />
          {suggestions.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 4, overflow: 'hidden', marginTop: 4 }}>
              {suggestions.map(s => (
                <div key={s.name} onMouseDown={() => addSuggestion(s.name)}
                  style={{ padding: '7px 12px', cursor: 'pointer', fontSize: '0.72rem',
                    display: 'flex', justifyContent: 'space-between',
                    background: 'transparent' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface3)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span>{s.name}</span>
                  <span style={{ color: 'var(--muted)' }}>{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preview members */}
        {newMembers && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {newMembers.split(',').map(t => t.trim()).filter(Boolean).map(t => (
              <span key={t} style={{
                background: '#14532d33', border: '1px solid #22c55e55',
                color: '#86efac', borderRadius: 3, padding: '2px 8px', fontSize: '0.68rem',
              }}>{t}</span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-accent" onClick={saveGroup}
            style={{ flex: 1, padding: '10px' }}>
            {editing ? 'UPDATE' : 'CREATE GROUP'}
          </button>
          {editing && (
            <button className="btn-ghost" onClick={() => { setEditing(null); setNewName(''); setNewMembers('') }}
              style={{ padding: '10px 14px' }}>
              CANCEL
            </button>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: 8 }}>
            MOST USED TAGS — click to add to group
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
            {allTags.slice(0, 80).map(t => (
              <span key={t.name} onClick={() => addSuggestion(t.name)}
                style={{
                  background: 'var(--surface3)', border: '1px solid var(--border2)',
                  borderRadius: 3, padding: '2px 7px', fontSize: '0.63rem',
                  color: 'var(--muted2)', cursor: 'pointer', transition: 'all 0.1s',
                }}
                onMouseEnter={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.color = 'var(--text)' }}
                onMouseLeave={e => { e.target.style.borderColor = 'var(--border2)'; e.target.style.color = 'var(--muted2)' }}>
                {t.name} <span style={{ color: '#444', fontSize: '0.58rem' }}>{t.count}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Right — existing groups */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', color: 'var(--accent)' }}>
            GROUPS ({groups.length})
          </div>
        </div>

        {groups.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
            No tag groups yet. Create one to get started.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groups.map(g => (
            <div key={g.group_name} style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '12px 16px',
              display: 'flex', alignItems: 'flex-start', gap: 12,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.78rem', marginBottom: 6, color: 'var(--text)' }}>
                  {g.group_name}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {g.members.map(m => (
                    <span key={m} style={{
                      background: '#14532d33', border: '1px solid #22c55e55',
                      color: '#86efac', borderRadius: 3, padding: '2px 8px', fontSize: '0.65rem',
                    }}>{m}</span>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button className="btn-ghost" onClick={() => startEdit(g)}
                  style={{ padding: '5px 10px', fontSize: '0.7rem' }}>EDIT</button>
                <button className="btn-ghost" onClick={() => deleteGroup(g.group_name)}
                  style={{ padding: '5px 10px', fontSize: '0.7rem', color: 'var(--red)',
                    borderColor: 'var(--red)' }}>DEL</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}