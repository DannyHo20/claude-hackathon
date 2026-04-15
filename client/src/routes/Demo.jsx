import React, { useEffect, useState, useRef } from 'react';

const BASE = 'http://localhost:3001';

async function demoReq(path, method = 'GET', body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

const THINKING_STAGES = [
  { ms: 0,     text: 'Analyzing 15 student perspectives...' },
  { ms: 3000,  text: 'Scoring stances on AI in education...' },
  { ms: 7000,  text: 'Assembling groups by productive tension...' },
  { ms: 12000, text: 'Writing custom agendas for each group...' },
];

const STATUS_COLORS = {
  waiting:  { bg: '#FEF3C7', text: '#92400E' },
  active:   { bg: '#D1FAE5', text: '#065F46' },
  complete: { bg: '#E0E7FF', text: '#3730A3' },
};

export default function Demo() {
  const [status, setStatus] = useState(null);
  const [running, setRunning] = useState(false);
  const [thinkingText, setThinkingText] = useState('');
  const [log, setLog] = useState([]);
  const thinkingTimers = useRef([]);

  const addLog = (msg) => setLog(prev => [`${new Date().toLocaleTimeString()} — ${msg}`, ...prev.slice(0, 19)]);

  const fetchStatus = async () => {
    try {
      const data = await demoReq('/api/demo/status');
      if (data.demo_mode !== undefined) setStatus(data);
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
    const iv = setInterval(fetchStatus, 3000);
    return () => clearInterval(iv);
  }, []);

  const clearThinkingTimers = () => {
    thinkingTimers.current.forEach(clearTimeout);
    thinkingTimers.current = [];
  };

  const startThinking = () => {
    clearThinkingTimers();
    THINKING_STAGES.forEach(({ ms, text }) => {
      const t = setTimeout(() => setThinkingText(text), ms);
      thinkingTimers.current.push(t);
    });
  };

  const runFull = async () => {
    if (running) return;
    setRunning(true);
    startThinking();
    addLog('Starting: grouping + agenda generation...');
    try {
      const data = await demoReq('/api/demo/run-full', 'POST');
      if (data.error) {
        addLog(`Error: ${data.error}`);
      } else {
        addLog(`Done — ${data.groups_created} groups created`);
      }
    } catch (e) {
      addLog(`Failed: ${e.message}`);
    } finally {
      clearThinkingTimers();
      setThinkingText('');
      setRunning(false);
      fetchStatus();
    }
  };

  const injectMessages = async () => {
    if (!status?.groups?.length) return;
    const activeGroups = status.groups.filter(g => g.status === 'active');
    for (const g of activeGroups) {
      await demoReq('/api/demo/inject-messages', 'POST', { group_id: g.id });
    }
    addLog(`Injected sample messages into ${activeGroups.length} group(s)`);
    fetchStatus();
  };

  const advanceAll = async () => {
    const data = await demoReq('/api/demo/advance-all', 'POST');
    addLog(`Advanced ${data.advanced} group(s) to next step`);
    fetchStatus();
  };

  const completeAll = async () => {
    const data = await demoReq('/api/demo/complete-all', 'POST');
    addLog(`Completed ${data.completed} group(s) — wall submission unlocked`);
    fetchStatus();
  };

  const resetDemo = async () => {
    await demoReq('/api/demo/reset', 'DELETE');
    addLog('Reset — groups and messages wiped, answers intact');
    fetchStatus();
  };

  const hasGroups = status?.groups?.length > 0;
  const hasActive = status?.groups?.some(g => g.status === 'active');
  const allComplete = hasGroups && status.groups.every(g => g.status === 'complete');
  const currentMaxStep = hasGroups
    ? Math.max(...status.groups.map(g => g.current_step || 0))
    : 0;

  return (
    <div style={{ minHeight: '100vh', background: '#0F172A', color: '#F1F5F9', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', padding: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 8px #22C55E', animation: 'pulse 2s infinite' }} />
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px' }}>Mosaic Demo Controls</h1>
        {status && (
          <span style={{ marginLeft: 'auto', fontSize: 13, color: '#94A3B8' }}>
            {status.wall_post_count} wall posts · {status.groups?.length || 0} groups
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, alignItems: 'start' }}>
        {/* Left: Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SectionLabel>Demo Flow</SectionLabel>

          {/* Step 1: Run grouping */}
          <DemoButton
            onClick={runFull}
            disabled={running || hasGroups}
            primary
            label={running ? thinkingText || 'Working...' : '1. Run Grouping + Start'}
            sublabel={hasGroups ? 'Already grouped — reset to re-run' : 'Groups students by productive disagreement'}
            loading={running}
          />

          {/* Step 2: Inject messages */}
          <DemoButton
            onClick={injectMessages}
            disabled={!hasActive}
            label="2. Inject Sample Messages"
            sublabel="Populates group threads with realistic student messages"
          />

          {/* Step 3: Advance */}
          <DemoButton
            onClick={advanceAll}
            disabled={!hasActive || allComplete}
            label={`3. Advance All → Step ${currentMaxStep + 1}`}
            sublabel="Posts next conversation prompt to all active groups"
          />

          {/* Step 4: Complete */}
          <DemoButton
            onClick={completeAll}
            disabled={!hasActive}
            label="4. Complete All Groups"
            sublabel="Unlocks wall submission form for all groups"
          />

          <div style={{ height: 1, background: '#1E293B', margin: '4px 0' }} />

          {/* Reset */}
          <DemoButton
            onClick={resetDemo}
            label="Reset Demo"
            sublabel="Wipes groups & messages — keeps answers intact"
            danger
          />

          {/* Quick links */}
          <SectionLabel>Quick Links</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { label: 'Topics (student view)', href: '/topics' },
              { label: 'My Group (as jordan@test.com)', href: '/group?email=jordan@test.com' },
              { label: 'The Wall', href: '/wall' },
              { label: 'Wall — Live Mode', href: '/wall?live=1' },
            ].map(link => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'block', padding: '8px 12px', background: '#1E293B', borderRadius: 8, color: '#94A3B8', fontSize: 13, textDecoration: 'none' }}
              >
                {link.label} →
              </a>
            ))}
          </div>

          {/* Activity log */}
          {log.length > 0 && (
            <>
              <SectionLabel>Activity Log</SectionLabel>
              <div style={{ background: '#1E293B', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#64748B', lineHeight: 1.6, maxHeight: 140, overflowY: 'auto' }}>
                {log.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            </>
          )}
        </div>

        {/* Right: Live status */}
        <div>
          <SectionLabel>Live Group Status</SectionLabel>
          {!status && <div style={{ color: '#475569', fontSize: 14 }}>Connecting to server...</div>}
          {status && !hasGroups && (
            <div style={{ color: '#475569', fontSize: 14, padding: '16px 0' }}>
              No groups yet. Click "Run Grouping + Start" to begin.
            </div>
          )}
          {status?.groups?.map(g => (
            <GroupCard key={g.id} group={g} />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: '#475569', textTransform: 'uppercase', marginBottom: 2 }}>
      {children}
    </div>
  );
}

function DemoButton({ onClick, disabled, label, sublabel, primary, danger, loading }) {
  const bg = disabled ? '#1E293B' : danger ? '#450A0A' : primary ? '#4F46E5' : '#1E293B';
  const border = disabled ? '#334155' : danger ? '#7F1D1D' : primary ? '#6366F1' : '#334155';
  const textColor = disabled ? '#475569' : danger ? '#FCA5A5' : '#F1F5F9';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 10,
        padding: '12px 14px',
        textAlign: 'left',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.15s',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {loading && (
          <div style={{ width: 14, height: 14, border: '2px solid #6366F1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
        )}
        <span style={{ fontSize: 14, fontWeight: 600, color: textColor }}>{label}</span>
      </div>
      {sublabel && <div style={{ fontSize: 12, color: '#64748B', marginTop: 3 }}>{sublabel}</div>}
    </button>
  );
}

function GroupCard({ group }) {
  const s = STATUS_COLORS[group.status] || { bg: '#1E293B', text: '#94A3B8' };
  return (
    <div style={{ background: '#1E293B', borderRadius: 12, padding: 16, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{group.group_name || 'Unnamed group'}</div>
          {group.central_tension && (
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 2, lineHeight: 1.4 }}>{group.central_tension}</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20, background: s.bg, color: s.text }}>
            {group.status}
          </span>
          {group.current_step > 0 && (
            <span style={{ fontSize: 11, color: '#475569' }}>Step {group.current_step}</span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(group.members || []).map((m, i) => (
          <span key={i} style={{ fontSize: 11, background: '#0F172A', border: '1px solid #334155', borderRadius: 6, padding: '2px 8px', color: '#94A3B8' }}>
            {m.student_name} · <em style={{ color: '#475569' }}>{m.role_tag}</em>
          </span>
        ))}
      </div>
    </div>
  );
}
