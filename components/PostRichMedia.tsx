'use client'

import dynamic from 'next/dynamic'

const VideoPlayer = dynamic(() => import('@/components/VideoPlayer'), { ssr: false })
const TelegramEmbed = dynamic(() => import('@/components/TelegramEmbed'), { ssr: false })

interface PostRichMediaProps {
  postId: string
  video?: string
  telegram?: string
}

function matreshkaEmbedUrl(rawVideoUrl: string): string | null {
  const raw = (rawVideoUrl || '').trim()
  if (!raw) return null

  try {
    const parsed = new URL(raw)
    const host = parsed.hostname.toLowerCase()
    if (host !== 'matreshka.tv' && host !== 'www.matreshka.tv') return null

    const parts = parsed.pathname.split('/').filter(Boolean)
    let videoId = ''

    if (parts[0] === 'video' && parts[1]) {
      videoId = parts[1]
    } else if (parts[0] === 'embed' && parts[1] === 'video' && parts[2]) {
      videoId = parts[2]
    }

    if (!videoId) return null

    const s = (parsed.searchParams.get('s') || '').trim()
    return s
      ? `https://matreshka.tv/embed/video/${videoId}?s=${encodeURIComponent(s)}`
      : `https://matreshka.tv/embed/video/${videoId}`
  } catch {
    return null
  }
}

export default function PostRichMedia({ postId, video, telegram }: PostRichMediaProps) {
  const matreshkaUrl = video ? matreshkaEmbedUrl(video) : null

  return (
    <>
      {video && matreshkaUrl && (
        <div className="mb-8">
          <div className="relative w-full rounded-xl overflow-hidden bg-black" style={{ paddingTop: '56.25%' }}>
            <iframe
              src={matreshkaUrl}
              className="absolute inset-0 w-full h-full"
              frameBorder="0"
              allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
              allowFullScreen
            />
          </div>
        </div>
      )}

      {video && !matreshkaUrl && (
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
