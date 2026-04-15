import React, { useState } from 'react';
import AnswerForm from './AnswerForm.jsx';

export default function TopicCard({ topic, answered, onSubmitted }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const style = { '--topic': topic.color, '--topic-soft': `${topic.color}1A` };

  if (!topic.question) {
    return (
      <div className="topic-card" style={style}>
        <h3>{topic.name}</h3>
        <p className="topic-desc">{topic.description}</p>
        <p className="topic-question">No active question this week.</p>
      </div>
    );
  }

  return (
    <div className="topic-card" style={style}>
      {(answered || submitted) && <span className="answered-badge">Answered</span>}
      <h3>{topic.name}</h3>
      <p className="topic-desc">{topic.description}</p>
      <p
        className={`topic-question ${expanded ? '' : 'clamp'}`}
        onClick={() => setExpanded(e => !e)}
        style={{ cursor: 'pointer' }}
      >
        {topic.question.text}
      </p>
      {!open && !answered && !submitted && (
        <button className="btn accent" onClick={() => setOpen(true)}>Answer this</button>
      )}
      {open && !answered && !submitted && (
        <AnswerForm
          topic={topic}
          question={topic.question}
          onClose={() => setOpen(false)}
          onSubmitted={() => { setSubmitted(true); setOpen(false); onSubmitted && onSubmitted(); }}
        />
      )}
      {(answered || submitted) && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          You're in. Check back in a few hours — we'll group everyone and start your conversation.
        </p>
      )}
    </div>
  );
}
