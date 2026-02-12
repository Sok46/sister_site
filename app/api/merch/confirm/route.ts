import { NextRequest, NextResponse } from 'next/server'
import { getPayment } from '@/lib/yookassa'
import { createOrder } from '@/lib/merch'

async function sendTelegramNotification(order: {
  productName: string
  size: string
  price: number
  name: string
  phone: string
  address: string
  comment: string
}) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  if (!token || !chatId) return

  const text = [
    '🛍 Новый заказ мерча (оплачено)!',
    '',
    `👕 ${order.productName}`,
    `📏 Размер: ${order.size}`,
    `💰 ${order.price} ₽`,
    `👤 ${order.name}`,
    `📱 ${order.phone}`,
    `📦 Адрес: ${order.address}`,
    `💬 ${order.comment || '—'}`,
  ].join('\n')

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

    const { productId, size, name, phone, address, comment } = payment.metadata

    if (!productId || !size || !name || !phone || !address) {
      return NextResponse.json(
        { error: 'Некорректные данные платежа' },
        { status: 400 }
      )
    }

    const order = createOrder({
      productId,
      size,
      name,
      phone,
      address,
      comment: comment || '',
      paymentId: payment_id,
    })

    await sendTelegramNotification(order)

    return NextResponse.json({ success: true, id: order.id })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка подтверждения заказа'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
