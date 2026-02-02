import Link from 'next/link'
import Image from 'next/image'
import { getAllAlbums } from '@/lib/gallery'

export default function GalleryPage() {
  const albums = getAllAlbums()

  return (
    <div className="section-padding">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-5xl font-serif font-bold text-center text-gray-900 mb-4">
          📸 Фотогалерея
        </h1>
        <p className="text-xl text-center text-gray-600 mb-12">
          Альбомы с фотографиями
        </p>

        {albums.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 mb-4">
              Пока нет альбомов. Добавьте фотографии в папку <code className="bg-gray-100 px-2 py-1 rounded">public/photos/</code>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {albums.map((album) => (
              <Link
                key={album.name}
                href={`/gallery/${encodeURIComponent(album.name)}`}
                className="card group hover:scale-105 transition-transform duration-300"
              >
                <div className="relative h-64 overflow-hidden">
                  {album.cover && (
                    <Image
                      src={album.cover}
                      alt={album.name}
                      fill
                      className="object-cover group-hover:scale-110 transition-transform duration-500"
                    />
                  )}
                  {!album.cover && (
                    <div className="w-full h-full bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center">
                      <span className="text-6xl">📷</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 group-hover:bg-black/50 transition-colors flex items-center justify-center">
                    <div className="text-center text-white">
                      <h3 className="text-2xl font-serif font-bold mb-2">
                        {album.name}
                      </h3>
                      <p className="text-sm">
                        {album.photos.length} {album.photos.length === 1 ? 'фото' : 'фотографий'}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-12 text-center">
          <Link href="/" className="text-primary-600 hover:text-primary-700 font-medium">
            ← Вернуться на главную
          </Link>
        </div>
      </div>
    </div>
  )
}
