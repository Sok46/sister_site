import fs from 'fs'
import path from 'path'

export interface Photo {
  name: string
  path: string
  album?: string
}

export interface Album {
  name: string
  photos: Photo[]
  cover?: string
}

const photosDirectory = path.join(process.cwd(), 'public/photos')

// Получить все фотографии
export function getAllPhotos(): Photo[] {
  try {
    if (!fs.existsSync(photosDirectory)) {
      return []
    }

    const fileNames = fs.readdirSync(photosDirectory)
    const photos = fileNames
      .filter((name) => {
        const ext = path.extname(name).toLowerCase()
        return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)
      })
      .map((fileName) => ({
        name: fileName,
        path: `/photos/${fileName}`,
        album: extractAlbumName(fileName),
      }))

    return photos
  } catch (error) {
    console.error('Error reading photos directory:', error)
    return []
  }
}

// Извлечь название альбома из имени файла
// Формат: album_name-photo.jpg или просто photo.jpg
function extractAlbumName(fileName: string): string {
  // Если файл начинается с префикса альбома (например, "yoga-", "family-")
  const parts = fileName.split('-')
  if (parts.length > 1) {
    // Проверяем, является ли первая часть названием альбома
    const possibleAlbum = parts[0].toLowerCase()
    // Если это не дата (формат YYYY-MM-DD), то это альбом
    if (!/^\d{4}$/.test(possibleAlbum)) {
      return possibleAlbum
    }
  }
  return 'general'
}

// Получить все альбомы
export function getAllAlbums(): Album[] {
  try {
    const photos = getAllPhotos()
    const albumsMap = new Map<string, Photo[]>()

    photos.forEach((photo) => {
      const albumName = photo.album || 'general'
      if (!albumsMap.has(albumName)) {
        albumsMap.set(albumName, [])
      }
      albumsMap.get(albumName)!.push(photo)
    })

    const albums: Album[] = Array.from(albumsMap.entries()).map(([name, albumPhotos]) => ({
      name: name === 'general' ? 'Общие' : formatAlbumName(name),
      photos: albumPhotos,
      cover: albumPhotos[0]?.path,
    }))

    return albums.sort((a, b) => {
      // "Общие" всегда в конце
      if (a.name === 'Общие') return 1
      if (b.name === 'Общие') return -1
      return a.name.localeCompare(b.name, 'ru')
    })
  } catch (error) {
    console.error('Error getting albums:', error)
    return []
  }
}

// Форматировать название альбома
function formatAlbumName(name: string): string {
  const names: Record<string, string> = {
    yoga: 'Йога',
    family: 'Семья',
    nutrition: 'Питание',
    travel: 'Путешествия',
    general: 'Общие',
  }

  return names[name.toLowerCase()] || name.charAt(0).toUpperCase() + name.slice(1)
}

// Получить фотографии по альбому
export function getPhotosByAlbum(albumName: string): Photo[] {
  const photos = getAllPhotos()
  const formattedName = albumName.toLowerCase()
  
  return photos.filter((photo) => {
    const photoAlbum = photo.album || 'general'
    return photoAlbum.toLowerCase() === formattedName || 
           formatAlbumName(photoAlbum) === albumName
  })
}
