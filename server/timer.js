import { db } from './db.js';

const CLOSING_MESSAGE =
  "Your 24 hours are up. You've heard each other out. Now: what's the one thing that surprised you most about this conversation? Write it as your group's contribution to the campus wall — one sentence, specific, honest.";

function hoursSince(isoOrSqliteDate) {
  if (!isoOrSqliteDate) return 0;
  // SQLite CURRENT_TIMESTAMP stores UTC without 'Z'
  const str = typeof isoOrSqliteDate === 'string' && !isoOrSqliteDate.endsWith('Z') && !isoOrSqliteDate.includes('T')
    ? isoOrSqliteDate.replace(' ', 'T') + 'Z'
    : isoOrSqliteDate;
  const started = new Date(str);
  return (Date.now() - started.getTime()) / (1000 * 60 * 60);
}

export function advanceGroup(groupId) {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group) return { error: 'group not found' };
  if (group.status === 'complete') return { status: 'complete' };
  if (group.status !== 'active') return { error: 'group not active' };

  const agenda = JSON.parse(group.agenda || '[]');
  if (!agenda.length) return { error: 'no agenda' };

  const hours = hoursSince(group.started_at);

  const postedSteps = new Set(
    db.prepare(
      "SELECT DISTINCT agenda_step FROM messages WHERE group_id = ? AND message_type = 'prompt'"
    ).all(groupId).map(r => r.agenda_step)
  );

  const insertMsg = db.prepare(
    "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, NULL, NULL, ?, ?, ?)"
  );

  let posted = 0;
  for (const step of agenda) {
    if (hours >= step.unlocks_at_hour && !postedSteps.has(step.step)) {
      insertMsg.run(groupId, step.prompt, 'prompt', step.step);
      posted++;
    }
  }

  // Check completion: after step 4 + its duration (total 24h)
  const lastStep = agenda[agenda.length - 1];
  const totalDuration = lastStep ? (lastStep.unlocks_at_hour + (lastStep.duration_hours || 6)) : 24;
  if (hours >= totalDuration) {
    const closingPosted = db.prepare(
      "SELECT id FROM messages WHERE group_id = ? AND message_type = 'system' AND content = ?"
    ).get(groupId, CLOSING_MESSAGE);
    if (!closingPosted) {
      db.prepare(
        "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, NULL, NULL, ?, 'system', ?)"
      ).run(groupId, CLOSING_MESSAGE, lastStep ? lastStep.step : 4);
      db.prepare("UPDATE groups SET status = 'complete' WHERE id = ?").run(groupId);
      posted++;
    }
  }

  return { posted };
}

export function forceAdvanceStep(groupId) {
  // Manually post the next unposted step, ignoring timing. For admin/testing.
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group) return { error: 'group not found' };
  if (group.status === 'complete') return { status: 'complete' };

  const agenda = JSON.parse(group.agenda || '[]');
  if (!agenda.length) return { error: 'no agenda' };

  const postedSteps = new Set(
    db.prepare(
      "SELECT DISTINCT agenda_step FROM messages WHERE group_id = ? AND message_type = 'prompt'"
    ).all(groupId).map(r => r.agenda_step)
  );

  // If group is waiting, mark active + set started_at
  if (group.status === 'waiting') {
    db.prepare("UPDATE groups SET status = 'active', started_at = CURRENT_TIMESTAMP WHERE id = ?").run(groupId);
  }

  const insertMsg = db.prepare(
    "INSERT INTO messages (group_id, student_email, student_name, content, message_type, agenda_step) VALUES (?, NULL, NULL, ?, ?, ?)"
  );

  for (const step of agenda) {
    if (!postedSteps.has(step.step)) {
      insertMsg.run(groupId, step.prompt, 'prompt', step.step);
      return { posted: 1, step: step.step };
    }
  }

  // All steps posted. Post closing message + complete.
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
  const agenda = JSON.parse(group.agenda || '[]');
  const hours = hoursSince(group.started_at);
  let current = null;
  for (const step of agenda) {
    if (hours >= step.unlocks_at_hour) current = step;
  }
  return current;
}

export function nextStepUnlocksAt(group) {
  if (!group || group.status !== 'active' || !group.started_at) return null;
  const agenda = JSON.parse(group.agenda || '[]');
  const hours = hoursSince(group.started_at);
  const next = agenda.find(s => hours < s.unlocks_at_hour);
  if (!next) return null;
  const started = new Date(
    group.started_at.includes('T') ? group.started_at : group.started_at.replace(' ', 'T') + 'Z'
  );
  return new Date(started.getTime() + next.unlocks_at_hour * 3600 * 1000).toISOString();
}

export function startStepAdvancer(intervalMs = 15 * 60 * 1000) {
  const tick = () => {
    try {
      const active = db.prepare("SELECT id FROM groups WHERE status = 'active'").all();
      for (const g of active) {
        advanceGroup(g.id);
      }
    } catch (e) {
      console.error('[timer] tick error:', e);
    }
  };
  // Run once on boot, then on interval
  tick();
  return setInterval(tick, intervalMs);
}
