import { useState, useEffect, useRef, useCallback } from 'react'
import { EMPTY_SELECTION } from '../utils/selectionUtils.js'
import { apiFetch } from '../utils/api.js'

const SAVE_DEBOUNCE_MS = 500

function normalizeSelection(data) {
  const base = { ...EMPTY_SELECTION }
  if (!data || typeof data !== 'object') return base

  const ids = Array.isArray(data.ids) ? data.ids.map(Number).filter(n => !isNaN(n)) : []
  const index = typeof data.index === 'number'
    ? Math.min(Math.max(0, data.index), Math.max(0, ids.length - 1))
    : 0

  const subsets = Array.isArray(data.subsets)
    ? data.subsets.map(s => ({
        id: s.id || `sub_${Date.now()}`,
        name: s.name || 'Subset',
        ids: Array.isArray(s.ids) ? s.ids.map(Number).filter(n => !isNaN(n)) : [],
        index: typeof s.index === 'number' ? s.index : 0,
      }))
    : []

  const activeSubsetId = data.activeSubsetId || null

  return { ...base, ids, index, name: data.name ?? null, subsets, activeSubsetId }
}

function serializeSelection(s) {
  return JSON.stringify({
    ids: s.ids,
    index: s.index ?? 0,
    subsets: s.subsets ?? [],
    activeSubsetId: s.activeSubsetId ?? null,
  })
}

export default function useSelectionPersistence(selection, setSelection) {
  const [hydrated, setHydrated] = useState(false)
  const [saveStatus, setSaveStatus] = useState(null)
  const saveTimerRef = useRef(null)
  const selectionRef = useRef(selection)
  selectionRef.current = selection

  useEffect(() => {
    apiFetch('/api/selections/current')
      .then(r => r.json())
      .then(data => {
        const normalized = normalizeSelection(data)
        if (normalized.ids.length > 0 || normalized.subsets.length > 0) {
          setSelection(s => {
            if (s.ids.length > 0) return s
            return { ...s, ...normalized }
          })
        }
        setHydrated(true)
      })
      .catch(() => setHydrated(true))
  }, [setSelection])

  const saveNow = useCallback((sel) => {
    const s = sel || selectionRef.current
    const body = serializeSelection(s)
    setSaveStatus('saving')
    return apiFetch('/api/selections/current', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    })
      .then(r => {
        if (!r.ok) throw new Error('save failed')
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus(null), 1800)
      })
      .catch(() => setSaveStatus('error'))
  }, [])

  useEffect(() => {
    if (!hydrated) return
    clearTimeout(saveTimerRef.current)
    setSaveStatus('saving')
    saveTimerRef.current = setTimeout(() => { saveNow() }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(saveTimerRef.current)
  }, [
    selection.ids,
    selection.index,
    selection.subsets,
    selection.activeSubsetId,
    hydrated,
    saveNow,
  ])

  useEffect(() => {
    const onUnload = () => {
      const s = selectionRef.current
      apiFetch('/api/selections/current', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: serializeSelection(s),
        keepalive: true,
      }).catch(() => {})
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  return { saveNow, saveStatus, hydrated }
}
