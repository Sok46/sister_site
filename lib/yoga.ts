import fs from 'fs'
import path from 'path'

export interface VideoQuality {
  src: string
  size: number // 1080, 720, 480, 360
}

export interface VideoLesson {
  title: string
  duration: string
  /** Прямая ссылка на видеофайл (mp4/mov в public/) */
  videoUrl?: string
  /** Варианты качества видео (если указаны — появится переключатель) */
  qualities?: VideoQuality[]
  /** ID видео на Рутубе (из URL: rutube.ru/video/private/{rutubeId}/) */
  rutubeId?: string
  /** Токен для приватного видео Рутуба (параметр ?p=...) */
  rutubeToken?: string
}

export interface YogaPackage {
  id: string
  name: string
  level: string
  description: string
  videos: VideoLesson[]
  price: number
  image: string
  available: boolean
}

const YOGA_DIR = path.join(process.cwd(), 'content', 'yoga')
const PACKAGES_FILE = path.join(YOGA_DIR, 'packages.json')

export function getAllPackages(): YogaPackage[] {
  if (!fs.existsSync(PACKAGES_FILE)) return []
  try {
    const data = fs.readFileSync(PACKAGES_FILE, 'utf8')
    return JSON.parse(data) as YogaPackage[]
  } catch {
    return []
  }
}

export function getPackageById(id: string): YogaPackage | undefined {
  return getAllPackages().find((p) => p.id === id)
}
