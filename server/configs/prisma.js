import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { neonConfig } from '@neondatabase/serverless';

import ws from 'ws';
neonConfig.webSocketConstructor = ws;

// To work in edge environments (Cloudflare Workers, Vercel Edge, etc.), enable querying over fetch
// neonConfig.poolQueryViaFetch = true

// Type definition
// declare global {
// var prisma: PrismaClient | undefined
// }

const connectionString = process.env.DIRECT_URL;

const prisma = global.prisma || new PrismaClient({
  datasources: {
    db: {
      url: connectionString
    }
  }
});

if (process.env.NODE_ENV === 'development') global.prisma = prisma;

export default prisma;
