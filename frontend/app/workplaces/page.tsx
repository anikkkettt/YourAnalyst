'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSources, deleteSource } from '@/lib/api';
import type { DataSource } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';
import { useOnboarding } from '@/hooks/useOnboarding';
import { AddSourceWizard } from '@/components/AddSourceWizard';

/* ══════════════════════════════════════════════
   TYPES
   ══════════════════════════════════════════════ */
interface Workplace {
  id: string;
  name: string;
  createdAt: string;
  sourceCount: number;
  lastOpenedAt: string;
}

/* ══════════════════════════════════════════════
   ICONS / GLASS HELPERS
   ══════════════════════════════════════════════ */
const DB_ICONS: Record<string, string> = {
  postgresql: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/postgresql/postgresql-original.svg',
  mysql: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/mysql/mysql-original.svg',
  sqlite: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/sqlite/sqlite-original.svg',
  turso: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/sqlite/sqlite-original.svg',
  csv: 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/files.svg',
  excel: 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/microsoftexcel.svg',
};

const glassCardStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.05)',
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderTopColor: 'rgba(255, 255, 255, 0.22)',
  borderLeftColor: 'rgba(255, 255, 255, 0.18)',
  borderRadius: 16,
  boxShadow: '0 8px 32px rgba(0,0,0,0.35), 0 0 40px rgba(240,180,41,0.05), inset 0 1px 0 0 rgba(255,255,255,0.09)',
  transition: 'all 0.35s cubic-bezier(0.16,1,0.3,1)',
};

const glassCardHover = (e: React.MouseEvent) => {
  const el = e.currentTarget as HTMLElement;
  el.style.background = 'rgba(255, 255, 255, 0.09)';
  el.style.borderColor = 'rgba(240, 180, 41, 0.35)';
  el.style.transform = 'translateY(-4px)';
  el.style.boxShadow = '0 16px 48px rgba(0,0,0,0.4), 0 0 60px rgba(240,180,41,0.08), inset 0 1px 0 0 rgba(255,255,255,0.12)';
};

const glassCardLeave = (e: React.MouseEvent) => {
  const el = e.currentTarget as HTMLElement;
  el.style.background = 'rgba(255, 255, 255, 0.05)';
  el.style.borderColor = 'rgba(255, 255, 255, 0.12)';
  el.style.transform = 'translateY(0)';
  el.style.boxShadow = '0 8px 32px rgba(0,0,0,0.35), 0 0 40px rgba(240,180,41,0.05), inset 0 1px 0 0 rgba(255,255,255,0.09)';
};


/* ══════════════════════════════════════════════
   WORKPLACE PERSISTENCE  (localStorage)
   ══════════════════════════════════════════════ */
function getWorkplaces(username: string): Workplace[] {
  try {
    const raw = localStorage.getItem(`ya_workplaces_${username}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveWorkplaces(username: string, list: Workplace[]) {
  localStorage.setItem(`ya_workplaces_${username}`, JSON.stringify(list));
}


/* ══════════════════════════════════════════════
   TIME HELPERS
   ══════════════════════════════════════════════ */
const formatRelTime = (iso: string) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

const formatTime = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  return d.toLocaleTimeString();
};


/* ══════════════════════════════════════════════
   PAGE COMPONENT
   ══════════════════════════════════════════════ */
export default function SourcesPage() {
  const { isAuthenticated, username, isLoading, signOut, switchSession } = useAuth();
  const { nextStep } = useOnboarding();
  const router = useRouter();

  // Workplace list state
  const [workplaces, setWorkplaces] = useState<Workplace[]>([]);
  const [activeWorkplace, setActiveWorkplace] = useState<Workplace | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');

  // Source detail state (when inside a workplace)
  const [sources, setSources] = useState<DataSource[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [loadingSources, setLoadingSources] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const sessionIdFor = (wp: Workplace) => `workspace_${wp.id}`;

  // Auth guard
  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push('/auth');
  }, [isAuthenticated, isLoading, router]);

  // Load workplaces
  useEffect(() => {
    if (username) setWorkplaces(getWorkplaces(username));
  }, [username]);

  // Load sources when entering a workplace
  useEffect(() => {
    if (activeWorkplace && username) {
      setLoadingSources(true);
      getSources(sessionIdFor(activeWorkplace))
        .then(data => setSources(Array.isArray(data) ? data : data.sources || []))
        .catch(() => {})
        .finally(() => setLoadingSources(false));
    } else {
      setSources([]);
    }
  }, [activeWorkplace, username]);

  /* ── Workplace CRUD ── */
  const createWorkplace = () => {
    const name = newName.trim() || `Workplace ${workplaces.length + 1}`;
    const wp: Workplace = {
      id: crypto.randomUUID().slice(0, 8),
      name,
      createdAt: new Date().toISOString(),
      sourceCount: 0,
      lastOpenedAt: new Date().toISOString(),
    };
    const updated = [wp, ...workplaces];
    setWorkplaces(updated);
    saveWorkplaces(username, updated);
    setNewName('');
    setShowCreateModal(false);
    setActiveWorkplace(wp);
  };

  const deleteWorkplace = (wpId: string) => {
    setWorkplaces(prev => {
      const updated = prev.filter(w => w.id !== wpId);
      saveWorkplaces(username, updated);
      return updated;
    });
  };

  const openWorkplace = (wp: Workplace) => {
    setWorkplaces(prev => {
      const updated = prev.map(w =>
        w.id === wp.id ? { ...w, lastOpenedAt: new Date().toISOString() } : w
      );
      saveWorkplaces(username, updated);
      return updated;
    });
    setActiveWorkplace({ ...wp, lastOpenedAt: new Date().toISOString() });
  };

  const goBackToList = () => {
    if (activeWorkplace) {
      const wpId = activeWorkplace.id;
      const count = sources.length;
      setWorkplaces(prev => {
        const updated = prev.map(w =>
          w.id === wpId ? { ...w, sourceCount: count } : w
        );
        saveWorkplaces(username, updated);
        return updated;
      });
    }
    setActiveWorkplace(null);
    setSources([]);
    setShowWizard(false);
  };

  /* ── Source handlers (inside a workplace) ── */
  const handleDelete = async (sourceId: string) => {
    await deleteSource(sourceId);
    setSources(prev => prev.filter(s => s.source_id !== sourceId));
  };

  const handleSourceAdded = (newSrc: DataSource | DataSource[]) => {
    const arr = Array.isArray(newSrc) ? newSrc : [newSrc];
    setSources(prev => {
      const newSources = [...prev, ...arr];
      if (activeWorkplace) {
        const wpId = activeWorkplace.id;
        setWorkplaces(prevWps => {
          const updated = prevWps.map(w =>
            w.id === wpId ? { ...w, sourceCount: newSources.length } : w
          );
          saveWorkplaces(username, updated);
          return updated;
        });
      }
      return newSources;
    });
    setShowWizard(false);
  };

  const handleStartChat = (targetSourceId?: string) => {
    if (!activeWorkplace) return;
    switchSession(sessionIdFor(activeWorkplace));
    if (targetSourceId) router.push(`/chat?source_id=${targetSourceId}`);
    else router.push('/chat');
  };

  /* ── Loading ── */
  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-secondary)' }}>
      <div className="pulse-dot" style={{ marginRight: 12 }} />
      Loading...
    </div>
  );

  /* ══════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════ */
  return (
    <div style={{ minHeight: '100vh', position: 'relative' }}>
      {/* ═══ GLASS NAV ═══ */}
      <nav className="glass-nav" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 0.625rem 0 1.25rem', height: 52,
        position: 'sticky', top: 12, zIndex: 50,
        margin: '12px 1.5rem 0',
        maxWidth: 1100, marginLeft: 'auto', marginRight: 'auto',
      }}>
        {/* Left — Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flexShrink: 0 }} onClick={goBackToList}>
          <div className="pulse-dot" style={{ width: 8, height: 8 }} />
          <span className="mobile-hide" style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem',
            background: 'var(--gradient-text)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>YourAnalyst</span>
        </div>

        {/* Centre — Nav tabs */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'rgba(255,255,255,0.04)', borderRadius: 9999,
          padding: 3, border: '1px solid rgba(255,255,255,0.06)',
        }}>
          {[
            { label: 'Workplaces', href: '/workplaces', active: true },
            { label: 'Chat', href: '/chat', active: false },
            { label: 'History', href: '/history', active: false, hideOnMobile: true },
          ].map(tab => (
            <button
              key={tab.label}
              onClick={() => !tab.active && router.push(tab.href)}
              className={tab.hideOnMobile ? 'mobile-hide' : undefined}
              style={{
                background: tab.active ? 'rgba(240,180,41,0.12)' : 'none',
                border: tab.active ? '1px solid rgba(240,180,41,0.2)' : '1px solid transparent',
                borderRadius: 9999,
                padding: '0.3rem 1rem',
                fontSize: '0.78rem',
                fontWeight: tab.active ? 700 : 500,
                color: tab.active ? 'var(--accent)' : 'var(--text-muted)',
                cursor: tab.active ? 'default' : 'pointer',
                fontFamily: 'var(--font-body)',
                transition: 'all 0.25s ease',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { if (!tab.active) { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; } }}
              onMouseLeave={e => { if (!tab.active) { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'none'; } }}
            >{tab.label}</button>
          ))}
        </div>

        {/* Right — User */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span className="mobile-hide" style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 500 }}>{username}</span>
          <button onClick={signOut} style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 9999, padding: '0.3rem 0.875rem',
            fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer',
            fontFamily: 'var(--font-body)', transition: 'all 0.25s ease',
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--error)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,113,108,0.3)'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,113,108,0.08)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
          >Sign out</button>
        </div>
      </nav>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem', position: 'relative', zIndex: 1 }}>

        {/* ══════════════════════════════════════
           VIEW 1: WORKPLACE LIST
           ══════════════════════════════════════ */}
        {!activeWorkplace && (
          <>
            {/* Header */}
            <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h1 style={{
                  fontFamily: 'var(--font-display)', fontSize: '1.85rem', fontWeight: 700, margin: 0,
                  background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--accent) 100%)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                }}>Your Workplaces</h1>
                <p className="mobile-hide" style={{ color: 'var(--text-secondary)', marginTop: 6, fontSize: '0.875rem' }}>
                  Each workplace is an isolated environment with its own data sources and conversations.
                </p>
              </div>
              <button className="btn-primary mobile-full-width" onClick={() => setShowCreateModal(true)}>
                + New Workplace
              </button>
            </div>

            {/* Workplace list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', maxWidth: 640, margin: '0 auto' }}>
              {workplaces.map((wp, idx) => (
                <div
                  key={wp.id}
                  className="animate-fade-in"
                  style={{
                    ...glassCardStyle,
                    padding: '1.5rem',
                    cursor: 'pointer',
                    animationDelay: `${idx * 0.06}s`,
                    animationFillMode: 'backwards',
                    position: 'relative',
                  }}
                  onClick={() => openWorkplace(wp)}
                  onMouseEnter={glassCardHover}
                  onMouseLeave={glassCardLeave}
                >
                  {/* Top row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 12,
                        background: 'rgba(240, 180, 41, 0.12)',
                        backdropFilter: 'blur(8px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '1px solid rgba(255,255,255,0.08)',
                        boxShadow: '0 0 16px rgba(240,180,41,0.08), inset 0 1px 0 0 rgba(255,255,255,0.06)',
                        fontSize: '1.2rem',
                      }}>
                        📊
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '1.0625rem', color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                          {wp.name}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          Created {formatRelTime(wp.createdAt)}
                        </div>
                      </div>
                    </div>
                    {/* Delete button with confirmation */}
                    {confirmDeleteId === wp.id ? (
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        <span style={{ fontSize: '0.7rem', color: 'var(--error)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          Are you sure?
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); deleteWorkplace(wp.id); setConfirmDeleteId(null); }}
                          style={{
                            background: 'rgba(255,113,108,0.15)', border: '1px solid rgba(255,113,108,0.3)',
                            color: 'var(--error)', cursor: 'pointer',
                            fontSize: '0.7rem', fontWeight: 600, padding: '3px 10px', borderRadius: 6,
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,113,108,0.25)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,113,108,0.15)'; }}
                        >Yes</button>
                        <button
                          onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); }}
                          style={{
                            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                            color: 'var(--text-secondary)', cursor: 'pointer',
                            fontSize: '0.7rem', fontWeight: 600, padding: '3px 10px', borderRadius: 6,
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.1)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
                        >No</button>
                      </div>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmDeleteId(wp.id); }}
                        style={{
                          background: 'none', border: '1px solid rgba(255,113,108,0.2)',
                          color: 'var(--text-muted)', cursor: 'pointer',
                          fontSize: '0.7rem', fontWeight: 600, padding: '3px 10px', borderRadius: 6,
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--error)'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,113,108,0.1)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,113,108,0.4)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,113,108,0.2)'; }}
                      >Delete</button>
                    )}
                  </div>

                  {/* Meta row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
                    <span style={{
                      fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 600,
                      background: 'var(--accent-dim)', padding: '2px 10px', borderRadius: 6,
                    }}>
                      {wp.sourceCount} {wp.sourceCount === 1 ? 'source' : 'sources'}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Last opened {formatRelTime(wp.lastOpenedAt)}
                    </span>
                  </div>

                  {/* Prompt row */}
                  <div style={{
                    fontSize: '0.8125rem', color: 'var(--secondary)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    Open workplace →
                  </div>
                </div>
              ))}

              {/* CREATE NEW card */}
              <div
                className="animate-fade-in"
                style={{
                  background: 'rgba(255, 255, 255, 0.025)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  border: '2px dashed rgba(255, 255, 255, 0.12)',
                  borderRadius: 16,
                  padding: '1.25rem',
                  display: 'flex', flexDirection: 'row',
                  alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', gap: 12,
                  transition: 'all 0.35s cubic-bezier(0.16,1,0.3,1)',
                  boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.04)',
                }}
                onClick={() => setShowCreateModal(true)}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = 'rgba(240,180,41,0.06)';
                  el.style.borderColor = 'rgba(240,180,41,0.35)';
                  el.style.transform = 'translateY(-3px)';
                  el.style.boxShadow = '0 8px 32px rgba(0,0,0,0.3), 0 0 40px rgba(240,180,41,0.06)';
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = 'rgba(255,255,255,0.025)';
                  el.style.borderColor = 'rgba(255,255,255,0.12)';
                  el.style.transform = 'translateY(0)';
                  el.style.boxShadow = 'inset 0 1px 0 0 rgba(255,255,255,0.04)';
                }}
              >
                <span style={{ fontSize: '1.5rem', color: 'var(--accent)', fontWeight: 300, lineHeight: 1, filter: 'drop-shadow(0 0 8px rgba(240,180,41,0.4))' }}>+</span>
                <span style={{ color: 'var(--text-primary)', fontSize: '0.875rem', fontWeight: 600 }}>Create New Workplace</span>
                <span className="mobile-hide" style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                  Upload files or connect databases
                </span>
              </div>
            </div>

            {/* Empty state — show only when zero workplaces */}
            {workplaces.length === 0 && (
              <div className="animate-fade-in" style={{ textAlign: 'center', paddingTop: '2rem' }}>
                <div style={{ marginTop: '1rem', paddingTop: '2rem', paddingBottom: '1rem' }}>
                  <h2 style={{
                    fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem',
                    background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--accent) 100%)',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                  }}>Turn Raw Data into Clear Answers</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', maxWidth: 540, margin: '0 auto', lineHeight: 1.7 }}>
                    Create a workplace, connect any data source, and start asking questions in plain English. No SQL skills required — your AI analyst handles the rest.
                  </p>
                </div>

                {/* Feature cards — vertical stack */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', maxWidth: 620, margin: '2.5rem auto 0' }}>
                  {[
                    { title: 'Ask in Plain English, Get Precise Results', desc: 'Skip the query syntax. Describe what you need in your own words and receive accurate, structured answers backed by real data.', icon: 'message-chatbot' },
                    { title: 'Every Answer is Verified Before You See It', desc: 'A built-in chain of AI agents cross-checks every result for accuracy, flags assumptions, and scores confidence so you can trust what you read.', icon: 'shield-check' },
                    { title: 'From Spreadsheets to Data Warehouses, All Welcome', desc: 'Upload a CSV, connect to PostgreSQL, MySQL, SQLite, Turso, or Excel — mix and match sources in a single workplace and query across all of them.', icon: 'plug-connected' },
                  ].map((f, idx) => (
                    <div
                      key={f.title}
                      className="animate-fade-in"
                      style={{
                        ...glassCardStyle,
                        padding: '1.25rem 1.5rem',
                        display: 'flex', alignItems: 'flex-start', gap: 16,
                        textAlign: 'left',
                        animationDelay: `${idx * 0.1}s`,
                        animationFillMode: 'backwards',
                      }}
                      onMouseEnter={glassCardHover} onMouseLeave={glassCardLeave}
                    >
                      <div style={{
                        width: 42, height: 42, minWidth: 42, borderRadius: 12,
                        background: 'rgba(240, 180, 41, 0.1)', backdropFilter: 'blur(8px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '1px solid rgba(255,255,255,0.08)',
                        boxShadow: '0 0 16px rgba(240,180,41,0.1), inset 0 1px 0 0 rgba(255,255,255,0.06)',
                        marginTop: 2,
                      }}>
                        <img src={`https://cdn.jsdelivr.net/npm/@tabler/icons/icons/${f.icon}.svg`} alt="" style={{ width: 20, height: 20, filter: 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(30deg)' }} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, margin: '0 0 4px', color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{f.title}</h3>
                        <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>{f.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}


        {/* ══════════════════════════════════════
           VIEW 2: INSIDE A WORKPLACE (Sources)
           ══════════════════════════════════════ */}
        {activeWorkplace && (
          <>
            {/* Breadcrumb */}
            <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.5rem' }}>
              <button onClick={goBackToList} className="btn-ghost" style={{ fontSize: '0.8125rem', padding: '0.3rem 0.75rem' }}>
                ← Workplaces
              </button>
              <span style={{ color: 'var(--text-muted)' }}>/</span>
              <span style={{
                color: 'var(--accent)', fontWeight: 600, fontSize: '0.875rem',
                fontFamily: 'var(--font-display)',
              }}>{activeWorkplace.name}</span>
            </div>

            {/* Sources header */}
            <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div className="mobile-full-width">
                <h1 className="mobile-branding-text" style={{
                  fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 700, margin: 0,
                  background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--accent) 100%)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                }}>{activeWorkplace.name}</h1>
                <p className="mobile-hide" style={{ color: 'var(--text-secondary)', marginTop: 6, fontSize: '0.875rem' }}>
                  Connect databases or upload files to this workplace
                </p>
              </div>
              <button data-tour="source-add" className="btn-primary mobile-full-width" onClick={() => { setShowWizard(true); nextStep(); }}>
                + Add Data Source
              </button>
            </div>

            {/* Source cards list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', maxWidth: 640, margin: '0 auto 1.5rem' }}>
              {sources.map((source, idx) => (
                <div key={source.source_id} className="animate-fade-in" style={{
                  ...glassCardStyle, padding: '1rem 1.25rem', position: 'relative',
                  animationDelay: `${idx * 0.08}s`, animationFillMode: 'backwards', cursor: 'default',
                  display: 'flex', alignItems: 'center', gap: 14,
                }} onMouseEnter={glassCardHover} onMouseLeave={glassCardLeave}>
                  {/* Icon */}
                  <div style={{
                    width: 40, height: 40, minWidth: 40, borderRadius: 10,
                    background: 'rgba(240, 180, 41, 0.1)', backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8,
                    border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.06)',
                  }}>
                    <img src={DB_ICONS[source.db_type] || 'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/database.svg'}
                      alt={source.db_type} style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
                  </div>
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source.name}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--accent)', textTransform: 'uppercase', fontWeight: 700, background: 'var(--accent-dim)', padding: '1px 7px', borderRadius: 5, flexShrink: 0 }}>{source.db_type}</span>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: source.is_connected ? 'var(--success)' : 'var(--warning)',
                        boxShadow: source.is_connected ? '0 0 10px rgba(52,211,153,0.5)' : '0 0 10px rgba(251,191,36,0.5)',
                      }} />
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 3 }}>
                      {source.table_count} {source.table_count === 1 ? 'table' : 'tables'}&nbsp;·&nbsp;Connected {formatTime(source.connected_at)}
                    </div>
                  </div>
                  {/* Actions */}
                  <button className="btn-ghost"
                    style={{ fontSize: '0.73rem', padding: '0.3rem 0.875rem', color: 'var(--error)', borderColor: 'rgba(255,113,108,0.2)', flexShrink: 0 }}
                    onClick={() => handleDelete(source.source_id)}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,113,108,0.1)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--error)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,113,108,0.2)'; }}
                  >Remove</button>
                </div>
              ))}

              {/* Add placeholder card */}
              <div
                className="animate-fade-in"
                style={{
                  background: 'rgba(255, 255, 255, 0.025)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                  border: '2px dashed rgba(255, 255, 255, 0.12)', borderRadius: 16, padding: '1rem 1.25rem',
                  display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', gap: 12,
                  transition: 'all 0.35s cubic-bezier(0.16,1,0.3,1)',
                  boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.04)',
                }}
                onClick={() => setShowWizard(true)}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(240,180,41,0.06)'; el.style.borderColor = 'rgba(240,180,41,0.35)'; el.style.transform = 'translateY(-3px)'; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.025)'; el.style.borderColor = 'rgba(255,255,255,0.12)'; el.style.transform = 'translateY(0)'; }}
              >
                <span style={{ fontSize: '1.5rem', color: 'var(--accent)', fontWeight: 300, lineHeight: 1, filter: 'drop-shadow(0 0 8px rgba(240,180,41,0.4))' }}>+</span>
                <span style={{ color: 'var(--text-primary)', fontSize: '0.875rem', fontWeight: 600 }}>Add Data Source</span>
                <span className="mobile-hide" style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Connect a database or upload a file</span>
              </div>
            </div>

            {/* CTA */}
            {sources.length > 0 && (
              <div style={{ textAlign: 'center', paddingTop: '0.5rem', marginBottom: '2rem' }}>
                <button data-tour="source-combined" className="btn-primary mobile-full-width" style={{ fontSize: '1.05rem', padding: '0.875rem 3rem' }} onClick={() => handleStartChat()}>
                  Start Asking Questions →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ═══ CREATE WORKPLACE MODAL ═══ */}
      {showCreateModal && (
        <div
          className="glass-modal-backdrop"
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(6, 13, 31, 0.55)',
            backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowCreateModal(false); }}
        >
          <div className="animate-slide-up glass-modal" style={{ width: '100%', maxWidth: 440, padding: '2rem' }}>
            <h2 style={{
              fontFamily: 'var(--font-display)', fontWeight: 700, margin: '0 0 0.5rem', fontSize: '1.25rem',
              background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--accent) 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>Create New Workplace</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', margin: '0 0 1.5rem' }}>
              Give your workplace a name. You can upload data sources after creating it.
            </p>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: 8, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Workplace Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Q4 Revenue Analysis"
                className="glass-input"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') createWorkplace(); }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" onClick={() => setShowCreateModal(false)} style={{ flex: 1 }}>Cancel</button>
              <button className="btn-primary" onClick={createWorkplace} style={{ flex: 1 }}>Create →</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ ADD SOURCE WIZARD ═══ */}
      {showWizard && activeWorkplace && (
        <AddSourceWizard
          sessionId={sessionIdFor(activeWorkplace)}
          onClose={() => setShowWizard(false)}
          onAdded={handleSourceAdded}
        />
      )}
    </div>
  );
}
