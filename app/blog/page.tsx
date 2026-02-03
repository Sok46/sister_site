import Link from 'next/link'
import Image from 'next/image'
import { getAllPosts, type Post } from '@/lib/posts'
import { isExternalImageUnoptimized } from '@/lib/images'

type PostCard = Pick<Post, 'id' | 'title' | 'excerpt' | 'category' | 'date' | 'image' | 'emoji'> & { previewImage?: string }

export default function BlogPage() {
  const posts = getAllPosts()

  // Если нет постов, показываем примеры
  const displayPosts: PostCard[] = posts.length > 0 ? posts : [
    {
      id: 'example-1',
      title: 'Утренняя практика йоги',
      excerpt: 'Как начать день с правильной практики и зарядиться энергией на весь день',
      category: 'Йога',
      date: '2026-01-20',
      image: '/photos/photo_2026-01-15_14-48-15.jpg',
      emoji: '🌅',
    },
    {
      id: 'example-2',
      title: 'Здоровые завтраки для всей семьи',
      excerpt: 'Простые и вкусные рецепты для начала дня с пользой',
      category: 'Питание',
      date: '2026-01-18',
      image: '/photos/photo_2026-01-16_12-50-28.jpg',
      emoji: '🥑',
    },
    {
      id: 'example-3',
      title: 'Воспитание с любовью',
      excerpt: 'Принципы осознанного родительства и гармоничного развития детей',
      category: 'Семья',
      date: '2026-01-15',
      image: '/photos/photo_2025-12-23_15-02-25.jpg',
      emoji: '💕',
    },
  ]

  return (
    <div className="section-padding">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-5xl font-serif font-bold text-center text-gray-900 mb-4">
          📝 Блог
        </h1>
        <p className="text-xl text-center text-gray-600 mb-12">
          Истории, советы и вдохновение
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {displayPosts.map((post) => (
            <Link 
              key={post.id} 
              href={`/blog/${post.id}`}
              className="card group hover:scale-105 transition-transform duration-300"
            >
              <div className="relative h-64 overflow-hidden">
                {(post.previewImage || post.image) && (
                  <Image
                    src={post.previewImage || post.image!}
                    alt={post.title}
                    fill
                    className="object-cover group-hover:scale-110 transition-transform duration-500"
                    unoptimized={isExternalImageUnoptimized(post.previewImage || post.image!)}
                  />
                )}
                {!post.previewImage && !post.image && (
                  <div className="w-full h-full bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center">
                    <span className="text-6xl">{post.emoji || '📝'}</span>
                  </div>
                )}
                <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full text-sm font-medium text-primary-600">
                  {post.category}
                </div>
              </div>
              <div className="p-6">
                {!post.previewImage && !post.image && (
                  <div className="text-4xl mb-3">{post.emoji || '📝'}</div>
                )}
                <h2 className="text-2xl font-serif font-bold text-gray-900 mb-3 group-hover:text-primary-600 transition-colors">
                  {post.title}
                </h2>
                <p className="text-gray-600 mb-4 line-clamp-2">
                  {post.excerpt}
                </p>
                <div className="flex items-center justify-between text-sm text-gray-500">
                  <span>{new Date(post.date).toLocaleDateString('ru-RU', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}</span>
                  <span className="text-primary-600 group-hover:translate-x-1 transition-transform inline-block">
                    Читать →
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {posts.length === 0 && (
          <div className="mt-12 text-center">
            <p className="text-gray-600 mb-4">
              Создайте markdown файлы в папке <code className="bg-gray-100 px-2 py-1 rounded">content/posts/</code> для добавления записей
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
