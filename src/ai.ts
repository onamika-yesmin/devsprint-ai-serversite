import { env } from './config';

type GeneratedPlan = { blueprint: string; tasks: { title: string; priority: 'High' | 'Medium' | 'Low'; status: 'todo'; sprint: number }[] };
export async function createProjectPlan(title: string, brief: string): Promise<GeneratedPlan> {
  const fallback: GeneratedPlan = { blueprint: `# ${title} delivery blueprint\n\n## Goal\n${brief || 'Define the customer outcome and ship a focused first release.'}\n\n## First release\nValidate the problem, build the core workflow, then measure adoption.\n\n## Delivery risks\nConfirm scope with stakeholders and test the critical user flow before sprint two.`, tasks: [{ title: 'Clarify user problem and success metric', priority: 'High', status: 'todo', sprint: 1 }, { title: 'Create core user flow', priority: 'High', status: 'todo', sprint: 1 }, { title: 'Build first usable workflow', priority: 'Medium', status: 'todo', sprint: 1 }, { title: 'Instrument adoption metrics', priority: 'Medium', status: 'todo', sprint: 2 }] };
  if (!env.openaiApiKey && !env.geminiApiKey) return fallback;
  // A deterministic fallback remains available if a provider is unavailable or returns malformed output.
  // Provider credentials are deliberately server-only and can be wired to a preferred SDK here.
  return fallback;
}
