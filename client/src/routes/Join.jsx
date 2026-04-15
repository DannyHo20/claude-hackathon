import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, getStudent, saveStudent, saveRoomData } from '../api.js';

export default function Join() {
  const { code: paramCode } = useParams();
  const nav = useNavigate();
  const student = getStudent();

  const [code, setCode] = useState(paramCode || '');
  const [name, setName] = useState(student?.name || '');
  const [email, setEmail] = useState(student?.email || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const trimCode = code.replace(/\s/g, '');
    if (trimCode.length !== 6) { setError('Room code must be 6 digits'); return; }
    if (!name.trim()) { setError('Name required'); return; }
    if (!email.trim()) { setError('Email required'); return; }

    setLoading(true);
    try {
      const data = await api.joinRoom(trimCode, {
        student_name: name.trim(),
        student_email: email.trim().toLowerCase()
      });
      saveStudent({ name: name.trim(), email: email.trim().toLowerCase() });
      saveRoomData(trimCode, { room_id: data.room_id, joined_at: Date.now() });
      nav(`/lobby/${trimCode}`);
    } catch (e) {
      setError(e.message || 'Could not join room');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="screen-header">
        <button className="back-btn" onClick={() => nav('/')}>← Back</button>
        <h1>Join a classroom</h1>
        <p>Get the 6-digit code from your professor</p>
      </div>
      <form onSubmit={handleSubmit} style={{ padding: '0 20px' }}>
        <label className="field-label">Room code</label>
        <input
          className="text-input code-input"
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="847291"
          inputMode="numeric"
          maxLength={6}
          autoFocus={!paramCode}
        />
        <label className="field-label" style={{ marginTop: 16 }}>Your name</label>
        <input
          className="text-input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="First Last"
        />
        <label className="field-label" style={{ marginTop: 12 }}>Your email</label>
        <input
          className="text-input"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@school.edu"
          type="email"
        />
        {error && <div className="notice error" style={{ marginTop: 12 }}>{error}</div>}
        <button className="btn accent block" style={{ marginTop: 20 }} type="submit" disabled={loading}>
          {loading ? 'Joining...' : 'Join room →'}
        </button>
      </form>
    </div>
  );
}
