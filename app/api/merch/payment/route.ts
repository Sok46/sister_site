import { NextRequest, NextResponse } from 'next/server'
import { createPayment, isYookassaConfigured } from '@/lib/yookassa'
import { getProductById } from '@/lib/merch'

export async function POST(request: NextRequest) {
  try {
    if (!isYookassaConfigured()) {
      return NextResponse.json(
        { error: 'Оплата временно недоступна' },
        { status: 503 }
      )
    }

    const { productId, size, name, phone, address, comment } = await request.json()

    if (!productId || !size || !name || !phone || !address) {
      return NextResponse.json(
        { error: 'Заполните обязательные поля' },
        { status: 400 }
      )
    }

    const product = getProductById(productId)
    if (!product) {
      return NextResponse.json({ error: 'Товар не найден' }, { status: 404 })
    }
    if (!product.available) {
      return NextResponse.json({ error: 'Товар временно недоступен' }, { status: 400 })
    }

    const description = `${product.name}, размер ${size}`

    const payment = await createPayment({
      amount: product.price,
      description,
      metadata: {
        type: 'merch',
        productId,
        size: String(size),
        name: String(name).trim(),
        phone: String(phone).trim(),
        address: String(address).trim(),
        comment: String(comment || '').trim(),
      },
    })

    return NextResponse.json({
      confirmation_token: payment.confirmation_token,
      payment_id: payment.id,
      amount: product.price,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка создания платежа'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
