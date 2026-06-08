/** @typedef {{ id: string, name: string, ids: number[], index: number }} Subset */

export const EMPTY_SELECTION = {
  ids: [],
  index: 0,
  name: null,
  subsets: [],
  activeSubsetId: null,
}

/** IDs currently shown in the grid / viewer */
export function getActiveIds(selection) {
  if (!selection?.activeSubsetId) return selection?.ids ?? []
  const sub = selection.subsets?.find(s => s.id === selection.activeSubsetId)
  return sub?.ids ?? selection?.ids ?? []
}

/** Index for the active list (main or subset) */
export function getActiveIndex(selection) {
  if (!selection?.activeSubsetId) return selection?.index ?? 0
  const sub = selection.subsets?.find(s => s.id === selection.activeSubsetId)
  return sub?.index ?? 0
}

/** Update active list ids while preserving the other list */
export function setActiveIds(selection, ids) {
  if (!selection.activeSubsetId) {
    return { ...selection, ids }
  }
  return {
    ...selection,
    subsets: selection.subsets.map(s =>
      s.id === selection.activeSubsetId ? { ...s, ids } : s
    ),
  }
}

/** Update active list index */
export function setActiveIndex(selection, index) {
  if (!selection.activeSubsetId) {
    return { ...selection, index }
  }
  return {
    ...selection,
    subsets: selection.subsets.map(s =>
      s.id === selection.activeSubsetId ? { ...s, index } : s
    ),
  }
}

export function newSubsetId() {
  return `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}
