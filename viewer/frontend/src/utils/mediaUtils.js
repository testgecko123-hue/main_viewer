/** Props for loading hotlink-protected CDN images (e.g. multporn.net). */
export const EXTERNAL_IMG_PROPS = { referrerPolicy: 'no-referrer' }

export function parseSourceMeta(post) {
  const raw = post?.source_meta
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/** Best thumbnail URL for grid cards and previews. */
export function postThumbUrl(post) {
  if (!post) return ''
  const meta = parseSourceMeta(post)
  if (post.media_type === 'comic' && meta.pages?.length) return meta.pages[0]
  return post.thumb_cdn || post.cdn_url || post.file_url || ''
}

export function preloadImage(url) {
  if (!url) return null
  const img = new Image()
  img.referrerPolicy = 'no-referrer'
  img.src = url
  return img
}
