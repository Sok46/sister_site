'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { PlaylistItem } from '@/lib/playlist'
import type { Post } from '@/lib/posts'
import type { VideoLesson, YogaPackage } from '@/lib/yoga'
import { getMerchViewKey, getPhotoViewKey, getVideoViewKey } from '@/lib/analytics-keys'

type Tab = 'home' | 'yoga' | 'playlist' | 'merch' | 'posts' | 'analytics' | 'files' | 'bookings'

interface Snapshot {
  yogaPackages: YogaPackage[]
  playlistItems: PlaylistItem[]
  posts: Post[]
  merchProducts: MerchProduct[]
  galleryPhotos: Array<{ name: string; path: string; album?: string }>
  homeGallerySelection: string[]
  homeHero: {
    words: [string, string, string]
    tagline: string
    image: string
    imageAlt: string
    intro: string
  }
}

interface AnalyticsSnapshot {
  videos: Record<string, number>
  photos: Record<string, number>
  merch: Record<string, number>
  videoWatchSeconds: Record<string, number>
  videoSessions: Record<string, number>
  videoCompletions: Record<string, number>
  updatedAt: string
  period?: {
    from: string | null
    to: string | null
  }
}

interface PublicFileEntry {
  name: string
  kind: 'dir' | 'file'
  relativePath: string
  size: number | null
  updatedAt: string
  publicUrl: string | null
}

interface PublicImageEntry {
  name: string
  relativePath: string
  publicUrl: string
  folder: 'photos' | 'notgallery'
}

interface MerchProduct {
  id: string
  name: string
  description: string
  story?: string
  price: number
  sizes: string[]
  color: string
  image: string
  available: boolean
}

interface PublicMediaEntry {
  name: string
  relativePath: string
  publicUrl: string
}

interface AdminBooking {
  id: string
  date: string
  time: string
  name: string
  phone: string
  comment: string
  createdAt: string
}

type SlotsByDate = Record<string, string[]>

function asNumber(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatFileSize(size: number | null): string {
  if (size === null) return 'Папка'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function isVideoFilePath(filePath: string): boolean {
  return /\.(mp4|webm|mov|m4v|ogv)$/i.test(filePath)
}

function isImageFilePath(filePath: string): boolean {
  return /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(filePath)
}

function isAudioFilePath(filePath: string): boolean {
  return /\.(mp3|wav|m4a|ogg)$/i.test(filePath)
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

function durationMinutesInputValue(value: string): string {
  const minutes = parseDurationMinutes(value)
  return minutes > 0 ? String(minutes) : ''
}

function uniquePhotoPaths(paths: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of paths) {
    const value = String(raw || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function formatAlbumLabel(value: string): string {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return 'Без альбома'
  if (raw === 'general') return 'Общие'
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (m) => m.toUpperCase())
}

function formatWatchSeconds(value: number): string {
  const sec = Math.max(0, Math.floor(Number(value) || 0))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function defaultHomeHero() {
  return {
    words: ['ЙОГА', 'СЕМЬЯ', 'ГОРЫ'] as [string, string, string],
    tagline: 'Здесь живёт ваш баланс',
    image: '/photos/main.jpg',
    imageAlt: 'Зоя',
    intro: 'Привет! Я Зоя. А это — пространство для тех, кто ищет точку опоры в ритме современной жизни.',
  }
}

function AdminPageContent() {
  const searchParams = useSearchParams()
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('home')
  const [data, setData] = useState<Snapshot | null>(null)
  const [currentPublicPath, setCurrentPublicPath] = useState('')
  const [publicParentPath, setPublicParentPath] = useState<string | null>(null)
  const [publicEntries, setPublicEntries] = useState<PublicFileEntry[]>([])
  const [publicLoading, setPublicLoading] = useState(false)
  const [publicError, setPublicError] = useState('')
  const [fileToUpload, setFileToUpload] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [autoBooted, setAutoBooted] = useState(false)
  const [bookingLoading, setBookingLoading] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const [bookingSlots, setBookingSlots] = useState<SlotsByDate>({})
  const [bookings, setBookings] = useState<AdminBooking[]>([])
  const [slotDateInput, setSlotDateInput] = useState('')
  const [slotStartInput, setSlotStartInput] = useState('')
  const [slotEndInput, setSlotEndInput] = useState('')
  const [bookingFilterDate, setBookingFilterDate] = useState('')
  const [imagePickerOpen, setImagePickerOpen] = useState(false)
  const [imagePickerLoading, setImagePickerLoading] = useState(false)
  const [imagePickerError, setImagePickerError] = useState('')
  const [imagePickerItems, setImagePickerItems] = useState<PublicImageEntry[]>([])
  const [merchImagePickerOpen, setMerchImagePickerOpen] = useState(false)
  const [merchImagePickerLoading, setMerchImagePickerLoading] = useState(false)
  const [merchImagePickerError, setMerchImagePickerError] = useState('')
  const [merchImagePickerItems, setMerchImagePickerItems] = useState<PublicMediaEntry[]>([])
  const [audioPickerOpen, setAudioPickerOpen] = useState(false)
  const [audioPickerLoading, setAudioPickerLoading] = useState(false)
  const [audioPickerError, setAudioPickerError] = useState('')
  const [audioPickerItems, setAudioPickerItems] = useState<PublicMediaEntry[]>([])
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsError, setAnalyticsError] = useState('')
  const [analyticsData, setAnalyticsData] = useState<AnalyticsSnapshot | null>(null)
  const [analyticsFromDate, setAnalyticsFromDate] = useState('')
  const [analyticsToDate, setAnalyticsToDate] = useState('')
  const [collapsedPhotoAlbums, setCollapsedPhotoAlbums] = useState<Record<string, boolean>>({})

  const [selectedYogaId, setSelectedYogaId] = useState<string | null>(null)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null)
  const [selectedMerchId, setSelectedMerchId] = useState<string | null>(null)
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)

  const selectedYoga = useMemo(
    () => data?.yogaPackages.find((item) => item.id === selectedYogaId) || null,
    [data, selectedYogaId]
  )
  const selectedPlaylist = useMemo(
    () => data?.playlistItems.find((item) => item.id === selectedPlaylistId) || null,
    [data, selectedPlaylistId]
  )
  const selectedPost = useMemo(
    () => data?.posts.find((item) => item.id === selectedPostId) || null,
    [data, selectedPostId]
  )
  const selectedMerch = useMemo(
    () => data?.merchProducts.find((item) => item.id === selectedMerchId) || null,
    [data, selectedMerchId]
  )

  async function loadSnapshot() {
    setLoading(true)
    setError('')
    setSaved('')
    try {
      const response = await fetch('/api/admin/content', {
        headers: {
          'x-admin-token': token.trim(),
        },
      })
      const payload = await response.json()
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'Не удалось загрузить данные')
      }
      const snapshot: Snapshot = {
        yogaPackages: payload.yogaPackages || [],
        playlistItems: payload.playlistItems || [],
        posts: payload.posts || [],
        merchProducts: payload.merchProducts || [],
        galleryPhotos: payload.galleryPhotos || [],
        homeGallerySelection: payload.homeGallerySelection || [],
        homeHero: payload.homeHero || defaultHomeHero(),
      }
      setData(snapshot)
      if (!selectedYogaId && snapshot.yogaPackages.length > 0) {
        setSelectedYogaId(snapshot.yogaPackages[0].id)
      }
      if (!selectedPlaylistId && snapshot.playlistItems.length > 0) {
        setSelectedPlaylistId(snapshot.playlistItems[0].id)
      }
      if (!selectedMerchId && snapshot.merchProducts.length > 0) {
        setSelectedMerchId(snapshot.merchProducts[0].id)
      }
      if (!selectedPostId && snapshot.posts.length > 0) {
        setSelectedPostId(snapshot.posts[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  async function runAction(body: Record<string, unknown>, successMessage: string) {
    setLoading(true)
    setError('')
    setSaved('')
    try {
      const response = await fetch('/api/admin/content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token.trim(),
        },
        body: JSON.stringify(body),
      })
      const payload = await response.json()
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'Операция завершилась ошибкой')
      }
      const snapshot: Snapshot = {
        yogaPackages: payload.yogaPackages || [],
        playlistItems: payload.playlistItems || [],
        posts: payload.posts || [],
        merchProducts: payload.merchProducts || [],
        galleryPhotos: payload.galleryPhotos || [],
        homeGallerySelection: payload.homeGallerySelection || [],
        homeHero: payload.homeHero || defaultHomeHero(),
      }
      setData(snapshot)
      setSaved(successMessage)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения')
    } finally {
      setLoading(false)
    }
  }

  async function loadPublicFiles(targetPath = '') {
    setPublicLoading(true)
    setPublicError('')
    try {
      const response = await fetch(`/api/admin/files?path=${encodeURIComponent(targetPath)}`, {
        headers: {
          'x-admin-token': token.trim(),
        },
      })
      const payload = await response.json()
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'Не удалось загрузить public')
      }

      setCurrentPublicPath(payload.currentPath || '')
      setPublicParentPath(payload.parentPath ?? null)
      setPublicEntries(payload.entries || [])
    } catch (err) {
      setPublicError(err instanceof Error ? err.message : 'Ошибка загрузки public')
    } finally {
      setPublicLoading(false)
    }
  }

  async function uploadToCurrentFolder() {
    if (!fileToUpload) return
    setPublicError('')
    setUploading(true)
    setUploadProgress(0)
    try {
      const formData = new FormData()
      formData.append('file', fileToUpload)

      const payload = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `/api/admin/files?path=${encodeURIComponent(currentPublicPath)}`)
        xhr.setRequestHeader('x-admin-token', token.trim())

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return
          const percent = Math.round((event.loaded / event.total) * 100)
          setUploadProgress(percent)
        }

        xhr.onerror = () => {
          reject(new Error('Ошибка сети при загрузке файла'))
        }

        xhr.onload = () => {
          let parsed: Record<string, unknown> = {}
          try {
            parsed = JSON.parse(xhr.responseText || '{}') as Record<string, unknown>
          } catch {
            reject(new Error('Некорректный ответ сервера'))
            return
          }

          if (xhr.status < 200 || xhr.status >= 300 || parsed.error) {
            reject(new Error(String(parsed.error || 'Ошибка загрузки файла')))
            return
          }
          resolve(parsed)
        }

        xhr.send(formData)
      })
      const messageParts = [`Файл загружен: ${payload.fileName}`]
      if (payload.transcoded) {
        messageParts.push('Видео перекодировано в web-mp4')
      }
      if (payload.warning) {
        messageParts.push(String(payload.warning))
      }
      setSaved(messageParts.join('. '))
      setFileToUpload(null)
      setUploadProgress(100)
      await loadPublicFiles(currentPublicPath)
    } catch (err) {
      setPublicError(err instanceof Error ? err.message : 'Ошибка загрузки')
    } finally {
      setUploading(false)
      setTimeout(() => setUploadProgress(0), 600)
    }
  }

  async function deletePublicFile(relativePath: string) {
    const confirmed = window.confirm(
      `Удалить файл "/${relativePath}"? Это действие нельзя отменить.`
    )
    if (!confirmed) return

    setPublicError('')
    try {
      const response = await fetch(
        `/api/admin/files?target=${encodeURIComponent(relativePath)}`,
        {
          method: 'DELETE',
          headers: {
            'x-admin-token': token.trim(),
          },
        }
      )
      const payload = await response.json()
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'Ошибка удаления файла')
      }
      setSaved(`Файл удален: ${relativePath}`)
      await loadPublicFiles(currentPublicPath)
    } catch (err) {
      setPublicError(err instanceof Error ? err.message : 'Ошибка удаления')
    }
  }

  async function renamePublicFile(relativePath: string, currentName: string) {
    const nextNameRaw = window.prompt('Новое имя файла:', currentName)
    if (nextNameRaw === null) return
    const nextName = nextNameRaw.trim()
    if (!nextName || nextName === currentName) return

    setPublicError('')
    try {
      const response = await fetch('/api/admin/files', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token.trim(),
        },
        body: JSON.stringify({
          target: relativePath,
          newName: nextName,
        }),
      })
      const payload = await response.json()
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'Ошибка переименования файла')
      }
      setSaved(`Файл переименован: ${currentName} -> ${payload.fileName || nextName}`)
      await loadPublicFiles(currentPublicPath)
    } catch (err) {
      setPublicError(err instanceof Error ? err.message : 'Ошибка переименования')
    }
  }

  async function loadBookingsAdmin() {
    setBookingLoading(true)
    setBookingError('')
    try {
      const response = await fetch('/api/admin/bookings', {
        headers: {
          'x-admin-token': token.trim(),
        },
      })
      const payload = await response.json()
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'Не удалось загрузить записи')
      }
      setBookingSlots(payload.slots || {})
      setBookings(payload.bookings || [])
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : 'Ошибка загрузки')
    } finally {
      setBookingLoading(false)
    }
  }

  async function loadYogaImagePickerItems() {
    setImagePickerLoading(true)
    setImagePickerError('')
    try {
      const folders: Array<'photos' | 'notgallery'> = ['photos', 'notgallery']
      const chunks = await Promise.all(
        folders.map(async (folder) => {
          const response = await fetch(`/api/admin/files?path=${encodeURIComponent(folder)}`, {
            headers: {
              'x-admin-token': token.trim(),
            },
          })
          const payload = await response.json()
          if (!response.ok || payload.error) {
            throw new Error(payload.error || `Не удалось загрузить /${folder}`)
          }
          const entries = (payload.entries || []) as PublicFileEntry[]
          return entries
            .filter((entry) => entry.kind === 'file' && entry.publicUrl && isImageFilePath(entry.publicUrl))
            .map((entry) => ({
              name: entry.name,
              relativePath: entry.relativePath,
              publicUrl: entry.publicUrl as string,
              folder,
            }))
        })
      )
      const merged = chunks.flat().sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'ru'))
      setImagePickerItems(merged)
    } catch (err) {
      setImagePickerError(err instanceof Error ? err.message : 'Ошибка загрузки изображений')
    } finally {
      setImagePickerLoading(false)
    }
  }

  async function loadPlaylistAudioPickerItems() {
    setAudioPickerLoading(true)
    setAudioPickerError('')
    try {
      const response = await fetch(`/api/admin/files?path=${encodeURIComponent('audio')}`, {
        headers: {
          'x-admin-token': token.trim(),
        },
      })
      const payload = await response.json()
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'Не удалось загрузить /audio')
      }
      const entries = (payload.entries || []) as PublicFileEntry[]
      const items = entries
        .filter((entry) => entry.kind === 'file' && entry.publicUrl && isAudioFilePath(entry.publicUrl))
        .map((entry) => ({
          name: entry.name,
          relativePath: entry.relativePath,
          publicUrl: entry.publicUrl as string,
        }))
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'ru'))
      setAudioPickerItems(items)
    } catch (err) {
      setAudioPickerError(err instanceof Error ? err.message : 'Ошибка загрузки аудио')
    } finally {
      setAudioPickerLoading(false)
    }
  }

  async function loadMerchImagePickerItems() {
    setMerchImagePickerLoading(true)
    setMerchImagePickerError('')
    try {
      const response = await fetch(`/api/admin/files?path=${encodeURIComponent('notgallery')}`, {
        headers: {
          'x-admin-token': token.trim(),
        },
      })
      const payload = await response.json()
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'Не удалось загрузить /notgallery')
      }
      const entries = (payload.entries || []) as PublicFileEntry[]
      const items = entries
        .filter((entry) => entry.kind === 'file' && entry.publicUrl && isImageFilePath(entry.publicUrl))
        .map((entry) => ({
          name: entry.name,
          relativePath: entry.relativePath,
          publicUrl: entry.publicUrl as string,
        }))
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'ru'))
      setMerchImagePickerItems(items)
    } catch (err) {
      setMerchImagePickerError(err instanceof Error ? err.message : 'Ошибка загрузки изображений')
    } finally {
      setMerchImagePickerLoading(false)
    }
  }

  async function loadAnalyticsStudio(override?: { from?: string; to?: string }) {
    const fromDate = override?.from ?? analyticsFromDate
    const toDate = override?.to ?? analyticsToDate

    if (fromDate && toDate && fromDate > toDate) {
      setAnalyticsError('Дата "С" не может быть позже даты "По"')
      return
    }

    setAnalyticsLoading(true)
    setAnalyticsError('')
    try {
      const params = new URLSearchParams()
      if (fromDate) params.set('from', fromDate)
      if (toDate) params.set('to', toDate)
      const query = params.toString()
      const response = await fetch(`/api/admin/analytics${query ? `?${query}` : ''}`, {
        headers: {
          'x-admin-token': token.trim(),
        },
      })
      const payload = await response.json()
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'Не удалось загрузить аналитику')
      }
      setAnalyticsData({
        videos: payload.videos || {},
        photos: payload.photos || {},
        merch: payload.merch || {},
        videoWatchSeconds: payload.videoWatchSeconds || {},
        videoSessions: payload.videoSessions || {},
        videoCompletions: payload.videoCompletions || {},
        updatedAt: payload.updatedAt || '',
        period: payload.period || { from: null, to: null },
      })
    } catch (err) {
      setAnalyticsError(err instanceof Error ? err.message : 'Ошибка загрузки аналитики')
    } finally {
      setAnalyticsLoading(false)
    }
  }

  async function runBookingsAction(body: Record<string, unknown>, successMessage: string) {
    setBookingLoading(true)
    setBookingError('')
    setSaved('')
    try {
      const response = await fetch('/api/admin/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token.trim(),
        },
        body: JSON.stringify(body),
      })
      const payload = await response.json()
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'Не удалось выполнить действие')
      }
      setBookingSlots(payload.slots || {})
      setBookings(payload.bookings || [])
      setSaved(successMessage)
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : 'Ошибка действия')
    } finally {
      setBookingLoading(false)
    }
  }

  const uploadKind = useMemo(() => {
    const first = (currentPublicPath || '').split('/')[0]
    if (first === 'videos') return 'video'
    if (first === 'photos') return 'photo'
    if (first === 'audio') return 'audio'
    return null
  }, [currentPublicPath])

  const uploadAccept = useMemo(() => {
    if (uploadKind === 'video') {
      return 'video/mp4,video/webm,video/quicktime,.mp4,.mov,.m4v,.webm,.ogv'
    }
    if (uploadKind === 'photo') {
      return 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif'
    }
    if (uploadKind === 'audio') {
      return 'audio/mpeg,audio/wav,audio/x-m4a,audio/ogg,.mp3,.wav,.m4a,.ogg'
    }
    return ''
  }, [uploadKind])

  useEffect(() => {
    const savedToken = sessionStorage.getItem('admin-token') || ''
    if (savedToken) {
      setToken(savedToken)
    }
  }, [])

  useEffect(() => {
    const value = token.trim()
    if (value) {
      sessionStorage.setItem('admin-token', value)
    } else {
      sessionStorage.removeItem('admin-token')
    }
  }, [token])

  useEffect(() => {
    const tab = searchParams.get('tab')
    const path = searchParams.get('path') || ''
    if (tab === 'files') {
      setActiveTab('files')
    }
    if (autoBooted || !token.trim()) return

    setAutoBooted(true)
    void loadSnapshot()
    if (tab === 'files') {
      void loadPublicFiles(path)
    }
  }, [searchParams, token, autoBooted])

  function updateSelectedYoga(patch: Partial<YogaPackage>) {
    if (!data || !selectedYoga) return
    setData({
      ...data,
      yogaPackages: data.yogaPackages.map((item) =>
        item.id === selectedYoga.id ? { ...item, ...patch } : item
      ),
    })
  }

  function updateSelectedVideo(index: number, patch: Partial<VideoLesson>) {
    if (!selectedYoga) return
    const nextVideos = selectedYoga.videos.map((video, i) =>
      i === index ? { ...video, ...patch } : video
    )
    updateSelectedYoga({ videos: nextVideos })
  }

  function updateSelectedPlaylist(patch: Partial<PlaylistItem>) {
    if (!data || !selectedPlaylist) return
    setData({
      ...data,
      playlistItems: data.playlistItems.map((item) =>
        item.id === selectedPlaylist.id ? { ...item, ...patch } : item
      ),
    })
  }

  function updateSelectedPost(patch: Partial<Post>) {
    if (!data || !selectedPost) return
    setData({
      ...data,
      posts: data.posts.map((item) =>
        item.id === selectedPost.id ? { ...item, ...patch } : item
      ),
    })
  }

  function updateSelectedMerch(patch: Partial<MerchProduct>) {
    if (!data || !selectedMerch) return
    setData({
      ...data,
      merchProducts: data.merchProducts.map((item) =>
        item.id === selectedMerch.id ? { ...item, ...patch } : item
      ),
    })
  }

  function toggleHomeGalleryPhoto(photoPath: string) {
    if (!data) return
    const current = uniquePhotoPaths(data.homeGallerySelection || [])
    const exists = current.includes(photoPath)
    if (exists) {
      setData({ ...data, homeGallerySelection: current.filter((path) => path !== photoPath) })
      return
    }
    if (current.length >= 4) {
      setError('Для главной страницы можно выбрать только 4 фотографии')
      return
    }
    setError('')
    setData({ ...data, homeGallerySelection: [...current, photoPath] })
  }

  function updateHomeHero(patch: Partial<Snapshot['homeHero']>) {
    if (!data) return
    setData({
      ...data,
      homeHero: {
        ...(data.homeHero || defaultHomeHero()),
        ...patch,
      },
    })
  }

  const bookingDates = useMemo(
    () => Object.keys(bookingSlots || {}).sort((a, b) => a.localeCompare(b)),
    [bookingSlots]
  )
  const filteredBookings = useMemo(
    () =>
      (bookings || []).filter((item) =>
        bookingFilterDate ? item.date === bookingFilterDate : true
      ),
    [bookings, bookingFilterDate]
  )
  const analyticsVideoRows = useMemo(() => {
    if (!data) return []
    return data.yogaPackages.flatMap((pkg) =>
      pkg.videos.map((video, index) => {
        const id = getVideoViewKey(pkg.id, video, index)
        return {
          id,
          packageName: pkg.name,
          title: video.title || `Видео ${index + 1}`,
          count: analyticsData?.videos?.[id] || 0,
          watchSeconds: analyticsData?.videoWatchSeconds?.[id] || 0,
          sessions: analyticsData?.videoSessions?.[id] || 0,
          completions: analyticsData?.videoCompletions?.[id] || 0,
        }
      })
    )
  }, [data, analyticsData])
  const analyticsPhotoRows = useMemo(() => {
    if (!data) return []
    return data.galleryPhotos.map((photo) => {
      const id = getPhotoViewKey(photo.path)
      return {
        id,
        name: photo.name,
        path: photo.path,
        album: photo.album || 'general',
        count: analyticsData?.photos?.[id] || 0,
      }
    })
  }, [data, analyticsData])
  const analyticsPhotoAlbums = useMemo(() => {
    const grouped = new Map<string, Array<(typeof analyticsPhotoRows)[number]>>()
    for (const row of analyticsPhotoRows) {
      const key = row.album || 'general'
      if (!grouped.has(key)) {
        grouped.set(key, [])
      }
      grouped.get(key)!.push(row)
    }
    return Array.from(grouped.entries())
      .map(([album, rows]) => ({
        album,
        label: formatAlbumLabel(album),
        totalCount: rows.reduce((sum, item) => sum + item.count, 0),
        rows: rows.sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'))
  }, [analyticsPhotoRows])
  const analyticsMerchRows = useMemo(() => {
    if (!data) return []
    return data.merchProducts.map((product) => {
      const id = getMerchViewKey(product.id)
      return {
        id,
        name: product.name,
        productId: product.id,
        count: analyticsData?.merch?.[id] || 0,
      }
    })
  }, [data, analyticsData])

  useEffect(() => {
    setImagePickerOpen(false)
    setImagePickerError('')
  }, [selectedYogaId])

  useEffect(() => {
    setAudioPickerOpen(false)
    setAudioPickerError('')
  }, [selectedPlaylistId])

  useEffect(() => {
    setMerchImagePickerOpen(false)
    setMerchImagePickerError('')
  }, [selectedMerchId])

  return (
    <div className="section-padding">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="card p-6">
          <h1 className="text-3xl font-serif font-bold text-gray-900 mb-2">
            Админка контента
          </h1>
          <p className="text-gray-600 mb-4">
            Управление пакетами йоги, постами и аудио прямо с сайта. Страницы для посетителей остаются без
            изменений.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Токен из Telegram-бота"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
            />
            <button className="btn-primary" onClick={loadSnapshot} disabled={loading || !token.trim()}>
              {loading ? 'Загрузка...' : 'Подключиться'}
            </button>
          </div>
          {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
          {saved && <p className="text-green-700 text-sm mt-3">{saved}</p>}
        </div>

        {data && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <button
                className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'home' ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-700'}`}
                onClick={() => setActiveTab('home')}
              >
                Главная
              </button>
              <button
                className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'yoga' ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-700'}`}
                onClick={() => setActiveTab('yoga')}
              >
                Йога
              </button>
              <button
                className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'playlist' ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-700'}`}
                onClick={() => setActiveTab('playlist')}
              >
                Плейлист
              </button>
              <button
                className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'merch' ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-700'}`}
                onClick={() => setActiveTab('merch')}
              >
                Одежда
              </button>
              <button
                className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'posts' ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-700'}`}
                onClick={() => setActiveTab('posts')}
              >
                Посты
              </button>
              <button
                className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'analytics' ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-700'}`}
                onClick={async () => {
                  setActiveTab('analytics')
                  if (!analyticsLoading && !analyticsData) {
                    await loadAnalyticsStudio()
                  }
                }}
              >
                Аналитическая студия
              </button>
              <button
                className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'files' ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-700'}`}
                onClick={async () => {
                  setActiveTab('files')
                  if (publicEntries.length === 0 && !publicLoading) {
                    await loadPublicFiles('')
                  }
                }}
              >
                Public файлы
              </button>
              <button
                className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'bookings' ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-700'}`}
                onClick={async () => {
                  setActiveTab('bookings')
                  if (!bookingLoading && bookings.length === 0 && Object.keys(bookingSlots).length === 0) {
                    await loadBookingsAdmin()
                  }
                }}
              >
                Записи
              </button>
            </div>

            {activeTab === 'home' && (
              <div className="space-y-6">
                <section className="card p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xl font-serif font-bold">Стартовая секция (Hero)</h2>
                    <button
                      className="btn-primary"
                      onClick={() =>
                        runAction(
                          {
                            action: 'home.updateHero',
                            homeHero: data.homeHero || defaultHomeHero(),
                          },
                          'Стартовая секция сохранена'
                        )
                      }
                    >
                      Сохранить Hero
                    </button>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-2">
                    <input
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg uppercase"
                      value={data.homeHero?.words?.[0] || ''}
                      onChange={(e) =>
                        updateHomeHero({
                          words: [
                            e.target.value.toUpperCase(),
                            data.homeHero?.words?.[1] || '',
                            data.homeHero?.words?.[2] || '',
                          ],
                        })
                      }
                      placeholder="Слово 1"
                    />
                    <input
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg uppercase"
                      value={data.homeHero?.words?.[1] || ''}
                      onChange={(e) =>
                        updateHomeHero({
                          words: [
                            data.homeHero?.words?.[0] || '',
                            e.target.value.toUpperCase(),
                            data.homeHero?.words?.[2] || '',
                          ],
                        })
                      }
                      placeholder="Слово 2"
                    />
                    <input
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg uppercase"
                      value={data.homeHero?.words?.[2] || ''}
                      onChange={(e) =>
                        updateHomeHero({
                          words: [
                            data.homeHero?.words?.[0] || '',
                            data.homeHero?.words?.[1] || '',
                            e.target.value.toUpperCase(),
                          ],
                        })
                      }
                      placeholder="Слово 3"
                    />
                  </div>
                  <input
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    value={data.homeHero?.tagline || ''}
                    onChange={(e) => updateHomeHero({ tagline: e.target.value })}
                    placeholder="Слоган (например: Здесь живёт ваш баланс)"
                  />
                  <input
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    value={data.homeHero?.image || ''}
                    onChange={(e) => updateHomeHero({ image: e.target.value })}
                    placeholder="Фото (например: /photos/main.jpg)"
                  />
                  <textarea
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg min-h-24"
                    value={data.homeHero?.intro || ''}
                    onChange={(e) => updateHomeHero({ intro: e.target.value })}
                    placeholder="Приветственный текст под фото"
                  />

                  {data.galleryPhotos.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm text-gray-600">Быстрый выбор фото из /photos:</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-56 overflow-auto">
                        {data.galleryPhotos.map((photo) => {
                          const selected = (data.homeHero?.image || '') === photo.path
                          return (
                            <button
                              key={`hero-${photo.path}`}
                              type="button"
                              onClick={() => updateHomeHero({ image: photo.path })}
                              className={`rounded-lg border overflow-hidden ${selected ? 'border-primary-500 ring-2 ring-primary-200' : 'border-gray-200'}`}
                              title={photo.path}
                            >
                              <img src={photo.path} alt={photo.name} className="w-full h-20 object-cover bg-gray-100" />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </section>

                <section className="card p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xl font-serif font-bold">Фотогалерея на главной</h2>
                    <button
                      className="btn-primary disabled:opacity-60"
                      disabled={(data.homeGallerySelection || []).length !== 4}
                      onClick={() =>
                        runAction(
                          {
                            action: 'gallery.setHomePhotos',
                            homeGallerySelection: uniquePhotoPaths(data.homeGallerySelection || []).slice(0, 4),
                          },
                          'Фотогалерея главной страницы сохранена'
                        )
                      }
                    >
                      Сохранить 4 фото
                    </button>
                  </div>
                  <p className="text-sm text-gray-600">
                    Выберите ровно 4 фотографии из <code className="bg-gray-100 px-1 rounded">public/photos</code>,
                    которые будут показаны в блоке «Фотогалерея» на главной странице.
                  </p>
                  <p className="text-sm">
                    Выбрано: <span className="font-semibold">{(data.homeGallerySelection || []).length}</span> / 4
                  </p>
                  {data.galleryPhotos.length === 0 ? (
                    <p className="text-sm text-gray-500">В папке /photos пока нет изображений.</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                      {data.galleryPhotos.map((photo) => {
                        const selected = (data.homeGallerySelection || []).includes(photo.path)
                        return (
                          <button
                            key={photo.path}
                            type="button"
                            onClick={() => toggleHomeGalleryPhoto(photo.path)}
                            className={`rounded-lg border overflow-hidden text-left ${
                              selected ? 'border-primary-500 ring-2 ring-primary-200' : 'border-gray-200'
                            }`}
                            title={photo.path}
                          >
                            <img src={photo.path} alt={photo.name} className="w-full h-24 object-cover bg-gray-100" />
                            <div className="px-2 py-1">
                              <p className="text-[11px] text-gray-800 truncate">{photo.name}</p>
                              <p className={`text-[11px] ${selected ? 'text-primary-700 font-medium' : 'text-gray-500'}`}>
                                {selected ? 'Выбрано' : 'Не выбрано'}
                              </p>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </section>
              </div>
            )}

            {activeTab === 'yoga' && (
              <section className="grid lg:grid-cols-2 gap-6">
                <div className="card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-serif font-bold">Пакеты уроков</h2>
                    <button
                      className="btn-primary px-4 py-2"
                      onClick={async () => {
                        await runAction({ action: 'yoga.createPackage' }, 'Пакет добавлен')
                        if (data.yogaPackages[0]) setSelectedYogaId(data.yogaPackages[0].id)
                      }}
                    >
                      + Пакет
                    </button>
                  </div>
                  <div className="space-y-2 max-h-[70vh] overflow-auto pr-1">
                    {data.yogaPackages.map((pkg) => (
                      <button
                        key={pkg.id}
                        onClick={() => setSelectedYogaId(pkg.id)}
                        className={`w-full text-left rounded-lg border p-3 transition ${
                          selectedYogaId === pkg.id
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-gray-900">{pkg.name}</p>
                            <p className="text-xs text-gray-500">{pkg.level} · {pkg.videos.length} видео</p>
                          </div>
                          <span className="text-sm font-medium text-primary-600">
                            {pkg.price === 0 ? 'Бесплатно' : `${pkg.price} ₽`}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="card p-5">
                  {!selectedYoga ? (
                    <p className="text-gray-500">Выберите пакет для редактирования</p>
                  ) : (
                    <div className="space-y-4">
                      <h3 className="text-xl font-serif font-bold">Редактирование пакета</h3>
                      <input
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={selectedYoga.name}
                        onChange={(e) => updateSelectedYoga({ name: e.target.value })}
                        placeholder="Название"
                      />
                      <input
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={selectedYoga.level}
                        onChange={(e) => updateSelectedYoga({ level: e.target.value })}
                        placeholder="Уровень"
                      />
                      <textarea
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg min-h-24"
                        value={selectedYoga.description}
                        onChange={(e) => updateSelectedYoga({ description: e.target.value })}
                        placeholder="Описание"
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <input
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          type="number"
                          value={selectedYoga.price}
                          onChange={(e) => updateSelectedYoga({ price: asNumber(e.target.value) })}
                          placeholder="Цена"
                        />
                        <input
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          value={selectedYoga.image}
                          onChange={(e) => updateSelectedYoga({ image: e.target.value })}
                          placeholder="Картинка или эмодзи"
                        />
                      </div>
                      <div className="space-y-2">
                        <button
                          type="button"
                          className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200"
                          disabled={!token.trim()}
                          onClick={async () => {
                            const nextOpen = !imagePickerOpen
                            setImagePickerOpen(nextOpen)
                            if (nextOpen && imagePickerItems.length === 0 && !imagePickerLoading) {
                              await loadYogaImagePickerItems()
                            }
                          }}
                        >
                          Выбрать картинку из public
                        </button>
                        {imagePickerOpen && (
                          <div className="border rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-gray-700">
                                /photos и /notgallery
                              </p>
                              <button
                                type="button"
                                className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                                disabled={imagePickerLoading}
                                onClick={loadYogaImagePickerItems}
                              >
                                Обновить
                              </button>
                            </div>
                            {imagePickerError && (
                              <p className="text-sm text-red-600">{imagePickerError}</p>
                            )}
                            {imagePickerLoading ? (
                              <p className="text-sm text-gray-500">Загрузка миниатюр...</p>
                            ) : imagePickerItems.length === 0 ? (
                              <p className="text-sm text-gray-500">Изображения не найдены.</p>
                            ) : (
                              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-72 overflow-auto">
                                {imagePickerItems.map((item) => {
                                  const selected = selectedYoga.image === item.publicUrl
                                  return (
                                    <button
                                      key={item.relativePath}
                                      type="button"
                                      className={`group rounded-lg border overflow-hidden text-left ${
                                        selected ? 'border-primary-500 ring-2 ring-primary-200' : 'border-gray-200'
                                      }`}
                                      title={`/${item.relativePath}`}
                                      onClick={() => {
                                        updateSelectedYoga({ image: item.publicUrl })
                                        setImagePickerOpen(false)
                                      }}
                                    >
                                      <img
                                        src={item.publicUrl}
                                        alt={item.name}
                                        className="w-full h-20 object-cover bg-gray-100"
                                      />
                                      <div className="px-2 py-1">
                                        <p className="text-[11px] text-gray-600 truncate">{item.folder}</p>
                                        <p className="text-[11px] text-gray-800 truncate">{item.name}</p>
                                      </div>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={selectedYoga.available}
                          onChange={(e) => updateSelectedYoga({ available: e.target.checked })}
                        />
                        Доступен на публичной странице
                      </label>
                      <div className="flex gap-2">
                        <button
                          className="btn-primary"
                          onClick={() =>
                            runAction(
                              {
                                action: 'yoga.updatePackage',
                                packageId: selectedYoga.id,
                                packagePatch: selectedYoga,
                              },
                              'Пакет сохранен'
                            )
                          }
                        >
                          Сохранить пакет
                        </button>
                        <button
                          className="px-4 py-2 rounded-lg bg-red-100 text-red-700 font-medium"
                          onClick={async () => {
                            const confirmed = window.confirm(
                              `Удалить пакет "${selectedYoga.name}"? Это действие нельзя отменить.`
                            )
                            if (!confirmed) return
                            await runAction(
                              { action: 'yoga.deletePackage', packageId: selectedYoga.id },
                              'Пакет удален'
                            )
                            setSelectedYogaId(null)
                          }}
                        >
                          Удалить пакет
                        </button>
                      </div>

                      <div className="border-t pt-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-gray-900">Видеоуроки</h4>
                          <button
                            className="btn-secondary px-4 py-2"
                            onClick={() =>
                              runAction(
                                { action: 'yoga.addVideo', packageId: selectedYoga.id },
                                'Видео добавлено'
                              )
                            }
                          >
                            Добавить видео
                          </button>
                        </div>
                        {selectedYoga.videos.length === 0 && (
                          <p className="text-sm text-gray-500">В этом пакете пока нет видео</p>
                        )}
                        {selectedYoga.videos.map((video, index) => (
                          <div key={`${selectedYoga.id}-${index}`} className="border rounded-lg p-3 space-y-2">
                            <input
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                              value={video.title}
                              onChange={(e) => updateSelectedVideo(index, { title: e.target.value })}
                              placeholder="Название видео"
                            />
                            <input
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                              type="number"
                              min={0}
                              step={1}
                              value={durationMinutesInputValue(video.duration)}
                              onChange={(e) =>
                                updateSelectedVideo(index, {
                                  duration: String(Math.floor(Math.max(0, asNumber(e.target.value)))),
                                })
                              }
                              placeholder="Длительность в минутах"
                            />
                            <input
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                              value={video.videoUrl || ''}
                              onChange={(e) => updateSelectedVideo(index, { videoUrl: e.target.value })}
                              placeholder="videoUrl (/videos/...)"
                            />
                            <input
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                              value={
                                video.rutubeUrl ||
                                (video.rutubeId
                                  ? `https://rutube.ru/video/private/${video.rutubeId}/${video.rutubeToken ? `?p=${video.rutubeToken}` : ''}`
                                  : '')
                              }
                              onChange={(e) => updateSelectedVideo(index, { rutubeUrl: e.target.value })}
                              placeholder="rutubeUrl (https://rutube.ru/video/private/.../?p=...)"
                            />
                            <div className="flex gap-2">
                              <button
                                className="btn-primary px-4 py-2"
                                onClick={() =>
                                  runAction(
                                    {
                                      action: 'yoga.updateVideo',
                                      packageId: selectedYoga.id,
                                      videoIndex: index,
                                      videoPatch: video,
                                    },
                                    'Видеоурок сохранен'
                                  )
                                }
                              >
                                Сохранить урок
                              </button>
                              <button
                                className="px-3 py-2 rounded-lg bg-red-100 text-red-700 text-sm font-medium"
                                onClick={async () => {
                                  const confirmed = window.confirm(
                                    `Удалить видео "${video.title || `№${index + 1}`}" из пакета "${selectedYoga.name}"?`
                                  )
                                  if (!confirmed) return
                                  await runAction(
                                    {
                                      action: 'yoga.deleteVideo',
                                      packageId: selectedYoga.id,
                                      videoIndex: index,
                                    },
                                    'Видеоурок удален'
                                  )
                                }}
                              >
                                Удалить
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                </section>
            )}

            {activeTab === 'playlist' && (
              <section className="grid lg:grid-cols-2 gap-6">
                <div className="card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-serif font-bold">Файлы плейлиста</h2>
                    <button
                      className="btn-primary px-4 py-2"
                      onClick={() => runAction({ action: 'playlist.createItem' }, 'Элемент добавлен')}
                    >
                      + Элемент
                    </button>
                  </div>
                  <div className="space-y-2 max-h-[70vh] overflow-auto pr-1">
                    {data.playlistItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setSelectedPlaylistId(item.id)}
                        className={`w-full text-left rounded-lg border p-3 transition ${
                          selectedPlaylistId === item.id
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <p className="font-semibold text-gray-900">{item.title}</p>
                        <p className="text-xs text-gray-500">{item.type} · {item.id}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="card p-5">
                  {!selectedPlaylist ? (
                    <p className="text-gray-500">Выберите элемент для редактирования</p>
                  ) : (
                    <div className="space-y-3">
                      <h3 className="text-xl font-serif font-bold">Редактирование элемента</h3>
                      <input
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={selectedPlaylist.id}
                        onChange={(e) => updateSelectedPlaylist({ id: e.target.value })}
                        placeholder="ID файла"
                      />
                      <input
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={selectedPlaylist.title}
                        onChange={(e) => updateSelectedPlaylist({ title: e.target.value })}
                        placeholder="Название"
                      />
                      <select
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={selectedPlaylist.type}
                        onChange={(e) =>
                          updateSelectedPlaylist({ type: e.target.value as PlaylistItem['type'] })
                        }
                      >
                        <option value="audio">audio</option>
                        <option value="video">video</option>
                      </select>
                      <input
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={selectedPlaylist.src}
                        onChange={(e) => updateSelectedPlaylist({ src: e.target.value })}
                        placeholder="Путь к файлу, например /audio/file.mp3"
                      />
                      <div className="space-y-2">
                        <button
                          type="button"
                          className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200"
                          disabled={!token.trim()}
                          onClick={async () => {
                            const nextOpen = !audioPickerOpen
                            setAudioPickerOpen(nextOpen)
                            if (nextOpen && audioPickerItems.length === 0 && !audioPickerLoading) {
                              await loadPlaylistAudioPickerItems()
                            }
                          }}
                        >
                          Выбрать аудио из /audio
                        </button>
                        {audioPickerOpen && (
                          <div className="border rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-gray-700">Файлы /audio</p>
                              <button
                                type="button"
                                className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                                disabled={audioPickerLoading}
                                onClick={loadPlaylistAudioPickerItems}
                              >
                                Обновить
                              </button>
                            </div>
                            {audioPickerError && <p className="text-sm text-red-600">{audioPickerError}</p>}
                            {audioPickerLoading ? (
                              <p className="text-sm text-gray-500">Загрузка аудио...</p>
                            ) : audioPickerItems.length === 0 ? (
                              <p className="text-sm text-gray-500">Аудиофайлы не найдены.</p>
                            ) : (
                              <div className="max-h-56 overflow-auto border rounded">
                                {audioPickerItems.map((item) => {
                                  const selected = selectedPlaylist.src === item.publicUrl
                                  return (
                                    <button
                                      key={item.relativePath}
                                      type="button"
                                      onClick={() => {
                                        updateSelectedPlaylist({ src: item.publicUrl })
                                        setAudioPickerOpen(false)
                                      }}
                                      className={`w-full text-left px-3 py-2 text-sm border-b last:border-b-0 ${
                                        selected ? 'bg-primary-50 text-primary-700' : 'hover:bg-gray-50 text-gray-800'
                                      }`}
                                      title={`/${item.relativePath}`}
                                    >
                                      <span className="mr-2">🎵</span>
                                      {item.name}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <input
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={selectedPlaylist.duration || ''}
                        onChange={(e) => updateSelectedPlaylist({ duration: e.target.value })}
                        placeholder="Длительность"
                      />
                      <input
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={selectedPlaylist.category || ''}
                        onChange={(e) => updateSelectedPlaylist({ category: e.target.value })}
                        placeholder="Категория"
                      />
                      <textarea
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg min-h-24"
                        value={selectedPlaylist.description || ''}
                        onChange={(e) => updateSelectedPlaylist({ description: e.target.value })}
                        placeholder="Описание"
                      />
                      <div className="flex gap-2">
                        <button
                          className="btn-primary"
                          onClick={() =>
                            runAction(
                              { action: 'playlist.updateItem', playlistItem: selectedPlaylist },
                              'Элемент сохранен'
                            )
                          }
                        >
                          Сохранить
                        </button>
                        <button
                          className="px-4 py-2 rounded-lg bg-red-100 text-red-700 font-medium"
                          onClick={async () => {
                            await runAction(
                              { action: 'playlist.deleteItem', playlistItemId: selectedPlaylist.id },
                              'Элемент удален'
                            )
                            setSelectedPlaylistId(null)
                          }}
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {activeTab === 'merch' && (
              <section className="grid lg:grid-cols-2 gap-6">
                <div className="card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-serif font-bold">Товары одежды</h2>
                    <button
                      className="btn-primary px-4 py-2"
                      onClick={async () => {
                        await runAction({ action: 'merch.createProduct' }, 'Товар добавлен')
                        if (data.merchProducts[0]) setSelectedMerchId(data.merchProducts[0].id)
                      }}
                    >
                      + Товар
                    </button>
                  </div>
                  <div className="space-y-2 max-h-[70vh] overflow-auto pr-1">
                    {data.merchProducts.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setSelectedMerchId(item.id)}
                        className={`w-full text-left rounded-lg border p-3 transition ${
                          selectedMerchId === item.id
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900 truncate">{item.name}</p>
                            <p className="text-xs text-gray-500 truncate">{item.id}</p>
                          </div>
                          <span className="text-sm font-medium text-primary-600 whitespace-nowrap">
                            {item.price} ₽
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="card p-5">
                  {!selectedMerch ? (
                    <p className="text-gray-500">Выберите товар для редактирования</p>
                  ) : (
                    <div className="space-y-3">
                      <h3 className="text-xl font-serif font-bold">Редактирование товара</h3>
                      <input
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={selectedMerch.id}
                        onChange={(e) => updateSelectedMerch({ id: e.target.value })}
                        placeholder="ID товара"
                      />
                      <input
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={selectedMerch.name}
                        onChange={(e) => updateSelectedMerch({ name: e.target.value })}
                        placeholder="Название"
                      />
                      <textarea
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg min-h-24"
                        value={selectedMerch.description || ''}
                        onChange={(e) => updateSelectedMerch({ description: e.target.value })}
                        placeholder="Короткое описание"
                      />
                      <textarea
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg min-h-24"
                        value={selectedMerch.story || ''}
                        onChange={(e) => updateSelectedMerch({ story: e.target.value })}
                        placeholder="История / расширенный текст справа на странице одежды"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          value={selectedMerch.price}
                          onChange={(e) => updateSelectedMerch({ price: Math.max(0, asNumber(e.target.value)) })}
                          placeholder="Цена"
                        />
                        <input
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          value={selectedMerch.color || ''}
                          onChange={(e) => updateSelectedMerch({ color: e.target.value })}
                          placeholder="Цвет"
                        />
                      </div>
                      <input
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={selectedMerch.image || ''}
                        onChange={(e) => updateSelectedMerch({ image: e.target.value })}
                        placeholder="Фото (/merch/... или /photos/...)"
                      />
                      <div className="space-y-2">
                        <button
                          type="button"
                          className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200"
                          disabled={!token.trim()}
                          onClick={async () => {
                            const nextOpen = !merchImagePickerOpen
                            setMerchImagePickerOpen(nextOpen)
                            if (nextOpen && merchImagePickerItems.length === 0 && !merchImagePickerLoading) {
                              await loadMerchImagePickerItems()
                            }
                          }}
                        >
                          Выбрать изображение из /notgallery
                        </button>
                        {merchImagePickerOpen && (
                          <div className="border rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-gray-700">Миниатюры /notgallery</p>
                              <button
                                type="button"
                                className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                                disabled={merchImagePickerLoading}
                                onClick={loadMerchImagePickerItems}
                              >
                                Обновить
                              </button>
                            </div>
                            {merchImagePickerError && (
                              <p className="text-sm text-red-600">{merchImagePickerError}</p>
                            )}
                            {merchImagePickerLoading ? (
                              <p className="text-sm text-gray-500">Загрузка миниатюр...</p>
                            ) : merchImagePickerItems.length === 0 ? (
                              <p className="text-sm text-gray-500">Изображения не найдены.</p>
                            ) : (
                              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-72 overflow-auto">
                                {merchImagePickerItems.map((item) => {
                                  const selected = selectedMerch.image === item.publicUrl
                                  return (
                                    <button
                                      key={item.relativePath}
                                      type="button"
                                      className={`rounded-lg border overflow-hidden text-left ${
                                        selected ? 'border-primary-500 ring-2 ring-primary-200' : 'border-gray-200'
                                      }`}
                                      title={`/${item.relativePath}`}
                                      onClick={() => {
                                        updateSelectedMerch({ image: item.publicUrl })
                                        setMerchImagePickerOpen(false)
                                      }}
                                    >
                                      <img
                                        src={item.publicUrl}
                                        alt={item.name}
                                        className="w-full h-20 object-cover bg-gray-100"
                                      />
                                      <div className="px-2 py-1">
                                        <p className="text-[11px] text-gray-800 truncate">{item.name}</p>
                                      </div>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <input
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={(selectedMerch.sizes || []).join(', ')}
                        onChange={(e) =>
                          updateSelectedMerch({
                            sizes: e.target.value
                              .split(',')
                              .map((v) => v.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="Размеры через запятую, например XS, S, M, L, XL"
                      />
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={selectedMerch.available}
                          onChange={(e) => updateSelectedMerch({ available: e.target.checked })}
                        />
                        Доступен для заказа
                      </label>
                      <div className="flex gap-2">
                        <button
                          className="btn-primary"
                          onClick={() =>
                            runAction(
                              { action: 'merch.updateProduct', merchProduct: selectedMerch },
                              'Товар сохранен'
                            )
                          }
                        >
                          Сохранить
                        </button>
                        <button
                          className="px-4 py-2 rounded-lg bg-red-100 text-red-700 font-medium"
                          onClick={async () => {
                            const confirmed = window.confirm(
                              `Удалить товар "${selectedMerch.name}"? Это действие нельзя отменить.`
                            )
                            if (!confirmed) return
                            await runAction(
                              { action: 'merch.deleteProduct', merchProductId: selectedMerch.id },
                              'Товар удален'
                            )
                            setSelectedMerchId(null)
                          }}
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {activeTab === 'posts' && (
              <section className="grid lg:grid-cols-2 gap-6">
                <div className="card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-serif font-bold">Посты</h2>
                    <button
                      className="btn-primary px-4 py-2"
                      onClick={() => runAction({ action: 'posts.create' }, 'Пост добавлен')}
                    >
                      + Пост
                    </button>
                  </div>
                  <div className="space-y-2 max-h-[70vh] overflow-auto pr-1">
                    {data.posts.map((post) => (
                      <button
                        key={post.id}
                        onClick={() => setSelectedPostId(post.id)}
                        className={`w-full text-left rounded-lg border p-3 transition ${
                          selectedPostId === post.id
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <p className="font-semibold text-gray-900">{post.title}</p>
                        <p className="text-xs text-gray-500">{post.category} · {post.date}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="card p-5">
                  {!selectedPost ? (
                    <p className="text-gray-500">Выберите пост для редактирования</p>
                  ) : (
                    <div className="space-y-3">
                      <h3 className="text-xl font-serif font-bold">Редактирование поста</h3>
                      <input
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={selectedPost.id}
                        onChange={(e) => updateSelectedPost({ id: e.target.value })}
                        placeholder="slug/ID поста"
                      />
                      <input
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={selectedPost.title}
                        onChange={(e) => updateSelectedPost({ title: e.target.value })}
                        placeholder="Заголовок"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          value={selectedPost.date}
                          onChange={(e) => updateSelectedPost({ date: e.target.value })}
                          placeholder="YYYY-MM-DD"
                        />
                        <input
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          value={selectedPost.category}
                          onChange={(e) => updateSelectedPost({ category: e.target.value })}
                          placeholder="Категория"
                        />
                      </div>
                      <input
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={selectedPost.excerpt}
                        onChange={(e) => updateSelectedPost({ excerpt: e.target.value })}
                        placeholder="Короткое описание"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          value={selectedPost.emoji || ''}
                          onChange={(e) => updateSelectedPost({ emoji: e.target.value })}
                          placeholder="Эмодзи"
                        />
                        <input
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          value={selectedPost.image || ''}
                          onChange={(e) => updateSelectedPost({ image: e.target.value })}
                          placeholder="image"
                        />
                      </div>
                      <input
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        value={selectedPost.previewImage || ''}
                        onChange={(e) => updateSelectedPost({ previewImage: e.target.value })}
                        placeholder="previewImage"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          value={selectedPost.video || ''}
                          onChange={(e) => updateSelectedPost({ video: e.target.value })}
                          placeholder="video (/videos/... или https://rutube.ru/video/... )"
                        />
                        <input
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          value={selectedPost.telegram || ''}
                          onChange={(e) => updateSelectedPost({ telegram: e.target.value })}
                          placeholder="telegram"
                        />
                      </div>
                      <textarea
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg min-h-52 font-mono text-sm"
                        value={selectedPost.content}
                        onChange={(e) => updateSelectedPost({ content: e.target.value })}
                        placeholder="Markdown контент поста"
                      />
                      <div className="flex gap-2">
                        <button
                          className="btn-primary"
                          onClick={() =>
                            runAction({ action: 'posts.update', post: selectedPost }, 'Пост сохранен')
                          }
                        >
                          Сохранить
                        </button>
                        <button
                          className="px-4 py-2 rounded-lg bg-red-100 text-red-700 font-medium"
                          onClick={async () => {
                            await runAction(
                              { action: 'posts.delete', postId: selectedPost.id },
                              'Пост удален'
                            )
                            setSelectedPostId(null)
                          }}
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {activeTab === 'analytics' && (
              <section className="card p-5 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-serif font-bold">Аналитическая студия</h2>
                    <p className="text-sm text-gray-600">
                      Счётчики просмотров по каждому видео, фото и товару за выбранный период.
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Период: {analyticsData?.period?.from || analyticsFromDate || 'с начала'}
                      {' — '}
                      {analyticsData?.period?.to || analyticsToDate || 'сегодня'}
                    </p>
                    {analyticsData?.updatedAt && (
                      <p className="text-xs text-gray-500 mt-1">
                        Последнее обновление: {new Date(analyticsData.updatedAt).toLocaleString('ru-RU')}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-gray-600">
                      С
                      <input
                        type="date"
                        className="mt-1 block px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        value={analyticsFromDate}
                        onChange={(e) => setAnalyticsFromDate(e.target.value)}
                      />
                    </label>
                    <label className="text-xs text-gray-600">
                      По
                      <input
                        type="date"
                        className="mt-1 block px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        value={analyticsToDate}
                        onChange={(e) => setAnalyticsToDate(e.target.value)}
                      />
                    </label>
                    <button
                      className="px-4 py-2 rounded-lg bg-primary-500 text-white font-medium disabled:opacity-60"
                      disabled={analyticsLoading || !token.trim()}
                      onClick={() => {
                        void loadAnalyticsStudio()
                      }}
                    >
                      {analyticsLoading ? 'Загрузка...' : 'Применить период'}
                    </button>
                    <button
                      className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 font-medium disabled:opacity-60"
                      disabled={analyticsLoading || !token.trim()}
                      onClick={async () => {
                        setAnalyticsFromDate('')
                        setAnalyticsToDate('')
                        await loadAnalyticsStudio({ from: '', to: '' })
                      }}
                    >
                      Сбросить
                    </button>
                  </div>
                </div>

                {analyticsError && <p className="text-sm text-red-600">{analyticsError}</p>}

                <div className="grid lg:grid-cols-3 gap-4">
                  <div className="border rounded-lg p-3">
                    <h3 className="font-semibold text-gray-900 mb-2">
                      Видео ({analyticsVideoRows.length})
                    </h3>
                    {analyticsVideoRows.length === 0 ? (
                      <p className="text-sm text-gray-500">Видео пока нет.</p>
                    ) : (
                      <div className="max-h-[45vh] overflow-auto space-y-2">
                        {analyticsVideoRows
                          .sort((a, b) => b.count - a.count)
                          .map((row) => (
                            <div key={row.id} className="rounded border p-2">
                              <p className="text-xs text-gray-500 truncate">{row.packageName}</p>
                              <p className="text-sm text-gray-900 truncate">{row.title}</p>
                              <p className="text-xs text-primary-700 mt-1">
                                Просмотров: <span className="font-semibold">{row.count}</span>
                              </p>
                              <p className="text-xs text-gray-600 mt-1">
                                Сессий: <span className="font-semibold">{row.sessions}</span>
                              </p>
                              <p className="text-xs text-gray-600 mt-1">
                                Ср. время просмотра:{' '}
                                <span className="font-semibold">
                                  {row.sessions > 0
                                    ? formatWatchSeconds(row.watchSeconds / row.sessions)
                                    : '0:00'}
                                </span>
                              </p>
                              <p className="text-xs text-gray-600 mt-1">
                                Досмотров:{' '}
                                <span className="font-semibold">
                                  {row.completions}
                                  {row.sessions > 0
                                    ? ` (${Math.round((row.completions / row.sessions) * 100)}%)`
                                    : ''}
                                </span>
                              </p>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  <div className="border rounded-lg p-3">
                    <h3 className="font-semibold text-gray-900 mb-2">
                      Фотографии ({analyticsPhotoRows.length})
                    </h3>
                    {analyticsPhotoRows.length === 0 ? (
                      <p className="text-sm text-gray-500">Фото пока нет.</p>
                    ) : (
                      <div className="max-h-[45vh] overflow-auto space-y-2">
                        {analyticsPhotoAlbums.map((albumGroup) => {
                          const isCollapsed = collapsedPhotoAlbums[albumGroup.album] ?? true
                          return (
                            <div key={albumGroup.album} className="rounded border">
                              <button
                                type="button"
                                className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-gray-50 text-left"
                                onClick={() =>
                                  setCollapsedPhotoAlbums((prev) => ({
                                    ...prev,
                                    [albumGroup.album]: !isCollapsed,
                                  }))
                                }
                              >
                                <span className="text-sm font-medium text-gray-900 truncate">
                                  {isCollapsed ? '▶' : '▼'} {albumGroup.label} ({albumGroup.rows.length})
                                </span>
                                <span className="text-xs text-primary-700 whitespace-nowrap">
                                  Просмотров: <span className="font-semibold">{albumGroup.totalCount}</span>
                                </span>
                              </button>
                              {!isCollapsed && (
                                <div className="px-2 pb-2 space-y-2">
                                  {albumGroup.rows.map((row) => (
                                    <div key={row.id} className="rounded border p-2">
                                      <p className="text-sm text-gray-900 truncate">{row.name}</p>
                                      <p className="text-xs text-gray-500 truncate">{row.path}</p>
                                      <p className="text-xs text-primary-700 mt-1">
                                        Просмотров: <span className="font-semibold">{row.count}</span>
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <div className="border rounded-lg p-3">
                    <h3 className="font-semibold text-gray-900 mb-2">
                      Одежда ({analyticsMerchRows.length})
                    </h3>
                    {analyticsMerchRows.length === 0 ? (
                      <p className="text-sm text-gray-500">Товары пока не добавлены.</p>
                    ) : (
                      <div className="max-h-[45vh] overflow-auto space-y-2">
                        {analyticsMerchRows
                          .sort((a, b) => b.count - a.count)
                          .map((row) => (
                            <div key={row.id} className="rounded border p-2">
                              <p className="text-sm text-gray-900 truncate">{row.name}</p>
                              <p className="text-xs text-gray-500 truncate">{row.productId}</p>
                              <p className="text-xs text-primary-700 mt-1">
                                Просмотров: <span className="font-semibold">{row.count}</span>
                              </p>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'files' && (
              <section className="card p-5 space-y-4">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <div>
                    <h2 className="text-xl font-serif font-bold">Файлы в public</h2>
                    <p className="text-sm text-gray-600">
                      Текущая папка: <code className="bg-gray-100 px-2 py-1 rounded">/{currentPublicPath}</code>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      accept={uploadAccept}
                      className="block text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                      onChange={(e) => setFileToUpload(e.target.files?.[0] || null)}
                    />
                    <button
                      className="btn-primary px-4 py-2 disabled:opacity-60"
                      disabled={!fileToUpload || uploading || !token.trim()}
                      onClick={uploadToCurrentFolder}
                    >
                      {uploading ? 'Загрузка...' : 'Загрузить файл'}
                    </button>
                    {uploading && (
                      <div className="min-w-56">
                        <div className="h-2 rounded bg-gray-200 overflow-hidden">
                          <div
                            className="h-full bg-primary-500 transition-all duration-150"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-600 mt-1">
                          Загрузка: {uploadProgress}%
                        </p>
                      </div>
                    )}
                    <button
                      className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 font-medium"
                      disabled={publicLoading || !token.trim()}
                      onClick={() => loadPublicFiles(currentPublicPath)}
                    >
                      Обновить
                    </button>
                    <button
                      className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 font-medium disabled:opacity-50"
                      disabled={publicLoading || publicParentPath === null}
                      onClick={() => loadPublicFiles(publicParentPath || '')}
                    >
                      Вверх
                    </button>
                  </div>
                </div>

                {publicError && (
                  <p className="text-red-600 text-sm">{publicError}</p>
                )}

                {publicLoading ? (
                  <p className="text-gray-500">Загрузка списка файлов...</p>
                ) : publicEntries.length === 0 ? (
                  <p className="text-gray-500">Папка пустая</p>
                ) : (
                  <div className="border rounded-lg divide-y">
                    {publicEntries.map((entry) => (
                      <div
                        key={entry.relativePath}
                        className="p-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex items-center gap-3">
                          {entry.kind === 'file' && entry.publicUrl && isImageFilePath(entry.publicUrl) && (
                            <a href={entry.publicUrl} target="_blank" rel="noreferrer" className="shrink-0">
                              <img
                                src={entry.publicUrl}
                                alt={entry.name}
                                className="w-14 h-14 rounded object-cover bg-gray-100 border border-gray-200"
                              />
                            </a>
                          )}
                          {entry.kind === 'file' && entry.publicUrl && !isImageFilePath(entry.publicUrl) && isVideoFilePath(entry.publicUrl) && (
                            <a href={entry.publicUrl} target="_blank" rel="noreferrer" className="shrink-0">
                              <video
                                src={entry.publicUrl}
                                className="w-14 h-14 rounded object-cover bg-black border border-gray-200"
                                muted
                                playsInline
                                preload="metadata"
                              />
                            </a>
                          )}
                          {entry.kind === 'dir' ? (
                            <button
                              className="text-primary-600 hover:text-primary-700 font-medium truncate"
                              onClick={() => loadPublicFiles(entry.relativePath)}
                            >
                              📁 {entry.name}
                            </button>
                          ) : (
                            <div className="flex items-center gap-2 flex-wrap">
                              <a
                                href={entry.publicUrl || '#'}
                                target="_blank"
                                rel="noreferrer"
                                className="text-gray-900 hover:text-primary-700 font-medium truncate"
                              >
                                📄 {entry.name}
                              </a>
                              {entry.publicUrl && isVideoFilePath(entry.publicUrl) && (
                                <Link
                                  href={`/admin/player?src=${encodeURIComponent(entry.publicUrl)}&from=${encodeURIComponent(currentPublicPath)}`}
                                  className="text-xs px-2 py-1 rounded bg-primary-100 text-primary-700 hover:bg-primary-200"
                                >
                                  Открыть в плеере
                                </Link>
                              )}
                            </div>
                          )}
                          <p className="text-xs text-gray-500 truncate">
                            /{entry.relativePath}
                          </p>
                        </div>
                        <div className="text-right text-xs text-gray-500 whitespace-nowrap">
                          <p>{formatFileSize(entry.size)}</p>
                          <p>{new Date(entry.updatedAt).toLocaleString('ru-RU')}</p>
                          {entry.kind === 'file' && (
                            <div className="mt-2 flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => renamePublicFile(entry.relativePath, entry.name)}
                                className="inline-flex items-center justify-center w-7 h-7 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                                title="Переименовать файл"
                                aria-label={`Переименовать файл ${entry.name}`}
                              >
                                ✏️
                              </button>
                              <button
                                type="button"
                                onClick={() => deletePublicFile(entry.relativePath)}
                                className="inline-flex items-center justify-center w-7 h-7 rounded bg-red-100 text-red-700 hover:bg-red-200"
                                title="Удалить файл"
                                aria-label={`Удалить файл ${entry.name}`}
                              >
                                🗑
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {activeTab === 'bookings' && (
              <section className="grid lg:grid-cols-2 gap-6">
                <div className="card p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-serif font-bold">Свободные слоты</h2>
                    <button
                      className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 font-medium"
                      disabled={bookingLoading || !token.trim()}
                      onClick={loadBookingsAdmin}
                    >
                      Обновить
                    </button>
                  </div>

                  <div className="grid sm:grid-cols-3 gap-2">
                    <input
                      type="date"
                      className="px-3 py-2 border border-gray-300 rounded-lg"
                      value={slotDateInput}
                      onChange={(e) => setSlotDateInput(e.target.value)}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="time"
                        step={300}
                        className="px-3 py-2 border border-gray-300 rounded-lg"
                        value={slotStartInput}
                        onChange={(e) => setSlotStartInput(e.target.value)}
                        title="Начало"
                      />
                      <input
                        type="time"
                        step={300}
                        className="px-3 py-2 border border-gray-300 rounded-lg"
                        value={slotEndInput}
                        onChange={(e) => setSlotEndInput(e.target.value)}
                        title="Окончание"
                      />
                    </div>
                    <button
                      className="btn-primary"
                      disabled={bookingLoading || !slotDateInput || !slotStartInput || !slotEndInput}
                      onClick={() =>
                        runBookingsAction(
                          {
                            action: 'slots.add',
                            date: slotDateInput,
                            startTime: slotStartInput,
                            endTime: slotEndInput,
                          },
                          `Слот ${slotDateInput} ${slotStartInput}-${slotEndInput} добавлен`
                        )
                      }
                    >
                      + Добавить слот
                    </button>
                  </div>

                  {bookingError && <p className="text-red-600 text-sm">{bookingError}</p>}
                  {bookingLoading && <p className="text-sm text-gray-500">Обновление данных...</p>}

                  {bookingDates.length === 0 ? (
                    <p className="text-sm text-gray-500">Слоты пока не настроены.</p>
                  ) : (
                    <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
                      {bookingDates.map((date) => (
                        <div key={date} className="border rounded-lg p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-gray-900">{date}</p>
                            <button
                              className="px-3 py-1 rounded bg-red-100 text-red-700 text-xs font-medium"
                              onClick={() =>
                                runBookingsAction(
                                  { action: 'slots.clearDate', date },
                                  `Все слоты на ${date} удалены`
                                )
                              }
                            >
                              Очистить день
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {(bookingSlots[date] || []).map((time) => (
                              <button
                                key={`${date}-${time}`}
                                className="px-2.5 py-1 rounded bg-gray-100 text-gray-700 text-xs hover:bg-red-100 hover:text-red-700"
                                onClick={() =>
                                  runBookingsAction(
                                    { action: 'slots.remove', date, time },
                                    `Слот ${date} ${time} удален`
                                  )
                                }
                              >
                                {time} ×
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="card p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-xl font-serif font-bold">Записи клиентов</h2>
                    <input
                      type="date"
                      className="px-3 py-2 border border-gray-300 rounded-lg"
                      value={bookingFilterDate}
                      onChange={(e) => setBookingFilterDate(e.target.value)}
                    />
                  </div>

                  {filteredBookings.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      Записей не найдено{bookingFilterDate ? ` на ${bookingFilterDate}` : ''}.
                    </p>
                  ) : (
                    <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
                      {filteredBookings.map((item) => (
                        <div key={item.id} className="border rounded-lg p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="font-semibold text-gray-900">
                                {item.date} {item.time}
                              </p>
                              <p className="text-sm text-gray-700">{item.name}</p>
                              <p className="text-sm text-gray-600">{item.phone}</p>
                              {item.comment && (
                                <p className="text-sm text-gray-500 whitespace-pre-wrap">{item.comment}</p>
                              )}
                              <p className="text-xs text-gray-400">
                                Создано: {new Date(item.createdAt).toLocaleString('ru-RU')}
                              </p>
                            </div>
                            <button
                              className="px-3 py-1 rounded bg-red-100 text-red-700 text-xs font-medium"
                              onClick={() =>
                                runBookingsAction(
                                  { action: 'bookings.delete', bookingId: item.id },
                                  `Запись ${item.name} удалена`
                                )
                              }
                            >
                              Удалить
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="section-padding">Загрузка...</div>}>
      <AdminPageContent />
    </Suspense>
  )
}
