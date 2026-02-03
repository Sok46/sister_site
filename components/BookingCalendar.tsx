'use client'

import { useState, useEffect } from 'react'
import { format, addDays, addMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isBefore } from 'date-fns'
import { ru } from 'date-fns/locale/ru'

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

export default function BookingCalendar() {
  const today = new Date()
  const [month, setMonth] = useState(today)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [slots, setSlots] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({ name: '', phone: '', comment: '', time: '' })

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedDate || !form.time || !form.name.trim() || !form.phone.trim()) return
    setSubmitting(true)
    setError(null)
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

  const calendarDays = getCalendarDays(month)
  const canSelect = (d: Date) => !isBefore(d, new Date(today.getFullYear(), today.getMonth(), today.getDate()))

  return (
    <section className="section-padding bg-gradient-to-br from-primary-50 to-accent-50">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-4xl font-serif font-bold text-center text-gray-900 mb-4">
          📅 Запись на занятие
        </h2>
        <p className="text-center text-gray-600 mb-10">
          Выберите дату и удобное время, оставьте контакты — и мы подтвердим вашу запись
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="card p-6">
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
                      ${disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-primary-100'}
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

          <div className="card p-6">
            {selectedDate ? (
              <>
                <p className="text-gray-600 mb-4">
                  Свободные окна на {format(new Date(selectedDate), 'd MMMM', { locale: ru })}:
                </p>
                {loading ? (
                  <p className="text-gray-500">Загрузка...</p>
                ) : slots.length === 0 ? (
                  <p className="text-amber-600">
                    Нет свободных окон на эту дату. Выберите другую дату или обратитесь к инструктору.
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
                          {t}
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
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
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
                            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
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
                            onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
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
                            ✓ Запись отправлена! Мы свяжемся с вами для подтверждения.
                          </p>
                        )}
                        <button
                          type="submit"
                          disabled={submitting}
                          className="btn-primary w-full disabled:opacity-50"
                        >
                          {submitting ? 'Отправка...' : 'Записаться'}
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
