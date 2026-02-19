import fs from 'fs'
import path from 'path'

export type AnalyticsKind = 'video' | 'photo' | 'merch'

type DailyMap = Record<string, Record<string, number>>

interface AnalyticsStore {
  videos: Record<string, number>
  photos: Record<string, number>
  merch: Record<string, number>
  videoWatchSeconds: Record<string, number>
  videoSessions: Record<string, number>
  videoCompletions: Record<string, number>
  videosDaily: DailyMap
  photosDaily: DailyMap
  merchDaily: DailyMap
  videoWatchSecondsDaily: DailyMap
  videoSessionsDaily: DailyMap
  videoCompletionsDaily: DailyMap
  updatedAt: string
}

export interface AnalyticsDateRange {
  from?: string
  to?: string
}

const ANALYTICS_DIR = path.join(process.cwd(), 'content', 'analytics')
const ANALYTICS_FILE = path.join(ANALYTICS_DIR, 'views.json')

function ensureAnalyticsDir(): void {
  if (!fs.existsSync(ANALYTICS_DIR)) {
    fs.mkdirSync(ANALYTICS_DIR, { recursive: true })
  }
}

function emptyStore(): AnalyticsStore {
  return {
    videos: {},
    photos: {},
    merch: {},
    videoWatchSeconds: {},
    videoSessions: {},
    videoCompletions: {},
    videosDaily: {},
    photosDaily: {},
    merchDaily: {},
    videoWatchSecondsDaily: {},
    videoSessionsDaily: {},
    videoCompletionsDaily: {},
    updatedAt: new Date().toISOString(),
  }
}

function sanitizeMap(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const count = Number(value)
    if (!key) continue
    if (!Number.isFinite(count) || count < 0) continue
    out[key] = Math.floor(count)
  }
  return out
}

function sanitizeDailyMap(input: unknown): DailyMap {
  if (!input || typeof input !== 'object') return {}
  const out: DailyMap = {}
  for (const [id, value] of Object.entries(input as Record<string, unknown>)) {
    if (!id) continue
    out[id] = sanitizeMap(value)
  }
  return out
}

function readStore(): AnalyticsStore {
  ensureAnalyticsDir()
  if (!fs.existsSync(ANALYTICS_FILE)) {
    const initial = emptyStore()
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(initial, null, 2), 'utf8')
    return initial
  }

  try {
    const raw = fs.readFileSync(ANALYTICS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<AnalyticsStore>
    return {
      videos: sanitizeMap(parsed.videos),
      photos: sanitizeMap(parsed.photos),
      merch: sanitizeMap(parsed.merch),
      videoWatchSeconds: sanitizeMap(parsed.videoWatchSeconds),
      videoSessions: sanitizeMap(parsed.videoSessions),
      videoCompletions: sanitizeMap(parsed.videoCompletions),
      videosDaily: sanitizeDailyMap(parsed.videosDaily),
      photosDaily: sanitizeDailyMap(parsed.photosDaily),
      merchDaily: sanitizeDailyMap(parsed.merchDaily),
      videoWatchSecondsDaily: sanitizeDailyMap(parsed.videoWatchSecondsDaily),
      videoSessionsDaily: sanitizeDailyMap(parsed.videoSessionsDaily),
      videoCompletionsDaily: sanitizeDailyMap(parsed.videoCompletionsDaily),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch {
    const initial = emptyStore()
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(initial, null, 2), 'utf8')
    return initial
  }
}

function writeStore(store: AnalyticsStore): void {
  ensureAnalyticsDir()
  fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(store, null, 2), 'utf8')
}

function bucketKey(kind: AnalyticsKind): keyof Pick<AnalyticsStore, 'videos' | 'photos' | 'merch'> {
  if (kind === 'video') return 'videos'
  if (kind === 'photo') return 'photos'
  return 'merch'
}

function dailyBucketKey(
  kind: AnalyticsKind
): keyof Pick<AnalyticsStore, 'videosDaily' | 'photosDaily' | 'merchDaily'> {
  if (kind === 'video') return 'videosDaily'
  if (kind === 'photo') return 'photosDaily'
  return 'merchDaily'
}

function normalizeDate(input: string): string | null {
  const value = String(input || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  return value
}

function dateInRange(date: string, range: AnalyticsDateRange): boolean {
  const from = normalizeDate(range.from || '')
  const to = normalizeDate(range.to || '')
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

function sumInRange(perDay: Record<string, number> | undefined, range: AnalyticsDateRange): number {
  if (!perDay) return 0
  let total = 0
  for (const [date, count] of Object.entries(perDay)) {
    if (!dateInRange(date, range)) continue
    total += count
  }
  return total
}

function getCountsWithRange(
  totals: Record<string, number>,
  daily: DailyMap,
  range: AnalyticsDateRange
): Record<string, number> {
  const hasRange = Boolean(normalizeDate(range.from || '') || normalizeDate(range.to || ''))
  if (!hasRange) return totals

  const ids = new Set<string>([
    ...Object.keys(totals || {}),
    ...Object.keys(daily || {}),
  ])

  const out: Record<string, number> = {}
  for (const id of ids) {
    if (!id) continue
    const hasDaily = Boolean(daily[id] && Object.keys(daily[id]).length > 0)
    // Для старых данных без помесячной/подневной детализации оставляем total.
    out[id] = hasDaily ? sumInRange(daily[id], range) : totals[id] || 0
  }
  return out
}

export function getAnalyticsSnapshot(range: AnalyticsDateRange = {}): AnalyticsStore {
  const store = readStore()
  return {
    videos: getCountsWithRange(store.videos, store.videosDaily, range),
    photos: getCountsWithRange(store.photos, store.photosDaily, range),
    merch: getCountsWithRange(store.merch, store.merchDaily, range),
    videoWatchSeconds: getCountsWithRange(
      store.videoWatchSeconds,
      store.videoWatchSecondsDaily,
      range
    ),
    videoSessions: getCountsWithRange(store.videoSessions, store.videoSessionsDaily, range),
    videoCompletions: getCountsWithRange(store.videoCompletions, store.videoCompletionsDaily, range),
    videosDaily: store.videosDaily,
    photosDaily: store.photosDaily,
    merchDaily: store.merchDaily,
    videoWatchSecondsDaily: store.videoWatchSecondsDaily,
    videoSessionsDaily: store.videoSessionsDaily,
    videoCompletionsDaily: store.videoCompletionsDaily,
    updatedAt: store.updatedAt,
  }
}

function addToDaily(daily: DailyMap, id: string, date: string, delta: number): void {
  if (!daily[id]) {
    daily[id] = {}
  }
  daily[id][date] = (daily[id][date] || 0) + delta
}

export function trackAnalyticsView(
  kind: AnalyticsKind,
  id: string,
  options?: { watchSeconds?: number; completed?: boolean; incrementView?: boolean }
): number {
  const safeId = String(id || '').trim()
  if (!safeId) return 0

  const store = readStore()
  const bucket = bucketKey(kind)
  const dailyBucket = dailyBucketKey(kind)
  const today = new Date().toISOString().slice(0, 10)
  const current = store[bucket][safeId] || 0
  const shouldIncrementView = options?.incrementView !== false
  const next = shouldIncrementView ? current + 1 : current
  if (shouldIncrementView) {
    store[bucket][safeId] = next
    addToDaily(store[dailyBucket], safeId, today, 1)
  }

  if (kind === 'video') {
    const watchSecondsRaw = Number(options?.watchSeconds)
    const watchSeconds =
      Number.isFinite(watchSecondsRaw) && watchSecondsRaw > 0 ? Math.floor(watchSecondsRaw) : 0
    const completed = Boolean(options?.completed)
    const hasSessionMetrics = watchSeconds > 0 || completed

    if (hasSessionMetrics) {
      store.videoSessions[safeId] = (store.videoSessions[safeId] || 0) + 1
      addToDaily(store.videoSessionsDaily, safeId, today, 1)
    }
    if (watchSeconds > 0) {
      store.videoWatchSeconds[safeId] = (store.videoWatchSeconds[safeId] || 0) + watchSeconds
      addToDaily(store.videoWatchSecondsDaily, safeId, today, watchSeconds)
    }
    if (completed) {
      store.videoCompletions[safeId] = (store.videoCompletions[safeId] || 0) + 1
      addToDaily(store.videoCompletionsDaily, safeId, today, 1)
    }
  }

  store.updatedAt = new Date().toISOString()
  writeStore(store)
  return next
}
