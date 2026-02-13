import { NextRequest, NextResponse } from 'next/server'

function unauthorizedResponse() {
  return new NextResponse('Authorization required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Admin Upload", charset="UTF-8"',
    },
  })
}

function parseBasicAuth(authHeader: string | null): { user: string; pass: string } | null {
  if (!authHeader || !authHeader.startsWith('Basic ')) return null

  try {
    const encoded = authHeader.slice(6).trim()
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8')
    const separator = decoded.indexOf(':')
    if (separator < 0) return null
    return {
      user: decoded.slice(0, separator),
      pass: decoded.slice(separator + 1),
    }
  } catch {
    return null
  }
}

export function middleware(request: NextRequest) {
  const expectedUser = (process.env.ADMIN_UPLOAD_USER || '').trim()
  const expectedPass = (process.env.ADMIN_UPLOAD_PASSWORD || '').trim()

  // Если не настроены данные Basic Auth — пропускаем (останется защита токеном в API).
  if (!expectedUser || !expectedPass) {
    return NextResponse.next()
  }

  const credentials = parseBasicAuth(request.headers.get('authorization'))
  if (!credentials) {
    return unauthorizedResponse()
  }

  if (credentials.user !== expectedUser || credentials.pass !== expectedPass) {
    return unauthorizedResponse()
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
