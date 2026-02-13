import path from 'path'
import { promises as fs, createWriteStream } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminToken } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface FileEntry {
  name: string
  kind: 'dir' | 'file'
  relativePath: string
  size: number | null
  updatedAt: string
  publicUrl: string | null
}

type UploadJobStatus = 'processing' | 'done' | 'failed'
interface UploadJob {
  id: string
  status: UploadJobStatus
  progress: number
  message: string
  updatedAt: number
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.ogv'])
const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg'])
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024 // 1 GB
const uploadJobs = new Map<string, UploadJob>()
const JOB_TTL_MS = 30 * 60 * 1000

function normalizeRelative(input: string): string {
  return (input || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.\.+/g, '')
}

function sanitizeFileName(input: string): string {
  const cleaned = (input || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || `file-${Date.now()}`
}

function extensionOf(fileName: string): string {
  return path.extname(fileName || '').toLowerCase()
}

function uploadKindByPath(relativePath: string): 'video' | 'photo' | 'audio' | null {
  const first = normalizeRelative(relativePath).split('/')[0] || ''
  if (first === 'videos') return 'video'
  if (first === 'photos') return 'photo'
  if (first === 'audio') return 'audio'
  return null
}

function isAllowedExtension(kind: 'video' | 'photo' | 'audio', ext: string): boolean {
  if (kind === 'video') return VIDEO_EXTENSIONS.has(ext)
  if (kind === 'photo') return PHOTO_EXTENSIONS.has(ext)
  return AUDIO_EXTENSIONS.has(ext)
}

function nowMs(): number {
  return Date.now()
}

function cleanupOldJobs() {
  const threshold = nowMs() - JOB_TTL_MS
  for (const [id, job] of uploadJobs.entries()) {
    if (job.updatedAt < threshold) uploadJobs.delete(id)
  }
}

function normalizeJobId(input: string | null): string {
  const value = (input || '').trim()
  return /^[a-zA-Z0-9_-]{8,128}$/.test(value) ? value : ''
}

function setJob(
  id: string,
  patch: Partial<Pick<UploadJob, 'status' | 'progress' | 'message'>>
) {
  if (!id) return
  const prev = uploadJobs.get(id)
  uploadJobs.set(id, {
    id,
    status: patch.status || prev?.status || 'processing',
    progress: Math.max(0, Math.min(100, patch.progress ?? prev?.progress ?? 0)),
    message: patch.message || prev?.message || '',
    updatedAt: nowMs(),
  })
}

async function writeWebFileToDisk(file: File, destinationPath: string): Promise<void> {
  const webStream = file.stream()
  const nodeReadable = Readable.fromWeb(webStream as any)
  const nodeWritable = createWriteStream(destinationPath, { flags: 'w' })
  await pipeline(nodeReadable, nodeWritable)
}

function getSafePath(publicRoot: string, relativePath: string): string {
  const resolved = path.resolve(publicRoot, relativePath || '.')
  const safePrefix = publicRoot.endsWith(path.sep) ? publicRoot : `${publicRoot}${path.sep}`
  if (resolved !== publicRoot && !resolved.startsWith(safePrefix)) {
    throw new Error('Недопустимый путь')
  }
  return resolved
}

export async function GET(request: NextRequest) {
  const denied = requireAdminToken(request)
  if (denied) return denied

  try {
    cleanupOldJobs()
    const progressId = normalizeJobId(request.nextUrl.searchParams.get('progressId'))
    if (progressId) {
      const job = uploadJobs.get(progressId)
      if (!job) {
        return NextResponse.json({ error: 'Прогресс не найден' }, { status: 404 })
      }
      return NextResponse.json({
        id: job.id,
        status: job.status,
        progress: job.progress,
        message: job.message,
      })
    }

    const publicRoot = path.join(process.cwd(), 'public')
    const requestedRaw = request.nextUrl.searchParams.get('path') || ''
    const requested = normalizeRelative(requestedRaw)
    const targetDir = getSafePath(publicRoot, requested)

    const dirStat = await fs.stat(targetDir)
    if (!dirStat.isDirectory()) {
      return NextResponse.json({ error: 'Путь не является папкой' }, { status: 400 })
    }

    const dirEntries = await fs.readdir(targetDir, { withFileTypes: true })
    const entries: FileEntry[] = await Promise.all(
      dirEntries.map(async (entry) => {
        const abs = path.join(targetDir, entry.name)
        const st = await fs.stat(abs)
        const relativePath = normalizeRelative(path.relative(publicRoot, abs))
        const isDir = entry.isDirectory()
        return {
          name: entry.name,
          kind: isDir ? 'dir' : 'file',
          relativePath,
          size: isDir ? null : st.size,
          updatedAt: st.mtime.toISOString(),
          publicUrl: isDir ? null : `/${relativePath}`,
        }
      })
    )

    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, 'ru')
    })

    const currentPath = normalizeRelative(path.relative(publicRoot, targetDir))
    const parentPath = currentPath
      ? normalizeRelative(path.dirname(currentPath) === '.' ? '' : path.dirname(currentPath))
      : null

    return NextResponse.json({
      currentPath,
      parentPath,
      entries,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка чтения папки'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  const denied = requireAdminToken(request)
  if (denied) return denied

  try {
    cleanupOldJobs()
    const publicRoot = path.join(process.cwd(), 'public')
    const requestedRaw = request.nextUrl.searchParams.get('path') || ''
    const uploadId = normalizeJobId(request.nextUrl.searchParams.get('uploadId'))
    const requested = normalizeRelative(requestedRaw)
    const targetDir = getSafePath(publicRoot, requested)
    const kind = uploadKindByPath(requested)
    setJob(uploadId, { status: 'processing', progress: 1, message: 'Запрос получен' })

    if (!kind) {
      return NextResponse.json(
        { error: 'Загрузка разрешена только в папках videos, photos и audio' },
        { status: 400 }
      )
    }

    const dirStat = await fs.stat(targetDir)
    if (!dirStat.isDirectory()) {
      return NextResponse.json({ error: 'Путь не является папкой' }, { status: 400 })
    }

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Файл не передан' }, { status: 400 })
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: 'Файл пустой' }, { status: 400 })
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: 'Файл слишком большой. Максимум 1 ГБ.' },
        { status: 400 }
      )
    }

    const originalName = sanitizeFileName(file.name || 'file')
    const ext = extensionOf(originalName)
    if (!isAllowedExtension(kind, ext)) {
      return NextResponse.json(
        { error: `Неподдерживаемый формат для папки ${kind}` },
        { status: 400 }
      )
    }

    const sourceName = `${Date.now()}-${originalName}`
    const sourcePath = path.join(targetDir, sourceName)
    await writeWebFileToDisk(file, sourcePath)
    setJob(uploadId, { progress: 8, message: 'Файл сохранен на сервере' })

    const stat = await fs.stat(sourcePath)
    const relativePath = normalizeRelative(path.relative(publicRoot, sourcePath))
    setJob(uploadId, { status: 'done', progress: 100, message: 'Готово' })
    return NextResponse.json({
      success: true,
      relativePath,
      publicUrl: `/${relativePath}`,
      fileName: sourceName,
      size: stat.size,
      uploadId: uploadId || null,
    })
  } catch (error) {
    const failedUploadId = normalizeJobId(request.nextUrl.searchParams.get('uploadId'))
    setJob(failedUploadId, { status: 'failed', progress: 100, message: 'Ошибка обработки' })
    const message = error instanceof Error ? error.message : 'Ошибка загрузки файла'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  const denied = requireAdminToken(request)
  if (denied) return denied

  try {
    const publicRoot = path.join(process.cwd(), 'public')
    const targetRaw = request.nextUrl.searchParams.get('target') || ''
    const targetRelative = normalizeRelative(targetRaw)
    if (!targetRelative) {
      return NextResponse.json({ error: 'target обязателен' }, { status: 400 })
    }

    const targetPath = getSafePath(publicRoot, targetRelative)
    const stat = await fs.stat(targetPath)
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Можно удалить только файл' }, { status: 400 })
    }

    await fs.unlink(targetPath)
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка удаления файла'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
