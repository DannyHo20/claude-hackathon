import React from 'react';

export default function MessageBubble({ message, mine }) {
  if (message.message_type === 'prompt' || message.message_type === 'system') {
    return <div className="system-prompt">{message.content}</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <div className={`bubble-author ${mine ? 'mine' : ''}`}>{mine ? 'You' : message.student_name}</div>
      <div className={`bubble student ${mine ? 'mine' : ''}`}>{message.content}</div>
    </div>
  );
}
