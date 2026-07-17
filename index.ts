import express, { Request, Response } from 'express';

const app = express();
const initialPort = Number(process.env.PORT) || 5000;

app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'Backend is running successfully!' });
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
