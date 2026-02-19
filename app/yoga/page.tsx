'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import type { VideoQuality } from '@/components/VideoPlayer'
import { getVideoViewKey } from '@/lib/analytics-keys'

const VideoPlayer = dynamic(() => import('@/components/VideoPlayer'), { ssr: false })

interface VideoQualityData {
  src: string
  size: number
}

interface VideoLesson {
  title: string
  duration: string
  videoUrl?: string
  qualities?: VideoQualityData[]
  rutubeUrl?: string
  rutubeId?: string
  rutubeToken?: string
}

interface YogaPackage {
  id: string
  name: string
  level: string
  description: string
  videos: VideoLesson[]
  price: number
  image: string
  available: boolean
}

/* ---------- Визуальные стили для уровней ---------- */
const LEVEL_STYLES: Record<string, { badge: string; gradient: string; icon: string }> = {
  'Начинающий': {
    badge: 'bg-emerald-100 text-emerald-700',
    gradient: 'from-emerald-50 to-emerald-100',
    icon: '🌱',
  },
  'Средний': {
    badge: 'bg-amber-100 text-amber-700',
    gradient: 'from-amber-50 to-orange-100',
    icon: '🔥',
  },
  'Продвинутый': {
    badge: 'bg-purple-100 text-purple-700',
    gradient: 'from-purple-50 to-purple-100',
    icon: '⚡',
  },
  'Все уровни': {
    badge: 'bg-blue-100 text-blue-700',
    gradient: 'from-blue-50 to-indigo-100',
    icon: '🕉',
  },
}

const DEFAULT_LEVEL = {
  badge: 'bg-gray-100 text-gray-700',
  gradient: 'from-primary-50 to-primary-100',
  icon: '🧘',
}
const PACKAGE_PREVIEW_FALLBACK_ICON = '🕉'

/* ---------- Утилиты ---------- */

function priceLabel(price: number): string {
  return price === 0 ? 'Бесплатно' : `${price.toLocaleString('ru-RU')} ₽`
}

function parseDurationMinutes(value: string): number {
  const trimmed = String(value || '').trim()
  if (!trimmed) return 0
  const match = trimmed.match(/(\d+)/)
  if (!match) return 0
  const parsed = Number(match[1])
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.floor(parsed)
}

function formatDurationLabel(value: string): string {
  const minutes = parseDurationMinutes(value)
  if (minutes <= 0) return '0 мин'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} мин`
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`
}

function rutubeEmbedUrl(video: VideoLesson): string | null {
  const fromUrl = (video.rutubeUrl || '').trim()
  if (fromUrl) {
    try {
      const parsed = new URL(fromUrl)
      const host = parsed.hostname.toLowerCase()
      if (host === 'rutube.ru' || host === 'www.rutube.ru') {
        const parts = parsed.pathname.split('/').filter(Boolean)
        let videoId = ''

        if (parts[0] === 'video' && parts[1] === 'private' && parts[2]) {
          videoId = parts[2]
        } else if (parts[0] === 'video' && parts[1]) {
          videoId = parts[1]
        } else if (parts[0] === 'play' && parts[1] === 'embed' && parts[2]) {
          videoId = parts[2]
        }

        if (videoId) {
          const token = (parsed.searchParams.get('p') || '').trim()
          const base = `https://rutube.ru/play/embed/${videoId}/`
          return token ? `${base}?p=${encodeURIComponent(token)}` : base
        }
      }
    } catch {
      // fallback на старый формат ниже
    }
  }

  if (!video.rutubeId) return null
  const base = `https://rutube.ru/play/embed/${video.rutubeId}/`
  return video.rutubeToken ? `${base}?p=${video.rutubeToken}` : base
}

/* ---------- Компонент ---------- */
export default function YogaPage() {
  const [packages, setPackages] = useState<YogaPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPackage, setSelectedPackage] = useState<YogaPackage | null>(null)
  const [playingVideo, setPlayingVideo] = useState<VideoLesson | null>(null)
  const [playingVideoIndex, setPlayingVideoIndex] = useState<number | null>(null)
  const rutubeSessionRef = useRef<{
    packageId: string
    video: VideoLesson
    index: number
    startedAt: number
  } | null>(null)

  useEffect(() => {
    fetch('/api/yoga/packages')
      .then((r) => r.json())
      .then((data) => setPackages(data.packages || []))
      .catch(() => setPackages([]))
      .finally(() => setLoading(false))
  }, [])

  const visiblePackages = packages.filter((p) => p.available)

  const totalVideos = (pkg: YogaPackage) => pkg.videos.length
  const totalDuration = (pkg: YogaPackage) => {
    const minutes = pkg.videos.reduce((sum, v) => {
      return sum + parseDurationMinutes(v.duration)
    }, 0)
    if (minutes === 0) return ''
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return h > 0 ? `${h} ч ${m > 0 ? `${m} мин` : ''}` : `${m} мин`
  }

  const isFree = (pkg: YogaPackage) => pkg.price === 0
  const playingRutubeUrl = playingVideo ? rutubeEmbedUrl(playingVideo) : null

  function trackVideoView(packageId: string, video: VideoLesson, index: number) {
    const id = getVideoViewKey(packageId, video, index)
    void fetch('/api/analytics/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'video', id }),
      keepalive: true,
    }).catch(() => {})
  }

  function trackVideoSession(
    packageId: string,
    video: VideoLesson,
    index: number,
    watchSeconds: number,
    completed = false
  ) {
    const safeWatchSeconds = Math.floor(Math.max(0, watchSeconds))
    if (safeWatchSeconds <= 0 && !completed) return
    const id = getVideoViewKey(packageId, video, index)
    void fetch('/api/analytics/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'video',
        id,
        watchSeconds: safeWatchSeconds,
        completed,
        incrementView: false,
      }),
      keepalive: true,
    }).catch(() => {})
  }

  function stopRutubeSession() {
    const current = rutubeSessionRef.current
    if (!current) return
    const watchSeconds = (Date.now() - current.startedAt) / 1000
    trackVideoSession(current.packageId, current.video, current.index, watchSeconds, false)
    rutubeSessionRef.current = null
  }

  function closeVideoPlayer() {
    stopRutubeSession()
    setPlayingVideo(null)
    setPlayingVideoIndex(null)
  }

  function closePackageModal() {
    closeVideoPlayer()
    setSelectedPackage(null)
  }

  return (
    <div className="min-h-screen">
      {/* Шапка */}
      <section className="section-padding bg-gradient-to-br from-primary-50 to-accent-50">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-serif font-bold text-gray-900 mb-4">
            Видеоуроки
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Выберите пакет видеоуроков по вашему уровню. Каждый пакет — это полноценный курс
            с пошаговыми занятиями.
          </p>
        </div>
      </section>

      {/* Карточки пакетов */}
      <section className="section-padding bg-white">
        <div className="max-w-7xl mx-auto">
          {loading ? (
            <div className="text-center py-16">
              <p className="text-gray-500 text-lg">Загрузка пакетов...</p>
            </div>
          ) : visiblePackages.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-6xl mb-4">🧘</div>
              <p className="text-gray-500 text-lg">
                Пакеты скоро появятся. Следите за обновлениями!
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {visiblePackages.map((pkg) => {
                const style = LEVEL_STYLES[pkg.level] || DEFAULT_LEVEL
                const free = isFree(pkg)

                return (
                  <div
                    key={pkg.id}
                    className="card group cursor-pointer flex flex-col"
                    onClick={() => setSelectedPackage(pkg)}
                  >
                    {/* Визуальная шапка карточки */}
                    <div
                      className={`relative h-48 bg-gradient-to-br ${style.gradient} flex items-center justify-center overflow-hidden`}
                    >
                      {pkg.image && pkg.image.startsWith('/') ? (
                        <img
                          src={pkg.image}
                          alt={pkg.name}
                          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <span className="text-7xl group-hover:scale-110 transition-transform duration-300">
                          {pkg.image || PACKAGE_PREVIEW_FALLBACK_ICON}
                        </span>
                      )}

                      {/* Бейдж уровня */}
                      <div className="absolute top-3 left-3">
                        <span
                          className={`text-xs font-semibold px-3 py-1 rounded-full ${style.badge}`}
                        >
                          {pkg.level}
                        </span>
                      </div>

                      {/* Бейдж «Бесплатно» или кол-во уроков */}
                      <div className="absolute top-3 right-3 flex gap-2">
                        {free && (
                          <span className="bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm">
                            Бесплатно
                          </span>
                        )}
                        <span className="bg-white/90 backdrop-blur-sm rounded-full px-3 py-1 shadow-sm text-xs font-medium text-gray-700">
                          {totalVideos(pkg)} {totalVideos(pkg) === 1 ? 'урок' : totalVideos(pkg) < 5 ? 'урока' : 'уроков'}
                        </span>
                      </div>
                    </div>

                    {/* Контент */}
                    <div className="p-6 flex flex-col flex-1">
                      <h3 className="text-xl font-serif font-bold text-gray-900 mb-2 group-hover:text-primary-600 transition-colors">
                        {pkg.name}
                      </h3>
                      <p className="text-gray-600 text-sm mb-4 line-clamp-3 flex-1">
                        {pkg.description}
                      </p>

                      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                        <div className="flex items-center gap-3 text-sm text-gray-500">
                          <span className="flex items-center gap-1">
                            🎬 {totalVideos(pkg)} видео
                          </span>
                          {totalDuration(pkg) && (
                            <span className="flex items-center gap-1">
                              ⏱ {totalDuration(pkg)}
                            </span>
                          )}
                        </div>
                        <span className={`font-bold ${free ? 'text-green-600' : 'text-primary-600'}`}>
                          {priceLabel(pkg.price)}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── Модалка с деталями пакета ── */}
      {selectedPackage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closePackageModal()
            }
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Шапка */}
            {(() => {
              const style = LEVEL_STYLES[selectedPackage.level] || DEFAULT_LEVEL
              return (
                <div
                  className={`relative bg-gradient-to-br ${style.gradient} rounded-t-2xl overflow-hidden`}
                >
                  {selectedPackage.image && selectedPackage.image.startsWith('/') && (
                    <img
                      src={selectedPackage.image}
                      alt={selectedPackage.name}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}
                  {/* Затемнение поверх фото для читабельности текста */}
                  {selectedPackage.image && selectedPackage.image.startsWith('/') && (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-black/10" />
                  )}

                  <div className="relative p-8">
                    <button
                      onClick={() => {
                        closePackageModal()
                      }}
                      className="absolute top-4 right-4 p-2 bg-white/80 hover:bg-white rounded-lg transition-colors text-gray-600"
                      aria-label="Закрыть"
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>

                    <span
                      className={`inline-block text-xs font-semibold px-3 py-1 rounded-full ${
                        selectedPackage.image?.startsWith('/') ? 'bg-white/90 text-gray-800' : style.badge
                      } mb-3`}
                    >
                      {selectedPackage.level}
                    </span>
                    <h2 className={`text-3xl font-serif font-bold mb-2 ${
                      selectedPackage.image?.startsWith('/') ? 'text-white drop-shadow-lg' : 'text-gray-900'
                    }`}>
                      {selectedPackage.name}
                    </h2>
                    <div className={`flex items-center gap-4 text-sm ${
                      selectedPackage.image?.startsWith('/') ? 'text-white/90' : 'text-gray-600'
                    }`}>
                      <span>🎬 {totalVideos(selectedPackage)} видеоуроков</span>
                      {totalDuration(selectedPackage) && (
                        <span>⏱ {totalDuration(selectedPackage)}</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Содержание */}
            <div className="p-8">
              <p className="text-gray-700 leading-relaxed mb-6">
                {selectedPackage.description}
              </p>

              {/* Встроенный видеоплеер */}
              {playingVideo && (playingVideo.videoUrl || playingRutubeUrl) && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold text-gray-900">
                      {playingVideo.title}
                    </h3>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={closeVideoPlayer}
                        className="text-xs text-gray-500 hover:text-gray-700 underline"
                      >
                        Свернуть
                      </button>
                    </div>
                  </div>

                  {playingVideo.videoUrl ? (
                    /* Plyr-плеер для собственных файлов */
                    <VideoPlayer
                      key={playingVideo.videoUrl}
                      src={playingVideo.videoUrl}
                      qualities={playingVideo.qualities as VideoQuality[] | undefined}
                      storageKey={`${selectedPackage.id}-${selectedPackage.videos.indexOf(playingVideo)}`}
                      onSessionFinish={({ watchSeconds, completed }) => {
                        const index = playingVideoIndex ?? selectedPackage.videos.indexOf(playingVideo)
                        if (index < 0) return
                        trackVideoSession(selectedPackage.id, playingVideo, index, watchSeconds, completed)
                      }}
                    />
                  ) : (
                    /* Рутуб iframe */
                    <div className="relative w-full rounded-xl overflow-hidden bg-black" style={{ paddingTop: '56.25%' }}>
                      <iframe
                        src={playingRutubeUrl!}
                        className="absolute inset-0 w-full h-full"
                        frameBorder="0"
                        allow="clipboard-write; autoplay"
                        allowFullScreen
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Список видеоуроков */}
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Содержание курса
              </h3>
              <div className="space-y-2 mb-8">
                {selectedPackage.videos.map((video, i) => {
                  const hasVideo = !!(video.videoUrl || video.rutubeUrl || video.rutubeId)
                  const isPlaying = playingVideo === video

                  return (
                    <div
                      key={i}
                      className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
                        isPlaying
                          ? 'bg-primary-50 ring-2 ring-primary-300'
                          : hasVideo
                          ? 'bg-gray-50 hover:bg-primary-50 cursor-pointer'
                          : 'bg-gray-50'
                      }`}
                      onClick={() => {
                        if (!hasVideo) return
                        if (isPlaying) {
                          closeVideoPlayer()
                          return
                        }
                        stopRutubeSession()
                        setPlayingVideo(video)
                        setPlayingVideoIndex(i)
                        trackVideoView(selectedPackage.id, video, i)
                        if (!video.videoUrl) {
                          rutubeSessionRef.current = {
                            packageId: selectedPackage.id,
                            video,
                            index: i,
                            startedAt: Date.now(),
                          }
                        }
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${
                            isPlaying
                              ? 'bg-primary-500 text-white'
                              : hasVideo
                              ? 'bg-primary-100 text-primary-600'
                              : 'bg-gray-200 text-gray-500'
                          }`}
                        >
                          {isPlaying ? '▶' : i + 1}
                        </span>
                        <span className={`text-sm ${hasVideo ? 'text-gray-800' : 'text-gray-500'}`}>
                          {video.title}
                        </span>
                        {hasVideo && !isPlaying && (
                          <span className="text-primary-500 text-xs">▶ Смотреть</span>
                        )}
                      </div>
                      <span className="text-gray-500 text-xs flex-shrink-0 ml-3">
                        {formatDurationLabel(video.duration)}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Цена и кнопка */}
              {isFree(selectedPackage) ? (
                <div className="p-4 bg-green-50 rounded-xl text-center">
                  <span className="text-lg font-bold text-green-700">
                    Этот пакет бесплатный — смотрите прямо сейчас!
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between p-4 bg-primary-50 rounded-xl">
                  <div>
                    <span className="text-sm text-gray-600">Стоимость пакета</span>
                    <div className="text-2xl font-bold text-gray-900">
                      {priceLabel(selectedPackage.price)}
                    </div>
                  </div>
                  <a
                    href={`https://t.me/Zoya_yoga?text=${encodeURIComponent(
                      `Здравствуйте! Хочу приобрести пакет «${selectedPackage.name}» (${selectedPackage.price} ₽)`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.028-1.627 4.476-1.635z" />
                    </svg>
                    Купить
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
