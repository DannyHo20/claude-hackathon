import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import socket from '../socket.js';

export default function Projector() {
  const { code } = useParams();
  const [room, setRoom] = useState(null);
  const [answerCount, setAnswerCount] = useState(0);
  const [groups, setGroups] = useState([]);
  const [currentStep, setCurrentStep] = useState(null);
  const [timer, setTimer] = useState(null);
  const [wallPosts, setWallPosts] = useState([]);

  const fetchRoom = async () => {
    try {
      const data = await api.getRoom(code);
      setRoom(data);
      setAnswerCount(data.answer_count || 0);
    } catch {}
  };

  const fetchWall = async () => {
    try {
      const data = await api.wall({ room_code: code });
      setWallPosts(data.posts || []);
    } catch {}
  };

  useEffect(() => {
    fetchRoom();
    if (!socket.connected) socket.connect();
    socket.emit('join:room', { room_code: code });

    const onStatus = (data) => {
      setRoom(prev => prev ? { ...prev, ...data } : data);
      setAnswerCount(data.answer_count || 0);
    };
    const onGrouped = ({ groups: g }) => setGroups(g || []);
    const onStep = (data) => setCurrentStep(data);
    const onTimer = ({ seconds_remaining }) => setTimer(seconds_remaining);
    const onComplete = () => { setRoom(prev => prev ? { ...prev, status: 'complete' } : prev); fetchWall(); };
    const onWallPost = ({ post }) => setWallPosts(prev => [post, ...prev]);

    socket.on('room:status', onStatus);
    socket.on('room:grouped', onGrouped);
    socket.on('room:step', onStep);
    socket.on('room:timer', onTimer);
    socket.on('room:complete', onComplete);
    socket.on('wall:post', onWallPost);

    return () => {
      socket.off('room:status', onStatus);
      socket.off('room:grouped', onGrouped);
      socket.off('room:step', onStep);
      socket.off('room:timer', onTimer);
      socket.off('room:complete', onComplete);
      socket.off('wall:post', onWallPost);
    };
  }, [code]);

  if (!room) {
    return (
      <div className="projector loading-proj">
        <div className="proj-logo">◆ Mosaic</div>
        <p>Loading room {code}...</p>
      </div>
    );
  }

  const status = room.status;

  // LOBBY
  if (status === 'lobby') {
    return (
      <div className="projector lobby-proj">
        <div className="proj-logo">◆ Mosaic</div>
        <div className="proj-room-code">{code}</div>
        <div className="proj-join-hint">Join at <strong>mosaic.app</strong> with code above</div>
        <div className="proj-student-count">
          <span className="proj-count-num">{answerCount}</span>
          <span className="proj-count-label">students joined</span>
        </div>
      </div>
    );
  }

  // ANSWERING
  if (status === 'answering') {
    return (
      <div className="projector answering-proj">
        <div className="proj-topic" style={{ color: room.topic?.color }}>{room.topic?.name}</div>
        <div className="proj-question">{room.question?.text}</div>
        <div className="proj-answer-count">
          <span className="proj-count-num">{answerCount}</span>
          <span className="proj-count-label">answers submitted</span>
        </div>
        <div className="proj-progress-bar">
          <div className="proj-progress-fill" style={{ width: `${Math.min(100, (answerCount / 30) * 100)}%`, background: room.topic?.color }} />
        </div>
        <div className="proj-code-corner">{code}</div>
      </div>
    );
  }

  // GROUPING
  if (status === 'grouping') {
    return (
      <div className="projector grouping-proj">
        <div className="proj-grouping-text">
          {groups.length > 0 ? (
            <>
              <div className="proj-done-icon">✓</div>
              <h1>{groups.length} groups ready</h1>
              <p>Find your group on your phone</p>
              <div className="proj-group-names">
                {groups.map(g => (
                  <span key={g.group_id} className="proj-group-chip">{g.group_name}</span>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="proj-loading-dots"><span/><span/><span/></div>
              <h1>Claude is reading your answers...</h1>
              <p>Forming groups that will have the most interesting conversations</p>
            </>
          )}
        </div>
        <div className="proj-code-corner">{code}</div>
      </div>
    );
  }

  // DISCUSSING
  if (status === 'discussing') {
    const mins = timer !== null ? Math.floor(timer / 60) : null;
    const secs = timer !== null ? timer % 60 : null;
    return (
      <div className="projector discussing-proj">
        {currentStep && (
          <>
            <div className="proj-step-label">Step {currentStep.step} of 4 — {currentStep.step_title}</div>
            <div className="proj-prompt">{currentStep.prompt}</div>
          </>
        )}
        {timer !== null && (
          <div className={`proj-timer ${timer < 60 ? 'urgent' : ''}`}>
            {mins}:{String(secs).padStart(2, '0')}
          </div>
        )}
        {groups.length > 0 && (
          <div className="proj-group-list">
            {groups.map(g => (
              <span key={g.group_id} className="proj-group-item">{g.group_name}</span>
            ))}
          </div>
        )}
        <div className="proj-code-corner">{code}</div>
      </div>
    );
  }

  // COMPLETE / WALL
  return (
    <div className="projector wall-proj">
      <div className="proj-wall-header">
        <div className="proj-logo">◆ Mosaic</div>
        <h2>What emerged</h2>
      </div>
      <div className="proj-wall-posts">
        {wallPosts.length === 0 && (
          <div className="proj-wall-waiting">Waiting for groups to post...</div>
        )}
        {wallPosts.map(p => (
          <div key={p.id} className="proj-wall-post" style={{ borderColor: room.topic?.color }}>
            <div className="proj-wp-group">{p.group_name}</div>
            <div className="proj-wp-text">{p.output_text}</div>
            <div className="proj-wp-reactions">
              <span>👍 {p.agree_count}</span>
              <span>🔥 {p.pushback_count}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
