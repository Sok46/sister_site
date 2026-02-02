'use client'

import { useEffect, useRef } from 'react'

interface TelegramEmbedProps {
  url: string
  width?: string
  className?: string
}

export default function TelegramEmbed({ 
  url, 
  width = '100%',
  className = '' 
}: TelegramEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Парсим URL Telegram
    // Формат: https://t.me/channel/123 или t.me/channel/123
    const match = url.match(/t\.me\/([^\/]+)\/(\d+)/)
    
    if (!match) {
      console.error('Неверный формат Telegram URL. Ожидается: https://t.me/channel/123')
      if (containerRef.current) {
        containerRef.current.innerHTML = '<p class="text-red-500">Неверный формат Telegram URL</p>'
      }
      return
    }

    const channel = match[1]
    const postId = match[2]

    // Очищаем контейнер
    if (containerRef.current) {
      containerRef.current.innerHTML = ''
    }

    // Загружаем скрипт Telegram виджета
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.async = true
    script.setAttribute('data-telegram-post', `${channel}/${postId}`)
    script.setAttribute('data-width', width)

    // Добавляем скрипт в контейнер
    if (containerRef.current) {
      containerRef.current.appendChild(script)
    }

    // Очистка при размонтировании
    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }
    }
  }, [url, width])

  return (
    <div 
      ref={containerRef} 
      className={`w-full ${className}`}
      style={{ minHeight: '400px' }}
    />
  )
}
