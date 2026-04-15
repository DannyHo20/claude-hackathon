import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
dotenv.config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

const DEMO_MODE = process.env.DEMO_MODE === 'true';

// Generic 4-step fallback agenda if Claude fails
const FALLBACK_AGENDA = [
  { step: 1, title: 'Opening', prompt: "Let's start simple: share your answer in one or two sentences. No debate yet — just get your position on the table.", duration_minutes: 4, unlocks_at_hour: 0 },
  { step: 2, title: 'Tension', prompt: "Now that you've heard each other — where do you actually disagree? Name it directly. Who's defending the minority view here?", duration_minutes: 4, unlocks_at_hour: 6 },
  { step: 3, title: 'Deeper', prompt: "What's the question underneath this question — the one none of you have asked yet?", duration_minutes: 6, unlocks_at_hour: 12 },
  { step: 4, title: 'Common ground', prompt: "Find one thing you genuinely agree on — not a compromise, something real that emerged from this conversation. That's your wall post.", duration_minutes: 4, unlocks_at_hour: 18 }
];

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
  } catch {
    const first = stripped.indexOf('[');
    const firstObj = stripped.indexOf('{');
    const start = first === -1 ? firstObj : (firstObj === -1 ? first : Math.min(first, firstObj));
    const last = Math.max(stripped.lastIndexOf(']'), stripped.lastIndexOf('}'));
    if (start !== -1 && last > start) {
      try { return JSON.parse(stripped.slice(start, last + 1)); } catch {}
    }
    console.error('[claude] JSON parse failed. Raw:\n', raw);
    throw new Error('Claude returned invalid JSON');
  }
}

async function callClaude({ system, user, maxTokens = 2000 }) {
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: system || undefined,
    messages: [{ role: 'user', content: user }]
  });
  return resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

// ---------- Grouping ----------

export async function groupAnswers({ topicName, questionText, answers }) {
  const list = answers.map(a => `Answer ${a.id} — ${a.student_name}: ${a.answer_text}`).join('\n');

  const system = `You are assembling discussion groups for Mosaic, a campus connection platform. Your job is to create groups with maximum productive tension — not similarity. Follow instructions exactly and output valid JSON only.`;

  const user = `Topic: ${topicName}
Question: ${questionText}

Student answers:
${list}

PHASE 1 — Score every answer on 3 axes (internal, don't output):
Axis A — STANCE: 1=accepts premise, 2=complicates it, 3=rejects/reframes
Axis B — REASONING: 1=personal/emotional, 2=values/ethical, 3=systemic/analytical
Axis C — CERTAINTY: 1=very certain, 2=nuanced, 3=genuinely uncertain

PHASE 2 — Assemble groups of exactly 5:
- MUST have 2+ different Stance scores per group
- MUST have 2+ different Reasoning Style scores per group
- SHOULD include one Certainty=3 person per group (they open things up)
- Never group the two most similar answers together
- If not divisible by 5: one group of 6, never smaller than 4

PHASE 3 — Self-check each group:
- Can you name the first disagreement this group will have? If not, regroup.
- Does anyone feel like the odd one out with no ally? If yes, adjust.

PHASE 4 — Assign role_tags and group_names:
- role_tag: 4-6 words specific to this group context
- group_name: 2-3 words naming the central tension
- central_tension: one sentence naming the specific disagreement this group will have

OUTPUT: Valid JSON only. No preamble. No markdown fences.
[
  {
    "group_number": 1,
    "group_name": "Cost vs Conscience",
    "reasoning": "why these 5 will have an interesting conversation",
    "central_tension": "the specific disagreement this group will have",
    "members": [
      { "answer_id": 12, "role_tag": "reports and publicly owns it" }
    ]
  }
]`;

  const raw = await callClaude({ system, user, maxTokens: 4000 });
  return parseClaudeJSON(raw);
}

// ---------- Agenda generation ----------

export async function generateAgenda({ topicName, questionText, members, mode = 'online' }) {
  const list = members.map(m => `- ${m.role_tag}: ${m.answer_text}`).join('\n');
  const isClassroom = mode === 'classroom';
  const wordLimit = isClassroom ? '60' : '80';
  const stepStyle = isClassroom
    ? 'Write for in-person verbal discussion. Short and punchy.'
    : 'Write for async text conversation. Slightly expanded.';

  const system = `You are generating conversation agendas for Mosaic discussion groups. Each prompt must directly reference the actual content of student answers — no generic prompts allowed.`;

  const user = `Topic: ${topicName}
Question: ${questionText}

The group members and their angles:
${list}

Generate a 4-step conversation agenda. ${stepStyle} Under ${wordLimit} words per prompt.

Step 1 (unlocks_at_hour: 0): Opening — each person states position in one sentence. No debate. Goal: feel safe.
Step 2 (unlocks_at_hour: 6): Tension — name the central disagreement directly. Give the person with the most different view a prompt to make their case.
Step 3 (unlocks_at_hour: 12): Deeper — the question this specific group needs to sit with, derived from their actual answers.
Step 4 (unlocks_at_hour: 18): Ground — find one thing they genuinely agree on. This becomes their wall post.

Write each prompt in a warm, curious, slightly provocative voice. Not academic. Like a smart friend facilitating. Reference specific angles from their answers — never write generic prompts.

OUTPUT: Valid JSON only. No preamble.
[
  { "step": 1, "title": "Opening", "prompt": "...", "duration_minutes": 4, "unlocks_at_hour": 0 },
  { "step": 2, "title": "Tension", "prompt": "...", "duration_minutes": 4, "unlocks_at_hour": 6 },
  { "step": 3, "title": "Deeper", "prompt": "...", "duration_minutes": 6, "unlocks_at_hour": 12 },
  { "step": 4, "title": "Ground", "prompt": "...", "duration_minutes": 4, "unlocks_at_hour": 18 }
]`;

  try {
    const raw = await callClaude({ system, user, maxTokens: 2000 });
    return parseClaudeJSON(raw);
  } catch (e) {
    console.warn('[claude] agenda generation failed, using fallback:', e.message);
    return FALLBACK_AGENDA;
  }
}

// ---------- Reactive step prompts (steps 2-4) ----------

export async function generateReactivePrompt({ topicName, questionText, members, previousMessages, stepNumber, stepTitle, mode = 'online' }) {
  const memberList = members.map(m => `- ${m.role_tag}: ${m.answer_text}`).join('\n');
  const msgList = previousMessages.length
    ? previousMessages.map(m => `${m.student_name || 'Moderator'}: ${m.content}`).join('\n')
    : '(no messages yet — the group was silent this step)';
  const wordLimit = mode === 'classroom' ? '60' : '80';

  const user = `You are facilitating a Mosaic group conversation.
Topic: ${topicName} — Question: ${questionText}

Group members:
${memberList}

Messages from the previous step:
${msgList}

Generate the prompt for Step ${stepNumber}: ${stepTitle}.
Rules:
- If there were messages: quote or reference something specific that was said. Name the tension that emerged.
- If no messages: acknowledge the silence briefly, then still ask the question for this step.
- Under ${wordLimit} words.
- Do not start with affirmation ("Great!", "Nice!", etc.)
- Warm, curious, slightly provocative tone.
Output: prompt text only. No JSON. No quotes around it.`;

  try {
    const raw = await callClaude({ user, maxTokens: 300 });
    return raw.trim();
  } catch (e) {
    console.warn('[claude] reactive prompt failed:', e.message);
    return FALLBACK_AGENDA[stepNumber - 1]?.prompt || "What emerged from that conversation that surprised you?";
  }
}

// ---------- Quality check ----------

export async function qualityCheckOutput({ outputText, questionText }) {
  const user = `A student group submitted this as their collective wall post:
"${outputText}"

The conversation was about: ${questionText}

Check if this is worth posting. Reject if:
- Vague or generic (e.g. "we learned communication is important")
- Under 15 words
- Doesn't reflect something specific from real discussion
- Just restates the original question

If it passes: respond with exactly: APPROVED
If it fails: respond with exactly: REVISE — [one sentence of specific feedback]`;

  const raw = (await callClaude({ user, maxTokens: 300 })).trim();
  if (/^APPROVED/i.test(raw)) return { approved: true };
  if (/^REVISE/i.test(raw)) {
    const feedback = raw.replace(/^REVISE\s*[—\-:]*\s*/i, '').trim() || 'Please make it more specific.';
    return { approved: false, feedback };
  }
  console.warn('[claude] unexpected quality-check response, defaulting to reject:', raw);
  return { approved: false, feedback: 'Please make your output more specific and grounded in what was actually discussed.' };
}

// ---------- Weekly question generation ----------

export async function generateWeeklyQuestions({ pastQuestions }) {
  const past = (pastQuestions || []).map(q => `- ${q}`).join('\n') || '(none yet)';

  const user = `Generate one question for each of these 5 topic channels for a university campus connection platform called Mosaic.

Topic channels:
1. campus-culture — unwritten rules, social norms, how students treat each other
2. academic-life — grades, professors, learning, what education is actually for
3. money-and-class — financial stress, inequality on campus, who gets what
4. tech-and-ai — how technology is changing student life, AI in education
5. identity-and-belonging — who feels at home here and why, representation, inclusion

Question requirements:
- Genuinely controversial within campus life — makes people lean forward
- Personal ("what do YOU think/do/believe") not political
- No right answer — reasonable people will genuinely disagree
- Answerable from lived experience
- Specific enough to produce different answers

Do NOT ask about: party politics, religion, race as policy, anything unsafe.

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

// ---------- Meetup card (online mode post-conversation) ----------

export async function generateMeetupCard({ topicName, questionText, step4Messages, centralTension, members }) {
  const msgList = step4Messages.map(m => `${m.student_name || 'Moderator'}: ${m.content}`).join('\n');
  const memberNames = members.map(m => m.student_name).join(', ');

  const user = `A group just finished a 24-hour conversation on Mosaic.
Topic: ${topicName} — Question: ${questionText}
Members: ${memberNames}
Central tension: ${centralTension}

Final step messages:
${msgList}

Generate a meetup suggestion card for this group to continue in person.

Output JSON:
{
  "meetup_prompt": "one sentence naming what's worth settling in person. Under 25 words.",
  "card_q1": "low stakes opener referencing something specific from the chat",
  "card_q2": "the unresolved tension named directly, using members' names",
  "card_q3": "reflective close"
}`;

  try {
    const raw = await callClaude({ user, maxTokens: 500 });
    return parseClaudeJSON(raw);
  } catch (e) {
    console.warn('[claude] meetup card failed:', e.message);
    return {
      meetup_prompt: "Your conversation left something unresolved — meet up and settle it.",
      card_q1: "What's one thing from the chat that actually changed how you see this?",
      card_q2: "You two didn't agree — has anything shifted?",
      card_q3: "What would you tell someone who hasn't had this conversation yet?"
    };
  }
}

export { DEMO_MODE };
