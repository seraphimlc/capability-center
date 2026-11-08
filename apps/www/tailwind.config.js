/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#f4f0e6',
        ink: '#1c1915',
        line: '#e4d9c8',
        moss: '#1f4d3a',
        clay: '#c2410c',
        card: '#fffdf8',
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        display: ['Fraunces', '"Noto Serif SC"', 'serif'],
      },
    },
  },
  plugins: [],
};
