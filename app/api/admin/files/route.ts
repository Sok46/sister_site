import path from 'path'
import { promises as fs } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
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

function normalizeRelative(input: string): string {
  const cleaned = (input || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.\.+/g, '')

  return cleaned
}

function sanitizeFileName(input: string): string {
  const cleaned = (input || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || `file-${Date.now()}`
}

function extensionOf(fileName: string): string {
  const ext = path.extname(fileName || '').toLowerCase()
  return ext
}

function uploadKindByPath(relativePath: string): 'video' | 'photo' | 'audio' | null {
  const first = normalizeRelative(relativePath).split('/')[0] || ''
  if (first === 'videos') return 'video'
  if (first === 'photos') return 'photo'
  if (first === 'audio') return 'audio'
  return null
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.ogv'])
const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg'])
const execFileAsync = promisify(execFile)

function isAllowedExtension(kind: 'video' | 'photo' | 'audio', ext: string): boolean {
  if (kind === 'video') return VIDEO_EXTENSIONS.has(ext)
  if (kind === 'photo') return PHOTO_EXTENSIONS.has(ext)
  return AUDIO_EXTENSIONS.has(ext)
}

async function tryTranscodeToWebMp4(
  inputPath: string,
  outputPath: string
): Promise<{ ok: boolean; warning?: string }> {
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '25',
      '-movflags',
      '+faststart',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      outputPath,
    ])
    return { ok: true }
  } catch {
    return {
      ok: false,
      warning:
        'Не удалось автоматически перекодировать видео в web-mp4. Используется исходный файл (проверьте ffmpeg на сервере).',
    }
  }
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
    const publicRoot = path.join(process.cwd(), 'public')
    const requestedRaw = request.nextUrl.searchParams.get('path') || ''
    const requested = normalizeRelative(requestedRaw)
    const targetDir = getSafePath(publicRoot, requested)
    const kind = uploadKindByPath(requested)

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
    const bytes = Buffer.from(await file.arrayBuffer())
    await fs.writeFile(sourcePath, bytes)

    let finalName = sourceName
    let finalPath = sourcePath
    let warning: string | undefined
    let sourcePublicUrl: string | null = null
    let transcoded = false

    if (kind === 'video') {
      const baseName = sourceName.replace(/\.[^/.]+$/, '')
      const webName = `${baseName}-web.mp4`
      const webPath = path.join(targetDir, webName)
      const transcode = await tryTranscodeToWebMp4(sourcePath, webPath)
      if (transcode.ok) {
        finalName = webName
        finalPath = webPath
        try {
          await fs.unlink(sourcePath)
        } catch {
          // Если не удалось удалить исходник, просто отдадим ссылку на него.
          sourcePublicUrl = `/${normalizeRelative(path.relative(publicRoot, sourcePath))}`
        }
        transcoded = true
      } else {
        warning = transcode.warning
      }
    }

    const finalStat = await fs.stat(finalPath)
    const relativePath = normalizeRelative(path.relative(publicRoot, finalPath))
    return NextResponse.json({
      success: true,
      relativePath,
      publicUrl: `/${relativePath}`,
      fileName: finalName,
      size: finalStat.size,
      sourceFileName: sourceName,
      sourcePublicUrl,
      transcoded,
      warning: warning || null,
    })
  } catch (error) {
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
