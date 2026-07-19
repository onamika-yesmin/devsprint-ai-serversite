import express, { Request, Response } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
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
const memoryUsers: Array<{ id: string; name: string; email: string; passwordHash: string; avatarUrl?: string; googleId?: string }> = [];
const auth = (req: Request) => (req as Request & { auth: TokenPayload }).auth;
const serialize = (project: any) => ({ id: String(project._id ?? project.id), title: project.title, shortDescription: project.shortDescription, fullDescription: project.fullDescription, priority: project.priority, techStack: project.techStack, imageUrl: project.imageUrl, aiBlueprint: project.aiBlueprint, tasks: project.tasks, createdAt: project.createdAt, owner: String(project.owner) });

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
app.get('/api/auth/google', (_req, res) => {
  if (!env.google.clientId || !env.google.clientSecret || !env.google.callbackUrl) return res.status(503).json({ message: 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL.' });
  const state = jwt.sign({ purpose: 'google-oauth' }, env.jwtSecret, { expiresIn: '10m' });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env.google.clientId);
  url.searchParams.set('redirect_uri', env.google.callbackUrl);
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
    if (payload.purpose !== 'google-oauth' || !code || !env.google.clientId || !env.google.clientSecret || !env.google.callbackUrl) throw new Error('Invalid Google OAuth request');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: env.google.clientId, client_secret: env.google.clientSecret, redirect_uri: env.google.callbackUrl, grant_type: 'authorization_code' }) });
    if (!tokenResponse.ok) throw new Error('Google token exchange failed');
    const tokens = await tokenResponse.json() as { id_token?: string };
    const userResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token ?? '')}`);
    if (!userResponse.ok) throw new Error('Google identity verification failed');
    const profile = await userResponse.json() as { sub: string; email: string; name?: string; picture?: string; aud?: string };
    if (profile.aud !== env.google.clientId || !profile.email || !profile.sub) throw new Error('Google identity is invalid');
    let user: { id: string; name: string; email: string; avatarUrl?: string };
    if (databaseConnected) {
      const record = await User.findOneAndUpdate({ $or: [{ googleId: profile.sub }, { email: profile.email.toLowerCase() }] }, { $set: { googleId: profile.sub, name: profile.name ?? profile.email, avatarUrl: profile.picture } }, { new: true, upsert: true, setDefaultsOnInsert: true });
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
