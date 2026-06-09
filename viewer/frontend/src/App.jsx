import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation
} from 'react-router-dom'

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

import MobileNav from './components/MobileNav.jsx'
import useIsMobile from './hooks/useIsMobile.js'
import useSelectionPersistence from './hooks/useSelectionPersistence.js'

import {
  EMPTY_SELECTION,
  getActiveIds,
  getActiveIndex,
  setActiveIndex
} from './utils/selectionUtils.js'

const NAV_TABS = [
  { id: '/',              label: 'Library',       icon: '🗄' },
  { id: '/subscriptions', label: 'Subscriptions', icon: '📡' },
  { id: '/browse',        label: 'Browse',        icon: '🔀' },
  { id: '/collections',   label: 'Collections',   icon: '📁' },
  { id: '/selection',     label: 'Selection',     icon: '☑' },
  { id: '/tag-groups',    label: 'Tag Groups',    icon: '🏷' },
  { id: '/r34search',     label: 'R34 Search',    icon: '🔍' }
]

function AppInner({
  selection,
  setSelection,
  viewerOpen,
  viewerIndex,
  viewSubIds,
  openViewer,
  closeViewer,
  saveStatus
}) {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const location = useLocation()

  const activePath =
    location.pathname === '/'
      ? '/'
      : location.pathname.replace(/\/$/, '')

  const headerHeight = isMobile ? 48 : 56
  const safeAreaTop = isMobile ? 'env(safe-area-inset-top)' : '0px'
  const safeAreaBottom = isMobile ? 'env(safe-area-inset-bottom)' : '0px'

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 2000,
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          paddingTop: safeAreaTop,
        }}
      >
        <MobileNav
          tabs={NAV_TABS}
          active={activePath}
          onChange={navigate}
          onOpenViewer={() => openViewer(getActiveIndex(selection))}
        />
      </div>

      <div
        style={{
          paddingTop: `calc(${headerHeight}px + ${safeAreaTop})`,
          paddingBottom: safeAreaBottom,
          minHeight: '100vh'
        }}
      >
        <Routes>
          <Route
            path="/"
            element={
              <Library
                selection={selection}
                setSelection={setSelection}
                openViewer={(ids, idx) => {
                  if (ids) setSelection(s => ({ ...s, ids }))
                  openViewer(idx || 0)
                }}
              />
            }
          />
          <Route
            path="/subscriptions"
            element={
              <Subscriptions
                selection={selection}
                setSelection={setSelection}
                openViewer={() => openViewer(0)}
              />
            }
          />
          <Route
            path="/browse"
            element={
              <Browse
                selection={selection}
                setSelection={setSelection}
                openViewer={openViewer}
              />
            }
          />
          <Route path="/random" element={<Navigate to="/browse" replace />} />
          <Route
            path="/collections"
            element={
              <Collections
                selection={selection}
                setSelection={setSelection}
                openViewer={idx => openViewer(idx ?? 0)}
              />
            }
          />
          <Route
            path="/selection"
            element={
              <Selection
                selection={selection}
                setSelection={setSelection}
                openViewer={(idx, subIds) => openViewer(idx || 0, subIds)}
                saveStatus={saveStatus}
              />
            }
          />
          <Route path="/tag-groups" element={<TagGroups />} />
          <Route path="/r34search" element={<R34Search />} />
          <Route path="/R34Search" element={<Navigate to="/r34search" replace />} />
        </Routes>

        {viewerOpen && (
          <Viewer
            selection={selection}
            setSelection={setSelection}
            viewIds={viewSubIds ?? getActiveIds(selection)}
            startIndex={viewerIndex}
            onClose={closeViewer}
          />
        )}
      </div>
    </>
  )
}

function App() {
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
      <AppInner
        selection={selection}
        setSelection={setSelection}
        viewerOpen={viewerOpen}
        viewerIndex={viewerIndex}
        viewSubIds={viewSubIds}
        openViewer={openViewer}
        closeViewer={closeViewer}
        saveStatus={saveStatus}
      />
    </BrowserRouter>
  )
}

export default App