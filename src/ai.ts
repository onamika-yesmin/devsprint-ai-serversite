import { env } from './config';

type GeneratedPlan = { blueprint: string; tasks: { title: string; priority: 'High' | 'Medium' | 'Low'; status: 'todo'; sprint: number }[] };
type ProviderResult = { text: string; provider: 'openai' | 'gemini' | 'fallback' };

type RecommendationProject = {
  id: string;
  title: string;
  shortDescription: string;
  priority: 'High' | 'Medium' | 'Low';
  techStack: string[];
  tasks?: { title: string; status: string; priority: string; sprint: number }[];
};

function extractJson(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? value;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) return undefined;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return undefined; }
}

async function callLlm(system: string, prompt: string): Promise<ProviderResult> {
  if (env.openaiApiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.openaiApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
          temperature: 0.4,
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        }),
      });
      if (response.ok) {
        const body = await response.json() as { choices?: { message?: { content?: string } }[] };
        const text = body.choices?.[0]?.message?.content?.trim();
        if (text) return { text, provider: 'openai' };
      }
    } catch (error) {
      console.warn('OpenAI request failed; falling back.', error);
    }
  }

  if (env.geminiApiKey) {
    try {
      const model = process.env.GEMINI_MODEL ?? 'gemini-1.5-flash';
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `${system}\n\n${prompt}` }] }] }),
      });
      if (response.ok) {
        const body = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join('\n').trim();
        if (text) return { text, provider: 'gemini' };
      }
    } catch (error) {
      console.warn('Gemini request failed; falling back.', error);
    }
  }

  return { text: '', provider: 'fallback' };
}

function fallbackPlan(title: string, brief: string): GeneratedPlan {
  return {
    blueprint: `# ${title} delivery blueprint\n\n## Goal\n${brief || 'Define the customer outcome and ship a focused first release.'}\n\n## First release\nValidate the problem, build the core workflow, then measure adoption.\n\n## Delivery risks\nConfirm scope with stakeholders and test the critical user flow before sprint two.`,
    tasks: [
      { title: 'Clarify user problem and success metric', priority: 'High', status: 'todo', sprint: 1 },
      { title: 'Create core user flow', priority: 'High', status: 'todo', sprint: 1 },
      { title: 'Build first usable workflow', priority: 'Medium', status: 'todo', sprint: 1 },
      { title: 'Instrument adoption metrics', priority: 'Medium', status: 'todo', sprint: 2 },
    ],
  };
}

export async function createProjectPlan(title: string, brief: string): Promise<GeneratedPlan> {
  const fallback = fallbackPlan(title, brief);
  const result = await callLlm(
    'You are an expert product delivery agent. Return only valid JSON.',
    `Create a sprint-ready delivery plan for this project.
Title: ${title}
Brief: ${brief || 'No brief provided'}

Return JSON with this exact shape:
{
  "blueprint": "markdown blueprint with goal, release scope, risks, and success metrics",
  "tasks": [{"title":"task name","priority":"High|Medium|Low","status":"todo","sprint":1}]
}`
  );
  if (result.provider === 'fallback') return fallback;
  const parsed = extractJson(result.text) as Partial<GeneratedPlan> | undefined;
  if (!parsed?.blueprint || !Array.isArray(parsed.tasks)) return fallback;
  return {
    blueprint: parsed.blueprint,
    tasks: parsed.tasks.slice(0, 12).map((task) => ({
      title: String(task.title ?? 'Review delivery task'),
      priority: task.priority === 'High' || task.priority === 'Low' ? task.priority : 'Medium',
      status: 'todo',
      sprint: Math.max(Number(task.sprint ?? 1), 1),
    })),
  };
}

export async function generateContentDraft(input: { kind: string; audience: string; tone: string; length: string; context: string }) {
  const fallback = `# ${input.kind || 'Project'} draft\n\nFor ${input.audience || 'the product team'}, this ${input.tone || 'clear'} draft turns the provided context into a practical launch message.\n\n## Key message\n${input.context || 'Clarify the customer problem, describe the outcome, and explain the next action.'}\n\n## Call to action\nReview the scope, confirm the owner, and start the next sprint with a measurable goal.`;
  const result = await callLlm(
    'You are a senior product content strategist. Produce useful, specific, non-placeholder content.',
    `Generate a ${input.length || 'medium'} ${input.kind || 'project brief'}.
Audience: ${input.audience || 'product builders'}
Tone: ${input.tone || 'clear and confident'}
Context:
${input.context || 'A product team needs a crisp launch-ready draft.'}`
  );
  return { draft: result.text || fallback, provider: result.provider };
}

export async function recommendProjects(projects: RecommendationProject[], goals: string) {
  const ranked = [...projects].sort((a, b) => {
    const score = (project: RecommendationProject) =>
      (project.priority === 'High' ? 3 : project.priority === 'Medium' ? 2 : 1) +
      (project.tasks?.filter((task) => task.status !== 'done').length ?? 0) * 0.2 +
      (goals && `${project.title} ${project.shortDescription} ${project.techStack.join(' ')}`.toLowerCase().includes(goals.toLowerCase()) ? 2 : 0);
    return score(b) - score(a);
  }).slice(0, 4);
  const fallback = {
    summary: ranked.length
      ? `Focus on ${ranked[0].title} first because it has the strongest priority and the clearest near-term delivery path.`
      : 'Add at least one project so DevSprint can build recommendations from your actual workspace.',
    nextActions: ranked.length
      ? ['Confirm the highest-risk task owner.', 'Limit the next sprint to the top three outcomes.', 'Review low-priority work after the release path is stable.']
      : ['Create a project with a short brief.', 'Add priority and tech stack context.', 'Generate an AI blueprint.'],
    recommendedProjectIds: ranked.map((project) => project.id),
  };

  const result = await callLlm(
    'You are an agentic product advisor. Analyze the workspace and return only valid JSON.',
    `User goals: ${goals || 'Improve delivery focus'}
Projects:
${JSON.stringify(projects.slice(0, 12))}

Return JSON:
{
  "summary": "one specific recommendation summary",
  "nextActions": ["3 to 5 concrete actions"],
  "recommendedProjectIds": ["ids from the input only"]
}`
  );
  if (result.provider === 'fallback') return { ...fallback, provider: result.provider };
  const parsed = extractJson(result.text) as Partial<typeof fallback> | undefined;
  if (!parsed?.summary || !Array.isArray(parsed.nextActions)) return { ...fallback, provider: 'fallback' as const };
  return {
    summary: parsed.summary,
    nextActions: parsed.nextActions.slice(0, 5).map(String),
    recommendedProjectIds: Array.isArray(parsed.recommendedProjectIds) ? parsed.recommendedProjectIds.map(String) : fallback.recommendedProjectIds,
    provider: result.provider,
  };
}
