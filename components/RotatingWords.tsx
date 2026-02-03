'use client'

const WORDS: string[] = ['ЙОГА', 'СЕМЬЯ', 'ГОРЫ']

export default function RotatingWords() {
  return (
    <span className="inline-flex flex-wrap justify-center gap-x-4 md:gap-x-6 gap-y-2">
      {WORDS.map((word) => (
        <span
          key={word}
          className="uppercase tracking-[0.08em] bg-gradient-to-b from-sky-300 via-sky-500 to-blue-700 bg-clip-text text-transparent text-4xl md:text-5xl"
          style={{
            fontFamily: 'var(--font-roboto)',
          }}
        >
          {word}
        </span>
      ))}
    </span>
  )
}
