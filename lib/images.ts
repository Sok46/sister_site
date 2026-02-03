/**
 * URL с Яндекс.Диска при запросе с сервера Next.js часто блокируются.
 * Для таких картинок используем unoptimized — браузер грузит их напрямую.
 */
export function isExternalImageUnoptimized(src: string): boolean {
  if (!src || typeof src !== 'string') return false
  try {
    const u = new URL(src, 'https://example.com')
    const h = u.hostname.toLowerCase()
    return h.includes('yandex') && (h.includes('disk') || h.includes('downloader'))
  } catch {
    return false
  }
}
