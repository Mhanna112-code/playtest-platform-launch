import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };
// (Batch 30 §20) Under load a money transaction (Pay's reservation under the test's row lock) ran past Prisma's 5-second default and the press got a 500: every
// interactive transaction may wait up to 10 s to start and run up to 20 s.
export const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;
export const db = g.prisma ?? new PrismaClient({ transactionOptions: TX_OPTIONS });
if (process.env.NODE_ENV !== "production") g.prisma = db;
