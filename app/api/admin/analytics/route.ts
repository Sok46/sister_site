import { NextRequest, NextResponse } from 'next/server'
import { requireAdminToken } from '@/lib/admin-auth'
import { getAnalyticsSnapshot } from '@/lib/analytics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export async function GET(request: NextRequest) {
  const denied = requireAdminToken(request)
  if (denied) return denied

  const from = String(request.nextUrl.searchParams.get('from') || '').trim()
  const to = String(request.nextUrl.searchParams.get('to') || '').trim()

  if (from && !isIsoDate(from)) {
    return NextResponse.json({ error: 'Некорректный формат даты "с"' }, { status: 400 })
  }
  if (to && !isIsoDate(to)) {
    return NextResponse.json({ error: 'Некорректный формат даты "по"' }, { status: 400 })
  }
  if (from && to && from > to) {
    return NextResponse.json({ error: 'Дата "с" не может быть позже даты "по"' }, { status: 400 })
  }

  const snapshot = getAnalyticsSnapshot({ from, to })
  return NextResponse.json({
    ...snapshot,
    period: {
      from: from || null,
      to: to || null,
    },
  })
}
