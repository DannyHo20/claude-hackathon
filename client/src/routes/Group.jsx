import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, getStudent, saveStudent } from '../api.js';
import socket from '../socket.js';

const MAX_MSG = 500;
const MAX_WALL = 280;

function formatTime(isoString) {
  if (!isoString) return '';
  const diff = new Date(isoString) - Date.now();
  if (diff <= 0) return 'now';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function Group() {
  const { code } = useParams(); // undefined for online mode
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const student = getStudent();

  const paramEmail = searchParams.get('email') || '';
  const initialEmail = paramEmail || student?.email || '';

  const [email, setEmail] = useState(initialEmail);
  const [emailInput, setEmailInput] = useState('');
  const [group, setGroup] = useState(null);
  const [loaded, setLoaded] = useState(false); // always fetch on mount
  const [messages, setMessages] = useState([]);
  const [currentStep, setCurrentStep] = useState(null);
  const [nextUnlock, setNextUnlock] = useState(null);
  const [groupStatus, setGroupStatus] = useState('');
  const [msgText, setMsgText] = useState('');
  const [wallText, setWallText] = useState('');
  const [wallFeedback, setWallFeedback] = useState('');
  const [wallSubmitted, setWallSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [submittingWall, setSubmittingWall] = useState(false);
  const [socketStep, setSocketStep] = useState(null); // classroom mode live step
  const bottomRef = useRef(null);

  const fetchGroup = async (emailToUse = email) => {
    if (!emailToUse) return;
    try {
      const data = await api.myGroup(emailToUse, code || undefined);
      if (!data.group) { setLoaded(true); return; }
      setGroup(data.group);
      setMessages(data.group.messages || []);
      setCurrentStep(data.group.current_step);
      setNextUnlock(data.group.next_unlock_at);
      setGroupStatus(data.group.status);
      setLoaded(true);
      if (!student || student.email !== emailToUse) {
        saveStudent({ email: emailToUse, name: data.group.your_name || student?.name || '' });
      }
    } catch (e) {
      setLoaded(true);
    }
  };

  useEffect(() => {
    if (email) fetchGroup(email);
  }, []);

  // Poll every 4s until a group is found (handles tab open before grouping runs)
  useEffect(() => {
    if (!email || group) return;
    const iv = setInterval(() => fetchGroup(email), 4000);
    return () => clearInterval(iv);
  }, [email, !!group]);

  // Socket setup for classroom mode
  useEffect(() => {
    if (!group || !code) return;

    if (!socket.connected) socket.connect();
    socket.emit('join:room', { room_code: code, student_name: student?.name, student_email: email });
    socket.emit('join:group', { group_id: group.id, student_email: email });

    const onGroupMsg = ({ message }) => {
      setMessages(prev => prev.find(m => m.id === message.id) ? prev : [...prev, message]);
    };
    const onStep = (stepData) => {
      setSocketStep(stepData);
      setCurrentStep(stepData);
    };
    const onComplete = () => {
      setGroupStatus('complete');
      fetchGroup();
    };

    socket.on('group:message', onGroupMsg);
    socket.on('room:step', onStep);
    socket.on('room:complete', onComplete);

    return () => {
      socket.off('group:message', onGroupMsg);
      socket.off('room:step', onStep);
      socket.off('room:complete', onComplete);
    };
  }, [group?.id, code]);

  // Online mode: join group socket room for real-time messages
  useEffect(() => {
    if (!group || code) return;
    if (!socket.connected) socket.connect();
    socket.emit('join:group', { group_id: group.id, student_email: email });
    const onGroupMsg = ({ message }) => {
      setMessages(prev => prev.find(m => m.id === message.id) ? prev : [...prev, message]);
    };
    socket.on('group:message', onGroupMsg);
    // In demo mode poll every 5s so 30s step transitions are visible
    const isDemoMode = window.location.hostname === 'localhost' && group.demo_mode;
    const pollMs = isDemoMode ? 5000 : 30000;
    const poll = setInterval(() => {
      api.messages(group.id, email).then(d => {
        setMessages(d.messages || []);
        setCurrentStep(d.current_step);
        setNextUnlock(d.next_unlock_at);
        setGroupStatus(d.status);
      }).catch(() => {});
    }, pollMs);
    return () => {
      socket.off('group:message', onGroupMsg);
      clearInterval(poll);
    };
  }, [group?.id, code]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!msgText.trim() || sending) return;
    setSending(true);
    try {
      await api.sendMessage({
        group_id: group.id,
        student_email: email,
        student_name: student?.name || group.your_name,
        content: msgText.trim()
      });
      setMsgText('');
    } catch (e) {
      alert(e.message);
    } finally {
      setSending(false);
    }
  };

  const submitWall = async () => {
    if (!wallText.trim() || submittingWall) return;
    setSubmittingWall(true);
    setWallFeedback('');
    try {
      const data = await api.submitWall({
        group_id: group.id,
        student_email: email,
        output_text: wallText.trim()
      });
      if (data.needs_revision) {
        setWallFeedback(data.feedback);
      } else {
        setWallSubmitted(true);
      }
    } catch (e) {
      setWallFeedback(e.message);
    } finally {
      setSubmittingWall(false);
    }
  };

  // ---------- Email lookup (online mode, no session) ----------
  if (!loaded && !email) {
    return (
      <div className="app-shell">
        <div className="screen-header">
          <button className="back-btn" onClick={() => nav('/topics')}>← Topics</button>
          <h1>My Group</h1>
          <p>Enter your email to find your group.</p>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); const em = emailInput.trim().toLowerCase(); setEmail(em); saveStudent({ email: em, name: student?.name || '' }); fetchGroup(em); }} style={{ padding: '0 20px' }}>
          <input className="text-input" value={emailInput} onChange={e => setEmailInput(e.target.value)} placeholder="you@school.edu" type="email" />
          <button className="btn accent block" type="submit" style={{ marginTop: 12 }}>Find my group</button>
        </form>
      </div>
    );
  }

  if (!loaded) return <div className="loading">Loading your group...</div>;

  if (!group) {
    return (
      <div className="app-shell">
        <div className="screen-header">
          <button className="back-btn" onClick={() => nav(code ? '/' : '/topics')}>← Back</button>
          <h1>My Group</h1>
        </div>
        <div className="empty-state">
          <h3>Not grouped yet</h3>
          <p>Groups form once enough people answer. Check back soon.</p>
          <button className="btn soft" onClick={() => { setLoaded(false); setGroup(null); setEmail(''); }} style={{ marginTop: 16 }}>
            Try another email
          </button>
        </div>
      </div>
    );
  }

  const topicColor = group.topic?.color || 'var(--accent)';
  const isClassroom = !!group.room_id;
  const isComplete = groupStatus === 'complete';
  const isWaiting = groupStatus === 'waiting';

  // ---------- Waiting state ----------
  if (isWaiting) {
    return (
      <div className="app-shell" style={{ '--topic': topicColor }}>
        <div className="screen-header">
          <h1>Your group</h1>
        </div>
        <div className="group-waiting-card" style={{ borderColor: topicColor }}>
          <h2 style={{ color: topicColor }}>{group.group_name}</h2>
          <p className="group-topic-label">{group.topic.name}</p>
          <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>
            {isClassroom ? 'Waiting for the professor to start the discussion.' : 'Conversation starts soon.'}
          </p>
          <div className="members-row" style={{ marginTop: 16 }}>
            {group.members.map((m, i) => (
              <span key={i} className="member-pill">
                <strong>{m.student_name}</strong><em>— {m.role_tag}</em>
              </span>
            ))}
          </div>
        </div>
        {!isClassroom && (
          <div className="notice" style={{ margin: '12px 20px' }}>
            Your role: <strong>{group.your_role_tag}</strong>
          </div>
        )}
      </div>
    );
  }

  // ---------- Active / complete conversation ----------
  const activeStep = socketStep || currentStep;
  const stepNum = activeStep?.step || 1;
  const totalSteps = group.agenda?.length || 4;
  const progress = (stepNum / totalSteps) * 100;

  return (
    <div className="app-shell group-screen" style={{ '--topic': topicColor }}>
      {/* Compact header */}
      <div className="group-header">
        <div className="group-header-top">
          <h3 style={{ color: topicColor, margin: 0 }}>{group.group_name}</h3>
          <span className="step-badge">Step {stepNum}/{totalSteps}</span>
        </div>
        <div className="progress-bar" style={{ margin: '8px 0' }}>
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        {!isClassroom && nextUnlock && !isComplete && (
          <div className="next-step-hint">Next step in {formatTime(nextUnlock)}</div>
        )}
        <div className="members-compact">
          {group.members.map((m, i) => (
            <span key={i} className="member-dot" title={`${m.student_name} — ${m.role_tag}`}>
              {m.student_name.split(' ')[0]}
            </span>
          ))}
        </div>
        {group.your_role_tag && (
          <div className="your-role-badge" style={{ background: topicColor + '20', color: topicColor, border: `1px solid ${topicColor}40` }}>
            Your angle: <strong>{group.your_role_tag}</strong>
          </div>
        )}
      </div>

      {/* Current step prompt (prominent in classroom mode) */}
      {activeStep && (
        <div className="step-prompt-bar" style={{ background: topicColor + '15', borderLeft: `3px solid ${topicColor}` }}>
          <div className="step-title">Step {activeStep.step}: {activeStep.title}</div>
          <div className="step-prompt-text">{activeStep.prompt}</div>
        </div>
      )}

      {/* Message thread */}
      <div className="messages">
        {messages.map((msg, i) => {
          const isMine = msg.student_email === email;
          if (msg.message_type === 'prompt' || msg.message_type === 'system') {
            return (
              <div key={msg.id} className="system-prompt" style={{ '--topic': topicColor }}>
                {msg.content}
              </div>
            );
          }
          return (
            <div key={msg.id} className={`msg-wrap ${isMine ? 'mine' : ''}`}>
              {!isMine && <div className="bubble-author">{msg.student_name}</div>}
              <div className={`bubble student ${isMine ? 'mine' : ''}`} style={isMine ? { background: topicColor } : {}}>
                {msg.content}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Wall submission (complete state) */}
      {isComplete && !wallSubmitted && (
        <div className="wall-submit-panel">
          <h4>Write your group's wall post</h4>
          <p>One sentence — specific, honest, something that actually came from this conversation.</p>
          <textarea
            className="wall-textarea"
            value={wallText}
            onChange={e => setWallText(e.target.value.slice(0, MAX_WALL))}
            placeholder="What emerged from this conversation?"
          />
          <div className="char-count">{wallText.length}/{MAX_WALL}</div>
          {wallFeedback && <div className="notice error">{wallFeedback}</div>}
          <button className="btn accent block" onClick={submitWall} disabled={submittingWall || !wallText.trim()}>
            {submittingWall ? 'Claude is reviewing...' : 'Submit to wall →'}
          </button>
        </div>
      )}

      {wallSubmitted && (
        <div className="wall-submitted-banner">
          ✓ Posted to the wall!
          <button className="btn ghost" onClick={() => nav('/wall')} style={{ marginLeft: 12 }}>See wall</button>
        </div>
      )}

      {/* Composer */}
      {!isComplete && (
        <form className="composer" onSubmit={sendMessage}>
          <div className="composer-inner">
            <textarea
              value={msgText}
              onChange={e => setMsgText(e.target.value)}
              placeholder="Add to the conversation..."
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e); } }}
              rows={2}
            />
            <button className="send-btn" type="submit" disabled={sending || !msgText.trim()} style={{ color: topicColor }}>
              ↑
            </button>
          </div>
          <div className="composer-hint">
            <span>Your role: {group.your_role_tag}</span>
            <span>{msgText.length}/{MAX_MSG}</span>
          </div>
        </form>
      )}
    </div>
  );
}
