'use client'

import { useEffect, useRef } from 'react'
import Plyr from 'plyr'
import 'plyr/dist/plyr.css'

export interface VideoQuality {
  src: string
  size: number // 1080, 720, 480, 360
}

interface VideoPlayerProps {
  /** Основной URL видео (используется если qualities не задан) */
  src: string
  /** Варианты качества — если указаны, появится переключатель */
  qualities?: VideoQuality[]
  /** Уникальный ключ для сохранения прогресса в localStorage */
  storageKey: string
}

function mimeFromUrl(url: string): string | undefined {
  const ext = url.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'webm':
      return 'video/webm'
    case 'mov':
      return 'video/quicktime'
    case 'ogg':
    case 'ogv':
      return 'video/ogg'
    default:
      // Для mp4/m4v и прочих оставляем тип пустым:
      // браузер сам корректно определит контейнер/кодек.
      return undefined
  }
}

export default function VideoPlayer({ src, qualities, storageKey }: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<Plyr | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Создаём <video> элемент через DOM — Plyr его перехватит
    const video = document.createElement('video')
    video.playsInline = true
    video.crossOrigin = 'anonymous'
    video.setAttribute('preload', 'metadata')

    containerRef.current.innerHTML = ''
    containerRef.current.appendChild(video)

    // Собираем источники
    const hasQualities = qualities && qualities.length > 1
    const sources = hasQualities
      ? qualities.map((q) => {
          const sourceType = mimeFromUrl(q.src)
          return sourceType
            ? { src: q.src, type: sourceType, size: q.size }
            : { src: q.src, size: q.size }
        })
      : (() => {
          const sourceType = mimeFromUrl(src)
          return sourceType ? [{ src, type: sourceType, size: 0 }] : [{ src, size: 0 }]
        })()

    // Инициализируем Plyr
    const qualityOptions = hasQualities ? qualities.map((q) => q.size) : []
    const defaultQuality = hasQualities
      ? qualities.find((q) => q.size === 720)?.size || qualities[0].size
      : 0

    const player = new Plyr(video, {
      controls: [
        'play-large',
        'rewind',
        'play',
        'fast-forward',
        'progress',
        'current-time',
        'duration',
        'mute',
        'volume',
        'settings',
        'pip',
        'fullscreen',
      ],
      settings: hasQualities ? ['quality', 'speed'] : ['speed'],
      quality: {
        default: hasQualities ? defaultQuality : 0,
        options: hasQualities ? qualityOptions : [],
        forced: hasQualities ? true : false,
      },
      speed: {
        selected: 1,
        options: [0.5, 0.75, 1, 1.25, 1.5, 2],
      },
      seekTime: 10,
      tooltips: { controls: true, seek: true },
      i18n: {
        restart: 'Сначала',
        rewind: 'Назад {seektime} сек',
        play: 'Воспроизвести',
        pause: 'Пауза',
        fastForward: 'Вперёд {seektime} сек',
        seek: 'Перемотка',
        seekLabel: '{currentTime} из {duration}',
        played: 'Просмотрено',
        buffered: 'Загружено',
        currentTime: 'Текущее время',
        duration: 'Длительность',
        volume: 'Громкость',
        mute: 'Без звука',
        unmute: 'Включить звук',
        enableCaptions: 'Включить субтитры',
        disableCaptions: 'Выключить субтитры',
        enterFullscreen: 'Полный экран',
        exitFullscreen: 'Выйти из полного экрана',
        frameTitle: 'Плеер для {title}',
        captions: 'Субтитры',
        settings: 'Настройки',
        pip: 'Картинка в картинке',
        speed: 'Скорость',
        normal: 'Обычная',
        quality: 'Качество',
        loop: 'Повтор',
        start: 'Начало',
        end: 'Конец',
        all: 'Все',
        reset: 'Сбросить',
        disabled: 'Выключено',
        enabled: 'Включено',
      },
    })

    // Устанавливаем источники
    player.source = { type: 'video', sources }

    playerRef.current = player

    // ── Восстановление позиции ──
    const lsKey = `video-progress-${storageKey}`
    const savedTime = localStorage.getItem(lsKey)

    if (savedTime) {
      const time = parseFloat(savedTime)
      if (time > 0) {
        player.once('loadedmetadata', () => {
          // Не восстанавливаем если до конца осталось < 5 сек
          if (time < player.duration - 5) {
            player.currentTime = time
          } else {
            localStorage.removeItem(lsKey)
          }
        })
      }
    }

    // ── Сохранение прогресса ──
    let saveTimer: ReturnType<typeof setInterval> | null = null

    const startSaving = () => {
      if (saveTimer) return
      saveTimer = setInterval(() => {
        if (player.currentTime > 0) {
          localStorage.setItem(lsKey, String(player.currentTime))
        }
      }, 3000)
    }

    const stopSaving = () => {
      if (saveTimer) {
        clearInterval(saveTimer)
        saveTimer = null
      }
      // Сохраняем при паузе
      if (player.currentTime > 0) {
        localStorage.setItem(lsKey, String(player.currentTime))
      }
    }

    player.on('playing', startSaving)
    player.on('pause', stopSaving)
    player.on('ended', () => {
      stopSaving()
      localStorage.removeItem(lsKey)
    })

    // ── Обработка смены качества ──
    if (hasQualities) {
      player.on('qualitychange', () => {
        const currentTime = player.currentTime
        const wasPlaying = player.playing

        // Plyr переключает source, нужно восстановить позицию
        player.once('loadedmetadata', () => {
          player.currentTime = currentTime
          if (wasPlaying) player.play()
        })
      })
    }

    return () => {
      stopSaving()
      player.destroy()
    }
  }, [src, qualities, storageKey])

  return (
    <div
      ref={containerRef}
      className="plyr-container rounded-xl overflow-hidden"
    />
  )
}
