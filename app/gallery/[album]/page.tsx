import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getAllAlbums } from '@/lib/gallery'
import AlbumGallery from '@/components/AlbumGallery'

export const dynamic = 'force-dynamic'

export default function AlbumPage({ params }: { params: { album: string } }) {
  const albumName = decodeURIComponent(params.album)
  const albums = getAllAlbums()
  const album = albums.find((a) => a.name === albumName)

  if (!album || !album.photos || album.photos.length === 0) {
    notFound()
  }

  return (
    <div className="section-padding">
      <div className="max-w-7xl mx-auto">
        <Link
          href="/gallery"
          className="inline-flex items-center text-primary-600 hover:text-primary-700 mb-6"
        >
          ← Назад к альбомам
        </Link>

        <h1 className="text-4xl md:text-5xl font-serif font-bold text-gray-900 mb-4">
          {album.name}
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          {album.photos.length} {album.photos.length === 1 ? 'фото' : 'фотографий'}
        </p>

        <AlbumGallery albumName={album.name} photos={album.photos} />

        <div className="mt-12 text-center">
          <Link href="/gallery" className="text-primary-600 hover:text-primary-700 font-medium">
            ← Вернуться к альбомам
          </Link>
        </div>
      </div>
    </div>
  )
}
