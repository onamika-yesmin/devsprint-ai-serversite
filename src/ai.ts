import { env } from './config';

type GeneratedPlan = { blueprint: string; tasks: { title: string; priority: 'High' | 'Medium' | 'Low'; status: 'todo'; sprint: number }[] };
type ProviderResult = { text: string; provider: 'openai' | 'gemini' | 'fallback' };

type RecommendationProject = {
  id: string;
  title: string;
  shortDescription: string;
  fullDescription?: string;
  deadline?: string;
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
  const context = input.context?.trim() || 'Clarify the customer problem, describe the outcome, and explain the next action.';
  const wordTarget = input.length === 'short' ? '120-180 words' : input.length === 'long' ? '450-650 words' : '240-360 words';
  const fallback = `# ${input.kind || 'Project'} draft

Audience: ${input.audience || 'product stakeholders'}
Tone: ${input.tone || 'clear and practical'}
Target length: ${wordTarget}

## Core message
${context}

## Why it matters
This work gives the team a clearer path from project intent to sprint execution. It connects priority, delivery risk, and the next decision stakeholders need to make.

## Recommended next move
Confirm the owner, reduce the scope to the highest-impact workflow, and turn the next sprint into three measurable outcomes.`;
  const result = await callLlm(
    'You are a senior product content strategist. Produce useful, specific, non-placeholder content.',
    `Generate a ${input.length || 'medium'} ${input.kind || 'project brief'} of about ${wordTarget}.
Audience: ${input.audience || 'product builders'}
Tone: ${input.tone || 'clear and confident'}
Use concrete details from the context, preserve any task or priority signals, and end with a clear next action.
Context:
${context}`
  );
  return { draft: result.text || fallback, provider: result.provider };
}

export async function recommendProjects(projects: RecommendationProject[], goals: string) {
  const goalTerms = goals.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2 && !['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into'].includes(term));
  const scoreProject = (project: RecommendationProject) => {
    const tasks = project.tasks ?? [];
    const searchable = `${project.title} ${project.shortDescription} ${project.fullDescription ?? ''} ${project.priority} ${project.techStack.join(' ')} ${tasks.map((task) => `${task.title} ${task.priority} ${task.status}`).join(' ')}`.toLowerCase();
    const matchScore = goalTerms.reduce((total, term) => total + (searchable.includes(term) ? 1 : 0), 0);
    const openTasks = tasks.filter((task) => task.status !== 'done');
    const highOpenTasks = openTasks.filter((task) => task.priority === 'High').length;
    const dueSoon = project.deadline ? Math.max(0, 30 - Math.ceil((new Date(project.deadline).getTime() - Date.now()) / 86400000)) / 10 : 0;
    return (
      (project.priority === 'High' ? 6 : project.priority === 'Medium' ? 4 : 2) +
      matchScore * 1.8 +
      highOpenTasks * 1.4 +
      openTasks.length * 0.35 +
      dueSoon
    );
  };
  const ranked = [...projects].sort((a, b) => scoreProject(b) - scoreProject(a)).slice(0, 4);
  const lead = ranked[0];
  const leadOpenTasks = lead?.tasks?.filter((task) => task.status !== 'done') ?? [];
  const nextActions = lead
    ? [
      leadOpenTasks[0]?.title ? `Move "${leadOpenTasks[0].title}" into the next sprint checkpoint.` : `Define the first delivery checkpoint for ${lead.title}.`,
      leadOpenTasks.find((task) => task.priority === 'High')?.title ? `Assign an owner for the high-priority task "${leadOpenTasks.find((task) => task.priority === 'High')?.title}".` : 'Assign owners to the highest-risk work before adding new scope.',
      `Use ${lead.title} as the focus project and defer lower-priority work until its release path is stable.`,
      'Review progress after the next three completed tasks and adjust the sprint plan.',
    ]
    : ['Create a project with a short brief.', 'Add priority and tech stack context.', 'Generate an AI blueprint.'];
  const fallback = {
    summary: ranked.length
      ? `Focus on ${ranked[0].title} first. It has the strongest mix of priority, goal fit, and unfinished sprint work in this workspace.`
      : 'Add at least one project so DevSprint can build recommendations from your actual workspace.',
    nextActions,
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
  const inputIds = new Set(projects.map((project) => project.id));
  const recommendedProjectIds = Array.isArray(parsed.recommendedProjectIds)
    ? parsed.recommendedProjectIds.map(String).filter((id) => inputIds.has(id)).slice(0, 4)
    : fallback.recommendedProjectIds;
  return {
    summary: parsed.summary,
    nextActions: parsed.nextActions.slice(0, 5).map(String),
    recommendedProjectIds: recommendedProjectIds.length ? recommendedProjectIds : fallback.recommendedProjectIds,
    provider: result.provider,
  };
}
