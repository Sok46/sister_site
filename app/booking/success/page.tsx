'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

function BookingSuccessContent() {
  const searchParams = useSearchParams()
  const paymentId = searchParams.get('payment_id')
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!paymentId) {
      setStatus('error')
      setErrorMsg('Не найден идентификатор платежа')
      return
    }

    let attempts = 0
    const maxAttempts = 10
    let cancelled = false

    const confirmPayment = () => {
      if (cancelled) return

      fetch('/api/payment/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_id: paymentId }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return
          if (data.success) {
            setStatus('success')
          } else if (data.error && attempts < maxAttempts) {
            attempts++
            setTimeout(confirmPayment, 2000)
          } else {
            setStatus('error')
            setErrorMsg(data.error || 'Не удалось подтвердить платёж')
          }
        })
        .catch(() => {
          if (cancelled) return
          if (attempts < maxAttempts) {
            attempts++
            setTimeout(confirmPayment, 2000)
          } else {
            setStatus('error')
            setErrorMsg('Ошибка подтверждения платежа')
          }
        })
    }

    confirmPayment()

    return () => {
      cancelled = true
    }
  }, [paymentId])

  return (
    <div className="min-h-[60vh] flex items-center justify-center section-padding">
      <div className="max-w-md mx-auto text-center card p-8">
        {status === 'loading' && (
          <>
            <div className="text-5xl mb-4 animate-pulse">⏳</div>
            <h1 className="text-2xl font-serif font-bold text-gray-900 mb-4">
              Подтверждаем оплату...
            </h1>
            <p className="text-gray-600">
              Пожалуйста, подождите. Это займёт несколько секунд.
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="text-5xl mb-4">✅</div>
            <h1 className="text-2xl font-serif font-bold text-green-700 mb-4">
              Запись подтверждена!
            </h1>
            <p className="text-gray-600 mb-6">
              Оплата прошла успешно. Мы свяжемся с вами для подтверждения деталей занятия.
            </p>
            <Link href="/" className="btn-primary inline-block">
              Вернуться на главную
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="text-5xl mb-4">❌</div>
            <h1 className="text-2xl font-serif font-bold text-red-700 mb-4">
              Ошибка подтверждения
            </h1>
            <p className="text-gray-600 mb-2">{errorMsg}</p>
            <p className="text-gray-500 text-sm mb-6">
              Если деньги были списаны, свяжитесь с нами — мы обязательно поможем решить вопрос.
            </p>
            <Link href="/" className="btn-primary inline-block">
              Вернуться на главную
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

export default function BookingSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-center">
            <div className="text-5xl mb-4 animate-pulse">⏳</div>
            <p className="text-gray-600">Загрузка...</p>
          </div>
        </div>
      }
    >
      <BookingSuccessContent />
    </Suspense>
  )
}
