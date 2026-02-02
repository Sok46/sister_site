/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fef7f0',
          100: '#fdeee0',
          200: '#fbd9c1',
          300: '#f7be98',
          400: '#f2976d',
          500: '#ee7a4a',
          600: '#df5c2a',
          700: '#ba471f',
          800: '#983b1e',
          900: '#7b351c',
        },
        accent: {
          50: '#f0f9f4',
          100: '#dcf2e4',
          200: '#bce5cd',
          300: '#8fd0ae',
          400: '#5ab388',
          500: '#36966a',
          600: '#277955',
          700: '#216147',
          800: '#1d4e3a',
          900: '#194131',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-playfair)', 'serif'],
      },
    },
  },
  plugins: [],
}
