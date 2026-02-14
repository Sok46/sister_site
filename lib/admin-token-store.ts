import path from 'path'
import { createHmac, timingSafeEqual } from 'crypto'
import Database from 'better-sqlite3'

type ActiveTokenRow = {
  token_hash: string
  expires_at: number
}

function normalize(value: string | null | undefined): string {
  return (value || '').trim()
}

function getDbPath(): string {
  const configured = normalize(process.env.ADMIN_TOKEN_DB_PATH)
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(process.cwd(), configured)
  }
  return path.join(process.cwd(), 'data', 'admin-auth.sqlite')
}

function getHashSecret(): string {
  return normalize(process.env.ADMIN_TOKEN_HASH_SECRET)
}

function openDb(): Database.Database {
  const db = new Database(getDbPath())
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_auth_token (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      token_hash TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_by TEXT
    );
  `)
  return db
}

function hashToken(rawToken: string, secret: string): string {
  return createHmac('sha256', secret).update(rawToken).digest('hex')
}

function safeHashCompare(expectedHex: string, actualHex: string): boolean {
  if (expectedHex.length !== actualHex.length) return false
  const expected = Buffer.from(expectedHex, 'hex')
  const actual = Buffer.from(actualHex, 'hex')
  if (expected.length === 0 || actual.length === 0) return false
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

export function verifyAdminToken(rawToken: string): { valid: boolean; error?: string } {
  const token = normalize(rawToken)
  if (!token) return { valid: false }

  const secret = getHashSecret()
  if (!secret) {
    return { valid: false, error: 'На сервере не настроен ADMIN_TOKEN_HASH_SECRET' }
  }

  const db = openDb()
  try {
    const row = db
      .prepare('SELECT token_hash, expires_at FROM admin_auth_token WHERE id = 1')
      .get() as ActiveTokenRow | undefined

    if (!row?.token_hash) return { valid: false }
    if (!row.expires_at || row.expires_at <= Math.floor(Date.now() / 1000)) {
      return { valid: false }
    }

    const calculated = hashToken(token, secret)
    return { valid: safeHashCompare(row.token_hash, calculated) }
  } finally {
    db.close()
  }
}
