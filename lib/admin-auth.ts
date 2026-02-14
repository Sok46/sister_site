import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/admin-token-store'

function normalize(value: string | null): string {
  return (value || '').trim()
}

export function readAdminToken(request: NextRequest): string {
  const header = normalize(request.headers.get('x-admin-token'))
  if (header) return header

  const uploadHeader = normalize(request.headers.get('x-upload-token'))
  if (uploadHeader) return uploadHeader

  const auth = normalize(request.headers.get('authorization'))
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }

  return ''
}

export function requireAdminTokenValue(rawToken: string): NextResponse | null {
  const result = verifyAdminToken(rawToken)
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  if (!result.valid) {
    return NextResponse.json({ error: 'Доступ запрещен' }, { status: 401 })
  }

  return null
}

export function requireAdminToken(request: NextRequest): NextResponse | null {
  return requireAdminTokenValue(readAdminToken(request))
}
