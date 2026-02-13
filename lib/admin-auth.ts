import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { createHash, timingSafeEqual } from 'crypto'

interface StoredAdminToken {
  tokenHash: string
  createdAt: string
  expiresAt: string
  source?: string
}

const ADMIN_TOKEN_FILE = path.join(
  process.cwd(),
  'content',
  'admin',
  'access-token.json'
)

function normalize(value: string | null): string {
  return (value || '').trim()
}

export function readAdminToken(request: NextRequest): string {
  const header = normalize(request.headers.get('x-admin-token'))
  if (header) return header

  const auth = normalize(request.headers.get('authorization'))
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }

  return ''
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function safeEqualsHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex')
  const b = Buffer.from(bHex, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function readStoredAdminToken(): StoredAdminToken | null {
  try {
    if (!fs.existsSync(ADMIN_TOKEN_FILE)) return null
    const raw = fs.readFileSync(ADMIN_TOKEN_FILE, 'utf8')
    const data = JSON.parse(raw) as Partial<StoredAdminToken>
    if (!data?.tokenHash || !data.expiresAt) return null
    return {
      tokenHash: String(data.tokenHash),
      createdAt: String(data.createdAt || ''),
      expiresAt: String(data.expiresAt),
      source: data.source ? String(data.source) : undefined,
    }
  } catch {
    return null
  }
}

function isStoredTokenExpired(expiresAtIso: string): boolean {
  const ts = new Date(expiresAtIso).getTime()
  if (!Number.isFinite(ts)) return true
  return Date.now() > ts
}

export function requireAdminToken(request: NextRequest): NextResponse | null {
  const actual = readAdminToken(request)
  if (!actual) {
    return NextResponse.json({ error: 'Требуется токен доступа' }, { status: 401 })
  }

  // Приоритет: временный токен из Telegram-бота (если существует).
  const stored = readStoredAdminToken()
  if (stored) {
    if (isStoredTokenExpired(stored.expiresAt)) {
      return NextResponse.json(
        { error: 'Токен истек. Сгенерируйте новый в Telegram-боте.' },
        { status: 401 }
      )
    }

    const actualHash = sha256(actual)
    if (!safeEqualsHex(actualHash, stored.tokenHash)) {
      return NextResponse.json({ error: 'Неверный токен' }, { status: 401 })
    }

    return null
  }

  // Fallback: статичный токен из env.
  const expectedEnv = normalize(process.env.ADMIN_UPLOAD_TOKEN || '')
  if (!expectedEnv) {
    return NextResponse.json(
      { error: 'Токен админа не настроен (нет access-token.json и ADMIN_UPLOAD_TOKEN)' },
      { status: 500 }
    )
  }

  if (actual !== expectedEnv) {
    return NextResponse.json({ error: 'Доступ запрещен' }, { status: 401 })
  }

  return null
}
