import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { db, currentWeek, nextWeek } from './db.js';
import {
  groupAnswers,
  generateAgenda,
  qualityCheckOutput,
  generateWeeklyQuestions
} from './claude.js';
import {
  startStepAdvancer,
  advanceGroup,
  forceAdvanceStep,
  currentStep,
  nextStepUnlocksAt
} from './timer.js';

dotenv.config();
const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json({ limit: '200kb' }));

// ---------- Topics + Questions ----------

app.get('/api/topics', (req, res) => {
  const week = currentWeek();
  const topics = db.prepare('SELECT * FROM topics ORDER BY id').all();
  const result = topics.map(t => {
    const q = db.prepare(
      'SELECT * FROM questions WHERE topic_id = ? AND week = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
    ).get(t.id, week);
    const answerCount = q ? db.prepare(
      'SELECT COUNT(*) as n FROM answers WHERE question_id = ?'
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
  const { topic_id, question_id, student_name, student_email, answer_text } = req.body || {};
  if (!topic_id || !question_id || !student_name || !student_email || !answer_text) {
    return res.status(400).json({ error: 'missing fields' });
  }
  if (answer_text.length > 400) {
    return res.status(400).json({ error: 'answer exceeds 400 characters' });
  }
  const existing = db.prepare(
    'SELECT id FROM answers WHERE question_id = ? AND student_email = ?'
  ).get(question_id, student_email.trim().toLowerCase());
  if (existing) return res.status(409).json({ error: 'you already answered this question' });
  try {
    const info = db.prepare(
      'INSERT INTO answers (question_id, topic_id, student_name, student_email, answer_text) VALUES (?, ?, ?, ?, ?)'
    ).run(question_id, topic_id, student_name.trim(), student_email.trim().toLowerCase(), answer_text.trim());
    res.json({ success: true, answer_id: info.lastInsertRowid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to save answer' });
  }
});

app.get('/api/my-answers', (req, res) => {
  const email = (req.query.email || '').toString().trim().toLowerCase();
  if (!email) return res.json({ answers: [] });
  const rows = db.prepare(
    'SELECT question_id, topic_id FROM answers WHERE student_email = ?'
  ).all(email);
  res.json({ answers: rows });
});

// ---------- Admin: Grouping ----------

app.post('/api/admin/run-grouping/:topicSlug', async (req, res) => {
  const week = currentWeek();
  const topic = db.prepare('SELECT * FROM topics WHERE slug = ?').get(req.params.topicSlug);
  if (!topic) return res.status(404).json({ error: 'topic not found' });
  const q = db.prepare(
    'SELECT * FROM questions WHERE topic_id = ? AND week = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
  ).get(topic.id, week);
  if (!q) return res.status(404).json({ error: 'no active question' });

  const answers = db.prepare(
    'SELECT * FROM answers WHERE question_id = ? ORDER BY id'
  ).all(q.id);

  if (answers.length < 5) {
    return res.status(400).json({
      error: `not enough answers — have ${answers.length}, need at least 5 (${5 - answers.length} more needed).`
    });
  }

  // Skip re-grouping if groups already exist for this question
  const existingGroups = db.prepare('SELECT COUNT(*) as n FROM groups WHERE question_id = ?').get(q.id).n;
  if (existingGroups > 0) {
    return res.status(409).json({ error: `groups already created for this question (${existingGroups})` });
  }

  try {
    const groupsFromClaude = await groupAnswers({
      topicName: topic.name,
      questionText: q.text,
      answers
    });

    const answerById = Object.fromEntries(answers.map(a => [a.id, a]));

    const insertGroup = db.prepare(
      'INSERT INTO groups (question_id, topic_id, group_number, group_name, claude_reasoning, agenda, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertMember = db.prepare(
      'INSERT INTO group_members (group_id, answer_id, student_name, student_email, role_tag) VALUES (?, ?, ?, ?, ?)'
    );

    let created = 0;
    for (const g of groupsFromClaude) {
      const members = (g.members || [])
        .map(m => ({ ...m, answer: answerById[m.answer_id] }))
        .filter(m => m.answer);
      if (members.length < 3) {
        console.warn('[grouping] skipping undersized group:', g);
        continue;
      }

      const agenda = await generateAgenda({
        topicName: topic.name,
        questionText: q.text,
        members: members.map(m => ({ role_tag: m.role_tag, answer_text: m.answer.answer_text }))
      });

      const info = insertGroup.run(
        q.id, topic.id, g.group_number || (created + 1),
        g.group_name || `Group ${created + 1}`,
        g.reasoning || '',
        JSON.stringify(agenda),
        'waiting'
      );
      const groupId = info.lastInsertRowid;
      for (const m of members) {
        insertMember.run(groupId, m.answer.id, m.answer.student_name, m.answer.student_email, m.role_tag || '');
      }
      created++;
    }

    res.json({ groups_created: created });
  } catch (e) {
    console.error('[grouping] failed:', e);
    res.status(500).json({ error: 'grouping failed: ' + e.message });
  }
});

app.post('/api/admin/start-conversations/:topicSlug', (req, res) => {
  const week = currentWeek();
  const topic = db.prepare('SELECT * FROM topics WHERE slug = ?').get(req.params.topicSlug);
  if (!topic) return res.status(404).json({ error: 'topic not found' });
  const q = db.prepare(
    'SELECT * FROM questions WHERE topic_id = ? AND week = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
  ).get(topic.id, week);
  if (!q) return res.status(404).json({ error: 'no active question' });

  const groups = db.prepare(
    "SELECT * FROM groups WHERE question_id = ? AND status = 'waiting'"
  ).all(q.id);

  const update = db.prepare(
    "UPDATE groups SET status = 'active', started_at = CURRENT_TIMESTAMP WHERE id = ?"
  );
  const insertMsg = db.prepare(
    "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, NULL, NULL, ?, 'prompt', ?)"
  );

  let started = 0;
  for (const g of groups) {
    update.run(g.id);
    const agenda = JSON.parse(g.agenda || '[]');
    const step1 = agenda[0];
    if (step1) {
      insertMsg.run(g.id, step1.prompt, step1.step);
    }
    started++;
  }

  res.json({ groups_started: started });
});

app.post('/api/admin/generate-questions', async (req, res) => {
  try {
    const past = db.prepare('SELECT text FROM questions ORDER BY id DESC LIMIT 50').all().map(r => r.text);
    const generated = await generateWeeklyQuestions({ pastQuestions: past });

    const curr = currentWeek();
    const nextW = nextWeek(curr);

    const insertQ = db.prepare(
      'INSERT INTO questions (topic_id, text, week, is_active) VALUES (?, ?, ?, 1)'
    );
    let count = 0;
    for (const item of generated) {
      const topic = db.prepare('SELECT id FROM topics WHERE slug = ?').get(item.topic_slug);
      if (!topic) continue;
      const existing = db.prepare(
        'SELECT id FROM questions WHERE topic_id = ? AND week = ?'
      ).get(topic.id, nextW);
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

app.get('/api/admin/groups', (req, res) => {
  const groups = db.prepare(`
    SELECT g.*, t.name as topic_name, t.slug as topic_slug, q.text as question_text
    FROM groups g
    JOIN topics t ON t.id = g.topic_id
    JOIN questions q ON q.id = g.question_id
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

// ---------- My Group + Messages ----------

app.get('/api/my-group', (req, res) => {
  const email = (req.query.email || '').toString().trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email required' });

  const member = db.prepare(`
    SELECT gm.*, g.id as group_id
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.student_email = ?
    ORDER BY g.created_at DESC
    LIMIT 1
  `).get(email);

  if (!member) return res.json({ group: null });

  const group = db.prepare(`
    SELECT g.*, t.name as topic_name, t.slug as topic_slug, t.color as topic_color, q.text as question_text
    FROM groups g
    JOIN topics t ON t.id = g.topic_id
    JOIN questions q ON q.id = g.question_id
    WHERE g.id = ?
  `).get(member.group_id);

  const members = db.prepare(
    'SELECT student_name, role_tag FROM group_members WHERE group_id = ? ORDER BY id'
  ).all(group.id);

  const messages = db.prepare(
    'SELECT * FROM messages WHERE group_id = ? ORDER BY id'
  ).all(group.id);

  const agenda = JSON.parse(group.agenda || '[]');
  const current = currentStep(group);
  const nextUnlock = nextStepUnlocksAt(group);

  res.json({
    group: {
      id: group.id,
      group_name: group.group_name,
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
      your_role_tag: member.role_tag
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
  res.json({ success: true, message });
});

app.get('/api/messages/:groupId', (req, res) => {
  const email = (req.query.email || '').toString().trim().toLowerCase();
  const groupId = Number(req.params.groupId);
  if (!email) return res.status(400).json({ error: 'email required' });
  const member = db.prepare(
    'SELECT id FROM group_members WHERE group_id = ? AND student_email = ?'
  ).get(groupId, email);
  if (!member) return res.status(403).json({ error: 'not a member of this group' });

  // Run tick for this group so step advances are visible on next fetch
  advanceGroup(groupId);

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  const messages = db.prepare('SELECT * FROM messages WHERE group_id = ? ORDER BY id').all(groupId);

  res.json({
    status: group.status,
    current_step: currentStep(group),
    next_unlock_at: nextStepUnlocksAt(group),
    messages
  });
});

app.post('/api/advance-step', (req, res) => {
  const { group_id } = req.body || {};
  if (!group_id) return res.status(400).json({ error: 'group_id required' });
  const result = forceAdvanceStep(group_id);
  res.json(result);
});

// ---------- Wall ----------

app.post('/api/wall', async (req, res) => {
  const { group_id, student_email, output_text } = req.body || {};
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

  // Reject duplicate post
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
      'INSERT INTO wall_posts (group_id, topic_id, group_name, output_text) VALUES (?, ?, ?, ?)'
    ).run(group_id, group.topic_id, group.group_name, output_text.trim());
    res.json({ success: true, post_id: info.lastInsertRowid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'wall post failed: ' + e.message });
  }
});

app.get('/api/wall', (req, res) => {
  const topicSlug = req.query.topic;
  let rows;
  if (topicSlug && topicSlug !== 'all') {
    const topic = db.prepare('SELECT id FROM topics WHERE slug = ?').get(topicSlug);
    if (!topic) return res.status(404).json({ error: 'topic not found' });
    rows = db.prepare(`
      SELECT wp.*, t.name as topic_name, t.slug as topic_slug, t.color as topic_color
      FROM wall_posts wp
      JOIN topics t ON t.id = wp.topic_id
      WHERE wp.topic_id = ?
      ORDER BY wp.agree_count DESC, wp.created_at DESC
    `).all(topic.id);
  } else {
    rows = db.prepare(`
      SELECT wp.*, t.name as topic_name, t.slug as topic_slug, t.color as topic_color
      FROM wall_posts wp
      JOIN topics t ON t.id = wp.topic_id
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

// ---------- Boot ----------

startStepAdvancer();
app.listen(PORT, () => {
  console.log(`[mosaic] server listening on http://localhost:${PORT}`);
});
