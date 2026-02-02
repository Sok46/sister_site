import Image from 'next/image'

export default function YogaPage() {
  return (
    <div className="section-padding">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-5xl font-serif font-bold text-center text-gray-900 mb-4">
          🧘 Йога
        </h1>
        <p className="text-xl text-center text-gray-600 mb-12">
          Путь к гармонии тела и души
        </p>

        <div className="space-y-12">
          <section className="card p-8">
            <h2 className="text-3xl font-serif font-bold text-gray-900 mb-4">
              О моей практике
            </h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              Йога для меня — это не просто физические упражнения, а целостный подход к жизни. 
              Я практикую йогу уже много лет и с радостью делюсь своим опытом с другими.
            </p>
            <p className="text-gray-700 leading-relaxed">
              В этом разделе вы найдёте информацию о различных асанах, техниках дыхания, 
              медитациях и советах для начинающих практиков.
            </p>
          </section>

          <section className="card p-8">
            <h2 className="text-3xl font-serif font-bold text-gray-900 mb-6">
              Популярные практики
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gradient-to-br from-primary-50 to-primary-100 p-6 rounded-xl">
                <h3 className="text-xl font-serif font-bold text-gray-900 mb-3">
                  Утренняя практика
                </h3>
                <p className="text-gray-700">
                  Комплекс асан для пробуждения и заряда энергией на весь день
                </p>
              </div>
              
              <div className="bg-gradient-to-br from-accent-50 to-accent-100 p-6 rounded-xl">
                <h3 className="text-xl font-serif font-bold text-gray-900 mb-3">
                  Вечерняя релаксация
                </h3>
                <p className="text-gray-700">
                  Упражнения для снятия напряжения и подготовки ко сну
                </p>
              </div>
              
              <div className="bg-gradient-to-br from-primary-50 to-primary-100 p-6 rounded-xl">
                <h3 className="text-xl font-serif font-bold text-gray-900 mb-3">
                  Силовая йога
                </h3>
                <p className="text-gray-700">
                  Динамичные практики для укрепления тела и развития выносливости
                </p>
              </div>
              
              <div className="bg-gradient-to-br from-accent-50 to-accent-100 p-6 rounded-xl">
                <h3 className="text-xl font-serif font-bold text-gray-900 mb-3">
                  Медитация
                </h3>
                <p className="text-gray-700">
                  Техники для успокоения ума и обретения внутреннего покоя
                </p>
              </div>
            </div>
          </section>

          <section className="card p-8">
            <h2 className="text-3xl font-serif font-bold text-gray-900 mb-6">
              Видео уроки
            </h2>
            <div className="bg-gray-100 rounded-xl p-8 text-center">
              <p className="text-gray-600 mb-4">
                Здесь будут размещены видео уроки по йоге
              </p>
              <p className="text-sm text-gray-500">
                Добавьте видео, вставив код YouTube или другого видеохостинга
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
