import path from "node:path";
import dotenv from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";

dotenv.config({
  path: [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", "..", ".env.local"),
  ],
});

const url = process.env.CONVEX_URL;
if (!url) {
  throw new Error(
    "CONVEX_URL is not set. Add it to apps/backend/.env or the repo root .env.local " +
      "(e.g. CONVEX_URL=https://<deployment>.convex.cloud) and run `pnpm convex:dev` once if the deployment is new.",
  );
}

export const convex = new ConvexHttpClient(url);
export { api };
