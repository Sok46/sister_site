'use client'

import dynamic from 'next/dynamic'

const VideoPlayer = dynamic(() => import('@/components/VideoPlayer'), { ssr: false })
const TelegramEmbed = dynamic(() => import('@/components/TelegramEmbed'), { ssr: false })

interface PostRichMediaProps {
  postId: string
  video?: string
  telegram?: string
}

export default function PostRichMedia({ postId, video, telegram }: PostRichMediaProps) {
  return (
    <>
      {video && (
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
