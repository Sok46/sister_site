import { getAllPlaylistItems } from '@/lib/playlist'
import VideoPlayer from '@/components/VideoPlayer'
import AudioPlayer from '@/components/AudioPlayer'
import Link from 'next/link'

export default function PlaylistPage({
  searchParams,
}: {
  searchParams: { type?: string }
}) {
  const filterType = searchParams.type as 'video' | 'audio' | undefined
  
  const allItems = getAllPlaylistItems()
  const videos = allItems.filter((item) => item.type === 'video')
  const audios = allItems.filter((item) => item.type === 'audio')
  
  let filteredItems = allItems
  if (filterType === 'video') {
    filteredItems = videos
  } else if (filterType === 'audio') {
    filteredItems = audios
  }

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
          Аудио и видеозаписи для проведения йога-сессий
        </p>

        {/* Фильтры */}
        <div className="flex justify-center gap-4 mb-12">
          <Link
            href="/playlist"
            className={`px-6 py-2 rounded-lg font-medium transition-colors ${
              !filterType
                ? 'bg-primary-500 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Все
          </Link>
          <Link
            href="/playlist?type=video"
            className={`px-6 py-2 rounded-lg font-medium transition-colors ${
              filterType === 'video'
                ? 'bg-primary-500 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            🎬 Видео
          </Link>
          <Link
            href="/playlist?type=audio"
            className={`px-6 py-2 rounded-lg font-medium transition-colors ${
              filterType === 'audio'
                ? 'bg-primary-500 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            🎧 Аудио
          </Link>
        </div>

        {filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 mb-4">
              Плейлист пока пуст. Добавьте файлы в папку <code className="bg-gray-100 px-2 py-1 rounded">content/playlist/</code>
            </p>
            <p className="text-sm text-gray-500">
              См. файл <code className="bg-gray-100 px-2 py-1 rounded">PLAYLIST_GUIDE.md</code> для инструкций
            </p>
          </div>
        ) : (
          <>
            {filterType === 'video' && (
              <section>
                <h2 className="text-3xl font-serif font-bold text-gray-900 mb-8 flex items-center gap-3">
                  <span>🎬</span> Видео практики
                </h2>
                <div className="space-y-8">
                  {filteredItems.map((item) => (
                    <div key={item.id} className="card p-6">
                      <h3 className="text-2xl font-serif font-bold text-gray-900 mb-3">
                        {item.title}
                      </h3>
                      {item.description && (
                        <p className="text-gray-600 mb-4">{item.description}</p>
                      )}
                      {item.duration && (
                        <p className="text-sm text-gray-500 mb-4">Длительность: {item.duration}</p>
                      )}
                      <VideoPlayer src={item.src} title={item.title} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {filterType === 'audio' && (
              <section>
                <h2 className="text-3xl font-serif font-bold text-gray-900 mb-8 flex items-center gap-3">
                  <span>🎧</span> Аудио медитации
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {filteredItems.map((item) => (
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

            {!filterType && (
              <>
                {/* Видео секция */}
                {videos.length > 0 && (
                  <section className="mb-16">
                    <h2 className="text-3xl font-serif font-bold text-gray-900 mb-8 flex items-center gap-3">
                      <span>🎬</span> Видео практики
                    </h2>
                    <div className="space-y-8">
                      {videos.map((item) => (
                        <div key={item.id} className="card p-6">
                          <h3 className="text-2xl font-serif font-bold text-gray-900 mb-3">
                            {item.title}
                          </h3>
                          {item.description && (
                            <p className="text-gray-600 mb-4">{item.description}</p>
                          )}
                          {item.duration && (
                            <p className="text-sm text-gray-500 mb-4">Длительность: {item.duration}</p>
                          )}
                          <VideoPlayer src={item.src} title={item.title} />
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Аудио секция */}
                {audios.length > 0 && (
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
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
