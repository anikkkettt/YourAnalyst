'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

interface Thread {
  id: string;
  title: string;
  preview: string | null;
  timestamp: string;
  messageCount: number;
  workplace: string | null;
  workplaceId: string | null;
}

interface WorkplaceGroup {
  id: string;
  name: string;
  threads: Thread[];
  latestTimestamp: string;
}

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

const formatRelTime = (iso: string) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString();
};

export default function HistoryPage() {
  const { isAuthenticated, username, isLoading, signOut, switchSession } = useAuth();
  const router = useRouter();
  const [workplaceGroups, setWorkplaceGroups] = useState<WorkplaceGroup[]>([]);
  const [ungroupedThreads, setUngroupedThreads] = useState<Thread[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push('/auth');
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    setLoadingHistory(true);

    const storedSessions = localStorage.getItem('dw_sessions');
    const sessionIds: string[] = storedSessions ? JSON.parse(storedSessions) : [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('dw_messages_')) {
        const sid = key.replace('dw_messages_', '');
        if (!sessionIds.includes(sid)) sessionIds.push(sid);
      }
    }

    // Build workplace lookup: workplaceId -> { name, id }
    const workplaceMap: Record<string, { id: string; name: string }> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('ya_workplaces_')) {
        try {
          const wps = JSON.parse(localStorage.getItem(key) || '[]');
          for (const wp of wps) {
            workplaceMap[wp.id] = { id: wp.id, name: wp.name };
          }
        } catch { }
      }
    }

    const allThreads: Thread[] = sessionIds.map(id => {
      const msgs = localStorage.getItem(`dw_messages_${id}`);
      if (!msgs) return null;
      try {
        const parsed = JSON.parse(msgs);
        if (parsed.length === 0) return null;
        const firstUserMsg = parsed.find((m: any) => m.type === 'user');
        const lastMsg = [...parsed].reverse().find((m: any) => m.type === 'user');

        // Detect workplace association
        let workplaceId: string | null = null;
        let workplaceName: string | null = null;
        if (id.startsWith('workspace_')) {
          const wpId = id.replace('workspace_', '');
          if (workplaceMap[wpId]) {
            workplaceId = wpId;
            workplaceName = workplaceMap[wpId].name;
          }
        }

        return {
          id,
          title: firstUserMsg ? firstUserMsg.content : 'Untitled Conversation',
          preview: lastMsg && lastMsg !== firstUserMsg ? lastMsg.content : null,
          timestamp: firstUserMsg ? firstUserMsg.timestamp : new Date().toISOString(),
          messageCount: parsed.length,
          workplace: workplaceName,
          workplaceId,
        } as Thread;
      } catch { return null; }
    }).filter(Boolean) as Thread[];

    // Group by workplace
    const grouped: Record<string, Thread[]> = {};
    const ungrouped: Thread[] = [];

    for (const thread of allThreads) {
      if (thread.workplaceId) {
        if (!grouped[thread.workplaceId]) grouped[thread.workplaceId] = [];
        grouped[thread.workplaceId].push(thread);
      } else {
        ungrouped.push(thread);
      }
    }

    // Build workplace groups sorted by latest activity
    const groups: WorkplaceGroup[] = Object.entries(grouped).map(([wpId, threads]) => {
      threads.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return {
        id: wpId,
        name: workplaceMap[wpId]?.name || wpId,
        threads,
        latestTimestamp: threads[0]?.timestamp || '',
      };
    });
    groups.sort((a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime());

    ungrouped.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    setWorkplaceGroups(groups);
    setUngroupedThreads(ungrouped);
    setLoadingHistory(false);
  }, []);

  const totalThreads = workplaceGroups.reduce((sum, g) => sum + g.threads.length, 0) + ungroupedThreads.length;

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleThreadClick = (id: string) => {
    switchSession(id);
    router.push('/chat');
  };

  const handleDeleteThread = (id: string) => {
    localStorage.removeItem(`dw_messages_${id}`);
    const stored = localStorage.getItem('dw_sessions');
    if (stored) {
      const sessions: string[] = JSON.parse(stored);
      localStorage.setItem('dw_sessions', JSON.stringify(sessions.filter(s => s !== id)));
    }
    // Remove from groups or ungrouped
    setWorkplaceGroups(prev =>
      prev.map(g => ({ ...g, threads: g.threads.filter(t => t.id !== id) }))
        .filter(g => g.threads.length > 0)
    );
    setUngroupedThreads(prev => prev.filter(t => t.id !== id));
    setConfirmDeleteId(null);
  };

  const renderThread = (thread: Thread, idx: number) => (
    <div
      key={thread.id}
      className="animate-fade-in"
      style={{
        ...glassCardStyle,
        padding: '1.125rem 1.25rem',
        cursor: 'pointer',
        animationDelay: `${idx * 0.05}s`,
        animationFillMode: 'backwards',
        position: 'relative',
      }}
      onClick={() => handleThreadClick(thread.id)}
      onMouseEnter={glassCardHover}
      onMouseLeave={glassCardLeave}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1, minWidth: 0 }}>
          {/* Chat icon */}
          <div style={{
            width: 40, height: 40, minWidth: 40, borderRadius: 10,
            background: 'rgba(240, 180, 41, 0.10)',
            backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 0 16px rgba(240,180,41,0.08), inset 0 1px 0 0 rgba(255,255,255,0.06)',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.85 }}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>

          {/* Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)',
              fontFamily: 'var(--font-display)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              marginBottom: 3,
            }}>{thread.title}</div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {formatRelTime(thread.timestamp)}
              </span>
              <span style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.15)' }}>●</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {thread.messageCount} message{thread.messageCount !== 1 ? 's' : ''}
              </span>
            </div>

            {thread.preview && (
              <p style={{
                margin: '5px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)',
                lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', opacity: 0.55,
              }}>{thread.preview}</p>
            )}
          </div>
        </div>

        {/* Delete */}
        <div style={{ flexShrink: 0, paddingTop: 2 }}>
          {confirmDeleteId === thread.id ? (
            <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--error)', fontWeight: 600, whiteSpace: 'nowrap' }}>Sure?</span>
              <button
                onClick={e => { e.stopPropagation(); handleDeleteThread(thread.id); }}
                style={{
                  background: 'rgba(255,113,108,0.15)', border: '1px solid rgba(255,113,108,0.3)',
                  color: 'var(--error)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600,
                  padding: '3px 10px', borderRadius: 6, transition: 'all 0.2s', fontFamily: 'var(--font-body)',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,113,108,0.25)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,113,108,0.15)'; }}
              >Yes</button>
              <button
                onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); }}
                style={{
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                  color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600,
                  padding: '3px 10px', borderRadius: 6, transition: 'all 0.2s', fontFamily: 'var(--font-body)',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.1)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
              >No</button>
            </div>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); setConfirmDeleteId(thread.id); }}
              style={{
                background: 'none', border: '1px solid rgba(255,113,108,0.2)',
                color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600,
                padding: '3px 10px', borderRadius: 6, transition: 'all 0.2s', fontFamily: 'var(--font-body)',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--error)'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,113,108,0.1)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--error)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,113,108,0.2)'; }}
            >Delete</button>
          )}
        </div>
      </div>
    </div>
  );

  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-secondary)' }}>
      <div className="pulse-dot" style={{ marginRight: 12 }} />
      Loading...
    </div>
  );

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div className="pulse-dot" style={{ width: 8, height: 8 }} />
          <span className="mobile-hide" style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem',
            background: 'var(--gradient-text)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>YourAnalyst</span>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'rgba(255,255,255,0.04)', borderRadius: 9999,
          padding: 3, border: '1px solid rgba(255,255,255,0.06)',
        }}>
          {[
            { label: 'Workplaces', href: '/workplaces', active: false },
            { label: 'Chat', href: '/chat', active: false },
            { label: 'History', href: '/history', active: true },
          ].map(tab => (
            <button
              key={tab.label}
              onClick={() => !tab.active && router.push(tab.href)}
              style={{
                background: tab.active ? 'rgba(240,180,41,0.12)' : 'none',
                border: tab.active ? '1px solid rgba(240,180,41,0.2)' : '1px solid transparent',
                borderRadius: 9999, padding: '0.3rem 1rem',
                fontSize: '0.78rem', fontWeight: tab.active ? 700 : 500,
                color: tab.active ? 'var(--accent)' : 'var(--text-muted)',
                cursor: tab.active ? 'default' : 'pointer',
                fontFamily: 'var(--font-body)', transition: 'all 0.25s ease', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { if (!tab.active) { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; } }}
              onMouseLeave={e => { if (!tab.active) { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'none'; } }}
            >{tab.label}</button>
          ))}
        </div>

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

      {/* ═══ CONTENT ═══ */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem', position: 'relative', zIndex: 1 }}>

        {/* Header */}
        <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{
              fontFamily: 'var(--font-display)', fontSize: '1.85rem', fontWeight: 700, margin: 0,
              background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--accent) 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>Conversation History</h1>
            <p className="mobile-hide" style={{ color: 'var(--text-secondary)', marginTop: 6, fontSize: '0.875rem' }}>
              {totalThreads > 0
                ? `${totalThreads} conversation${totalThreads !== 1 ? 's' : ''} across ${workplaceGroups.length} workplace${workplaceGroups.length !== 1 ? 's' : ''}`
                : 'Your past conversations will appear here'}
            </p>
          </div>
          {totalThreads > 0 && (
            <button className="btn-primary mobile-full-width" onClick={() => router.push('/chat')}>
              + New Conversation
            </button>
          )}
        </div>

        {/* Loading */}
        {loadingHistory ? (
          <div style={{ textAlign: 'center', paddingTop: '4rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <div className="pulse-dot" />
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>Loading threads...</p>
          </div>

        /* Empty state */
        ) : totalThreads === 0 ? (
          <div className="animate-slide-up" style={{ textAlign: 'center', paddingTop: '4rem', maxWidth: 480, margin: '0 auto' }}>
            <div style={{
              width: 80, height: 80, margin: '0 auto 1.5rem',
              borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(240, 180, 41, 0.08)',
              border: '1px solid rgba(240, 180, 41, 0.15)',
              boxShadow: '0 0 40px rgba(240,180,41,0.06), inset 0 1px 0 0 rgba(255,255,255,0.06)',
            }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h2 style={{
              fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700,
              color: 'var(--text-primary)', margin: '0 0 8px',
            }}>No conversations yet</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: '0 0 2rem', lineHeight: 1.6 }}>
              Open a workplace, connect your data, and start chatting. Every conversation is saved here grouped by workplace.
            </p>
            <button className="btn-primary" onClick={() => router.push('/workplaces')}>
              Go to Workplaces
            </button>
          </div>

        /* Grouped thread list */
        ) : (
          <div style={{ maxWidth: 640, margin: '0 auto' }}>

            {/* Workplace groups */}
            {workplaceGroups.map((group, gIdx) => (
              <div key={group.id} className="animate-fade-in" style={{
                marginBottom: '2rem',
                animationDelay: `${gIdx * 0.08}s`,
                animationFillMode: 'backwards',
              }}>
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(group.id)}
                  style={{
                    width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '0.5rem 0', marginBottom: '0.75rem',
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  {/* Workplace icon */}
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: 'rgba(96, 165, 250, 0.10)',
                    border: '1px solid rgba(96, 165, 250, 0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 0 12px rgba(96,165,250,0.06), inset 0 1px 0 0 rgba(255,255,255,0.06)',
                    flexShrink: 0,
                  }}>
                    <span style={{ fontSize: '1rem' }}>📊</span>
                  </div>

                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={{
                      fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)',
                      fontFamily: 'var(--font-display)',
                    }}>{group.name}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 1 }}>
                      {group.threads.length} conversation{group.threads.length !== 1 ? 's' : ''} · Last active {formatRelTime(group.latestTimestamp)}
                    </div>
                  </div>

                  {/* Chevron */}
                  <svg
                    width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{
                      transition: 'transform 0.25s ease',
                      transform: collapsedGroups.has(group.id) ? 'rotate(-90deg)' : 'rotate(0deg)',
                      opacity: 0.5, flexShrink: 0,
                    }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {/* Thread cards */}
                {!collapsedGroups.has(group.id) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', paddingLeft: 4 }}>
                    {group.threads.map((thread, idx) => renderThread(thread, idx))}
                  </div>
                )}
              </div>
            ))}

            {/* Ungrouped conversations */}
            {ungroupedThreads.length > 0 && (
              <div className="animate-fade-in" style={{ marginBottom: '2rem' }}>
                {workplaceGroups.length > 0 && (
                  <button
                    onClick={() => toggleGroup('__ungrouped')}
                    style={{
                      width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '0.5rem 0', marginBottom: '0.75rem',
                      fontFamily: 'var(--font-body)',
                    }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: 'rgba(240, 180, 41, 0.08)',
                      border: '1px solid rgba(240, 180, 41, 0.12)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 0 12px rgba(240,180,41,0.06), inset 0 1px 0 0 rgba(255,255,255,0.06)',
                      flexShrink: 0,
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                        stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    </div>

                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <div style={{
                        fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)',
                        fontFamily: 'var(--font-display)',
                      }}>General Conversations</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 1 }}>
                        {ungroupedThreads.length} conversation{ungroupedThreads.length !== 1 ? 's' : ''} · Not linked to a workplace
                      </div>
                    </div>

                    <svg
                      width="16" height="16" viewBox="0 0 24 24" fill="none"
                      stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{
                        transition: 'transform 0.25s ease',
                        transform: collapsedGroups.has('__ungrouped') ? 'rotate(-90deg)' : 'rotate(0deg)',
                        opacity: 0.5, flexShrink: 0,
                      }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                )}

                {!collapsedGroups.has('__ungrouped') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', paddingLeft: workplaceGroups.length > 0 ? 4 : 0 }}>
                    {ungroupedThreads.map((thread, idx) => renderThread(thread, idx))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
