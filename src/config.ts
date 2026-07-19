import 'dotenv/config';

const requiredInProduction = ['JWT_SECRET'];
const mongoUri = process.env.MONGODB_URI ?? process.env.MONGO_URI;
const normalizedMongoUri = mongoUri?.trim();
const isDemoMongo = normalizedMongoUri ? ['demo', 'disabled', 'false', 'none'].includes(normalizedMongoUri.toLowerCase()) : true;

if (process.env.NODE_ENV === 'production') {
  const missing = requiredInProduction.filter((key) => !process.env[key]);
  // Do not crash the entire Vercel function at import time. The health route
  // stays available and the database layer reports demo mode until values are set.
  if (missing.length) console.warn(`Missing production environment variables: ${missing.join(', ')}`);
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 5000),
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:3000',
  // MONGO_URI is supported for compatibility with existing Vercel projects.
  mongoUri: isDemoMongo ? undefined : normalizedMongoUri,
  mongoConfigured: Boolean(normalizedMongoUri) && !isDemoMongo,
  mongoEnvName: process.env.MONGODB_URI ? 'MONGODB_URI' : process.env.MONGO_URI ? 'MONGO_URI' : undefined,
  jwtSecret: process.env.JWT_SECRET ?? 'development-only-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  cloudinary: { cloudName: process.env.CLOUDINARY_CLOUD_NAME, apiKey: process.env.CLOUDINARY_API_KEY, apiSecret: process.env.CLOUDINARY_API_SECRET },
  google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, callbackUrl: process.env.GOOGLE_CALLBACK_URL },
  openaiApiKey: process.env.OPENAI_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
};
