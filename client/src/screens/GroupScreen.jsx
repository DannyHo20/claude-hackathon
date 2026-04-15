import React, { useEffect, useState } from 'react';
import { api, getStudent, saveStudent } from '../api.js';
import ConversationThread from '../components/ConversationThread.jsx';
import SubmitScreen from './SubmitScreen.jsx';

export default function GroupScreen() {
  const student = getStudent();
  const [email, setEmail] = useState(student?.email || '');
  const [group, setGroup] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [showSubmit, setShowSubmit] = useState(false);

  const lookup = async (e) => {
    if (e) e.preventDefault();
    setError('');
    if (!email.trim()) return;
    try {
      const data = await api.myGroup(email.trim().toLowerCase());
      setGroup(data.group);
      setLoaded(true);
      if (!student || student.email !== email.trim().toLowerCase()) {
        const name = data.group?.your_name || student?.name || '';
        saveStudent({ email: email.trim().toLowerCase(), name });
      }
    } catch (e) {
      setError(e.message);
      setLoaded(true);
    }
  };

  useEffect(() => {
    if (student?.email) lookup();
  }, []);

  if (!loaded) {
    return (
      <div>
        <div className="screen-header">
          <h1>My Group</h1>
          <p>Enter your email to find your group.</p>
        </div>
        <form onSubmit={lookup} style={{ padding: '0 20px' }}>
          <input
            className="text-input"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@school.edu"
            type="email"
          />
          <button className="btn accent block" type="submit" style={{ marginTop: 12 }}>Find my group</button>
          {error && <div className="notice error">{error}</div>}
        </form>
      </div>
    );
  }

  if (!group) {
    return (
      <div>
        <div className="screen-header">
          <h1>My Group</h1>
        </div>
        <div className="empty-state">
          <h3>Not grouped yet</h3>
          <p>Grouping happens once enough people answer. Check back soon.</p>
          <button className="btn soft" onClick={() => { setLoaded(false); setGroup(null); }} style={{ marginTop: 16 }}>
            Try another email
          </button>
        </div>
      </div>
    );
  }

  if (showSubmit || (group.status === 'complete' && showSubmit)) {
    return <SubmitScreen group={group} onDone={() => setShowSubmit(false)} />;
  }

  if (group.status === 'waiting') {
    const style = { '--topic': group.topic.color };
    return (
      <div style={style}>
        <div className="screen-header">
          <h1>My Group</h1>
        </div>
        <div className="topic-card" style={{ '--topic': group.topic.color }}>
          <h3>{group.group_name}</h3>
          <p className="topic-desc">{group.topic.name}</p>
          <p>Conversation starts soon. You'll get a prompt to begin when it does.</p>
          <div className="members-row">
            {group.members.map((m, i) => (
              <span key={i} className="member-pill">
                <strong>{m.student_name}</strong><em>— {m.role_tag}</em>
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <ConversationThread
      group={group}
      onComplete={() => {}}
      onSubmitOutput={() => setShowSubmit(true)}
    />
  );
}
