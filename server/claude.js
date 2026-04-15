import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
dotenv.config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

function stripFences(text) {
  if (!text) return '';
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, '');
  t = t.replace(/```\s*$/i, '');
  return t.trim();
}

function parseClaudeJSON(raw) {
  const stripped = stripFences(raw);
  try {
    return JSON.parse(stripped);
  } catch (e) {
    const first = stripped.indexOf('[');
    const firstObj = stripped.indexOf('{');
    const start = first === -1 ? firstObj : (firstObj === -1 ? first : Math.min(first, firstObj));
    const last = Math.max(stripped.lastIndexOf(']'), stripped.lastIndexOf('}'));
    if (start !== -1 && last > start) {
      try { return JSON.parse(stripped.slice(start, last + 1)); } catch {}
    }
    console.error('[claude] JSON parse failed. Raw response:\n', raw);
    throw e;
  }
}

async function callClaude({ system, user, maxTokens = 2000 }) {
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: system || undefined,
    messages: [{ role: 'user', content: user }]
  });
  const text = resp.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');
  return text;
}

export async function groupAnswers({ topicName, questionText, answers }) {
  const list = answers.map(a => `Answer ${a.id} — ${a.student_name}: ${a.answer_text}`).join('\n');
  const user = `You are assembling discussion groups for Mosaic, a campus connection platform.

Topic: ${topicName}
This week's question: ${questionText}

Student answers (each has an ID):
${list}

Your task: Group these students into teams of exactly 5.

CRITICAL GROUPING RULES:
- Group by PRODUCTIVE DIFFERENCE, never by similarity
- Each group needs genuine tension — at least one person whose answer pulls in a clearly different direction from the others
- Look for: someone who challenges the premise of the question + someone who answers it directly + someone with a personal story angle + someone analytical + someone who sees the other side
- If total answers not divisible by 5: make one group of 4 or one of 6, never smaller than 4
- Assign each member a role_tag: 4-6 words describing the angle they bring (e.g. "defends the system as fair", "rejects the premise entirely", "focuses on personal cost", "argues from collective benefit")
- Generate a group_name: 2-3 evocative words that capture the tension in this specific group (e.g. "The Quiet Dissenters", "Rules vs Reality", "The Cost Counters")

OUTPUT: Valid JSON only. No preamble. No explanation. Strip all markdown.

[
  {
    "group_number": 1,
    "group_name": "Rules vs Reality",
    "reasoning": "One sentence: why will these specific people have an interesting conversation?",
    "members": [
      { "answer_id": 12, "role_tag": "defends academic integrity above all" },
      { "answer_id": 7, "role_tag": "rejects the premise as naive" },
      { "answer_id": 23, "role_tag": "focuses on social cost of reporting" },
      { "answer_id": 4, "role_tag": "argues systems create the cheating" },
      { "answer_id": 31, "role_tag": "personal story of being reported on" }
    ]
  }
]`;
  const raw = await callClaude({ user, maxTokens: 3000 });
  return parseClaudeJSON(raw);
}

export async function generateAgenda({ topicName, questionText, members }) {
  const list = members.map(m => `- ${m.role_tag}: ${m.answer_text}`).join('\n');
  const user = `You are generating a structured async conversation agenda for a group of students on Mosaic.

Topic: ${topicName}
Question they all answered: ${questionText}

The 5 students and their angles:
${list}

Generate a 4-step async conversation agenda. The conversation plays out over 24 hours — each step unlocks 6 hours after the previous one. Students post messages in a shared thread during each step window.

AGENDA RULES:
- Step 1 (hours 0-6): Low stakes opening. Everyone shares their answer briefly. No debate yet. Goal: feel safe.
- Step 2 (hours 6-12): Surface the real tension. Name the specific disagreement in THIS group. Give the person with the most different view a direct prompt to make their case.
- Step 3 (hours 12-18): Go deeper. Ask the question that this specific group needs to sit with — not generic, derived from their actual answers.
- Step 4 (hours 18-24): Synthesis. Ask the group to find one thing they genuinely agree on — not a compromise, something that emerged. This becomes their wall post.

Each step has a prompt — the message Claude posts to the group thread to open that step. Write it in a warm, curious, slightly provocative voice. Not academic. Like a smart friend facilitating.

OUTPUT: Valid JSON only. No preamble.

[
  { "step": 1, "title": "Opening", "prompt": "The message posted to start this step", "duration_hours": 6, "unlocks_at_hour": 0 },
  { "step": 2, "title": "The tension", "prompt": "...", "duration_hours": 6, "unlocks_at_hour": 6 },
  { "step": 3, "title": "Go deeper", "prompt": "...", "duration_hours": 6, "unlocks_at_hour": 12 },
  { "step": 4, "title": "Find common ground", "prompt": "...", "duration_hours": 6, "unlocks_at_hour": 18 }
]`;
  const raw = await callClaude({ user, maxTokens: 2000 });
  return parseClaudeJSON(raw);
}

export async function qualityCheckOutput({ outputText, questionText }) {
  const user = `A student group submitted this as their collective output for the campus wall:
"${outputText}"

The conversation was about: ${questionText}

Check if this output is worth posting. Reject it if:
- It's vague or generic (e.g. "we learned communication is important")
- It's under 15 words
- It doesn't reflect something specific that emerged from real discussion
- It's just a restatement of the original question

If it passes: respond with exactly: APPROVED
If it fails: respond with exactly: REVISE — [one sentence of specific feedback telling them what to make more specific]`;
  const raw = (await callClaude({ user, maxTokens: 300 })).trim();
  if (/^APPROVED/i.test(raw)) return { approved: true };
  if (/^REVISE/i.test(raw)) {
    const feedback = raw.replace(/^REVISE\s*[—\-:]*\s*/i, '').trim() || 'Please make it more specific.';
    return { approved: false, feedback };
  }
  // Default to approved on unexpected response
  console.warn('[claude] unexpected quality-check response, defaulting to APPROVED:', raw);
  return { approved: true };
}

export async function generateWeeklyQuestions({ pastQuestions }) {
  const past = (pastQuestions || []).map(q => `- ${q}`).join('\n') || '(none yet)';
  const user = `Generate one question for each of these 5 topic channels for a university campus connection platform called Mosaic.

Topic channels:
1. Campus culture — unwritten rules, social norms, how students treat each other
2. Academic life — grades, professors, learning, what education is actually for
3. Money and class — financial stress, inequality on campus, who gets what
4. Tech and AI — how technology is changing student life, AI in education
5. Identity and belonging — who feels at home here and why, representation, inclusion

Question requirements:
- Genuinely controversial within campus life — makes people lean forward, not roll their eyes
- Personal ("what do YOU think/do/believe") not political ("what should society do")
- No right answer — reasonable people in the same room will genuinely disagree
- Answerable from lived experience — no research needed
- Specific enough to produce different answers, not so broad it produces the same one
- Do NOT ask about: party politics, religion, race as a policy question, anything that could make a student feel unsafe

Previously used questions to avoid repeating:
${past}

OUTPUT: Valid JSON only. No preamble.

[
  { "topic_slug": "campus-culture", "question": "..." },
  { "topic_slug": "academic-life", "question": "..." },
  { "topic_slug": "money-and-class", "question": "..." },
  { "topic_slug": "tech-and-ai", "question": "..." },
  { "topic_slug": "identity-and-belonging", "question": "..." }
]`;
  const raw = await callClaude({ user, maxTokens: 1500 });
  return parseClaudeJSON(raw);
}
