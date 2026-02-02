import { NextRequest, NextResponse } from 'next/server'
import { getAvailableSlotsForDate } from '@/lib/booking'

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: 'Укажите дату в формате YYYY-MM-DD' },
      { status: 400 }
    )
  }
  const slots = getAvailableSlotsForDate(date)
  return NextResponse.json({ date, slots })
}
