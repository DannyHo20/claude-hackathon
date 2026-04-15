async function req(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { data, status: res.status });
  return data;
}

export const api = {
  // Room management
  createRoom: (body) => req('/api/rooms/create', { method: 'POST', body }),
  getRoom: (code) => req(`/api/rooms/${code}`),
  joinRoom: (code, body) => req(`/api/rooms/${code}/join`, { method: 'POST', body }),

  // Professor controls
  advanceRoom: (code, body) => req(`/api/rooms/${code}/advance`, { method: 'POST', body }),
  runGrouping: (code, body) => req(`/api/rooms/${code}/run-grouping`, { method: 'POST', body }),
  startDiscussion: (code, body) => req(`/api/rooms/${code}/start-discussion`, { method: 'POST', body }),
  nextStep: (code, body) => req(`/api/rooms/${code}/next-step`, { method: 'POST', body }),
  setTimer: (code, body) => req(`/api/rooms/${code}/timer`, { method: 'POST', body }),

  // Online mode
  topics: () => req('/api/topics'),
  question: (slug) => req(`/api/question/${slug}`),
  myAnswers: (email) => req(`/api/my-answers?email=${encodeURIComponent(email)}`),

  // Answers
  submitAnswer: (body) => req('/api/answer', { method: 'POST', body }),

  // Groups + messages
  myGroup: (email, room_code) => {
    const params = new URLSearchParams({ email });
    if (room_code) params.set('room_code', room_code);
    return req(`/api/my-group?${params}`);
  },
  messages: (groupId, email) => req(`/api/messages/${groupId}?email=${encodeURIComponent(email)}`),
  sendMessage: (body) => req('/api/message', { method: 'POST', body }),
  reactMessage: (id, body) => req(`/api/message/${id}/react`, { method: 'POST', body }),

  // Wall
  wall: (opts = {}) => {
    const params = new URLSearchParams();
    if (opts.room_code) params.set('room_code', opts.room_code);
    if (opts.topic) params.set('topic', opts.topic);
    return req(`/api/wall${params.toString() ? '?' + params : ''}`);
  },
  submitWall: (body) => req('/api/wall', { method: 'POST', body }),
  reactWall: (id, reaction) => req(`/api/wall/${id}/react`, { method: 'POST', body: { reaction } }),

  // RSVP
  rsvp: (body) => req('/api/rsvp', { method: 'POST', body }),
  meetupCard: (groupId) => req(`/api/meetup-card/${groupId}`),

  // Admin (online mode)
  adminGroups: (key) => req(`/api/admin/groups?admin_key=${key}`),
  adminRunGrouping: (slug, key) => req(`/api/admin/run-grouping/${slug}`, { method: 'POST', body: { admin_key: key } }),
  adminStartConversations: (slug, key) => req(`/api/admin/start-conversations/${slug}`, { method: 'POST', body: { admin_key: key } }),
  adminGenerateQuestions: (key) => req('/api/admin/generate-questions', { method: 'POST', body: { admin_key: key } }),
  adminAdvanceStep: (group_id, key) => req('/api/admin/advance-step', { method: 'POST', body: { group_id, admin_key: key } })
};

// ---------- Local storage helpers ----------

const STUDENT_KEY = 'mosaic_student';
const ROOM_PREFIX = 'mosaic_room_';

export function getStudent() {
  try { return JSON.parse(localStorage.getItem(STUDENT_KEY) || 'null'); } catch { return null; }
}
export function saveStudent(s) { localStorage.setItem(STUDENT_KEY, JSON.stringify(s)); }

export function getRoomData(code) {
  try { return JSON.parse(localStorage.getItem(ROOM_PREFIX + code) || 'null'); } catch { return null; }
}
export function saveRoomData(code, data) {
  localStorage.setItem(ROOM_PREFIX + code, JSON.stringify(data));
}

export function getProfessorToken(code) {
  const d = getRoomData(code);
  return d?.professor_token || null;
}
export function saveProfessorToken(code, token) {
  const d = getRoomData(code) || {};
  saveRoomData(code, { ...d, professor_token: token });
}
