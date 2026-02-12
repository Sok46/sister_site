import { NextResponse } from 'next/server'
import { isYookassaConfigured } from '@/lib/yookassa'

export const dynamic = 'force-dynamic'

export async function GET() {
  const enabled = isYookassaConfigured()
  const price = enabled ? (Number(process.env.LESSON_PRICE_RUB) || 1500) : 0
  return NextResponse.json({ enabled, price })
}
