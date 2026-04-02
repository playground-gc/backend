/** @type {import('tailwindcss').Config} */
export default {
  // Scan all JSX/JS source files so unused classes are purged in production.
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      // NextBull dark-theme palette tokens — mirrors theme.js for consistency.
      colors: {
        surface: {
          DEFAULT: '#0f1117',
          raised: '#161b27',
          border: '#1e2535',
        },
        brand: {
          DEFAULT: '#f59e0b',
          dim: '#b45309',
        },
        bull: '#22c55e',
        bear: '#ef4444',
        muted: '#6b7280',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
