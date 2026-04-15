import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { db, currentWeek, nextWeek } from './db.js';
import {
  groupAnswers,
  generateAgenda,
  generateReactivePrompt,
  qualityCheckOutput,
  generateWeeklyQuestions,
  generateMeetupCard,
  DEMO_MODE
} from './claude.js';
import {
  registerSocketHandlers,
  emitRoomStatus,
  emitGrouped,
  emitStep,
  emitComplete,
  emitGroupMessage,
  startRoomTimer
} from './socket.js';
import {
  startStepAdvancer,
  forceAdvanceStep,
  advanceGroupSync,
  currentStep,
  nextStepUnlocksAt
} from './timer.js';

dotenv.config();
const PORT = process.env.PORT || 3001;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: ['http://localhost:3000', 'http://localhost:5173'], credentials: true }
});

app.use(cors({ origin: ['http://localhost:3000', 'http://localhost:5173'] }));
app.use(express.json({ limit: '200kb' }));

if (DEMO_MODE) {
  console.log('[mosaic] DEMO MODE — step timers: 30s, tick: 5s');
}

registerSocketHandlers(io);

// ---------- Helper: generate random 6-digit room code ----------
function generateRoomCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (db.prepare('SELECT id FROM rooms WHERE room_code = ?').get(code));
  return code;
}

// ---------- Helper: validate professor token ----------
function validateProfessor(room_code, professor_token) {
  return db.prepare(
    'SELECT * FROM rooms WHERE room_code = ? AND professor_token = ?'
  ).get(room_code, professor_token);
}

// ---------- Rooms ----------

app.post('/api/rooms/create', (req, res) => {
  const { professor_name, topic_id, mode = 'classroom' } = req.body || {};
  if (!professor_name || !topic_id) return res.status(400).json({ error: 'professor_name and topic_id required' });

  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(topic_id);
  if (!topic) return res.status(404).json({ error: 'topic not found' });

  const week = currentWeek();
  const question = db.prepare(
    'SELECT * FROM questions WHERE topic_id = ? AND week = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
  ).get(topic_id, week);
  if (!question) return res.status(404).json({ error: 'no active question for this topic this week' });

  const room_code = generateRoomCode();
  const professor_token = uuidv4();

  const info = db.prepare(
    'INSERT INTO rooms (room_code, professor_name, topic_id, question_id, mode, status, professor_token) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(room_code, professor_name.trim(), topic_id, question.id, mode, 'lobby', professor_token);

  res.json({ room_code, professor_token, room_id: info.lastInsertRowid });
});

app.get('/api/rooms/:code', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE room_code = ?').get(req.params.code);
  if (!room) return res.status(404).json({ error: 'room not found' });

  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(room.topic_id);
  const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(room.question_id);
  const answerCount = db.prepare('SELECT COUNT(*) as n FROM answers WHERE room_id = ?').get(room.id).n;

  res.json({
    room_code: room.room_code,
    room_id: room.id,
    professor_name: room.professor_name,
    mode: room.mode,
    status: room.status,
    current_step: room.current_step,
    step_started_at: room.step_started_at,
    answer_count: answerCount,
    topic,
    question,
    demo_mode: DEMO_MODE
  });
});

app.post('/api/rooms/:code/join', (req, res) => {
  const { student_name, student_email } = req.body || {};
  if (!student_name || !student_email) return res.status(400).json({ error: 'name and email required' });

  const room = db.prepare('SELECT * FROM rooms WHERE room_code = ?').get(req.params.code);
  if (!room) return res.status(404).json({ error: 'room not found' });
  if (!['lobby', 'answering'].includes(room.status)) {
    return res.status(400).json({ error: 'room is not accepting new students' });
  }

  const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(room.question_id);
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(room.topic_id);

  res.json({ success: true, room_id: room.id, question, topic });
});

// ---------- Professor controls ----------

app.post('/api/rooms/:code/advance', (req, res) => {
  const { professor_token } = req.body || {};
  const room = validateProfessor(req.params.code, professor_token);
  if (!room) return res.status(403).json({ error: 'invalid professor token' });

  const transitions = { lobby: 'answering', answering: 'grouping', grouping: 'discussing', discussing: 'complete' };
  const next = transitions[room.status];
  if (!next) return res.status(400).json({ error: 'cannot advance from ' + room.status });

  db.prepare('UPDATE rooms SET status = ? WHERE id = ?').run(next, room.id);
  emitRoomStatus(io, req.params.code, room.id);

  if (next === 'complete') emitComplete(io, req.params.code);

  res.json({ status: next });
});

app.post('/api/rooms/:code/run-grouping', async (req, res) => {
  const { professor_token } = req.body || {};
  const room = validateProfessor(req.params.code, professor_token);
  if (!room) return res.status(403).json({ error: 'invalid professor token' });
  if (room.status !== 'grouping') return res.status(400).json({ error: 'room must be in grouping status' });

  const existingGroups = db.prepare('SELECT COUNT(*) as n FROM groups WHERE room_id = ?').get(room.id).n;
  if (existingGroups > 0) return res.status(409).json({ error: 'groups already created' });

  const answers = db.prepare('SELECT * FROM answers WHERE room_id = ? ORDER BY id').all(room.id);
  if (answers.length < 4) {
    return res.status(400).json({ error: `need at least 4 answers — have ${answers.length}` });
  }

  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(room.topic_id);
  const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(room.question_id);

  try {
    const groupsFromClaude = await groupAnswers({
      topicName: topic.name,
      questionText: question.text,
      answers
    });

    const answerById = Object.fromEntries(answers.map(a => [a.id, a]));
    const insertGroup = db.prepare(
      'INSERT INTO groups (room_id, question_id, topic_id, group_number, group_name, claude_reasoning, central_tension, agenda, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertMember = db.prepare(
      'INSERT INTO group_members (group_id, answer_id, student_name, student_email, role_tag) VALUES (?, ?, ?, ?, ?)'
    );

    // Generate all agendas in parallel
    const validGroups = groupsFromClaude.filter(g => {
      const members = (g.members || []).filter(m => answerById[m.answer_id]);
      return members.length >= 4;
    });

    const agendaPromises = validGroups.map(g => {
      const members = (g.members || [])
        .map(m => ({ ...m, answer: answerById[m.answer_id] }))
        .filter(m => m.answer);
      return generateAgenda({
        topicName: topic.name,
        questionText: question.text,
        members: members.map(m => ({ role_tag: m.role_tag, answer_text: m.answer.answer_text })),
        mode: room.mode
      });
    });

    const agendas = await Promise.all(agendaPromises);

    let created = 0;
    const createdGroups = [];

    for (let i = 0; i < validGroups.length; i++) {
      const g = validGroups[i];
      const members = (g.members || [])
        .map(m => ({ ...m, answer: answerById[m.answer_id] }))
        .filter(m => m.answer);

      const info = insertGroup.run(
        room.id, room.question_id, room.topic_id,
        g.group_number || (created + 1),
        g.group_name || `Group ${created + 1}`,
        g.reasoning || '',
        g.central_tension || '',
        JSON.stringify(agendas[i]),
        'waiting'
      );
      const groupId = info.lastInsertRowid;

      for (const m of members) {
        insertMember.run(groupId, m.answer.id, m.answer.student_name, m.answer.student_email, m.role_tag || '');
      }

      createdGroups.push({
        group_id: groupId,
        group_number: g.group_number || created + 1,
        group_name: g.group_name || `Group ${created + 1}`,
        members: members.map(m => ({ student_name: m.answer.student_name, role_tag: m.role_tag }))
      });
      created++;
    }

    emitGrouped(io, req.params.code, createdGroups);
    res.json({ groups_created: created, groups: createdGroups });
  } catch (e) {
    console.error('[grouping] failed:', e);
    res.status(500).json({ error: 'grouping failed: ' + e.message });
  }
});

app.post('/api/rooms/:code/start-discussion', (req, res) => {
  const { professor_token } = req.body || {};
  const room = validateProfessor(req.params.code, professor_token);
  if (!room) return res.status(403).json({ error: 'invalid professor token' });

  const groups = db.prepare("SELECT * FROM groups WHERE room_id = ? AND status = 'waiting'").all(room.id);
  const update = db.prepare("UPDATE groups SET status = 'active', started_at = CURRENT_TIMESTAMP WHERE id = ?");
  const insertMsg = db.prepare(
    "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, NULL, NULL, ?, 'prompt', ?)"
  );

  let started = 0;
  let step1Data = null;

  for (const g of groups) {
    update.run(g.id);
    const agenda = JSON.parse(g.agenda || '[]');
    const step1 = agenda[0];
    if (step1) {
      const info = insertMsg.run(g.id, step1.prompt, step1.step);
      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
      emitGroupMessage(io, g.id, message);
      if (!step1Data) step1Data = step1;
    }
    started++;
  }

  db.prepare("UPDATE rooms SET status = 'discussing', current_step = 1 WHERE id = ?").run(room.id);
  emitRoomStatus(io, req.params.code, room.id);

  if (step1Data) {
    emitStep(io, req.params.code, {
      step: step1Data.step,
      prompt: step1Data.prompt,
      step_title: step1Data.title,
      duration_minutes: step1Data.duration_minutes
    });
  }

  res.json({ groups_started: started });
});

app.post('/api/rooms/:code/next-step', async (req, res) => {
  const { professor_token } = req.body || {};
  const room = validateProfessor(req.params.code, professor_token);
  if (!room) return res.status(403).json({ error: 'invalid professor token' });
  if (room.status !== 'discussing') return res.status(400).json({ error: 'room not in discussion' });

  const nextStep = (room.current_step || 1) + 1;

  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(room.topic_id);
  const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(room.question_id);
  const groups = db.prepare("SELECT * FROM groups WHERE room_id = ? AND status = 'active'").all(room.id);

  if (!groups.length) return res.status(400).json({ error: 'no active groups' });

  // Check if all steps done
  const firstGroupAgenda = JSON.parse(groups[0].agenda || '[]');
  if (nextStep > firstGroupAgenda.length) {
    db.prepare("UPDATE rooms SET status = 'complete' WHERE id = ?").run(room.id);
    emitComplete(io, req.params.code);
    return res.json({ complete: true });
  }

  const stepTemplate = firstGroupAgenda[nextStep - 1];
  const insertMsg = db.prepare(
    "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, NULL, NULL, ?, 'prompt', ?)"
  );

  let stepPromptText = stepTemplate.prompt;

  // Generate reactive prompt from previous step messages (classroom mode)
  if (nextStep > 1) {
    const allPrevMessages = [];
    for (const g of groups) {
      const prev = db.prepare(
        "SELECT * FROM messages WHERE group_id = ? AND agenda_step = ? AND message_type = 'student'"
      ).all(g.id, room.current_step);
      allPrevMessages.push(...prev);
    }

    try {
      stepPromptText = await generateReactivePrompt({
        topicName: topic.name,
        questionText: question.text,
        members: [], // aggregate across all groups
        previousMessages: allPrevMessages.slice(0, 20),
        stepNumber: nextStep,
        stepTitle: stepTemplate.title,
        mode: 'classroom'
      });
    } catch (e) {
      console.warn('[next-step] reactive prompt failed, using static:', e.message);
    }
  }

  // Post to all groups
  for (const g of groups) {
    const info = insertMsg.run(g.id, stepPromptText, nextStep);
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
    emitGroupMessage(io, g.id, message);
  }

  db.prepare('UPDATE rooms SET current_step = ? WHERE id = ?').run(nextStep, room.id);

  emitStep(io, req.params.code, {
    step: nextStep,
    prompt: stepPromptText,
    step_title: stepTemplate.title,
    duration_minutes: stepTemplate.duration_minutes
  });

  res.json({ step: nextStep, prompt: stepPromptText, step_title: stepTemplate.title });
});

app.post('/api/rooms/:code/timer', (req, res) => {
  const { professor_token, duration_seconds } = req.body || {};
  const room = validateProfessor(req.params.code, professor_token);
  if (!room) return res.status(403).json({ error: 'invalid professor token' });
  if (!duration_seconds || duration_seconds < 1) return res.status(400).json({ error: 'invalid duration' });
  startRoomTimer(io, req.params.code, duration_seconds);
  res.json({ success: true });
});

// ---------- Online mode: Topics + Questions ----------

app.get('/api/topics', (req, res) => {
  const week = currentWeek();
  const topics = db.prepare('SELECT * FROM topics ORDER BY id').all();
  const result = topics.map(t => {
    const q = db.prepare(
      'SELECT * FROM questions WHERE topic_id = ? AND week = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
    ).get(t.id, week);
    const answerCount = q ? db.prepare(
      'SELECT COUNT(*) as n FROM answers WHERE question_id = ? AND room_id IS NULL'
    ).get(q.id).n : 0;
    return { ...t, question: q || null, answer_count: answerCount };
  });
  res.json({ week, topics: result });
});

app.get('/api/question/:topicSlug', (req, res) => {
  const week = currentWeek();
  const topic = db.prepare('SELECT * FROM topics WHERE slug = ?').get(req.params.topicSlug);
  if (!topic) return res.status(404).json({ error: 'topic not found' });
  const q = db.prepare(
    'SELECT * FROM questions WHERE topic_id = ? AND week = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
  ).get(topic.id, week);
  if (!q) return res.status(404).json({ error: 'no active question this week' });
  res.json({ topic, question: q });
});

// ---------- Answers ----------

app.post('/api/answer', (req, res) => {
  const { room_id, topic_id, question_id, student_name, student_email, answer_text } = req.body || {};
  if (!question_id || !student_name || !student_email || !answer_text) {
    return res.status(400).json({ error: 'missing fields' });
  }
  if (answer_text.length > 400) return res.status(400).json({ error: 'answer exceeds 400 characters' });

  const email = student_email.trim().toLowerCase();

  // Check for duplicates
  if (room_id) {
    const existing = db.prepare('SELECT id FROM answers WHERE room_id = ? AND student_email = ?').get(room_id, email);
    if (existing) return res.status(409).json({ error: 'you already answered in this room' });
  } else {
    const existing = db.prepare(
      'SELECT id FROM answers WHERE question_id = ? AND student_email = ? AND room_id IS NULL'
    ).get(question_id, email);
    if (existing) return res.status(409).json({ error: 'you already answered this question' });
  }

  // Get topic_id from question if not provided
  let resolvedTopicId = topic_id;
  if (!resolvedTopicId) {
    const q = db.prepare('SELECT topic_id FROM questions WHERE id = ?').get(question_id);
    if (q) resolvedTopicId = q.topic_id;
  }

  try {
    const info = db.prepare(
      'INSERT INTO answers (room_id, question_id, topic_id, student_name, student_email, answer_text) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(room_id || null, question_id, resolvedTopicId, student_name.trim(), email, answer_text.trim());

    // Emit live answer count to classroom room
    if (room_id) {
      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(room_id);
      if (room) emitRoomStatus(io, room.room_code, room.id);
    }

    res.json({ success: true, answer_id: info.lastInsertRowid });
  } catch (e) {
    console.error(e);
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'you already answered' });
    res.status(500).json({ error: 'failed to save answer' });
  }
});

app.get('/api/my-answers', (req, res) => {
  const email = (req.query.email || '').toString().trim().toLowerCase();
  if (!email) return res.json({ answers: [] });
  const rows = db.prepare(
    'SELECT question_id, topic_id FROM answers WHERE student_email = ? AND room_id IS NULL'
  ).all(email);
  res.json({ answers: rows });
});

// ---------- My Group + Messages ----------

app.get('/api/my-group', (req, res) => {
  const email = (req.query.email || '').toString().trim().toLowerCase();
  const room_code = (req.query.room_code || '').trim();

  if (!email) return res.status(400).json({ error: 'email required' });

  let member;
  if (room_code) {
    const room = db.prepare('SELECT * FROM rooms WHERE room_code = ?').get(room_code);
    if (!room) return res.status(404).json({ error: 'room not found' });
    member = db.prepare(`
      SELECT gm.*, g.id as group_id
      FROM group_members gm
      JOIN groups g ON g.id = gm.group_id
      WHERE gm.student_email = ? AND g.room_id = ?
      ORDER BY g.created_at DESC LIMIT 1
    `).get(email, room.id);
  } else {
    member = db.prepare(`
      SELECT gm.*, g.id as group_id
      FROM group_members gm
      JOIN groups g ON g.id = gm.group_id
      WHERE gm.student_email = ? AND g.room_id IS NULL
      ORDER BY g.created_at DESC LIMIT 1
    `).get(email);
  }

  if (!member) return res.json({ group: null });

  const group = db.prepare(`
    SELECT g.*, t.name as topic_name, t.slug as topic_slug, t.color as topic_color, q.text as question_text
    FROM groups g
    JOIN topics t ON t.id = g.topic_id
    JOIN questions q ON q.id = g.question_id
    WHERE g.id = ?
  `).get(member.group_id);

  const members = db.prepare(
    'SELECT student_name, student_email, role_tag FROM group_members WHERE group_id = ? ORDER BY id'
  ).all(group.id);

  const messages = db.prepare('SELECT * FROM messages WHERE group_id = ? ORDER BY id').all(group.id);

  const agenda = JSON.parse(group.agenda || '[]');
  const current = currentStep(group);
  const nextUnlock = nextStepUnlocksAt(group);

  res.json({
    group: {
      id: group.id,
      group_name: group.group_name,
      central_tension: group.central_tension,
      room_id: group.room_id,
      topic: { name: group.topic_name, slug: group.topic_slug, color: group.topic_color },
      question_text: group.question_text,
      status: group.status,
      started_at: group.started_at,
      agenda,
      current_step: current,
      next_unlock_at: nextUnlock,
      members,
      messages,
      your_name: member.student_name,
      your_role_tag: member.role_tag,
      demo_mode: DEMO_MODE
    }
  });
});

app.post('/api/message', (req, res) => {
  const { group_id, student_email, student_name, content } = req.body || {};
  if (!group_id || !student_email || !content) return res.status(400).json({ error: 'missing fields' });
  if (content.length > 500) return res.status(400).json({ error: 'message exceeds 500 characters' });

  const email = student_email.trim().toLowerCase();
  const member = db.prepare(
    'SELECT * FROM group_members WHERE group_id = ? AND student_email = ?'
  ).get(group_id, email);
  if (!member) return res.status(403).json({ error: 'not a member of this group' });

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(group_id);
  if (!group) return res.status(404).json({ error: 'group not found' });
  if (group.status !== 'active') return res.status(400).json({ error: 'group not active' });

  const current = currentStep(group);
  const step = current ? current.step : 1;

  const info = db.prepare(
    "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, ?, ?, ?, 'student', ?)"
  ).run(group_id, email, student_name || member.student_name, content.trim(), step);

  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
  emitGroupMessage(io, group_id, message);
  res.json({ success: true, message });
});

app.post('/api/message/:id/react', (req, res) => {
  const { student_email, reaction } = req.body || {};
  const messageId = Number(req.params.id);
  if (!student_email || !reaction) return res.status(400).json({ error: 'missing fields' });
  if (!['agree', 'interesting', 'pushback'].includes(reaction)) {
    return res.status(400).json({ error: 'invalid reaction' });
  }

  const email = student_email.trim().toLowerCase();
  try {
    db.prepare(
      'INSERT OR REPLACE INTO message_reactions (message_id, student_email, reaction) VALUES (?, ?, ?)'
    ).run(messageId, email, reaction);

    const counts = db.prepare(
      'SELECT reaction, COUNT(*) as n FROM message_reactions WHERE message_id = ? GROUP BY reaction'
    ).all(messageId);
    res.json({ reactions: counts });
  } catch (e) {
    res.status(500).json({ error: 'failed to save reaction' });
  }
});

app.get('/api/messages/:groupId', (req, res) => {
  const email = (req.query.email || '').toString().trim().toLowerCase();
  const groupId = Number(req.params.groupId);
  if (!email) return res.status(400).json({ error: 'email required' });

  const member = db.prepare(
    'SELECT id FROM group_members WHERE group_id = ? AND student_email = ?'
  ).get(groupId, email);
  if (!member) return res.status(403).json({ error: 'not a member of this group' });

  advanceGroupSync(groupId);

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  const messages = db.prepare('SELECT * FROM messages WHERE group_id = ? ORDER BY id').all(groupId);

  res.json({
    status: group.status,
    current_step: currentStep(group),
    next_unlock_at: nextStepUnlocksAt(group),
    messages
  });
});

// ---------- Wall ----------

app.post('/api/wall', async (req, res) => {
  const { group_id, student_email, output_text, room_id } = req.body || {};
  if (!group_id || !student_email || !output_text) return res.status(400).json({ error: 'missing fields' });

  const email = student_email.trim().toLowerCase();
  const member = db.prepare(
    'SELECT * FROM group_members WHERE group_id = ? AND student_email = ?'
  ).get(group_id, email);
  if (!member) return res.status(403).json({ error: 'not a member of this group' });

  const group = db.prepare(`
    SELECT g.*, q.text as question_text FROM groups g
    JOIN questions q ON q.id = g.question_id
    WHERE g.id = ?
  `).get(group_id);
  if (!group) return res.status(404).json({ error: 'group not found' });
  if (group.status !== 'complete') return res.status(400).json({ error: 'group not complete yet' });

  const existing = db.prepare('SELECT id FROM wall_posts WHERE group_id = ?').get(group_id);
  if (existing) return res.status(409).json({ error: 'your group already posted' });

  try {
    const check = await qualityCheckOutput({
      outputText: output_text.trim(),
      questionText: group.question_text
    });
    if (!check.approved) {
      return res.json({ needs_revision: true, feedback: check.feedback });
    }
    const info = db.prepare(
      'INSERT INTO wall_posts (group_id, topic_id, room_id, group_name, output_text) VALUES (?, ?, ?, ?, ?)'
    ).run(group_id, group.topic_id, room_id || group.room_id || null, group.group_name, output_text.trim());

    // Emit to room wall if classroom mode
    if (group.room_id) {
      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(group.room_id);
      if (room) {
        const post = db.prepare('SELECT * FROM wall_posts WHERE id = ?').get(info.lastInsertRowid);
        io.to(room.room_code).emit('wall:post', { post });
      }
    }

    res.json({ success: true, post_id: info.lastInsertRowid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'wall post failed: ' + e.message });
  }
});

app.get('/api/wall', (req, res) => {
  const topicSlug = req.query.topic;
  const roomCode = req.query.room_code;

  let rows;
  if (roomCode) {
    const room = db.prepare('SELECT id FROM rooms WHERE room_code = ?').get(roomCode);
    if (!room) return res.status(404).json({ error: 'room not found' });
    rows = db.prepare(`
      SELECT wp.*, t.name as topic_name, t.slug as topic_slug, t.color as topic_color
      FROM wall_posts wp JOIN topics t ON t.id = wp.topic_id
      WHERE wp.room_id = ?
      ORDER BY wp.created_at DESC
    `).all(room.id);
  } else if (topicSlug && topicSlug !== 'all') {
    const topic = db.prepare('SELECT id FROM topics WHERE slug = ?').get(topicSlug);
    if (!topic) return res.status(404).json({ error: 'topic not found' });
    rows = db.prepare(`
      SELECT wp.*, t.name as topic_name, t.slug as topic_slug, t.color as topic_color
      FROM wall_posts wp JOIN topics t ON t.id = wp.topic_id
      WHERE wp.topic_id = ? AND wp.room_id IS NULL
      ORDER BY wp.agree_count DESC, wp.created_at DESC
    `).all(topic.id);
  } else {
    rows = db.prepare(`
      SELECT wp.*, t.name as topic_name, t.slug as topic_slug, t.color as topic_color
      FROM wall_posts wp JOIN topics t ON t.id = wp.topic_id
      WHERE wp.room_id IS NULL
      ORDER BY wp.agree_count DESC, wp.created_at DESC
    `).all();
  }
  res.json({ posts: rows });
});

app.post('/api/wall/:id/react', (req, res) => {
  const { reaction } = req.body || {};
  if (!['agree', 'pushback'].includes(reaction)) {
    return res.status(400).json({ error: 'reaction must be agree or pushback' });
  }
  const col = reaction === 'agree' ? 'agree_count' : 'pushback_count';
  const info = db.prepare(`UPDATE wall_posts SET ${col} = ${col} + 1 WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'post not found' });
  const post = db.prepare('SELECT agree_count, pushback_count FROM wall_posts WHERE id = ?').get(req.params.id);
  res.json(post);
});

// ---------- RSVP ----------

app.post('/api/rsvp', (req, res) => {
  const { group_id, student_email, status } = req.body || {};
  if (!group_id || !student_email || !status) return res.status(400).json({ error: 'missing fields' });
  if (!['going', 'cant_make_it'].includes(status)) return res.status(400).json({ error: 'invalid status' });

  const email = student_email.trim().toLowerCase();
  db.prepare(
    'INSERT OR REPLACE INTO meetup_rsvps (group_id, student_email, status) VALUES (?, ?, ?)'
  ).run(group_id, email, status);

  const rsvps = db.prepare(
    'SELECT status, COUNT(*) as n FROM meetup_rsvps WHERE group_id = ? GROUP BY status'
  ).all(group_id);
  res.json({ rsvps });
});

app.get('/api/meetup-card/:groupId', async (req, res) => {
  const groupId = Number(req.params.groupId);
  const group = db.prepare(`
    SELECT g.*, t.name as topic_name, q.text as question_text
    FROM groups g JOIN topics t ON t.id = g.topic_id JOIN questions q ON q.id = g.question_id
    WHERE g.id = ?
  `).get(groupId);
  if (!group) return res.status(404).json({ error: 'group not found' });

  const members = db.prepare(
    'SELECT student_name FROM group_members WHERE group_id = ?'
  ).all(groupId);

  const step4Messages = db.prepare(
    "SELECT * FROM messages WHERE group_id = ? AND agenda_step = 4 AND message_type = 'student' ORDER BY id"
  ).all(groupId);

  try {
    const card = await generateMeetupCard({
      topicName: group.topic_name,
      questionText: group.question_text,
      step4Messages,
      centralTension: group.central_tension || '',
      members
    });
    res.json({ card });
  } catch (e) {
    res.status(500).json({ error: 'failed to generate meetup card' });
  }
});

// ---------- Admin (online mode management) ----------

app.get('/api/admin/groups', (req, res) => {
  const { admin_key } = req.query;
  if (admin_key !== (process.env.ADMIN_KEY || 'mosaic-admin')) {
    return res.status(403).json({ error: 'unauthorized' });
  }
  const groups = db.prepare(`
    SELECT g.*, t.name as topic_name, t.slug as topic_slug, q.text as question_text
    FROM groups g
    JOIN topics t ON t.id = g.topic_id
    JOIN questions q ON q.id = g.question_id
    WHERE g.room_id IS NULL
    ORDER BY g.created_at DESC
  `).all();
  const memberStmt = db.prepare('SELECT student_name, role_tag FROM group_members WHERE group_id = ?');
  const result = groups.map(g => ({
    ...g,
    members: memberStmt.all(g.id),
    current_step: currentStep(g),
    next_unlock_at: nextStepUnlocksAt(g)
  }));
  res.json({ groups: result });
});

app.post('/api/admin/run-grouping/:topicSlug', async (req, res) => {
  const { admin_key } = req.body || {};
  if (admin_key !== (process.env.ADMIN_KEY || 'mosaic-admin')) {
    return res.status(403).json({ error: 'unauthorized' });
  }
  const week = currentWeek();
  const topic = db.prepare('SELECT * FROM topics WHERE slug = ?').get(req.params.topicSlug);
  if (!topic) return res.status(404).json({ error: 'topic not found' });

  const q = db.prepare(
    'SELECT * FROM questions WHERE topic_id = ? AND week = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
  ).get(topic.id, week);
  if (!q) return res.status(404).json({ error: 'no active question' });

  const answers = db.prepare(
    'SELECT * FROM answers WHERE question_id = ? AND room_id IS NULL ORDER BY id'
  ).all(q.id);
  if (answers.length < 5) {
    return res.status(400).json({ error: `need at least 5 answers — have ${answers.length}` });
  }

  const existingGroups = db.prepare(
    'SELECT COUNT(*) as n FROM groups WHERE question_id = ? AND room_id IS NULL'
  ).get(q.id).n;
  if (existingGroups > 0) return res.status(409).json({ error: `groups already exist (${existingGroups})` });

  try {
    const groupsFromClaude = await groupAnswers({ topicName: topic.name, questionText: q.text, answers });
    const answerById = Object.fromEntries(answers.map(a => [a.id, a]));

    const validGroups = groupsFromClaude.filter(g =>
      (g.members || []).filter(m => answerById[m.answer_id]).length >= 4
    );

    const agendas = await Promise.all(validGroups.map(g => {
      const members = (g.members || [])
        .map(m => ({ ...m, answer: answerById[m.answer_id] }))
        .filter(m => m.answer);
      return generateAgenda({
        topicName: topic.name, questionText: q.text,
        members: members.map(m => ({ role_tag: m.role_tag, answer_text: m.answer.answer_text })),
        mode: 'online'
      });
    }));

    const insertGroup = db.prepare(
      'INSERT INTO groups (question_id, topic_id, group_number, group_name, claude_reasoning, central_tension, agenda, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertMember = db.prepare(
      'INSERT INTO group_members (group_id, answer_id, student_name, student_email, role_tag) VALUES (?, ?, ?, ?, ?)'
    );

    let created = 0;
    for (let i = 0; i < validGroups.length; i++) {
      const g = validGroups[i];
      const members = (g.members || [])
        .map(m => ({ ...m, answer: answerById[m.answer_id] }))
        .filter(m => m.answer);
      const info = insertGroup.run(
        q.id, topic.id, g.group_number || (created + 1),
        g.group_name || `Group ${created + 1}`,
        g.reasoning || '', g.central_tension || '',
        JSON.stringify(agendas[i]), 'waiting'
      );
      for (const m of members) {
        insertMember.run(info.lastInsertRowid, m.answer.id, m.answer.student_name, m.answer.student_email, m.role_tag || '');
      }
      created++;
    }
    res.json({ groups_created: created });
  } catch (e) {
    console.error('[admin grouping] failed:', e);
    res.status(500).json({ error: 'grouping failed: ' + e.message });
  }
});

app.post('/api/admin/start-conversations/:topicSlug', (req, res) => {
  const { admin_key } = req.body || {};
  if (admin_key !== (process.env.ADMIN_KEY || 'mosaic-admin')) {
    return res.status(403).json({ error: 'unauthorized' });
  }
  const week = currentWeek();
  const topic = db.prepare('SELECT * FROM topics WHERE slug = ?').get(req.params.topicSlug);
  if (!topic) return res.status(404).json({ error: 'topic not found' });

  const q = db.prepare(
    'SELECT * FROM questions WHERE topic_id = ? AND week = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
  ).get(topic.id, week);
  if (!q) return res.status(404).json({ error: 'no active question' });

  const groups = db.prepare(
    "SELECT * FROM groups WHERE question_id = ? AND status = 'waiting' AND room_id IS NULL"
  ).all(q.id);

  const update = db.prepare("UPDATE groups SET status = 'active', started_at = CURRENT_TIMESTAMP WHERE id = ?");
  const insertMsg = db.prepare(
    "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, NULL, NULL, ?, 'prompt', ?)"
  );

  let started = 0;
  for (const g of groups) {
    update.run(g.id);
    const agenda = JSON.parse(g.agenda || '[]');
    if (agenda[0]) insertMsg.run(g.id, agenda[0].prompt, agenda[0].step);
    started++;
  }
  res.json({ groups_started: started });
});

app.post('/api/admin/generate-questions', async (req, res) => {
  const { admin_key } = req.body || {};
  if (admin_key !== (process.env.ADMIN_KEY || 'mosaic-admin')) {
    return res.status(403).json({ error: 'unauthorized' });
  }
  try {
    const past = db.prepare('SELECT text FROM questions ORDER BY id DESC LIMIT 50').all().map(r => r.text);
    const generated = await generateWeeklyQuestions({ pastQuestions: past });
    const curr = currentWeek();
    const nextW = nextWeek(curr);
    const insertQ = db.prepare('INSERT INTO questions (topic_id, text, week, is_active) VALUES (?, ?, ?, 1)');
    let count = 0;
    for (const item of generated) {
      const topic = db.prepare('SELECT id FROM topics WHERE slug = ?').get(item.topic_slug);
      if (!topic) continue;
      const existing = db.prepare('SELECT id FROM questions WHERE topic_id = ? AND week = ?').get(topic.id, nextW);
      if (existing) continue;
      insertQ.run(topic.id, item.question, nextW);
      count++;
    }
    res.json({ week: nextW, questions_created: count, questions: generated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'question generation failed: ' + e.message });
  }
});

app.post('/api/admin/advance-step', (req, res) => {
  const { group_id, admin_key } = req.body || {};
  if (admin_key !== (process.env.ADMIN_KEY || 'mosaic-admin')) {
    return res.status(403).json({ error: 'unauthorized' });
  }
  if (!group_id) return res.status(400).json({ error: 'group_id required' });
  const result = forceAdvanceStep(group_id);
  if (result.message) emitGroupMessage(io, group_id, result.message);
  res.json(result);
});

// ---------- Demo endpoints (DEMO_MODE only) ----------

const DEMO_INJECT_MESSAGES = [
  { name: 'Jordan M',  email: 'jordan@test.com',  text: "My honest answer is yes — I'd use it for everything. The question is what 'everything' actually means in practice." },
  { name: 'Sam K',     email: 'sam@test.com',     text: "I tried that for a full semester. Got good grades and learned almost nothing. That scared me more than bad grades would have." },
  { name: 'Alex T',    email: 'alex@test.com',    text: "You're both describing the same tool differently. But the tool you get depends on whether you can afford the paid version. That changes this whole conversation." },
];

function demoGuard(req, res) {
  if (!DEMO_MODE) { res.status(404).json({ error: 'not found' }); return true; }
  return false;
}

app.get('/api/demo/status', (req, res) => {
  if (demoGuard(req, res)) return;
  const groups = db.prepare(
    "SELECT g.*, t.name as topic_name FROM groups g JOIN topics t ON t.id = g.topic_id WHERE g.room_id IS NULL ORDER BY g.created_at DESC"
  ).all();
  const memberStmt = db.prepare('SELECT student_name, role_tag FROM group_members WHERE group_id = ?');
  const msgStmt = db.prepare("SELECT MAX(agenda_step) as max_step FROM messages WHERE group_id = ? AND message_type = 'prompt'");
  const wallCount = db.prepare('SELECT COUNT(*) as n FROM wall_posts').get().n;

  const result = groups.map(g => ({
    id: g.id,
    group_name: g.group_name,
    central_tension: g.central_tension,
    status: g.status,
    topic_name: g.topic_name,
    members: memberStmt.all(g.id),
    current_step: msgStmt.get(g.id)?.max_step || 0,
  }));

  res.json({ demo_mode: true, groups: result, wall_post_count: wallCount });
});

app.post('/api/demo/run-full', async (req, res) => {
  if (demoGuard(req, res)) return;
  const week = currentWeek();
  const topic = db.prepare("SELECT * FROM topics WHERE slug = 'tech-and-ai'").get();
  if (!topic) return res.status(404).json({ error: 'tech-and-ai topic not found' });

  const q = db.prepare(
    'SELECT * FROM questions WHERE topic_id = ? AND week = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
  ).get(topic.id, week);
  if (!q) return res.status(404).json({ error: 'no active question for tech-and-ai' });

  const answers = db.prepare(
    'SELECT * FROM answers WHERE question_id = ? AND room_id IS NULL ORDER BY id'
  ).all(q.id);
  if (answers.length < 5) return res.status(400).json({ error: `need at least 5 answers, have ${answers.length}` });

  // Only count groups that have members — dummy wall-post groups (no members) don't block regrouping
  const existing = db.prepare(`
    SELECT COUNT(*) as n FROM groups g WHERE g.question_id = ? AND g.room_id IS NULL
    AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = g.id)
  `).get(q.id).n;
  if (existing > 0) return res.status(409).json({ error: 'groups already exist — reset first' });

  try {
    const groupsFromClaude = await groupAnswers({ topicName: topic.name, questionText: q.text, answers });
    const answerById = Object.fromEntries(answers.map(a => [a.id, a]));

    const validGroups = groupsFromClaude.filter(g =>
      (g.members || []).filter(m => answerById[m.answer_id]).length >= 4
    );

    const agendas = await Promise.all(validGroups.map(g => {
      const members = (g.members || []).map(m => ({ ...m, answer: answerById[m.answer_id] })).filter(m => m.answer);
      return generateAgenda({
        topicName: topic.name, questionText: q.text,
        members: members.map(m => ({ role_tag: m.role_tag, answer_text: m.answer.answer_text })),
        mode: 'online'
      });
    }));

    const insertGroup = db.prepare(
      "INSERT INTO groups (question_id, topic_id, group_number, group_name, claude_reasoning, central_tension, agenda, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)"
    );
    const insertMember = db.prepare(
      'INSERT INTO group_members (group_id, answer_id, student_name, student_email, role_tag) VALUES (?, ?, ?, ?, ?)'
    );
    const insertMsg = db.prepare(
      "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, NULL, NULL, ?, 'prompt', ?)"
    );

    const group_ids = [];
    for (let i = 0; i < validGroups.length; i++) {
      const g = validGroups[i];
      const members = (g.members || []).map(m => ({ ...m, answer: answerById[m.answer_id] })).filter(m => m.answer);
      const info = insertGroup.run(
        q.id, topic.id, g.group_number || (i + 1),
        g.group_name || `Group ${i + 1}`,
        g.reasoning || '', g.central_tension || '',
        JSON.stringify(agendas[i])
      );
      const groupId = info.lastInsertRowid;
      group_ids.push(groupId);
      for (const m of members) {
        insertMember.run(groupId, m.answer.id, m.answer.student_name, m.answer.student_email, m.role_tag || '');
      }
      // Post Step 1 prompt immediately
      const agenda = agendas[i];
      if (agenda[0]) {
        const msgInfo = insertMsg.run(groupId, agenda[0].prompt, agenda[0].step);
        const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgInfo.lastInsertRowid);
        io.to(`group:${groupId}`).emit('group:message', { message });
      }
    }

    res.json({ groups_created: validGroups.length, group_ids });
  } catch (e) {
    console.error('[demo run-full] failed:', e);
    res.status(500).json({ error: 'grouping failed: ' + e.message });
  }
});

app.post('/api/demo/inject-messages', (req, res) => {
  if (demoGuard(req, res)) return;
  const { group_id } = req.body || {};
  if (!group_id) return res.status(400).json({ error: 'group_id required' });

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(group_id);
  if (!group) return res.status(404).json({ error: 'group not found' });

  // Check which seeded students are actually members of this group
  const members = db.prepare('SELECT student_email FROM group_members WHERE group_id = ?').all(group_id);
  const memberEmails = new Set(members.map(m => m.student_email));

  const insertMsg = db.prepare(
    "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, ?, ?, ?, 'student', 1)"
  );

  const injected = [];
  for (const msg of DEMO_INJECT_MESSAGES) {
    // Use the message if the student is in this group, or inject all 3 regardless for demo variety
    const info = insertMsg.run(group_id, msg.email, msg.name, msg.text);
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
    io.to(`group:${group_id}`).emit('group:message', { message });
    injected.push(message);
  }

  res.json({ injected: injected.length, messages: injected });
});

app.post('/api/demo/advance-all', (req, res) => {
  if (demoGuard(req, res)) return;
  const active = db.prepare("SELECT id FROM groups WHERE status = 'active' AND room_id IS NULL").all();
  const results = [];
  for (const g of active) {
    const result = forceAdvanceStep(g.id);
    if (result.message) {
      emitGroupMessage(io, g.id, result.message);
    }
    results.push({ group_id: g.id, ...result });
  }
  res.json({ advanced: results.length, results });
});

app.post('/api/demo/complete-all', (req, res) => {
  if (demoGuard(req, res)) return;
  const CLOSING = "Your conversation is complete. You've heard each other out — now write your group's one-sentence contribution to the campus wall. Make it specific, honest, and something that actually emerged from this discussion.";
  const active = db.prepare("SELECT * FROM groups WHERE status = 'active' AND room_id IS NULL").all();
  let completed = 0;
  for (const g of active) {
    const agenda = JSON.parse(g.agenda || '[]');
    const lastStep = agenda[agenda.length - 1];
    // Force-post remaining unposted steps then closing
    const result = forceAdvanceStep(g.id);
    if (result.message) emitGroupMessage(io, g.id, result.message);

    const closingPosted = db.prepare(
      "SELECT id FROM messages WHERE group_id = ? AND message_type = 'system'"
    ).get(g.id);
    if (!closingPosted) {
      const info = db.prepare(
        "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, NULL, NULL, ?, 'system', ?)"
      ).run(g.id, CLOSING, lastStep?.step ?? 4);
      db.prepare("UPDATE groups SET status = 'complete' WHERE id = ?").run(g.id);
      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
      io.to(`group:${g.id}`).emit('group:message', { message });
    } else {
      db.prepare("UPDATE groups SET status = 'complete' WHERE id = ?").run(g.id);
    }
    completed++;
  }
  res.json({ completed });
});

app.delete('/api/demo/reset', (req, res) => {
  if (demoGuard(req, res)) return;
  // Only delete real groups (have members) — dummy wall-post groups (no members) are preserved
  const realGroupIds = db.prepare(
    'SELECT DISTINCT group_id as id FROM group_members WHERE group_id IN (SELECT id FROM groups WHERE room_id IS NULL)'
  ).all().map(r => r.id);

  if (realGroupIds.length > 0) {
    const ph = realGroupIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM wall_posts WHERE group_id IN (${ph})`).run(...realGroupIds);
    db.prepare(`DELETE FROM messages WHERE group_id IN (${ph})`).run(...realGroupIds);
    db.prepare(`DELETE FROM group_members WHERE group_id IN (${ph})`).run(...realGroupIds);
    db.prepare(`DELETE FROM groups WHERE id IN (${ph})`).run(...realGroupIds);
  }
  res.json({ reset: true });
});

// ---------- Boot ----------

startStepAdvancer(io);
httpServer.listen(PORT, () => {
  console.log(`[mosaic] server → http://localhost:${PORT}`);
  if (DEMO_MODE) console.log('[mosaic] DEMO MODE active');
});
