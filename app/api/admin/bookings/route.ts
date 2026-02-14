import { NextRequest, NextResponse } from 'next/server'
import {
  addSlotsForDate,
  clearSlotsForDate,
  createBooking,
  deleteBookingById,
  getAllBookings,
  getAllSlots,
  removeSlotsForDate,
} from '@/lib/booking'
import { requireAdminToken } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AdminBookingsAction =
  | 'slots.add'
  | 'slots.remove'
  | 'slots.clearDate'
  | 'bookings.delete'
  | 'bookings.create'

interface ActionBody {
  action: AdminBookingsAction
  date?: string
  time?: string
  startTime?: string
  endTime?: string
  bookingId?: string
  name?: string
  phone?: string
  comment?: string
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isValidTime(value: string): boolean {
  return /^\d{1,2}:\d{2}$/.test(value)
}

function isValidRange(value: string): boolean {
  return /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(value)
}

function makeSlotRange(start: string, end: string): string {
  if (!isValidTime(start) || !isValidTime(end)) {
    throw new Error('Неверный формат времени')
  }
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  if (sm % 5 !== 0 || em % 5 !== 0) {
    throw new Error('Минуты должны быть с шагом 5')
  }
  const startMinutes = sh * 60 + sm
  const endMinutes = eh * 60 + em
  if (endMinutes <= startMinutes) {
    throw new Error('Время окончания должно быть позже времени начала')
  }
  const norm = (v: number) => String(v).padStart(2, '0')
  return `${norm(sh)}:${norm(sm)}-${norm(eh)}:${norm(em)}`
}

function snapshot() {
  return {
    slots: getAllSlots(),
    bookings: getAllBookings(),
  }
}

export async function GET(request: NextRequest) {
  const denied = requireAdminToken(request)
  if (denied) return denied
  return NextResponse.json(snapshot())
}

export async function POST(request: NextRequest) {
  const denied = requireAdminToken(request)
  if (denied) return denied

  try {
    const body = (await request.json()) as ActionBody
    if (!body?.action) {
      return NextResponse.json({ error: 'action обязателен' }, { status: 400 })
    }

    if (body.action === 'slots.add') {
      const date = (body.date || '').trim()
      const startTime = (body.startTime || '').trim()
      const endTime = (body.endTime || '').trim()
      if (!isValidDate(date)) throw new Error('Неверный формат даты')
      const range = makeSlotRange(startTime, endTime)
      addSlotsForDate(date, [range])
    } else if (body.action === 'slots.remove') {
      const date = (body.date || '').trim()
      const time = (body.time || '').trim()
      if (!isValidDate(date)) throw new Error('Неверный формат даты')
      if (!isValidRange(time)) throw new Error('Неверный формат слота')
      removeSlotsForDate(date, [time])
    } else if (body.action === 'slots.clearDate') {
      const date = (body.date || '').trim()
      if (!isValidDate(date)) throw new Error('Неверный формат даты')
      clearSlotsForDate(date)
    } else if (body.action === 'bookings.delete') {
      const bookingId = (body.bookingId || '').trim()
      if (!bookingId) throw new Error('bookingId обязателен')
      const removed = deleteBookingById(bookingId)
      if (!removed) throw new Error('Запись не найдена')
    } else if (body.action === 'bookings.create') {
      const date = (body.date || '').trim()
      const time = (body.time || '').trim()
      const name = String(body.name || '').trim()
      const phone = String(body.phone || '').trim()
      const comment = String(body.comment || '').trim()
      if (!isValidDate(date)) throw new Error('Неверный формат даты')
      if (!isValidRange(time)) throw new Error('Неверный формат слота')
      if (!name || !phone) throw new Error('Укажите имя и телефон')
      createBooking({ date, time, name, phone, comment })
    } else {
      throw new Error('Неизвестное действие')
    }

    return NextResponse.json({ success: true, ...snapshot() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка выполнения действия'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
