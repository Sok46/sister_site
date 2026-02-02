import { NextRequest, NextResponse } from 'next/server'
import { createBooking, formatDateRu } from '@/lib/booking'

async function sendTelegramNotification(booking: {
  date: string
  time: string
  name: string
  phone: string
  comment: string
}) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  if (!token || !chatId) return

  const text = `🆕 Новая запись на йогу!\n\n📅 ${formatDateRu(booking.date)}\n🕐 ${booking.time}\n👤 ${booking.name}\n📱 ${booking.phone}\n💬 ${booking.comment || '—'}`

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
  } catch {
    // ignore
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { date, time, name, phone, comment } = body

    if (!date || !time || !name || !phone) {
      return NextResponse.json(
        { error: 'Заполните обязательные поля: дата, время, имя, телефон' },
        { status: 400 }
      )
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Неверный формат даты' }, { status: 400 })
    }
    if (!/^\d{1,2}:\d{2}$/.test(time)) {
      return NextResponse.json({ error: 'Неверный формат времени' }, { status: 400 })
    }

    const booking = createBooking({
      date,
      time,
      name: String(name).trim(),
      phone: String(phone).trim(),
      comment: String(comment || '').trim(),
    })

    await sendTelegramNotification(booking)

    return NextResponse.json({ success: true, id: booking.id })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка записи'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
