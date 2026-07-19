import mongoose from 'mongoose';
import { env } from './config';

export async function connectDatabase() {
  if (!env.mongoUri) { console.warn('MONGODB_URI or MONGO_URI is not set: using API demo mode without persistence.'); return false; }
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS ?? 5000) });
  console.log('MongoDB connected');
  return true;
}
