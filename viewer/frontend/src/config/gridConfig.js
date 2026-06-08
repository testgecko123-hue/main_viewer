// ─── Grid size config ────────────────────────────────────────────────────────
// Edit these values to resize thumbnails across the whole app.
//
// DESKTOP  — minimum thumb width on wide screens
// MOBILE   — minimum thumb width on narrow screens
// GAP      — spacing between thumbs (px)
//
// The grid fills available width, so these are minimums —
// thumbs grow to fill the row. Smaller = more columns, larger = fewer.

export const GRID = {
  desktop: 320,   // px — Library, Subscriptions, Collections, Browse
  mobile:  150,   // px — same pages on narrow screens
  gap:       6,   // px — gap between all thumbs
}

// Helpers so you never have to write the repeat() string by hand
export const gridCols = {
  desktop: `repeat(auto-fill, minmax(${GRID.desktop}px, 1fr))`,
  mobile:  `repeat(auto-fill, minmax(${GRID.mobile}px, 1fr))`,
}