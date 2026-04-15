import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, getProfessorToken, saveProfessorToken } from '../api.js';
import socket from '../socket.js';

const STEP_DURATIONS = [3, 4, 5, 6, 8]; // minutes

export default function Professor() {
  const { code } = useParams();
  const [searchParams] = useSearchParams();
  const nav = useNavigate();

  const tokenFromUrl = searchParams.get('token');
  const [token, setToken] = useState(tokenFromUrl || getProfessorToken(code) || '');
  const [room, setRoom] = useState(null);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [stepDuration, setStepDuration] = useState(4);
  const [timerActive, setTimerActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(null);
  const [wallPosts, setWallPosts] = useState([]);

  useEffect(() => {
    if (tokenFromUrl) saveProfessorToken(code, tokenFromUrl);
  }, [tokenFromUrl]);

  const fetchRoom = async () => {
    try {
      const data = await api.getRoom(code);
      setRoom(data);
    } catch (e) {
      setError('Room not found: ' + code);
    }
  };

  const fetchGroups = async () => {
    try {
      const data = await api.wall({ room_code: code });
      setWallPosts(data.posts || []);
    } catch {}
  };

  useEffect(() => {
    fetchRoom();
    fetchGroups();
    if (!socket.connected) socket.connect();
    socket.emit('join:room', { room_code: code });

    const onStatus = (data) => setRoom(prev => prev ? { ...prev, ...data } : data);
    const onGrouped = ({ groups: g }) => setGroups(g || []);
    const onTimer = ({ seconds_remaining }) => { setTimeLeft(seconds_remaining); setTimerActive(seconds_remaining > 0); };
    const onWallPost = ({ post }) => setWallPosts(prev => [post, ...prev]);

    socket.on('room:status', onStatus);
    socket.on('room:grouped', onGrouped);
    socket.on('room:timer', onTimer);
    socket.on('wall:post', onWallPost);

    return () => {
      socket.off('room:status', onStatus);
      socket.off('room:grouped', onGrouped);
      socket.off('room:timer', onTimer);
      socket.off('wall:post', onWallPost);
    };
  }, [code]);

  const doAction = async (action, extraBody = {}) => {
    setLoading(action);
    setError('');
    try {
      await action(code, { professor_token: token, ...extraBody });
      await fetchRoom();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading('');
    }
  };

  const openAnswers = () => doAction(api.advanceRoom); // lobby → answering
  const closeAndGroup = async () => {
    setLoading('group');
    setError('');
    try {
      await api.advanceRoom(code, { professor_token: token }); // answering → grouping
      await fetchRoom();
      await api.runGrouping(code, { professor_token: token });
      await fetchRoom();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading('');
    }
  };
  const startDiscussion = () => doAction(api.startDiscussion);
  const nextStep = () => doAction(api.nextStep);
  const endSession = () => doAction(api.advanceRoom); // discussing → complete

  const startTimer = async () => {
    const secs = stepDuration * 60;
    setLoading('timer');
    try {
      await api.setTimer(code, { professor_token: token, duration_seconds: secs });
      setTimerActive(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading('');
    }
  };

  if (!token) {
    return (
      <div className="app-shell">
        <div className="screen-header"><h1>Professor Dashboard</h1></div>
        <div className="notice error" style={{ margin: '20px' }}>
          No professor token found. Use the link from when you created the room.
        </div>
      </div>
    );
  }

  if (!room) return <div className="loading">Loading dashboard...</div>;

  const status = room.status;
  const mins = timeLeft !== null ? Math.floor(timeLeft / 60) : null;
  const secs = timeLeft !== null ? timeLeft % 60 : null;

  return (
    <div className="app-shell professor-screen">
      {room.demo_mode && <div className="demo-banner">DEMO MODE — steps are 30 seconds</div>}

      <div className="prof-header">
        <div className="prof-room-code">{code}</div>
        <div className="prof-status-pill">{status}</div>
      </div>

      {error && <div className="notice error" style={{ margin: '0 20px 12px' }}>{error}</div>}

      {/* Timer display */}
      {timerActive && timeLeft !== null && (
        <div className={`prof-timer ${timeLeft < 60 ? 'urgent' : ''}`}>
          {mins}:{String(secs).padStart(2, '0')}
        </div>
      )}

      {/* Status info */}
      <div className="prof-info">
        <div className="prof-info-row">
          <span>Topic</span><strong style={{ color: room.topic?.color }}>{room.topic?.name}</strong>
        </div>
        <div className="prof-info-row">
          <span>Answers</span><strong>{room.answer_count || 0}</strong>
        </div>
        {groups.length > 0 && (
          <div className="prof-info-row">
            <span>Groups</span><strong>{groups.length}</strong>
          </div>
        )}
        {status === 'discussing' && (
          <div className="prof-info-row">
            <span>Current step</span><strong>{room.current_step} / {room.question ? 4 : '?'}</strong>
          </div>
        )}
      </div>

      {/* Big action button */}
      <div className="prof-main-action">
        {status === 'lobby' && (
          <button className="big-next-btn" onClick={openAnswers} disabled={!!loading}>
            {loading === 'answering' ? 'Opening...' : 'Open answers →'}
          </button>
        )}
        {status === 'answering' && (
          <button className="big-next-btn" onClick={closeAndGroup} disabled={!!loading}>
            {loading === 'group' ? 'Claude is grouping...' : `Close answers + form groups (${room.answer_count || 0})`}
          </button>
        )}
        {status === 'grouping' && groups.length > 0 && (
          <button className="big-next-btn" onClick={startDiscussion} disabled={!!loading}>
            {loading ? 'Starting...' : 'Start discussion →'}
          </button>
        )}
        {status === 'grouping' && groups.length === 0 && (
          <div className="notice" style={{ margin: '0 20px', textAlign: 'center' }}>
            Claude is grouping... ({room.answer_count} answers)
          </div>
        )}
        {status === 'discussing' && (
          <>
            <div className="prof-step-controls">
              <div className="timer-picker">
                {STEP_DURATIONS.map(d => (
                  <button key={d} className={`timer-chip ${stepDuration === d ? 'active' : ''}`} onClick={() => setStepDuration(d)}>
                    {d}m
                  </button>
                ))}
                <button className="btn soft" onClick={startTimer} disabled={!!loading}>
                  {loading === 'timer' ? '...' : 'Start timer'}
                </button>
              </div>
            </div>
            <button className="big-next-btn" onClick={nextStep} disabled={!!loading}>
              {loading ? 'Loading Claude...' : 'Next step →'}
            </button>
            <button className="btn ghost block" onClick={endSession} disabled={!!loading} style={{ marginTop: 12 }}>
              End session
            </button>
          </>
        )}
        {status === 'complete' && (
          <div className="prof-complete">
            <div className="complete-check">✓</div>
            <h3>Session complete</h3>
            <p>{wallPosts.length} group{wallPosts.length !== 1 ? 's' : ''} posted to the wall</p>
            <button className="btn soft" onClick={() => window.open(`/projector/${code}`, '_blank')}>
              Open wall on projector
            </button>
          </div>
        )}
      </div>

      {/* Projector link */}
      <div className="prof-links">
        <button className="btn ghost" onClick={() => window.open(`/projector/${code}`, '_blank')}>
          Open projector view ↗
        </button>
      </div>

      {/* Groups list */}
      {groups.length > 0 && (
        <div className="prof-groups">
          <h4>Groups</h4>
          {groups.map(g => (
            <div key={g.group_id} className="prof-group-item">
              <strong>{g.group_name}</strong>
              <span>{g.members?.map(m => m.student_name).join(', ')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Wall posts */}
      {wallPosts.length > 0 && (
        <div className="prof-wall">
          <h4>Wall posts ({wallPosts.length})</h4>
          {wallPosts.map(p => (
            <div key={p.id} className="prof-wall-item">
              <strong>{p.group_name}:</strong> {p.output_text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
