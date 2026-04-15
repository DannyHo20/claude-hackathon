import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, getStudent, getRoomData } from '../api.js';
import socket from '../socket.js';

const MAX = 400;

export default function Answer() {
  const { code } = useParams();
  const nav = useNavigate();
  const student = getStudent();
  const roomData = getRoomData(code);

  const [room, setRoom] = useState(null);
  const [answer, setAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getRoom(code).then(setRoom).catch(() => nav('/join'));

    if (!socket.connected) socket.connect();
    socket.emit('join:room', { room_code: code, student_name: student?.name, student_email: student?.email });

    const onStatus = (data) => {
      if (data.status === 'grouping' || data.status === 'discussing') {
        nav(`/group/${code}`);
      }
    };
    socket.on('room:status', onStatus);
    return () => socket.off('room:status', onStatus);
  }, [code]);

  const submit = async (e) => {
    e.preventDefault();
    if (!answer.trim() || answer.length > MAX) return;
    if (!roomData?.room_id) { setError('Session error — please re-join'); return; }
    setLoading(true);
    setError('');
    try {
      await api.submitAnswer({
        room_id: roomData.room_id,
        question_id: room.question.id,
        student_name: student?.name,
        student_email: student?.email,
        answer_text: answer.trim()
      });
      setSubmitted(true);
    } catch (e) {
      if (e.status === 409) { setSubmitted(true); return; }
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!room) return <div className="loading">Loading...</div>;

  const topicColor = room.topic?.color || 'var(--accent)';

  if (submitted) {
    return (
      <div className="app-shell">
        <div className="answer-submitted">
          <div className="submitted-icon">✓</div>
          <h2>Answer submitted</h2>
          <p>Waiting for the professor to form groups...</p>
          <div className="pulse-dot" />
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="answer-screen" style={{ '--topic': topicColor }}>
        <div className="screen-header">
          <div className="topic-badge" style={{ color: topicColor }}>{room.topic?.name}</div>
          <h2 className="question-text">{room.question?.text}</h2>
        </div>

        <form onSubmit={submit} style={{ padding: '0 20px' }}>
          <textarea
            className="answer-textarea"
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            placeholder="Write your honest answer..."
            autoFocus
          />
          <div className={`char-count ${answer.length > MAX ? 'over' : ''}`}>
            {answer.length}/{MAX}
          </div>
          {error && <div className="notice error">{error}</div>}
          <button
            className="btn accent block"
            type="submit"
            disabled={loading || !answer.trim() || answer.length > MAX}
            style={{ marginTop: 16 }}
          >
            {loading ? 'Submitting...' : 'Submit answer →'}
          </button>
        </form>
      </div>
    </div>
  );
}
