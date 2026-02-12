import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300 mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-xl font-serif font-bold text-white mb-4">
              Zoya LifePro
            </h3>
            <p className="text-sm">
              Блог о йоге, здоровом питании и счастливой семейной жизни
            </p>
          </div>
          
          <div>
            <h4 className="text-lg font-semibold text-white mb-4">Разделы</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/yoga" className="hover:text-primary-400 transition-colors">
                  Йога
                </Link>
              </li>
              <li>
                <Link href="/nutrition" className="hover:text-primary-400 transition-colors">
                  Питание
                </Link>
              </li>
              <li>
                <Link href="/blog" className="hover:text-primary-400 transition-colors">
                  Блог
                </Link>
              </li>
              <li>
                <Link href="/gallery" className="hover:text-primary-400 transition-colors">
                  Галерея
                </Link>
              </li>
              <li>
                <Link href="/merch" className="hover:text-primary-400 transition-colors">
                  Мерч
                </Link>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="text-lg font-semibold text-white mb-4">Контакты</h4>
            <p className="text-sm mb-3">
              Следите за обновлениями в социальных сетях
            </p>
            <a
              href="https://t.me/Zoya_yoga"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-gray-300 hover:text-primary-400 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.028-1.627 4.476-1.635z"/>
              </svg>
              <span>@Zoya_yoga</span>
            </a>
          </div>
        </div>
        
        <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm">
          <p>&copy; {new Date().getFullYear()} Zoya LifePro. Все права защищены.</p>
        </div>
      </div>
    </footer>
  )
}
