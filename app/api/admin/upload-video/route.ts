import { NextRequest, NextResponse } from 'next/server'
import { mkdir } from 'fs/promises'
import path from 'path'
import { requireAdminToken } from '@/lib/admin-auth'
import { createWriteStream } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm'])
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024 // 1 GB

function sanitizeBasename(input: string): string {
  const base = input
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return base || `video-${Date.now()}`
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
    const finalFileName = filename
    const finalUrl = `/videos/${filename}`

    return NextResponse.json({
      success: true,
      fileName: finalFileName,
      url: finalUrl,
      size: file.size,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Ошибка загрузки файла'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
