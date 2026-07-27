/**
 * RectaBot brand tokens — kept in sync with the landing page / configurator
 * (Docs/configurator/index.html). One design language across the ecosystem.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // surfaces
        base: '#020617',      // app background (slate-950)
        panel: '#0f172a',     // cards / panels
        panel2: '#0a1421',    // recessed areas (console)
        border: '#1e293b',
        border2: '#334155',
        // brand + semantic
        brand: '#22d3ee',     // cyan-400 (locked brand accent)
        brandDark: '#0e7490', // cyan-700 (hover)
        ok: '#10b981',
        warn: '#fbbf24',
        danger: '#ef4444',
        purple: '#a855f7',  // Park (an app concept, not a machine state)
        // Homing state — blue is the convention senders share (ioSender). NOT named
        // `blue`: that would replace Tailwind's whole blue scale and silently kill
        // the `blue-400` used elsewhere.
        homing: '#3b82f6'
      },
      fontFamily: {
        display: ['Orbitron', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace']
      },
      boxShadow: {
        glow: '0 0 40px rgba(34, 211, 238, 0.15)'
      }
    }
  },
  plugins: []
}
