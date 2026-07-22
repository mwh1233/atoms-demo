/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        atoms: {
          bg: '#090b10',
          panel: '#11141b',
          line: '#242a36',
          text: '#f4f7fb',
          muted: '#8f9bad',
          accent: '#48d597',
        },
      },
    },
  },
  plugins: [],
};
