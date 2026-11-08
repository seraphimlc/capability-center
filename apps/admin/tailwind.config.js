/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#f6f3ee',
        ink: '#14211c',
        line: '#ddd4c6',
        moss: '#1f4d3a',
        clay: '#b45309',
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', '"PingFang SC"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
