import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from './config';

export type TokenPayload = { userId: string; email: string };
export const signToken = (payload: TokenPayload) => jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: 'Authentication is required' });
  try { (req as Request & { auth: TokenPayload }).auth = jwt.verify(token, env.jwtSecret) as TokenPayload; next(); }
  catch { return res.status(401).json({ message: 'Your session is invalid or has expired' }); }
}
