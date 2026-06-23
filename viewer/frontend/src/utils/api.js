/** Backend base URL. Empty in dev (Vite proxies /api to Flask). Set for Android builds. */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

/** Auth token for remote/mobile API calls (matches backend VIEWER_AUTH_TOKEN). */
const AUTH_TOKEN = (import.meta.env.VITE_AUTH_TOKEN ?? '').trim()

export function authHeaders() {
  if (!AUTH_TOKEN || !API_BASE) return {}
  return { 'X-Viewer-Token': AUTH_TOKEN }
}

export function apiPath(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE}${normalized}`
}

export function apiFetch(path, init = {}) {
  const headers = { ...authHeaders(), ...(init.headers || {}) }
  return fetch(apiPath(path), {
    credentials: API_BASE ? 'include' : 'same-origin',
    ...init,
    headers,
  })
}

export function apiEventSource(path) {
  let url = apiPath(path)
  if (AUTH_TOKEN && API_BASE) {
    const sep = url.includes('?') ? '&' : '?'
    url = `${url}${sep}viewer_token=${encodeURIComponent(AUTH_TOKEN)}`
  }
  return new EventSource(url, { withCredentials: !!API_BASE })
}
