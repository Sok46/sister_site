import { NextRequest, NextResponse } from 'next/server'
import { getPayment } from '@/lib/yookassa'
import { createBooking, formatDateRu } from '@/lib/booking'
import { createOrder } from '@/lib/merch'

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  if (!token || !chatId) return

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

async function handleBookingPayment(paymentId: string, metadata: Record<string, string>) {
  const { date, time, name, phone, comment } = metadata
  if (!date || !time || !name || !phone) return

  const booking = createBooking({
    date,
    time,
    name,
    phone,
    comment: comment || '',
    paymentId,
  })

  await sendTelegram(
    `💰 Новая оплаченная запись!\n\n📅 ${formatDateRu(booking.date)}\n🕐 ${booking.time}\n👤 ${booking.name}\n📱 ${booking.phone}\n💬 ${booking.comment || '—'}`
  )
}

async function handleMerchPayment(paymentId: string, metadata: Record<string, string>) {
  const { productId, size, name, phone, address, comment } = metadata
  if (!productId || !size || !name || !phone || !address) return

  const order = createOrder({
    productId,
    size,
    name,
    phone,
    address,
    comment: comment || '',
    paymentId,
  })

  await sendTelegram(
    `🛍 Новый заказ мерча (оплачено)!\n\n👕 ${order.productName}\n📏 Размер: ${order.size}\n💰 ${order.price} ₽\n👤 ${order.name}\n📱 ${order.phone}\n📦 Адрес: ${order.address}\n💬 ${order.comment || '—'}`
  )
}

/**
 * Webhook от ЮKassы.
 * Настройте URL: https://ваш-сайт.ru/api/payment/webhook
 * в личном кабинете ЮKассы → Настройки → HTTP-уведомления.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (body.event === 'payment.succeeded') {
      const paymentId = body.object?.id
      if (!paymentId) {
        return NextResponse.json({ success: true })
      }

      // Верифицируем платёж через API
      const payment = await getPayment(paymentId)
      if (payment.status !== 'succeeded' || !payment.paid) {
        return NextResponse.json({ success: true })
      }

      try {
        if (payment.metadata.type === 'merch') {
          await handleMerchPayment(paymentId, payment.metadata)
        } else {
          await handleBookingPayment(paymentId, payment.metadata)
        }
      } catch {
        // Запись/заказ могли быть уже созданы — это нормально
      }
    }

    // Всегда возвращаем 200 для webhook'ов ЮKassы
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ success: true })
  }
}
