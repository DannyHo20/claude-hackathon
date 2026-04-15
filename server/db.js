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

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  room_code TEXT NOT NULL UNIQUE,
  professor_name TEXT,
  topic_id INTEGER,
  question_id INTEGER,
  mode TEXT NOT NULL DEFAULT 'classroom',
  status TEXT NOT NULL DEFAULT 'lobby',
  current_step INTEGER DEFAULT 0,
  step_started_at DATETIME,
  settings TEXT DEFAULT '{}',
  professor_token TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (topic_id) REFERENCES topics(id),
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY,
  room_id INTEGER,
  question_id INTEGER NOT NULL,
  topic_id INTEGER NOT NULL,
  student_name TEXT NOT NULL,
  student_email TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_answers_online
  ON answers(question_id, student_email) WHERE room_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_answers_room
  ON answers(room_id, student_email) WHERE room_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  room_id INTEGER,
  question_id INTEGER NOT NULL,
  topic_id INTEGER NOT NULL,
  group_number INTEGER,
  group_name TEXT,
  claude_reasoning TEXT,
  central_tension TEXT,
  agenda TEXT,
  status TEXT DEFAULT 'waiting',
  started_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

CREATE TABLE IF NOT EXISTS group_members (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  answer_id INTEGER,
  student_name TEXT,
  student_email TEXT,
  role_tag TEXT,
  FOREIGN KEY (group_id) REFERENCES groups(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  student_email TEXT,
  student_name TEXT,
  content TEXT NOT NULL,
  message_type TEXT NOT NULL,
  agenda_step INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id)
);

CREATE TABLE IF NOT EXISTS message_reactions (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL,
  student_email TEXT NOT NULL,
  reaction TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, student_email),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE TABLE IF NOT EXISTS meetup_rsvps (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  student_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'going',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, student_email),
  FOREIGN KEY (group_id) REFERENCES groups(id)
);

CREATE TABLE IF NOT EXISTS wall_posts (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  topic_id INTEGER NOT NULL,
  room_id INTEGER,
  group_name TEXT,
  output_text TEXT NOT NULL,
  agree_count INTEGER DEFAULT 0,
  pushback_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id);
CREATE INDEX IF NOT EXISTS idx_answers_topic ON answers(topic_id);
CREATE INDEX IF NOT EXISTS idx_questions_week ON questions(week, is_active);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_email ON group_members(student_email);
CREATE INDEX IF NOT EXISTS idx_wall_posts_group ON wall_posts(group_id);
CREATE INDEX IF NOT EXISTS idx_wall_posts_room ON wall_posts(room_id);
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(room_code);
`);

// ---------- Week helpers ----------

export function currentWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function nextWeek(week) {
  const [y, w] = week.split('-W').map(Number);
  if (w >= 53) return `${y + 1}-W01`;
  return `${y}-W${String(w + 1).padStart(2, '0')}`;
}

// ---------- Seed data ----------

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
  { name: 'Jordan M', email: 'jordan@test.com', text: "I'd report. Not telling people though — that's integrity not reputation." },
  { name: 'Sam K', email: 'sam@test.com', text: "Wouldn't report. The system that creates cheating is the real problem." },
  { name: 'Alex T', email: 'alex@test.com', text: "Report anonymously. Owning it publicly feels more performative than principled." },
  { name: 'Maya R', email: 'maya@test.com', text: "I've been the person struggling enough to consider it. It's not simple." },
  { name: 'Chris L', email: 'chris@test.com', text: "I'd report and own it. If nobody does, nothing changes." },
  { name: 'Priya N', email: 'priya@test.com', text: "The rules aren't designed equally. The question assumes they are." },
  { name: 'Daniel W', email: 'daniel@test.com', text: "Grades are a performance metric not a morality test. Reporting feels self-righteous." },
  { name: 'Sofia H', email: 'sofia@test.com', text: "I reported once. Lost two friends. Still think I was right." },
  { name: 'Marcus J', email: 'marcus@test.com', text: "We're all hedging. That reveals something — honesty has a social cost here." },
  { name: 'Emma B', email: 'emma@test.com', text: "It depends entirely on whether you know the person." }
];

const SEED_ANSWERS_TECH = [
  // "Use it freely" voices
  { name: 'Jordan M',  email: 'jordan@test.com',  text: "Yes, everything. The skill is knowing how to prompt well, not how to write a first draft. That's just a new literacy." },
  { name: 'Chris L',   email: 'chris@test.com',   text: "Absolutely. AI is a tool like a calculator. Nobody argues calculators made us worse at math — they freed us for harder problems." },
  { name: 'Lena K',    email: 'lena@test.com',    text: "I already use it for everything I can. My GPA went up. My stress went down. I'm not going back." },
  { name: 'Derek V',   email: 'derek@test.com',   text: "If there are no restrictions, why wouldn't you? The assignment exists to prove you can do the work. AI helps you do the work." },
  { name: 'Mia F',     email: 'mia@test.com',     text: "Every professional tool I'll use in my career involves AI. Using it now is just practicing for reality." },

  // "It hollows out learning" voices
  { name: 'Sam K',     email: 'sam@test.com',     text: "I tried it for a full semester. Got good grades and learned almost nothing. That scared me more than bad grades would have." },
  { name: 'Sofia H',   email: 'sofia@test.com',   text: "Writing is how I figure out what I think. If AI writes for me, I stop being the one thinking. That's a real loss." },
  { name: 'Marcus J',  email: 'marcus@test.com',  text: "There's something that happens in the struggle of figuring something out yourself. AI skips you past it. You arrive somewhere but don't know how." },
  { name: 'Priya N',   email: 'priya@test.com',   text: "I would lose the ability to tell when I actually understand something versus when I think I do. That distinction matters." },
  { name: 'Ethan R',   email: 'ethan@test.com',   text: "The discomfort of not knowing is part of learning. AI removes the discomfort and the learning along with it." },

  // "Access / inequality" voices
  { name: 'Alex T',    email: 'alex@test.com',    text: "Students with paid ChatGPT have a fundamentally different tool than students on the free tier. Nobody talks about this gap." },
  { name: 'Maya R',    email: 'maya@test.com',    text: "AI tutoring is incredible if you can afford the good version. For everyone else it's a worse experience that still erodes the same skills." },
  { name: 'Daniel W',  email: 'daniel@test.com',  text: "The question assumes we all have equal access. I don't have reliable wifi at home. 'Use AI for everything' isn't the same offer for everyone." },

  // "Genuinely uncertain" voices
  { name: 'Emma B',    email: 'emma@test.com',    text: "I use it but feel a kind of shame I can't explain. Which probably tells me something important that I've been avoiding." },
  { name: 'Noah C',    email: 'noah@test.com',    text: "I honestly don't know what I'd lose. That uncertainty is the thing I'd want to sit with before answering yes." },
];

const DEMO_WALL_POSTS = [
  {
    topic_slug: 'campus-culture',
    group_name: 'Principle vs. Survival',
    central_tension: 'Whether reporting is an act of integrity or an act of privilege',
    output_text: "Reporting is about principle but staying silent is about survival — we couldn't agree which one is more honest.",
    agree_count: 15, pushback_count: 8
  },
  {
    topic_slug: 'tech-and-ai',
    group_name: 'Fluency vs. Dependency',
    central_tension: 'Whether AI builds new skills or quietly removes the old ones',
    output_text: "We all use AI but none of us had said it out loud to anyone before this conversation. That's the real finding.",
    agree_count: 22, pushback_count: 3
  },
  {
    topic_slug: 'money-and-class',
    group_name: 'Visibility vs. Silence',
    central_tension: 'Whether making financial inequality visible would help or hurt',
    output_text: "Everyone in this group learned about financial aid from friends, not from the university. That's not an accident.",
    agree_count: 18, pushback_count: 5
  },
  {
    topic_slug: 'identity-and-belonging',
    group_name: 'Inclusion vs. Performance',
    central_tension: 'Whether you can feel included while still performing a version of yourself',
    output_text: "Feeling included and performing inclusion turned out to be the same thing for most of us. That wasn't the conclusion we expected.",
    agree_count: 14, pushback_count: 7
  },
  {
    topic_slug: 'academic-life',
    group_name: 'Understanding vs. Compliance',
    central_tension: 'Whether grades measure learning or just successful performance of learning',
    output_text: "Grades measure compliance more than understanding — and two of us realized we were fine with that, which troubled the other three.",
    agree_count: 9, pushback_count: 11
  },
  {
    topic_slug: 'campus-culture',
    group_name: 'Rule-Keepers vs. System-Skeptics',
    central_tension: 'Whether the rules are worth following when the system creating them is flawed',
    output_text: "We agreed the system is flawed. We disagreed about whether that's a reason to follow the rules or a reason to break them.",
    agree_count: 12, pushback_count: 9
  },
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
    'INSERT OR IGNORE INTO questions (topic_id, text, week, is_active) VALUES (?, ?, ?, 1)'
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

  // Seed 10 campus culture answers if none exist
  const campus = db.prepare('SELECT id FROM topics WHERE slug = ?').get('campus-culture');
  if (campus) {
    const q = db.prepare(
      'SELECT id FROM questions WHERE topic_id = ? AND week = ? AND is_active = 1'
    ).get(campus.id, week);
    if (q) {
      const count = db.prepare('SELECT COUNT(*) as n FROM answers WHERE question_id = ? AND room_id IS NULL').get(q.id).n;
      if (count === 0) {
        const insertAns = db.prepare(
          'INSERT OR IGNORE INTO answers (question_id, topic_id, student_name, student_email, answer_text) VALUES (?, ?, ?, ?, ?)'
        );
        for (const a of SEED_ANSWERS_CAMPUS) {
          insertAns.run(q.id, campus.id, a.name, a.email, a.text);
        }
      }
    }
  }
}

function seedDemoWall() {
  const week = currentWeek();
  const insertGroup = db.prepare(
    "INSERT INTO groups (question_id, topic_id, group_number, group_name, central_tension, agenda, status, started_at) VALUES (?, ?, ?, ?, ?, ?, 'complete', CURRENT_TIMESTAMP)"
  );
  const insertPost = db.prepare(
    'INSERT INTO wall_posts (group_id, topic_id, group_name, output_text, agree_count, pushback_count) VALUES (?, ?, ?, ?, ?, ?)'
  );

  for (let i = 0; i < DEMO_WALL_POSTS.length; i++) {
    const post = DEMO_WALL_POSTS[i];
    const topic = db.prepare('SELECT * FROM topics WHERE slug = ?').get(post.topic_slug);
    if (!topic) continue;
    const q = db.prepare(
      'SELECT id FROM questions WHERE topic_id = ? AND week = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
    ).get(topic.id, week);
    if (!q) continue;

    const groupInfo = insertGroup.run(q.id, topic.id, i + 1, post.group_name, post.central_tension, '[]');
    insertPost.run(groupInfo.lastInsertRowid, topic.id, post.group_name, post.output_text, post.agree_count, post.pushback_count);
  }
}

export function seedDemo() {
  const week = currentWeek();

  // Wipe all generated data but keep topics/questions/answers structure
  db.prepare('DELETE FROM wall_posts').run();
  db.prepare('DELETE FROM messages').run();
  db.prepare('DELETE FROM group_members').run();
  db.prepare('DELETE FROM groups').run();
  db.prepare('DELETE FROM answers').run();

  // Ensure topics exist
  const topicCount = db.prepare('SELECT COUNT(*) as n FROM topics').get().n;
  if (topicCount === 0) {
    const insertTopic = db.prepare(
      'INSERT INTO topics (name, slug, description, color) VALUES (?, ?, ?, ?)'
    );
    for (const t of TOPICS) {
      insertTopic.run(t.name, t.slug, t.description, t.color);
    }
  }

  // Ensure questions exist
  const insertQuestion = db.prepare(
    'INSERT OR IGNORE INTO questions (topic_id, text, week, is_active) VALUES (?, ?, ?, 1)'
  );
  for (const t of TOPICS) {
    const topic = db.prepare('SELECT id FROM topics WHERE slug = ?').get(t.slug);
    if (!topic) continue;
    const existing = db.prepare('SELECT id FROM questions WHERE topic_id = ? AND week = ?').get(topic.id, week);
    if (!existing) insertQuestion.run(topic.id, WEEK1_QUESTIONS[t.slug], week);
  }

  const insertAns = db.prepare(
    'INSERT OR IGNORE INTO answers (question_id, topic_id, student_name, student_email, answer_text) VALUES (?, ?, ?, ?, ?)'
  );

  // Seed 15 tech-and-ai answers
  const techTopic = db.prepare('SELECT * FROM topics WHERE slug = ?').get('tech-and-ai');
  if (techTopic) {
    const q = db.prepare(
      'SELECT id FROM questions WHERE topic_id = ? AND week = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
    ).get(techTopic.id, week);
    if (q) {
      for (const a of SEED_ANSWERS_TECH) {
        insertAns.run(q.id, techTopic.id, a.name, a.email, a.text);
      }
    }
  }

  // Seed 10 campus-culture answers
  const campusTopic = db.prepare('SELECT * FROM topics WHERE slug = ?').get('campus-culture');
  if (campusTopic) {
    const q = db.prepare(
      'SELECT id FROM questions WHERE topic_id = ? AND week = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
    ).get(campusTopic.id, week);
    if (q) {
      for (const a of SEED_ANSWERS_CAMPUS) {
        insertAns.run(q.id, campusTopic.id, a.name, a.email, a.text);
      }
    }
  }

  // Seed pre-built wall posts with dummy completed groups
  seedDemoWall();

  console.log('[mosaic] demo seeded — 15 tech-and-ai answers, 10 campus-culture answers, 6 wall posts');
}

seed();
export default db;
