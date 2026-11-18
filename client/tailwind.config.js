/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1D1D1F',
        sub: '#86868B',
        faint: '#AEAEB2',
        line: '#E5E5EA',
        bg: '#F5F5F7',
        ok: '#34C759',
        bad: '#FF3B30',
        warn: '#FF9500',
        star: '#F5A623',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'PingFang SC', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
      },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
};
