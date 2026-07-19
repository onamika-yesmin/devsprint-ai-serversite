import mongoose from 'mongoose';
import { env } from './config';

export async function connectDatabase() {
  if (!env.mongoUri) { console.warn('MONGODB_URI is not set: using API demo mode without persistence.'); return false; }
  await mongoose.connect(env.mongoUri);
  console.log('MongoDB connected');
  return true;
}
