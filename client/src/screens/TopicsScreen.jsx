import React, { useEffect, useState } from 'react';
import { api, getStudent } from '../api.js';
import TopicCard from '../components/TopicCard.jsx';

export default function TopicsScreen() {
  const [topics, setTopics] = useState(null);
  const [week, setWeek] = useState('');
  const [answered, setAnswered] = useState(new Set());
  const [error, setError] = useState('');

  const loadAnswered = async () => {
    const student = getStudent();
    if (!student?.email) return setAnswered(new Set());
    try {
      const { answers } = await api.myAnswers(student.email);
      setAnswered(new Set(answers.map(a => a.question_id)));
    } catch {}
  };

  const load = async () => {
    try {
      const data = await api.topics();
      setTopics(data.topics);
      setWeek(data.week);
      loadAnswered();
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="screen-header">
        <h1>This week on Mosaic</h1>
        <p>Pick the topic you have the strongest opinion on.</p>
      </div>
      {error && <div className="notice error" style={{ margin: '0 20px' }}>{error}</div>}
      {!topics && <div className="loading">Loading topics…</div>}
      {topics && topics.map(t => (
        <TopicCard
          key={t.id}
          topic={t}
          answered={t.question && answered.has(t.question.id)}
          onSubmitted={() => loadAnswered()}
        />
      ))}
      {topics && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, margin: '20px 0' }}>
          Week {week}
        </div>
      )}
    </div>
  );
}
