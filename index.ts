import express, { Request, Response } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { v2 as cloudinary } from 'cloudinary';
import { env } from './src/config';
import { connectDatabase } from './src/database';
import { Project, User } from './src/models';
import { requireAuth, signToken, TokenPayload } from './src/auth';
import { createProjectPlan } from './src/ai';

const app = express();
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
app.use(cors({ origin: env.clientUrl.split(',').map((url) => url.trim()), credentials: true }));
app.use(express.json({ limit: '2mb' }));
// Vercel functions are cold-started. Wait for the initial database connection
// before handling a request, but keep the API usable in intentional demo mode.
app.use(async (_req, _res, next) => { await ensureDatabase(); next(); });
if (env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret) cloudinary.config({ cloud_name: env.cloudinary.cloudName, api_key: env.cloudinary.apiKey, api_secret: env.cloudinary.apiSecret });

type DemoProject = { id: string; owner: string; title: string; shortDescription: string; fullDescription: string; priority: 'High' | 'Medium' | 'Low'; techStack: string[]; createdAt: string; imageUrl?: string; aiBlueprint: string; tasks: { title: string; priority: 'High' | 'Medium' | 'Low'; status: 'todo' | 'in-progress' | 'done'; sprint: number }[] };
const demoProjects: DemoProject[] = [];
const demoUser = { id: 'demo-user', name: 'Demo User', email: 'demo@devsprint.ai' };
const auth = (req: Request) => (req as Request & { auth: TokenPayload }).auth;
const serialize = (project: any) => ({ id: String(project._id ?? project.id), title: project.title, shortDescription: project.shortDescription, fullDescription: project.fullDescription, priority: project.priority, techStack: project.techStack, imageUrl: project.imageUrl, aiBlueprint: project.aiBlueprint, tasks: project.tasks, createdAt: project.createdAt, owner: String(project.owner) });

app.get('/', (_req, res) => res.json({ message: 'DevSprint AI API is running', database: databaseConnected ? 'connected' : 'demo mode' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, database: databaseConnected ? 'connected' : 'demo' }));

app.post('/api/auth/register', async (req: Request, res: Response) => {
  const { name, email, password, avatarUrl } = req.body as { name?: string; email?: string; password?: string; avatarUrl?: string };
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ message: 'Name, email, and a password of at least 8 characters are required.' });
  if (!databaseConnected) return res.status(503).json({ message: 'Registration needs MONGODB_URI. Use the demo account while local database configuration is incomplete.' });
  if (await User.exists({ email: email.toLowerCase() })) return res.status(409).json({ message: 'An account already exists for this email.' });
  const user = await User.create({ name, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 12), avatarUrl });
  res.status(201).json({ token: signToken({ userId: String(user._id), email: user.email }), user: { id: String(user._id), name: user.name, email: user.email, avatarUrl: user.avatarUrl } });
});
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (email === demoUser.email && password === 'demo12345') return res.json({ token: signToken({ userId: demoUser.id, email: demoUser.email }), user: demoUser });
  if (!databaseConnected) return res.status(401).json({ message: 'Use demo@devsprint.ai with password demo12345, or configure MongoDB.' });
  const user = await User.findOne({ email: email?.toLowerCase() });
  if (!user || !user.passwordHash || !(await bcrypt.compare(password ?? '', user.passwordHash))) return res.status(401).json({ message: 'Incorrect email or password.' });
  res.json({ token: signToken({ userId: String(user._id), email: user.email }), user: { id: String(user._id), name: user.name, email: user.email, avatarUrl: user.avatarUrl } });
});
app.post('/api/auth/demo', (_req, res) => res.json({ token: signToken({ userId: demoUser.id, email: demoUser.email }), user: demoUser }));
app.get('/api/auth/google', (_req, res) => res.status(501).json({ message: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then add your Google OAuth provider callback.' }));

app.get('/api/projects', async (req, res) => {
  const { search = '', priority = '', techStack = '', page = '1', limit = '12' } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (search) filter.$or = [{ title: new RegExp(search, 'i') }, { shortDescription: new RegExp(search, 'i') }];
  if (priority) filter.priority = priority;
  if (techStack) filter.techStack = techStack;
  if (!databaseConnected) { const data = demoProjects.filter((p) => (!search || `${p.title} ${p.shortDescription}`.toLowerCase().includes(search.toLowerCase())) && (!priority || p.priority === priority) && (!techStack || p.techStack.includes(techStack))); return res.json({ data, total: data.length, page: 1 }); }
  const currentPage = Math.max(Number(page), 1); const perPage = Math.min(Math.max(Number(limit), 1), 50);
  const [data, total] = await Promise.all([Project.find(filter).sort({ createdAt: -1 }).skip((currentPage - 1) * perPage).limit(perPage), Project.countDocuments(filter)]);
  res.json({ data: data.map(serialize), total, page: currentPage });
});
app.get('/api/projects/:id', async (req, res) => { const project = databaseConnected ? await Project.findById(req.params.id) : demoProjects.find((item) => item.id === req.params.id); if (!project) return res.status(404).json({ message: 'Project not found.' }); res.json({ data: serialize(project) }); });
app.post('/api/projects', requireAuth, async (req, res) => {
  const { title, shortDescription, fullDescription = '', deadline, priority = 'Medium', techStack = [], imageUrl, prdText = '' } = req.body;
  if (!title || !shortDescription) return res.status(400).json({ message: 'Title and short description are required.' });
  const plan = await createProjectPlan(title, prdText || fullDescription);
  const record = { owner: auth(req).userId, title, shortDescription, fullDescription, deadline: deadline || undefined, priority, techStack: Array.isArray(techStack) ? techStack : [], imageUrl, prdText, aiBlueprint: plan.blueprint, tasks: plan.tasks };
  if (!databaseConnected) { const project: DemoProject = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...record }; demoProjects.unshift(project); return res.status(201).json({ data: project }); }
  const project = await Project.create(record); res.status(201).json({ data: serialize(project) });
});
app.delete('/api/projects/:id', requireAuth, async (req, res) => { if (!databaseConnected) { const index = demoProjects.findIndex((project) => project.id === req.params.id && project.owner === auth(req).userId); if (index < 0) return res.status(404).json({ message: 'Project not found.' }); demoProjects.splice(index, 1); return res.status(204).send(); } const result = await Project.deleteOne({ _id: req.params.id, owner: auth(req).userId }); if (!result.deletedCount) return res.status(404).json({ message: 'Project not found.' }); res.status(204).send(); });
app.post('/api/uploads/signature', requireAuth, (_req, res) => { if (!env.cloudinary.apiSecret || !env.cloudinary.apiKey || !env.cloudinary.cloudName) return res.status(503).json({ message: 'Cloudinary server credentials are not configured.' }); const timestamp = Math.round(Date.now() / 1000); const signature = cloudinary.utils.api_sign_request({ timestamp }, env.cloudinary.apiSecret); res.json({ signature, timestamp, apiKey: env.cloudinary.apiKey, cloudName: env.cloudinary.cloudName }); });

if (require.main === module) {
  ensureDatabase().finally(() => app.listen(env.port, () => console.log(`Server running on http://localhost:${env.port}`)));
}

// Required by Vercel: it invokes this Express app as a serverless function.
export default app;
