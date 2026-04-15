import React, { useEffect, useState } from 'react';

function formatRemaining(ms) {
  if (ms <= 0) return 'unlocking…';
  const totalMins = Math.floor(ms / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function Timer({ until }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  if (!until) return null;
  const ms = new Date(until).getTime() - now;
  return <span>{formatRemaining(ms)}</span>;
}
