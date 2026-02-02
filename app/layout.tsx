import type { Metadata } from 'next'
import { Nunito, Playfair_Display } from 'next/font/google'
import './globals.css'
import Navigation from '@/components/Navigation'
import Footer from '@/components/Footer'

const nunito = Nunito({ 
  subsets: ['latin', 'cyrillic'],
  variable: '--font-sans',
})

const playfair = Playfair_Display({ 
  subsets: ['latin', 'cyrillic'],
  variable: '--font-playfair',
})

export const metadata: Metadata = {
  title: 'Zoya LifePro - Йога, Питание, Семья',
  description: 'Блог о йоге, правильном питании и воспитании детей',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru" className={`${nunito.variable} ${playfair.variable}`}>
      <body className="bg-gradient-to-br from-primary-50 via-white to-accent-50 min-h-screen">
        <Navigation />
        <main className="min-h-screen">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  )
}
