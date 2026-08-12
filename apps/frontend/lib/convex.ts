import { ConvexReactClient } from "convex/react";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) {
  throw new Error(
    "NEXT_PUBLIC_CONVEX_URL is not set. Add it to apps/frontend/.env " +
      "(e.g. NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud) and restart `pnpm dev`.",
  );
}

export const convex = new ConvexReactClient(url);
