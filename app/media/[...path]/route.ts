import path from 'path'
import { createReadStream } from 'fs'
import { promises as fs } from 'fs'
import { Readable } from 'stream'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

function getContentType(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function resolveSafePublicFile(parts: string[]): string | null {
  const safeParts = (parts || []).map((part) => decodeURIComponent(part)).filter(Boolean)
  const relativePath = safeParts.join('/').replace(/\\/g, '/').replace(/\.\.+/g, '')
  if (!relativePath) return null

  const publicRoot = path.join(process.cwd(), 'public')
  const resolved = path.resolve(publicRoot, relativePath)
  const safePrefix = publicRoot.endsWith(path.sep) ? publicRoot : `${publicRoot}${path.sep}`
  if (!resolved.startsWith(safePrefix)) return null
  return resolved
}

export async function GET(
  request: NextRequest,
  context: { params: { path: string[] } }
) {
  const targetPath = resolveSafePublicFile(context.params.path)
  if (!targetPath) {
    return new NextResponse('Not Found', { status: 404 })
  }

  let stat
  try {
    stat = await fs.stat(targetPath)
  } catch {
    return new NextResponse('Not Found', { status: 404 })
  }
  if (!stat.isFile()) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const contentType = getContentType(targetPath)
  const range = request.headers.get('range')

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (!match) {
      return new NextResponse('Range Not Satisfiable', { status: 416 })
    }

    const size = stat.size
    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= size) {
      return new NextResponse('Range Not Satisfiable', { status: 416 })
    }

    const stream = createReadStream(targetPath, { start, end })
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  }

  const stream = createReadStream(targetPath)
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
