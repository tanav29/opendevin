import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    optimizePackageImports: ["@tabler/icons-react", "lucide-react", "@hugeicons/react"],
  },
};

export default nextConfig;
