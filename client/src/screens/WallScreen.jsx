import React, { useEffect, useState } from 'react';
import { api, getStudent } from '../api.js';
import WallPost from '../components/WallPost.jsx';

const FILTERS = [
  { slug: 'all', label: 'All' },
  { slug: 'campus-culture', label: 'Campus' },
  { slug: 'academic-life', label: 'Academic' },
  { slug: 'money-and-class', label: 'Money' },
  { slug: 'tech-and-ai', label: 'Tech & AI' },
  { slug: 'identity-and-belonging', label: 'Identity' }
];

export default function WallScreen() {
  const [filter, setFilter] = useState('all');
  const [posts, setPosts] = useState(null);
  const [myGroupId, setMyGroupId] = useState(null);

  const load = async () => {
    try {
      const data = await api.wall(filter);
      setPosts(data.posts);
    } catch {}
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [filter]);

  useEffect(() => {
    const s = getStudent();
    if (s?.email) {
      api.myGroup(s.email).then(d => setMyGroupId(d.group?.id || null)).catch(() => {});
    }
  }, []);

  return (
    <div>
      <div className="screen-header">
        <h1>The Wall</h1>
        <p>What groups agreed on — one sentence each.</p>
      </div>
      <div className="wall-filter">
        {FILTERS.map(f => (
          <button
            key={f.slug}
            className={`chip ${filter === f.slug ? 'active' : ''}`}
            onClick={() => setFilter(f.slug)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {!posts && <div className="loading">Loading…</div>}
      {posts && posts.length === 0 && (
        <div className="empty-state">
          <h3>No posts yet</h3>
          <p>Conversations are still happening.</p>
        </div>
      )}
      {posts && posts.map(p => (
        <WallPost key={p.id} post={p} mine={p.group_id === myGroupId} />
      ))}
    </div>
  );
}
