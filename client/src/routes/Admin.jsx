import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

const ADMIN_KEY = 'mosaic-admin';

const TOPICS = [
  { slug: 'campus-culture', name: 'Campus culture', color: '#534AB7' },
  { slug: 'academic-life', name: 'Academic life', color: '#0F6E56' },
  { slug: 'money-and-class', name: 'Money and class', color: '#854F0B' },
  { slug: 'tech-and-ai', name: 'Tech and AI', color: '#185FA5' },
  { slug: 'identity-and-belonging', name: 'Identity and belonging', color: '#993556' }
];

function Section({ title, children }) {
  return (
    <div className="admin-section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export default function Admin() {
  const nav = useNavigate();
  const [topics, setTopics] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState({});
  const [messages, setMessages] = useState({});
  const [createRoomResult, setCreateRoomResult] = useState(null);
  const [selectedTopic, setSelectedTopic] = useState('');
  const [profName, setProfName] = useState('Professor');

  const setMsg = (key, msg) => setMessages(prev => ({ ...prev, [key]: msg }));
  const setLoad = (key, v) => setLoading(prev => ({ ...prev, [key]: v }));

  const fetchTopics = async () => {
    try {
      const d = await api.topics();
      setTopics(d.topics || []);
    } catch {}
  };

  const fetchGroups = async () => {
    try {
      const d = await api.adminGroups(ADMIN_KEY);
      setGroups(d.groups || []);
    } catch {}
  };

  useEffect(() => {
    fetchTopics();
    fetchGroups();
  }, []);

  const runAction = async (key, fn) => {
    setLoad(key, true);
    setMsg(key, '');
    try {
      const result = await fn();
      setMsg(key, JSON.stringify(result, null, 2));
      fetchTopics();
      fetchGroups();
    } catch (e) {
      setMsg(key, '❌ ' + e.message);
    } finally {
      setLoad(key, false);
    }
  };

  const createClassroomRoom = async () => {
    if (!selectedTopic) { setMsg('create', 'Select a topic first'); return; }
    const topic = TOPICS.find(t => t.slug === selectedTopic);
    if (!topic) return;
    setLoad('create', true);
    setMsg('create', '');
    try {
      const topicData = topics.find(t => t.slug === selectedTopic);
      const data = await api.createRoom({
        professor_name: profName,
        topic_id: topicData?.id,
        mode: 'classroom'
      });
      setCreateRoomResult(data);
      setMsg('create', `Room created! Code: ${data.room_code}`);
    } catch (e) {
      setMsg('create', '❌ ' + e.message);
    } finally {
      setLoad('create', false);
    }
  };

  return (
    <div className="app-shell">
      <div className="screen-header">
        <button className="back-btn" onClick={() => nav('/')}>← Home</button>
        <h1>Admin</h1>
        <p>Manage Mosaic (online mode + room creation)</p>
      </div>

      {/* Create classroom room */}
      <Section title="Create classroom room">
        <label className="field-label">Professor name</label>
        <input className="text-input" value={profName} onChange={e => setProfName(e.target.value)} style={{ marginBottom: 8 }} />
        <label className="field-label">Topic</label>
        <select className="text-input" value={selectedTopic} onChange={e => setSelectedTopic(e.target.value)} style={{ marginBottom: 12 }}>
          <option value="">Select topic...</option>
          {TOPICS.map(t => <option key={t.slug} value={t.slug}>{t.name}</option>)}
        </select>
        <button className="btn accent" onClick={createClassroomRoom} disabled={loading.create}>
          {loading.create ? 'Creating...' : 'Create room'}
        </button>
        {createRoomResult && (
          <div className="admin-room-result">
            <div className="room-code-display">{createRoomResult.room_code}</div>
            <a href={`/professor/${createRoomResult.room_code}?token=${createRoomResult.professor_token}`} target="_blank" rel="noreferrer">
              Open professor dashboard ↗
            </a>
            <br />
            <a href={`/projector/${createRoomResult.room_code}`} target="_blank" rel="noreferrer">
              Open projector ↗
            </a>
          </div>
        )}
        {messages.create && <pre className="admin-msg">{messages.create}</pre>}
      </Section>

      {/* Online mode grouping */}
      <Section title="Online mode — grouping">
        {topics.map(t => (
          <div key={t.id} className="admin-row" style={{ '--topic': t.color }}>
            <span className="topic-name">{t.name}</span>
            <span className="count">{t.answer_count} answers</span>
            <button
              className="btn soft"
              disabled={loading[`group-${t.slug}`]}
              onClick={() => runAction(`group-${t.slug}`, () => api.adminRunGrouping(t.slug, ADMIN_KEY))}
            >
              {loading[`group-${t.slug}`] ? '...' : 'Group'}
            </button>
          </div>
        ))}
        {Object.entries(messages).filter(([k]) => k.startsWith('group-')).map(([k, v]) => (
          <pre key={k} className="admin-msg">{v}</pre>
        ))}
      </Section>

      <Section title="Online mode — start conversations">
        {topics.map(t => (
          <div key={t.id} className="admin-row">
            <span className="topic-name" style={{ color: t.color }}>{t.name}</span>
            <button
              className="btn soft"
              disabled={loading[`start-${t.slug}`]}
              onClick={() => runAction(`start-${t.slug}`, () => api.adminStartConversations(t.slug, ADMIN_KEY))}
            >
              {loading[`start-${t.slug}`] ? '...' : 'Start'}
            </button>
          </div>
        ))}
      </Section>

      <Section title="Generate next week's questions">
        <button
          className="btn accent"
          disabled={loading.genq}
          onClick={() => runAction('genq', () => api.adminGenerateQuestions(ADMIN_KEY))}
        >
          {loading.genq ? 'Generating...' : 'Generate questions'}
        </button>
        {messages.genq && <pre className="admin-msg">{messages.genq}</pre>}
      </Section>

      {/* Active groups */}
      <Section title={`Online mode groups (${groups.length})`}>
        {groups.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No groups yet.</p>}
        {groups.map(g => (
          <div key={g.id} className="admin-row">
            <div style={{ flex: 1 }}>
              <strong>{g.group_name}</strong>
              <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 8 }}>{g.status}</span>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {g.members?.map(m => m.student_name).join(', ')}
              </div>
            </div>
            <button
              className="btn soft"
              disabled={loading[`adv-${g.id}`]}
              onClick={() => runAction(`adv-${g.id}`, () => api.adminAdvanceStep(g.id, ADMIN_KEY))}
            >
              {loading[`adv-${g.id}`] ? '...' : 'Advance'}
            </button>
          </div>
        ))}
      </Section>

      <div style={{ height: 40 }} />
    </div>
  );
}
