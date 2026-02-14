import { NextRequest, NextResponse } from 'next/server'
import { mkdir, writeFile } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { requireAdminTokenValue } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm'])
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024 // 1 GB
const execFileAsync = promisify(execFile)

function normalizeToken(value: string | null): string {
  return (value || '').trim()
}

function getRequestToken(request: NextRequest, formToken?: string): string {
  const headerToken = normalizeToken(request.headers.get('x-upload-token'))
  if (headerToken) return headerToken

  const auth = normalizeToken(request.headers.get('authorization'))
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }

  return normalizeToken(formToken || '')
}

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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const requestToken = getRequestToken(
      request,
      String(formData.get('token') || '')
    )
    const denied = requireAdminTokenValue(requestToken)
    if (denied) return denied

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

    const bytes = Buffer.from(await file.arrayBuffer())
    await writeFile(targetPath, bytes)

    const webFilename = `${base}-${timestamp}-web.mp4`
    const webTargetPath = path.join(videosDir, webFilename)
    const transcode = await tryTranscodeToWebMp4(targetPath, webTargetPath)

    const finalFileName = transcode.ok ? webFilename : filename
    const finalUrl = `/videos/${finalFileName}`

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
