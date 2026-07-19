import express, { Request, Response } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { PipelineStage, SortOrder } from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import { env } from './src/config';
import { connectDatabase } from './src/database';
import { Project, User } from './src/models';
import { requireAuth, signToken, TokenPayload } from './src/auth';
import { createProjectPlan, generateContentDraft, recommendProjects } from './src/ai';

const app = express();
app.set('trust proxy', 1);
let databaseConnected = false;
let databaseReady: Promise<boolean> | undefined;
function ensureDatabase() {
  if (!databaseReady) databaseReady = connectDatabase().then((connected) => {
    databaseConnected = connected;
    return connected;
  }).catch((error) => {
    console.error('MongoDB connection failed; using demo mode.', error);
    databaseConnected = false;
    return false;
  });
  return databaseReady;
}
const allowedOrigins = Array.from(new Set([
  ...env.clientUrl.split(',').map((url) => url.trim()).filter(Boolean),
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '2mb' }));
// Vercel functions are cold-started. Wait for the initial database connection
// before handling a request, but keep the API usable in intentional demo mode.
app.use(async (_req, _res, next) => { await ensureDatabase(); next(); });
if (env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret) cloudinary.config({ cloud_name: env.cloudinary.cloudName, api_key: env.cloudinary.apiKey, api_secret: env.cloudinary.apiSecret });

type DemoProject = { id: string; owner: string; title: string; shortDescription: string; fullDescription: string; deadline?: string; priority: 'High' | 'Medium' | 'Low'; techStack: string[]; createdAt: string; imageUrl?: string; aiBlueprint: string; tasks: { title: string; priority: 'High' | 'Medium' | 'Low'; status: 'todo' | 'in-progress' | 'done'; sprint: number }[] };
const demoProjects: DemoProject[] = [
  {
    id: 'atlas-finance',
    owner: 'demo-user',
    title: 'Atlas Finance',
    shortDescription: 'A personal finance command center that turns spending history into weekly decisions.',
    fullDescription: 'Atlas Finance helps remote teams understand budgets, subscription drift, and forecast risk before a quarter goes off track.',
    priority: 'High',
    techStack: ['Next.js', 'MongoDB', 'Recharts'],
    createdAt: '2026-07-14T09:30:00.000Z',
    imageUrl: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1200&q=80',
    aiBlueprint: '# Atlas Finance delivery blueprint\n\n## Goal\nGive operators a single place to understand cash movement and risky spend.\n\n## First release\nShip authenticated budget dashboards, recurring-cost detection, and weekly action summaries.\n\n## Success metrics\nReduce manual budget review time by 40% and identify at least five avoidable costs per workspace.',
    tasks: [
      { title: 'Map budget review workflow', priority: 'High', status: 'done', sprint: 1 },
      { title: 'Build transaction import model', priority: 'High', status: 'in-progress', sprint: 1 },
      { title: 'Design recurring spend alerts', priority: 'Medium', status: 'todo', sprint: 2 },
    ],
  },
  {
    id: 'pulse-health',
    owner: 'demo-user',
    title: 'Pulse Health',
    shortDescription: 'A patient follow-up workspace for clinics that need faster care coordination.',
    fullDescription: 'Pulse Health keeps appointments, care notes, and follow-up tasks connected so clinical teams can reduce missed handoffs.',
    priority: 'Medium',
    techStack: ['React', 'Express', 'MongoDB'],
    createdAt: '2026-07-12T11:20:00.000Z',
    imageUrl: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1200&q=80',
    aiBlueprint: '# Pulse Health delivery blueprint\n\n## Goal\nHelp clinics coordinate patient follow-up without spreadsheet-heavy tracking.\n\n## First release\nCreate care plans, assign follow-up owners, and surface overdue patient touchpoints.',
    tasks: [
      { title: 'Define care team roles', priority: 'High', status: 'done', sprint: 1 },
      { title: 'Create follow-up task board', priority: 'Medium', status: 'in-progress', sprint: 1 },
      { title: 'Add overdue reminders', priority: 'Medium', status: 'todo', sprint: 2 },
    ],
  },
  {
    id: 'orbit-commerce',
    owner: 'demo-user',
    title: 'Orbit Commerce',
    shortDescription: 'Inventory and fulfillment visibility for independent retailers selling across channels.',
    fullDescription: 'Orbit Commerce gives store owners one operating view for stock health, delayed orders, and channel performance.',
    priority: 'High',
    techStack: ['Node.js', 'TypeScript', 'MongoDB'],
    createdAt: '2026-07-10T15:00:00.000Z',
    imageUrl: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1200&q=80',
    aiBlueprint: '# Orbit Commerce delivery blueprint\n\n## Goal\nMake stock and fulfillment risk visible before sales are lost.\n\n## First release\nConnect inventory sources, flag low-stock products, and prioritize fulfillment exceptions.',
    tasks: [
      { title: 'Model product inventory states', priority: 'High', status: 'in-progress', sprint: 1 },
      { title: 'Build exception queue', priority: 'High', status: 'todo', sprint: 1 },
      { title: 'Add channel summary cards', priority: 'Low', status: 'todo', sprint: 2 },
    ],
  },
  {
    id: 'lumen-studio',
    owner: 'demo-user',
    title: 'Lumen Studio',
    shortDescription: 'A creative operations hub that keeps briefs, reviews, and launch assets aligned.',
    fullDescription: 'Lumen Studio helps brand teams move from campaign brief to approved deliverables with fewer review loops.',
    priority: 'Low',
    techStack: ['Next.js', 'TypeScript', 'Cloudinary'],
    createdAt: '2026-07-08T08:15:00.000Z',
    imageUrl: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80',
    aiBlueprint: '# Lumen Studio delivery blueprint\n\n## Goal\nCreate a calm place for teams to review, approve, and ship brand assets.\n\n## First release\nLaunch creative brief intake, asset review states, and deadline reminders.',
    tasks: [
      { title: 'Create campaign brief form', priority: 'Medium', status: 'done', sprint: 1 },
      { title: 'Build approval states', priority: 'Medium', status: 'todo', sprint: 2 },
    ],
  },
];
const demoUser = { id: 'demo-user', name: 'Demo User', email: 'demo@devsprint.ai' };
const memoryUsers: Array<{ id: string; name: string; email: string; passwordHash: string; avatarUrl?: string; googleId?: string }> = [];
const auth = (req: Request) => (req as Request & { auth: TokenPayload }).auth;
const serialize = (project: any) => ({
  id: String(project._id ?? project.id),
  title: project.title,
  shortDescription: project.shortDescription,
  fullDescription: project.fullDescription,
  deadline: project.deadline,
  priority: project.priority,
  techStack: project.techStack,
  imageUrl: project.imageUrl,
  aiBlueprint: project.aiBlueprint,
  tasks: project.tasks,
  createdAt: project.createdAt,
  owner: String(project.owner),
});
const priorityWeight = (priority: string) => priority === 'High' ? 3 : priority === 'Medium' ? 2 : 1;
const toTechStack = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
const sortDemoProjects = (data: DemoProject[], sort = 'newest') => [...data].sort((a, b) => {
  if (sort === 'priority') return priorityWeight(b.priority) - priorityWeight(a.priority);
  if (sort === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
});
const mongoSort = (sort = 'newest'): Record<string, SortOrder> => {
  if (sort === 'priority') return { priority: 'asc', createdAt: 'desc' };
  if (sort === 'oldest') return { createdAt: 'asc' };
  return { createdAt: 'desc' };
};
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function googleCallbackUrl(req: Request) {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  return env.google.callbackUrl || `${protocol}://${req.get('host')}/api/auth/google/callback`;
}

app.get('/', (_req, res) => res.json({ message: 'DevSprint AI API is running', database: databaseConnected ? 'connected' : 'demo mode' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, database: databaseConnected ? 'connected' : 'demo' }));

app.post('/api/auth/register', async (req: Request, res: Response) => {
  const { name, email, password, avatarUrl } = req.body as { name?: string; email?: string; password?: string; avatarUrl?: string };
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ message: 'Name, email, and a password of at least 8 characters are required.' });
  if (!databaseConnected) {
    if (memoryUsers.some((user) => user.email === email.toLowerCase())) return res.status(409).json({ message: 'An account already exists for this email.' });
    const user = { id: crypto.randomUUID(), name, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 12), avatarUrl };
    memoryUsers.push(user);
    return res.status(201).json({ token: signToken({ userId: user.id, email: user.email }), user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl } });
  }
  if (await User.exists({ email: email.toLowerCase() })) return res.status(409).json({ message: 'An account already exists for this email.' });
  const user = await User.create({ name, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 12), avatarUrl });
  res.status(201).json({ token: signToken({ userId: String(user._id), email: user.email }), user: { id: String(user._id), name: user.name, email: user.email, avatarUrl: user.avatarUrl } });
});
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (email === demoUser.email && password === 'demo12345') return res.json({ token: signToken({ userId: demoUser.id, email: demoUser.email }), user: demoUser });
  if (!databaseConnected) {
    const user = memoryUsers.find((item) => item.email === email?.toLowerCase());
    if (!user || !(await bcrypt.compare(password ?? '', user.passwordHash))) return res.status(401).json({ message: 'Incorrect email or password. Demo: demo@devsprint.ai / demo12345' });
    return res.json({ token: signToken({ userId: user.id, email: user.email }), user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl } });
  }
  const user = await User.findOne({ email: email?.toLowerCase() });
  if (!user || !user.passwordHash || !(await bcrypt.compare(password ?? '', user.passwordHash))) return res.status(401).json({ message: 'Incorrect email or password.' });
  res.json({ token: signToken({ userId: String(user._id), email: user.email }), user: { id: String(user._id), name: user.name, email: user.email, avatarUrl: user.avatarUrl } });
});
app.post('/api/auth/demo', (_req, res) => res.json({ token: signToken({ userId: demoUser.id, email: demoUser.email }), user: demoUser }));
app.get('/api/auth/google', (req, res) => {
  if (!env.google.clientId || !env.google.clientSecret) return res.status(503).json({ message: 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' });
  const state = jwt.sign({ purpose: 'google-oauth' }, env.jwtSecret, { expiresIn: '10m' });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env.google.clientId);
  url.searchParams.set('redirect_uri', googleCallbackUrl(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  res.redirect(url.toString());
});
app.get('/api/auth/google/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  try {
    const payload = jwt.verify(state, env.jwtSecret) as { purpose?: string };
    if (payload.purpose !== 'google-oauth' || !code || !env.google.clientId || !env.google.clientSecret) throw new Error('Invalid Google OAuth request');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: env.google.clientId, client_secret: env.google.clientSecret, redirect_uri: googleCallbackUrl(req), grant_type: 'authorization_code' }) });
    if (!tokenResponse.ok) throw new Error('Google token exchange failed');
    const tokens = await tokenResponse.json() as { id_token?: string };
    const userResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token ?? '')}`);
    if (!userResponse.ok) throw new Error('Google identity verification failed');
    const profile = await userResponse.json() as { sub: string; email: string; name?: string; picture?: string; aud?: string };
    if (profile.aud !== env.google.clientId || !profile.email || !profile.sub) throw new Error('Google identity is invalid');
    let user: { id: string; name: string; email: string; avatarUrl?: string };
    if (databaseConnected) {
      const record = await User.findOneAndUpdate(
        { $or: [{ googleId: profile.sub }, { email: profile.email.toLowerCase() }] },
        { $set: { googleId: profile.sub, email: profile.email.toLowerCase(), name: profile.name ?? profile.email, avatarUrl: profile.picture } },
        { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
      );
      user = { id: String(record._id), name: record.name, email: record.email, avatarUrl: record.avatarUrl };
    } else {
      let record = memoryUsers.find((item) => item.googleId === profile.sub || item.email === profile.email.toLowerCase());
      if (!record) { record = { id: crypto.randomUUID(), name: profile.name ?? profile.email, email: profile.email.toLowerCase(), passwordHash: '', avatarUrl: profile.picture, googleId: profile.sub }; memoryUsers.push(record); }
      user = { id: record.id, name: record.name, email: record.email, avatarUrl: record.avatarUrl };
    }
    const target = new URL('/auth/callback', env.clientUrl);
    target.searchParams.set('token', signToken({ userId: user.id, email: user.email }));
    target.searchParams.set('name', user.name);
    target.searchParams.set('email', user.email);
    res.redirect(target.toString());
  } catch (error) {
    console.error('Google OAuth callback failed', error);
    const target = new URL('/login', env.clientUrl);
    target.searchParams.set('error', 'google_oauth_failed');
    res.redirect(target.toString());
  }
});

app.get('/api/projects', async (req, res) => {
  const { search = '', priority = '', techStack = '', page = '1', limit = '12', sort = 'newest' } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (search) filter.$or = [{ title: new RegExp(escapeRegExp(search), 'i') }, { shortDescription: new RegExp(escapeRegExp(search), 'i') }];
  if (priority) filter.priority = priority;
  if (techStack) filter.techStack = techStack;
  const currentPage = Math.max(Number(page), 1); const perPage = Math.min(Math.max(Number(limit), 1), 50);
  if (!databaseConnected) {
    const filtered = demoProjects.filter((p) => (!search || `${p.title} ${p.shortDescription} ${p.techStack.join(' ')}`.toLowerCase().includes(search.toLowerCase())) && (!priority || p.priority === priority) && (!techStack || p.techStack.includes(techStack)));
    const data = sortDemoProjects(filtered, sort).slice((currentPage - 1) * perPage, currentPage * perPage).map(serialize);
    return res.json({ data, total: filtered.length, page: currentPage, pages: Math.max(Math.ceil(filtered.length / perPage), 1) });
  }
  if (sort === 'priority') {
    const pipeline: PipelineStage[] = [
      { $match: filter },
      { $addFields: { priorityRank: { $switch: { branches: [{ case: { $eq: ['$priority', 'High'] }, then: 3 }, { case: { $eq: ['$priority', 'Medium'] }, then: 2 }], default: 1 } } } },
      { $sort: { priorityRank: -1, createdAt: -1 } },
      { $skip: (currentPage - 1) * perPage },
      { $limit: perPage },
    ];
    const [data, total] = await Promise.all([Project.aggregate(pipeline), Project.countDocuments(filter)]);
    return res.json({ data: data.map(serialize), total, page: currentPage, pages: Math.max(Math.ceil(total / perPage), 1) });
  }
  const [data, total] = await Promise.all([Project.find(filter).sort(mongoSort(sort)).skip((currentPage - 1) * perPage).limit(perPage), Project.countDocuments(filter)]);
  res.json({ data: data.map(serialize), total, page: currentPage, pages: Math.max(Math.ceil(total / perPage), 1) });
});
app.get('/api/projects/mine', requireAuth, async (req, res) => {
  const owner = auth(req).userId;
  if (!databaseConnected) return res.json({ data: sortDemoProjects(demoProjects.filter((project) => project.owner === owner)).map(serialize) });
  const data = await Project.find({ owner }).sort({ createdAt: -1 });
  res.json({ data: data.map(serialize) });
});
app.get('/api/projects/:id', async (req, res) => {
  try {
    const project = databaseConnected ? await Project.findById(req.params.id) : demoProjects.find((item) => item.id === req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found.' });
    res.json({ data: serialize(project) });
  } catch {
    res.status(404).json({ message: 'Project not found.' });
  }
});
app.post('/api/projects', requireAuth, async (req, res) => {
  const { title, shortDescription, fullDescription = '', deadline, priority = 'Medium', techStack = [], imageUrl, prdText = '' } = req.body;
  if (!title || !shortDescription) return res.status(400).json({ message: 'Title and short description are required.' });
  const plan = await createProjectPlan(title, prdText || fullDescription);
  const record = { owner: auth(req).userId, title, shortDescription, fullDescription, deadline: deadline || undefined, priority, techStack: toTechStack(techStack), imageUrl, prdText, aiBlueprint: plan.blueprint, tasks: plan.tasks };
  if (!databaseConnected) { const project: DemoProject = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...record }; demoProjects.unshift(project); return res.status(201).json({ data: project }); }
  const project = await Project.create(record); res.status(201).json({ data: serialize(project) });
});
app.delete('/api/projects/:id', requireAuth, async (req, res) => { if (!databaseConnected) { const index = demoProjects.findIndex((project) => project.id === req.params.id && project.owner === auth(req).userId); if (index < 0) return res.status(404).json({ message: 'Project not found.' }); demoProjects.splice(index, 1); return res.status(204).send(); } const result = await Project.deleteOne({ _id: req.params.id, owner: auth(req).userId }); if (!result.deletedCount) return res.status(404).json({ message: 'Project not found.' }); res.status(204).send(); });
app.post('/api/uploads/signature', requireAuth, (_req, res) => { if (!env.cloudinary.apiSecret || !env.cloudinary.apiKey || !env.cloudinary.cloudName) return res.status(503).json({ message: 'Cloudinary server credentials are not configured.' }); const timestamp = Math.round(Date.now() / 1000); const signature = cloudinary.utils.api_sign_request({ timestamp }, env.cloudinary.apiSecret); res.json({ signature, timestamp, apiKey: env.cloudinary.apiKey, cloudName: env.cloudinary.cloudName }); });
app.post('/api/ai/content', requireAuth, async (req, res) => {
  const { kind = 'launch brief', audience = 'product team', tone = 'clear and practical', length = 'medium', context = '' } = req.body as Record<string, string>;
  if (!context || context.trim().length < 20) return res.status(400).json({ message: 'Add at least 20 characters of context so the AI can generate useful content.' });
  const data = await generateContentDraft({ kind, audience, tone, length, context });
  res.json({ data });
});
app.post('/api/ai/recommendations', requireAuth, async (req, res) => {
  const { goals = '' } = req.body as { goals?: string };
  const owner = auth(req).userId;
  const projects = databaseConnected
    ? (await Project.find({ owner }).sort({ createdAt: -1 }).limit(12)).map(serialize)
    : sortDemoProjects(demoProjects.filter((project) => project.owner === owner)).map(serialize);
  const data = await recommendProjects(projects, goals);
  res.json({ data: { ...data, projects: projects.filter((project) => data.recommendedProjectIds.includes(project.id)) } });
});

if (!process.env.VERCEL) {
  ensureDatabase().finally(() => app.listen(env.port, () => console.log(`Server running on http://localhost:${env.port}`)));
}

// Required by Vercel: it invokes this Express app as a serverless function.
export default app;
