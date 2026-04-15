import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, getStudent } from '../api.js';
import socket from '../socket.js';

export default function Lobby() {
  const { code } = useParams();
  const nav = useNavigate();
  const student = getStudent();

  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');

  const fetchRoom = async () => {
    try {
      const data = await api.getRoom(code);
      setRoom(data);
      if (data.status === 'answering') nav(`/answer/${code}`);
      if (data.status === 'grouping' || data.status === 'discussing') nav(`/group/${code}`);
    } catch (e) {
      setError('Room not found');
    }
  };

  useEffect(() => {
    fetchRoom();
    if (!socket.connected) socket.connect();

    socket.emit('join:room', {
      room_code: code,
      student_name: student?.name,
      student_email: student?.email
    });

    const onStatus = (data) => {
      setRoom(prev => prev ? { ...prev, ...data } : data);
      if (data.status === 'answering') nav(`/answer/${code}`);
      if (data.status === 'grouping' || data.status === 'discussing') nav(`/group/${code}`);
    };
    socket.on('room:status', onStatus);

    const poll = setInterval(fetchRoom, 5000);
    return () => {
      socket.off('room:status', onStatus);
      clearInterval(poll);
    };
  }, [code]);

  if (error) return (
    <div className="app-shell">
      <div className="empty-state">
        <h3>Room not found</h3>
        <p>{error}</p>
        <button className="btn soft" onClick={() => nav('/join')} style={{ marginTop: 16 }}>Try again</button>
      </div>
    </div>
  );

  if (!room) return <div className="loading">Loading...</div>;

  return (
    <div className="app-shell">
      <div className="lobby-screen">
        <div className="lobby-code-display">
          <div className="lobby-label">Room</div>
          <div className="lobby-big-code">{code}</div>
        </div>

        <div className="lobby-status">
          <div className="lobby-waiting-dot" />
          <p>Waiting for <strong>{room.professor_name}</strong> to start</p>
        </div>

        {student && (
          <div className="lobby-you">
            You joined as <strong>{student.name}</strong>
          </div>
        )}

        <div className="lobby-topic">
          <div className="topic-pill-large" style={{ background: room.topic?.color + '22', color: room.topic?.color }}>
            {room.topic?.name}
          </div>
          {room.question && (
            <p className="lobby-question">"{room.question.text}"</p>
          )}
        </div>

        <div className="lobby-count">
          <span className="count-num">{room.answer_count || 0}</span>
          <span className="count-label">students ready</span>
        </div>
      </div>
    </div>
  );
}
