'use client'

interface TelegramPostProps {
  channel: string
  postId: string | number
  width?: string
  className?: string
}

export default function TelegramPost({ 
  channel, 
  postId, 
  width = '100%',
  className = '' 
}: TelegramPostProps) {
  // Формируем правильный формат для Telegram виджета
  // Формат: channel/postId (без @ и без https://t.me/)
  const telegramPost = `${channel}/${postId}`

  return (
    <div className={`w-full ${className}`}>
      <script 
        async 
        src="https://telegram.org/js/telegram-widget.js?22"
        data-telegram-post={telegramPost}
        data-width={width}
      />
      <iframe
        src={`https://t.me/${telegramPost}?embed=1`}
        className="w-full border-0 rounded-xl"
        style={{ minHeight: '400px' }}
        scrolling="no"
        allowTransparency
        allowFullScreen
      />
    </div>
  )
}
