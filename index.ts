import express, { Request, Response } from 'express';

const app = express();
const initialPort = Number(process.env.PORT) || 5000;
app.use(express.json());

type Project = { id: string; title: string; description: string; priority: 'High' | 'Medium' | 'Low'; techStack: string; createdAt: string };
const projects: Project[] = [
  { id: 'atlas', title: 'Atlas Finance', description: 'A calm personal-finance workspace for modern teams.', priority: 'High', techStack: 'Next.js', createdAt: '2026-07-12' },
  { id: 'pulse', title: 'Pulse Health', description: 'A connected care experience from appointment to follow-up.', priority: 'Medium', techStack: 'React', createdAt: '2026-07-11' },
];

app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'Backend is running successfully!' });
});

app.get('/api/projects', (req: Request, res: Response) => {
  const search = String(req.query.search ?? '').toLowerCase();
  const priority = String(req.query.priority ?? '');
  const techStack = String(req.query.techStack ?? '');
  const data = projects.filter((item) => (!search || `${item.title} ${item.description}`.toLowerCase().includes(search)) && (!priority || item.priority === priority) && (!techStack || item.techStack === techStack));
  res.json({ data, total: data.length });
});

app.get('/api/projects/:id', (req: Request, res: Response) => {
  const project = projects.find((item) => item.id === req.params.id);
  if (!project) return res.status(404).json({ message: 'Project not found' });
  res.json({ data: project });
});

app.post('/api/projects', (req: Request, res: Response) => {
  const { title, description, priority = 'Medium', techStack = 'TypeScript' } = req.body as Partial<Project>;
  if (!title || !description) return res.status(400).json({ message: 'title and description are required' });
  const project: Project = { id: crypto.randomUUID(), title, description, priority: priority as Project['priority'], techStack, createdAt: new Date().toISOString() };
  projects.unshift(project);
  res.status(201).json({ data: project });
});

const startServer = (port: number) => {
  const server = app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`Port ${port} is busy. Trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      throw error;
    }
  });
};

startServer(initialPort);
