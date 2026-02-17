import { NextRequest, NextResponse } from 'next/server'
import { createOrder, getProductById } from '@/lib/merch'

async function sendTelegramNotification(order: {
  productName: string
  size: string
  price: number
  name: string
  phone: string
  address: string
  comment: string
  paymentId?: string
}) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  if (!token || !chatId) return

  const paid = order.paymentId ? ' (оплачено)' : ''
  const text = [
    `🛍 Новый заказ одежды${paid}!`,
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
    const body = await request.json()
    const { productId, size, name, phone, address, comment, paymentId } = body

    if (!productId || !size || !name || !phone || !address) {
      return NextResponse.json(
        { error: 'Заполните обязательные поля: товар, размер, имя, телефон, адрес' },
        { status: 400 }
      )
    }

    const product = getProductById(productId)
    if (!product) {
      return NextResponse.json({ error: 'Товар не найден' }, { status: 404 })
    }

    const order = createOrder({
      productId,
      size: String(size),
      name: String(name).trim(),
      phone: String(phone).trim(),
      address: String(address).trim(),
      comment: String(comment || '').trim(),
      paymentId: paymentId || undefined,
    })

    await sendTelegramNotification(order)

    return NextResponse.json({ success: true, id: order.id })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка оформления заказа'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
