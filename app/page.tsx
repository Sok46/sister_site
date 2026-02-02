import Link from 'next/link'
import Image from 'next/image'
import RotatingWords from '@/components/RotatingWords'
import BookingCalendar from '@/components/BookingCalendar'

export default function Home() {
  return (
    <div>
      {/* Hero Section */}
      <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden bg-gradient-to-br from-primary-100/50 to-accent-100/50">
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-5xl md:text-7xl font-serif font-bold text-gray-900 mb-6">
            <RotatingWords />
            <span className="block text-primary-600 mt-10">Здесь живёт ваш баланс</span>
          </h1>
          <p className="text-xl md:text-2xl text-gray-700 mb-8 max-w-3xl mx-auto">
            Привет! Я Зоя. А это — пространство для тех, кто ищет точку опоры в ритме современной жизни.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/blog" className="btn-primary">
              Читать блог
            </Link>
            <Link href="/yoga" className="btn-secondary">
              Узнать о йоге
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="section-padding bg-white">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-4xl font-serif font-bold text-center text-gray-900 mb-12">
            О чём этот сайт
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="card p-8 text-center">
              <div className="text-5xl mb-4">🧘</div>
              <h3 className="text-2xl font-serif font-bold text-gray-900 mb-4">
                Йога
              </h3>
              <p className="text-gray-600 mb-6">
                Практики, асаны, медитации и советы для начинающих и опытных практиков
              </p>
              <Link href="/yoga" className="text-primary-600 hover:text-primary-700 font-medium">
                Узнать больше →
              </Link>
            </div>

            <div className="card p-8 text-center">
              <div className="text-5xl mb-4">🥗</div>
              <h3 className="text-2xl font-serif font-bold text-gray-900 mb-4">
                Питание
              </h3>
              <p className="text-gray-600 mb-6">
                Рецепты здоровой пищи, советы по правильному питанию и полезные привычки
              </p>
              <Link href="/nutrition" className="text-primary-600 hover:text-primary-700 font-medium">
                Узнать больше →
              </Link>
            </div>

            <div className="card p-8 text-center">
              <div className="text-5xl mb-4">👨‍👩‍👧‍👧</div>
              <h3 className="text-2xl font-serif font-bold text-gray-900 mb-4">
                Семья
              </h3>
              <p className="text-gray-600 mb-6">
                Опыт воспитания детей, семейные традиции и советы для родителей
              </p>
              <Link href="/family" className="text-primary-600 hover:text-primary-700 font-medium">
                Узнать больше →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Booking Calendar */}
      <BookingCalendar />

      {/* Gallery Preview */}
      <section className="section-padding bg-gradient-to-br from-primary-50 to-accent-50">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-4xl font-serif font-bold text-center text-gray-900 mb-12">
            Фотогалерея
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {['photo_2025-12-01_17-27-40.jpg', 'photo_2025-12-23_15-02-25.jpg', 
              'photo_2026-01-15_14-48-15.jpg', 'photo_2026-01-16_12-50-28.jpg'].map((photo, idx) => (
              <div key={idx} className="card aspect-square overflow-hidden">
                <Image
                  src={`/photos/${photo}`}
                  alt={`Фото ${idx + 1}`}
                  width={400}
                  height={400}
                  className="w-full h-full object-cover hover:scale-110 transition-transform duration-500"
                />
              </div>
            ))}
          </div>
          <div className="text-center mt-8">
            <Link href="/gallery" className="btn-primary">
              Смотреть все фото
            </Link>
          </div>
        </div>
      </section>

      {/* Yoga Playlist */}
      <section className="section-padding bg-white">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-4xl font-serif font-bold text-center text-gray-900 mb-4">
            🎵 Плейлист для йоги
          </h2>
          <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
            Аудио и видеозаписи для проведения йога-сессий. Выберите подходящую практику и начните свой путь к гармонии
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <Link href="/playlist?type=video" className="card p-6 text-center group hover:scale-105 transition-transform duration-300">
              <div className="text-5xl mb-4">🎬</div>
              <h3 className="text-2xl font-serif font-bold text-gray-900 mb-3 group-hover:text-primary-600 transition-colors">
                Видео практики
              </h3>
              <p className="text-gray-600 mb-4">
                Визуальные руководства по асанам и последовательностям
              </p>
              <span className="text-primary-600 font-medium text-sm group-hover:translate-x-1 transition-transform inline-block">
                Смотреть видео →
              </span>
            </Link>
            <Link href="/playlist?type=audio" className="card p-6 text-center group hover:scale-105 transition-transform duration-300">
              <div className="text-5xl mb-4">🎧</div>
              <h3 className="text-2xl font-serif font-bold text-gray-900 mb-3 group-hover:text-primary-600 transition-colors">
                Аудио медитации
              </h3>
              <p className="text-gray-600 mb-4">
                Звуковые практики для релаксации и концентрации
              </p>
              <span className="text-primary-600 font-medium text-sm group-hover:translate-x-1 transition-transform inline-block">
                Слушать аудио →
              </span>
            </Link>
          </div>
          <div className="text-center">
            <Link href="/playlist" className="btn-primary">
              Открыть плейлист
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
