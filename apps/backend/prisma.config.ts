import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Prisma Client generation runs during pnpm install, before deploy-time
    // environment variables are reliably available. Database commands still
    // use the real DATABASE_URL when it is configured.
    url: process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
