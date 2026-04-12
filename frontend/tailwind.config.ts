import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'bg-void':    '#060d1f',
        'bg-base':    '#0a1530',
        'bg-surface': '#152640',
        'bg-elevated':'#0e1a34',
        'bg-overlay': '#0a1530',
        'text-primary':   '#e8eaf0',
        'text-secondary': '#a0abc3',
        'text-muted':     '#6a768c',
        accent:       '#F0B429',
        'accent-dark':'#D49B1A',
        'accent-light':'#FFCE54',
        secondary:    '#60A5FA',
        'secondary-dark':'#3B82F6',
        success: '#34d399',
        warning: '#fbbf24',
        error:   '#ff716c',
        info:    '#60A5FA',
        'agent-semantic': '#60A5FA',
        'agent-coder':    '#34d399',
        'agent-critic':   '#F0B429',
        'agent-narrator': '#ff716c',
      },
      fontFamily: {
        display: ['Space Grotesk', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      animation: {
        'fade-in': 'fade-in 0.4s cubic-bezier(0.16,1,0.3,1) forwards',
        'slide-in': 'slide-in 0.4s cubic-bezier(0.16,1,0.3,1) forwards',
        'slide-up': 'slide-up 0.5s cubic-bezier(0.16,1,0.3,1) forwards',
        'pulse-dot': 'pulse-dot 2s ease-in-out infinite',
        'gradient-shift': 'gradient-shift 15s ease infinite',
        'spin-slow': 'spin 3s linear infinite',
        'float': 'float 6s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
export default config
