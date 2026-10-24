import "dotenv/config";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const databaseUrl = process.env.DATABASE_URL;
const backendDirectory = path.resolve(import.meta.dirname, "../..");

if (!databaseUrl) throw new Error("DATABASE_URL is not configured");

const sqliteUrl = databaseUrl.startsWith("file:")
  ? `file:${path.resolve(backendDirectory, databaseUrl.slice("file:".length))}`
  : databaseUrl;
const adapter = new PrismaBetterSqlite3({ url: sqliteUrl });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });
if (!globalForPrisma.prisma) globalForPrisma.prisma = prisma;
