export default function FamilyPage() {
  return (
    <div className="section-padding">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-5xl font-serif font-bold text-center text-gray-900 mb-4">
          👨‍👩‍👧‍👧 Семья
        </h1>
        <p className="text-xl text-center text-gray-600 mb-12">
          О воспитании, любви и гармонии
        </p>

        <div className="space-y-12">
          <section className="card p-8">
            <h2 className="text-3xl font-serif font-bold text-gray-900 mb-4">
              О нашей семье
            </h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              Я мама двух замечательных дочек, и воспитание детей — это одна из самых важных 
              и вдохновляющих частей моей жизни. В этом разделе я делюсь своим опытом, 
              размышлениями и советами о том, как создать гармоничную семейную атмосферу.
            </p>
            <p className="text-gray-700 leading-relaxed">
              Здесь вы найдёте истории из нашей жизни, идеи для совместных занятий, 
              советы по воспитанию и многое другое.
            </p>
          </section>

          <section className="card p-8">
            <h2 className="text-3xl font-serif font-bold text-gray-900 mb-6">
              Темы для обсуждения
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gradient-to-br from-primary-50 to-primary-100 p-6 rounded-xl">
                <h3 className="text-xl font-serif font-bold text-gray-900 mb-3">
                  🌈 Развитие детей
                </h3>
                <p className="text-gray-700">
                  Как поддержать естественное развитие и любознательность ребёнка
                </p>
              </div>
              
              <div className="bg-gradient-to-br from-accent-50 to-accent-100 p-6 rounded-xl">
                <h3 className="text-xl font-serif font-bold text-gray-900 mb-3">
                  💝 Семейные традиции
                </h3>
                <p className="text-gray-700">
                  Идеи для создания особенных моментов и традиций в семье
                </p>
              </div>
              
              <div className="bg-gradient-to-br from-primary-50 to-primary-100 p-6 rounded-xl">
                <h3 className="text-xl font-serif font-bold text-gray-900 mb-3">
                  🎨 Совместные занятия
                </h3>
                <p className="text-gray-700">
                  Творческие идеи для времяпрепровождения с детьми
                </p>
              </div>
              
              <div className="bg-gradient-to-br from-accent-50 to-accent-100 p-6 rounded-xl">
                <h3 className="text-xl font-serif font-bold text-gray-900 mb-3">
                  🧘 Йога с детьми
                </h3>
                <p className="text-gray-700">
                  Как привить любовь к йоге и здоровому образу жизни с детства
                </p>
              </div>
            </div>
          </section>

          <section className="card p-8">
            <h2 className="text-3xl font-serif font-bold text-gray-900 mb-6">
              Принципы воспитания
            </h2>
            <div className="space-y-4">
              <div className="flex items-start space-x-4">
                <div className="text-2xl">💕</div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Любовь и принятие</h3>
                  <p className="text-gray-700">Безусловная любовь как основа доверия и безопасности</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-4">
                <div className="text-2xl">🎯</div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Осознанность</h3>
                  <p className="text-gray-700">Внимательное отношение к потребностям и чувствам детей</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-4">
                <div className="text-2xl">🌱</div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Естественность</h3>
                  <p className="text-gray-700">Поддержка естественного развития без навязывания</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-4">
                <div className="text-2xl">🤝</div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Партнёрство</h3>
                  <p className="text-gray-700">Взаимное уважение и сотрудничество в семье</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
