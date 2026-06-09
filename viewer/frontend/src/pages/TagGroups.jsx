import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../utils/api.js'
import useIsMobile from '../hooks/useIsMobile.js'

export default function TagGroups() {
  const isMobile = useIsMobile()
  const [groups, setGroups]   = useState([])
  const [allTags, setAllTags] = useState([])
  const [editing, setEditing] = useState(null)
  const [newName, setNewName] = useState('')
  const [newMembers, setNewMembers] = useState('')
  const [tagSearch, setTagSearch] = useState('')
  const [suggestions, setSugs] = useState([])
  const [formOpen, setFormOpen] = useState(false)  // mobile: bottom sheet
  const tagSearchRef = useRef()

  useEffect(() => {
    function onPointerDown(e) {
      if (!tagSearchRef.current?.contains(e.target)) setSugs([])
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  useEffect(() => {
    loadGroups()
    apiFetch('/api/tags?limit=500').then(r => r.json()).then(setAllTags)
  }, [])

  async function loadGroups() {
    const res = await apiFetch('/api/tag-groups')
    setGroups(await res.json())
  }

  useEffect(() => {
    if (!tagSearch.trim()) { setSugs([]); return }
    apiFetch(`/api/tags/search?q=${encodeURIComponent(tagSearch)}&limit=8`)
      .then(r => r.json()).then(setSugs)
  }, [tagSearch])

  async function saveGroup() {
    const name = newName.trim()
    const members = newMembers.split(',').map(t => t.trim().toLowerCase().replace(/ /g,'_')).filter(Boolean)
    if (!name || members.length < 2) return
    await apiFetch('/api/tag-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_name: name, members }),
    })
    setNewName(''); setNewMembers(''); setEditing(null)
    if (isMobile) setFormOpen(false)
    loadGroups()
  }

  async function deleteGroup(name) {
    await apiFetch(`/api/tag-groups/${encodeURIComponent(name)}`, { method: 'DELETE' })
    loadGroups()
  }

  function startEdit(group) {
    setEditing(group.group_name)
    setNewName(group.group_name)
    setNewMembers(group.members.join(', '))
    if (isMobile) setFormOpen(true)
  }

  function addSuggestion(tag) {
    const existing = newMembers.split(',').map(t => t.trim()).filter(Boolean)
    if (!existing.includes(tag)) {
      setNewMembers([...existing, tag].join(', '))
    }
    setTagSearch('')
    setSugs([])
  }

  // The form content (shared between desktop sidebar and mobile sheet)
  const formContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16,
      padding: isMobile ? '16px 16px 32px' : 24 }}>

      <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', color: 'var(--accent)' }}>
        {editing ? `EDITING: ${editing}` : 'NEW TAG GROUP'}
      </div>

      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', lineHeight: 1.8 }}>
        Tag groups let you use multiple names for the same character or concept.
        Searching for any member will match all others.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>GROUP NAME</label>
        <input value={newName} onChange={e => setNewName(e.target.value)}
          placeholder="e.g. Sue Storm" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>MEMBERS (comma separated)</label>
        <textarea value={newMembers} onChange={e => setNewMembers(e.target.value)}
          placeholder="sue_storm, invisible_woman, susan_storm"
          rows={3}
          style={{ resize: 'vertical', background: '#0d0d0d', border: '1px solid var(--border)',
            color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem',
            padding: '10px', borderRadius: 4, outline: 'none' }} />
      </div>

      {/* Tag search */}
      <div ref={tagSearchRef} style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
        <label style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>ADD TAG FROM LIBRARY</label>
        <input value={tagSearch} onChange={e => setTagSearch(e.target.value)}
          placeholder="Search your tags..." />
        {suggestions.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 4, overflow: 'hidden', marginTop: 4 }}>
            {suggestions.map(s => (
              <div key={s.name} onMouseDown={() => addSuggestion(s.name)}
                style={{ padding: '10px 12px', cursor: 'pointer', fontSize: '0.78rem',
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
              color: '#86efac', borderRadius: 3, padding: '3px 8px', fontSize: '0.72rem',
            }}>{t}</span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-accent" onClick={saveGroup} style={{ flex: 1, padding: '12px' }}>
          {editing ? 'UPDATE' : 'CREATE GROUP'}
        </button>
        {editing && (
          <button className="btn-ghost"
            onClick={() => { setEditing(null); setNewName(''); setNewMembers(''); if (isMobile) setFormOpen(false) }}
            style={{ padding: '12px 16px' }}>
            CANCEL
          </button>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 8 }}>
          MOST USED TAGS — tap to add
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
          {allTags.slice(0, 80).map(t => (
            <span key={t.name} onClick={() => addSuggestion(t.name)}
              style={{
                background: 'var(--surface3)', border: '1px solid var(--border2)',
                borderRadius: 3, padding: '3px 8px', fontSize: '0.68rem',
                color: 'var(--muted2)', cursor: 'pointer',
              }}>
              {t.name} <span style={{ color: '#444', fontSize: '0.6rem' }}>{t.count}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ height: 'calc(100vh - var(--nav-h) - var(--safe-top, 0px))',
      display: 'flex', flexDirection: 'column', paddingBottom: 'var(--safe-bottom, 0px)',
      position: 'relative' }}>

      {/* Desktop: side-by-side layout */}
      {!isMobile ? (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left form */}
          <div style={{ width: 360, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
            {formContent}
          </div>

          {/* Right groups list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            <GroupsList groups={groups} onEdit={startEdit} onDelete={deleteGroup} />
          </div>
        </div>
      ) : (
        /* Mobile: full list + FAB to open form sheet */
        <>
          {/* Groups list takes full width */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 12px',
            paddingBottom: 'calc(80px + var(--safe-bottom, 0px))' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', color: 'var(--accent)' }}>
                GROUPS ({groups.length})
              </div>
            </div>
            <GroupsList groups={groups} onEdit={startEdit} onDelete={deleteGroup} />
          </div>

          {/* FAB */}
          <button
            onClick={() => { setEditing(null); setNewName(''); setNewMembers(''); setFormOpen(true) }}
            style={{
              position: 'absolute', bottom: 'calc(20px + var(--safe-bottom, 0px))', right: 20,
              width: 56, height: 56, borderRadius: '50%',
              background: 'var(--accent)', color: '#000',
              border: 'none', fontSize: '1.5rem', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              zIndex: 30,
            }}>
            +
          </button>

          {/* Bottom sheet */}
          {formOpen && (
            <>
              <div onClick={() => setFormOpen(false)}
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
                    {editing ? `EDITING: ${editing}` : 'NEW GROUP'}
                  </span>
                  <button onClick={() => setFormOpen(false)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--muted)',
                      fontSize: '1.5rem', padding: '0 4px', cursor: 'pointer' }}>×</button>
                </div>
                {formContent}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function GroupsList({ groups, onEdit, onDelete }) {
  if (groups.length === 0) return (
    <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
      No tag groups yet. Create one to get started.
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {groups.map(g => (
        <div key={g.group_name} style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '14px 16px',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.82rem', marginBottom: 8, color: 'var(--text)' }}>
              {g.group_name}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {g.members.map(m => (
                <span key={m} style={{
                  background: '#14532d33', border: '1px solid #22c55e55',
                  color: '#86efac', borderRadius: 3, padding: '3px 8px', fontSize: '0.7rem',
                }}>{m}</span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button className="btn-ghost" onClick={() => onEdit(g)}
              style={{ padding: '8px 12px', fontSize: '0.75rem' }}>EDIT</button>
            <button className="btn-ghost" onClick={() => onDelete(g.group_name)}
              style={{ padding: '8px 12px', fontSize: '0.75rem',
                color: 'var(--red)', borderColor: 'var(--red)' }}>DEL</button>
          </div>
        </div>
      ))}
    </div>
  )
}