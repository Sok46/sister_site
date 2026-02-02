# 📱 Интеграция Telegram постов и видео

## Как это работает

Telegram предоставляет официальный виджет для встраивания постов на сайты. Вы можете встраивать:
- ✅ Посты из каналов
- ✅ Видео из Telegram
- ✅ Фотографии из постов
- ✅ Текстовые посты

## Использование компонента

### Вариант 1: В React компонентах

Импортируйте компонент и используйте его:

```tsx
import TelegramEmbed from '@/components/TelegramEmbed'

export default function MyPage() {
  return (
    <div>
      <TelegramEmbed url="https://t.me/Zoya_Sergienko/780" />
    </div>
  )
}
```

### Вариант 2: В постах блога (Markdown)

Добавьте ссылку на Telegram пост в frontmatter:

```markdown
---
title: "Мой пост с Telegram"
date: "2026-01-25"
category: "Йога"
excerpt: "Пост с видео из Telegram"
telegram: "https://t.me/Zoya_Sergienko/780"
---
```

Затем в компоненте поста используйте:

```tsx
{post.telegram && (
  <div className="mb-8">
    <TelegramEmbed url={post.telegram} />
  </div>
)}
```

### Вариант 3: Прямо в тексте поста

Вы можете добавить компонент в любой странице, например в `app/yoga/page.tsx`:

```tsx
import TelegramEmbed from '@/components/TelegramEmbed'

export default function YogaPage() {
  return (
    <div className="section-padding">
      <h1>Йога</h1>
      
      <TelegramEmbed 
        url="https://t.me/Zoya_Sergienko/780"
        className="my-8"
      />
    </div>
  )
}
```

## Формат ссылок

Telegram ссылки должны быть в формате:
- ✅ `https://t.me/channel/123`
- ✅ `t.me/channel/123`
- ❌ `@channel` (не поддерживается)

Где:
- `channel` - имя канала (без @)
- `123` - номер поста

## Примеры использования

### Пример 1: Встраивание поста на странице

```tsx
// app/yoga/page.tsx
import TelegramEmbed from '@/components/TelegramEmbed'

export default function YogaPage() {
  return (
    <div className="section-padding">
      <h1 className="text-5xl font-serif font-bold mb-8">
        🧘 Йога
      </h1>
      
      <section className="card p-8 mb-8">
        <h2 className="text-2xl font-serif font-bold mb-4">
          Видео урок
        </h2>
        <TelegramEmbed url="https://t.me/Zoya_Sergienko/780" />
      </section>
    </div>
  )
}
```

### Пример 2: Несколько постов

```tsx
<div className="space-y-8">
  <TelegramEmbed url="https://t.me/Zoya_Sergienko/780" />
  <TelegramEmbed url="https://t.me/Zoya_Sergienko/781" />
  <TelegramEmbed url="https://t.me/Zoya_Sergienko/782" />
</div>
```

### Пример 3: С кастомной шириной

```tsx
<TelegramEmbed 
  url="https://t.me/Zoya_Sergienko/780"
  width="600px"
  className="mx-auto"
/>
```

## Обновление системы постов для поддержки Telegram

Чтобы добавить поддержку Telegram в посты блога, обновите:

### 1. Тип поста (`lib/posts.ts`)

Добавьте поле `telegram`:

```typescript
export interface Post {
  id: string
  title: string
  date: string
  category: string
  excerpt: string
  content: string
  image?: string
  video?: string
  telegram?: string  // ← Добавьте это
  emoji?: string
}
```

### 2. Страница поста (`app/blog/[id]/page.tsx`)

Добавьте отображение Telegram поста:

```tsx
import TelegramEmbed from '@/components/TelegramEmbed'

// В компоненте PostPage:
{post.telegram && (
  <div className="mb-8">
    <TelegramEmbed url={post.telegram} />
  </div>
)}
```

### 3. Пример поста с Telegram

```markdown
---
title: "Утренняя практика йоги"
date: "2026-01-25"
category: "Йога"
excerpt: "Видео урок утренней практики"
emoji: "🌅"
telegram: "https://t.me/Zoya_Sergienko/780"
---

# Утренняя практика

Это видео урок из моего Telegram канала.
```

## Ограничения

- ⚠️ Telegram виджет работает только для публичных каналов
- ⚠️ Посты должны быть доступны без авторизации
- ⚠️ Некоторые приватные каналы могут не отображаться

## Альтернативный способ: iframe

Если виджет не работает, можно использовать прямой iframe:

```tsx
<iframe
  src="https://t.me/Zoya_Sergienko/780?embed=1"
  className="w-full border-0 rounded-xl"
  style={{ minHeight: '400px' }}
  scrolling="no"
  allowTransparency
  allowFullScreen
/>
```

## Отладка

Если пост не отображается:

1. Проверьте формат ссылки: `https://t.me/channel/123`
2. Убедитесь, что канал публичный
3. Откройте консоль браузера (F12) для просмотра ошибок
4. Проверьте, что пост существует и доступен

## Дополнительные возможности

### Автоматическое извлечение постов

Можно создать утилиту для автоматического получения постов из Telegram канала через Telegram Bot API (требует токен бота).

### Кэширование

Для улучшения производительности можно кэшировать встроенные посты.

---

**Готово!** Теперь вы можете легко встраивать посты и видео из Telegram на свой сайт! 🎉
