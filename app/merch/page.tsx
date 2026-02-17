'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

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

/* ---------- Типы ---------- */
interface Product {
  id: string
  name: string
  description: string
  story?: string
  price: number
  sizes: string[]
  color: string
  image: string
  available: boolean
}

function RevealOnScroll({
  index,
  children,
}: {
  index: number
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.2 }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
      }`}
      style={{ transitionDelay: `${Math.min(index * 120, 360)}ms` }}
    >
      {children}
    </div>
  )
}

/* ---------- Утилита ---------- */
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

/* ---------- Цвета-заглушки для карточек товаров ---------- */
const PRODUCT_COLORS: Record<string, { bg: string; accent: string; emoji: string }> = {
  'tshirt-namaste': { bg: 'from-gray-50 to-gray-100', accent: 'text-gray-600', emoji: '🤍' },
  'tshirt-lotus': { bg: 'from-purple-50 to-purple-100', accent: 'text-purple-600', emoji: '💜' },
  'tshirt-om': { bg: 'from-gray-700 to-gray-900', accent: 'text-gray-200', emoji: '🖤' },
  'tshirt-zoya-lifepro': { bg: 'from-orange-50 to-orange-100', accent: 'text-orange-600', emoji: '🧡' },
  'tshirt-balance': { bg: 'from-emerald-50 to-emerald-100', accent: 'text-emerald-600', emoji: '💚' },
  'tshirt-breathe': { bg: 'from-pink-50 to-pink-100', accent: 'text-pink-500', emoji: '🩷' },
}

const DEFAULT_COLORS = { bg: 'from-primary-50 to-primary-100', accent: 'text-primary-600', emoji: '👕' }

/* ---------- Компонент ---------- */
export default function MerchPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [paymentEnabled, setPaymentEnabled] = useState(false)

  // Модалка заказа
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedSize, setSelectedSize] = useState('')
  const [form, setForm] = useState({ name: '', phone: '', address: '', comment: '' })
  const [submitting, setSubmitting] = useState(false)
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Оплата
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

  // Загружаем товары (через серверный API)
  useEffect(() => {
    fetch('/api/merch/products')
      .then((r) => r.json())
      .then((data) => setProducts(data.products || []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false))
  }, [])

  // Проверяем оплату
  useEffect(() => {
    fetch('/api/payment/config')
      .then((r) => r.json())
      .then((data) => setPaymentEnabled(data.enabled))
      .catch(() => {})
  }, [])

  // Виджет оплаты
  useEffect(() => {
    if (!confirmationData || paymentStep !== 'widget') return

    let destroyed = false

    const initWidget = async () => {
      try {
        await loadScript('https://yookassa.ru/checkout-widget/v1/checkout-widget.js')
        if (destroyed) return

        const checkout = new window.YooMoneyCheckoutWidget({
          confirmation_token: confirmationData.token,
          return_url: `${window.location.origin}/merch/success?payment_id=${confirmationData.paymentId}`,
          error_callback: () => {
            setError('Ошибка оплаты. Попробуйте ещё раз.')
            setPaymentStep('form')
            setConfirmationData(null)
          },
          customization: {
            colors: {
              control_primary: '#7c3aed',
              control_primary_content: '#ffffff',
            },
          },
        })

        widgetRef.current = checkout
        await checkout.render('yookassa-merch-widget')
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

  const openOrder = (product: Product) => {
    setSelectedProduct(product)
    setSelectedSize('')
    setForm({ name: '', phone: '', address: '', comment: '' })
    setError(null)
    setOrderSuccess(false)
    setPaymentStep('form')
    setConfirmationData(null)
  }

  const closeOrder = useCallback(() => {
    if (widgetRef.current) {
      widgetRef.current.destroy()
      widgetRef.current = null
    }
    setSelectedProduct(null)
    setPaymentStep('form')
    setConfirmationData(null)
    setError(null)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProduct || !selectedSize || !form.name.trim() || !form.phone.trim() || !form.address.trim()) return
    setSubmitting(true)
    setError(null)

    if (paymentEnabled) {
      // Оплата через ЮKassу
      try {
        const res = await fetch('/api/merch/payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: selectedProduct.id,
            size: selectedSize,
            name: form.name.trim(),
            phone: form.phone.trim(),
            address: form.address.trim(),
            comment: form.comment.trim(),
          }),
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)

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
      // Заказ без оплаты
      try {
        const res = await fetch('/api/merch/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: selectedProduct.id,
            size: selectedSize,
            name: form.name.trim(),
            phone: form.phone.trim(),
            address: form.address.trim(),
            comment: form.comment.trim(),
          }),
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        setOrderSuccess(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ошибка оформления заказа')
      } finally {
        setSubmitting(false)
      }
    }
  }

  return (
    <div className="min-h-screen">
      {/* Шапка */}
      <section className="section-padding bg-gradient-to-br from-primary-50 to-accent-50">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-serif font-bold text-gray-900 mb-4">
            👕 Одежда
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Авторские футболки для тех, кто живёт в гармонии. Натуральные ткани, стильный дизайн, позитивная энергия.
          </p>
        </div>
      </section>

      {/* Каталог */}
      <section className="section-padding bg-white">
        <div className="max-w-7xl mx-auto">
          {loading ? (
            <div className="text-center py-16">
              <p className="text-gray-500 text-lg">Загрузка товаров...</p>
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-6xl mb-4">👕</div>
              <p className="text-gray-500 text-lg">
                Скоро здесь появятся товары. Следите за обновлениями!
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {products.filter((p) => p.available).map((product, index) => {
                const colors = PRODUCT_COLORS[product.id] || DEFAULT_COLORS
                const isDark = product.id === 'tshirt-om'
                const storyText = (product.story || product.description || '').trim()

                return (
                  <div key={product.id} className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
                    <div
                      className="card group cursor-pointer lg:col-span-1"
                      onClick={() => openOrder(product)}
                    >
                      {/* Визуальная заглушка вместо фото */}
                      <div className={`relative h-64 bg-gradient-to-br ${colors.bg} flex items-center justify-center overflow-hidden`}>
                        <div className="text-center">
                          <div className={`text-7xl mb-2 group-hover:scale-110 transition-transform duration-300`}>
                            {colors.emoji}
                          </div>
                          <span className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-500'}`}>
                            {product.color}
                          </span>
                        </div>
                        {/* Бейдж с ценой */}
                        <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm rounded-full px-3 py-1 shadow-sm">
                          <span className="text-sm font-bold text-gray-900">
                            {product.price.toLocaleString('ru-RU')} ₽
                          </span>
                        </div>
                      </div>

                      {/* Описание */}
                      <div className="p-5">
                        <h3 className="text-xl font-serif font-bold text-gray-900 mb-2 group-hover:text-primary-600 transition-colors">
                          {product.name}
                        </h3>
                        <p className="text-gray-600 text-sm mb-3 line-clamp-2">
                          {product.description}
                        </p>
                        <div className="flex items-center justify-between">
                          <div className="flex gap-1">
                            {product.sizes.map((s) => (
                              <span
                                key={s}
                                className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                          <span className="text-primary-600 font-medium text-sm group-hover:translate-x-1 transition-transform inline-block">
                            Купить →
                          </span>
                        </div>
                      </div>
                    </div>

                    <RevealOnScroll index={index}>
                      <div className="lg:col-span-1 h-full flex flex-col justify-between py-2">
                        <div>
                          <h3 className="text-2xl font-serif font-bold text-gray-900 mb-3">
                            {product.name}
                          </h3>
                          <p className="text-gray-700 leading-relaxed">
                            {storyText}
                          </p>
                        </div>
                      </div>
                    </RevealOnScroll>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* Информация о доставке */}
      <section className="section-padding bg-gradient-to-br from-primary-50 to-accent-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-serif font-bold text-center text-gray-900 mb-8">
            Доставка и оплата
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="card p-6 text-center">
              <div className="text-4xl mb-3">📦</div>
              <h3 className="font-semibold text-gray-900 mb-2">Доставка</h3>
              <p className="text-gray-600 text-sm">
                Отправляем по всей России Почтой и СДЭК. Срок 3–7 дней.
              </p>
            </div>
            <div className="card p-6 text-center">
              <div className="text-4xl mb-3">💳</div>
              <h3 className="font-semibold text-gray-900 mb-2">Оплата</h3>
              <p className="text-gray-600 text-sm">
                {paymentEnabled
                  ? 'Безопасная оплата картой через ЮKassa.'
                  : 'Оплата при получении или переводом.'}
              </p>
            </div>
            <div className="card p-6 text-center">
              <div className="text-4xl mb-3">↩️</div>
              <h3 className="font-semibold text-gray-900 mb-2">Возврат</h3>
              <p className="text-gray-600 text-sm">
                14 дней на возврат, если товар не подошёл.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Модалка заказа ── */}
      {selectedProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeOrder()
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            {/* Шапка модалки */}
            <div className="flex items-center justify-between p-6 border-b">
              <div>
                <h3 className="text-xl font-serif font-bold text-gray-900">
                  {selectedProduct.name}
                </h3>
                <p className="text-gray-500 text-sm">{selectedProduct.color}</p>
              </div>
              <button
                onClick={closeOrder}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
                aria-label="Закрыть"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6">
              {paymentStep === 'widget' ? (
                /* --- Виджет оплаты --- */
                <>
                  <p className="text-gray-600 text-sm mb-4">
                    {selectedProduct.name}, размер {selectedSize} —{' '}
                    <b>{selectedProduct.price.toLocaleString('ru-RU')} ₽</b>
                  </p>
                  <div id="yookassa-merch-widget" className="min-h-[300px] rounded-lg" />
                  {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
                  <button
                    type="button"
                    onClick={() => {
                      if (widgetRef.current) {
                        widgetRef.current.destroy()
                        widgetRef.current = null
                      }
                      setPaymentStep('form')
                      setConfirmationData(null)
                      setError(null)
                    }}
                    className="mt-4 text-gray-500 hover:text-gray-700 text-sm underline"
                  >
                    ← Отменить оплату
                  </button>
                </>
              ) : orderSuccess ? (
                /* --- Успех без оплаты --- */
                <div className="text-center py-4">
                  <div className="text-5xl mb-4">✅</div>
                  <h4 className="text-xl font-serif font-bold text-green-700 mb-2">
                    Заказ оформлен!
                  </h4>
                  <p className="text-gray-600 mb-4">
                    Мы свяжемся с вами для уточнения деталей доставки и оплаты.
                  </p>
                  <button onClick={closeOrder} className="btn-primary">
                    Закрыть
                  </button>
                </div>
              ) : (
                /* --- Форма заказа --- */
                <form onSubmit={handleSubmit} className="space-y-4">
                  <p className="text-gray-600 text-sm">{selectedProduct.description}</p>

                  {/* Цена */}
                  <div className="flex items-center gap-2 py-2">
                    <span className="text-2xl font-bold text-gray-900">
                      {selectedProduct.price.toLocaleString('ru-RU')} ₽
                    </span>
                  </div>

                  {/* Размер */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Размер *
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {selectedProduct.sizes.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSelectedSize(s)}
                          className={`px-4 py-2 rounded-lg font-medium transition-colors border ${
                            selectedSize === s
                              ? 'bg-primary-500 text-white border-primary-500'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-primary-300 hover:bg-primary-50'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedSize && (
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
                          onChange={(e) => handlePhoneChange(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          placeholder="+7 999 123-45-67"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Адрес доставки *
                        </label>
                        <input
                          type="text"
                          required
                          value={form.address}
                          onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          placeholder="Город, улица, дом, квартира"
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
                          placeholder="Пожелания к заказу"
                          rows={2}
                        />
                      </div>

                      {error && <p className="text-red-600 text-sm">{error}</p>}

                      <button
                        type="submit"
                        disabled={submitting}
                        className="btn-primary w-full disabled:opacity-50"
                      >
                        {submitting
                          ? 'Подождите...'
                          : paymentEnabled
                          ? `Оплатить ${selectedProduct.price.toLocaleString('ru-RU')} ₽`
                          : 'Оформить заказ'}
                      </button>
                    </>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
