import { NextRequest, NextResponse } from 'next/server'
import { trackAnalyticsView, type AnalyticsKind } from '@/lib/analytics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TrackBody {
  kind?: AnalyticsKind
  id?: string
  watchSeconds?: number
  completed?: boolean
  incrementView?: boolean
}

function isKind(value: unknown): value is AnalyticsKind {
  return value === 'video' || value === 'photo' || value === 'merch'
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TrackBody
    if (!isKind(body.kind)) {
      return NextResponse.json({ error: 'Некорректный kind' }, { status: 400 })
    }
    const id = String(body.id || '').trim()
    if (!id) {
      return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
    }

    const count = trackAnalyticsView(body.kind, id, {
      watchSeconds: body.watchSeconds,
      completed: body.completed,
      incrementView: body.incrementView,
    })
    return NextResponse.json({ success: true, count })
  } catch {
    return NextResponse.json({ error: 'Не удалось сохранить просмотр' }, { status: 400 })
  }
}
