'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
export default function AuthPage() {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) { setError('Please enter a username'); return; }
    setLoading(true);
    setError('');
    const ok = await signIn(username, 'auto');
    setLoading(false);
    if (ok) {
      router.push('/workplaces');
    } else {
      setError('Sign in failed. Please try again.');
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background orbs */}
      <div style={{
        position: 'absolute', width: 700, height: 700, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(59, 130, 246, 0.22) 0%, rgba(59, 130, 246, 0.04) 45%, transparent 70%)',
        top: '-25%', left: '-15%', filter: 'blur(40px)',
        animation: 'orb-float-1 20s ease-in-out infinite',
      }} />
      <div style={{
        position: 'absolute', width: 550, height: 550, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(240, 180, 41, 0.16) 0%, rgba(240, 180, 41, 0.03) 45%, transparent 70%)',
        bottom: '-15%', right: '-10%', filter: 'blur(40px)',
        animation: 'orb-float-2 25s ease-in-out infinite',
      }} />
      <div style={{
        position: 'absolute', width: 350, height: 350, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(96, 165, 250, 0.12) 0%, transparent 65%)',
        top: '60%', left: '55%', filter: 'blur(45px)',
        animation: 'orb-float-3 18s ease-in-out infinite',
      }} />

      <div className="animate-slide-up" style={{
        position: 'relative', zIndex: 1, width: '100%', maxWidth: 400, padding: '0 1.5rem',
      }}>
        {/* Glass card — everything lives inside */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.045)',
            backdropFilter: 'blur(48px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(48px) saturate(1.4)',
            border: '1px solid rgba(255, 255, 255, 0.10)',
            borderTopColor: 'rgba(255, 255, 255, 0.20)',
            borderLeftColor: 'rgba(255, 255, 255, 0.15)',
            borderRadius: 24,
            padding: '2.75rem 2.25rem 2.25rem',
            boxShadow:
              '0 12px 48px rgba(0,0,0,0.4), ' +
              '0 0 0 1px rgba(255,255,255,0.04) inset, ' +
              '0 1px 0 0 rgba(255,255,255,0.08) inset, ' +
              '0 0 80px rgba(240,180,41,0.03)',
          }}
        >
          {/* Branding inside card */}
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 12,
            }}>
              <div className="pulse-dot" />
              <span style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1.625rem',
                background: 'var(--gradient-text)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                letterSpacing: '-0.02em',
              }}>
                YourAnalyst
              </span>
            </div>
            <p style={{
              color: 'var(--text-muted)', fontSize: '0.8125rem', margin: 0,
              lineHeight: 1.5, letterSpacing: '0.01em',
            }}>
              Sign in to start querying your data
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            {/* Input group */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{
                display: 'block', color: 'var(--text-secondary)', fontSize: '0.6875rem',
                marginBottom: 6, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
              }}>Your name</label>
              <div style={{
                position: 'relative',
                borderRadius: 14,
                transition: 'box-shadow 0.3s ease',
                boxShadow: focused
                  ? '0 0 0 2px rgba(240, 180, 41, 0.25), 0 0 20px rgba(240, 180, 41, 0.08)'
                  : '0 0 0 1px rgba(255,255,255,0.06)',
              }}>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder="e.g. Alex"
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '0.8rem 1rem',
                    fontSize: '0.9375rem',
                    fontFamily: 'var(--font-body)',
                    color: 'var(--text-primary)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 14,
                    outline: 'none',
                    transition: 'border-color 0.25s ease',
                    borderColor: focused ? 'rgba(240, 180, 41, 0.45)' : 'rgba(255,255,255,0.08)',
                  }}
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                color: 'var(--error)', fontSize: '0.78rem', marginBottom: '1rem',
                padding: '0.5rem 0.75rem', background: 'rgba(255,113,108,0.07)',
                backdropFilter: 'blur(8px)', border: '1px solid rgba(255,113,108,0.18)',
                borderRadius: 12, lineHeight: 1.4,
              }}>{error}</div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !username.trim()}
              style={{
                width: '100%',
                padding: '0.8rem',
                fontSize: '0.9375rem',
                fontWeight: 600,
                fontFamily: 'var(--font-body)',
                color: '#0a0e1a',
                background: 'var(--gradient-gold)',
                border: 'none',
                borderRadius: 14,
                cursor: loading || !username.trim() ? 'not-allowed' : 'pointer',
                opacity: loading || !username.trim() ? 0.4 : 1,
                transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                position: 'relative',
                overflow: 'hidden',
                letterSpacing: '0.01em',
              }}
              onMouseEnter={e => {
                if (!loading && username.trim()) {
                  (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 24px rgba(240,180,41,0.35)';
                }
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
              }}
            >
              {loading ? 'Signing in...' : 'Continue'}
            </button>
          </form>

          {/* Footer hint */}
          <p style={{
            color: 'var(--text-muted)', fontSize: '0.7rem', textAlign: 'center',
            marginTop: '1.25rem', marginBottom: 0, letterSpacing: '0.015em', lineHeight: 1.5,
            opacity: 0.7,
          }}>
            No account needed — just enter any name to begin
          </p>
        </div>
      </div>
    </div>
  );
}
