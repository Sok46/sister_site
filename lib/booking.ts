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
  const dateSlots = slots[date] || []
  const bookings = readBookings()
  const bookedTimes = new Set(
    bookings.filter((b) => b.date === date).map((b) => b.time)
  )
  return dateSlots.filter((t) => !bookedTimes.has(t))
}

export function getAllSlots(): AvailableSlots {
  return readSlots()
}

export function setSlotsForDate(date: string, times: string[]) {
  const slots = readSlots()
  const validTimes = times.filter((t) => /^\d{1,2}:\d{2}$/.test(t))
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
    if (/^\d{1,2}:\d{2}$/.test(t)) existing.add(t)
  })
  slots[date] = [...existing].sort()
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
  const bookings = readBookings()

  // Идемпотентность: если запись с таким paymentId уже есть — вернуть её
  if (data.paymentId) {
    const existing = bookings.find((b) => b.paymentId === data.paymentId)
    if (existing) return existing
  }

  const slots = getAvailableSlotsForDate(data.date)
  if (!slots.includes(data.time)) {
    throw new Error('Это время уже занято')
  }

  const id = `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const booking: Booking = {
    id,
    ...data,
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

export function formatDateRu(d: string): string {
  const parsed = parseISO(d)
  if (!isValid(parsed)) return d
  return format(parsed, 'd MMMM yyyy', { locale: ru })
}
