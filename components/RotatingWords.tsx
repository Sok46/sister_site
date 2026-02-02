'use client'

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'

const WORDS = [
  'Йога', 'Семья', 'Горы', 'Лес', 'Река', 'Тишина', 'Солнце', 'Ветер', 'Тропа',
  'Здоровье', 'Забота', 'Восхождение', 'Воздух', 'Дети', 'Мудрость', 'Спокойствие',
  'Сила', 'Единение', 'Природа', 'Дом', 'Птицы', 'Небо', 'Облако', 'Цветы',
  'Травы', 'Счастье', 'Гармония', 'Радость', 'Утро', 'Вечер', 'Отдых',
  'Движение', 'Дыхание'
]

function getRandomWord(exclude: string[] = []): string {
  const available = exclude.length > 0 ? WORDS.filter((w) => !exclude.includes(w)) : WORDS
  return available[Math.floor(Math.random() * available.length)]
}

function getThreeUniqueWords(): string[] {
  const result: string[] = []
  while (result.length < 3) {
    const word = getRandomWord(result)
    result.push(word)
  }
  return result
}

function getRandomIndex(excludeIndex: number | null): number {
  const indices = excludeIndex !== null
    ? [0, 1, 2].filter((i) => i !== excludeIndex)
    : [0, 1, 2]
  return indices[Math.floor(Math.random() * indices.length)]
}

function getRandomDelay(): number {
  return 2000 + Math.random() * 1000
}

const FLIP_DURATION = '0.8s'
const FLIP_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'

const WORD_COLORS: Record<string, string> = {
  Йога: '#c4b5fd',
  Семья: '#fb923c',
  Горы: '#94a3b8',
  Лес: '#4ade80',
  Река: '#22d3ee',
  Тишина: '#cbd5e1',
  Солнце: '#facc15',
  Ветер: '#38bdf8',
  Тропа: '#a8a29e',
  Здоровье: '#34d399',
  Забота: '#f472b6',
  Восхождение: '#a78bfa',
  Воздух: '#7dd3fc',
  Дети: '#fde68a',
  Мудрость: '#8b5cf6',
  Спокойствие: '#60a5fa',
  Сила: '#fb7185',
  Единение: '#ddd6fe',
  Природа: '#22c55e',
  Дом: '#fdba74',
  Птицы: '#38bdf8',
  Небо: '#0ea5e9',
  Облако: '#e2e8f0',
  Цветы: '#ec4899',
  Травы: '#84cc16',
  Счастье: '#fbbf24',
  Гармония: '#5eead4',
  Радость: '#fde047',
  Утро: '#fef08a',
  Вечер: '#a78bfa',
  Отдых: '#93c5fd',
  Движение: '#fb7185',
  Дыхание: '#67e8f9',
}

function getColorForWord(word: string): string {
  return WORD_COLORS[word] || '#94a3b8'
}

interface FlipWordProps {
  word: string
  nextWord: string
  isFlipping: boolean
  onFlipEnd: () => void
}

function FlipWord({ word, nextWord, isFlipping, onFlipEnd }: FlipWordProps) {
  const cardRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const frontFaceRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    if (!isFlipping || !containerRef.current || !cardRef.current || !measureRef.current) return

    const container = containerRef.current
    const card = cardRef.current

    measureRef.current.textContent = nextWord
    const nextWidth = measureRef.current.getBoundingClientRect().width
    const currentWidth = container.offsetWidth

    container.style.transition = `width ${FLIP_DURATION} ${FLIP_EASING}`
    container.style.width = `${currentWidth}px`

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        container.style.width = `${nextWidth}px`
      })
    })
  }, [isFlipping, nextWord])

  useEffect(() => {
    if (!isFlipping || !cardRef.current) return

    const card = cardRef.current
    const container = containerRef.current
    const handleTransitionEnd = (e: TransitionEvent) => {
      if (e.propertyName !== 'transform') return
      if (frontFaceRef.current) {
        const color = getColorForWord(nextWord)
        frontFaceRef.current.style.color = color
        frontFaceRef.current.textContent = nextWord
      }
      card.style.transition = 'none'
      card.style.transform = 'rotateX(0deg)'
      if (container) {
        container.style.transition = ''
        container.style.width = ''
      }
      onFlipEnd()
      card.removeEventListener('transitionend', handleTransitionEnd)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          card.style.transition = `transform ${FLIP_DURATION} ${FLIP_EASING}`
        })
      })
    }

    card.addEventListener('transitionend', handleTransitionEnd)
    requestAnimationFrame(() => {
      card.style.transform = 'rotateX(-180deg)'
    })

    return () => {
      card.removeEventListener('transitionend', handleTransitionEnd)
    }
  }, [isFlipping, nextWord, onFlipEnd])

  return (
    <span
      ref={containerRef}
      className="inline-block overflow-visible align-top relative pb-2"
      style={{
        perspective: '400px',
        minWidth: '1.1em',
        textAlign: 'center',
        lineHeight: 1.5,
      }}
    >
      <span
        ref={measureRef}
        aria-hidden
        className="invisible absolute whitespace-nowrap pointer-events-none top-0 left-0"
        style={{ font: 'inherit' }}
      />
      <span
        ref={cardRef}
        className="inline-block relative w-full"
        style={{
          transformStyle: 'preserve-3d',
          transform: 'rotateX(0deg)',
          transition: `transform ${FLIP_DURATION} ${FLIP_EASING}`,
        }}
      >
        <span
          ref={frontFaceRef}
          className="block w-full"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            color: getColorForWord(word),
          }}
        >
          {word}
        </span>
        <span
          className="block w-full absolute left-0 top-0"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateX(180deg)',
            color: getColorForWord(nextWord || word),
          }}
        >
          {nextWord}
        </span>
      </span>
    </span>
  )
}

const INITIAL_WORDS = ['Йога', 'Семья', 'Горы']

export default function RotatingWords() {
  const [words, setWords] = useState(INITIAL_WORDS)
  const [nextWords, setNextWords] = useState<string[]>(['', '', ''])
  const [flippingIndex, setFlippingIndex] = useState<number | null>(null)
  const lastFlippedRef = useRef<number | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const wordsRef = useRef(words)
  wordsRef.current = words

  const scheduleNextFlip = useCallback(() => {
    const currentWords = wordsRef.current
    const indexToFlip = getRandomIndex(lastFlippedRef.current)
    lastFlippedRef.current = indexToFlip

    const newWord = getRandomWord(currentWords)
    setNextWords((prev) => {
      const next = [...prev]
      next[indexToFlip] = newWord
      return next
    })
    setFlippingIndex(indexToFlip)
  }, [])

  const handleFlipEnd = useCallback(() => {
    const idx = flippingIndex
    if (idx !== null) {
      setWords((prev) => {
        const next = [...prev]
        next[idx] = nextWords[idx] || prev[idx]
        return next
      })
      setNextWords((prev) => {
        const next = [...prev]
        next[idx] = ''
        return next
      })
    }
    setFlippingIndex(null)
    const delay = getRandomDelay()
    timeoutRef.current = setTimeout(scheduleNextFlip, delay)
  }, [flippingIndex, nextWords, scheduleNextFlip])

  useEffect(() => {
    setWords(getThreeUniqueWords())
    const delay = getRandomDelay()
    const t = setTimeout(scheduleNextFlip, delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <span className="inline-flex flex-wrap justify-center gap-x-4 md:gap-x-6 gap-y-2">
      {words.map((word, i) => (
        <FlipWord
          key={i}
          word={word}
          nextWord={nextWords[i] || word}
          isFlipping={flippingIndex === i}
          onFlipEnd={handleFlipEnd}
        />
      ))}
    </span>
  )
}
