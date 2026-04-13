'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useChat } from '@/hooks/useChat';
import { getSources, suggestQuestions, getSourceSchema, exportResultCsv, getSourceProfile, getSourceRelationships } from '@/lib/api';
import type { DataSource, Message } from '@/lib/types';
import { AddSourceWizard } from '@/components/AddSourceWizard';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';

const CHART_COLORS = ['#F0B429', '#60A5FA', '#FFCE54', '#34d399', '#3B82F6', '#D49B1A'];


const AGENT_COLORS: Record<string, string> = {
  'agent-semantic': '#60A5FA',
  'agent-coder':    '#34d399',
  'agent-critic':   '#F0B429',
  'agent-narrator': '#ff716c',
  'agent-intent':   '#60A5FA',
  'agent-sql':      '#34d399',
  'agent-validator': '#F0B429',
  'agent-insight':  '#ff716c',
  'agent-trust':    '#a78bfa',
  'agent-assumption': '#60A5FA',
};

const formatSQL = (sql: string) => {
  if (!sql) return '';
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|LIMIT|HAVING|LEFT JOIN|RIGHT JOIN|JOIN|SET|VALUES|UPDATE|INSERT INTO|DELETE FROM)\b/gi, '\n$1')
    .replace(/\b(AND|OR)\b/gi, '\n  $1')
    .replace(/,\s*/gi, ',\n  ')
    .trim();
};

const SUGGESTED_QUESTIONS_DEFAULT = [
  'Total revenue trends over the last 6 months',
  'What is the average loan amount by purpose?',
];

function ChatPageInner() {
  const { isAuthenticated, sessionId, username, isLoading, signOut, createNewChat } = useAuth();
  const router = useRouter();
  const {
    messages,
    isLoading: chatLoading,
    sendMessage,
  } = useChat(sessionId || '');



  const [sources, setSources] = useState<DataSource[]>([]);
  const [input, setInput] = useState('');
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>(SUGGESTED_QUESTIONS_DEFAULT);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'reasonings' | 'sources'>('chat');
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [mainTab, setMainTab] = useState<'chat' | 'schema' | 'relationships' | 'datasets' | 'profile' | 'pinned'>('chat');
  const [schemaData, setSchemaData] = useState<Record<string, any>>({});
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [cachedRelationships, setCachedRelationships] = useState<any[]>([]);
  const [relHasRun, setRelHasRun] = useState(false);
  const [relInferring, setRelInferring] = useState(false);
  const [profileData, setProfileData] = useState<Record<string, any>>({});
  const [profileLoading, setProfileLoading] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const searchParams = useSearchParams();
  const scopedSourceId = searchParams.get('source_id');
  const activeSources = scopedSourceId ? sources.filter(s => s.source_id === scopedSourceId) : sources;
  const scopedSource = sources.find(s => s.source_id === scopedSourceId);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push('/auth');
  }, [isAuthenticated, isLoading, router]);

  const fetchSources = async () => {
    if (!sessionId) return;
    try {
      const data = await getSources(sessionId);
      setSources(Array.isArray(data) ? data : data.sources || []);
    } catch (e) { }
  };

  const fetchSchemaForSources = async (srcs: DataSource[]) => {
    if (srcs.length === 0) return;
    setSchemaLoading(true);
    const results: Record<string, any> = {};
    await Promise.all(srcs.map(async (s) => {
      try {
        const schema = await getSourceSchema(s.source_id);
        results[s.source_id] = { source: s, schema };
      } catch (e) { }
    }));
    setSchemaData(results);
    setSchemaLoading(false);
  };

  const scanSource = async (sourceId: string) => {
    setProfileLoading(prev => ({ ...prev, [sourceId]: true }));
    try {
      const data = await getSourceProfile(sourceId);
      setProfileData(prev => ({ ...prev, [sourceId]: data }));
    } catch { /* ignore */ }
    setProfileLoading(prev => ({ ...prev, [sourceId]: false }));
  };

  const prefetchAll = (srcs: DataSource[]) => {
    if (srcs.length === 0) return;
    // Schema
    fetchSchemaForSources(srcs);
    // Relationships
    setRelInferring(true);
    Promise.all(srcs.map(async (s) => {
      try {
        const data = await getSourceRelationships(s.source_id);
        return (data.relationships || []).map((r: any) => ({ ...r, sourceName: s.name, sourceId: s.source_id }));
      } catch { return []; }
    })).then(arrays => {
      setCachedRelationships(arrays.flat());
      setRelInferring(false);
      setRelHasRun(true);
    });
    // Profile
    srcs.forEach(s => {
      setProfileLoading(prev => ({ ...prev, [s.source_id]: true }));
      getSourceProfile(s.source_id)
        .then(data => setProfileData(prev => ({ ...prev, [s.source_id]: data })))
        .catch(() => {})
        .finally(() => setProfileLoading(prev => ({ ...prev, [s.source_id]: false })));
    });
  };

  useEffect(() => {
    fetchSources();
  }, [sessionId]);

  useEffect(() => {
    if (sessionId && sources.length > 0) {
      setIsSuggestionsLoading(true);
      suggestQuestions(sessionId, scopedSourceId || undefined)
        .then(data => {
          if (data.questions && data.questions.length > 0) {
            setSuggestedQuestions(data.questions);
          }
        })
        .catch(() => { })
        .finally(() => setIsSuggestionsLoading(false));
    }
  }, [sessionId, sources.length, scopedSourceId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading]);

  // Prefetch all analytics as soon as sources are available
  const prefetchedSourcesRef = useRef<string>('');
  useEffect(() => {
    const key = activeSources.map(s => s.source_id).join(',');
    if (activeSources.length > 0 && key !== prefetchedSourcesRef.current) {
      prefetchedSourcesRef.current = key;
      prefetchAll(activeSources);
    }
  }, [activeSources.map(s => s.source_id).join(',')]);

  // Fallback: fetch schema if user opens tab before prefetch ran
  useEffect(() => {
    if (mainTab === 'schema' && activeSources.length > 0 && Object.keys(schemaData).length === 0 && !schemaLoading) {
      fetchSchemaForSources(activeSources);
    }
  }, [mainTab, activeSources.length]);

  const handleSend = async () => {
    if (!input.trim() || chatLoading) return;
    const msg = input;
    setInput('');
    await sendMessage(msg, activeSources.map(s => s.source_id));
  };

  const handleFollowup = async (q: string) => {
    if (chatLoading) return;
    await sendMessage(q, activeSources.map(s => s.source_id));
  };

  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-secondary)' }}>
      <div className="pulse-dot" style={{ marginRight: 12 }} />
      Loading...
    </div>
  );

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      {/* Nav */}
      <div style={{ padding: '12px 1.5rem 0', flexShrink: 0 }}>
      <nav className="glass-nav" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 0.625rem 0 1.25rem', height: 50, flexShrink: 0,
        maxWidth: 1200, marginLeft: 'auto', marginRight: 'auto',
      }}>
        {/* Left — Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
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
            { label: 'Workplaces', href: '/workplaces', active: false },
            { label: 'Chat', href: '/chat', active: true },
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
            >{tab.label}{tab.label === 'Workplaces' && sources.length > 0 && (
                <span style={{
                  background: 'var(--accent-dim)', color: 'var(--accent)', borderRadius: 6,
                  padding: '1px 5px', fontSize: '0.65rem', marginLeft: 5, fontWeight: 700,
                }}>{sources.length}</span>
              )}</button>
          ))}
        </div>

        {/* Right — Actions + User */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => createNewChat()}
            className="btn-primary"
            style={{
              padding: '0.3rem 0.875rem', fontSize: '0.73rem',
              borderRadius: 9999,
              display: 'flex', alignItems: 'center', gap: 4,
              boxShadow: '0 2px 12px rgba(240,180,41,0.2)',
            }}
          >
            <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>+</span> New
          </button>
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
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>


        {/* Chat column */}
        <div
          className="chat-main-column"
          style={{
            flex: 1,
            display: (activeTab === 'chat' || mainTab !== 'chat') ? 'flex' : 'none', /* mainTab covers datasets/schema/relationships */
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Main Panel Tab Bar — single glass pill container */}
          <div style={{ flexShrink: 0, padding: '0.6rem 1rem' }}>
            <div style={{
              display: 'flex', alignItems: 'center',
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 999,
              padding: 3,
              boxShadow: '0 2px 16px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)',
              overflowX: 'auto',
            }}>
              {[
              { id: 'chat', label: 'Chat', icon: 'sparkles' },
              { id: 'datasets', label: 'Datasets', icon: 'database' },
              { id: 'schema', label: 'Schema Explorer', icon: 'table' },
              { id: 'relationships', label: 'Relationships', icon: 'git-branch' },
              { id: 'profile', label: 'Data Profile', icon: 'report-analytics' },
              { id: 'pinned', label: 'Pinned', icon: 'pin' },
              ].map(t => {
                const isActive = mainTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setMainTab(t.id as any)}
                    style={{
                      flex: 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '8px 10px',
                      borderRadius: 999,
                      border: 'none',
                      background: isActive
                        ? 'rgba(240,180,41,0.12)'
                        : 'transparent',
                      color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                      fontSize: '0.75rem',
                      fontWeight: isActive ? 700 : 500,
                      cursor: 'pointer',
                      transition: 'all 0.25s cubic-bezier(0.16,1,0.3,1)',
                      fontFamily: 'var(--font-body)',
                      whiteSpace: 'nowrap',
                      boxShadow: isActive
                        ? '0 2px 10px rgba(240,180,41,0.15), inset 0 1px 0 rgba(240,180,41,0.12)'
                        : 'none',
                    }}
                    onMouseEnter={e => {
                      if (!isActive) {
                        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
                        (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isActive) {
                        (e.currentTarget as HTMLElement).style.background = 'transparent';
                        (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
                      }
                    }}
                  >
                    <img
                      src={`https://cdn.jsdelivr.net/npm/@tabler/icons/icons/${t.icon}.svg`}
                      alt={t.id}
                      style={{
                        width: 15, height: 15,
                      filter: isActive
                        ? 'brightness(0) invert(1)'
                        : 'brightness(0) invert(1)',
                        transition: 'filter 0.2s ease',
                      }}
                    />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Schema Explorer Panel */}
          {mainTab === 'schema' && (
            <SchemaExplorer schemaData={schemaData} loading={schemaLoading} sources={activeSources} />
          )}

          {/* Relationships Panel */}
          {mainTab === 'relationships' && (
            <RelationshipViewer sources={activeSources} onCopyStatus={setCopyStatus} cachedRelationships={cachedRelationships} setCachedRelationships={setCachedRelationships} relHasRun={relHasRun} setRelHasRun={setRelHasRun} relInferring={relInferring} setRelInferring={setRelInferring} />
          )}

          {/* Datasets Panel */}
          {mainTab === 'datasets' && (
            <DatasetsPanel sources={sources} sessionId={sessionId} onRefresh={fetchSources} onCopyStatus={setCopyStatus} />
          )}

          {/* Data Profile Panel */}
          {mainTab === 'profile' && (
            <DataProfilePanel sources={activeSources} profileData={profileData} profileLoading={profileLoading} scanSource={scanSource} />
          )}

          {/* Pinned Insights Dashboard */}
          {mainTab === 'pinned' && (
            <PinnedDashboard username={username} />
          )}

          {/* Messages — only shown when on chat tab */}
          {mainTab === 'chat' && <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
            {messages.length === 0 && (
              <div className="animate-slide-up" style={{ maxWidth: 620, margin: '0 auto' }}>
                <div style={{ textAlign: 'center', marginBottom: '2rem', paddingTop: '2rem' }}>
                  <div style={{
                    width: 56, height: 56, margin: '0 auto 16px',
                    background: 'var(--accent-dim)',
                    borderRadius: 16,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    animation: 'float 6s ease-in-out infinite',
                  }}>
                    <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/sparkles.svg" alt="sparkle" style={{ width: 28, height: 28, filter: 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(180deg)' }} />
                  </div>
                  <h2 style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '1.35rem',
                    fontWeight: 700,
                    margin: '0 0 8px',
                    background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--accent) 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}>
                    Ask anything about {scopedSource ? (
                      <span style={{ color: 'var(--accent)' }}>
                        {scopedSource.name} {scopedSource.table_count !== undefined && scopedSource.table_count > 0 && `(${scopedSource.table_count} tables)`}
                      </span>
                    ) : 'your data'}
                  </h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
                    {scopedSource ? `Scoped query mode active for ${scopedSource.db_type.toUpperCase()}` : 'Connect a data source and start with a question'}
                  </p>
                </div>

                {/* Database indicator */}
                <div className="glass-card" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '1rem',
                  marginBottom: '2rem'
                }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Active Context:</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {activeSources.map(s => (
                      <div key={s.source_id} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: 'var(--accent-dim)',
                        padding: '3px 10px', borderRadius: 8, fontSize: '0.75rem'
                      }}>
                        <span style={{ color: 'var(--accent)', fontWeight: 700 }}>[{s.db_type.toUpperCase()}]</span>
                        <span style={{ color: 'var(--text-primary)' }}>
                          {s.name} {s.table_count !== undefined && s.table_count > 0 && `(${s.table_count} ${s.table_count === 1 ? 'table' : 'tables'})`}
                        </span>
                      </div>
                    ))}
                    {activeSources.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>No sources selected</span>}
                  </div>
                </div>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                  Suggested questions:
                  {isSuggestionsLoading && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--accent)' }}>Generating new ideas...</span>
                  )}
                </p>
                {!isSuggestionsLoading && suggestedQuestions.map(q => (
                  <button
                    key={q}
                    onClick={() => setInput(q)}
                    className="glass-card"
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '0.75rem 1.25rem',
                      color: 'var(--text-secondary)', marginBottom: 8, cursor: 'pointer',
                      fontSize: '0.875rem', fontFamily: 'var(--font-body)',
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {messages.map(msg => {
              const userMsgCount = messages.filter(m => m.type === 'user').length;
              return (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  onFollowup={handleFollowup}
                  onCopyStatus={setCopyStatus}
                  allMessages={messages}
                  username={username}
                />
              );
            })}

            {chatLoading && (
              <div className="animate-fade-in" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 12,
                  background: 'var(--accent-dim)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  padding: 7
                }}>
                  <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/sparkles.svg" alt="sparkle" style={{ width: '100%', height: '100%', filter: 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(180deg)' }} />
                </div>
                <div className="glass-card" style={{
                  padding: '1rem',
                  display: 'flex', gap: 8, alignItems: 'center',
                }}>
                  {[0, 0.2, 0.4].map((delay, i) => (
                    <div key={i} style={{
                      width: 7, height: 7, background: 'var(--accent)', borderRadius: '50%',
                      animation: `pulse-dot 1s ease-in-out ${delay}s infinite`,
                    }} />
                  ))}
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginLeft: 4 }}>
                    Analyzing...
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>}

          {/* Input bar — only shown when on chat tab */}
          {mainTab === 'chat' && <div style={{
            padding: '0 1.5rem 1.25rem',
            flexShrink: 0,
            background: 'linear-gradient(to top, rgba(6,19,39,0.95) 0%, transparent 100%)',
            paddingTop: '1.5rem',
          }}>
            <div style={{ maxWidth: 760, margin: '0 auto', width: '100%' }}>

              {/* Outer glass shell */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.035)',
                backdropFilter: 'blur(60px) saturate(1.6)',
                WebkitBackdropFilter: 'blur(60px) saturate(1.6)',
                borderRadius: 22,
                border: '1px solid rgba(255, 255, 255, 0.09)',
                borderTopColor: 'rgba(255, 255, 255, 0.15)',
                boxShadow: '0 -4px 40px rgba(0,0,0,0.25), 0 12px 48px rgba(0,0,0,0.35), inset 0 1px 0 0 rgba(255,255,255,0.08)',
                padding: '10px',
                transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
              }}
                id="chat-input-shell"
              >
                {/* Source pills — inside the shell, above textarea */}
                {sources.length > 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap',
                    padding: '0 6px 8px 8px',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    marginBottom: 8,
                  }}>
                    {sources.length > 1 && (
                      <button
                        onClick={() => router.push('/chat')}
                        style={{
                          background: !scopedSourceId ? 'rgba(240,180,41,0.10)' : 'transparent',
                          border: !scopedSourceId ? '1px solid rgba(240,180,41,0.22)' : '1px solid rgba(255,255,255,0.06)',
                          borderRadius: 9999, padding: '2px 10px', fontSize: '0.65rem', fontWeight: 600,
                          color: !scopedSourceId ? 'var(--accent)' : 'var(--text-muted)',
                          cursor: 'pointer', fontFamily: 'var(--font-body)', transition: 'all 0.2s ease',
                          lineHeight: '20px',
                        }}
                      >All ({sources.length})</button>
                    )}
                    {sources.map(s => {
                      const isActive = scopedSourceId === s.source_id;
                      return (
                        <button
                          key={s.source_id}
                          onClick={() => router.push(`/chat?source_id=${s.source_id}`)}
                          style={{
                            background: isActive ? 'rgba(240,180,41,0.10)' : 'transparent',
                            border: isActive ? '1px solid rgba(240,180,41,0.22)' : '1px solid rgba(255,255,255,0.06)',
                            borderRadius: 9999, padding: '2px 10px', fontSize: '0.65rem', fontWeight: 600,
                            color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                            cursor: 'pointer', fontFamily: 'var(--font-body)', transition: 'all 0.2s ease',
                            display: 'flex', alignItems: 'center', gap: 4, lineHeight: '20px',
                          }}
                          onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.14)'; } }}
                          onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)'; } }}
                        >
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                            background: isActive ? 'var(--accent)' : 'rgba(255,255,255,0.2)',
                          }} />
                          {s.name}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setShowWizard(true)}
                      style={{
                        background: 'none', border: 'none',
                        padding: '2px 6px', fontSize: '0.7rem', fontWeight: 600,
                        color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-body)',
                        transition: 'color 0.2s ease', lineHeight: '20px',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
                    >
                      + Add
                    </button>
                  </div>
                )}

                {/* Textarea row */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, padding: '0 4px 0 8px' }}>
                  <textarea
                    value={input}
                    onChange={e => {
                      setInput(e.target.value);
                      const el = e.target;
                      el.style.height = 'auto';
                      const clamped = Math.min(el.scrollHeight, 220);
                      el.style.height = clamped + 'px';
                      el.style.overflowY = el.scrollHeight > 220 ? 'auto' : 'hidden';
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    onFocus={() => {
                      const shell = document.getElementById('chat-input-shell');
                      if (shell) {
                        shell.style.borderColor = 'rgba(240, 180, 41, 0.25)';
                        shell.style.boxShadow = '0 -4px 40px rgba(0,0,0,0.25), 0 12px 48px rgba(0,0,0,0.35), 0 0 0 1px rgba(240,180,41,0.08), 0 0 32px rgba(240,180,41,0.04), inset 0 1px 0 0 rgba(255,255,255,0.08)';
                      }
                    }}
                    onBlur={() => {
                      const shell = document.getElementById('chat-input-shell');
                      if (shell) {
                        shell.style.borderColor = 'rgba(255, 255, 255, 0.09)';
                        shell.style.boxShadow = '0 -4px 40px rgba(0,0,0,0.25), 0 12px 48px rgba(0,0,0,0.35), inset 0 1px 0 0 rgba(255,255,255,0.08)';
                      }
                    }}
                    placeholder={sources.length > 0 ? 'Ask anything about your data...' : 'Connect a data source first...'}
                    style={{
                      flex: 1,
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-body)',
                      fontSize: '0.925rem',
                      resize: 'none',
                      outline: 'none',
                      height: 36,
                      maxHeight: 220,
                      padding: '4px 0',
                      lineHeight: 1.55,
                      overflowY: 'hidden',
                    }}
                    rows={1}
                  />

                  {/* Send button — circular with arrow */}
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || chatLoading}
                    style={{
                      background: (input.trim() && !chatLoading)
                        ? 'linear-gradient(135deg, #F0B429 0%, #D49B1A 100%)'
                        : 'rgba(255,255,255,0.05)',
                      color: (input.trim() && !chatLoading) ? '#0a0e1a' : 'rgba(255,255,255,0.25)',
                      border: 'none',
                      borderRadius: 14,
                      width: 36,
                      height: 36,
                      minWidth: 36,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: (!input.trim() || chatLoading) ? 'default' : 'pointer',
                      transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                      boxShadow: (input.trim() && !chatLoading) ? '0 4px 20px rgba(240, 180, 41, 0.35)' : 'none',
                      flexShrink: 0,
                      transform: (input.trim() && !chatLoading) ? 'scale(1)' : 'scale(0.92)',
                      opacity: (input.trim() && !chatLoading) ? 1 : 0.6,
                    }}
                    onMouseEnter={e => {
                      if (input.trim() && !chatLoading) {
                        (e.currentTarget as HTMLElement).style.transform = 'scale(1.1)';
                        (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 28px rgba(240, 180, 41, 0.45)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (input.trim() && !chatLoading) {
                        (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                        (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(240, 180, 41, 0.35)';
                      }
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="19" x2="12" y2="5" />
                      <polyline points="5 12 12 5 19 12" />
                    </svg>
                  </button>
                </div>

                {/* Bottom meta row */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 8px 0',
                  marginTop: 4,
                }}>
                  <span style={{ fontSize: '0.625rem', color: 'rgba(255,255,255,0.18)', fontFamily: 'var(--font-body)', letterSpacing: '0.01em' }}>
                    {activeSources.length > 0
                      ? `Querying ${activeSources.length} source${activeSources.length !== 1 ? 's' : ''}`
                      : 'No sources connected'}
                  </span>
                  <span style={{ fontSize: '0.625rem', color: 'rgba(255,255,255,0.15)', fontFamily: 'var(--font-body)' }}>
                    ↵ to send
                  </span>
                </div>
              </div>
            </div>
          </div>}

          {/* Mobile Bottom Tabs */}
          <div className="desktop-hide" style={{
            display: 'flex',
            background: 'rgba(6, 19, 39, 0.9)',
            backdropFilter: 'blur(16px)',
            borderTop: '1px solid var(--glass-border)',
            paddingTop: '0.5rem', gap: 4, justifyContent: 'space-around'
          }}>
            {[
              { id: 'chat', label: 'Chat', icon: 'sparkles' },
              { id: 'sources', label: 'Sources', icon: 'database' }
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as any)}
                style={{
                  flex: 1, background: 'none', border: 'none', padding: '6px',
                  color: activeTab === t.id ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: '0.65rem', fontWeight: 600, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 2, cursor: 'pointer',
                  transition: 'color 0.2s ease',
                }}
              >
                <img src={`https://cdn.jsdelivr.net/npm/@tabler/icons/icons/${t.icon}.svg`} alt={t.id} style={{ width: 18, height: 18, filter: activeTab === t.id ? 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(180deg)' : 'brightness(0.5)' }} />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Global Toast */}
        {copyStatus && (
          <div style={{
            position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
            background: 'var(--gradient-primary)', color: '#0a1530', padding: '8px 20px',
            borderRadius: 12, fontSize: '0.75rem', fontWeight: 700, zIndex: 100,
            boxShadow: '0 8px 32px rgba(240, 180, 41, 0.3)', animation: 'fade-in 0.2s'
          }}>
            {copyStatus}
          </div>
        )}

      </div>

      {/* Add Source Wizard */}
      {showWizard && (
        <AddSourceWizard
          sessionId={sessionId}
          onClose={() => {
            setShowWizard(false);
            fetchSources();
          }}
          onAdded={(newSources) => {
            setShowWizard(false);
            fetchSources();
            // Reset prefetch key so the new sources trigger a fresh prefetch
            prefetchedSourcesRef.current = '';
            if (newSources.length > 0) prefetchAll(newSources);
          }}
        />
      )}
    </div>
  );
}

function ViewSQLSection({ code, explanation, trace, onCopyStatus }: { code: string; explanation?: string; trace?: any[]; onCopyStatus: (s: string | null) => void }) {
  const [open, setOpen] = useState(false);

  let dialect = '';
  if (trace) {
    const coderEntry = trace.find((t: any) => t.agent?.toLowerCase().includes('sql'));
    if (coderEntry?.details?.dialect) dialect = coderEntry.details.dialect;
  }

  const copySQL = () => {
    navigator.clipboard.writeText(code);
    onCopyStatus('SQL copied!');
    setTimeout(() => onCopyStatus(null), 2000);
  };

  return (
    <div
      style={{
        marginBottom: '1rem',
        background: 'linear-gradient(135deg, rgba(96,165,250,0.04) 0%, rgba(52,211,153,0.04) 100%)',
        border: open ? '1.5px solid rgba(96,165,250,0.25)' : '1.5px solid rgba(96,165,250,0.12)',
        borderRadius: 16,
        overflow: 'hidden',
        transition: 'all 0.25s ease',
        boxShadow: open ? '0 4px 24px rgba(96,165,250,0.08), inset 0 1px 0 rgba(255,255,255,0.04)' : '0 2px 8px rgba(0,0,0,0.15)',
      }}
      onMouseEnter={e => { if (!open) (e.currentTarget as HTMLElement).style.borderColor = 'rgba(96,165,250,0.22)'; }}
      onMouseLeave={e => { if (!open) (e.currentTarget as HTMLElement).style.borderColor = 'rgba(96,165,250,0.12)'; }}
    >
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 18px', color: 'var(--text-primary)',
        }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: 10,
          background: 'rgba(96,165,250,0.12)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/code.svg" alt="" style={{ width: 18, height: 18, filter: 'brightness(0) invert(1) sepia(1) saturate(3) hue-rotate(180deg)' }} />
        </div>
        <span style={{ fontSize: '0.9375rem', fontWeight: 700 }}>{open ? 'Hide SQL' : 'View SQL'}</span>
        {dialect && (
          <span style={{
            fontSize: '0.65rem', fontWeight: 700, background: 'rgba(96,165,250,0.15)', color: '#60A5FA',
            borderRadius: 6, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>{dialect}</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)', transition: 'transform 0.2s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▾</span>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid rgba(96,165,250,0.1)', position: 'relative' }}>
          <button
            onClick={copySQL}
            style={{
              position: 'absolute', top: 12, right: 14, zIndex: 2,
              background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)',
              borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
              fontSize: '0.75rem', color: '#60A5FA', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(96,165,250,0.18)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(96,165,250,0.35)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(96,165,250,0.1)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(96,165,250,0.2)'; }}
          >
            <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/copy.svg" alt="" style={{ width: 13, height: 13, filter: 'brightness(0) invert(1) sepia(1) saturate(3) hue-rotate(180deg)' }} />
            Copy SQL
          </button>
          <pre style={{
            margin: 0, padding: '18px 20px', paddingRight: 120,
            fontSize: '0.875rem', lineHeight: 1.75, color: '#34d399',
            fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            background: 'rgba(0,0,0,0.25)', overflowX: 'auto',
          }}>
            {formatSQL(code)}
          </pre>
          {explanation && (
            <div style={{
              padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.05)',
              fontSize: '0.8125rem', color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: 1.65,
            }}>
              {explanation}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg, onFollowup, onCopyStatus, allMessages, username }: {
  msg: Message;
  onFollowup: (q: string) => void;
  onCopyStatus: (s: string | null) => void;
  allMessages?: Message[];
  username?: string;
}) {
  const isUser = msg.type === 'user';
  const r = msg.response;

  if (isUser) {
    return (
      <div
        className="animate-fade-in"
        style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.5rem' }}
      >
        <div style={{
          background: 'linear-gradient(135deg, rgba(240, 180, 41, 0.08) 0%, rgba(96, 165, 250, 0.08) 100%)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(240, 180, 41, 0.2)',
          borderTopColor: 'rgba(240, 180, 41, 0.3)',
          borderRadius: '16px 16px 2px 16px',
          padding: '0.75rem 1.125rem', maxWidth: '70%',
          fontSize: '0.9375rem', color: 'var(--text-primary)',
          transition: 'all 0.3s cubic-bezier(0.16,1,0.3,1)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 0 rgba(240,180,41,0.1)',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.borderColor = 'rgba(240, 180, 41, 0.4)';
          (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 32px rgba(0,0,0,0.3), 0 0 30px rgba(240,180,41,0.08), inset 0 1px 0 0 rgba(240,180,41,0.15)';
          (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.borderColor = 'rgba(240, 180, 41, 0.2)';
          (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 0 rgba(240,180,41,0.1)';
          (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
        }}
        >
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.type === 'error' || !r) {
    return (
      <div className="animate-fade-in" style={{ display: 'flex', gap: 10, marginBottom: '1.5rem' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 12,
          background: 'rgba(255, 113, 108, 0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          padding: 7,
        }}>
          <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/alert-triangle.svg" alt="warning" style={{ width: '100%', height: '100%', filter: 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(-20deg)' }} />
        </div>
        <div style={{
          background: 'rgba(255, 113, 108, 0.06)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 113, 108, 0.2)',
          borderRadius: 12, padding: '0.875rem 1rem',
          color: 'var(--error)', fontSize: '0.875rem',
        }}>
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div
      className="animate-fade-in"
      style={{ display: 'flex', gap: 10, marginBottom: '1.5rem', alignItems: 'flex-start' }}
    >
      <div
        style={{
          width: 36, height: 36, borderRadius: 12,
          background: 'var(--accent-dim)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, padding: 7,
        }}>
        <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/sparkles.svg" alt="sparkle" style={{ width: '100%', height: '100%', filter: 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(180deg)' }} />
      </div>

      <div style={{
        flex: 1,
        background: 'rgba(255, 255, 255, 0.04)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1.5px solid rgba(255,255,255,0.1)',
        borderTopColor: 'rgba(255,255,255,0.18)',
        borderLeftColor: 'rgba(255,255,255,0.14)',
        borderRadius: 16, overflow: 'hidden',
        transition: 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.25), inset 0 1px 0 0 rgba(255,255,255,0.06)',
      }}>


        <div style={{ padding: '1rem' }}>
          {/* Insight narrative */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 6,
            }}>
              <div style={{
                fontSize: '0.6875rem', color: 'var(--accent)',
                fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontFamily: 'var(--font-display)',
              }}>
                INSIGHT
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const storageKey = `dw_pinned_${username || 'default'}`;
                    const existing = JSON.parse(localStorage.getItem(storageKey) || '[]');
                    const alreadyPinned = existing.some((p: any) => p.id === msg.id);
                    if (alreadyPinned) {
                      const updated = existing.filter((p: any) => p.id !== msg.id);
                      localStorage.setItem(storageKey, JSON.stringify(updated));
                      onCopyStatus('Unpinned!');
                    } else {
                      const userMsg = allMessages?.slice().reverse().find(
                        m => m.type === 'user' && new Date(m.timestamp) < new Date(msg.timestamp)
                      );
                      existing.push({
                        id: msg.id,
                        content: r.insight_narrative,
                        query: userMsg?.content || '',
                        confidence: r.confidence_score ?? null,
                        visualization: r.visualization ?? null,
                        execution_result: r.execution_result ?? null,
                        pinnedAt: new Date().toISOString(),
                        sourceNames: [],
                      });
                      localStorage.setItem(storageKey, JSON.stringify(existing));
                      onCopyStatus('Pinned!');
                    }
                    setTimeout(() => onCopyStatus(null), 2000);
                  }}
                  title="Pin insight"
                  style={{
                    background: 'none', border: 'none',
                    color: 'var(--accent)', fontSize: '0.65rem', fontWeight: 600,
                    cursor: 'pointer', padding: '2px 4px', transition: 'opacity 0.2s',
                    display: 'flex', alignItems: 'center', gap: 3,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.7'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                >
                  <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/pin.svg" alt="pin" style={{ width: 12, height: 12, filter: 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(30deg)' }} />
                  Pin
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(r.insight_narrative);
                    onCopyStatus('Insight copied!');
                    setTimeout(() => onCopyStatus(null), 2000);
                  }}
                  style={{
                    background: 'none', border: 'none',
                    color: 'var(--accent)', fontSize: '0.65rem', fontWeight: 600,
                    cursor: 'pointer', padding: '2px 4px', transition: 'opacity 0.2s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.7'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                >
                  Copy
                </button>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: '0.9375rem', lineHeight: 1.6, color: 'var(--text-primary)' }}>
              {r.insight_narrative}
            </p>
          </div>

          {/* Verification badge */}
          {r.is_verified && (
            <div style={{ fontSize: '0.75rem', color: 'var(--success)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ filter: 'drop-shadow(0 0 4px rgba(52, 211, 153, 0.4))' }}>✓</span> Verified
            </div>
          )}

          {/* Chart */}
          {r.execution_result &&
            r.visualization?.chart_type &&
            r.visualization.chart_type !== 'none' &&
            r.visualization.chart_type !== 'table' && (
              <ChartContainer 
                result={r.execution_result} 
                viz={r.visualization} 
                onCopyStatus={onCopyStatus}
              />
            )}

          {/* Data table */}
          {r.execution_result?.rows && r.execution_result.rows.length > 0 && (
            <DataTable result={r.execution_result} />
          )}

          {/* View SQL — SQL Transparency */}
          {r.generated_code && <ViewSQLSection code={r.generated_code} explanation={r.code_explanation} trace={r.trust_trace} onCopyStatus={onCopyStatus} />}

          {/* Follow-up suggestions */}
          {r.suggested_followups && r.suggested_followups.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '1rem' }}>
              {r.suggested_followups.map(q => (
                <button
                  key={q}
                  onClick={() => onFollowup(q)}
                  style={{
                    background: 'rgba(240, 180, 41, 0.06)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 10, padding: '0.35rem 0.875rem',
                    color: 'var(--text-secondary)', cursor: 'pointer',
                    fontSize: '0.8125rem', fontFamily: 'var(--font-body)',
                    transition: 'all 0.25s ease',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--accent)';
                    (e.currentTarget as HTMLElement).style.background = 'rgba(240, 180, 41, 0.1)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
                    (e.currentTarget as HTMLElement).style.background = 'rgba(240, 180, 41, 0.06)';
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Analysis Breakdown — inline per response */}
          {r.trust_trace && r.trust_trace.length > 0 && (
            <AnalysisBreakdown trace={r.trust_trace} confidenceScore={r.confidence_score ?? undefined} />
          )}
        </div>
      </div>
    </div>
  );
}

function ChartContainer({ result, viz, onCopyStatus }: { result: any; viz: any; onCopyStatus: (s: string | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleExport = async (mode: 'copy' | 'download') => {
    if (!containerRef.current) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;

    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const bbox = svg.getBoundingClientRect();
      canvas.width = bbox.width * 2;
      canvas.height = bbox.height * 2;
      ctx.scale(2, 2);

      ctx.fillStyle = '#061327';
      ctx.fillRect(0, 0, bbox.width, bbox.height);

      const svgData = new XMLSerializer().serializeToString(svg);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, bbox.width, bbox.height);
        URL.revokeObjectURL(url);

        if (mode === 'download') {
          const pngUrl = canvas.toDataURL('image/png');
          const link = document.createElement('a');
          link.download = `${viz.title.replace(/\s+/g, '_')}.png`;
          link.href = pngUrl;
          link.click();
        } else {
          canvas.toBlob(async (blob) => {
            if (blob) {
              try {
                const data = [new ClipboardItem({ [blob.type]: blob })];
                await navigator.clipboard.write(data);
                onCopyStatus('Chart copied!');
                setTimeout(() => onCopyStatus(null), 2000);
              } catch (err) {
                console.error('Clipboard error:', err);
              }
            }
          });
        }
      };
      img.src = url;
    } catch (err) {
      console.error('Export error:', err);
    }
  };

  return (
    <div className="glass-card" style={{ marginBottom: '1rem', padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
          {viz.title}
        </p>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => handleExport('copy')}
            title="Copy to Clipboard"
            className="btn-ghost"
            style={{ padding: '4px 8px', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/copy.svg" alt="copy" style={{ width: 14, height: 14, filter: 'brightness(0) invert(0.7)' }} />
            Copy
          </button>
          <button
            onClick={() => handleExport('download')}
            title="Download as PNG"
            className="btn-ghost"
            style={{ padding: '4px 8px', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/download.svg" alt="download" style={{ width: 14, height: 14, filter: 'brightness(0) invert(0.7)' }} />
            Export
          </button>
        </div>
      </div>
      <div ref={containerRef}>
        <ChartRenderer result={result} viz={viz} />
      </div>
    </div>
  );
}

function ChartRenderer({ result, viz }: { result: any; viz: any }) {
  const data = result.rows.slice(0, 50).map((row: any[]) => {
    const obj: Record<string, any> = {};
    result.columns.forEach((col: string, i: number) => { obj[col] = row[i]; });
    return obj;
  });

  const findColumn = (key: string) => {
    if (!key) return key;
    return result.columns.find((c: string) => c.toLowerCase() === key.toLowerCase()) || key;
  };

  const xAxis = findColumn(viz.x_axis);
  const yAxis = findColumn(viz.y_axis);

  const tooltipStyle = {
    background: 'rgba(6, 19, 39, 0.95)',
    backdropFilter: 'blur(12px)',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    color: 'var(--text-primary)',
  };

  const commonProps = {
    data,
    margin: { top: 10, right: 10, left: 0, bottom: 5 },
  };

  if (viz.chart_type === 'bar') return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart {...commonProps}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(106, 118, 140, 0.15)" />
        <XAxis dataKey={xAxis} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey={yAxis} fill="#F0B429" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );

  if (viz.chart_type === 'line') return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart {...commonProps}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(106, 118, 140, 0.15)" />
        <XAxis dataKey={xAxis} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line
          dataKey={yAxis}
          stroke="#F0B429"
          strokeWidth={2}
          dot={{ r: 3, fill: '#F0B429', stroke: '#0a1530', strokeWidth: 2 }}
          activeDot={{ r: 5, fill: '#F0B429', stroke: '#0a1530', strokeWidth: 2, filter: 'drop-shadow(0 0 4px rgba(240, 180, 41, 0.5))' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );

  if (viz.chart_type === 'pie') return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey={yAxis}
          nameKey={xAxis}
          cx="50%"
          cy="50%"
          outerRadius={80}
          label={({ name, percent }: { name: string; percent: number }) =>
            `${name} ${(percent * 100).toFixed(0)}%`
          }
        >
          {data.map((_: any, i: number) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
      </PieChart>
    </ResponsiveContainer>
  );

  if (viz.chart_type === 'scatter') return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart {...commonProps}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(106, 118, 140, 0.15)" />
        <XAxis dataKey={xAxis} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
        <YAxis dataKey={yAxis} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Scatter data={data} fill="#F0B429" />
      </ScatterChart>
    </ResponsiveContainer>
  );

  return null;
}

// Max columns to show before clipping
const MAX_COLS = 8;

function DataTable({ result }: { result: any }) {
  const allCols: string[] = result.columns;
  const rows: any[][] = result.rows;

  const visibleCols = allCols.length > MAX_COLS ? allCols.slice(0, MAX_COLS) : allCols;
  const hiddenCount = allCols.length - visibleCols.length;
  const visibleIndexes = visibleCols.map((_: string, i: number) => i);

  return (
    <div style={{ marginBottom: '1rem', overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {rows.length.toLocaleString()} row{rows.length !== 1 ? 's' : ''}
        </span>
        <button
          className="btn-ghost"
          style={{ padding: '4px 10px', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: 4 }}
          onClick={() => exportResultCsv({ columns: allCols, rows, row_count: rows.length })}
        >
          <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/download.svg" alt="csv" style={{ width: 13, height: 13, filter: 'brightness(0) invert(0.7)' }} />
          Download CSV
        </button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
        <thead>
          <tr>
            {visibleCols.map((col: string) => (
              <th key={col} style={{
                padding: '0.5rem 0.625rem', textAlign: 'left',
                color: 'var(--accent)', fontWeight: 600,
                fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em',
                whiteSpace: 'nowrap',
                borderBottom: '1px solid var(--border-default)',
                fontFamily: 'var(--font-display)',
              }}>
                {col}
              </th>
            ))}
            {hiddenCount > 0 && (
              <th style={{ padding: '0.5rem 0.625rem', color: 'var(--text-muted)', fontSize: '0.75rem', borderBottom: '1px solid var(--border-default)' }}>
                +{hiddenCount} more
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map((row: any[], i: number) => (
            <tr key={i} style={{
              borderBottom: '1px solid var(--border-subtle)',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(240, 180, 41, 0.03)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {visibleIndexes.map((j: number) => {
                const cell = row[j];
                const isNum = typeof cell === 'number';
                return (
                  <td key={j} style={{
                    padding: '0.5rem 0.625rem',
                    color: 'var(--text-secondary)',
                    fontFamily: isNum ? 'var(--font-mono)' : 'var(--font-body)',
                    whiteSpace: 'nowrap',
                  }}>
                    {cell == null
                      ? <span style={{ color: 'var(--text-muted)' }}>—</span>
                      : isNum
                        ? Number(cell).toLocaleString()
                        : String(cell)}
                  </td>
                );
              })}
              {hiddenCount > 0 && <td />}
            </tr>
          ))}
        </tbody>
      </table>
      {(result.truncated || rows.length < result.row_count) && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: 4 }}>
          Showing {rows.slice(0, 10).length} of {result.row_count.toLocaleString()} rows
        </p>
      )}
    </div>
  );
}

// -- Agent colour map --
const AGENT_ACCENT: Record<string, string> = {
  'Intent Parser': '#60A5FA',
  'SQL Generator': '#34d399',
  'Result Validator': '#F0B429',
  'Insight Writer': '#ff716c',
  'Trust Scorer': '#a78bfa',
  'Assumption Checker': '#60A5FA',
};

const AGENT_ICON: Record<string, string> = {
  'Intent Parser': 'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/puzzle.svg',
  'SQL Generator': 'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/code.svg',
  'Result Validator': 'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/shield-check.svg',
  'Insight Writer': 'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/pencil.svg',
  'Trust Scorer': 'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/chart-bar.svg',
  'Assumption Checker': 'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/scale.svg',
};

const AGENT_DISPLAY_NAME: Record<string, string> = {
  'Intent Parser': 'Intent Analysis',
  'SQL Generator': 'SQL Builder',
  'Result Validator': 'Result Validation',
  'Insight Writer': 'Insight Generation',
  'Trust Scorer': 'Trust Assessment',
  'Assumption Checker': 'Risk Audit',
};

const AGENT_SUBTITLE: Record<string, string> = {
  'Intent Parser': 'Parsing intent & mapping metrics',
  'SQL Generator': 'Generating optimised SQL',
  'Result Validator': 'Validating result integrity',
  'Insight Writer': 'Crafting business narrative',
  'Trust Scorer': 'Scoring answer reliability',
  'Assumption Checker': 'Auditing data assumptions',
};

const RISK_COLOR: Record<string, string> = {
  SAFE: 'var(--success)',
  RISKY: 'var(--error)',
  UNKNOWN: 'var(--warning)',
};

function AnalysisBreakdown({ trace, confidenceScore }: { trace: any[]; confidenceScore?: number }) {
  const [open, setOpen] = useState(false);
  const filtered = trace.filter((e: any) => e.agent !== 'Insight Writer' && e.agent !== 'SQL Generator');
  if (filtered.length === 0) return null;

  return (
    <div style={{
      marginTop: '1rem',
      border: '1px solid rgba(240,180,41,0.2)',
      borderRadius: 14,
      overflow: 'hidden',
      background: 'rgba(6,19,39,0.4)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
    }}>
      {/* Header — always visible */}
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '1.125rem 1.375rem',
          background: open ? 'rgba(240,180,41,0.07)' : 'rgba(240,180,41,0.03)',
          border: 'none', cursor: 'pointer', textAlign: 'left',
          transition: 'background 0.2s',
        }}
      >
        <img
          src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/brain.svg"
          alt="brain"
          style={{ width: 22, height: 22, filter: 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(180deg)', flexShrink: 0 }}
        />
        <span style={{ fontSize: '0.9375rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', fontFamily: 'var(--font-display)', flex: 1 }}>
          Analysis Breakdown
        </span>
        {confidenceScore != null && (
          <span style={{
            fontSize: '0.8125rem', fontWeight: 700, fontFamily: 'var(--font-mono)',
            color: confidenceScore >= 80 ? 'var(--success)' : confidenceScore >= 60 ? 'var(--warning)' : 'var(--error)',
            background: confidenceScore >= 80 ? 'rgba(52,211,153,0.12)' : confidenceScore >= 60 ? 'rgba(240,180,41,0.12)' : 'rgba(255,113,108,0.12)',
            borderRadius: 8, padding: '4px 12px', flexShrink: 0,
          }}>
            {confidenceScore}% trust
          </span>
        )}
        <span style={{ color: 'var(--accent)', fontSize: '0.85rem', flexShrink: 0, transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', marginLeft: 4 }}>&#9658;</span>
      </button>

      {/* Expanded card list */}
      {open && (
        <div style={{ padding: '0.75rem 1rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          {filtered.map((entry: any, i: number) => (
            <ThoughtCard key={i} entry={entry} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThoughtCard({ entry, index }: { entry: any; index: number }) {
  const [open, setOpen] = useState(false);
  const accent = AGENT_ACCENT[entry.agent] || 'var(--text-muted)';
  const icon = AGENT_ICON[entry.agent] || 'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/cpu.svg';
  const displayName = AGENT_DISPLAY_NAME[entry.agent] || entry.agent;
  const subtitle = AGENT_SUBTITLE[entry.agent] || entry.action;
  const d = entry.details || {};

  return (
    <div className="animate-fade-in" style={{
      borderRadius: 12,
      border: '1px solid rgba(255,255,255,0.09)',
      background: 'rgba(255,255,255,0.03)',
      overflow: 'hidden',
      animationDelay: `${index * 0.06}s`,
      animationFillMode: 'backwards',
      borderLeft: `4px solid ${accent}`,
    }}>
      {/* Clickable header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0.875rem 1rem',
          background: open ? `${accent}08` : 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background 0.15s',
        }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: `${accent}20`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <img src={icon} alt={displayName} style={{ width: 17, height: 17, filter: 'brightness(0) invert(0.9)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: accent, fontSize: '0.875rem', fontWeight: 700, fontFamily: 'var(--font-display)', lineHeight: 1.2 }}>{displayName}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', flexShrink: 0, transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9658;</span>
      </button>

      {/* Collapsible body */}
      {open && (
        <div style={{ padding: '0 1rem 1rem 1rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>

          {/* -- Intent Analysis (Intent Parser) -- */}
          {entry.agent === 'Intent Parser' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
              <div style={{
                background: 'rgba(240,180,41,0.06)', borderRadius: 8, padding: '0.5rem 0.75rem',
                fontSize: '0.8rem', color: 'var(--text-primary)', fontStyle: 'italic',
                border: '1px solid rgba(240,180,41,0.1)',
              }}>
                &ldquo;{d.intent || entry.output}&rdquo;
              </div>

              {d.sources && d.sources.length > 0 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.6875rem', letterSpacing: '0.04em' }}>SOURCE&nbsp;&nbsp;</span>
                  {d.sources.join(', ')}
                  {d.source_rationale && (
                    <span style={{ color: 'var(--text-muted)' }}> — {d.source_rationale}</span>
                  )}
                </div>
              )}

              {d.metric_mappings && Object.keys(d.metric_mappings).length > 0 && (
                <div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--accent)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    Metric Mappings
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {Object.entries(d.metric_mappings).map(([term, expr]: [string, any]) => (
                      <div key={term} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}>
                        <span style={{ color: accent, fontFamily: 'var(--font-mono)' }}>{term}</span>
                        <span style={{ color: 'var(--text-muted)' }}>→</span>
                        <span style={{ color: 'var(--agent-coder)', fontFamily: 'var(--font-mono)' }}>{String(expr)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {d.assumptions && d.assumptions.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--accent)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    Assumptions
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {d.assumptions.map((a: any, i: number) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.75rem' }}>
                        <span style={{
                          color: RISK_COLOR[a.risk] || 'var(--text-muted)',
                          fontWeight: 700, flexShrink: 0, fontSize: '0.6875rem',
                          background: `${RISK_COLOR[a.risk]}18`,
                          borderRadius: 4, padding: '1px 5px',
                        }}>
                          {a.risk}
                        </span>
                        <span style={{ color: 'var(--text-secondary)' }}>{a.statement}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* -- SQL Builder (SQL Generator) -- */}
          {entry.agent === 'SQL Generator' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8 }}>
              {d.is_retry && d.retry_error && (
                <div style={{
                  background: 'rgba(255,113,108,0.06)', border: '1px solid rgba(255,113,108,0.2)',
                  borderRadius: 8, padding: '0.375rem 0.625rem',
                  fontSize: '0.75rem', color: 'var(--error)',
                }}>
                  » Retry — previous error: {d.retry_error}
                </div>
              )}

              {d.dialect && (
                <div style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--accent)', background: 'var(--accent-dim)', borderRadius: 6, padding: '2px 8px' }}>
                    {d.dialect}
                  </span>
                </div>
              )}

              <div style={{ position: 'relative' }}>
                <div className="code-block" style={{
                  fontSize: '0.75rem',
                  maxHeight: 200, overflow: 'auto',
                  whiteSpace: 'pre', lineHeight: '1.5',
                }}>
                  {formatSQL(entry.output)}
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(entry.output); }}
                  style={{
                    position: 'absolute', top: 6, right: 6,
                    background: 'rgba(6,19,39,0.8)', border: '1px solid var(--border-subtle)',
                    borderRadius: 6, padding: '3px 8px', fontSize: '0.6rem',
                    color: 'var(--accent)', cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent-dim)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(6,19,39,0.8)'; }}
                >
                  Copy
                </button>
              </div>

              {d.explanation && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                  {d.explanation}
                </div>
              )}
            </div>
          )}

          {/* -- Result Validation (Result Validator) -- */}
          {entry.agent === 'Result Validator' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8 }}>
              {d.checks && d.checks.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {d.checks.map((c: any, i: number) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.8rem' }}>
                      <span style={{
                        color: c.pass ? 'var(--success)' : 'var(--error)',
                        flexShrink: 0, fontWeight: 700,
                        filter: c.pass ? 'drop-shadow(0 0 2px rgba(52,211,153,0.5))' : 'drop-shadow(0 0 2px rgba(255,113,108,0.5))',
                      }}>
                        {c.pass ? '✓' : '✗'}
                      </span>
                      <span style={{ color: c.pass ? 'var(--text-secondary)' : 'var(--error)' }}>
                        {c.label}
                        {c.note && (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}> — {c.note}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {d.row_count !== undefined && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {d.row_count.toLocaleString()} row{d.row_count !== 1 ? 's' : ''} · {(d.columns || []).length} column{(d.columns || []).length !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          )}

          {/* -- Trust Assessment (Trust Scorer) -- */}
          {entry.agent === 'Trust Scorer' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 }}>
              {/* Score bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  flex: 1, height: 6, borderRadius: 3,
                  background: 'rgba(255,255,255,0.08)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${d.score ?? 0}%`,
                    borderRadius: 3,
                    background: (d.score ?? 0) >= 80
                      ? 'var(--success)'
                      : (d.score ?? 0) >= 60
                        ? 'var(--warning)'
                        : 'var(--error)',
                    transition: 'width 0.6s ease',
                  }} />
                </div>
                <span style={{
                  fontSize: '0.875rem', fontWeight: 700, fontFamily: 'var(--font-mono)',
                  color: (d.score ?? 0) >= 80
                    ? 'var(--success)'
                    : (d.score ?? 0) >= 60
                      ? 'var(--warning)'
                      : 'var(--error)',
                  flexShrink: 0,
                }}>
                  {d.score ?? 0}%
                </span>
              </div>

              {/* Deductions breakdown */}
              {d.deductions && d.deductions.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    Started at 100 &mdash; Deductions
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {d.deductions.map((ded: any, i: number) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{ded.reason}</span>
                        <span style={{ color: 'var(--error)', fontWeight: 700, fontFamily: 'var(--font-mono)', flexShrink: 0, marginLeft: 8 }}>
                          &minus;{ded.points}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reasoning text */}
              {(d.reasoning || entry.output) && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.55, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 8 }}>
                  {d.reasoning || entry.output}
                </div>
              )}
            </div>
          )}

          {/* -- Risk Audit (Assumption Checker) -- */}
          {entry.agent === 'Assumption Checker' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
              {/* Overall risk badge */}
              {d.overall_risk && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Overall Risk:</span>
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 700,
                    color: d.overall_risk === 'LOW' ? 'var(--success)' : d.overall_risk === 'HIGH' ? 'var(--error)' : 'var(--warning)',
                    background: d.overall_risk === 'LOW' ? 'rgba(52,211,153,0.1)' : d.overall_risk === 'HIGH' ? 'rgba(255,113,108,0.1)' : 'rgba(240,180,41,0.1)',
                    borderRadius: 4, padding: '2px 8px',
                  }}>
                    {d.overall_risk}
                  </span>
                </div>
              )}

              {/* Audited assumptions list */}
              {d.audited_assumptions && d.audited_assumptions.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {d.audited_assumptions.map((a: any, i: number) => (
                    <div key={i} style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderLeft: `3px solid ${a.risk === 'SAFE' ? 'var(--success)' : a.risk === 'RISKY' ? 'var(--error)' : 'var(--warning)'}`,
                      borderRadius: 6, padding: '0.5rem 0.625rem',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
                        <span style={{
                          fontSize: '0.65rem', fontWeight: 700,
                          color: a.risk === 'SAFE' ? 'var(--success)' : a.risk === 'RISKY' ? 'var(--error)' : 'var(--warning)',
                          background: a.risk === 'SAFE' ? 'rgba(52,211,153,0.12)' : a.risk === 'RISKY' ? 'rgba(255,113,108,0.12)' : 'rgba(240,180,41,0.12)',
                          borderRadius: 4, padding: '1px 6px', flexShrink: 0,
                        }}>
                          {a.risk}
                        </span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>{a.statement}</span>
                      </div>
                      {a.audit_note && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>
                          {a.audit_note}
                        </div>
                      )}
                      {a.mitigation && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Mitigation: </span>
                          {a.mitigation}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{entry.output}</div>
              )}
            </div>
          )}

          {/* -- Generic fallback -- */}
          {!['Intent Parser', 'SQL Generator', 'Result Validator', 'Insight Writer', 'Trust Scorer', 'Assumption Checker'].includes(entry.agent) && (
            <div style={{
              fontSize: '0.8rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              paddingTop: 8,
            }}>
              {entry.output}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
// ============================================================
// Datasets Panel
// ============================================================
function DatasetsPanel({ sources, sessionId, onRefresh, onCopyStatus }: {
  sources: DataSource[];
  sessionId: string | null;
  onRefresh: () => void;
  onCopyStatus: (s: string | null) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const DB_TYPE_ICON: Record<string, string> = {
    postgresql: 'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/brand-postgresql.svg',
    mysql:      'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/database.svg',
    sqlite:     'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/database.svg',
    turso:      'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/database.svg',
    csv:        'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/file-spreadsheet.svg',
    excel:      'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/file-spreadsheet.svg',
  };

  const DB_TYPE_COLOR: Record<string, string> = {
    postgresql: '#60A5FA',
    mysql:      '#34d399',
    sqlite:     '#a78bfa',
    turso:      '#a78bfa',
    csv:        '#F0B429',
    excel:      '#34d399',
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !sessionId) return;
    const allowed = Array.from(files).filter(f => /\.(csv|xlsx|xls)$/i.test(f.name));
    if (allowed.length === 0) { setUploadError('Only CSV and Excel files are supported.'); return; }
    setUploading(true);
    setUploadError(null);
    try {
      const { uploadFile } = await import('@/lib/api');
      const res = await uploadFile(allowed, sessionId);
      if (res.error) { setUploadError(res.error); }
      else { onRefresh(); onCopyStatus(`${allowed.length} file(s) uploaded`); setTimeout(() => onCopyStatus(null), 2500); }
    } catch (e) {
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Upload zone */}
      <div style={{ padding: '1.25rem 1.5rem', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? 'var(--accent)' : 'rgba(255,255,255,0.12)'}`,
            borderRadius: 14,
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            background: dragging ? 'rgba(240,180,41,0.05)' : 'rgba(255,255,255,0.02)',
            transition: 'all 0.2s ease',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            multiple
            style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)}
          />
          {uploading ? (
            <>
              <div className="pulse-dot" style={{ width: 10, height: 10 }} />
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Uploading…</span>
            </>
          ) : (
            <>
              <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/cloud-upload.svg" alt="upload" style={{ width: 28, height: 28, filter: dragging ? 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(180deg)' : 'brightness(0) invert(0.4)' }} />
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: dragging ? 'var(--accent)' : 'var(--text-secondary)' }}>
                Drop files here or click to upload
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>CSV, Excel (.xlsx, .xls)</span>
            </>
          )}
        </div>
        {uploadError && (
          <div style={{ marginTop: 8, color: 'var(--error)', fontSize: '0.78rem' }}>{uploadError}</div>
        )}
      </div>

      {/* Connected datasets list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          {sources.length} Connected Dataset{sources.length !== 1 ? 's' : ''}
        </div>

        {sources.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '2rem 0', color: 'var(--text-muted)' }}>
            <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/database-off.svg" alt="no data" style={{ width: 36, height: 36, filter: 'brightness(0) invert(0.3)' }} />
            <p style={{ margin: 0, fontSize: '0.875rem' }}>No datasets connected yet</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {sources.map(s => {
              const color = DB_TYPE_COLOR[s.db_type] || 'var(--text-muted)';
              const icon = DB_TYPE_ICON[s.db_type] || 'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/database.svg';
              return (
                <div key={s.source_id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderLeft: `3px solid ${color}`,
                  borderRadius: 10,
                  padding: '0.75rem 1rem',
                }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                    background: `${color}18`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <img src={icon} alt={s.db_type} style={{ width: 18, height: 18, filter: 'brightness(0) invert(0.8)' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.name}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 8 }}>
                      <span style={{ color, fontWeight: 600 }}>{s.db_type.toUpperCase()}</span>
                      {s.table_count != null && s.table_count > 0 && (
                        <span>{s.table_count} table{s.table_count !== 1 ? 's' : ''}</span>
                      )}
                      {s.connected_at && (
                        <span>{new Date(s.connected_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: s.is_connected ? 'var(--success)' : 'var(--error)' }} />
                    <span style={{ fontSize: '0.65rem', color: s.is_connected ? 'var(--success)' : 'var(--error)', fontWeight: 600 }}>
                      {s.is_connected ? 'Live' : 'Disconnected'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Schema Explorer
// ============================================================
function SchemaExplorer({ schemaData, loading, sources }: { schemaData: Record<string, any>; loading: boolean; sources: DataSource[] }) {
  const [search, setSearch] = useState('');
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [copiedCol, setCopiedCol] = useState<string | null>(null);
  const [glossary, setGlossary] = useState<Record<string, Record<string, Record<string, string>>>>({});
  const [editingDesc, setEditingDesc] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');

  useEffect(() => {
    const loaded: Record<string, Record<string, Record<string, string>>> = {};
    sources.forEach(s => {
      const raw = localStorage.getItem(`dw_glossary_${s.source_id}`);
      if (raw) try { loaded[s.source_id] = JSON.parse(raw); } catch {}
    });
    setGlossary(loaded);
  }, [sources]);

  const saveDesc = (sourceId: string, table: string, col: string, desc: string) => {
    setGlossary(prev => {
      const updated = { ...prev };
      if (!updated[sourceId]) updated[sourceId] = {};
      if (!updated[sourceId][table]) updated[sourceId][table] = {};
      updated[sourceId][table][col] = desc;
      localStorage.setItem(`dw_glossary_${sourceId}`, JSON.stringify(updated[sourceId]));
      return updated;
    });
    setEditingDesc(null);
  };

  const toggleTable = (key: string) => {
    setExpandedTables(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const copyColumn = (colName: string) => {
    navigator.clipboard.writeText(colName);
    setCopiedCol(colName);
    setTimeout(() => setCopiedCol(null), 1500);
  };

  const TYPE_COLOR: Record<string, string> = {
    integer: '#60A5FA', int: '#60A5FA', bigint: '#60A5FA', smallint: '#60A5FA',
    float: '#34d399', double: '#34d399', numeric: '#34d399', decimal: '#34d399', real: '#34d399',
    text: '#F0B429', varchar: '#F0B429', char: '#F0B429', string: '#F0B429',
    boolean: '#ff716c', bool: '#ff716c',
    date: '#a78bfa', datetime: '#a78bfa', timestamp: '#a78bfa', time: '#a78bfa',
  };

  const getTypeColor = (t: string) => TYPE_COLOR[t.toLowerCase().split('(')[0]] || 'var(--text-muted)';

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
      <div className="pulse-dot" style={{ width: 10, height: 10 }} />
      <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading schema...</span>
    </div>
  );

  if (sources.length === 0) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
      <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/database-off.svg" alt="no sources" style={{ width: 40, height: 40, filter: 'brightness(0) invert(0.3)' }} />
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>No data sources connected</p>
    </div>
  );

  const lowerSearch = search.toLowerCase();

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Search bar */}
      <div style={{ padding: '0.75rem 1.5rem', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10, padding: '6px 12px',
        }}>
          <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/search.svg" alt="search" style={{ width: 15, height: 15, filter: 'brightness(0.4)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter columns or tables..."
            style={{
              background: 'none', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: '0.8125rem',
              fontFamily: 'var(--font-body)', width: '100%',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.875rem', padding: 0, lineHeight: 1 }}>
              &times;
            </button>
          )}
        </div>
      </div>

      {/* Schema content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {Object.values(schemaData).map(({ source, schema }: any) => {
          if (!schema || !schema.tables) return null;
          const tables = Object.entries(schema.tables) as [string, any][];
          const filteredTables = tables.filter(([tname, tinfo]) => {
            if (!lowerSearch) return true;
            if (tname.toLowerCase().includes(lowerSearch)) return true;
            return tinfo.columns?.some((c: any) => c.name.toLowerCase().includes(lowerSearch));
          });
          if (filteredTables.length === 0) return null;

          return (
            <div key={source.source_id}>
              {/* Source header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ color: 'var(--accent)', fontSize: '0.7rem', fontWeight: 700, background: 'var(--accent-dim)', padding: '2px 8px', borderRadius: 6 }}>
                  {source.db_type.toUpperCase()}
                </span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.875rem' }}>{source.name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>({filteredTables.length} table{filteredTables.length !== 1 ? 's' : ''})</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filteredTables.map(([tname, tinfo]) => {
                  const tableKey = source.source_id + '.' + tname;
                  const isExpanded = expandedTables[tableKey] !== false; // default expanded
                  const cols: any[] = tinfo.columns || [];
                  const visibleCols = lowerSearch
                    ? cols.filter((c: any) => c.name.toLowerCase().includes(lowerSearch) || tname.toLowerCase().includes(lowerSearch))
                    : cols;

                  return (
                    <div key={tname} style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 10,
                      overflow: 'hidden',
                    }}>
                      {/* Table header */}
                      <button
                        onClick={() => toggleTable(tableKey)}
                        style={{
                          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '8px 12px',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/table.svg" alt="table" style={{ width: 13, height: 13, filter: 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(180deg)', flexShrink: 0 }} />
                        <span style={{ fontWeight: 600, fontSize: '0.8125rem', fontFamily: 'var(--font-mono)' }}>{tname}</span>
                        {tinfo.row_count != null && (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{tinfo.row_count.toLocaleString()} rows</span>
                        )}
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: 'auto' }}>{cols.length} col{cols.length !== 1 ? 's' : ''}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginLeft: 4 }}>{isExpanded ? '\u25BE' : '\u25B8'}</span>
                      </button>

                      {/* Column list */}
                      {isExpanded && (
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                            <thead>
                              <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                                <th style={{ padding: '4px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Column</th>
                                <th style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Type</th>
                                <th style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Description</th>
                                <th style={{ padding: '4px 8px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Flags</th>
                              </tr>
                            </thead>
                            <tbody>
                              {visibleCols.map((col: any) => (
                                <tr
                                  key={col.name}
                                  style={{ borderTop: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', transition: 'background 0.15s' }}
                                  onClick={() => copyColumn(col.name)}
                                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(240,180,41,0.04)'; }}
                                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                  title="Click to copy column name"
                                >
                                  <td style={{ padding: '5px 12px', color: copiedCol === col.name ? 'var(--success)' : 'var(--text-primary)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                    {copiedCol === col.name ? '\u2713 copied' : col.name}
                                  </td>
                                  <td style={{ padding: '5px 8px', color: getTypeColor(col.type || ''), fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{col.type || '?'}</td>
                                  <td style={{ padding: '5px 8px', minWidth: 100, maxWidth: 200 }} onClick={e => e.stopPropagation()}>
                                    {editingDesc === `${source.source_id}.${tname}.${col.name}` ? (
                                      <input
                                        autoFocus
                                        value={editVal}
                                        onChange={e => setEditVal(e.target.value)}
                                        onBlur={() => saveDesc(source.source_id, tname, col.name, editVal)}
                                        onKeyDown={e => { if (e.key === 'Enter') saveDesc(source.source_id, tname, col.name, editVal); if (e.key === 'Escape') setEditingDesc(null); }}
                                        style={{
                                          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(240,180,41,0.3)',
                                          borderRadius: 4, padding: '2px 6px', fontSize: '0.7rem', color: 'var(--text-primary)',
                                          fontFamily: 'var(--font-body)', width: '100%', outline: 'none',
                                        }}
                                      />
                                    ) : (
                                      <span
                                        onClick={() => {
                                          const key = `${source.source_id}.${tname}.${col.name}`;
                                          setEditingDesc(key);
                                          setEditVal(glossary[source.source_id]?.[tname]?.[col.name] || '');
                                        }}
                                        style={{
                                          fontSize: '0.7rem', cursor: 'text', display: 'block', minHeight: 16,
                                          color: glossary[source.source_id]?.[tname]?.[col.name] ? 'var(--text-secondary)' : 'var(--text-muted)',
                                          fontStyle: glossary[source.source_id]?.[tname]?.[col.name] ? 'normal' : 'italic',
                                          opacity: glossary[source.source_id]?.[tname]?.[col.name] ? 1 : 0.5,
                                        }}
                                      >
                                        {glossary[source.source_id]?.[tname]?.[col.name] || 'Add description...'}
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', gap: 3, justifyContent: 'center', flexWrap: 'wrap' }}>
                                      {col.pk && <span style={{ fontSize: '0.6rem', background: 'rgba(240,180,41,0.15)', color: 'var(--accent)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>PK</span>}
                                      {col.fk && <span style={{ fontSize: '0.6rem', background: 'rgba(96,165,250,0.15)', color: '#60A5FA', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }} title={col.fk}>FK</span>}
                                      {col.nullable === false && <span style={{ fontSize: '0.6rem', background: 'rgba(255,113,108,0.12)', color: 'var(--error)', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>NOT NULL</span>}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {Object.keys(schemaData).length === 0 && !loading && (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Schema data not available. Try switching to the Schema Explorer tab when sources are connected.
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ padding: '0.5rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 12, flexWrap: 'wrap', flexShrink: 0 }}>
        {[['PK', 'Primary Key', 'rgba(240,180,41,0.15)', 'var(--accent)'], ['FK', 'Foreign Key', 'rgba(96,165,250,0.15)', '#60A5FA'], ['NOT NULL', 'Required', 'rgba(255,113,108,0.12)', 'var(--error)']].map(([label, desc, bg, color]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: '0.6rem', background: bg, color, borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>{label}</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{desc}</span>
          </div>
        ))}
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>Click any column to copy its name</span>
      </div>
    </div>
  );
}

// ============================================================
// Relationship Viewer
// ============================================================
function RelationshipViewer({ sources, onCopyStatus, cachedRelationships, setCachedRelationships, relHasRun, setRelHasRun, relInferring, setRelInferring }: {
  sources: DataSource[]; onCopyStatus: (s: string | null) => void;
  cachedRelationships: any[]; setCachedRelationships: (r: any[]) => void;
  relHasRun: boolean; setRelHasRun: (v: boolean) => void;
  relInferring: boolean; setRelInferring: (v: boolean) => void;
}) {

  type InferredRel = {
    left_table: string; right_table: string; left_column: string; right_column: string;
    relationship_type: string; confidence_score: number;
    confidence_breakdown: { name_similarity: number; value_overlap: number; cardinality_signal: number; id_pattern_match: number };
    reason: string; sourceName: string; sourceId: string;
  };

  const relationships = cachedRelationships as InferredRel[];

  useEffect(() => {
    // prefetchAll already handles this; only run here if prefetch somehow didn't start
    if (sources.length === 0 || relHasRun || relInferring) return;
    let cancelled = false;
    setRelInferring(true);
    Promise.all(sources.map(async (s) => {
      try {
        const data = await getSourceRelationships(s.source_id);
        return (data.relationships || []).map((r: any) => ({ ...r, sourceName: s.name, sourceId: s.source_id }));
      } catch { return []; }
    })).then(arrays => {
      if (!cancelled) {
        setCachedRelationships(arrays.flat());
        setRelInferring(false);
        setRelHasRun(true);
      }
    });
    return () => { cancelled = true; };
  }, [sources.map(s => s.source_id).join(','), relHasRun, relInferring]);

  const copyJoinSQL = (rel: InferredRel) => {
    const sql = `SELECT *\nFROM ${rel.left_table}\nJOIN ${rel.right_table} ON ${rel.left_table}.${rel.left_column} = ${rel.right_table}.${rel.right_column}`;
    navigator.clipboard.writeText(sql);
    onCopyStatus('JOIN SQL copied!');
    setTimeout(() => onCopyStatus(null), 2000);
  };

  const confidenceColor = (score: number) => score >= 0.7 ? '#34d399' : score >= 0.5 ? '#F0B429' : '#ff716c';
  const confidenceLabel = (score: number) => score >= 0.7 ? 'High' : score >= 0.5 ? 'Medium' : 'Low';

  if (relInferring) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
      <div className="pulse-dot" style={{ width: 10, height: 10 }} />
      <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Analysing relationships across tables...</span>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', opacity: 0.6 }}>Comparing column names, value overlap, and cardinality</span>
    </div>
  );

  if (sources.length === 0) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
      <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/database-off.svg" alt="no sources" style={{ width: 40, height: 40, filter: 'brightness(0) invert(0.3)' }} />
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>No data sources connected</p>
    </div>
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {relationships.length === 0 && relHasRun && (
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12, padding: '1.5rem', textAlign: 'center',
          }}>
            <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/git-branch.svg" alt="no relations" style={{ width: 36, height: 36, filter: 'brightness(0) invert(0.3)', marginBottom: 12 }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0 0 8px' }}>No relationships detected</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', margin: 0 }}>
              The inference engine compared column names, value overlap, and cardinality across all table pairs but found no confident matches. This usually means tables don&apos;t share joinable columns.
            </p>
          </div>
        )}

        {relationships.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.75rem', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {relationships.length} Relationship{relationships.length !== 1 ? 's' : ''} Found
              </span>
            </div>

            {relationships.map((rel, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
                padding: '1rem',
                transition: 'border-color 0.2s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(240,180,41,0.25)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}
              >
                {/* Header badges */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.7rem', background: 'var(--accent-dim)', color: 'var(--accent)', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>
                    {rel.sourceName}
                  </span>
                  <span style={{ fontSize: '0.6rem', borderRadius: 4, padding: '1px 6px', fontWeight: 600, background: 'rgba(96,165,250,0.12)', color: '#60A5FA' }}>
                    {rel.relationship_type.replace(/_/g, ' ').toUpperCase()}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.7rem', fontWeight: 700, color: confidenceColor(rel.confidence_score) }}>
                    {Math.round(rel.confidence_score * 100)}% {confidenceLabel(rel.confidence_score)}
                  </span>
                </div>

                {/* Arrow diagram */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  <div style={{
                    background: 'rgba(240,180,41,0.08)', border: '1px solid rgba(240,180,41,0.2)',
                    borderRadius: 8, padding: '6px 12px',
                    fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-primary)',
                  }}>
                    <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{rel.left_table}</span>
                    <span style={{ color: 'var(--text-muted)' }}>.</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{rel.left_column}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, color: '#60A5FA' }}>
                    <div style={{ width: 20, height: 1, background: '#60A5FA' }} />
                    <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>&rarr;</span>
                  </div>

                  <div style={{
                    background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)',
                    borderRadius: 8, padding: '6px 12px',
                    fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-primary)',
                  }}>
                    <span style={{ color: '#60A5FA', fontWeight: 600 }}>{rel.right_table}</span>
                    <span style={{ color: 'var(--text-muted)' }}>.</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{rel.right_column}</span>
                  </div>
                </div>

                {/* Confidence breakdown bars */}
                {rel.confidence_breakdown && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px',
                    marginBottom: 10, padding: '8px 10px',
                    background: 'rgba(255,255,255,0.02)', borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.05)',
                  }}>
                    {([
                      ['Name similarity', rel.confidence_breakdown.name_similarity],
                      ['Value overlap', rel.confidence_breakdown.value_overlap],
                      ['Cardinality', rel.confidence_breakdown.cardinality_signal],
                      ['ID pattern', rel.confidence_breakdown.id_pattern_match],
                    ] as [string, number][]).map(([label, value]) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', width: 90, flexShrink: 0 }}>{label}</span>
                        <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.round(value * 100)}%`, height: '100%', background: confidenceColor(value), borderRadius: 2, transition: 'width 0.3s' }} />
                        </div>
                        <span style={{ fontSize: '0.6rem', fontWeight: 600, color: confidenceColor(value), width: 28, textAlign: 'right' }}>
                          {Math.round(value * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reason */}
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.5, fontStyle: 'italic' }}>
                  {rel.reason}
                </p>

                {/* JOIN SQL preview */}
                <div style={{
                  background: 'rgba(6,19,39,0.6)', border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 8, padding: '8px 12px',
                  fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)',
                  lineHeight: 1.6, marginBottom: 10,
                }}>
                  <span style={{ color: '#60A5FA' }}>SELECT</span> *{'\n'}
                  <span style={{ color: '#60A5FA' }}>FROM</span> {rel.left_table}{'\n'}
                  <span style={{ color: '#60A5FA' }}>JOIN</span> {rel.right_table}{' '}
                  <span style={{ color: '#60A5FA' }}>ON</span>{' '}
                  {rel.left_table}.{rel.left_column} = {rel.right_table}.{rel.right_column}
                </div>

                <button
                  onClick={() => copyJoinSQL(rel)}
                  className="btn-ghost"
                  style={{ fontSize: '0.7rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/copy.svg" alt="copy" style={{ width: 12, height: 12, filter: 'brightness(0.7)' }} />
                  Copy JOIN SQL
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '0.625rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.7rem' }}>
          Relationships are inferred using 4 signals: column name similarity, value overlap (Jaccard), cardinality analysis, and ID naming patterns.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// Data Profile Panel
// ============================================================
function DataProfilePanel({ sources, profileData, profileLoading, scanSource }: {
  sources: DataSource[];
  profileData: Record<string, any>;
  profileLoading: Record<string, boolean>;
  scanSource: (sourceId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [modalTable, setModalTable] = useState<{ tname: string; tdata: any; grade: string } | null>(null);

  const nullColor = (pct: number) => pct > 20 ? '#ff716c' : pct > 5 ? '#FFCE54' : '#34d399';
  const qualityGrade = (pct: number) => pct >= 95 ? 'A' : pct >= 80 ? 'B' : pct >= 60 ? 'C' : 'D';
  const gradeColor = (g: string) => g === 'A' ? '#34d399' : g === 'B' ? '#60A5FA' : g === 'C' ? '#FFCE54' : '#ff716c';

  if (sources.length === 0) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
      <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/database-off.svg" alt="" style={{ width: 40, height: 40, filter: 'brightness(0) invert(0.3)' }} />
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>No data sources connected</p>
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {sources.map(source => {
        const profile = profileData[source.source_id];
        const isLoading = profileLoading[source.source_id];

        return (
          <div key={source.source_id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden', flexShrink: 0 }}>
            {/* Source header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.875rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ color: 'var(--accent)', fontSize: '0.7rem', fontWeight: 700, background: 'var(--accent-dim)', padding: '2px 8px', borderRadius: 6 }}>
                {source.db_type.toUpperCase()}
              </span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.875rem', flex: 1 }}>{source.name}</span>
              {!profile && (
                <button
                  onClick={() => scanSource(source.source_id)}
                  disabled={isLoading}
                  style={{
                    padding: '8px 22px', fontSize: '0.8125rem', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'rgba(240,180,41,0.10)', border: '1px solid rgba(240,180,41,0.3)',
                    borderRadius: 10, color: 'var(--accent)', cursor: 'pointer',
                    transition: 'all 0.2s ease', fontFamily: 'var(--font-body)',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(240,180,41,0.18)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(240,180,41,0.5)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(240,180,41,0.10)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(240,180,41,0.3)'; }}
                >
                  {isLoading ? (
                    <><div className="pulse-dot" style={{ width: 10, height: 10 }} /> Scanning...</>
                  ) : (
                    <><img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/scan.svg" alt="" style={{ width: 16, height: 16, filter: 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(30deg)' }} /> Scan Data</>
                  )}
                </button>
              )}
              {profile && (
                <button
                  onClick={() => scanSource(source.source_id)}
                  disabled={isLoading}
                  style={{
                    padding: '7px 18px', fontSize: '0.75rem', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer',
                    transition: 'all 0.2s ease', fontFamily: 'var(--font-body)',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.1)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
                >
                  <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/refresh.svg" alt="" style={{ width: 14, height: 14, filter: 'brightness(0) invert(0.6)' }} />
                  {isLoading ? 'Scanning...' : 'Rescan'}
                </button>
              )}
            </div>

            {/* Profile content */}
            {profile && profile.tables && Object.entries(profile.tables).map(([tname, tdata]: [string, any]) => {
              const tKey = source.source_id + '.' + tname;
              const isExp = expanded[tKey] !== false;
              const grade = qualityGrade(tdata.quality?.completeness_pct || 0);

              return (
                <div key={tname} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {/* Table header */}
                  <button
                    onClick={() => setExpanded(prev => ({ ...prev, [tKey]: !isExp }))}
                    style={{
                      width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 1.25rem',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '0.8125rem', fontFamily: 'var(--font-mono)' }}>{tname}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{(tdata.row_count || 0).toLocaleString()} rows</span>
                    <span style={{
                      marginLeft: 'auto', fontSize: '0.65rem', fontWeight: 700,
                      background: gradeColor(grade) + '18', color: gradeColor(grade),
                      padding: '2px 8px', borderRadius: 6,
                    }}>
                      Quality: {grade} ({tdata.quality?.completeness_pct ?? 0}%)
                    </span>
                    {tdata.anomalies?.length > 0 && (
                      <span style={{ fontSize: '0.65rem', fontWeight: 600, background: 'rgba(255,113,108,0.12)', color: '#ff716c', padding: '2px 8px', borderRadius: 6 }}>
                        {tdata.anomalies.length} anomal{tdata.anomalies.length === 1 ? 'y' : 'ies'}
                      </span>
                    )}
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>{isExp ? '\u25BE' : '\u25B8'}</span>
                  </button>

                  {isExp && (
                    <div style={{ padding: '0 1.25rem 1rem' }}>
                      {/* Column Stats Table — scrollable with expand button */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 8 }}>
                        <button
                          onClick={() => setModalTable({ tname, tdata, grade })}
                          style={{
                            padding: '7px 18px', fontSize: '0.75rem', fontWeight: 600,
                            display: 'flex', alignItems: 'center', gap: 6,
                            background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.25)',
                            borderRadius: 8, color: '#60A5FA', cursor: 'pointer',
                            transition: 'all 0.2s ease', fontFamily: 'var(--font-body)',
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(96,165,250,0.16)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(96,165,250,0.45)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(96,165,250,0.08)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(96,165,250,0.25)'; }}
                        >
                          <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/arrows-maximize.svg" alt="" style={{ width: 15, height: 15, filter: 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(180deg)' }} />
                          Expand Table
                        </button>
                      </div>
                      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 280, marginBottom: '1rem', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                          <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                            <tr style={{ background: 'rgba(6,19,39,0.95)' }}>
                              {['Column', 'Type', 'Distinct', 'Nulls', 'Null %', 'Min', 'Max', 'Mean'].map(h => (
                                <th key={h} style={{ padding: '5px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(tdata.columns || {}).map(([cname, cdata]: [string, any]) => (
                              <tr key={cname} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                <td style={{ padding: '5px 10px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{cname}</td>
                                <td style={{ padding: '5px 10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{cdata.type}</td>
                                <td style={{ padding: '5px 10px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{cdata.distinct?.toLocaleString() ?? '—'}</td>
                                <td style={{ padding: '5px 10px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{cdata.nulls?.toLocaleString() ?? '0'}</td>
                                <td style={{ padding: '5px 10px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: nullColor(cdata.null_pct || 0) }}>{cdata.null_pct ?? 0}%</td>
                                <td style={{ padding: '5px 10px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                                  {cdata.min != null ? (typeof cdata.min === 'number' ? cdata.min.toLocaleString() : String(cdata.min)) : '—'}
                                </td>
                                <td style={{ padding: '5px 10px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                                  {cdata.max != null ? (typeof cdata.max === 'number' ? cdata.max.toLocaleString() : String(cdata.max)) : '—'}
                                </td>
                                <td style={{ padding: '5px 10px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                                  {cdata.mean != null ? cdata.mean.toLocaleString() : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Data Quality Summary */}
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '8px 14px', flex: 1, minWidth: 140 }}>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Completeness</div>
                          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: gradeColor(grade), fontFamily: 'var(--font-mono)' }}>
                            {tdata.quality?.completeness_pct ?? 0}%
                          </div>
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '8px 14px', flex: 1, minWidth: 140 }}>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>High-Null Columns</div>
                          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: (tdata.quality?.high_null_columns?.length || 0) > 0 ? '#ff716c' : '#34d399', fontFamily: 'var(--font-mono)' }}>
                            {tdata.quality?.high_null_columns?.length || 0}
                          </div>
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '8px 14px', flex: 1, minWidth: 140 }}>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Total Columns</div>
                          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                            {Object.keys(tdata.columns || {}).length}
                          </div>
                        </div>
                      </div>

                      {/* Anomalies */}
                      {tdata.anomalies && tdata.anomalies.length > 0 && (
                        <div>
                          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#ff716c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/alert-triangle.svg" alt="" style={{ width: 14, height: 14, filter: 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(-20deg)' }} />
                            Anomalies Detected (IQR Method)
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {tdata.anomalies.map((a: any) => (
                              <div key={a.column} style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                background: 'rgba(255,113,108,0.04)', border: '1px solid rgba(255,113,108,0.12)',
                                borderRadius: 8, padding: '8px 12px', fontSize: '0.75rem',
                              }}>
                                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>{a.column}</span>
                                <span style={{ color: '#ff716c', fontWeight: 700 }}>{a.outlier_count} outlier{a.outlier_count !== 1 ? 's' : ''}</span>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: 'auto' }}>
                                  Bounds: [{a.lower_bound?.toLocaleString()}, {a.upper_bound?.toLocaleString()}]
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {(!tdata.anomalies || tdata.anomalies.length === 0) && (
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/circle-check.svg" alt="" style={{ width: 14, height: 14, filter: 'brightness(0) invert(1) sepia(1) saturate(3) hue-rotate(100deg)' }} />
                          No anomalies detected in numeric columns
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {!profile && !isLoading && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                Click <strong style={{ color: 'var(--accent)' }}>Scan Data</strong> to generate a full profile with statistics, quality metrics, and anomaly detection.
              </div>
            )}
          </div>
        );
      })}

      {/* Full-screen modal for expanded table view */}
      {modalTable && (
        <div
          onClick={() => setModalTable(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '2rem',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'rgba(12,25,50,0.97)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 18, width: '95vw', maxWidth: 1100, maxHeight: '90vh',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 60px rgba(240,180,41,0.06)',
            }}
          >
            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '1rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
              <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/table.svg" alt="" style={{ width: 20, height: 20, filter: 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(180deg)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>{modalTable.tname}</span>
              <span style={{
                fontSize: '0.7rem', fontWeight: 700,
                background: gradeColor(modalTable.grade) + '18', color: gradeColor(modalTable.grade),
                padding: '3px 10px', borderRadius: 6,
              }}>
                Quality: {modalTable.grade} ({modalTable.tdata.quality?.completeness_pct ?? 0}%)
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                {(modalTable.tdata.row_count || 0).toLocaleString()} rows &middot; {Object.keys(modalTable.tdata.columns || {}).length} columns
              </span>
              <button
                onClick={() => setModalTable(null)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.25rem', padding: '4px 8px', lineHeight: 1 }}
              >
                &times;
              </button>
            </div>

            {/* Modal body — scrollable */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
              {/* Full stats table */}
              <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr style={{ background: 'rgba(6,19,39,0.98)' }}>
                      {['Column', 'Type', 'Kind', 'Distinct', 'Nulls', 'Null %', 'Min', 'Max', 'Mean'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '2px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(modalTable.tdata.columns || {}).map(([cname, cdata]: [string, any]) => (
                      <tr key={cname} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(240,180,41,0.03)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{cname}</td>
                        <td style={{ padding: '7px 12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{cdata.type}</td>
                        <td style={{ padding: '7px 12px' }}>
                          <span style={{
                            fontSize: '0.65rem', fontWeight: 600, borderRadius: 4, padding: '1px 6px',
                            background: cdata.kind === 'numeric' ? 'rgba(96,165,250,0.12)' : cdata.kind === 'text' ? 'rgba(240,180,41,0.12)' : cdata.kind === 'date' ? 'rgba(167,139,250,0.12)' : 'rgba(255,255,255,0.06)',
                            color: cdata.kind === 'numeric' ? '#60A5FA' : cdata.kind === 'text' ? '#F0B429' : cdata.kind === 'date' ? '#a78bfa' : 'var(--text-muted)',
                          }}>{cdata.kind || 'other'}</span>
                        </td>
                        <td style={{ padding: '7px 12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{cdata.distinct?.toLocaleString() ?? '—'}</td>
                        <td style={{ padding: '7px 12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{cdata.nulls?.toLocaleString() ?? '0'}</td>
                        <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: nullColor(cdata.null_pct || 0) }}>{cdata.null_pct ?? 0}%</td>
                        <td style={{ padding: '7px 12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                          {cdata.min != null ? (typeof cdata.min === 'number' ? cdata.min.toLocaleString() : String(cdata.min)) : '—'}
                        </td>
                        <td style={{ padding: '7px 12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                          {cdata.max != null ? (typeof cdata.max === 'number' ? cdata.max.toLocaleString() : String(cdata.max)) : '—'}
                        </td>
                        <td style={{ padding: '7px 12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          {cdata.mean != null ? cdata.mean.toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Quality + Anomalies in modal */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '12px 18px', flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Completeness</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: gradeColor(modalTable.grade), fontFamily: 'var(--font-mono)' }}>
                    {modalTable.tdata.quality?.completeness_pct ?? 0}%
                  </div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '12px 18px', flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>High-Null Columns</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: (modalTable.tdata.quality?.high_null_columns?.length || 0) > 0 ? '#ff716c' : '#34d399', fontFamily: 'var(--font-mono)' }}>
                    {modalTable.tdata.quality?.high_null_columns?.length || 0}
                  </div>
                  {modalTable.tdata.quality?.high_null_columns?.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                      {modalTable.tdata.quality.high_null_columns.map((c: string) => (
                        <span key={c} style={{ fontSize: '0.65rem', background: 'rgba(255,113,108,0.12)', color: '#ff716c', borderRadius: 4, padding: '2px 6px', fontFamily: 'var(--font-mono)' }}>{c}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '12px 18px', flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Total Columns</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                    {Object.keys(modalTable.tdata.columns || {}).length}
                  </div>
                </div>
              </div>

              {modalTable.tdata.anomalies && modalTable.tdata.anomalies.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#ff716c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/alert-triangle.svg" alt="" style={{ width: 16, height: 16, filter: 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(-20deg)' }} />
                    Anomalies Detected (IQR Method)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {modalTable.tdata.anomalies.map((a: any) => (
                      <div key={a.column} style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        background: 'rgba(255,113,108,0.04)', border: '1px solid rgba(255,113,108,0.12)',
                        borderRadius: 10, padding: '10px 14px', fontSize: '0.8125rem',
                      }}>
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>{a.column}</span>
                        <span style={{ color: '#ff716c', fontWeight: 700 }}>{a.outlier_count} outlier{a.outlier_count !== 1 ? 's' : ''}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Q1: {a.q1?.toLocaleString()} &middot; Q3: {a.q3?.toLocaleString()} &middot; IQR: {a.iqr?.toLocaleString()}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: 'auto' }}>
                          Bounds: [{a.lower_bound?.toLocaleString()}, {a.upper_bound?.toLocaleString()}]
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Pinned Insights Dashboard
// ============================================================
function PinnedDashboard({ username }: { username: string }) {
  const storageKey = `dw_pinned_${username || 'default'}`;
  const [pins, setPins] = useState<any[]>([]);
  const [exporting, setExporting] = useState(false);

  const loadPptxGen = (): Promise<any> => {
    if ((window as any).PptxGenJS) return Promise.resolve((window as any).PptxGenJS);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
      script.onload = () => resolve((window as any).PptxGenJS);
      script.onerror = () => reject(new Error('Failed to load PptxGenJS'));
      document.head.appendChild(script);
    });
  };

  const exportPPTX = async () => {
    if (pins.length === 0 || exporting) return;
    setExporting(true);
    try {
      const PptxGenJS = await loadPptxGen();
      const pres = new PptxGenJS();
      pres.layout = 'LAYOUT_WIDE';
      pres.defineSlideMaster({
        title: 'DARK_BG',
        background: { color: '0F1117' },
      });

      const COLORS = ['F0B429', '60A5FA', 'FFCE54', '34D399', '3B82F6', 'D49B1A'];

      const titleSlide = pres.addSlide({ masterName: 'DARK_BG' });
      titleSlide.addText('YourAnalyst Report', { x: 0.8, y: 1.5, w: 11, fontSize: 36, color: 'F0B429', fontFace: 'Arial', bold: true });
      titleSlide.addText(`${pins.length} Pinned Insight${pins.length !== 1 ? 's' : ''} • Generated ${new Date().toLocaleDateString()}`, { x: 0.8, y: 2.5, w: 11, fontSize: 16, color: 'A0AEC0', fontFace: 'Arial' });

      pins.slice().reverse().forEach((pin: any, idx: number) => {
        const viz = pin.visualization;
        const exec = pin.execution_result;
        const hasChart = exec && viz?.chart_type && viz.chart_type !== 'none' && viz.chart_type !== 'table';
        const hasTable = exec?.rows && exec.rows.length > 0;

        // Slide 1: Narrative + chart
        const slide = pres.addSlide({ masterName: 'DARK_BG' });
        slide.addText(pin.query || 'Insight', { x: 0.6, y: 0.2, w: 11, fontSize: 20, color: 'F0B429', fontFace: 'Arial', bold: true });
        if (pin.confidence != null) {
          const confColor = pin.confidence >= 80 ? '34D399' : pin.confidence >= 60 ? 'FFCE54' : 'FF716C';
          slide.addText(`Confidence: ${pin.confidence}%`, { x: 10.5, y: 0.2, w: 2.5, fontSize: 11, color: confColor, fontFace: 'Arial', bold: true, align: 'right' });
        }

        const narrativeH = hasChart ? 1.8 : 5;
        slide.addText(pin.content || '', { x: 0.6, y: 0.8, w: 12, h: narrativeH, fontSize: 14, color: 'E2E8F0', fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.35 });

        if (hasChart) {
          const xAxis = viz.x_axis || exec.columns?.[0] || '';
          const yAxis = viz.y_axis || exec.columns?.[1] || '';
          const xIdx = exec.columns.indexOf(xAxis);
          const yIdx = exec.columns.indexOf(yAxis);

          if (xIdx >= 0 && yIdx >= 0) {
            const labels = exec.rows.slice(0, 20).map((r: any[]) => String(r[xIdx] ?? ''));
            const values = exec.rows.slice(0, 20).map((r: any[]) => Number(r[yIdx]) || 0);

            const chartType = viz.chart_type === 'line' ? pres.ChartType?.line ?? 'line'
              : viz.chart_type === 'pie' ? pres.ChartType?.pie ?? 'pie'
              : viz.chart_type === 'scatter' ? pres.ChartType?.scatter ?? 'scatter'
              : pres.ChartType?.bar ?? 'bar';

            try {
              slide.addChart(chartType, [{ name: yAxis, labels, values }], {
                x: 0.6, y: 2.8, w: 12, h: 4.2,
                showLegend: false,
                showTitle: false,
                catAxisLabelColor: 'A0AEC0', catAxisLabelFontSize: 9,
                valAxisLabelColor: 'A0AEC0', valAxisLabelFontSize: 9,
                catGridLine: { color: '2D3748', size: 0.5 },
                valGridLine: { color: '2D3748', size: 0.5 },
                chartColors: COLORS,
                dataLabelColor: 'E2E8F0',
              });
            } catch { /* chart type unsupported, skip */ }
          }
        }
        slide.addText(`Insight ${idx + 1} of ${pins.length}`, { x: 0.6, y: 6.9, w: 5, fontSize: 9, color: '718096', fontFace: 'Arial' });

        // Slide 2: Data table (if rows exist)
        if (hasTable) {
          const tableSlide = pres.addSlide({ masterName: 'DARK_BG' });
          tableSlide.addText(`Data: ${pin.query || 'Results'}`, { x: 0.6, y: 0.2, w: 12, fontSize: 16, color: 'F0B429', fontFace: 'Arial', bold: true });

          const cols: string[] = exec.columns;
          const maxCols = Math.min(cols.length, 8);
          const maxRows = Math.min(exec.rows.length, 15);
          const tableW = 12;
          const colW = tableW / maxCols;

          const headerRow = cols.slice(0, maxCols).map((c: string) => ({
            text: c, options: { fontSize: 9, bold: true, color: 'F0B429', fill: { color: '1A202C' }, fontFace: 'Arial', align: 'left' as const },
          }));

          const dataRows = exec.rows.slice(0, maxRows).map((row: any[]) =>
            cols.slice(0, maxCols).map((_, ci: number) => ({
              text: String(row[ci] ?? ''),
              options: { fontSize: 8, color: 'E2E8F0', fill: { color: '0F1117' }, fontFace: 'Arial', align: 'left' as const },
            }))
          );

          const allRows = [headerRow, ...dataRows];
          const colWidths = Array(maxCols).fill(colW);

          tableSlide.addTable(allRows, {
            x: 0.6, y: 0.8, w: tableW, colW: colWidths,
            border: { type: 'solid', pt: 0.5, color: '2D3748' },
            rowH: 0.35,
            autoPage: false,
          });

          const extraInfo: string[] = [];
          if (exec.rows.length > maxRows) extraInfo.push(`Showing ${maxRows} of ${exec.rows.length} rows`);
          if (cols.length > maxCols) extraInfo.push(`${cols.length - maxCols} more columns hidden`);
          if (extraInfo.length > 0) {
            tableSlide.addText(extraInfo.join(' • '), { x: 0.6, y: 6.9, w: 10, fontSize: 9, color: '718096', fontFace: 'Arial' });
          }
          tableSlide.addText(`Insight ${idx + 1} of ${pins.length}`, { x: 10, y: 6.9, w: 3, fontSize: 9, color: '718096', fontFace: 'Arial', align: 'right' });
        }
      });

      await pres.writeFile({ fileName: `YourAnalyst_Report_${new Date().toISOString().slice(0, 10)}.pptx` });
    } catch (err) {
      console.error('PPTX export failed', err);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try { setPins(JSON.parse(stored)); } catch { setPins([]); }
    }
  }, [storageKey]);

  const removePin = (id: string) => {
    const updated = pins.filter(p => p.id !== id);
    setPins(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
  };

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      return `${days}d ago`;
    } catch { return ''; }
  };

  if (pins.length === 0) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
      <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/pin-off.svg" alt="" style={{ width: 44, height: 44, filter: 'brightness(0) invert(0.3)' }} />
      <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem', margin: 0, fontWeight: 500 }}>No pinned insights yet</p>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', margin: 0 }}>Click the <strong style={{ color: 'var(--accent)' }}>Pin</strong> button on any insight to save it here.</p>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{pins.length} pinned insight{pins.length !== 1 ? 's' : ''}</span>
        <button
          onClick={exportPPTX}
          disabled={exporting}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 24px', fontSize: '0.9375rem', fontWeight: 700,
            background: 'linear-gradient(135deg, rgba(240,180,41,0.18) 0%, rgba(240,180,41,0.08) 100%)',
            border: '1.5px solid rgba(240,180,41,0.35)',
            borderRadius: 12, color: 'var(--accent)', cursor: exporting ? 'wait' : 'pointer',
            opacity: exporting ? 0.6 : 1, transition: 'all 0.25s ease',
            boxShadow: '0 2px 12px rgba(240,180,41,0.1), inset 0 1px 0 rgba(255,255,255,0.06)',
            letterSpacing: '0.01em',
          }}
          onMouseEnter={e => { if (!exporting) { (e.currentTarget as HTMLElement).style.background = 'linear-gradient(135deg, rgba(240,180,41,0.28) 0%, rgba(240,180,41,0.14) 100%)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(240,180,41,0.5)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(240,180,41,0.18), inset 0 1px 0 rgba(255,255,255,0.08)'; }}}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'linear-gradient(135deg, rgba(240,180,41,0.18) 0%, rgba(240,180,41,0.08) 100%)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(240,180,41,0.35)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(240,180,41,0.1), inset 0 1px 0 rgba(255,255,255,0.06)'; }}
        >
          <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/file-type-ppt.svg" alt="" style={{ width: 20, height: 20, filter: 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(30deg)' }} />
          {exporting ? 'Generating...' : 'Generate Report (PPTX)'}
        </button>
      </div>

      {pins.slice().reverse().map((pin: any) => (
        <div
          key={pin.id}
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14, overflow: 'hidden',
            transition: 'border-color 0.2s ease',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(240,180,41,0.2)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}
        >
          {/* Question header */}
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/message-question.svg" alt="" style={{ width: 16, height: 16, filter: 'brightness(0) invert(0.5)' }} />
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', flex: 1, fontStyle: 'italic' }}>
              {pin.query || 'Unknown question'}
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatTime(pin.pinnedAt)}</span>
            {pin.confidence != null && (
              <span style={{
                fontSize: '0.65rem', fontWeight: 700, borderRadius: 6, padding: '2px 8px',
                background: pin.confidence >= 80 ? 'rgba(52,211,153,0.12)' : pin.confidence >= 60 ? 'rgba(255,206,84,0.12)' : 'rgba(255,113,108,0.12)',
                color: pin.confidence >= 80 ? '#34d399' : pin.confidence >= 60 ? '#FFCE54' : '#ff716c',
              }}>
                {pin.confidence}%
              </span>
            )}
          </div>

          {/* Narrative */}
          <div style={{ padding: '0.875rem 1rem' }}>
            <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.65, color: 'var(--text-primary)' }}>
              {pin.content}
            </p>
          </div>

          {/* Footer */}
          <div style={{ padding: '0.5rem 1rem', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => removePin(pin.id)}
              className="btn-ghost"
              style={{ padding: '4px 12px', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: 4, color: '#ff716c' }}
            >
              <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/pin-off.svg" alt="" style={{ width: 12, height: 12, filter: 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(-20deg)' }} />
              Unpin
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-secondary)' }}>
        <div className="pulse-dot" style={{ marginRight: 12 }} />
        Loading...
      </div>
    }>
      <ChatPageInner />
    </Suspense>
  );
}
