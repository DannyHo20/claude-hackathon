import React, { useState } from 'react';
import { api, getStudent, saveStudent } from '../api.js';

const MAX = 400;

export default function AnswerForm({ topic, question, onClose, onSubmitted }) {
  const student = getStudent() || { name: '', email: '' };
  const [name, setName] = useState(student.name || '');
  const [email, setEmail] = useState(student.email || '');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || !email.trim()) return setError('Name and email required.');
    if (!text.trim()) return setError('Write your answer.');
    if (text.length > MAX) return setError('Answer is too long.');
    setBusy(true);
    try {
      await api.submitAnswer({
        topic_id: topic.id,
        question_id: question.id,
        student_name: name.trim(),
        student_email: email.trim().toLowerCase(),
        answer_text: text.trim()
      });
      saveStudent({ name: name.trim(), email: email.trim().toLowerCase() });
      onSubmitted();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remaining = MAX - text.length;

  return (
    <form className="answer-form" onSubmit={submit}>
      <label>Name</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
      <label>Email</label>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@school.edu" />
      <label>Your answer</label>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Say what you actually think."
        maxLength={MAX + 50}
      />
      <div className={`char-count ${remaining < 0 ? 'over' : ''}`}>{remaining} characters left</div>
      {error && <div className="notice error">{error}</div>}
      <div className="form-row">
        <button type="submit" className="btn accent" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit'}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}
