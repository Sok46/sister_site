'use client'

import { useState } from 'react'

type UploadResult = {
  url: string
  fileName: string
  size: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function AdminUploadPage() {
  const [token, setToken] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<UploadResult | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setResult(null)

    if (!token.trim()) {
      setError('Введите токен доступа')
      return
    }
    if (!file) {
      setError('Выберите видеофайл')
      return
    }

    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/admin/upload-video', {
        method: 'POST',
        headers: {
          'x-admin-token': token.trim(),
        },
        body: formData,
      })
      const data = await res.json()

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Ошибка загрузки')
      }

      setResult({
        url: data.url,
        fileName: data.fileName,
        size: data.size,
      })
      setFile(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="section-padding">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-4xl font-serif font-bold text-gray-900 mb-3">
          Загрузка видео с телефона
        </h1>
        <p className="text-gray-600 mb-8">
          Загрузите файл в папку <code className="bg-gray-100 px-2 py-1 rounded">public/videos</code>, затем используйте
          путь в постах и уроках. Файл сохраняется в оригинальном виде без автоматической перекодировки.
        </p>

        <form onSubmit={onSubmit} className="card p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Токен доступа
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="ADMIN_UPLOAD_TOKEN"
              autoComplete="off"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Видео файл (.mp4, .mov, .m4v, .webm)
            </label>
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
            />
            {file && (
              <p className="text-sm text-gray-500 mt-2">
                Выбрано: {file.name} ({formatBytes(file.size)})
              </p>
            )}
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full disabled:opacity-60"
          >
            {loading ? 'Загрузка...' : 'Загрузить видео'}
          </button>
        </form>

        {result && (
          <div className="mt-6 card p-6">
            <h2 className="text-xl font-serif font-bold text-green-700 mb-3">
              Видео загружено
            </h2>
            <p className="text-sm text-gray-600 mb-2">Файл: {result.fileName}</p>
            <p className="text-sm text-gray-600 mb-4">Размер: {formatBytes(result.size)}</p>
            <p className="text-sm text-gray-700 mb-3">
              Путь для сайта:{' '}
              <code className="bg-gray-100 px-2 py-1 rounded">{result.url}</code>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
