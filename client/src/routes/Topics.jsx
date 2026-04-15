import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getStudent, saveStudent } from '../api.js';

const MAX = 400;

export default function Topics() {
  const nav = useNavigate();
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [answeredIds, setAnsweredIds] = useState(new Set());
  const [expanded, setExpanded] = useState(null);
  const [answer, setAnswer] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const student = getStudent();

  useEffect(() => {
    api.topics().then(d => {
      setTopics(d.topics || []);
      setLoading(false);
    }).catch(() => setLoading(false));

    if (student?.email) {
      setName(student.name || '');
      setEmail(student.email);
      api.myAnswers(student.email).then(d => {
        setAnsweredIds(new Set((d.answers || []).map(a => a.question_id)));
      }).catch(() => {});
    }
  }, []);

  const submitAnswer = async (topic) => {
    if (!name.trim() || !email.trim() || !answer.trim()) { setError('All fields required'); return; }
    if (answer.length > MAX) { setError('Answer too long'); return; }
    setSubmitting(true);
    setError('');
    try {
      await api.submitAnswer({
        question_id: topic.question.id,
        topic_id: topic.id,
        student_name: name.trim(),
        student_email: email.trim().toLowerCase(),
        answer_text: answer.trim()
      });
      saveStudent({ name: name.trim(), email: email.trim().toLowerCase() });
      setAnsweredIds(prev => new Set([...prev, topic.question.id]));
      setExpanded(null);
      setAnswer('');
    } catch (e) {
      if (e.status === 409) {
        setAnsweredIds(prev => new Set([...prev, topic.question.id]));
        setExpanded(null);
      } else {
        setError(e.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="loading">Loading topics...</div>;

  return (
    <div className="app-shell">
      <div className="screen-header">
        <button className="back-btn" onClick={() => nav('/')}>← Home</button>
        <h1>This week's questions</h1>
        <p>Pick a topic. Answer honestly. Get matched with people who see it differently.</p>
      </div>

      {topics.map(topic => {
        const isExpanded = expanded === topic.id;
        const hasAnswered = topic.question && answeredIds.has(topic.question.id);
        const color = topic.color || 'var(--accent)';

        return (
          <div key={topic.id} className="topic-card" style={{ '--topic': color }}>
            <div className="topic-card-header">
              <h3>{topic.name}</h3>
              {hasAnswered && <span className="answered-badge">✓ Answered</span>}
            </div>
            {topic.question ? (
              <>
                <p className={`topic-question ${!isExpanded ? 'clamp' : ''}`}>{topic.question.text}</p>
                <div className="topic-meta">
                  <span className="answer-count">{topic.answer_count} {topic.answer_count === 1 ? 'answer' : 'answers'}</span>
                </div>
                {!hasAnswered && (
                  <>
                    {!isExpanded ? (
                      <button className="btn accent" style={{ marginTop: 10 }} onClick={() => { setExpanded(topic.id); setAnswer(''); setError(''); }}>
                        Answer this →
                      </button>
                    ) : (
                      <div className="answer-form">
                        {!student && (
                          <>
                            <label className="field-label">Your name</label>
                            <input className="text-input" value={name} onChange={e => setName(e.target.value)} placeholder="First Last" style={{ marginBottom: 8 }} />
                            <label className="field-label">Your email</label>
                            <input className="text-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@school.edu" type="email" style={{ marginBottom: 8 }} />
                          </>
                        )}
                        <label className="field-label">Your answer</label>
                        <textarea
                          className="text-input"
                          value={answer}
                          onChange={e => setAnswer(e.target.value)}
                          placeholder="Answer honestly..."
                          style={{ minHeight: 100, resize: 'vertical' }}
                          autoFocus
                        />
                        <div className={`char-count ${answer.length > MAX ? 'over' : ''}`}>{answer.length}/{MAX}</div>
                        {error && <div className="notice error">{error}</div>}
                        <div className="form-row">
                          <button className="btn accent" onClick={() => submitAnswer(topic)} disabled={submitting || !answer.trim() || answer.length > MAX}>
                            {submitting ? 'Submitting...' : 'Submit'}
                          </button>
                          <button className="btn ghost" onClick={() => setExpanded(null)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {hasAnswered && (
                  <div style={{ marginTop: 10 }}>
                    <button className="btn soft" onClick={() => nav('/group')}>See my group →</button>
                  </div>
                )}
              </>
            ) : (
              <p className="topic-desc">No question this week yet.</p>
            )}
          </div>
        );
      })}

      <div style={{ height: 20 }} />
    </div>
  );
}
