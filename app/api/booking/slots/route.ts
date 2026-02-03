import { NextRequest, NextResponse } from 'next/server'
import { getAvailableSlotsForDate, getAllSlots } from '@/lib/booking'

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date')

  // Если дата не указана — возвращаем список дат, где есть хотя бы одно свободное окно
  if (!date) {
    const allSlots = getAllSlots()
    const todayStr = new Date().toISOString().slice(0, 10)
    const datesWithAvailable = Object.keys(allSlots)
      .filter((d) => d >= todayStr)
      .filter((d) => getAvailableSlotsForDate(d).length > 0)

    return NextResponse.json({ dates: datesWithAvailable })
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: 'Укажите дату в формате YYYY-MM-DD' },
      { status: 400 }
    )
  }

  const slots = getAvailableSlotsForDate(date)
  return NextResponse.json({ date, slots })
}
