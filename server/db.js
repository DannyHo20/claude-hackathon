import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '..', 'mosaic.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  color TEXT
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  topic_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  week TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (topic_id) REFERENCES topics(id)
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL,
  topic_id INTEGER NOT NULL,
  student_name TEXT NOT NULL,
  student_email TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(question_id, student_email)
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL,
  topic_id INTEGER NOT NULL,
  group_number INTEGER,
  group_name TEXT,
  claude_reasoning TEXT,
  agenda TEXT,
  status TEXT DEFAULT 'waiting',
  started_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_members (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  answer_id INTEGER,
  student_name TEXT,
  student_email TEXT,
  role_tag TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  student_email TEXT,
  student_name TEXT,
  content TEXT NOT NULL,
  message_type TEXT NOT NULL,
  agenda_step INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wall_posts (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  topic_id INTEGER NOT NULL,
  group_name TEXT,
  output_text TEXT NOT NULL,
  agree_count INTEGER DEFAULT 0,
  pushback_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id);
CREATE INDEX IF NOT EXISTS idx_answers_topic ON answers(topic_id);
CREATE INDEX IF NOT EXISTS idx_questions_week ON questions(week, is_active);
`);

export function currentWeek(date = new Date()) {
  // ISO 8601 week: YYYY-Www
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function nextWeek(week) {
  const [y, w] = week.split('-W').map(Number);
  if (w >= 52) return `${y + 1}-W01`;
  return `${y}-W${String(w + 1).padStart(2, '0')}`;
}

const TOPICS = [
  { name: 'Campus culture', slug: 'campus-culture', color: '#534AB7',
    description: 'Unwritten rules, social norms, how students treat each other.' },
  { name: 'Academic life', slug: 'academic-life', color: '#0F6E56',
    description: 'Grades, professors, learning, what education is actually for.' },
  { name: 'Money and class', slug: 'money-and-class', color: '#854F0B',
    description: 'Financial stress, inequality on campus, who gets what.' },
  { name: 'Tech and AI', slug: 'tech-and-ai', color: '#185FA5',
    description: 'How technology is changing student life, AI in education.' },
  { name: 'Identity and belonging', slug: 'identity-and-belonging', color: '#993556',
    description: 'Who feels at home here and why, representation, inclusion.' }
];

const WEEK1_QUESTIONS = {
  'campus-culture': "If you saw a student cheating on an exam and reported them, would you tell people you did it? Why does your answer reveal something about this campus?",
  'academic-life': "A student who consistently challenges their professor and turns out to be right — should that affect their grade? What does your answer say about what grades are actually for?",
  'money-and-class': "If everyone at this university had to publicly display their family income, what do you think would change? What wouldn't?",
  'tech-and-ai': "If you could use AI for every assignment with no restrictions, would you? What would you lose — if anything?",
  'identity-and-belonging': "Is it possible to feel genuinely included somewhere while still feeling like you have to perform a version of yourself to fit in?"
};

const SEED_ANSWERS_CAMPUS = [
  { name: 'Jordan M', email: 'jordan.m@test.edu', text: "I'd report them. Not telling people I did it though — that's about integrity not reputation." },
  { name: 'Sam K', email: 'sam.k@test.edu', text: "Absolutely not reporting. The system that creates cheating is the problem, not the individual." },
  { name: 'Alex T', email: 'alex.t@test.edu', text: "I'd report but only anonymously. The social cost of being known as someone who reports is too high on this campus." },
  { name: 'Maya R', email: 'maya.r@test.edu', text: "Why is everyone so sure about this? I've been the person struggling enough to consider it. It's not simple." },
  { name: 'Chris L', email: 'chris.l@test.edu', text: "I'd report and I'd own it. If nobody does, nothing changes. Someone has to." },
  { name: 'Priya N', email: 'priya.n@test.edu', text: "The question assumes the rules are fair. They're not designed equally for everyone." },
  { name: 'Daniel W', email: 'daniel.w@test.edu', text: "Grades are a performance metric not a morality test. Reporting feels self-righteous to me." },
  { name: 'Sofia H', email: 'sofia.h@test.edu', text: "I reported someone once. Lost two friends. Still think I was right but the social fallout was real." },
  { name: 'Marcus J', email: 'marcus.j@test.edu', text: "The fact that we're all hedging reveals something — we know the system punishes honesty." },
  { name: 'Emma B', email: 'emma.b@test.edu', text: "I think it depends entirely on whether you know the person. Strangers vs friends is a completely different question." }
];

export function seed() {
  const week = currentWeek();

  const topicCount = db.prepare('SELECT COUNT(*) as n FROM topics').get().n;
  if (topicCount === 0) {
    const insertTopic = db.prepare(
      'INSERT INTO topics (name, slug, description, color) VALUES (?, ?, ?, ?)'
    );
    for (const t of TOPICS) {
      insertTopic.run(t.name, t.slug, t.description, t.color);
    }
  }

  const insertQuestion = db.prepare(
    'INSERT INTO questions (topic_id, text, week, is_active) VALUES (?, ?, ?, 1)'
  );
  for (const t of TOPICS) {
    const topic = db.prepare('SELECT id FROM topics WHERE slug = ?').get(t.slug);
    if (!topic) continue;
    const existing = db.prepare(
      'SELECT id FROM questions WHERE topic_id = ? AND week = ?'
    ).get(topic.id, week);
    if (!existing) {
      insertQuestion.run(topic.id, WEEK1_QUESTIONS[t.slug], week);
    }
  }

  // Seed 10 Campus Culture answers if none exist yet for this week's question
  const campus = db.prepare('SELECT id FROM topics WHERE slug = ?').get('campus-culture');
  if (campus) {
    const q = db.prepare(
      'SELECT id FROM questions WHERE topic_id = ? AND week = ? AND is_active = 1'
    ).get(campus.id, week);
    if (q) {
      const count = db.prepare('SELECT COUNT(*) as n FROM answers WHERE question_id = ?').get(q.id).n;
      if (count === 0) {
        const insertAns = db.prepare(
          'INSERT INTO answers (question_id, topic_id, student_name, student_email, answer_text) VALUES (?, ?, ?, ?, ?)'
        );
        for (const a of SEED_ANSWERS_CAMPUS) {
          insertAns.run(q.id, campus.id, a.name, a.email, a.text);
        }
      }
    }
  }
}

// Auto-seed on import
seed();

export default db;
