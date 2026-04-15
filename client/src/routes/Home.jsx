import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const nav = useNavigate();
  return (
    <div className="home">
      <div className="home-hero">
        <div className="home-logo">◆</div>
        <h1>Mosaic</h1>
        <p>Real conversations with people who see things differently.</p>
      </div>
      <div className="home-modes">
        <button className="mode-card classroom" onClick={() => nav('/join')}>
          <div className="mode-icon">🎓</div>
          <h2>Join a classroom</h2>
          <p>Enter a room code from your professor</p>
        </button>
        <button className="mode-card online" onClick={() => nav('/topics')}>
          <div className="mode-icon">🌐</div>
          <h2>Explore on your own</h2>
          <p>Pick a topic, answer a question, join a 24hr discussion</p>
        </button>
      </div>
      <div className="home-footer">
        <button className="btn ghost" onClick={() => nav('/wall')}>Browse the wall →</button>
      </div>
    </div>
  );
}
