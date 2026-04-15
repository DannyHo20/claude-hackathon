import React, { useState } from 'react';
import { api } from '../api.js';

export default function WallPost({ post, mine }) {
  const [counts, setCounts] = useState({ agree: post.agree_count, pushback: post.pushback_count });
  const [busy, setBusy] = useState(false);

  const react = async (reaction) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.react(post.id, reaction);
      setCounts({ agree: res.agree_count, pushback: res.pushback_count });
    } catch {} finally {
      setBusy(false);
    }
  };

  const style = { '--topic': post.topic_color, '--topic-soft': `${post.topic_color}1A` };

  return (
    <div className="wall-post" style={style}>
      <div className="wp-top">
        <span className="group-name">{post.group_name}{mine ? ' · your group' : ''}</span>
        <span className="topic-pill">{post.topic_name}</span>
      </div>
      <div className="output">{post.output_text}</div>
      <div className="reactions">
        <button className="react-btn" onClick={() => react('agree')} disabled={busy}>
          Agree <span className="count">{counts.agree}</span>
        </button>
        <button className="react-btn" onClick={() => react('pushback')} disabled={busy}>
          Pushback <span className="count">{counts.pushback}</span>
        </button>
      </div>
    </div>
  );
}
