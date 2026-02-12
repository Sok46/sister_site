import { NextRequest, NextResponse } from 'next/server'
import { createPayment, isYookassaConfigured } from '@/lib/yookassa'
import { getAvailableSlotsForDate, formatDateRu } from '@/lib/booking'

export async function POST(request: NextRequest) {
  try {
    if (!isYookassaConfigured()) {
      return NextResponse.json(
        { error: 'Оплата временно недоступна' },
        { status: 503 }
      )
    }

    const { date, time, name, phone, comment } = await request.json()

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

    // Проверяем, что слот ещё свободен
    const slots = getAvailableSlotsForDate(date)
    if (!slots.includes(time)) {
      return NextResponse.json(
        { error: 'Это время уже занято. Выберите другое.' },
        { status: 400 }
      )
    }

    const price = Number(process.env.LESSON_PRICE_RUB) || 1500
    const description = `Занятие йогой — ${formatDateRu(date)}, ${time}`

    const payment = await createPayment({
      amount: price,
      description,
      metadata: {
        date,
        time,
        name: String(name).trim(),
        phone: String(phone).trim(),
        comment: String(comment || '').trim(),
      },
    })

    return NextResponse.json({
      confirmation_token: payment.confirmation_token,
      payment_id: payment.id,
      amount: price,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка создания платежа'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
