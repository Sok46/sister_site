import fs from 'fs'
import path from 'path'

export interface PlaylistItem {
  id: string
  title: string
  type: 'audio' | 'video'
  src: string
  duration?: string
  description?: string
  category?: string
}

const playlistDirectory = path.join(process.cwd(), 'content/playlist')

// Получить все элементы плейлиста
export function getAllPlaylistItems(): PlaylistItem[] {
  try {
    if (!fs.existsSync(playlistDirectory)) {
      return []
    }

    const fileNames = fs.readdirSync(playlistDirectory)
    const items = fileNames
      .filter((name) => name.endsWith('.json'))
      .map((fileName) => {
        const fullPath = path.join(playlistDirectory, fileName)
        const fileContents = fs.readFileSync(fullPath, 'utf8')
        return JSON.parse(fileContents) as PlaylistItem
      })

    return items.sort((a, b) => {
      // Сначала видео, потом аудио
      if (a.type !== b.type) {
        return a.type === 'video' ? -1 : 1
      }
      return a.title.localeCompare(b.title, 'ru')
    })
  } catch (error) {
    console.error('Error reading playlist:', error)
    return []
  }
}

// Получить элементы по типу
export function getPlaylistItemsByType(type: 'audio' | 'video'): PlaylistItem[] {
  return getAllPlaylistItems().filter((item) => item.type === type)
}
