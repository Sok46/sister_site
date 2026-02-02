export default function NutritionPage() {
  return (
    <div className="section-padding">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-5xl font-serif font-bold text-center text-gray-900 mb-4">
          🥗 Правильное Питание
        </h1>
        <p className="text-xl text-center text-gray-600 mb-12">
          Здоровье начинается с тарелки
        </p>

        <div className="space-y-12">
          <section className="card p-8">
            <h2 className="text-3xl font-serif font-bold text-gray-900 mb-4">
              О здоровом питании
            </h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              Правильное питание — это основа здорового образа жизни. Я верю, что еда должна 
              быть не только полезной, но и вкусной, приносящей радость всей семье.
            </p>
            <p className="text-gray-700 leading-relaxed">
              В этом разделе вы найдёте рецепты полезных блюд, советы по планированию меню, 
              информацию о питательных веществах и идеи для здоровых перекусов.
            </p>
          </section>

          <section className="card p-8">
            <h2 className="text-3xl font-serif font-bold text-gray-900 mb-6">
              Категории рецептов
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gradient-to-br from-primary-50 to-primary-100 p-6 rounded-xl">
                <h3 className="text-xl font-serif font-bold text-gray-900 mb-3">
                  🍳 Завтраки
                </h3>
                <p className="text-gray-700">
                  Энергичные и полезные рецепты для начала дня
                </p>
              </div>
              
              <div className="bg-gradient-to-br from-accent-50 to-accent-100 p-6 rounded-xl">
                <h3 className="text-xl font-serif font-bold text-gray-900 mb-3">
                  🥙 Обеды
                </h3>
                <p className="text-gray-700">
                  Сбалансированные блюда для полноценного обеда
                </p>
              </div>
              
              <div className="bg-gradient-to-br from-primary-50 to-primary-100 p-6 rounded-xl">
                <h3 className="text-xl font-serif font-bold text-gray-900 mb-3">
                  🍲 Ужины
                </h3>
                <p className="text-gray-700">
                  Лёгкие и питательные варианты для вечера
                </p>
              </div>
              
              <div className="bg-gradient-to-br from-accent-50 to-accent-100 p-6 rounded-xl">
                <h3 className="text-xl font-serif font-bold text-gray-900 mb-3">
                  🍪 Перекусы
                </h3>
                <p className="text-gray-700">
                  Полезные снеки для детей и взрослых
                </p>
              </div>
            </div>
          </section>

          <section className="card p-8">
            <h2 className="text-3xl font-serif font-bold text-gray-900 mb-6">
              Принципы питания
            </h2>
            <div className="space-y-4">
              <div className="flex items-start space-x-4">
                <div className="text-2xl">✓</div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Сбалансированность</h3>
                  <p className="text-gray-700">Правильное соотношение белков, жиров и углеводов</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-4">
                <div className="text-2xl">✓</div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Натуральность</h3>
                  <p className="text-gray-700">Предпочтение свежим, необработанным продуктам</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-4">
                <div className="text-2xl">✓</div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Регулярность</h3>
                  <p className="text-gray-700">Правильный режим приёмов пищи</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-4">
                <div className="text-2xl">✓</div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Умеренность</h3>
                  <p className="text-gray-700">Правильные порции и осознанное питание</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
