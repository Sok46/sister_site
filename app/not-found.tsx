import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center section-padding">
      <div className="text-center">
        <h1 className="text-9xl font-serif font-bold text-primary-200 mb-4">404</h1>
        <h2 className="text-4xl font-serif font-bold text-gray-900 mb-4">
          Страница не найдена
        </h2>
        <p className="text-xl text-gray-600 mb-8">
          Извините, запрашиваемая страница не существует
        </p>
        <Link href="/" className="btn-primary">
          Вернуться на главную
        </Link>
      </div>
    </div>
  )
}
