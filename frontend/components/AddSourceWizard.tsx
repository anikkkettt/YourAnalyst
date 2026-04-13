'use client';

import { useState, useEffect } from 'react';
import { connectSource, testSource, connectDemoSource, uploadFile as uploadFileApi, fetchSampleCreds } from '@/lib/api';
import type { DataSource } from '@/lib/types';
interface AddSourceWizardProps {
  sessionId: string;
  onClose: () => void;
  onAdded: (sources: DataSource[]) => void;
}

export function AddSourceWizard({ sessionId, onClose, onAdded }: AddSourceWizardProps) {
  const [step, setStep] = useState(1);
  const [selectedType, setSelectedType] = useState<string>('');
  const [sqlDialect, setSqlDialect] = useState<string>('postgresql');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [sourceName, setSourceName] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectingDemo, setConnectingDemo] = useState(false);
  const [previews, setPreviews] = useState<any[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [availableTables, setAvailableTables] = useState<string[]>([]);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [effectiveDbType, setEffectiveDbType] = useState('');

  const SOURCE_TYPES = [
    { id: 'sql', label: 'SQL Database', icon: 'https://cdn.jsdelivr.net/npm/@tabler/icons/icons/database.svg' },
    { id: 'csv', label: 'CSV', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/files.svg' },
    { id: 'excel', label: 'Excel', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/microsoftexcel.svg' },
  ];

  const SQL_DIALECTS = [
    { id: 'postgresql', label: 'PostgreSQL', port: '5432' },
    { id: 'mysql', label: 'MySQL', port: '3306' },
  ];

  const resolvedDbType = selectedType === 'sql' ? sqlDialect : selectedType;

  useEffect(() => {
    setConfig({});
    setSourceName('');
    setTestResult(null);
    setAvailableTables([]);
    setSelectedTables([]);
    setSelectedFiles([]);
    setPreviews([]);
    setError('');
    setEffectiveDbType(selectedType === 'sql' ? sqlDialect : selectedType);
  }, [selectedType]);

  useEffect(() => {
    if (selectedType === 'sql') {
      setEffectiveDbType(sqlDialect);
      setConfig({});
      setTestResult(null);
      setError('');
    }
  }, [sqlDialect]);

  const isFileType = selectedType === 'csv' || selectedType === 'excel';

  const handleFindTables = async () => {
    setTesting(true);
    setError('');
    try {
      const result = await testSource(effectiveDbType || resolvedDbType, config);
      setTestResult(result);
      if (result.success) {
        if (result.tables && result.tables.length > 0) {
          setAvailableTables(result.tables);
          setSelectedTables(result.tables);
          setStep(3);
        } else {
          handleConnect();
        }
      } else {
        setError(result.error || 'Connection failed');
      }
    } catch {
      setError('Connection failed');
    }
    setTesting(false);
  };

  const handleConnect = async () => {
    setConnecting(true);
    setConnectingDemo(false);
    setError('');
    try {
      let result;
      if (isFileType && selectedFiles.length > 0) {
        result = await uploadFileApi(selectedFiles, sessionId);
      } else {
        result = await connectSource(
          effectiveDbType || resolvedDbType,
          config,
          sourceName || config.database || 'my_source',
          sessionId,
          selectedTables.length > 0 ? selectedTables : undefined
        );
      }
      if (result.error && (!result.sources || result.sources.length === 0)) {
        setError(result.error);
      } else if (result.sources) {
        // multi-file upload result
        if (result.errors?.length > 0) {
          setError(`${result.errors.length} file(s) failed: ${result.errors.map((e: any) => e.file).join(', ')}`);
        }
        setPreviews(result.sources);
        setStep(4);
      } else {
        // single DB connect result
        setPreviews([result]);
        setStep(4);
      }
    } catch {
      setError('Failed to connect');
    }
    setConnecting(false);
    setConnectingDemo(false);
  };

  const handleConnectDemo = async () => {
    setConnectingDemo(true);
    setError('');
    try {
      if (selectedType === 'csv' || selectedType === 'excel') {
        const result = await connectDemoSource(sessionId, 'excel');
        if (result.error) setError(result.error);
        else { setPreviews([result]); setStep(4); }
      } else {
        const data = await fetchSampleCreds(resolvedDbType);
        if (data.error) {
          setError(data.error);
        } else {
          const dbType = data.db_type || resolvedDbType;
          const creds: Record<string, any> = {};
          if (data.host) creds.host = data.host;
          if (data.port) creds.port = data.port.toString();
          if (data.database) creds.database = data.database;
          if (data.username) creds.username = data.username;
          if (data.password) creds.password = data.password;
          const name = data.source_name || creds.database || 'sample';

          // Update form state so the fields show the filled values
          setSourceName(name);
          setConfig(prev => ({ ...prev, ...creds }));
          if (data.db_type) setEffectiveDbType(data.db_type);

          // Auto-connect using the fetched credentials directly (no state race)
          const testResult = await testSource(dbType, creds);
          if (!testResult.success) {
            setError(testResult.error || 'Connection failed');
          } else if (testResult.tables && testResult.tables.length > 0) {
            setAvailableTables(testResult.tables);
            setSelectedTables(testResult.tables);
            setStep(3);
          } else {
            const connectResult = await connectSource(dbType, creds, name, sessionId);
            if (connectResult.error) setError(connectResult.error);
            else { setPreviews([connectResult]); setStep(4); }
          }
        }
      }
    } catch {
      setError('Failed to load sample data');
    }
    setConnectingDemo(false);
  };

  const handleSave = () => {
    if (previews.length > 0) onAdded(previews);
  };

  const STEP_TITLES: Record<number, { title: string; sub: string }> = {
    1: { title: 'Connect Your Data', sub: 'What kind of source are you working with?' },
    2: { title: isFileType ? 'Upload Files' : 'Enter Credentials', sub: isFileType ? 'Drag and drop or browse for files' : `Connect to your ${SQL_DIALECTS.find(d => d.id === sqlDialect)?.label || 'SQL'} instance` },
    3: { title: 'Select Tables', sub: `${availableTables.length} tables discovered — pick the ones you need` },
    4: { title: 'You\'re All Set', sub: 'Your data source is live and ready to query' },
  };

  const stepInfo = STEP_TITLES[step];

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(3, 14, 32, 0.6)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mobile-modal animate-slide-up" style={{
        width: '100%',
        maxWidth: 500,
        position: 'relative',
        maxHeight: '90vh',
        overflowY: 'auto',
        background: 'rgba(10, 21, 48, 0.6)',
        backdropFilter: 'blur(48px) saturate(1.5)',
        WebkitBackdropFilter: 'blur(48px) saturate(1.5)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderTopColor: 'rgba(255,255,255,0.18)',
        borderRadius: 24,
        boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 0 120px rgba(240,180,41,0.03), inset 0 1px 0 0 rgba(255,255,255,0.08)',
      }}>

        {/* ── Header ── */}
        <div style={{ padding: '1.75rem 2rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              {/* Progress dots */}
              {[1, 2, 3, 4].map(s => (
                <div key={s} style={{
                  width: s === step ? 24 : 8, height: 8, borderRadius: 9999,
                  background: s < step ? 'var(--success)' : s === step ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                  transition: 'all 0.4s cubic-bezier(0.16,1,0.3,1)',
                  boxShadow: s === step ? '0 0 12px rgba(240,180,41,0.4)' : s < step ? '0 0 8px rgba(52,211,153,0.3)' : 'none',
                }} />
              ))}
            </div>
            <h2 style={{
              fontFamily: 'var(--font-display)', fontWeight: 700, margin: 0, fontSize: '1.25rem',
              color: 'var(--text-primary)',
            }}>{stepInfo.title}</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '4px 0 0', lineHeight: 1.4 }}>{stepInfo.sub}</p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 9999, color: 'var(--text-muted)', cursor: 'pointer',
              fontSize: '0.8rem', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s', flexShrink: 0, marginTop: 2,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,113,108,0.12)'; (e.currentTarget as HTMLElement).style.color = 'var(--error)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
          >✕</button>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: '1.5rem 2rem 2rem' }}>

          {/* ═══ STEP 1: Choose type ═══ */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {SOURCE_TYPES.map(t => {
                const active = selectedType === t.id;
                const descriptions: Record<string, string> = {
                  sql: 'PostgreSQL or MySQL',
                  csv: 'Comma-separated value files',
                  excel: 'Excel spreadsheets (.xlsx, .xls)',
                };
                return (
                  <button
                    key={t.id}
                    onClick={() => { setSelectedType(t.id); setStep(2); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      background: active ? 'rgba(240,180,41,0.08)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${active ? 'rgba(240,180,41,0.25)' : 'rgba(255,255,255,0.07)'}`,
                      borderRadius: 14, padding: '1rem 1.25rem',
                      cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.25s cubic-bezier(0.16,1,0.3,1)',
                    }}
                    onMouseEnter={e => {
                      if (!active) {
                        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
                        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(240,180,41,0.2)';
                        (e.currentTarget as HTMLElement).style.transform = 'translateX(4px)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!active) {
                        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
                        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)';
                        (e.currentTarget as HTMLElement).style.transform = 'translateX(0)';
                      }
                    }}
                  >
                    <div style={{
                      width: 40, height: 40, minWidth: 40, borderRadius: 10,
                      background: 'rgba(240,180,41,0.08)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}>
                      <img src={t.icon} alt={t.label} style={{ width: 20, height: 20, objectFit: 'contain', filter: 'brightness(0) invert(1) opacity(0.8)' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{t.label}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{descriptions[t.id]}</div>
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', flexShrink: 0 }}>&#8250;</span>
                  </button>
                );
              })}

            </div>
          )}

          {/* ═══ STEP 2: Configure ═══ */}
          {step === 2 && (
            <div>
              {isFileType ? (
                /* ── File upload ── */
                <div
                  style={{
                    border: `2px dashed ${selectedFiles.length > 0 ? 'rgba(240,180,41,0.3)' : 'rgba(255,255,255,0.12)'}`,
                    borderRadius: 16, textAlign: 'center',
                    padding: selectedFiles.length > 0 ? '1.25rem' : '2.5rem 1.5rem',
                    background: selectedFiles.length > 0 ? 'rgba(240,180,41,0.04)' : 'rgba(255,255,255,0.02)',
                    transition: 'all 0.3s ease', position: 'relative', overflow: 'hidden',
                    marginBottom: '1.25rem',
                  }}
                >
                  <input
                    type="file" accept=".csv,.xlsx,.xls" multiple
                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', zIndex: 10 }}
                    onChange={e => {
                      if (e.target.files && e.target.files.length > 0) {
                        const incoming = Array.from(e.target.files);
                        setSelectedFiles(prev => {
                          const existingNames = new Set(prev.map(f => f.name));
                          return [...prev, ...incoming.filter(f => !existingNames.has(f.name))];
                        });
                      }
                      e.target.value = '';
                    }}
                  />
                  {selectedFiles.length > 0 ? (
                    <div className="animate-fade-in" style={{ position: 'relative', zIndex: 5 }}>
                      <p style={{ color: 'var(--accent)', margin: '0 0 10px', fontSize: '0.875rem', fontWeight: 700 }}>
                        {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} ready
                      </p>
                      <div style={{ maxHeight: 110, overflowY: 'auto', marginBottom: 8 }}>
                        {selectedFiles.map((f, i) => (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '5px 10px', borderRadius: 8, marginBottom: 3,
                            background: 'rgba(255,255,255,0.04)',
                            fontSize: '0.8rem', color: 'var(--text-primary)', textAlign: 'left',
                          }}>
                            <span style={{ fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f.name}</span>
                            <button
                              onClick={e => { e.stopPropagation(); setSelectedFiles(prev => prev.filter((_, idx) => idx !== i)); }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0 0 0 10px', flexShrink: 0, zIndex: 20, position: 'relative' }}
                            >×</button>
                          </div>
                        ))}
                      </div>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', margin: 0 }}>Click or drag to add more</p>
                    </div>
                  ) : (
                    <div style={{ position: 'relative', zIndex: 5 }}>
                      <div style={{ fontSize: '2rem', marginBottom: 8, opacity: 0.4 }}>
                        <img src="https://cdn.jsdelivr.net/npm/@tabler/icons/icons/cloud-upload.svg" alt="" style={{ width: 36, height: 36, filter: 'brightness(0) invert(1)' }} />
                      </div>
                      <p style={{ color: 'var(--text-primary)', margin: '0 0 4px', fontWeight: 600, fontSize: '0.9rem' }}>Drop files here</p>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: 0 }}>or click to browse — .csv, .xlsx, .xls</p>
                    </div>
                  )}
                </div>
              ) : (
                /* ── SQL credentials ── */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
                  {/* Dialect segmented pill */}
                  <div style={{
                    display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center',
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 9999, padding: 3, gap: 2, marginBottom: 4,
                  }}>
                    {SQL_DIALECTS.map(d => {
                      const active = sqlDialect === d.id;
                      return (
                        <button key={d.id} type="button" onClick={() => setSqlDialect(d.id)}
                          style={{
                            background: active ? 'linear-gradient(135deg, rgba(240,180,41,0.18), rgba(240,180,41,0.08))' : 'transparent',
                            border: 'none', borderRadius: 9999, padding: '0.35rem 0.9rem',
                            fontSize: '0.75rem', fontWeight: active ? 700 : 500,
                            color: active ? 'var(--accent)' : 'var(--text-muted)',
                            cursor: 'pointer', fontFamily: 'var(--font-body)',
                            transition: 'all 0.25s ease',
                            boxShadow: active ? '0 2px 10px rgba(240,180,41,0.12)' : 'none',
                          }}
                          onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }}
                          onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
                        >{d.label}</button>
                      );
                    })}
                  </div>

                  {/* Two-column row for Host + Port */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 8 }}>
                    <div>
                      <label style={{ color: 'var(--text-muted)', fontSize: '0.72rem', display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Host</label>
                      <input className="glass-input" placeholder="localhost" value={config.host || ''} onChange={e => setConfig(p => ({ ...p, host: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ color: 'var(--text-muted)', fontSize: '0.72rem', display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Port</label>
                      <input className="glass-input" placeholder={SQL_DIALECTS.find(d => d.id === sqlDialect)?.port || '5432'} value={config.port || ''} onChange={e => setConfig(p => ({ ...p, port: e.target.value }))} />
                    </div>
                  </div>

                  {/* Single fields */}
                  {[
                    { label: 'Database', key: 'database', placeholder: '' },
                    { label: 'Display Name', key: 'source_name', placeholder: 'e.g. Production DB' },
                  ].map(f => (
                    <div key={f.key}>
                      <label style={{ color: 'var(--text-muted)', fontSize: '0.72rem', display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{f.label}</label>
                      <input className="glass-input" placeholder={f.placeholder}
                        value={f.key === 'source_name' ? sourceName : (config[f.key] || '')}
                        onChange={e => f.key === 'source_name' ? setSourceName(e.target.value) : setConfig(p => ({ ...p, [f.key]: e.target.value }))}
                      />
                    </div>
                  ))}

                  {/* Two-column row for Username + Password */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label style={{ color: 'var(--text-muted)', fontSize: '0.72rem', display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Username</label>
                      <input className="glass-input" value={config.username || ''} onChange={e => setConfig(p => ({ ...p, username: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ color: 'var(--text-muted)', fontSize: '0.72rem', display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Password</label>
                      <input className="glass-input" type="password" value={config.password || ''} onChange={e => setConfig(p => ({ ...p, password: e.target.value }))} />
                    </div>
                  </div>
                </div>
              )}

              {/* Sample data link */}
              <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <button
                  onClick={handleConnectDemo} disabled={connecting || connectingDemo}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '3px', fontFamily: 'var(--font-body)', opacity: (connecting || connectingDemo) ? 0.5 : 1 }}
                >{connectingDemo ? 'Loading...' : isFileType ? 'Use sample data instead' :
                  resolvedDbType === 'postgresql' ? 'Try with Supabase sample' :
                  resolvedDbType === 'mysql' ? 'Try with TiDB sample' : 'Try with sample data'}</button>
              </div>

              {/* Error */}
              {(error || (testResult && !testResult.success)) && (
                <div style={{
                  padding: '0.625rem 0.875rem', borderRadius: 12, marginBottom: '1rem',
                  background: 'rgba(255,113,108,0.06)', border: '1px solid rgba(255,113,108,0.2)',
                  fontSize: '0.8rem', color: 'var(--error)', textAlign: 'center',
                }}>{error || testResult?.error}</div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setStep(1)} style={{
                  flex: 0, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12, padding: '0.6rem 1rem', color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: '0.8rem', fontFamily: 'var(--font-body)', transition: 'all 0.2s',
                }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.18)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}
                >Back</button>
                <button
                  className="btn-primary"
                  onClick={isFileType ? handleConnect : handleFindTables}
                  disabled={testing || connecting || (isFileType && selectedFiles.length === 0)}
                  style={{ flex: 1, borderRadius: 12 }}
                >
                  {testing || connecting ? 'Connecting...'
                    : isFileType ? `Upload ${selectedFiles.length || ''} File${selectedFiles.length !== 1 ? 's' : ''}`
                    : 'Connect & Discover Tables'}
                </button>
              </div>
            </div>
          )}

          {/* ═══ STEP 3: Table selection ═══ */}
          {step === 3 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {selectedTables.length} of {availableTables.length} selected
                </span>
                <button
                  onClick={() => setSelectedTables(selectedTables.length === availableTables.length ? [] : [...availableTables])}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}
                >{selectedTables.length === availableTables.length ? 'Clear All' : 'Select All'}</button>
              </div>

              <div style={{
                maxHeight: 280, overflowY: 'auto',
                border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14,
                background: 'rgba(255,255,255,0.02)', padding: 4, marginBottom: '1.25rem',
              }}>
                {availableTables.map(table => {
                  const checked = selectedTables.includes(table);
                  return (
                    <label key={table} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                      cursor: 'pointer', borderRadius: 10, transition: 'background 0.15s', marginBottom: 1,
                      background: checked ? 'rgba(240,180,41,0.06)' : 'transparent',
                    }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                        border: `1.5px solid ${checked ? 'var(--accent)' : 'rgba(255,255,255,0.15)'}`,
                        background: checked ? 'var(--accent)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.2s ease',
                      }}>
                        {checked && <span style={{ color: '#0a1530', fontSize: '0.7rem', fontWeight: 900, lineHeight: 1 }}>&#10003;</span>}
                      </div>
                      <input type="checkbox" checked={checked} onChange={() => setSelectedTables(prev => prev.includes(table) ? prev.filter(t => t !== table) : [...prev, table])} style={{ display: 'none' }} />
                      <span style={{ fontSize: '0.84rem', color: checked ? 'var(--text-primary)' : 'var(--text-secondary)', fontFamily: 'var(--font-mono)', transition: 'color 0.15s' }}>{table}</span>
                    </label>
                  );
                })}
              </div>

              {selectedTables.length === 0 && (
                <p style={{ color: 'var(--error)', fontSize: '0.78rem', textAlign: 'center', margin: '0 0 1rem' }}>Select at least one table to continue</p>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setStep(2)} style={{
                  flex: 0, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12, padding: '0.6rem 1rem', color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: '0.8rem', fontFamily: 'var(--font-body)', transition: 'all 0.2s',
                }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.18)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}
                >Back</button>
                <button
                  className="btn-primary"
                  onClick={handleConnect}
                  disabled={connecting || selectedTables.length === 0}
                  style={{ flex: 1, borderRadius: 12 }}
                >{connecting ? 'Connecting...' : `Import ${selectedTables.length} Table${selectedTables.length !== 1 ? 's' : ''}`}</button>
              </div>
            </div>
          )}

          {/* ═══ STEP 4: Success ═══ */}
          {step === 4 && previews.length > 0 && (
            <div>
              {/* Success banner */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)',
                borderRadius: 14, padding: '1rem 1.25rem', marginBottom: '1.25rem',
              }}>
                <div style={{
                  width: 36, height: 36, minWidth: 36, borderRadius: 10,
                  background: 'rgba(52,211,153,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ color: 'var(--success)', fontSize: '1.1rem', filter: 'drop-shadow(0 0 4px rgba(52,211,153,0.5))' }}>&#10003;</span>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {previews.length === 1 ? 'Source connected' : `${previews.length} sources connected`}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {previews.reduce((sum: number, p: any) => sum + (p.table_count || 0), 0)} tables available for analysis
                  </p>
                </div>
              </div>

              {/* Schema preview */}
              <div style={{
                maxHeight: 200, overflowY: 'auto', marginBottom: '1.5rem',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                {previews.map((preview: any, idx: number) => (
                  <div key={idx} style={{
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 12, padding: '0.75rem 1rem',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{preview.name}</span>
                      <span style={{ fontSize: '0.65rem', color: 'var(--accent)', background: 'var(--accent-dim)', padding: '1px 7px', borderRadius: 5, fontWeight: 700, textTransform: 'uppercase' }}>{preview.db_type || resolvedDbType}</span>
                    </div>
                    {preview.schema?.tables && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {Object.entries(preview.schema.tables).map(([tname, tinfo]: [string, any]) => (
                          <span key={tname} style={{
                            fontSize: '0.72rem', fontFamily: 'var(--font-mono)',
                            color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6,
                            padding: '2px 8px',
                          }}>{tname} <span style={{ color: 'var(--text-muted)' }}>({tinfo.row_count})</span></span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button className="btn-primary" onClick={handleSave} style={{ width: '100%', borderRadius: 12, padding: '0.75rem' }}>
                Done — Start Querying
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
