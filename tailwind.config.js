/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta oficial para uso en tablets en campo (alta legibilidad)
        brand: {
          50:  '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
        surface: {
          DEFAULT: '#f0f5ff',  // fondo principal (azul blanco suave)
          card:    '#ffffff',  // tarjetas (blanco)
          muted:   '#d0dff5',  // bordes / separadores (azul claro)
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
