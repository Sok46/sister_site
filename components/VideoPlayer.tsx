'use client'

import { useRef } from 'react'

interface VideoPlayerProps {
  src: string
  title?: string
  className?: string
}

export default function VideoPlayer({ src, title, className = '' }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // Поддержка YouTube, Vimeo и прямых ссылок на видео
  const isYouTube = src.includes('youtube.com') || src.includes('youtu.be')
  const isVimeo = src.includes('vimeo.com')
  
  if (isYouTube) {
    const videoId = src.includes('youtu.be') 
      ? src.split('youtu.be/')[1]?.split('?')[0]
      : src.split('v=')[1]?.split('&')[0]
    
    return (
      <div className={`relative w-full ${className}`} style={{ paddingBottom: '56.25%' }}>
        <iframe
          className="absolute top-0 left-0 w-full h-full rounded-xl"
          src={`https://www.youtube.com/embed/${videoId}`}
          title={title || 'Видео'}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    )
  }
  
  if (isVimeo) {
    const videoId = src.split('vimeo.com/')[1]?.split('?')[0]
    return (
      <div className={`relative w-full ${className}`} style={{ paddingBottom: '56.25%' }}>
        <iframe
          className="absolute top-0 left-0 w-full h-full rounded-xl"
          src={`https://player.vimeo.com/video/${videoId}`}
          title={title || 'Видео'}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
        />
      </div>
    )
  }
  
  // Прямая ссылка на видео файл
  return (
    <div className={`w-full flex justify-center ${className}`}>
      <div className="w-full max-w-md mx-auto">
        <video
          ref={videoRef}
          className="w-full rounded-xl"
          controls
          src={src}
          title={title || 'Видео'}
          style={{ 
            maxHeight: '80vh',
            maxWidth: '100%',
            objectFit: 'contain',
            display: 'block'
          }}
        >
          Ваш браузер не поддерживает воспроизведение видео.
        </video>
      </div>
    </div>
  )
}
