import { PrismaClient } from '@prisma/client';
import {
  CLOSED_PROJECT_WRITABLE_MODELS,
  ProjectClosedError,
  getClosedSiteIds,
  inProjectLifecycleWrite,
  siteIdFromData,
  siteIdFromWhere,
} from '@/services/projectClosure/projectWritable';

/**
 * Prisma client singleton.
 *
 * In development Next.js hot-reloads modules, which would otherwise spawn a new
 * PrismaClient (and a new connection pool) on every reload. We cache a single
 * instance on `globalThis` to avoid exhausting database connections.
 *
 * This is the only place the rest of the app talks to the database — the data
 * layer stays behind `services/` so it can be swapped or extracted later.
 *
 * SC-025 attaches the completed-project write guard here, for exactly that
 * reason: it is the one place every query passes through, so a completed
 * project is read-only for code that has not been written yet.
 */
const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

/** Write operations whose target rows must be looked up to find their site. */
const NEEDS_LOOKUP = new Set([
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

function createPrismaClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  // The guard's OWN reads go through `base`, not the extended client, so the
  // lookup that decides whether a write is allowed cannot recurse into itself.
  const loadClosed = () =>
    base.jobSite.findMany({
      where: { status: 'COMPLETED' },
      select: { id: true },
    });

  return base.$extends({
    name: 'completed-project-read-only',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !WRITE_OPERATIONS.has(operation)) return query(args);
          if (CLOSED_PROJECT_WRITABLE_MODELS.has(model)) return query(args);
          // Closure and reopening legitimately write to a completed project.
          if (inProjectLifecycleWrite()) return query(args);

          const closed = await getClosedSiteIds(loadClosed);
          if (closed.size === 0) return query(args);

          const a = (args ?? {}) as Record<string, unknown>;
          let siteIds = [
            ...siteIdFromData(a.data),
            ...siteIdFromData(a.create),
            ...siteIdFromWhere(a.where),
          ];

          // An update or delete that targets rows by id tells us nothing about
          // which project they belong to, so ask.
          if (siteIds.length === 0 && NEEDS_LOOKUP.has(operation) && a.where) {
            try {
              const delegate = (
                base as unknown as Record<
                  string,
                  { findMany: (q: unknown) => Promise<{ jobSiteId: string }[]> }
                >
              )[model.charAt(0).toLowerCase() + model.slice(1)];
              if (delegate?.findMany) {
                const rows = await delegate.findMany({
                  where: a.where,
                  select: { jobSiteId: true },
                  take: 100,
                });
                siteIds = rows
                  .map((r) => r.jobSiteId)
                  .filter((v): v is string => typeof v === 'string');
              }
            } catch {
              // The model has no jobSiteId column, or the where clause is not
              // valid for findMany. Nothing to enforce against — fall through.
              // This is why the guard is a backstop and the service layer also
              // refuses: it never claims to catch every possible shape.
            }
          }

          const blocked = siteIds.find((id) => closed.has(id));
          if (blocked) throw new ProjectClosedError(blocked);

          return query(args);
        },
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

/**
 * The transaction client as seen INSIDE `prisma.$transaction(async (tx) => …)`.
 *
 * Extending the client changes its type, so helpers taking a `tx` can no longer
 * be typed as `Prisma.TransactionClient` — that is the un-extended shape. Use
 * this instead so the guard stays in force inside interactive transactions.
 */
export type AppTransactionClient = Omit<
  ExtendedPrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
