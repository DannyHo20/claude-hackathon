import React, { useEffect, useRef, useState } from 'react';
import { api, getStudent } from '../api.js';
import MessageBubble from './MessageBubble.jsx';
import Timer from './Timer.jsx';

const MAX = 500;

export default function ConversationThread({ group, onComplete, onSubmitOutput }) {
  const [messages, setMessages] = useState(group.messages || []);
  const [status, setStatus] = useState(group.status);
  const [currentStep, setCurrentStep] = useState(group.current_step);
  const [nextUnlock, setNextUnlock] = useState(group.next_unlock_at);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  const student = getStudent();

  const refresh = async () => {
    try {
      const data = await api.messages(group.id, student.email);
      setMessages(data.messages);
      setStatus(data.status);
      setCurrentStep(data.current_step);
      setNextUnlock(data.next_unlock_at);
      if (data.status === 'complete' && onComplete) onComplete();
    } catch {}
  };

  useEffect(() => {
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [group.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const send = async (e) => {
    e.preventDefault();
    setError('');
    if (!text.trim()) return;
    if (text.length > MAX) return setError('Too long.');
    setBusy(true);
    try {
      await api.sendMessage({
        group_id: group.id,
        student_email: student.email,
        student_name: student.name,
        content: text.trim()
      });
      setText('');
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const style = { '--topic': group.topic.color, '--topic-soft': `${group.topic.color}1A` };
  const agenda = group.agenda || [];
  const totalSteps = agenda.length || 4;
  const stepIndex = currentStep ? agenda.findIndex(s => s.step === currentStep.step) : -1;
  const progressPct = status === 'complete'
    ? 100
    : Math.max(5, ((stepIndex + 1) / totalSteps) * 100);

  // Build rendered stream with step separators
  const rendered = [];
  let lastStep = 0;
  for (const m of messages) {
    if (m.message_type === 'prompt' && m.agenda_step && m.agenda_step !== lastStep) {
      const step = agenda.find(s => s.step === m.agenda_step);
      rendered.push({ type: 'sep', key: `sep-${m.id}`, label: step ? `Step ${step.step} — ${step.title}` : `Step ${m.agenda_step}` });
      lastStep = m.agenda_step;
    }
    rendered.push({ type: 'msg', key: `msg-${m.id}`, m });
  }

  const canPost = status === 'active' && !!currentStep;

  return (
    <div style={style}>
      <div className="thread-header">
        <h2>{group.group_name}</h2>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{group.topic.name}</div>
        <div className="question">"{group.question_text}"</div>
        <div className="progress-row">
          <span className="step-label">
            {status === 'complete'
              ? 'Complete'
              : currentStep
                ? `Step ${currentStep.step} of ${totalSteps} — ${currentStep.title}`
                : 'Waiting'}
          </span>
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${progressPct}%` }} /></div>
        </div>
        {nextUnlock && status === 'active' && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            Next prompt unlocks in <Timer until={nextUnlock} />
          </div>
        )}
        <div className="members-row">
          {group.members.map((m, i) => (
            <span key={i} className="member-pill">
              <strong>{m.student_name}</strong><em>— {m.role_tag}</em>
            </span>
          ))}
        </div>
      </div>

      <div className="messages" ref={scrollRef}>
        {rendered.map(r =>
          r.type === 'sep'
            ? <div key={r.key} className="step-separator">{r.label}</div>
            : <MessageBubble key={r.key} message={r.m} mine={r.m.student_email === student.email} />
        )}
        {messages.length === 0 && <div className="loading">Waiting for the first prompt…</div>}
      </div>

      {status === 'complete' ? (
        <div style={{ padding: '16px 20px' }}>
          <button className="btn accent block" onClick={onSubmitOutput}>Submit your group's output</button>
        </div>
      ) : canPost ? (
        <form className="composer" onSubmit={send}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Say your piece…"
            maxLength={MAX + 50}
          />
          <div className="composer-hint">
            <span className={text.length > MAX ? 'over' : ''}>{MAX - text.length} left</span>
            <button type="submit" className="btn accent" disabled={busy || !text.trim()}>
              {busy ? 'Sending…' : 'Post'}
            </button>
          </div>
          {error && <div className="notice error">{error}</div>}
        </form>
      ) : (
        <div className="locked">
          Input locked. {nextUnlock && <>Next prompt unlocks in <Timer until={nextUnlock} />.</>}
        </div>
      )}
    </div>
  );
}
