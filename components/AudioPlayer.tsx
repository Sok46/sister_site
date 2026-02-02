'use client'

interface AudioPlayerProps {
  src: string
  title: string
  description?: string
  className?: string
}

export default function AudioPlayer({ 
  src, 
  title, 
  description,
  className = '' 
}: AudioPlayerProps) {
  return (
    <div className={`bg-white rounded-xl p-4 shadow-lg ${className}`}>
      <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-gray-600 mb-3">{description}</p>
      )}
      <audio
        controls
        className="w-full"
        src={src}
      >
        Ваш браузер не поддерживает воспроизведение аудио.
      </audio>
    </div>
  )
}
