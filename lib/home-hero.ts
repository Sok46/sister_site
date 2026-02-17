import path from 'path'
import { promises as fs } from 'fs'

export interface HomeHeroSettings {
  words: [string, string, string]
  tagline: string
  image: string
  imageAlt: string
  intro: string
}

const HOME_HERO_FILE = path.join(process.cwd(), 'content', 'home', 'hero.json')

const DEFAULT_HOME_HERO_SETTINGS: HomeHeroSettings = {
  words: ['ЙОГА', 'СЕМЬЯ', 'ГОРЫ'],
  tagline: 'Здесь живёт ваш баланс',
  image: '/photos/main.jpg',
  imageAlt: 'Зоя',
  intro: 'Привет! Я Зоя. А это — пространство для тех, кто ищет точку опоры в ритме современной жизни.',
}

function sanitizeWord(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim()
  return text || fallback
}

function sanitizeImagePath(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return DEFAULT_HOME_HERO_SETTINGS.image
  return text.startsWith('/') ? text : `/${text}`
}

function sanitizeSettings(raw: Partial<HomeHeroSettings> | null | undefined): HomeHeroSettings {
  const wordsRaw = Array.isArray(raw?.words) ? raw!.words : []
  const words: [string, string, string] = [
    sanitizeWord(wordsRaw[0], DEFAULT_HOME_HERO_SETTINGS.words[0]),
    sanitizeWord(wordsRaw[1], DEFAULT_HOME_HERO_SETTINGS.words[1]),
    sanitizeWord(wordsRaw[2], DEFAULT_HOME_HERO_SETTINGS.words[2]),
  ]

  return {
    words,
    tagline: sanitizeWord(raw?.tagline, DEFAULT_HOME_HERO_SETTINGS.tagline),
    image: sanitizeImagePath(raw?.image),
    imageAlt: sanitizeWord(raw?.imageAlt, DEFAULT_HOME_HERO_SETTINGS.imageAlt),
    intro: sanitizeWord(raw?.intro, DEFAULT_HOME_HERO_SETTINGS.intro),
  }
}

export async function getHomeHeroSettings(): Promise<HomeHeroSettings> {
  try {
    const raw = await fs.readFile(HOME_HERO_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<HomeHeroSettings>
    return sanitizeSettings(parsed)
  } catch {
    return DEFAULT_HOME_HERO_SETTINGS
  }
}

export async function setHomeHeroSettings(settings: Partial<HomeHeroSettings>): Promise<HomeHeroSettings> {
  const safe = sanitizeSettings(settings)
  await fs.mkdir(path.dirname(HOME_HERO_FILE), { recursive: true })
  await fs.writeFile(HOME_HERO_FILE, JSON.stringify(safe, null, 2), 'utf8')
  return safe
}
