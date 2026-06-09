/**
 * MobileNav.jsx
 *
 * On desktop: horizontal tab bar.
 * On mobile: header with page title+icon (left) and hamburger (right).
 * Dropdown includes all tabs + a Viewer option.
 */

import { useState } from 'react'
import useIsMobile from '../hooks/useIsMobile.js'

export default function MobileNav({ tabs = [], active, onChange, onOpenViewer }) {
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)

  const activeTab = tabs.find(t => t.id === active)

  function navigate(id) {
    onChange(id)
    setMenuOpen(false)
  }

  function openViewerAndClose() {
    if (onOpenViewer) onOpenViewer()
    setMenuOpen(false)
  }

  if (!isMobile) {
    // Desktop: horizontal nav bar — logo | tabs | viewer
    return (
      <nav style={{
        height: 'var(--nav-h)',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: 4, flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: '0.95rem',
          color: 'var(--accent)', letterSpacing: '0.1em',
          paddingRight: 16, marginRight: 8,
          borderRight: '1px solid var(--border)',
          whiteSpace: 'nowrap', userSelect: 'none',
        }}>
          VAULT
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
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
            </button>
          ))}
        </div>

        {/* Viewer button */}
        <button
          onClick={onOpenViewer}
          style={{
            marginLeft: 8,
            padding: '8px 14px', fontSize: '0.72rem', letterSpacing: '0.08em',
            background: 'transparent',
            borderTop: 'none', borderRight: 'none', borderBottom: '2px solid transparent',
            borderLeft: '1px solid var(--border)',
            color: 'var(--accent)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            whiteSpace: 'nowrap',
          }}>
          ▶ VIEWER
        </button>
      </nav>
    )
  }

  // Mobile: header with title+icon left, hamburger right
  return (
    <>
      <nav style={{
        height: 48,
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        flexShrink: 0,
      }}>
        {/* Left side: icon + page title */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: 'var(--font-display)',
          fontSize: '0.95rem',
          fontWeight: 500,
          color: 'var(--accent)',
        }}>
          {activeTab?.icon && <span style={{ fontSize: '1.1rem' }}>{activeTab.icon}</span>}
          <span>{activeTab?.label ?? 'VAULT'}</span>
        </div>

        {/* Right side: hamburger */}
        <button
          onClick={() => setMenuOpen(true)}
          style={{
            background: 'transparent', border: '1px solid var(--border)',
            borderRadius: 4, color: 'var(--text)', cursor: 'pointer',
            padding: '6px 10px', fontSize: '1.1rem', lineHeight: 1,
            minWidth: 40, minHeight: 40,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          ☰
        </button>
      </nav>

      {/* Full-screen dropdown menu */}
      {menuOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'var(--bg)',
          display: 'flex', flexDirection: 'column',
          paddingTop: 'var(--safe-top, 0px)',
          paddingBottom: 'var(--safe-bottom, 0px)',
        }}>
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
                minWidth: 44, minHeight: 44,
              }}>
              ×
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
            {/* Normal tabs */}
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
                  {isActive && (
                    <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: '0.9rem' }}>●</span>
                  )}
                </button>
              )
            })}

            {/* Separator + Viewer option */}
            <div style={{ height: 1, background: 'var(--border)', margin: '16px 24px' }} />
            <button
              onClick={openViewerAndClose}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 16,
                padding: '18px 24px', background: 'transparent',
                border: 'none', cursor: 'pointer', textAlign: 'left',
              }}>
              <span style={{ fontSize: '1.4rem', width: 32, textAlign: 'center' }}>▶</span>
              <span style={{
                fontFamily: 'var(--font-display)', fontSize: '1rem',
                letterSpacing: '0.04em', color: 'var(--accent)',
              }}>
                VIEWER
              </span>
            </button>
          </div>

          <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)',
            fontSize: '0.68rem', color: 'var(--muted)' }}>
            Tap a page to navigate
          </div>
        </div>
      )}
    </>
  )
}