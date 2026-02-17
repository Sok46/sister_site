'use client'

import dynamic from 'next/dynamic'

const VideoPlayer = dynamic(() => import('@/components/VideoPlayer'), { ssr: false })
const TelegramEmbed = dynamic(() => import('@/components/TelegramEmbed'), { ssr: false })

interface PostRichMediaProps {
  postId: string
  video?: string
  telegram?: string
}

function rutubeEmbedUrl(rawVideoUrl: string): string | null {
  const raw = (rawVideoUrl || '').trim()
  if (!raw) return null

  try {
    const parsed = new URL(raw)
    const host = parsed.hostname.toLowerCase()
    if (host !== 'rutube.ru' && host !== 'www.rutube.ru') return null

    const parts = parsed.pathname.split('/').filter(Boolean)
    let videoId = ''

    if (parts[0] === 'video' && parts[1] === 'private' && parts[2]) {
      videoId = parts[2]
    } else if (parts[0] === 'video' && parts[1]) {
      videoId = parts[1]
    } else if (parts[0] === 'play' && parts[1] === 'embed' && parts[2]) {
      videoId = parts[2]
    }

    if (!videoId) return null

    const token = (parsed.searchParams.get('p') || '').trim()
    const base = `https://rutube.ru/play/embed/${videoId}/`
    return token ? `${base}?p=${encodeURIComponent(token)}` : base
  } catch {
    return null
  }
}

export default function PostRichMedia({ postId, video, telegram }: PostRichMediaProps) {
  const rutubeUrl = video ? rutubeEmbedUrl(video) : null

  return (
    <>
      {video && rutubeUrl && (
        <div className="mb-8">
          <div className="relative w-full rounded-xl overflow-hidden bg-black" style={{ paddingTop: '56.25%' }}>
            <iframe
              src={rutubeUrl}
              className="absolute inset-0 w-full h-full"
              frameBorder="0"
              allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
              allowFullScreen
            />
          </div>
        </div>
      )}

      {video && !rutubeUrl && (
        <div className="mb-8">
          <VideoPlayer src={video} storageKey={`blog-${postId}`} />
        </div>
      )}

      {telegram && (
        <div className="mb-8">
          <TelegramEmbed url={telegram} />
        </div>
      )}
    </>
  )
}
