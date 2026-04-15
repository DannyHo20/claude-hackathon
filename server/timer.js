import { db } from './db.js';
import { generateReactivePrompt, DEMO_MODE } from './claude.js';

// In demo mode: steps advance every 30 seconds instead of 6 hours
const STEP_HOURS = DEMO_MODE ? (30 / 3600) : 6;
const TICK_MS = DEMO_MODE ? 5000 : 15 * 60 * 1000;

const CLOSING_MESSAGE =
  "Your conversation is complete. You've heard each other out — now write your group's one-sentence contribution to the campus wall. Make it specific, honest, and something that actually emerged from this discussion.";

function hoursSince(isoOrSqliteDate) {
  if (!isoOrSqliteDate) return 0;
  const str = typeof isoOrSqliteDate === 'string' && !isoOrSqliteDate.endsWith('Z') && !isoOrSqliteDate.includes('T')
    ? isoOrSqliteDate.replace(' ', 'T') + 'Z'
    : isoOrSqliteDate;
  return (Date.now() - new Date(str).getTime()) / (1000 * 60 * 60);
}

// Recalculate agenda unlock times based on STEP_HOURS
function rescaleAgenda(agenda) {
  return agenda.map((step, i) => ({
    ...step,
    unlocks_at_hour: i * STEP_HOURS
  }));
}

export async function advanceGroup(groupId, io) {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group || group.status === 'complete' || group.status !== 'active') return;

  const rawAgenda = JSON.parse(group.agenda || '[]');
  const agenda = rescaleAgenda(rawAgenda);
  if (!agenda.length) return;

  const hours = hoursSince(group.started_at);

  const postedSteps = new Set(
    db.prepare(
      "SELECT DISTINCT agenda_step FROM messages WHERE group_id = ? AND message_type = 'prompt'"
    ).all(groupId).map(r => r.agenda_step)
  );

  const insertMsg = db.prepare(
    "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, NULL, NULL, ?, ?, ?)"
  );

  // Fetch group context for reactive prompts
  const groupContext = db.prepare(`
    SELECT g.*, t.name as topic_name, q.text as question_text
    FROM groups g
    JOIN topics t ON t.id = g.topic_id
    JOIN questions q ON q.id = g.question_id
    WHERE g.id = ?
  `).get(groupId);
  const members = db.prepare(
    'SELECT gm.*, a.answer_text FROM group_members gm LEFT JOIN answers a ON a.id = gm.answer_id WHERE gm.group_id = ?'
  ).all(groupId);

  for (const step of agenda) {
    if (hours >= step.unlocks_at_hour && !postedSteps.has(step.step)) {
      let prompt = step.prompt;

      // Steps 2+ use reactive prompts based on previous messages
      if (step.step > 1 && groupContext) {
        const prevMessages = db.prepare(
          "SELECT * FROM messages WHERE group_id = ? AND agenda_step = ? AND message_type = 'student' ORDER BY id"
        ).all(groupId, step.step - 1);

        try {
          prompt = await generateReactivePrompt({
            topicName: groupContext.topic_name,
            questionText: groupContext.question_text,
            members,
            previousMessages: prevMessages,
            stepNumber: step.step,
            stepTitle: step.title,
            mode: 'online'
          });
        } catch (e) {
          console.error('[timer] reactive prompt failed, using static:', e.message);
        }
      }

      const info = insertMsg.run(groupId, prompt, 'prompt', step.step);

      // Emit to socket if io is provided
      if (io) {
        const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
        io.to(`group:${groupId}`).emit('group:message', { message });
      }
    }
  }

  // Check completion
  const lastStep = agenda[agenda.length - 1];
  const totalHours = lastStep ? (lastStep.unlocks_at_hour + STEP_HOURS) : (4 * STEP_HOURS);
  if (hours >= totalHours) {
    const closingPosted = db.prepare(
      "SELECT id FROM messages WHERE group_id = ? AND message_type = 'system' AND content = ?"
    ).get(groupId, CLOSING_MESSAGE);
    if (!closingPosted) {
      const info = db.prepare(
        "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, NULL, NULL, ?, 'system', ?)"
      ).run(groupId, CLOSING_MESSAGE, lastStep?.step ?? 4);
      db.prepare("UPDATE groups SET status = 'complete' WHERE id = ?").run(groupId);

      if (io) {
        const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
        io.to(`group:${groupId}`).emit('group:message', { message });
      }
    }
  }
}

export async function advanceGroupSync(groupId) {
  // Synchronous-safe version for GET /api/messages polling (no reactive prompts)
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group || group.status === 'complete' || group.status !== 'active') return;

  const rawAgenda = JSON.parse(group.agenda || '[]');
  const agenda = rescaleAgenda(rawAgenda);
  if (!agenda.length) return;

  const hours = hoursSince(group.started_at);
  const postedSteps = new Set(
    db.prepare(
      "SELECT DISTINCT agenda_step FROM messages WHERE group_id = ? AND message_type = 'prompt'"
    ).all(groupId).map(r => r.agenda_step)
  );

  const insertMsg = db.prepare(
    "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, NULL, NULL, ?, ?, ?)"
  );

  for (const step of agenda) {
    if (hours >= step.unlocks_at_hour && !postedSteps.has(step.step)) {
      // Use static prompt for sync version (reactive prompts are handled by async timer)
      insertMsg.run(groupId, step.prompt, 'prompt', step.step);
    }
  }

  const lastStep = agenda[agenda.length - 1];
  const totalHours = lastStep ? (lastStep.unlocks_at_hour + STEP_HOURS) : (4 * STEP_HOURS);
  if (hours >= totalHours) {
    const closingPosted = db.prepare(
      "SELECT id FROM messages WHERE group_id = ? AND message_type = 'system' AND content = ?"
    ).get(groupId, CLOSING_MESSAGE);
    if (!closingPosted) {
      db.prepare(
        "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, NULL, NULL, ?, 'system', ?)"
      ).run(groupId, CLOSING_MESSAGE, lastStep?.step ?? 4);
      db.prepare("UPDATE groups SET status = 'complete' WHERE id = ?").run(groupId);
    }
  }
}

export function forceAdvanceStep(groupId) {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group) return { error: 'group not found' };
  if (group.status === 'complete') return { status: 'complete' };

  const agenda = JSON.parse(group.agenda || '[]');
  if (!agenda.length) return { error: 'no agenda' };

  if (group.status === 'waiting') {
    db.prepare("UPDATE groups SET status = 'active', started_at = CURRENT_TIMESTAMP WHERE id = ?").run(groupId);
  }

  const postedSteps = new Set(
    db.prepare(
      "SELECT DISTINCT agenda_step FROM messages WHERE group_id = ? AND message_type = 'prompt'"
    ).all(groupId).map(r => r.agenda_step)
  );

  const insertMsg = db.prepare(
    "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, NULL, NULL, ?, ?, ?)"
  );

  for (const step of agenda) {
    if (!postedSteps.has(step.step)) {
      const info = insertMsg.run(groupId, step.prompt, 'prompt', step.step);
      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
      return { posted: 1, step: step.step, message };
    }
  }

  // All steps posted — post closing
  const closingPosted = db.prepare(
    "SELECT id FROM messages WHERE group_id = ? AND message_type = 'system' AND content = ?"
  ).get(groupId, CLOSING_MESSAGE);
  if (!closingPosted) {
    db.prepare(
      "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, NULL, NULL, ?, 'system', ?)"
    ).run(groupId, CLOSING_MESSAGE, agenda[agenda.length - 1].step);
    db.prepare("UPDATE groups SET status = 'complete' WHERE id = ?").run(groupId);
    return { posted: 1, closing: true };
  }
  return { posted: 0 };
}

export function currentStep(group) {
  if (!group || group.status !== 'active' || !group.started_at) return null;
  const rawAgenda = JSON.parse(group.agenda || '[]');
  const agenda = rescaleAgenda(rawAgenda);
  const hours = hoursSince(group.started_at);
  let current = null;
  for (const step of agenda) {
    if (hours >= step.unlocks_at_hour) current = step;
  }
  return current;
}

export function nextStepUnlocksAt(group) {
  if (!group || group.status !== 'active' || !group.started_at) return null;
  const rawAgenda = JSON.parse(group.agenda || '[]');
  const agenda = rescaleAgenda(rawAgenda);
  const hours = hoursSince(group.started_at);
  const next = agenda.find(s => hours < s.unlocks_at_hour);
  if (!next) return null;
  const started = new Date(
    group.started_at.includes('T') ? group.started_at : group.started_at.replace(' ', 'T') + 'Z'
  );
  return new Date(started.getTime() + next.unlocks_at_hour * 3600 * 1000).toISOString();
}

export function startStepAdvancer(io) {
  const tick = async () => {
    try {
      const active = db.prepare("SELECT id FROM groups WHERE status = 'active' AND room_id IS NULL").all();
      for (const g of active) {
        await advanceGroup(g.id, io);
      }
    } catch (e) {
      console.error('[timer] tick error:', e);
    }
  };
  tick();
  return setInterval(tick, TICK_MS);
}

export { STEP_HOURS, TICK_MS };
