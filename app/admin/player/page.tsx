'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { Suspense, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'

const VideoPlayer = dynamic(() => import('@/components/VideoPlayer'), { ssr: false })

function isSafePublicVideo(src: string): boolean {
  if (!src.startsWith('/')) return false
  if (src.includes('..')) return false
  return /\.(mp4|webm|mov|m4v|ogv)$/i.test(src)
}

function AdminPlayerPageContent() {
  const params = useSearchParams()
  const src = useMemo(() => (params.get('src') || '').trim(), [params])
  const from = useMemo(() => {
    const raw = (params.get('from') || '').trim()
    return raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\.+/g, '')
  }, [params])
  const valid = isSafePublicVideo(src)
  const backHref = `/admin?tab=files&path=${encodeURIComponent(from)}`

  return (
    <div className="section-padding">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-serif font-bold text-gray-900">
            Просмотр видео
          </h1>
          <div className="flex items-center gap-2">
            <Link href={backHref} className="btn-secondary">
              {from ? `Назад в /${from}` : 'Назад в public'}
            </Link>
            <Link href="/admin" className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 font-medium">
              В админку
            </Link>
          </div>
        </div>

        {!valid ? (
          <div className="card p-5">
            <p className="text-red-600">
              Неверный путь видео. Откройте файл из вкладки `Public файлы`.
            </p>
          </div>
        ) : (
          <div className="card p-5 space-y-3">
            <p className="text-sm text-gray-600">
              Источник: <code className="bg-gray-100 px-2 py-1 rounded">{src}</code>
            </p>
            <VideoPlayer src={src} storageKey={`admin-preview-${src}`} />
          </div>
        )}
      </div>
    </div>
  )
}

export default function AdminPlayerPage() {
  return (
    <Suspense fallback={<div className="section-padding">Загрузка...</div>}>
      <AdminPlayerPageContent />
    </Suspense>
  )
}
