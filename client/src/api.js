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
  topics: () => req('/api/topics'),
  question: (slug) => req(`/api/question/${slug}`),
  submitAnswer: (body) => req('/api/answer', { method: 'POST', body }),
  myAnswers: (email) => req(`/api/my-answers?email=${encodeURIComponent(email)}`),
  myGroup: (email) => req(`/api/my-group?email=${encodeURIComponent(email)}`),
  messages: (groupId, email) => req(`/api/messages/${groupId}?email=${encodeURIComponent(email)}`),
  sendMessage: (body) => req('/api/message', { method: 'POST', body }),
  wall: (topic) => req(topic && topic !== 'all' ? `/api/wall?topic=${topic}` : '/api/wall'),
  submitWall: (body) => req('/api/wall', { method: 'POST', body }),
  react: (id, reaction) => req(`/api/wall/${id}/react`, { method: 'POST', body: { reaction } }),
  // admin
  runGrouping: (slug) => req(`/api/admin/run-grouping/${slug}`, { method: 'POST' }),
  startConversations: (slug) => req(`/api/admin/start-conversations/${slug}`, { method: 'POST' }),
  generateQuestions: () => req('/api/admin/generate-questions', { method: 'POST' }),
  listGroups: () => req('/api/admin/groups'),
  advanceStep: (group_id) => req('/api/advance-step', { method: 'POST', body: { group_id } })
};

const STUDENT_KEY = 'mosaic_student';

export function getStudent() {
  try {
    return JSON.parse(localStorage.getItem(STUDENT_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveStudent(s) {
  localStorage.setItem(STUDENT_KEY, JSON.stringify(s));
}
