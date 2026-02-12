import { getAllPlaylistItems } from '@/lib/playlist'
import AudioPlayer from '@/components/AudioPlayer'
import Link from 'next/link'

export default function PlaylistPage() {
  const allItems = getAllPlaylistItems()
  const audios = allItems.filter((item) => item.type === 'audio')

  return (
    <div className="section-padding">
      <div className="max-w-7xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center text-primary-600 hover:text-primary-700 mb-6"
        >
          ← Назад на главную
        </Link>

        <h1 className="text-5xl font-serif font-bold text-center text-gray-900 mb-4">
          🎵 Плейлист для йоги
        </h1>
        <p className="text-xl text-center text-gray-600 mb-8">
          Аудио медитации для проведения йога-сессий
        </p>

        {audios.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 mb-4">
              Плейлист пока пуст. Добавьте файлы в папку <code className="bg-gray-100 px-2 py-1 rounded">content/playlist/</code>
            </p>
            <p className="text-sm text-gray-500">
              См. файл <code className="bg-gray-100 px-2 py-1 rounded">PLAYLIST_GUIDE.md</code> для инструкций
            </p>
          </div>
        ) : (
          <section>
            <h2 className="text-3xl font-serif font-bold text-gray-900 mb-8 flex items-center gap-3">
              <span>🎧</span> Аудио медитации
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {audios.map((item) => (
                <AudioPlayer
                  key={item.id}
                  src={item.src}
                  title={item.title}
                  description={item.description}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
