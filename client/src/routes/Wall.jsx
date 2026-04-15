import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';

const TOPICS = [
  { slug: 'all', name: 'All' },
  { slug: 'campus-culture', name: 'Campus culture' },
  { slug: 'academic-life', name: 'Academic life' },
  { slug: 'money-and-class', name: 'Money and class' },
  { slug: 'tech-and-ai', name: 'Tech and AI' },
  { slug: 'identity-and-belonging', name: 'Identity and belonging' }
];

export default function Wall() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const roomCode = searchParams.get('room');
  const liveMode = searchParams.get('live') === '1';
  const [posts, setPosts] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [reacted, setReacted] = useState(new Set());

  const fetchWall = async () => {
    try {
      const opts = roomCode ? { room_code: roomCode } : { topic: filter !== 'all' ? filter : undefined };
      const data = await api.wall(opts);
      setPosts(data.posts || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchWall(); }, [filter, roomCode]);

  // Live mode: auto-refresh every 3s
  useEffect(() => {
    if (!liveMode) return;
    const iv = setInterval(fetchWall, 3000);
    return () => clearInterval(iv);
  }, [liveMode, filter]);

  const react = async (id, reaction) => {
    const key = `${id}-${reaction}`;
    if (reacted.has(key)) return;
    try {
      const data = await api.reactWall(id, reaction);
      setPosts(prev => prev.map(p => p.id === id ? { ...p, ...data } : p));
      setReacted(prev => new Set([...prev, key]));
    } catch {}
  };

  return (
    <div className={`app-shell${liveMode ? ' wall-live' : ''}`}>
      {!liveMode && (
        <div className="screen-header">
          <button className="back-btn" onClick={() => nav('/')}>← Home</button>
          <h1>The wall</h1>
          <p>What groups actually figured out</p>
        </div>
      )}
      {liveMode && (
        <div className="screen-header" style={{ paddingBottom: 8 }}>
          <h1 style={{ fontSize: 28 }}>The wall</h1>
        </div>
      )}

      {!roomCode && !liveMode && (
        <div className="wall-filter">
          {TOPICS.map(t => (
            <button
              key={t.slug}
              className={`chip ${filter === t.slug ? 'active' : ''}`}
              onClick={() => setFilter(t.slug)}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {loading && <div className="loading">Loading...</div>}

      {!loading && posts.length === 0 && (
        <div className="empty-state">
          <h3>Nothing here yet</h3>
          <p>Groups post here after finishing their 24hr conversation.</p>
        </div>
      )}

      {posts.map((post, idx) => (
        <div key={post.id} className="wall-post" style={{ '--topic': post.topic_color || 'var(--accent)', animationDelay: `${idx * 0.07}s` }}>
          <div className="wp-top">
            <span className="group-name">{post.group_name}</span>
            <span className="topic-pill" style={{ background: (post.topic_color || '#666') + '22', color: post.topic_color }}>
              {post.topic_name}
            </span>
          </div>
          <div className="output">"{post.output_text}"</div>
          <div className="reactions">
            <button
              className={`react-btn ${reacted.has(`${post.id}-agree`) ? 'reacted' : ''}`}
              onClick={() => react(post.id, 'agree')}
            >
              👍 <span className="count">{post.agree_count}</span>
            </button>
            <button
              className={`react-btn ${reacted.has(`${post.id}-pushback`) ? 'reacted' : ''}`}
              onClick={() => react(post.id, 'pushback')}
            >
              🔥 <span className="count">{post.pushback_count}</span>
            </button>
          </div>
        </div>
      ))}
      <div style={{ height: 24 }} />
    </div>
  );
}
