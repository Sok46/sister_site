import { NextRequest, NextResponse } from 'next/server'
import { mkdir, unlink } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { requireAdminToken } from '@/lib/admin-auth'
import { createWriteStream } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm'])
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024 // 1 GB
const execFileAsync = promisify(execFile)
const MAX_TRANSCODE_BYTES = 400 * 1024 * 1024 // 400 MB

function sanitizeBasename(input: string): string {
  const base = input
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return base || `video-${Date.now()}`
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
      '23',
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
        'Не удалось автоматически конвертировать в web-mp4. Используется исходный файл (проверьте ffmpeg на сервере).',
    }
  }
}

async function writeWebFileToDisk(file: File, destinationPath: string): Promise<void> {
  const webStream = file.stream()
  const nodeReadable = Readable.fromWeb(webStream as any)
  const nodeWritable = createWriteStream(destinationPath, { flags: 'w' })
  await pipeline(nodeReadable, nodeWritable)
}

export async function POST(request: NextRequest) {
  const denied = requireAdminToken(request)
  if (denied) return denied

  try {
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

    const originalName = file.name || 'video.mp4'
    const ext = path.extname(originalName).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: 'Разрешены только: .mp4, .mov, .m4v, .webm' },
        { status: 400 }
      )
    }

    const rootDir = process.cwd()
    const videosDir = path.join(rootDir, 'public', 'videos')
    await mkdir(videosDir, { recursive: true })

    const base = sanitizeBasename(originalName)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${base}-${timestamp}${ext}`
    const targetPath = path.join(videosDir, filename)

    await writeWebFileToDisk(file, targetPath)

    const webFilename = `${base}-${timestamp}-web.mp4`
    const webTargetPath = path.join(videosDir, webFilename)
    let transcode: { ok: boolean; warning?: string }
    if (file.size > MAX_TRANSCODE_BYTES) {
      transcode = {
        ok: false,
        warning:
          'Видео загружено без перекодирования: файл слишком большой для безопасной серверной компрессии.',
      }
    } else {
      transcode = await tryTranscodeToWebMp4(targetPath, webTargetPath)
    }

    const finalFileName = transcode.ok ? webFilename : filename
    const finalUrl = `/videos/${finalFileName}`
    if (transcode.ok) {
      try {
        await unlink(targetPath)
      } catch {
        // no-op
      }
    }

    return NextResponse.json({
      success: true,
      fileName: finalFileName,
      url: finalUrl,
      size: file.size,
      sourceFileName: filename,
      sourceUrl: `/videos/${filename}`,
      transcoded: transcode.ok,
      warning: transcode.warning || null,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Ошибка загрузки файла'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
