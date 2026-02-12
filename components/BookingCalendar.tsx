'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  format,
  addDays,
  addMonths,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isBefore,
} from 'date-fns'
import { ru } from 'date-fns/locale/ru'

/* ---------- Тип для виджета ЮKассы ---------- */
interface YooCheckoutWidget {
  render: (containerId: string) => Promise<void>
  destroy: () => void
}

declare global {
  interface Window {
    YooMoneyCheckoutWidget: new (config: {
      confirmation_token: string
      return_url: string
      error_callback?: (error: unknown) => void
      customization?: {
        modal?: boolean
        colors?: {
          control_primary?: string
          control_primary_content?: string
        }
      }
    }) => YooCheckoutWidget
  }
}

/* ---------- Утилиты ---------- */

function getCalendarDays(month: Date): { date: Date; isCurrentMonth: boolean }[] {
  const start = startOfMonth(month)
  const end = endOfMonth(month)
  const days = eachDayOfInterval({ start, end })
  const firstDow = start.getDay()
  const padStart = firstDow === 0 ? 6 : firstDow - 1
  const prevMonth = addMonths(month, -1)
  const prevEnd = endOfMonth(prevMonth)

  const result: { date: Date; isCurrentMonth: boolean }[] = []
  for (let i = 0; i < padStart; i++) {
    result.push({
      date: addDays(prevEnd, -padStart + i + 1),
      isCurrentMonth: false,
    })
  }
  days.forEach((d) => result.push({ date: d, isCurrentMonth: true }))
  const remainder = 42 - result.length
  const nextMonth = addMonths(month, 1)
  for (let i = 0; i < remainder; i++) {
    result.push({
      date: addDays(nextMonth, i),
      isCurrentMonth: false,
    })
  }
  return result
}

function formatSlotLabel(t: string): string {
  const [hStr, mStr] = t.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (Number.isNaN(h) || Number.isNaN(m)) return t
  const start = new Date(2000, 0, 1, h, m)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(start.getHours())}:${pad(start.getMinutes())}–${pad(
    end.getHours()
  )}:${pad(end.getMinutes())}`
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Не удалось загрузить скрипт оплаты'))
    document.head.appendChild(script)
  })
}

/* ---------- Компонент ---------- */

export default function BookingCalendar() {
  const today = new Date()
  const [month, setMonth] = useState(today)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [slots, setSlots] = useState<string[]>([])
  const [datesWithSlots, setDatesWithSlots] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({ name: '', phone: '', comment: '', time: '' })

  // Оплата
  const [paymentEnabled, setPaymentEnabled] = useState(false)
  const [lessonPrice, setLessonPrice] = useState(0)
  const [paymentStep, setPaymentStep] = useState<'form' | 'widget'>('form')
  const [confirmationData, setConfirmationData] = useState<{
    token: string
    paymentId: string
  } | null>(null)
  const widgetRef = useRef<YooCheckoutWidget | null>(null)

  const handlePhoneChange = (value: string) => {
    const cleaned = value.replace(/[^0-9+\-()]/g, '')
    setForm((f) => ({ ...f, phone: cleaned }))
  }

  // Проверяем, включена ли оплата
  useEffect(() => {
    fetch('/api/payment/config')
      .then((r) => r.json())
      .then((data) => {
        setPaymentEnabled(data.enabled)
        setLessonPrice(data.price)
      })
      .catch(() => {})
  }, [])

  // Загружаем даты со слотами
  useEffect(() => {
    fetch('/api/booking/slots')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.dates)) {
          setDatesWithSlots(new Set<string>(data.dates))
        }
      })
      .catch(() => {
        setDatesWithSlots(new Set())
      })
  }, [])

  // Загружаем слоты выбранной даты
  useEffect(() => {
    if (!selectedDate) {
      setSlots([])
      return
    }
    setLoading(true)
    setError(null)
    fetch(`/api/booking/slots?date=${selectedDate}`)
      .then((r) => r.json())
      .then((data) => {
        setSlots(data.slots || [])
        setForm((f) => ({ ...f, time: '' }))
      })
      .catch(() => setSlots([]))
      .finally(() => setLoading(false))
  }, [selectedDate])

  // Инициализируем виджет оплаты когда получен токен
  useEffect(() => {
    if (!confirmationData || paymentStep !== 'widget') return

    let destroyed = false

    const initWidget = async () => {
      try {
        await loadScript('https://yookassa.ru/checkout-widget/v1/checkout-widget.js')

        if (destroyed) return

        const checkout = new window.YooMoneyCheckoutWidget({
          confirmation_token: confirmationData.token,
          return_url: `${window.location.origin}/booking/success?payment_id=${confirmationData.paymentId}`,
          error_callback: () => {
            setError('Ошибка оплаты. Попробуйте ещё раз.')
            setPaymentStep('form')
            setConfirmationData(null)
          },
          customization: {
            colors: {
              control_primary: '#7c3aed', // primary-600
              control_primary_content: '#ffffff',
            },
          },
        })

        widgetRef.current = checkout
        await checkout.render('yookassa-payment-widget')
      } catch {
        if (!destroyed) {
          setError('Не удалось загрузить виджет оплаты')
          setPaymentStep('form')
          setConfirmationData(null)
        }
      }
    }

    initWidget()

    return () => {
      destroyed = true
      if (widgetRef.current) {
        widgetRef.current.destroy()
        widgetRef.current = null
      }
    }
  }, [confirmationData, paymentStep])

  const cancelPayment = useCallback(() => {
    if (widgetRef.current) {
      widgetRef.current.destroy()
      widgetRef.current = null
    }
    setPaymentStep('form')
    setConfirmationData(null)
    setError(null)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedDate || !form.time || !form.name.trim() || !form.phone.trim()) return
    setSubmitting(true)
    setError(null)

    if (paymentEnabled) {
      // Поток с оплатой
      try {
        const res = await fetch('/api/payment/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: selectedDate,
            time: form.time,
            name: form.name.trim(),
            phone: form.phone.trim(),
            comment: form.comment.trim(),
          }),
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)

        // Показываем виджет оплаты
        setPaymentStep('widget')
        setConfirmationData({
          token: data.confirmation_token,
          paymentId: data.payment_id,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ошибка создания платежа')
      } finally {
        setSubmitting(false)
      }
    } else {
      // Прямая запись без оплаты
      fetch('/api/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          time: form.time,
          name: form.name.trim(),
          phone: form.phone.trim(),
          comment: form.comment.trim(),
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.error) throw new Error(data.error)
          setSuccess(true)
          setSlots((s) => s.filter((t) => t !== form.time))
          setForm({ name: '', phone: '', comment: '', time: '' })
        })
        .catch((err) => setError(err.message || 'Ошибка записи'))
        .finally(() => setSubmitting(false))
    }
  }

  const calendarDays = getCalendarDays(month)
  const canSelect = (d: Date) =>
    !isBefore(d, new Date(today.getFullYear(), today.getMonth(), today.getDate()))

  return (
    <section className="section-padding bg-gradient-to-br from-primary-50 to-accent-50">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-4xl font-serif font-bold text-center text-gray-900 mb-4">
          📅 Запись на занятие
        </h2>
        <p className="text-center text-gray-600 mb-10">
          Выберите дату и удобное время, оставьте контакты —{' '}
          {paymentEnabled
            ? 'и оплатите занятие онлайн'
            : 'и мы подтвердим вашу запись'}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* ── Левая колонка: календарь ── */}
          <div className={`card p-6 ${paymentStep === 'widget' ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => setMonth(addMonths(month, -1))}
                className="p-2 rounded-lg hover:bg-primary-100 text-gray-700"
                aria-label="Предыдущий месяц"
              >
                ←
              </button>
              <span className="font-semibold text-gray-900 capitalize">
                {format(month, 'LLLL yyyy', { locale: ru })}
              </span>
              <button
                type="button"
                onClick={() => setMonth(addMonths(month, 1))}
                className="p-2 rounded-lg hover:bg-primary-100 text-gray-700"
                aria-label="Следующий месяц"
              >
                →
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-sm mb-2">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
                <div key={d} className="font-medium text-gray-500">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map(({ date, isCurrentMonth }, i) => {
                const dateStr = format(date, 'yyyy-MM-dd')
                const selected = selectedDate === dateStr
                const disabled = !canSelect(date)
                const hasSlots = datesWithSlots.has(dateStr)
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      if (disabled) return
                      setSelectedDate(dateStr)
                    }}
                    disabled={disabled}
                    className={`
                      aspect-square rounded-lg text-sm font-medium transition-colors
                      ${!isCurrentMonth ? 'text-gray-300' : ''}
                      ${
                        disabled
                          ? 'cursor-not-allowed opacity-50'
                          : hasSlots && isCurrentMonth
                          ? 'bg-emerald-50 hover:bg-emerald-100'
                          : 'hover:bg-primary-100'
                      }
                      ${selected ? 'bg-primary-500 text-white hover:bg-primary-600' : ''}
                      ${isCurrentMonth && !disabled && !selected ? 'text-gray-700' : ''}
                    `}
                  >
                    {format(date, 'd')}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Правая колонка: форма / виджет оплаты ── */}
          <div className="card p-6">
            {paymentStep === 'widget' && selectedDate ? (
              /* --- Виджет оплаты ЮKассы --- */
              <>
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    Оплата занятия
                  </h3>
                  <p className="text-gray-600 text-sm">
                    {format(new Date(selectedDate), 'd MMMM', { locale: ru })},{' '}
                    {formatSlotLabel(form.time)} — <b>{lessonPrice} ₽</b>
                  </p>
                </div>

                <div
                  id="yookassa-payment-widget"
                  className="min-h-[300px] rounded-lg"
                />

                {error && (
                  <p className="text-red-600 text-sm mt-3">{error}</p>
                )}

                <button
                  type="button"
                  onClick={cancelPayment}
                  className="mt-4 text-gray-500 hover:text-gray-700 text-sm underline"
                >
                  ← Отменить и вернуться к форме
                </button>
              </>
            ) : selectedDate ? (
              /* --- Обычная форма записи --- */
              <>
                <p className="text-gray-600 mb-4">
                  Свободные окна на{' '}
                  {format(new Date(selectedDate), 'd MMMM', { locale: ru })}:
                </p>
                {loading ? (
                  <p className="text-gray-500">Загрузка...</p>
                ) : slots.length === 0 ? (
                  <p className="text-amber-600">
                    Нет свободных окон на эту дату. Выберите другую дату или
                    обратитесь к инструктору.
                  </p>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {slots.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, time: t }))}
                          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                            form.time === t
                              ? 'bg-primary-500 text-white'
                              : 'bg-gray-100 hover:bg-primary-100 text-gray-700'
                          }`}
                        >
                          {formatSlotLabel(t)}
                        </button>
                      ))}
                    </div>

                    {form.time && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Имя *
                          </label>
                          <input
                            type="text"
                            required
                            value={form.name}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, name: e.target.value }))
                            }
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                            placeholder="Как вас зовут?"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Телефон *
                          </label>
                          <input
                            type="tel"
                            required
                            value={form.phone}
                            onChange={(e) => handlePhoneChange(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                            placeholder="+7 999 123-45-67"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Комментарий
                          </label>
                          <textarea
                            value={form.comment}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, comment: e.target.value }))
                            }
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                            placeholder="Напишите, если нужно"
                            rows={2}
                          />
                        </div>

                        {error && (
                          <p className="text-red-600 text-sm">{error}</p>
                        )}
                        {success && (
                          <p className="text-green-600 font-medium">
                            ✓ Запись отправлена! Мы свяжемся с вами для
                            подтверждения.
                          </p>
                        )}

                        <button
                          type="submit"
                          disabled={submitting}
                          className="btn-primary w-full disabled:opacity-50"
                        >
                          {submitting
                            ? 'Подождите...'
                            : paymentEnabled
                            ? `Записаться и оплатить (${lessonPrice} ₽)`
                            : 'Записаться'}
                        </button>
                      </>
                    )}
                  </form>
                )}
              </>
            ) : (
              <p className="text-gray-500 text-center py-8">
                Выберите дату в календаре
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
