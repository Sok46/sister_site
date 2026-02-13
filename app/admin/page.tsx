'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { PlaylistItem } from '@/lib/playlist'
import type { Post } from '@/lib/posts'
import type { VideoLesson, YogaPackage } from '@/lib/yoga'

type Tab = 'yoga' | 'playlist' | 'posts' | 'files'

interface Snapshot {
  yogaPackages: YogaPackage[]
  playlistItems: PlaylistItem[]
  posts: Post[]
}

interface PublicFileEntry {
  name: string
  kind: 'dir' | 'file'
  relativePath: string
  size: number | null
  updatedAt: string
  publicUrl: string | null
}

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

export default function AdminPage() {
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('yoga')
  const [data, setData] = useState<Snapshot | null>(null)
  const [currentPublicPath, setCurrentPublicPath] = useState('')
  const [publicParentPath, setPublicParentPath] = useState<string | null>(null)
  const [publicEntries, setPublicEntries] = useState<PublicFileEntry[]>([])
  const [publicLoading, setPublicLoading] = useState(false)
  const [publicError, setPublicError] = useState('')
  const [fileToUpload, setFileToUpload] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStage, setUploadStage] = useState<'idle' | 'sending' | 'processing'>('idle')
  const [serverProgress, setServerProgress] = useState(0)
  const [serverProgressMessage, setServerProgressMessage] = useState('')
  const [autoBooted, setAutoBooted] = useState(false)
  const [initialTabParam, setInitialTabParam] = useState<string>('')
  const [initialPathParam, setInitialPathParam] = useState<string>('')

  const [selectedYogaId, setSelectedYogaId] = useState<string | null>(null)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null)
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
      }
      setData(snapshot)
      if (!selectedYogaId && snapshot.yogaPackages.length > 0) {
        setSelectedYogaId(snapshot.yogaPackages[0].id)
      }
      if (!selectedPlaylistId && snapshot.playlistItems.length > 0) {
        setSelectedPlaylistId(snapshot.playlistItems[0].id)
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
    setUploadStage('sending')
    setServerProgress(0)
    setServerProgressMessage('Ожидание обработки на сервере')
    const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let keepProgressVisible = false
    try {
      const formData = new FormData()
      formData.append('file', fileToUpload)

      pollTimer = setInterval(async () => {
        try {
          const progressRes = await fetch(
            `/api/admin/files?progressId=${encodeURIComponent(uploadId)}`,
            {
              headers: {
                'x-admin-token': token.trim(),
              },
            }
          )
          if (!progressRes.ok) return
          const progressPayload = await progressRes.json()
          const nextProgress = Number(progressPayload.progress || 0)
          if (Number.isFinite(nextProgress)) {
            setServerProgress(Math.max(0, Math.min(100, nextProgress)))
          }
          const msg = String(progressPayload.message || '')
          if (msg) setServerProgressMessage(msg)
        } catch {
          // Ничего: временная ошибка опроса не должна ломать загрузку.
        }
      }, 500)

      const payload = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open(
          'POST',
          `/api/admin/files?path=${encodeURIComponent(currentPublicPath)}&uploadId=${encodeURIComponent(uploadId)}`
        )
        xhr.setRequestHeader('x-admin-token', token.trim())

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return
          const percent = Math.round((event.loaded / event.total) * 100)
          // До ответа сервера держим максимум 95%, чтобы не создавать ложное "готово".
          setUploadProgress(Math.min(percent, 95))
        }

        xhr.upload.onload = () => {
          setUploadStage('processing')
          setUploadProgress(96)
        }

        xhr.onerror = () => {
          reject(new Error('Ошибка сети при загрузке файла'))
        }

        xhr.onload = () => {
          const contentType = (xhr.getResponseHeader('content-type') || '').toLowerCase()
          let parsed: Record<string, unknown> = {}

          if (contentType.includes('application/json')) {
            try {
              parsed = JSON.parse(xhr.responseText || '{}') as Record<string, unknown>
            } catch {
              reject(new Error('Сервер вернул поврежденный JSON-ответ'))
              return
            }
          } else {
            const text = (xhr.responseText || '').trim()
            const shortText = text ? text.slice(0, 180) : ''
            if (xhr.status === 413) {
              reject(
                new Error(
                  'Сервер отклонил файл: слишком большой размер запроса (HTTP 413). Увеличьте client_max_body_size в Nginx.'
                )
              )
              return
            }
            reject(
              new Error(
                `Некорректный ответ сервера (HTTP ${xhr.status}). ${
                  shortText || 'Проверьте логи Nginx/PM2.'
                }`
              )
            )
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

      const payloadUploadId = String(payload.uploadId || uploadId)
      const backgroundProcessing = Boolean(payload.backgroundProcessing)
      if (backgroundProcessing && payloadUploadId) {
        setUploadStage('processing')
        keepProgressVisible = true
        for (let i = 0; i < 1800; i++) {
          try {
            const progressRes = await fetch(
              `/api/admin/files?progressId=${encodeURIComponent(payloadUploadId)}`,
              {
                headers: {
                  'x-admin-token': token.trim(),
                },
              }
            )
            if (progressRes.ok) {
              const progressPayload = await progressRes.json()
              const nextProgress = Number(progressPayload.progress || 0)
              if (Number.isFinite(nextProgress)) {
                setServerProgress(Math.max(0, Math.min(100, nextProgress)))
              }
              const msg = String(progressPayload.message || '')
              if (msg) setServerProgressMessage(msg)

              const status = String(progressPayload.status || '')
              if (status === 'done' || status === 'failed') {
                const finalUrl = String(progressPayload.finalUrl || '')
                const extraWarning = String(progressPayload.warning || '')
                const doneParts = ['Фоновая обработка завершена']
                if (status === 'done' && finalUrl) doneParts.push(`Итоговый файл: ${finalUrl}`)
                if (status === 'failed' && extraWarning) doneParts.push(extraWarning)
                setSaved(doneParts.join('. '))
                keepProgressVisible = false
                break
              }
            }
          } catch {
            // ignore transient polling failures
          }
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }

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
      if (!backgroundProcessing) {
        setServerProgress(100)
        setServerProgressMessage('Готово')
      }
      await loadPublicFiles(currentPublicPath)
    } catch (err) {
      setPublicError(err instanceof Error ? err.message : 'Ошибка загрузки')
    } finally {
      if (pollTimer) clearInterval(pollTimer)
      setUploading(false)
      if (!keepProgressVisible) {
        setTimeout(() => {
          setUploadProgress(0)
          setServerProgress(0)
          setServerProgressMessage('')
          setUploadStage('idle')
        }, 800)
      }
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
    const params = new URLSearchParams(window.location.search)
    const tab = (params.get('tab') || '').trim()
    const path = (params.get('path') || '').trim()
    setInitialTabParam(tab)
    setInitialPathParam(path)
    if (tab === 'files') {
      setActiveTab('files')
    }
  }, [])

  useEffect(() => {
    const savedToken = localStorage.getItem('admin-token') || ''
    if (savedToken) {
      setToken(savedToken)
    }
  }, [])

  useEffect(() => {
    const value = token.trim()
    if (value) {
      localStorage.setItem('admin-token', value)
    } else {
      localStorage.removeItem('admin-token')
    }
  }, [token])

  useEffect(() => {
    if (autoBooted || !token.trim()) return

    setAutoBooted(true)
    void loadSnapshot()
    if (initialTabParam === 'files') {
      void loadPublicFiles(initialPathParam)
    }
  }, [token, autoBooted, initialTabParam, initialPathParam])

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
              placeholder="ADMIN_UPLOAD_TOKEN"
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
                className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'yoga' ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-700'}`}
                onClick={() => setActiveTab('yoga')}
              >
                Йога
              </button>
              <button
                className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'playlist' ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-700'}`}
                onClick={() => setActiveTab('playlist')}
              >
                Аудио/видео
              </button>
              <button
                className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'posts' ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-700'}`}
                onClick={() => setActiveTab('posts')}
              >
                Посты
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
            </div>

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
                              value={video.duration}
                              onChange={(e) => updateSelectedVideo(index, { duration: e.target.value })}
                              placeholder="Длительность, например 25 мин"
                            />
                            <input
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                              value={video.videoUrl || ''}
                              onChange={(e) => updateSelectedVideo(index, { videoUrl: e.target.value })}
                              placeholder="videoUrl (/videos/...)"
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                value={video.rutubeId || ''}
                                onChange={(e) => updateSelectedVideo(index, { rutubeId: e.target.value })}
                                placeholder="rutubeId"
                              />
                              <input
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                value={video.rutubeToken || ''}
                                onChange={(e) => updateSelectedVideo(index, { rutubeToken: e.target.value })}
                                placeholder="rutubeToken"
                              />
                            </div>
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
                                onClick={() =>
                                  runAction(
                                    {
                                      action: 'yoga.deleteVideo',
                                      packageId: selectedYoga.id,
                                      videoIndex: index,
                                    },
                                    'Видеоурок удален'
                                  )
                                }
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
                          placeholder="video"
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
                    {uploadKind && (
                      <>
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
                              {uploadStage === 'sending'
                                ? `Отправка файла: ${uploadProgress}%`
                                : uploadStage === 'processing'
                                ? `Файл получен. Обработка на сервере... ${uploadProgress}%`
                                : `Загрузка: ${uploadProgress}%`}
                            </p>
                            <div className="h-2 rounded bg-gray-200 overflow-hidden mt-2">
                              <div
                                className="h-full bg-emerald-500 transition-all duration-150"
                                style={{ width: `${serverProgress}%` }}
                              />
                            </div>
                            <p className="text-xs text-gray-600 mt-1">
                              Сервер: {serverProgress}%{serverProgressMessage ? ` · ${serverProgressMessage}` : ''}
                            </p>
                          </div>
                        )}
                      </>
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
                        <div className="min-w-0">
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
                            <button
                              type="button"
                              onClick={() => deletePublicFile(entry.relativePath)}
                              className="mt-2 inline-flex items-center justify-center w-7 h-7 rounded bg-red-100 text-red-700 hover:bg-red-200"
                              title="Удалить файл"
                              aria-label={`Удалить файл ${entry.name}`}
                            >
                              🗑
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
