const YOOKASSA_API_URL = 'https://api.yookassa.ru/v3'

function getAuthHeader(): string {
  const shopId = process.env.YOOKASSA_SHOP_ID
  const secretKey = process.env.YOOKASSA_SECRET_KEY
  if (!shopId || !secretKey) {
    throw new Error('ЮKassa не настроена. Укажите YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY.')
  }
  return 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64')
}

/** Проверяем, настроены ли учётные данные ЮKassы */
export function isYookassaConfigured(): boolean {
  return !!(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY)
}

/** Создать платёж с встроенным виджетом подтверждения */
export async function createPayment(params: {
  amount: number
  description: string
  metadata: Record<string, string>
}): Promise<{ id: string; confirmation_token: string }> {
  const idempotencyKey = `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const response = await fetch(`${YOOKASSA_API_URL}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': getAuthHeader(),
      'Idempotence-Key': idempotencyKey,
    },
    body: JSON.stringify({
      amount: {
        value: params.amount.toFixed(2),
        currency: 'RUB',
      },
      confirmation: {
        type: 'embedded',
      },
      capture: true,
      description: params.description,
      metadata: params.metadata,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('YooKassa create payment error:', errorText)
    throw new Error('Ошибка создания платежа')
  }

  const data = await response.json()
  return {
    id: data.id,
    confirmation_token: data.confirmation.confirmation_token,
  }
}

/** Получить информацию о платеже */
export async function getPayment(paymentId: string): Promise<{
  id: string
  status: string
  paid: boolean
  amount: { value: string; currency: string }
  metadata: Record<string, string>
}> {
  const response = await fetch(`${YOOKASSA_API_URL}/payments/${paymentId}`, {
    headers: {
      'Authorization': getAuthHeader(),
    },
  })

  if (!response.ok) {
    throw new Error('Ошибка получения информации о платеже')
  }

  return response.json()
}
