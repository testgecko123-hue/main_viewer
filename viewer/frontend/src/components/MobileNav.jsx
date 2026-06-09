/**
 * MobileNav.jsx
 *
 * Drop-in replacement for the top nav bar on mobile.
 * On desktop: renders the original horizontal tab bar (pass through children or tabs array).
 * On mobile: renders a slim header with the current page title + hamburger,
 * and a full-screen overlay to switch pages.
 *
 * Usage:
 *   <MobileNav
 *     tabs={[
 *       { id: 'library',       label: 'Library',       icon: '🗄' },
 *       { id: 'browse',        label: 'Browse',        icon: '🔀' },
 *       { id: 'subscriptions', label: 'Subscriptions', icon: '📡' },
 *       { id: 'collections',   label: 'Collections',   icon: '📁' },
 *       { id: 'selection',     label: 'Selection',     icon: '☑' },
 *       { id: 'tag-groups',    label: 'Tag Groups',    icon: '🏷' },
 *       { id: 'r34-search',    label: 'R34 Search',    icon: '🔍' },
 *     ]}
 *     active={currentPage}
 *     onChange={setCurrentPage}
 *     selectionCount={selection.ids.length}  // optional badge
 *   />
 */

import { useState } from 'react'
import useIsMobile from '../hooks/useIsMobile.js'

export default function MobileNav({ tabs = [], active, onChange, selectionCount = 0 }) {
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)

  const activeTab = tabs.find(t => t.id === active)

  function navigate(id) {
    onChange(id)
    setMenuOpen(false)
  }

  if (!isMobile) {
    // Desktop: render a normal horizontal nav bar
    return (
      <nav style={{
        height: 'var(--nav-h)',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: 4, flexShrink: 0,
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              padding: '8px 14px', fontSize: '0.72rem', letterSpacing: '0.08em',
              background: 'transparent', border: 'none',
              borderBottom: `2px solid ${active === tab.id ? 'var(--accent)' : 'transparent'}`,
              color: active === tab.id ? 'var(--accent)' : 'var(--muted)',
              borderRadius: 0, cursor: 'pointer',
            }}>
            {tab.label}
            {tab.id === 'selection' && selectionCount > 0 && (
              <span style={{ marginLeft: 5, fontSize: '0.65rem', background: 'var(--accent)',
                color: '#000', borderRadius: 10, padding: '1px 6px', fontWeight: 700 }}>
                {selectionCount}
              </span>
            )}
          </button>
        ))}
      </nav>
    )
  }

  // Mobile: compact header + full-screen menu
  return (
    <>
      {/* Slim header bar */}
      <nav style={{
        height: 'var(--nav-h)',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center',
        padding: '0 16px',
        flexShrink: 0,
      }}>
        {/* Current page title */}
        <div style={{
          flex: 1,
          fontFamily: 'var(--font-display)',
          fontSize: '0.95rem',
          color: 'var(--accent)',
          letterSpacing: '-0.01em',
        }}>
          {activeTab?.icon && <span style={{ marginRight: 8 }}>{activeTab.icon}</span>}
          {activeTab?.label ?? 'VAULT'}
        </div>

        {/* Selection badge shortcut */}
        {selectionCount > 0 && (
          <button onClick={() => navigate('selection')}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: '0.78rem', color: 'var(--muted)',
              marginRight: 12, padding: '8px 4px',
            }}>
            ☑
            <span style={{ background: 'var(--accent)', color: '#000', borderRadius: 10,
              padding: '1px 7px', fontSize: '0.7rem', fontWeight: 700 }}>
              {selectionCount}
            </span>
          </button>
        )}

        {/* Hamburger */}
        <button
          onClick={() => setMenuOpen(true)}
          style={{
            background: 'transparent', border: '1px solid var(--border)',
            borderRadius: 4, color: 'var(--text)', cursor: 'pointer',
            padding: '8px 12px', fontSize: '1.1rem', lineHeight: 1,
            minWidth: 44, minHeight: 44,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          ☰
        </button>
      </nav>

      {/* Full-screen page selector overlay */}
      {menuOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'var(--bg)',
          display: 'flex', flexDirection: 'column',
          paddingTop: 'var(--safe-top, 0px)',
          paddingBottom: 'var(--safe-bottom, 0px)',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: '1px solid var(--border)',
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--accent)' }}>
              VAULT
            </div>
            <button onClick={() => setMenuOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: 'var(--muted)',
                fontSize: '1.6rem', cursor: 'pointer', padding: '0 4px',
                minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
              ×
            </button>
          </div>

          {/* Nav items */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
            {tabs.map(tab => {
              const isActive = tab.id === active
              return (
                <button
                  key={tab.id}
                  onClick={() => navigate(tab.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 16,
                    padding: '18px 24px', background: isActive ? 'var(--surface)' : 'transparent',
                    border: 'none', borderLeft: `3px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                    cursor: 'pointer', textAlign: 'left',
                  }}>
                  <span style={{ fontSize: '1.4rem', width: 32, textAlign: 'center', flexShrink: 0 }}>
                    {tab.icon}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-display)', fontSize: '1rem',
                    letterSpacing: '0.04em',
                    color: isActive ? 'var(--accent)' : 'var(--text)',
                  }}>
                    {tab.label}
                  </span>
                  {tab.id === 'selection' && selectionCount > 0 && (
                    <span style={{ marginLeft: 'auto', background: 'var(--accent)', color: '#000',
                      borderRadius: 12, padding: '2px 10px', fontSize: '0.8rem', fontWeight: 700 }}>
                      {selectionCount}
                    </span>
                  )}
                  {isActive && (
                    <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: '0.9rem' }}>●</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Footer hint */}
          <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)',
            fontSize: '0.68rem', color: 'var(--muted)' }}>
            Tap a page to navigate
          </div>
        </div>
      )}
    </>
  )
}