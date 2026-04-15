import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function AdminScreen() {
  const [topics, setTopics] = useState([]);
  const [groups, setGroups] = useState([]);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);

  const append = (m) => setLog(l => [`${new Date().toLocaleTimeString()} — ${m}`, ...l].slice(0, 20));

  const load = async () => {
    try {
      const [t, g] = await Promise.all([api.topics(), api.listGroups()]);
      setTopics(t.topics);
      setGroups(g.groups);
    } catch (e) { append('load error: ' + e.message); }
  };

  useEffect(() => { load(); }, []);

  const run = async (fn, label) => {
    setBusy(true);
    try {
      const res = await fn();
      append(`${label}: ${JSON.stringify(res)}`);
      await load();
    } catch (e) {
      append(`${label} FAILED: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <div className="screen-header">
        <h1>Admin</h1>
        <p>Operate the week. No auth — keep this URL private.</p>
      </div>

      <div className="admin-section">
        <h3>Topics — run grouping / start conversations</h3>
        {topics.map(t => (
          <div className="admin-row" key={t.id}>
            <span className="topic-name" style={{ color: t.color }}>{t.name}</span>
            <span className="count">{t.answer_count} answers</span>
            <button className="btn soft" disabled={busy} onClick={() => run(() => api.runGrouping(t.slug), `group ${t.slug}`)}>Group</button>
            <button className="btn soft" disabled={busy} onClick={() => run(() => api.startConversations(t.slug), `start ${t.slug}`)}>Start</button>
          </div>
        ))}
      </div>

      <div className="admin-section">
        <h3>Next week's questions</h3>
        <button className="btn block" disabled={busy} onClick={() => run(() => api.generateQuestions(), 'generate questions')}>
          Generate next week's questions
        </button>
      </div>

      <div className="admin-section">
        <h3>Groups</h3>
        {groups.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No groups yet.</div>}
        {groups.map(g => (
          <div className="admin-row" key={g.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{g.group_name}</strong>
              <span className="count">{g.topic_name} · {g.status}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {g.members.map(m => m.student_name).join(', ')}
            </div>
            <div>
              <button className="btn soft" disabled={busy} onClick={() => run(() => api.advanceStep(g.id), `advance group ${g.id}`)}>
                Force advance step
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="admin-section">
        <h3>Log</h3>
        {log.map((l, i) => <div key={i} style={{ fontSize: 12, fontFamily: 'monospace', padding: '4px 0', borderBottom: '1px solid var(--line)' }}>{l}</div>)}
      </div>

      <div style={{ textAlign: 'center', padding: 20 }}>
        <a href="/" style={{ color: 'var(--text-muted)', fontSize: 13 }}>← back to app</a>
      </div>
    </div>
  );
}
