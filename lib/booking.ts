import fs from 'fs'
import path from 'path'
import { format, parseISO, isValid } from 'date-fns'
import { ru } from 'date-fns/locale/ru'

const BOOKINGS_DIR = path.join(process.cwd(), 'content', 'bookings')
const SLOTS_FILE = path.join(BOOKINGS_DIR, 'available-slots.json')
const BOOKINGS_FILE = path.join(BOOKINGS_DIR, 'bookings.json')

export interface Booking {
  id: string
  date: string
  time: string
  name: string
  phone: string
  comment: string
  paymentId?: string
  createdAt: string
}

type AvailableSlots = Record<string, string[]>

function parseMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((time || '').trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

function toTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function normalizeSlotValue(raw: string): string | null {
  const value = (raw || '').trim()
  if (!value) return null

  if (value.includes('-')) {
    const [startRaw, endRaw] = value.split('-')
    const start = parseMinutes(startRaw)
    const end = parseMinutes(endRaw)
    if (start === null || end === null || end <= start) return null
    return `${toTimeString(start)}-${toTimeString(end)}`
  }

  // Обратная совместимость: старый формат одного времени.
  const start = parseMinutes(value)
  if (start === null) return null
  if (start + 60 > 24 * 60) return null
  return `${toTimeString(start)}-${toTimeString(start + 60)}`
}

function ensureDir() {
  if (!fs.existsSync(BOOKINGS_DIR)) {
    fs.mkdirSync(BOOKINGS_DIR, { recursive: true })
  }
}

function readSlots(): AvailableSlots {
  ensureDir()
  if (!fs.existsSync(SLOTS_FILE)) return {}
  try {
    const data = fs.readFileSync(SLOTS_FILE, 'utf8')
    return JSON.parse(data) as AvailableSlots
  } catch {
    return {}
  }
}

function writeSlots(slots: AvailableSlots) {
  ensureDir()
  fs.writeFileSync(SLOTS_FILE, JSON.stringify(slots, null, 2), 'utf8')
}

function readBookings(): Booking[] {
  ensureDir()
  if (!fs.existsSync(BOOKINGS_FILE)) return []
  try {
    const data = fs.readFileSync(BOOKINGS_FILE, 'utf8')
    return JSON.parse(data) as Booking[]
  } catch {
    return []
  }
}

function writeBookings(bookings: Booking[]) {
  ensureDir()
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2), 'utf8')
}

export function getAvailableSlotsForDate(date: string): string[] {
  const slots = readSlots()
  const dateSlots = (slots[date] || [])
    .map((item) => normalizeSlotValue(item))
    .filter((item): item is string => Boolean(item))
  const bookings = readBookings()
  const bookedTimes = new Set(
    bookings
      .filter((b) => b.date === date)
      .map((b) => normalizeSlotValue(b.time))
      .filter((item): item is string => Boolean(item))
  )
  return [...new Set(dateSlots)]
    .filter((t) => !bookedTimes.has(t))
    .sort((a, b) => a.localeCompare(b))
}

export function getAllSlots(): AvailableSlots {
  return readSlots()
}

export function setSlotsForDate(date: string, times: string[]) {
  const slots = readSlots()
  const validTimes = [...new Set(times.map((t) => normalizeSlotValue(t)).filter((t): t is string => Boolean(t)))]
  if (validTimes.length > 0) {
    slots[date] = validTimes.sort()
  } else {
    delete slots[date]
  }
  writeSlots(slots)
}

export function addSlotsForDate(date: string, times: string[]) {
  const slots = readSlots()
  const existing = new Set(slots[date] || [])
  times.forEach((t) => {
    const normalized = normalizeSlotValue(t)
    if (normalized) existing.add(normalized)
  })
  slots[date] = [...existing].sort()
  writeSlots(slots)
}

export function removeSlotsForDate(date: string, times: string[]) {
  const slots = readSlots()
  const existing = new Set(slots[date] || [])
  times.forEach((t) => existing.delete(t))
  const next = [...existing].sort()
  if (next.length > 0) {
    slots[date] = next
  } else {
    delete slots[date]
  }
  writeSlots(slots)
}

export function clearSlotsForDate(date: string) {
  const slots = readSlots()
  delete slots[date]
  writeSlots(slots)
}

export function createBooking(data: {
  date: string
  time: string
  name: string
  phone: string
  comment: string
  paymentId?: string
}): Booking {
  const normalizedTime = normalizeSlotValue(data.time)
  if (!normalizedTime) {
    throw new Error('Неверный формат времени. Используйте HH:MM-HH:MM')
  }

  const bookings = readBookings()

  // Идемпотентность: если запись с таким paymentId уже есть — вернуть её
  if (data.paymentId) {
    const existing = bookings.find((b) => b.paymentId === data.paymentId)
    if (existing) return existing
  }

  const slots = getAvailableSlotsForDate(data.date)
  if (!slots.includes(normalizedTime)) {
    throw new Error('Это время уже занято')
  }

  const id = `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const booking: Booking = {
    id,
    ...data,
    time: normalizedTime,
    createdAt: new Date().toISOString(),
  }
  bookings.push(booking)
  writeBookings(bookings)
  return booking
}

export function getAllBookings(): Booking[] {
  return readBookings().sort(
    (a, b) =>
      new Date(a.date + 'T' + a.time).getTime() -
      new Date(b.date + 'T' + b.time).getTime()
  )
}

export function getBookingsForDate(date: string): Booking[] {
  return getAllBookings().filter((b) => b.date === date)
}

export function deleteBookingById(id: string): boolean {
  const bookings = readBookings()
  const next = bookings.filter((item) => item.id !== id)
  if (next.length === bookings.length) return false
  writeBookings(next)
  return true
}

export function formatDateRu(d: string): string {
  const parsed = parseISO(d)
  if (!isValid(parsed)) return d
  return format(parsed, 'd MMMM yyyy', { locale: ru })
}
