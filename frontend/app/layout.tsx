import type { Metadata } from 'next'
import './globals.css'

import { OnboardingProvider } from '@/hooks/useOnboarding'
import { OnboardingGuide } from '@/components/OnboardingGuide'

export const metadata: Metadata = {
  title: 'YourAnalyst : Ask anything. Trust everything.',
  description: 'AI-powered analytics: connect your data, ask in plain English, get trustworthy insights.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ background: 'var(--bg-void)', color: 'var(--text-primary)', fontFamily: 'var(--font-body)' }}>
        {/* Background gradient orbs â€” gold + blue */}
        <div className="bg-orbs" />

        {/* Extra GOLD orb â€” centre-right */}
        <div style={{
          position: 'fixed',
          width: 420,
          height: 420,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(240, 180, 41, 0.12) 0%, transparent 65%)',
          filter: 'blur(50px)',
          top: '35%',
          left: '55%',
          zIndex: 0,
          pointerEvents: 'none',
          animation: 'orb-float-3 30s ease-in-out infinite',
        }} />

        {/* Extra BLUE orb â€” bottom-left */}
        <div style={{
          position: 'fixed',
          width: 300,
          height: 300,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(59, 130, 246, 0.10) 0%, transparent 65%)',
          filter: 'blur(45px)',
          bottom: '20%',
          left: '10%',
          zIndex: 0,
          pointerEvents: 'none',
          animation: 'orb-float-1 18s ease-in-out infinite reverse',
        }} />

        <OnboardingProvider>
          {children}
          <OnboardingGuide />
        </OnboardingProvider>
      </body>
    </html>
  )
}
