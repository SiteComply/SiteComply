import { PrismaClient } from '@prisma/client';

/**
 * Prisma client singleton.
 *
 * In development Next.js hot-reloads modules, which would otherwise spawn a new
 * PrismaClient (and a new connection pool) on every reload. We cache a single
 * instance on `globalThis` to avoid exhausting database connections.
 *
 * This is the only place the rest of the app talks to the database — the data
 * layer stays behind `services/` so it can be swapped or extracted later.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
