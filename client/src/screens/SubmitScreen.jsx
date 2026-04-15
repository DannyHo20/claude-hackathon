import React, { useState } from 'react';
import { api, getStudent } from '../api.js';

export default function SubmitScreen({ group, onDone }) {
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const student = getStudent();

  const closingPrompt =
    "What's the one thing that surprised you most about this conversation? One sentence — specific, honest.";

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setFeedback('');
    if (!text.trim()) return setError('Write something first.');
    setBusy(true);
    try {
      const res = await api.submitWall({
        group_id: group.id,
        student_email: student.email,
        output_text: text.trim()
      });
      if (res.needs_revision) {
        setFeedback(res.feedback);
      } else if (res.success) {
        setDone(true);
        setTimeout(() => { onDone(); window.location.href = '/'; }, 1500);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div>
        <div className="screen-header">
          <h1>On the wall</h1>
          <p>Your group's voice is live. Taking you there…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ '--topic': group.topic.color, '--topic-soft': `${group.topic.color}1A` }}>
      <div className="screen-header">
        <h1>Group output</h1>
        <p>{closingPrompt}</p>
      </div>
      <div style={{ padding: '0 20px' }}>
        <form onSubmit={submit}>
          <textarea
            className="text-input"
            style={{ minHeight: 140 }}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="One sentence."
          />
          <div className="form-row">
            <button className="btn accent" type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Post to the wall'}
            </button>
            <button className="btn ghost" type="button" onClick={onDone}>Back</button>
          </div>
          {feedback && (
            <div className="notice" style={{ marginTop: 12 }}>
              <strong>Needs revision:</strong> {feedback}
            </div>
          )}
          {error && <div className="notice error">{error}</div>}
        </form>
      </div>
    </div>
  );
}
