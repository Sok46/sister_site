import path from 'path'
import { promises as fs } from 'fs'
import { getAllPhotos, type Photo } from '@/lib/gallery'

interface HomeGalleryConfig {
  selected: string[]
}

const HOME_GALLERY_FILE = path.join(process.cwd(), 'content', 'gallery', 'home-gallery.json')
const HOME_GALLERY_LIMIT = 4

function normalizePaths(paths: string[]): string[] {
  const unique = new Set<string>()
  for (const raw of paths) {
    const value = String(raw || '').trim()
    if (!value || !value.startsWith('/photos/')) continue
    if (unique.has(value)) continue
    unique.add(value)
  }
  return Array.from(unique)
}

async function readConfig(): Promise<HomeGalleryConfig> {
  try {
    const raw = await fs.readFile(HOME_GALLERY_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<HomeGalleryConfig>
    const selected = normalizePaths(Array.isArray(parsed.selected) ? parsed.selected : [])
    return { selected }
  } catch {
    return { selected: [] }
  }
}

async function writeConfig(config: HomeGalleryConfig): Promise<void> {
  await fs.mkdir(path.dirname(HOME_GALLERY_FILE), { recursive: true })
  await fs.writeFile(HOME_GALLERY_FILE, JSON.stringify(config, null, 2), 'utf8')
}

export async function getHomeGallerySelection(): Promise<string[]> {
  const config = await readConfig()
  return config.selected
}

export async function setHomeGallerySelection(paths: string[]): Promise<string[]> {
  const selected = normalizePaths(paths)
  if (selected.length !== HOME_GALLERY_LIMIT) {
    throw new Error('Нужно выбрать ровно 4 фотографии для главной страницы')
  }
  await writeConfig({ selected })
  return selected
}

export async function getHomeGalleryPhotos(): Promise<Photo[]> {
  const allPhotos = getAllPhotos()
  if (allPhotos.length === 0) return []

  const selected = await getHomeGallerySelection()
  const photoByPath = new Map(allPhotos.map((photo) => [photo.path, photo]))

  const selectedPhotos = selected
    .map((photoPath) => photoByPath.get(photoPath))
    .filter((photo): photo is Photo => Boolean(photo))

  if (selectedPhotos.length > 0) {
    return selectedPhotos.slice(0, HOME_GALLERY_LIMIT)
  }

  return allPhotos.slice(0, HOME_GALLERY_LIMIT)
}

export function getHomeGalleryLimit(): number {
  return HOME_GALLERY_LIMIT
}
