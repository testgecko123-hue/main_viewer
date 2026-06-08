import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { useState } from 'react'
import './styles/global.css'
import Library from './pages/Library.jsx'
import Subscriptions from './pages/Subscriptions.jsx'
import Browse from './pages/Browse.jsx'
import Viewer from './pages/Viewer.jsx'
import Collections from './pages/Collections.jsx'
import Selection from './pages/Selection.jsx'
import TagGroups from './pages/TagGroups.jsx'
import R34Search from './pages/R34Search.jsx'
import useIsMobile from './hooks/useIsMobile.js'
import useSelectionPersistence from './hooks/useSelectionPersistence.js'
import { EMPTY_SELECTION, getActiveIds, getActiveIndex, setActiveIndex } from './utils/selectionUtils.js'

function Nav({ onOpenViewer }) {
  const isMobile = useIsMobile()
  const links = [
    { to: '/',             label: 'LIBRARY'       },
    { to: '/subscriptions',label: 'SUBSCRIPTIONS' },
    { to: '/browse',       label: 'BROWSE'        },
    { to: '/collections',  label: 'COLLECTIONS'   },
    { to: '/selection',    label: 'SELECTION'     },
    { to: '/tag-groups',   label: 'TAG GROUPS'    },
    { to: '/R34Search',    label: 'R34 SEARCH'    },
  ]

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, height: isMobile ? '92px' : 'var(--nav-h)',
      background: 'var(--surface)', borderBottom: '1px solid var(--border)',
      display: 'flex', flexDirection: isMobile ? 'column' : 'row',
      alignItems: isMobile ? 'stretch' : 'center', justifyContent: isMobile ? 'center' : 'flex-start',
      padding: isMobile ? '6px 8px' : '0 24px', gap: '8px',
      zIndex: 100,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <span style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.1rem',
          color: 'var(--accent)', letterSpacing: '-0.02em', marginRight: 8,
        }}>VAULT</span>
        <div style={{ flex: 1 }} />
        <button className="btn-accent" onClick={onOpenViewer}
          style={{ fontSize: '0.72rem', letterSpacing: '0.06em', padding: isMobile ? '6px 12px' : '8px 20px' }}>
          ▶ VIEWER
        </button>
      </div>

      <div style={{
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        width: '100%',
        paddingBottom: 2,
      }}>
      {links.map(({ to, label }) => (
        <NavLink key={to} to={to} end={to === '/'} style={({ isActive }) => ({
          padding: isMobile ? '6px 10px' : '8px 16px', borderRadius: 4, fontSize: isMobile ? '0.68rem' : '0.78rem',
          letterSpacing: '0.06em', textDecoration: 'none',
          background: isActive ? 'var(--surface3)' : 'transparent',
          color: isActive ? 'var(--text)' : 'var(--muted)',
          border: isActive ? '1px solid var(--border2)' : '1px solid transparent',
          transition: 'all 0.15s',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        })}>
          {label}
        </NavLink>
      ))}
      </div>
    </nav>
  )
}

function App() {
  const isMobile = useIsMobile()
  const [selection, setSelection] = useState(EMPTY_SELECTION)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerIndex, setViewerIndex] = useState(0)
  const [viewSubIds, setViewSubIds] = useState(null)
  const { saveNow, saveStatus } = useSelectionPersistence(selection, setSelection)

  function openViewer(idx, subIds) {
    const i = typeof idx === 'number' ? idx : getActiveIndex(selection)
    setViewerIndex(i)
    setViewSubIds(subIds ?? null)
    setViewerOpen(true)
    saveNow()
  }

  function closeViewer(finalIdx) {
    setSelection(s => {
      const updated = typeof finalIdx === 'number' ? setActiveIndex(s, finalIdx) : s
      saveNow(updated)
      return updated
    })
    setViewSubIds(null)
    setViewerOpen(false)
  }

  return (
    <BrowserRouter>
      <Nav onOpenViewer={() => openViewer(getActiveIndex(selection))} />
      <div style={{ paddingTop: isMobile ? 92 : 'var(--nav-h)', minHeight: '100vh' }}>
        <Routes>
          <Route path="/"              element={<Library      selection={selection} setSelection={setSelection} openViewer={(ids, idx) => { if (ids) setSelection(s => ({...s, ids})); openViewer(idx || 0) }} />} />
          <Route path="/subscriptions" element={<Subscriptions selection={selection} setSelection={setSelection} openViewer={() => openViewer(0)} />} />
          <Route path="/browse"        element={<Browse       selection={selection} setSelection={setSelection} openViewer={openViewer} />} />
          <Route path="/random"        element={<Navigate to="/browse" replace />} />
          <Route path="/collections"   element={<Collections  selection={selection} setSelection={setSelection} openViewer={(idx) => openViewer(idx ?? 0)} />} />
          <Route path="/selection"     element={<Selection    selection={selection} setSelection={setSelection} openViewer={(idx, subIds) => openViewer(idx || 0, subIds)} saveStatus={saveStatus} />} />
          <Route path="/tag-groups"    element={<TagGroups />} />
          <Route path="/r34Search" element={<R34Search />} />
        </Routes>
      </div>
      {viewerOpen && (
        <Viewer
          selection={selection}
          setSelection={setSelection}
          viewIds={viewSubIds ?? getActiveIds(selection)}
          startIndex={viewerIndex}
          onClose={closeViewer}
        />
      )}
    </BrowserRouter>
  )
}

export default App