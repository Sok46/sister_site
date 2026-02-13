import { notFound } from 'next/navigation'
import { getAllPosts, getPostById, markdownToHtml } from '@/lib/posts'
import { isExternalImageUnoptimized } from '@/lib/images'
import Image from 'next/image'
import BlogEmbeds from '@/components/BlogEmbeds'
import Link from 'next/link'

export async function generateStaticParams() {
  const posts = getAllPosts()
  return posts.map((post) => ({
    id: post.id,
  }))
}

export default async function PostPage({ params }: { params: { id: string } }) {
  const post = getPostById(params.id)

  if (!post) {
    notFound()
  }

  const content = await markdownToHtml(post.content)

  return (
    <article className="section-padding">
      <div className="max-w-4xl mx-auto">
        <Link 
          href="/blog"
          className="inline-flex items-center text-primary-600 hover:text-primary-700 mb-6"
        >
          ← Назад к блогу
        </Link>

        <header className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-4xl">{post.emoji || '📝'}</span>
            <span className="bg-primary-100 text-primary-700 px-4 py-1 rounded-full text-sm font-medium">
              {post.category}
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-gray-900 mb-4">
            {post.title}
          </h1>
          <p className="text-xl text-gray-600 mb-4">{post.excerpt}</p>
          <time className="text-gray-500">
            {new Date(post.date).toLocaleDateString('ru-RU', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </time>
        </header>

        {post.image && (() => {
          const isYandex = isExternalImageUnoptimized(post.image!)
          return (
            <div className="mb-8 rounded-2xl overflow-hidden">
              <Image
                src={post.image!}
                alt={post.title}
                width={1200}
                height={600}
                className="w-full h-auto"
                unoptimized={isYandex}
                referrerPolicy={isYandex ? 'no-referrer' : undefined}
              />
            </div>
          )
        })()}

        <BlogEmbeds postId={post.id} video={post.video} telegram={post.telegram} />

        <div
          className="prose prose-lg max-w-none
            prose-headings:font-serif prose-headings:text-gray-900
            prose-p:text-gray-700 prose-p:leading-relaxed
            prose-a:text-primary-600 prose-a:no-underline hover:prose-a:underline
            prose-img:rounded-xl prose-img:shadow-lg
            prose-strong:text-gray-900
            prose-ul:text-gray-700 prose-ol:text-gray-700
            prose-blockquote:border-primary-500 prose-blockquote:bg-primary-50 prose-blockquote:py-2 prose-blockquote:px-4 prose-blockquote:rounded-lg"
          dangerouslySetInnerHTML={{ __html: content }}
        />
      </div>
    </article>
  )
}
