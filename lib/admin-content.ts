import path from 'path'
import { promises as fs } from 'fs'
import matter from 'gray-matter'
import { getAllPackages, type YogaPackage, type VideoLesson } from '@/lib/yoga'
import { getAllPlaylistItems, type PlaylistItem } from '@/lib/playlist'
import { getAllPosts, type Post } from '@/lib/posts'

export interface AdminContentSnapshot {
  yogaPackages: YogaPackage[]
  playlistItems: PlaylistItem[]
  posts: Post[]
}

const ROOT = process.cwd()
const YOGA_PACKAGES_FILE = path.join(ROOT, 'content', 'yoga', 'packages.json')
const PLAYLIST_DIR = path.join(ROOT, 'content', 'playlist')
const POSTS_DIR = path.join(ROOT, 'content', 'posts')

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return slug || `post-${Date.now()}`
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

async function writeYogaPackages(packages: YogaPackage[]): Promise<void> {
  await ensureDir(path.dirname(YOGA_PACKAGES_FILE))
  await fs.writeFile(YOGA_PACKAGES_FILE, JSON.stringify(packages, null, 2), 'utf8')
}

async function readYogaPackages(): Promise<YogaPackage[]> {
  return getAllPackages()
}

async function readPlaylistItems(): Promise<PlaylistItem[]> {
  return getAllPlaylistItems()
}

async function readPosts(): Promise<Post[]> {
  return getAllPosts()
}

export async function getAdminContentSnapshot(): Promise<AdminContentSnapshot> {
  const [yogaPackages, playlistItems, posts] = await Promise.all([
    readYogaPackages(),
    readPlaylistItems(),
    readPosts(),
  ])

  return { yogaPackages, playlistItems, posts }
}

export async function createYogaPackage(): Promise<YogaPackage> {
  const packages = await readYogaPackages()
  const newPackage: YogaPackage = {
    id: `pkg-${Date.now()}`,
    name: 'Новый пакет',
    level: 'Все уровни',
    description: '',
    videos: [],
    price: 0,
    image: '🧘',
    available: true,
  }
  packages.unshift(newPackage)
  await writeYogaPackages(packages)
  return newPackage
}

export async function updateYogaPackage(id: string, patch: Partial<YogaPackage>): Promise<void> {
  const packages = await readYogaPackages()
  const idx = packages.findIndex((item) => item.id === id)
  if (idx < 0) throw new Error('Пакет не найден')

  packages[idx] = {
    ...packages[idx],
    ...patch,
    id: packages[idx].id,
    videos: patch.videos ?? packages[idx].videos,
  }
  await writeYogaPackages(packages)
}

export async function deleteYogaPackage(id: string): Promise<void> {
  const packages = await readYogaPackages()
  const next = packages.filter((item) => item.id !== id)
  await writeYogaPackages(next)
}

export async function addYogaVideo(packageId: string): Promise<void> {
  const packages = await readYogaPackages()
  const idx = packages.findIndex((item) => item.id === packageId)
  if (idx < 0) throw new Error('Пакет не найден')

  const video: VideoLesson = {
    title: 'Новый видеоурок',
    duration: '0 мин',
  }
  packages[idx].videos.push(video)
  await writeYogaPackages(packages)
}

export async function updateYogaVideo(
  packageId: string,
  videoIndex: number,
  patch: Partial<VideoLesson>
): Promise<void> {
  const packages = await readYogaPackages()
  const packageIdx = packages.findIndex((item) => item.id === packageId)
  if (packageIdx < 0) throw new Error('Пакет не найден')
  if (videoIndex < 0 || videoIndex >= packages[packageIdx].videos.length) {
    throw new Error('Видеоурок не найден')
  }

  packages[packageIdx].videos[videoIndex] = {
    ...packages[packageIdx].videos[videoIndex],
    ...patch,
  }
  await writeYogaPackages(packages)
}

export async function deleteYogaVideo(packageId: string, videoIndex: number): Promise<void> {
  const packages = await readYogaPackages()
  const packageIdx = packages.findIndex((item) => item.id === packageId)
  if (packageIdx < 0) throw new Error('Пакет не найден')
  if (videoIndex < 0 || videoIndex >= packages[packageIdx].videos.length) {
    throw new Error('Видеоурок не найден')
  }

  packages[packageIdx].videos.splice(videoIndex, 1)
  await writeYogaPackages(packages)
}

function normalizePlaylistItem(input: PlaylistItem): PlaylistItem {
  return {
    id: input.id || `playlist-${Date.now()}`,
    title: input.title || 'Новый элемент',
    type: input.type || 'audio',
    src: input.src || '',
    duration: input.duration || '',
    description: input.description || '',
    category: input.category || '',
  }
}

async function writePlaylistItem(item: PlaylistItem): Promise<void> {
  await ensureDir(PLAYLIST_DIR)
  const safe = normalizePlaylistItem(item)
  const filePath = path.join(PLAYLIST_DIR, `${safe.id}.json`)
  await fs.writeFile(filePath, JSON.stringify(safe, null, 2), 'utf8')
}

export async function createPlaylistItem(): Promise<PlaylistItem> {
  const item: PlaylistItem = normalizePlaylistItem({
    id: `playlist-${Date.now()}`,
    title: 'Новый аудио',
    type: 'audio',
    src: '',
    duration: '',
    description: '',
    category: '',
  })
  await writePlaylistItem(item)
  return item
}

export async function updatePlaylistItem(item: PlaylistItem): Promise<void> {
  if (!item.id?.trim()) throw new Error('Укажите ID')
  await writePlaylistItem(item)
}

export async function deletePlaylistItem(id: string): Promise<void> {
  const filePath = path.join(PLAYLIST_DIR, `${id}.json`)
  try {
    await fs.unlink(filePath)
  } catch {
    // ignore if missing
  }
}

function frontmatterFromPost(post: Post): Record<string, string> {
  return {
    title: post.title || 'Новый пост',
    date: post.date || new Date().toISOString().slice(0, 10),
    category: post.category || 'Йога',
    excerpt: post.excerpt || '',
    emoji: post.emoji || '📝',
    image: post.image || '',
    previewImage: post.previewImage || '',
    video: post.video || '',
    telegram: post.telegram || '',
  }
}

function sanitizePost(post: Post): Post {
  const id = post.id?.trim() ? slugify(post.id) : slugify(post.title)
  return {
    id,
    title: post.title || 'Новый пост',
    date: post.date || new Date().toISOString().slice(0, 10),
    category: post.category || 'Йога',
    excerpt: post.excerpt || '',
    content: post.content || '',
    emoji: post.emoji || '📝',
    image: post.image || '',
    previewImage: post.previewImage || '',
    video: post.video || '',
    telegram: post.telegram || '',
  }
}

async function writePost(post: Post): Promise<void> {
  const safe = sanitizePost(post)
  await ensureDir(POSTS_DIR)
  const filePath = path.join(POSTS_DIR, `${safe.id}.md`)
  const md = matter.stringify(safe.content || '', frontmatterFromPost(safe))
  await fs.writeFile(filePath, md, 'utf8')
}

export async function createPost(): Promise<Post> {
  const now = new Date()
  const id = `post-${now.getTime()}`
  const post: Post = {
    id,
    title: 'Новый пост',
    date: now.toISOString().slice(0, 10),
    category: 'Йога',
    excerpt: '',
    content: '',
    emoji: '📝',
    image: '',
    previewImage: '',
    video: '',
    telegram: '',
  }
  await writePost(post)
  return post
}

export async function updatePost(post: Post): Promise<Post> {
  const safe = sanitizePost(post)
  await writePost(safe)
  if (post.id && post.id !== safe.id) {
    const oldPath = path.join(POSTS_DIR, `${post.id}.md`)
    try {
      await fs.unlink(oldPath)
    } catch {
      // ignore if old file does not exist
    }
  }
  return safe
}

export async function deletePost(id: string): Promise<void> {
  const filePath = path.join(POSTS_DIR, `${id}.md`)
  try {
    await fs.unlink(filePath)
  } catch {
    // ignore if missing
  }
}
