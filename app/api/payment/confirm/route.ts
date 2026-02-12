import { NextRequest, NextResponse } from 'next/server'
import { getPayment } from '@/lib/yookassa'
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

  const text = `💰 Новая оплаченная запись!\n\n📅 ${formatDateRu(booking.date)}\n🕐 ${booking.time}\n👤 ${booking.name}\n📱 ${booking.phone}\n💬 ${booking.comment || '—'}`

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
    const { payment_id } = await request.json()
    if (!payment_id) {
      return NextResponse.json({ error: 'Не указан ID платежа' }, { status: 400 })
    }

    const payment = await getPayment(payment_id)
    if (payment.status !== 'succeeded' || !payment.paid) {
      return NextResponse.json(
        { error: 'Платёж ещё не подтверждён. Подождите немного.' },
        { status: 400 }
      )
    }

    const { date, time, name, phone, comment } = payment.metadata

    if (!date || !time || !name || !phone) {
      return NextResponse.json(
        { error: 'Некорректные данные платежа' },
        { status: 400 }
      )
    }

    const booking = createBooking({
      date,
      time,
      name,
      phone,
      comment: comment || '',
      paymentId: payment_id,
    })

    await sendTelegramNotification(booking)

    return NextResponse.json({ success: true, id: booking.id })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка подтверждения'
    // Если запись уже создана (через webhook) — это не ошибка
    if (msg === 'Запись с этим платежом уже существует') {
      return NextResponse.json({ success: true, already_booked: true })
    }
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
